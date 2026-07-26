"""Sarvam voice pipeline: Saaras v3 STT -> Sarvam-30B -> Bulbul v3 TTS.

Implements the stateless voice-route contract from IDEA_SCOPE.md §7:

POST /api/voice/turn  (multipart/form-data)
  audio    file   — utterance (wav/mp3/webm/ogg…); optional if `text` is given
  text     str    — chat-surface input (nudge replies) that skips STT.
                    The sentinel "__OPEN__" asks the agent to compose its
                    opening message for this surface (nudge text, call
                    opening line) before the customer has said anything.
  role     str    — 'order' | 'nudge' | 'call'
  context  str    — JSON: {merchant, customer, dues, promises, payments,
                           history, rules, simDate}
  turns    str    — JSON, optional: running transcript of this session,
                    [{"role": "user"|"assistant", "content": str}, ...]
  language str    — STT hint, default "unknown" (auto-detect)

  -> { transcript, agentText, agentAudioB64, tone, intents,
       language, latencyMs: {stt, llm, tts, total} }

The web layer owns all state: it builds `context` from the DB, persists the
returned intents, and replays `turns` each call. This service holds nothing.

Config (env):
  SARVAM_API_KEY        required
  SARVAM_LLM_MODEL      default sarvam-30b
  VOICE_AGENT_SPEAKER   default priya (bulbul:v3 roster)
"""

import base64
import io
import json
import os
import re
import time
import wave

import httpx
from fastapi import APIRouter, Form, HTTPException, UploadFile

from prompts import ROLES, build_system_prompt, tone_band

SARVAM_BASE = "https://api.sarvam.ai"
STT_MODEL = "saaras:v3"
LLM_MODEL = os.environ.get("SARVAM_LLM_MODEL", "sarvam-30b")
TTS_MODEL = "bulbul:v3"
SPEAKER = os.environ.get("VOICE_AGENT_SPEAKER", "priya")

# Bulbul pace expresses the escalation ladder (IDEA_SCOPE §6: "deliberate
# pacing"): firm is slightly slower — deliberate, not aggressive. bulbul:v3
# rejects pitch/loudness (API returns 400), so pace is the only audio knob;
# the rest of the register comes from wording.
TONE_TTS = {
    "warm": {"pace": 1.0},
    "neutral": {"pace": 1.0},
    "firm": {"pace": 0.9},
}

TTS_LANGUAGES = {
    "en-IN", "hi-IN", "bn-IN", "ta-IN", "te-IN", "gu-IN",
    "kn-IN", "ml-IN", "mr-IN", "pa-IN", "od-IN",
}

OPEN_SENTINEL = "__OPEN__"
OPEN_INSTRUCTION = ("(The customer has not spoken yet. Compose your opening message for "
                    "this surface now, following THIS SURFACE instructions and CONTEXT.)")

router = APIRouter()


def _api_key() -> str:
    key = os.environ.get("SARVAM_API_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="SARVAM_API_KEY is not set")
    return key


async def _stt(client: httpx.AsyncClient, audio: bytes, filename: str,
               content_type: str, language: str) -> dict:
    resp = await client.post(
        f"{SARVAM_BASE}/speech-to-text",
        headers={"api-subscription-key": _api_key()},
        files={"file": (filename, audio, content_type)},
        data={"model": STT_MODEL, "mode": "codemix", "language_code": language},
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"STT failed: {resp.text[:300]}")
    return resp.json()


async def _llm(client: httpx.AsyncClient, system_prompt: str,
               turns: list[dict], user_text: str) -> str:
    messages = [{"role": "system", "content": system_prompt}]
    messages += [t for t in turns if t.get("role") in ("user", "assistant") and t.get("content")]
    # The JSON reminder rides on the user turn (internal only — the web layer
    # stores our returned `transcript`, never this suffix). Sarvam-30B drifts
    # to plain prose without it.
    messages.append({"role": "user",
                     "content": f"{user_text}\n\n[Reply with ONLY the JSON object — no other text.]"})

    # Sarvam-30B is a reasoning model: max_tokens covers thinking + answer, and
    # content comes back None (or truncated) when thinking eats the budget.
    # Near-greedy temperatures make it ruminate in loops, so we sample at 0.6
    # and retry hotter to break a loop. Starter tier caps max_tokens at 4096.
    last_content = None
    for max_tokens, temperature in ((3000, 0.6), (4096, 0.8)):
        resp = await client.post(
            f"{SARVAM_BASE}/v1/chat/completions",
            headers={"api-subscription-key": _api_key()},
            json={
                "model": LLM_MODEL,
                "messages": messages,
                "reasoning_effort": "low",
                "temperature": temperature,
                "top_p": 0.95,
                "max_tokens": max_tokens,
            },
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"LLM failed: {resp.text[:300]}")
        choice = resp.json()["choices"][0]
        content = choice["message"]["content"]
        if content and choice.get("finish_reason") == "stop":
            return content
        last_content = content or last_content
    if last_content:
        return last_content  # truncated beats silent — the parser degrades gracefully
    raise HTTPException(status_code=502, detail="LLM produced no content (reasoning exhausted budget twice)")


async def _tts(client: httpx.AsyncClient, text: str, language: str, tone: str) -> str:
    controls = TONE_TTS.get(tone, TONE_TTS["neutral"])
    resp = await client.post(
        f"{SARVAM_BASE}/text-to-speech",
        headers={"api-subscription-key": _api_key()},
        json={
            "inputs": _chunk_text(text),
            "target_language_code": language,
            "speaker": SPEAKER,
            "model": TTS_MODEL,
            "speech_sample_rate": 24000,
            "enable_preprocessing": True,
            **controls,
        },
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"TTS failed: {resp.text[:300]}")
    return _merge_wavs(resp.json()["audios"])


def _chunk_text(text: str, limit: int = 450) -> list[str]:
    """Split on sentence boundaries to stay under the ~500-char TTS input cap."""
    parts = re.split(r"(?<=[।.!?])\s+", text.strip())
    chunks, current = [], ""
    for part in parts:
        if len(current) + len(part) + 1 <= limit:
            current = f"{current} {part}".strip()
        else:
            if current:
                chunks.append(current)
            current = part[:limit]
    if current:
        chunks.append(current)
    return chunks or [text[:limit]]


def _merge_wavs(b64_audios: list[str]) -> str:
    if len(b64_audios) == 1:
        return b64_audios[0]
    params, frames = None, []
    for b64 in b64_audios:
        with wave.open(io.BytesIO(base64.b64decode(b64))) as w:
            params = params or w.getparams()
            frames.append(w.readframes(w.getnframes()))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as out:
        out.setparams(params)
        for frame in frames:
            out.writeframes(frame)
    return base64.b64encode(buf.getvalue()).decode()


def _parse_agent_reply(raw: str, fallback_tone: str) -> dict:
    """Lenient parse of the LLM's JSON contract; degrade to plain speech."""
    text = (raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    start = text.find("{")
    obj = None
    if start != -1:
        depth = 0
        for i, ch in enumerate(text[start:], start):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = json.loads(text[start:i + 1])
                    except json.JSONDecodeError:
                        obj = None
                    break
    if not isinstance(obj, dict) or not obj.get("say"):
        return {"say": text, "tone": fallback_tone, "intents": []}
    tone = obj.get("tone") if obj.get("tone") in TONE_TTS else fallback_tone
    intents = [i for i in obj.get("intents") or [] if isinstance(i, dict) and i.get("type")]
    return {"say": str(obj["say"]), "tone": tone, "intents": intents}


@router.post("/api/voice/turn")
async def voice_turn(
    audio: UploadFile | None = None,
    text: str = Form(""),
    role: str = Form(...),
    context: str = Form("{}"),
    turns: str = Form("[]"),
    language: str = Form("unknown"),
):
    if role not in ROLES:
        raise HTTPException(status_code=422, detail=f"role must be one of {ROLES}")
    try:
        ctx = json.loads(context)
        history_turns = json.loads(turns)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=422, detail=f"bad JSON in context/turns: {e}")
    if audio is None and not text.strip():
        raise HTTPException(status_code=422, detail="provide audio or text")

    t0 = time.perf_counter()
    latency = {}
    async with httpx.AsyncClient(timeout=60.0) as client:
        if audio is not None:
            stt = await _stt(
                client,
                await audio.read(),
                audio.filename or "utterance.wav",
                audio.content_type or "audio/wav",
                language,
            )
            transcript = stt.get("transcript", "")
            detected = stt.get("language_code") or "hi-IN"
            latency["stt"] = round((time.perf_counter() - t0) * 1000)
        else:
            transcript, detected = text.strip(), "hi-IN"
            latency["stt"] = 0

        user_text = transcript
        if transcript == OPEN_SENTINEL:
            transcript, user_text = "", OPEN_INSTRUCTION

        t1 = time.perf_counter()
        raw = await _llm(client, build_system_prompt(role, ctx), history_turns, user_text)
        reply = _parse_agent_reply(raw, fallback_tone=tone_band(ctx))
        latency["llm"] = round((time.perf_counter() - t1) * 1000)

        # The read-back contract needs the customer's yes before booking, but
        # the model sometimes emits place_on_khata alongside the read-back
        # question itself. Deterministic gate: no booking can exist before the
        # agent has spoken at least once in this session.
        if not any(t.get("role") == "assistant" for t in history_turns):
            reply["intents"] = [i for i in reply["intents"] if i["type"] != "place_on_khata"]

        # Nudge is a text surface (WhatsApp-sim) — no audio synthesis.
        audio_b64 = None
        latency["tts"] = 0
        if role != "nudge":
            t2 = time.perf_counter()
            tts_lang = detected if detected in TTS_LANGUAGES else "hi-IN"
            audio_b64 = await _tts(client, reply["say"], tts_lang, reply["tone"])
            latency["tts"] = round((time.perf_counter() - t2) * 1000)

    latency["total"] = round((time.perf_counter() - t0) * 1000)
    return {
        "transcript": transcript,
        "agentText": reply["say"],
        "agentAudioB64": audio_b64,
        "tone": reply["tone"],
        "intents": reply["intents"],
        "language": detected,
        "latencyMs": latency,
    }
