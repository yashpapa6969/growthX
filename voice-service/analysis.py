"""Offline call analysis: channel diarization + energy VAD + Saaras STT + LLM QA.

Twilio dual-channel recordings put the customer on channel 0 (left) and the
Sarvam voice agent on channel 1 (right), so diarization is exact: split the
channels, run an energy VAD per channel for the hard metrics (talk time,
overlap, interruptions, response latency), then send per-channel speech chunks
to Saaras v3 STT with word timestamps and rebuild a merged, time-ordered
transcript. A final Sarvam-30B pass grades the call (naturalness,
task_completion, compliance, language_quality) — but the LLM is strictly
optional: if it fails, the analysis is still cached with the hard metrics and
a stub auto_eval.

Cache: DATA_DIR/analysis/<wav stem>.json (version 1), written atomically.
`analyze_call` is blocking by design — review.py runs it in a threadpool.

Config (env, read lazily — the module imports cleanly without them):
  SARVAM_API_KEY     required at analyze time
  SARVAM_LLM_MODEL   default sarvam-30b
"""

import io
import json
import math
import os
import re
import sys
import uuid
import wave
from array import array
from datetime import datetime, timezone
from pathlib import Path

import httpx

SARVAM_BASE = "https://api.sarvam.ai"
STT_MODEL = "saaras:v3"
STT_MODE = "codemix"

BASE_DIR = Path(__file__).resolve().parent
RECORDINGS_DIR = BASE_DIR / "recordings"
DATA_DIR = BASE_DIR / "data"
ANALYSIS_DIR = DATA_DIR / "analysis"
for _d in (RECORDINGS_DIR, DATA_DIR, ANALYSIS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# VAD / segmentation tunables (seconds unless noted).
FRAME_SEC = 0.030          # RMS analysis frame
MERGE_GAP_SEC = 0.40       # bridge pauses shorter than this into one segment
MIN_SEG_SEC = 0.25         # drop blips shorter than this after merging
CHUNK_SPAN_SEC = 28.0      # STT chunk timeline cap (sync endpoint wants <30 s)
CHUNK_PAD_SEC = 0.15       # context pad around each STT chunk
UTTER_GAP_SEC = 0.80       # word gap that starts a new utterance/turn
INTERRUPT_MIN_SEC = 0.50   # barge-ins shorter than this don't count
LATENCY_MAX_SEC = 10.0     # response gaps beyond this aren't "responses"

# {YYYYMMDD-HHMMSS}_{CallSid}_{RecordingSid}.wav — tolerate anything else.
FILENAME_RE = re.compile(r"^(\d{8}-\d{6})_([^_]+)_([^_]+)\.wav$")

OUTCOMES = {"resolved", "promise_to_pay", "callback", "refused", "incomplete", "unknown"}
SENTIMENTS = {"positive", "neutral", "negative"}
SCORE_DIMS = ("naturalness", "task_completion", "compliance", "language_quality")


# ---------------------------------------------------------------- wav I/O ---

def wav_info(path: Path) -> dict:
    """Cheap header read for listings: duration + channel count."""
    with wave.open(str(path), "rb") as w:
        rate = w.getframerate() or 8000
        return {"duration_sec": round(w.getnframes() / rate, 2),
                "channels": w.getnchannels()}


def _validate(filename: str) -> Path:
    """Reject path tricks and missing files; return the recording path."""
    name = Path(filename).name
    if name != filename or not name.endswith(".wav"):
        raise ValueError(f"bad recording filename: {filename!r}")
    path = RECORDINGS_DIR / name
    if not path.is_file():
        raise ValueError(f"recording not found: {name}")
    return path


def _read_channels(path: Path) -> tuple[list[array], int]:
    """Split interleaved 16-bit frames into per-channel sample arrays."""
    with wave.open(str(path), "rb") as w:
        if w.getsampwidth() != 2:
            raise ValueError(f"expected 16-bit PCM, got sampwidth={w.getsampwidth()}")
        rate = w.getframerate()
        nch = w.getnchannels()
        raw = w.readframes(w.getnframes())
    samples = array("h")
    samples.frombytes(raw[: len(raw) - (len(raw) % 2)])
    if sys.byteorder == "big":  # WAV data is little-endian
        samples.byteswap()
    if nch == 2:
        return [samples[0::2], samples[1::2]], rate
    if nch == 1:
        return [samples], rate
    raise ValueError(f"unsupported channel count: {nch}")


def _parse_meta(path: Path) -> tuple[datetime, str, str]:
    """(recorded_at UTC, call_sid, recording_sid) — mtime/'' fallbacks."""
    call_sid, recording_sid = "", ""
    m = FILENAME_RE.match(path.name)
    if m:
        call_sid, recording_sid = m.group(2), m.group(3)
        try:
            dt = datetime.strptime(m.group(1), "%Y%m%d-%H%M%S").replace(tzinfo=timezone.utc)
            return dt, call_sid, recording_sid
        except ValueError:
            pass
    dt = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    return dt, call_sid, recording_sid


# -------------------------------------------------------------------- VAD ---

def _vad_segments(samples: array, rate: int) -> list[tuple[float, float]]:
    """Energy VAD: 30 ms RMS frames against an adaptive threshold.

    Threshold blends a noise-floor multiple (10th-percentile frame RMS x3),
    a fraction of the loudest frame's RMS (so hot recordings don't admit
    breath noise), and an absolute floor of 60 for near-digital-silence
    channels. Segments are merged across short pauses, then blips dropped.
    """
    n = len(samples)
    frame_len = max(1, int(rate * FRAME_SEC))
    if n < frame_len:
        return []
    rms = []
    for i in range(0, n - frame_len + 1, frame_len):
        acc = 0
        for v in samples[i:i + frame_len]:
            acc += v * v
        rms.append(math.sqrt(acc / frame_len))
    ordered = sorted(rms)
    noise_floor = ordered[int(0.10 * (len(ordered) - 1))]
    peak = ordered[-1]
    threshold = max(noise_floor * 3.0, peak * 0.03, 60.0)

    frame_dur = frame_len / rate
    segs: list[list[float]] = []
    start = None
    for idx, r in enumerate(rms):
        if r >= threshold:
            if start is None:
                start = idx * frame_dur
        elif start is not None:
            segs.append([start, idx * frame_dur])
            start = None
    if start is not None:
        segs.append([start, len(rms) * frame_dur])

    merged: list[list[float]] = []
    for s, e in segs:
        if merged and s - merged[-1][1] < MERGE_GAP_SEC:
            merged[-1][1] = e
        else:
            merged.append([s, e])
    return [(s, e) for s, e in merged if e - s >= MIN_SEG_SEC]


# ---------------------------------------------------------------- metrics ---

def _intersection_sec(a: list, b: list) -> float:
    """Total overlap between two sorted segment lists (two pointers)."""
    total, i, j = 0.0, 0, 0
    while i < len(a) and j < len(b):
        s = max(a[i][0], b[j][0])
        e = min(a[i][1], b[j][1])
        if e > s:
            total += e - s
        if a[i][1] < b[j][1]:
            i += 1
        else:
            j += 1
    return total


def _union_sec(segs: list) -> float:
    total, end = 0.0, -1.0
    for s, e in sorted(segs):
        if s > end:
            total += e - s
            end = e
        elif e > end:
            total += e - end
            end = e
    return total


def _interruptions(by_segs: list, other_segs: list) -> int:
    """Segments of `by` that start inside an active `other` segment and
    last long enough to be a real barge-in rather than a back-channel."""
    count = 0
    for s, e in by_segs:
        if e - s <= INTERRUPT_MIN_SEC:
            continue
        if any(os_ < s < oe for os_, oe in other_segs):
            count += 1
    return count


def _agent_latencies(cust_segs: list, agent_segs: list) -> list[float]:
    """Customer-end -> next speech start; count it only when that next
    speaker is the agent and the gap is a plausible response (0, 10] s."""
    starts = sorted([(s, "agent") for s, _ in agent_segs] +
                    [(s, "customer") for s, _ in cust_segs])
    lats = []
    for _, ce in cust_segs:
        nxt = next(((s, who) for s, who in starts if s > ce), None)
        if nxt and nxt[1] == "agent":
            gap = nxt[0] - ce
            if 0 < gap <= LATENCY_MAX_SEC:
                lats.append(gap)
    return lats


def _p90(vals: list[float]) -> float:
    ordered = sorted(vals)
    return ordered[min(len(ordered) - 1, math.ceil(0.9 * len(ordered)) - 1)]


def _word_count(words: list) -> int:
    # Synthetic word-groups carry a whole transcript in one entry; split them.
    return sum(len(text.split()) for text, _, _ in words)


def _build_metrics(seg_by_role: dict, words_by_role: dict,
                   duration: float, turn_count: int) -> dict:
    cust = seg_by_role.get("customer", [])
    agent = seg_by_role.get("agent", [])
    cust_talk = sum(e - s for s, e in cust)
    agent_talk = sum(e - s for s, e in agent)
    total_talk = cust_talk + agent_talk

    # Two-speaker metrics are only meaningful when the agent channel exists
    # AND carried speech — a mono file or a dead agent leg reports null, not a
    # fake 0 that would drag fleet averages in /api/review/stats toward zero.
    two_sided = "agent" in seg_by_role and bool(agent)

    lats = _agent_latencies(cust, agent)

    def wpm(role: str, talk: float):
        if talk <= 0:
            return None
        return round(_word_count(words_by_role.get(role, [])) / (talk / 60.0), 1)

    return {
        "agent_talk_sec": round(agent_talk, 2),
        "customer_talk_sec": round(cust_talk, 2),
        "talk_ratio_agent": round(agent_talk / total_talk, 3) if two_sided and total_talk > 0 else None,
        "silence_sec": round(max(0.0, duration - _union_sec(cust + agent)), 2),
        "overlap_sec": round(_intersection_sec(cust, agent), 2) if two_sided else None,
        "interruptions_by_agent": _interruptions(agent, cust) if two_sided else None,
        "interruptions_by_customer": _interruptions(cust, agent) if two_sided else None,
        "avg_agent_response_latency_sec": round(sum(lats) / len(lats), 2) if lats else None,
        "p90_agent_response_latency_sec": round(_p90(lats), 2) if lats else None,
        "turn_count": turn_count,
        "words_per_min_agent": wpm("agent", agent_talk),
        "words_per_min_customer": wpm("customer", cust_talk),
    }


# -------------------------------------------------------------------- STT ---

def _headers() -> dict:
    key = os.environ.get("SARVAM_API_KEY")
    if not key:
        raise RuntimeError("SARVAM_API_KEY is not set")
    return {"api-subscription-key": key}


def _build_chunks(segments: list) -> list[list[tuple[float, float]]]:
    """Group VAD segments into per-UTTERANCE STT chunks: segments separated by
    <= UTTER_GAP_SEC belong to the same utterance and are transcribed together;
    a gap larger than that starts a new chunk. This matters because Saaras v3's
    sync endpoint returns segment-level (not word-level) timestamps — one entry
    spanning the whole request — so the request boundaries ARE the diarization
    turn boundaries. Oversized single segments (rare in a phone call) are
    hard-split so no chunk ever exceeds the API limit."""
    pieces = []
    for s, e in segments:
        while e - s > CHUNK_SPAN_SEC:
            pieces.append((s, s + CHUNK_SPAN_SEC))
            s += CHUNK_SPAN_SEC
        pieces.append((s, e))
    chunks: list[list[tuple[float, float]]] = []
    for seg in pieces:
        if (chunks
                and seg[0] - chunks[-1][-1][1] <= UTTER_GAP_SEC
                and seg[1] - chunks[-1][0][0] <= CHUNK_SPAN_SEC):
            chunks[-1].append(seg)
        else:
            chunks.append([seg])
    return chunks


def _chunk_wav_bytes(samples: array, rate: int, start_sec: float, end_sec: float) -> bytes:
    """Mono 16-bit in-memory WAV of samples[start_sec:end_sec]."""
    lo = max(0, int(start_sec * rate))
    hi = min(len(samples), int(end_sec * rate))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(samples[lo:hi].tobytes())
    return buf.getvalue()


def _stt_chunk(client: httpx.Client, wav_bytes: bytes, filename: str) -> dict:
    resp = client.post(
        f"{SARVAM_BASE}/speech-to-text",
        headers=_headers(),
        files={"file": (filename, wav_bytes, "audio/wav")},
        data={"model": STT_MODEL, "mode": STT_MODE,
              "language_code": "unknown", "with_timestamps": "true"},
    )
    if resp.status_code != 200:
        raise RuntimeError(f"STT failed ({resp.status_code}): {resp.text[:300]}")
    return resp.json()


def _words_from_timestamps(ts) -> list[tuple[str, float, float]]:
    """Defensive parse of Saaras timestamps: either parallel lists
    {"words": [...], "start_time_seconds": [...], "end_time_seconds": [...]}
    or a list of per-word dicts. Returns (text, start, end) chunk-relative."""
    out = []
    if isinstance(ts, dict):
        for w, s, e in zip(ts.get("words") or [],
                           ts.get("start_time_seconds") or [],
                           ts.get("end_time_seconds") or []):
            try:
                out.append((str(w), float(s), float(e)))
            except (TypeError, ValueError):
                continue
    elif isinstance(ts, list):
        for item in ts:
            if not isinstance(item, dict):
                continue
            w = item.get("word") or item.get("text") or item.get("token")
            s = item.get("start_time_seconds", item.get("start_time", item.get("start")))
            e = item.get("end_time_seconds", item.get("end_time", item.get("end")))
            if w is None or s is None or e is None:
                continue
            try:
                out.append((str(w), float(s), float(e)))
            except (TypeError, ValueError):
                continue
    return out


def _transcribe_channel(client: httpx.Client, samples: array, rate: int,
                        duration: float, segments: list, stem: str,
                        ci: int) -> tuple[list, str | None]:
    """STT one channel's VAD chunks; returns absolute-time word tuples and
    per-language talk-time votes (a 2-second backchannel must not out-vote the
    main conversation when picking the call's language)."""
    words: list[tuple[str, float, float]] = []
    lang_votes: dict[str, float] = {}
    prev_cut = -1.0  # previous chunk's unpadded end — dedup guard at hard splits
    for k, chunk in enumerate(_build_chunks(segments)):
        vad_start, vad_end = chunk[0][0], chunk[-1][1]
        pad_start = max(0.0, vad_start - CHUNK_PAD_SEC)
        pad_end = min(duration, vad_end + CHUNK_PAD_SEC)
        resp = _stt_chunk(client, _chunk_wav_bytes(samples, rate, pad_start, pad_end),
                          f"{stem}.ch{ci}.{k}.wav")
        if resp.get("language_code"):
            lang_votes[resp["language_code"]] = (
                lang_votes.get(resp["language_code"], 0.0) + (vad_end - vad_start))
        chunk_words = _words_from_timestamps(resp.get("timestamps"))
        transcript = (resp.get("transcript") or "").strip()
        if chunk_words:
            # Word times are relative to the padded chunk audio we sent. When a
            # long VAD segment was hard-split, the pads of adjacent chunks
            # overlap — drop words already covered by the previous chunk.
            words.extend((t, pad_start + s, pad_start + e)
                         for t, s, e in chunk_words if pad_start + s >= prev_cut)
        elif transcript:
            # No usable timestamps: one synthetic word-group over the VAD extent.
            words.append((transcript, vad_start, vad_end))
        prev_cut = vad_end
    words.sort(key=lambda w: w[1])
    return words, lang_votes


def _utterances(words: list, speaker: str) -> list[dict]:
    """Group a channel's words into utterances at gaps > 0.8 s."""
    utts: list[dict] = []
    for text, s, e in words:
        if utts and s - utts[-1]["end"] <= UTTER_GAP_SEC:
            utts[-1]["end"] = max(utts[-1]["end"], e)
            utts[-1]["text"] += " " + text
        else:
            utts.append({"speaker": speaker, "start": s, "end": e, "text": text})
    return utts


# -------------------------------------------------------------- auto-eval ---

def _mmss(t: float) -> str:
    t = max(0.0, t)
    return f"{int(t // 60):02d}:{int(t % 60):02d}"


_EVAL_KEYS = {"summary", "outcome", "sentiment_customer", "scores", "flags", "highlights"}


def _extract_json(raw: str) -> dict | None:
    """Lenient JSON extraction: strip fences, then scan EVERY '{' for a
    balanced object (string-aware, so braces inside values don't break the
    depth count). A candidate must parse to a dict carrying at least one
    expected grade key; the last such candidate wins, so a stray brace or a
    partial leading snippet in the model's preamble can't shadow the verdict."""
    text = (raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    best, i, n = None, 0, len(text)
    while True:
        start = text.find("{", i)
        if start == -1:
            return best
        depth, in_str, esc, end = 0, False, False, None
        for j in range(start, n):
            ch = text[j]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = j
                    break
        if end is None:  # unbalanced tail — retry from inside it
            i = start + 1
            continue
        try:
            obj = json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            i = start + 1  # prose brace: rescan from the next '{' inside
            continue
        if isinstance(obj, dict) and _EVAL_KEYS & obj.keys():
            best = obj
        i = end + 1  # skip the parsed object's interior (prefer outermost)


AUTO_EVAL_SYSTEM = (
    "You are an expert QA analyst for Hindi/Hinglish debt-collection (vasooli) "
    "voice-agent phone calls. You review a diarized transcript plus acoustic "
    "metrics and grade the AGENT's performance strictly and consistently. "
    "You reply with a single JSON object and nothing else."
)

AUTO_EVAL_RUBRIC = (
    "Rubric (each score is an integer 1-5):\n"
    "- naturalness: human-like conversational flow, no robotic repetition.\n"
    "- task_completion: did the agent pursue the collection goal — identify "
    "the customer, remind them of the dues, and drive toward a commitment.\n"
    "- compliance: polite and professional; no threats, harassment, or "
    "abusive pressure; identifies itself; respectful language throughout.\n"
    "- language_quality: grammar, apparent pronunciation/transcription "
    "errors, and appropriateness of the Hindi/English code-mix."
)


def _llm_auto_eval(client: httpx.Client, turns: list, metrics: dict,
                   language: str, duration: float, model: str) -> dict:
    """One Sarvam-30B grading pass; raises on failure (caller degrades)."""
    lines = "\n".join(
        f"[{_mmss(t['start'])}] {t['speaker']}: {t['text']}" for t in turns)
    user = (
        f"Recorded call, duration {duration:.1f}s, detected language {language}.\n\n"
        f"Diarized transcript ([mm:ss] speaker: text):\n{lines}\n\n"
        f"Acoustic metrics (computed from the audio — trust these):\n"
        f"{json.dumps(metrics, ensure_ascii=False)}\n\n"
        "Return ONLY a JSON object with exactly these keys:\n"
        '  "summary": 2-3 sentences in English describing what happened,\n'
        '  "outcome": one of "resolved" | "promise_to_pay" | "callback" | '
        '"refused" | "incomplete" | "unknown",\n'
        '  "sentiment_customer": "positive" | "neutral" | "negative",\n'
        '  "scores": {"naturalness": 1-5, "task_completion": 1-5, '
        '"compliance": 1-5, "language_quality": 1-5},\n'
        '  "flags": [short problem strings, e.g. "threatening_language", '
        '"robotic_repetition"; empty list if none],\n'
        '  "highlights": [{"turn": <0-based transcript line index>, '
        '"note": <short note>}, ...] for notable moments.\n\n'
        f"{AUTO_EVAL_RUBRIC}\n\n"
        "[Reply with ONLY the JSON object — no other text.]"
    )
    messages = [{"role": "system", "content": AUTO_EVAL_SYSTEM},
                {"role": "user", "content": user}]

    # Sarvam-30B is a reasoning model: max_tokens covers thinking + answer,
    # and content comes back None/truncated when thinking eats the budget —
    # measured ~1500 thinking tokens on a real eval prompt, so anything under
    # 4096 (the tier cap) risks starving the answer. Fall back to Sarvam-105B,
    # which reasons far more economically (~900 total on the same prompt).
    fallback = "sarvam-105b" if model != "sarvam-105b" else model
    content = None
    for try_model, temperature in ((model, 0.2), (fallback, 0.6)):
        resp = client.post(
            f"{SARVAM_BASE}/v1/chat/completions",
            headers=_headers(),
            json={
                "model": try_model,
                "messages": messages,
                "reasoning_effort": "low",
                "temperature": temperature,
                "top_p": 0.95,
                "max_tokens": 4096,
            },
        )
        if resp.status_code != 200:
            raise RuntimeError(f"LLM failed ({resp.status_code}): {resp.text[:300]}")
        choice = resp.json()["choices"][0]
        got = (choice.get("message") or {}).get("content")
        if got and choice.get("finish_reason") == "stop":
            content = got
            break
        content = got or content  # truncated beats nothing
    if not content:
        raise RuntimeError("LLM produced no content (reasoning exhausted budget twice)")

    obj = _extract_json(content)
    if obj is None:
        raise RuntimeError(f"LLM reply was not parseable JSON: {content[:200]}")
    return _validate_auto_eval(obj, len(turns))


def _validate_auto_eval(obj: dict, n_turns: int) -> dict:
    outcome = obj.get("outcome")
    sentiment = obj.get("sentiment_customer")
    scores = {}
    raw_scores = obj.get("scores") or {}
    if isinstance(raw_scores, dict):
        for dim in SCORE_DIMS:
            v = raw_scores.get(dim)
            try:
                scores[dim] = max(1, min(5, int(round(float(v)))))
            except (TypeError, ValueError):
                continue
    flags = [str(f) for f in (obj.get("flags") or [])
             if isinstance(f, (str, int, float))] if isinstance(obj.get("flags"), list) else []
    highlights = []
    if isinstance(obj.get("highlights"), list):
        for h in obj["highlights"]:
            if not isinstance(h, dict):
                continue
            try:
                idx = int(h.get("turn"))
            except (TypeError, ValueError):
                continue
            if 0 <= idx < n_turns:
                highlights.append({"turn": idx, "note": str(h.get("note") or "")})
    return {
        "summary": str(obj.get("summary") or "").strip() or "No summary provided.",
        "outcome": outcome if outcome in OUTCOMES else "unknown",
        "sentiment_customer": sentiment if sentiment in SENTIMENTS else "neutral",
        "scores": scores,
        "flags": flags,
        "highlights": highlights,
    }


def _auto_eval_stub(reason: str, flags: list[str]) -> dict:
    return {"summary": reason, "outcome": "unknown", "sentiment_customer": "neutral",
            "scores": {}, "flags": flags, "highlights": []}


# ------------------------------------------------------------------ cache ---

def get_analysis(filename: str) -> dict | None:
    """Cache read only — no validation side effects, no API calls."""
    stem = Path(Path(filename).name).stem
    path = ANALYSIS_DIR / f"{stem}.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def _write_cache(stem: str, doc: dict) -> None:
    """Atomic write: unique tmp file in the same dir + os.replace, so two
    concurrent analyses of the same recording can't clobber each other."""
    target = ANALYSIS_DIR / f"{stem}.json"
    tmp = ANALYSIS_DIR / f".{stem}.{os.getpid()}.{uuid.uuid4().hex[:8]}.json.tmp"
    try:
        tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2))
        os.replace(tmp, target)
    finally:
        tmp.unlink(missing_ok=True)


# ------------------------------------------------------------ entry point ---

def analyze_call(filename: str, force: bool = False, swap_channels: bool = False) -> dict:
    """Full analysis of one recording; cached unless force or the requested
    channel orientation differs from what was cached. Blocking."""
    path = _validate(filename)

    if wav_info(path)["channels"] == 1:
        roles = ["customer"]
    else:
        roles = ["agent", "customer"] if swap_channels else ["customer", "agent"]

    if not force:
        cached = get_analysis(filename)
        if cached and cached.get("channel_roles") == roles:
            return cached

    if not os.environ.get("SARVAM_API_KEY"):
        raise RuntimeError("SARVAM_API_KEY is not set")

    channels, rate = _read_channels(path)
    duration = len(channels[0]) / rate if rate and channels[0] else 0.0
    recorded_at, call_sid, recording_sid = _parse_meta(path)
    llm_model = os.environ.get("SARVAM_LLM_MODEL", "sarvam-30b")

    seg_by_role: dict[str, list] = {}
    words_by_role: dict[str, list] = {}
    lang_votes: dict[str, float] = {}
    with httpx.Client(timeout=120.0) as client:
        for ci, samples in enumerate(channels):
            role = roles[ci]
            segs = _vad_segments(samples, rate)
            seg_by_role[role] = segs
            if not segs:  # skip STT for silent channels
                words_by_role[role] = []
                continue
            words, votes = _transcribe_channel(client, samples, rate, duration,
                                               segs, path.stem, ci)
            words_by_role[role] = words
            for code, sec in votes.items():
                lang_votes[code] = lang_votes.get(code, 0.0) + sec
        # The call's language = the one that carried the most talk-time.
        language = max(lang_votes, key=lang_votes.get) if lang_votes else None

        turns = sorted(
            (u for role in roles for u in _utterances(words_by_role[role], role)),
            key=lambda u: (u["start"], u["end"]))
        turns = [{"speaker": u["speaker"], "start": round(u["start"], 2),
                  "end": round(u["end"], 2), "text": u["text"].strip()}
                 for u in turns]

        metrics = _build_metrics(seg_by_role, words_by_role, duration, len(turns))

        if turns:
            try:
                auto_eval = _llm_auto_eval(client, turns, metrics,
                                           language or "unknown", duration, llm_model)
            except Exception as err:  # hard metrics must survive LLM failures
                auto_eval = _auto_eval_stub(
                    f"Auto-evaluation unavailable: {str(err)[:200]}",
                    ["auto_eval_failed"])
        else:
            # Nothing was said — grading a silent call would waste an LLM call.
            auto_eval = _auto_eval_stub("No speech detected in this recording.",
                                        ["no_speech"])

    doc = {
        "version": 1,
        "file": path.name,
        "call_sid": call_sid,
        "recording_sid": recording_sid,
        "recorded_at": recorded_at.isoformat(timespec="seconds"),
        "duration_sec": round(duration, 2),
        "language": language or "unknown",
        "channel_roles": roles,
        "turns": turns,
        "metrics": metrics,
        "auto_eval": auto_eval,
        "analyzed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "stt_mode": STT_MODE,
        "llm_model": llm_model,
    }
    _write_cache(path.stem, doc)
    return doc
