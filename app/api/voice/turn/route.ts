// POST /api/voice/turn  — the ONE voice endpoint. OWNER: Engineer 1.
// Stateless: receives audio + context, returns transcript + agent speech + intents.
// Flow: Saaras STT (codemix) -> Sarvam chat (context+rules -> JSON) -> Bulbul TTS.
import { NextRequest, NextResponse } from "next/server";
import { chat, transcribe, tts } from "@/lib/sarvam";
import type { Intent, Tone, TurnContext, VoiceTurnRequest, VoiceTurnResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function systemPrompt(ctx: TurnContext): string {
  const dues = (ctx.dues ?? []).map((d) => `due ${d.id}: ₹${d.balance} of ₹${d.amount} (${d.status})`).join("; ");
  const promises = (ctx.promises ?? []).map((p) => `${p.source} promised ${p.promisedDate}${p.kept ? " (kept)" : " (BROKEN)"}`).join("; ");
  const tone = (ctx.rules?.tone as string) ?? "neutral";

  const role = {
    order: "You are the kirana's ordering assistant. Take the order in Hindi, confirm items, and place it ON KHATA (credit).",
    nudge: "You are the same relationship manager, now sending a short, warm reminder about an overdue khata amount. Cite the exact order and amount.",
    call: "You are the same relationship manager, now on a collection (vasooli) call. Open by referencing the relationship and the specific broken promise — NEVER threaten. Negotiate a payment or a concrete new date.",
  }[ctx.role];

  return [
    role,
    `Customer: ${ctx.customer.name} (${ctx.customer.language}). History: ${ctx.customer.historySummary ?? "n/a"}.`,
    dues && `Open dues: ${dues}.`,
    promises && `Promises: ${promises}.`,
    `Business rules: no waivers; minimum acceptable payment is 30% of balance; escalate on hostility or hardship; current tone target = ${tone}.`,
    ctx.personaPrompt && `Persona/playbook: ${ctx.personaPrompt}`, // M-Stretch-1
    `If the customer claims they already paid, DO NOT argue — the ledger above is the source of truth; acknowledge any partial by amount and chase only the balance.`,
    `Speak in the customer's language (${ctx.customer.language}) — natural Hindi/Hinglish, not English. Keep "reply" to ONE or TWO short spoken sentences (max ~40 words). Never include your reasoning.`,
    `Reply ONLY with JSON: {"reply": "<short spoken line in the customer's language>", "tone": "warm|neutral|firm", "intents": [{"type": "...", "payload": {...}}]}.`,
    `Valid intent types: add_to_cart, place_on_khata, record_promise, send_payment_link, acknowledge_partial, escalate, none.`,
  ].filter(Boolean).join("\n");
}

function parseAgentJSON(raw: string): { reply: string; tone: Tone; intents: Intent[] } {
  try {
    const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    return { reply: String(j.reply ?? ""), tone: (j.tone ?? "neutral") as Tone, intents: Array.isArray(j.intents) ? j.intents : [] };
  } catch {
    // Model didn't return clean JSON — fall back to speaking the raw text, no intents.
    return { reply: raw, tone: "neutral", intents: [] };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as VoiceTurnRequest;
    const { audioB64, mime, text, role, context } = body;
    if (!role || !context) return NextResponse.json({ error: "role and context are required" }, { status: 400 });

    const t0 = Date.now();
    const transcript = text ?? (audioB64 ? await transcribe(audioB64, { mode: "codemix", languageCode: context.customer.language, mime }) : "");
    const tSTT = Date.now();

    const raw = await chat([
      { role: "system", content: systemPrompt(context) },
      { role: "user", content: transcript },
    ], { model: "sarvam-30b" });
    const tLLM = Date.now();

    const { reply, tone, intents } = parseAgentJSON(raw);
    const safeReply = reply?.trim() || "Ek minute, main aapka hisaab dekh raha hoon.";
    const agentAudioB64 = await tts(safeReply, { languageCode: context.customer.language, tone });
    const tTTS = Date.now();

    // Per-hop latency lands in response headers so the UI can show p50/p95 on stage (Voice evidence).
    const res: VoiceTurnResponse = { transcript, agentText: safeReply, agentAudioB64, tone, intents };
    return NextResponse.json(res, {
      headers: { "x-latency-stt": String(tSTT - t0), "x-latency-llm": String(tLLM - tSTT), "x-latency-tts": String(tTTS - tLLM), "x-latency-total": String(tTTS - t0) },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "voice turn failed" }, { status: 500 });
  }
}
