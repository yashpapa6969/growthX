// Sarvam clients — OWNER: Engineer 1.
// Endpoints/headers verified against docs.sarvam.ai (2026-07-26):
//   STT : POST https://api.sarvam.ai/speech-to-text        model "saaras:v3", mode "codemix", multipart
//   TTS : POST https://api.sarvam.ai/text-to-speech        model "bulbul:v3"
//   Chat: POST https://api.sarvam.ai/v1/chat/completions   OpenAI-compatible, model "sarvam-30b" | "sarvam-105b"
//   Header on all: `api-subscription-key: <SARVAM_API_KEY>`
//
// >>> M0 TASK: confirm the exact request field names + response shape for STT/TTS on
//     the event account, then delete the "CONFIRM AT M0" comments. <<<
//
// VOICE_MOCK_MODE=1 -> every function returns canned data so the whole app runs
// end-to-end with NO Sarvam key. Flip to 0 the moment M0's round-trip passes.

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
  opts: { languageCode?: string; mode?: "transcribe" | "codemix" | "translate" } = {}
): Promise<string> {
  if (MOCK) return "[mock] haan bhaiya, salary aane do — Monday tak pakka de dunga";

  const bytes = Buffer.from(audioB64, "base64");
  const form = new FormData();
  // CONFIRM AT M0: field name "file", and that webm/opus is accepted (else transcode to wav 16k).
  form.append("file", new Blob([bytes], { type: "audio/webm" }), "turn.webm");
  form.append("model", "saaras:v3");
  form.append("mode", opts.mode ?? "codemix");
  if (opts.languageCode) form.append("language_code", opts.languageCode);

  const res = await fetch(`${BASE}/speech-to-text`, { method: "POST", headers: headers(), body: form });
  if (!res.ok) throw new Error(`Saaras STT ${res.status}: ${await res.text()}`);
  const data = await res.json();
  // CONFIRM AT M0: response key — docs show `transcript`.
  return data.transcript ?? data.text ?? "";
}

/** Chat / reasoning / negotiation + intent extraction. Returns raw assistant text. */
export async function chat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  opts: { model?: "sarvam-30b" | "sarvam-105b"; temperature?: number } = {}
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
      messages,
    }),
  });
  if (!res.ok) throw new Error(`Sarvam chat ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

/** Text -> speech. Tone maps to pace/pitch so the escalation ladder is audible (Voice score). */
export async function tts(
  text: string,
  opts: { languageCode?: string; speaker?: string; tone?: Tone } = {}
): Promise<string | null> {
  if (MOCK) return null; // client plays nothing / uses a beep in mock mode

  const paceByTone: Record<Tone, number> = { warm: 1.0, neutral: 1.0, firm: 0.92 };
  const pitchByTone: Record<Tone, number> = { warm: 0.05, neutral: 0.0, firm: -0.05 };
  const tone = opts.tone ?? "neutral";

  const res = await fetch(`${BASE}/text-to-speech`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({
      // CONFIRM AT M0: field names — docs use target_language_code / speaker / model.
      text,
      target_language_code: opts.languageCode ?? "hi-IN",
      speaker: opts.speaker ?? "anushka", // pick a real bulbul:v3 voice from /text-to-speech/voices
      model: "bulbul:v3",
      pace: paceByTone[tone],
      pitch: pitchByTone[tone],
      speech_sample_rate: 22050,
    }),
  });
  if (!res.ok) throw new Error(`Bulbul TTS ${res.status}: ${await res.text()}`);
  const data = await res.json();
  // CONFIRM AT M0: response key — docs return base64 audio in `audios[0]`.
  return data.audios?.[0] ?? null;
}
