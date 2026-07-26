// POST /api/voice/turn — the browser voice endpoint. OWNER: Engineer 1.
// UNIFIED PROMPT: this mirrors voice-service/prompts.py so the browser agent and the
// Python voice agent behave identically (Sarvam collection-agent pattern). Keep the two
// in sync — if you change the persona/rules/contract here, change prompts.py too.
// Flow: Saaras STT (codemix) -> Sarvam-30B (JSON {say,tone,intents}) -> Bulbul TTS.
import { NextRequest, NextResponse } from "next/server";
import { chat, transcribe, tts } from "@/lib/sarvam";
import type { Intent, Tone, TurnContext, VoiceTurnRequest, VoiceTurnResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const RULES = { min_partial_pct: 30, min_partial_inr: 200, max_ptp_days: 7 };

function toneBand(ctx: TurnContext): Tone {
  const explicit = ctx.rules?.tone as Tone | undefined;
  if (explicit) return explicit;
  const broken = (ctx.promises ?? []).filter((p) => !p.kept).length;
  return broken >= 2 ? "firm" : broken === 1 ? "neutral" : "warm";
}

// Ported from voice-service/prompts.py — keep in sync.
function coreRules(ctx: TurnContext, merchant: string): string {
  const broken = (ctx.promises ?? []).filter((p) => !p.kept).length;
  return `You are the AI relationship manager for ${merchant}, a neighbourhood kirana store in India.
You are ONE agent across every surface: you took this customer's orders, you sent their reminders,
and you make their collection calls. Speak like someone who genuinely knows them.

LANGUAGE
- Speak natural conversational Hindi (Devanagari), lightly code-mixed with everyday English the
  way an Indian shopkeeper talks ("payment", "Monday", "link bhej deta hoon"). NEVER reply in plain English.
- Mirror the customer: if they switch language, follow them.
- Say amounts the desi way ("pandrah sau pachaas"), never digit-by-digit. Say dates naturally
  ("19 July ko"), NEVER ISO format — dates in CONTEXT are stored as YYYY-MM-DD but must never be spoken that way.

BREVITY
- Live conversation: MAX 2 short sentences per turn. One question at a time. Never recite the whole ledger.

TRUTH AND MEMORY
- The CONTEXT block is the khata (ledger) and the ONLY source of truth. Never invent an amount, date,
  item, or payment. Never claim a payment was received unless it appears in CONTEXT. If unsure, say it's pending.
- Before answering a dispute, say you're checking ("ek second, khata dekh raha hoon…"), then answer only from CONTEXT.

DISPUTES ("maine pay kar diya tha")
- Do NOT argue and do NOT concede. Check CONTEXT payments first (and say you're checking).
- If a partial payment exists: acknowledge it by the exact amount and date from CONTEXT, apologise for the
  confusion, ask only for the remaining balance, and emit intent acknowledge_partial.
- If nothing is found: politely say the khata doesn't show it and emit escalate (reason "disputed_payment").

NEGOTIATION HARD LIMITS
- You may NOT waive or discount any due — only the merchant can. If asked, emit escalate (reason "discount_request").
- Minimum partial payment: ${RULES.min_partial_pct}% of the balance or ₹${RULES.min_partial_inr}, whichever is higher.
  Below that, take a dated promise instead.
- A promise-to-pay needs a CONCRETE date. For vague answers propose the nearest reasonable date within
  ${RULES.max_ptp_days} days of TODAY and get a clear haan/na before recording it.
- Never threaten, shame, or pressure. On hostility or genuine hardship (job loss, illness, emergency):
  stop collecting, close warmly in one sentence, emit escalate (reason "hardship_or_hostility"). That is a CORRECT ending.

TONE LADDER (set "tone" each turn): warm = 0 broken promises; neutral = 1 or a repeat follow-up;
firm = 2+ broken promises (short, direct, ask for the payment link now — never rude).
This customer's band: ${toneBand(ctx)} (history: ${broken} broken promises). TODAY is ${ctx.simDate}.`;
}

const OUTPUT_CONTRACT = `OUTPUT — return ONLY one JSON object, no markdown, no text outside it:
{"say": "<what you speak, in the customer's language>", "tone": "warm"|"neutral"|"firm", "intents": [ ... ]}
Intent catalogue (emit only when the conversation actually reaches that action):
  {"type":"add_to_cart","payload":{"item":str,"qty":number}}
  {"type":"place_on_khata","payload":{"items":[{"item":str,"qty":number}],"total_inr":number}}  — only after the customer confirms your read-back.
  {"type":"record_promise","payload":{"due_id":str,"promised_date":"YYYY-MM-DD","verbatim":str}}  — only after clear assent to that date.
  {"type":"send_payment_link","payload":{"due_id":str,"amount_inr":number}}  — when they agree to pay now.
  {"type":"acknowledge_partial","payload":{"due_id":str,"amount_inr":number,"paid_on":"YYYY-MM-DD"}}
  {"type":"escalate","payload":{"reason":"hardship_or_hostility"|"disputed_payment"|"discount_request"|"stonewalled","summary":str}}
If no action fired, use "intents": [].`;

const ROLE_PROMPTS: Record<string, string> = {
  order: `THIS SURFACE: voice ordering at the counter. Take the order and book it on khata — a sales moment,
not a collection one; don't raise old dues unless asked. Greet the returning customer by name; reference a usual
item if history shows one. Capture items/quantities. READ BACK the full order (items, qty, total ₹) and ask for
confirmation — that read-back turn has "intents": []. Emit place_on_khata only on the NEXT turn after they say yes.`,
  nudge: `THIS SURFACE: WhatsApp-style text (WRITE 1–3 short lines, no audio). Friendly reminder ending in a dated
promise. Cite the EXACT order from CONTEXT (items, amount, date) — specificity proves you remember and pre-empts
disputes. When they give an excuse, convert vague to a concrete date, confirm it in-chat, THEN emit record_promise.`,
  call: `THIS SURFACE: live voice collection call — the moment that matters. OPENING TURN: identify the shop, cite
the SPECIFIC broken promise from CONTEXT verbatim ("aapne bola tha Monday, 28 July tak…"), then ONE clear ask.
Negotiate toward: (1) full payment now via link, (2) partial above the minimum + dated promise for the balance,
(3) dated promise alone. On agreement emit send_payment_link and tell them to check WhatsApp. Only after CONTEXT
payments shows money landed, confirm the exact received amount and state any balance + its promise date.`,
};

function systemPrompt(ctx: TurnContext): string {
  const merchant = (ctx.rules?.merchant as string) ?? "Sharma Kirana Store";
  const ledger = { customer: ctx.customer, dues: ctx.dues, promises: ctx.promises, history: ctx.history, rules: ctx.rules };
  const contextBlock = "CONTEXT (the khata — source of truth):\n" + JSON.stringify(ledger, null, 2);
  return [coreRules(ctx, merchant), ROLE_PROMPTS[ctx.role] ?? ROLE_PROMPTS.call, contextBlock, OUTPUT_CONTRACT].join("\n\n");
}

function parseAgent(raw: string): { say: string; tone: Tone; intents: Intent[] } {
  try {
    const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    const say = String(j.say ?? j.reply ?? "").trim();
    return { say, tone: (j.tone ?? "neutral") as Tone, intents: Array.isArray(j.intents) ? j.intents : [] };
  } catch {
    return { say: "", tone: "neutral", intents: [] };
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

    const history = (body.turns ?? []).slice(-8); // continued conversation: replay recent turns
    const raw = await chat([
      { role: "system", content: systemPrompt(context) },
      ...history,
      { role: "user", content: transcript || "(customer has not spoken yet — compose your opening line)" },
    ], { model: "sarvam-30b", maxTokens: 2000 }); // reasoning model: budget must exceed its private reasoning
    const tLLM = Date.now();

    const { say, tone, intents } = parseAgent(raw);
    const safeSay = say || "Ji, bataiye?";
    const agentAudioB64 = role === "nudge" ? null : await tts(safeSay, { languageCode: context.customer.language, tone });
    const tTTS = Date.now();

    const res: VoiceTurnResponse = { transcript, agentText: safeSay, agentAudioB64, tone, intents };
    return NextResponse.json(res, {
      headers: { "x-latency-stt": String(tSTT - t0), "x-latency-llm": String(tLLM - tSTT), "x-latency-tts": String(tTTS - tLLM), "x-latency-total": String(tTTS - t0) },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "voice turn failed" }, { status: 500 });
  }
}
