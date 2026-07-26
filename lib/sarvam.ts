// Sarvam clients — OWNER: Engineer 1.
// VERIFIED live against the event key (2026-07-26) — request + response shapes below are real:
//   STT : POST /speech-to-text   multipart file + model "saaras:v3" + mode "codemix" -> { transcript }
//   TTS : POST /text-to-speech   { text, target_language_code, speaker, model:"bulbul:v3" } -> { audios:[b64 wav] }
//   Chat: POST /v1/chat/completions  OpenAI-compatible, model "sarvam-30b" -> choices[0].message.content
//   Header on all: `api-subscription-key: <SARVAM_API_KEY>`
//   Valid bulbul:v3 speakers: aditya ritu ashutosh priya neha rahul pooja rohan simran kavya
//     amit dev ishita shreya varun manan roopa kabir tanya tarun ... (NOT "anushka").
//
// VOICE_MOCK_MODE=1 -> every function returns canned data so the app runs with NO key.
// Set to 0 to use the real API (verified working).

import type { Tone } from "./types";

const BASE = "https://api.sarvam.ai";
const KEY = process.env.SARVAM_API_KEY ?? "";
const MOCK = process.env.VOICE_MOCK_MODE !== "0";

function headers(json = false): Record<string, string> {
  const h: Record<string, string> = { "api-subscription-key": KEY };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

/** Speech -> text. mode "codemix" keeps Hindi+English as spoken (best for the excuse/negotiation). */
export async function transcribe(
  audioB64: string,
  opts: { languageCode?: string; mode?: "transcribe" | "codemix" | "translate"; mime?: string } = {}
): Promise<string> {
  if (MOCK) return "[mock] haan bhaiya, salary aane do — Monday tak pakka de dunga";

  const bytes = Buffer.from(audioB64, "base64");
  const form = new FormData();
  // NOTE: verified with wav. The browser's MediaRecorder sends webm/opus — if Saaras rejects it
  // live, transcode to wav 16k first (AssistantPanel can request wav, or transcode server-side).
  const mime = opts.mime ?? "audio/wav";
  const ext = mime.includes("webm") ? "webm" : mime.includes("mp4") ? "mp4" : "wav";
  form.append("file", new Blob([bytes], { type: mime }), `turn.${ext}`);
  form.append("model", "saaras:v3");
  form.append("mode", opts.mode ?? "codemix");
  if (opts.languageCode) form.append("language_code", opts.languageCode);

  const res = await fetch(`${BASE}/speech-to-text`, { method: "POST", headers: headers(), body: form });
  if (!res.ok) throw new Error(`Saaras STT ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.transcript ?? data.text ?? "";
}

/** Chat / reasoning / negotiation + intent extraction. Returns raw assistant text. */
export async function chat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  opts: { model?: "sarvam-30b" | "sarvam-105b"; temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  if (MOCK) {
    return JSON.stringify({
      reply: "[mock] Rahul ji, aapne pichhli baar Monday bola tha. ₹1,850 pending hai — abhi UPI link bhej doon?",
      tone: "firm",
      intents: [{ type: "send_payment_link", payload: { amount: 1850 } }],
    });
  }

  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({
      model: opts.model ?? "sarvam-30b",
      temperature: opts.temperature ?? 0.4,
      // sarvam-30b is a reasoning model: force JSON into `content` and give enough token
      // budget that reasoning doesn't starve the reply (empty content -> downstream TTS 400).
      response_format: { type: "json_object" },
      max_tokens: opts.maxTokens ?? 1200,
      messages,
    }),
  });
  if (!res.ok) throw new Error(`Sarvam chat ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const msg = data.choices?.[0]?.message ?? {};
  return msg.content || msg.reasoning_content || "";
}

/** Text -> speech. Tone maps to pace/pitch so the escalation ladder is audible (Voice score). */
export async function tts(
  text: string,
  opts: { languageCode?: string; speaker?: string; tone?: Tone } = {}
): Promise<string | null> {
  if (MOCK) return null; // client plays nothing / uses a beep in mock mode
  if (!text || !text.trim()) return null; // never send empty text (Bulbul 400s)

  // Bulbul V3 supports `pace` but NOT `pitch`/`loudness` (verified 2026-07-26 — they 400).
  // The tone ladder rides on pace + speaker choice.
  const paceByTone: Record<Tone, number> = { warm: 1.0, neutral: 1.0, firm: 0.9 };
  const tone = opts.tone ?? "neutral";

  const res = await fetch(`${BASE}/text-to-speech`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({
      text,
      target_language_code: opts.languageCode ?? "hi-IN",
      speaker: opts.speaker ?? "priya", // verified bulbul:v3 voice (warm). See list at top of file.
      model: "bulbul:v3",
      pace: paceByTone[tone],
      speech_sample_rate: 22050,
    }),
  });
  if (!res.ok) throw new Error(`Bulbul TTS ${res.status}: ${await res.text()}`);
  const data = await res.json();
  // CONFIRM AT M0: response key — docs return base64 audio in `audios[0]`.
  return data.audios?.[0] ?? null;
}
