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

// LEAN prompt — sarvam-30b reasoning scales with prompt size, so keep this tight (long
// prompts => 10-20s + truncated empty content). Compact context beats a big JSON dump.
function compactCtx(ctx: TurnContext): string {
  const c = ctx.customer;
  const dues = (ctx.dues ?? []).map((d) => `${d.id}: ₹${d.balance} of ₹${d.amount} (${d.status})`).join("; ") || "none";
  const proms = (ctx.promises ?? []).map((p) => `${p.source} ${String(p.promisedDate).slice(0, 10)}${p.kept ? "" : " BROKEN"}`).join("; ") || "none";
  const cat = (ctx.catalogue ?? []).map((p) => `${p.name} ₹${p.price}`).join(", ");
  const lines = [
    `Customer: ${c.name} (${c.language})${c.historySummary ? " — " + c.historySummary : ""}`,
    `Open dues [id: bal of total]: ${dues}`,
    `Promises: ${proms}`,
  ];
  if (cat) lines.push(`Catalogue (use these EXACT prices, never invent): ${cat}`);
  return lines.join("\n");
}

function systemPrompt(ctx: TurnContext): string {
  const broken = (ctx.promises ?? []).filter((p) => !p.kept).length;
  const role = {
    order: "You are taking an order at the counter. Read the item(s) + exact price back and ask to confirm; emit place_on_khata only AFTER they say haan.",
    nudge: "You are sending a short WhatsApp reminder. Cite the exact due; steer to a concrete dated promise (record_promise).",
    call: "You are on a live collection call. Open by citing the SPECIFIC broken promise, then one clear ask; get payment (send_payment_link) or a concrete dated promise (record_promise).",
  }[ctx.role] ?? "";
  return `You are the AI relationship manager for Sharma Kirana Store — one agent who took the order, sent reminders, and now calls. ${role}
Speak ONE or TWO short sentences in natural Hindi/Hinglish, NEVER plain English. Say amounts/dates naturally, never ISO.
CONTEXT below is the khata and the ONLY source of truth — never invent an amount, date, item, or payment.
Rules: no discounts/waivers (escalate instead); min partial = 30% of balance or ₹200, else take a dated promise within 7 days; for "maine pay kar diya" use acknowledge_partial to check first; on hardship/hostility close warmly + escalate. Tone: ${toneBand(ctx)} (${broken} broken promises). TODAY: ${String(ctx.simDate).slice(0, 10)}.
${ctx.personaPrompt ? "\n" + ctx.personaPrompt + "\n" : ""}
${compactCtx(ctx)}

Reply ONLY as JSON (a plain \`\`\`json fenced block is fine): {"say":"<short Hindi line>","tone":"warm|neutral|firm","intents":[...]}
Intents (ONLY when the action truly happens, else []): add_to_cart{item,qty} | place_on_khata{items:[{item,qty}],total_inr} | record_promise{due_id,promised_date:"YYYY-MM-DD",verbatim} | send_payment_link{due_id,amount_inr} | acknowledge_partial{due_id,amount_inr,paid_on} | escalate{reason,summary}`;
}

function parseAgent(raw: string): { say: string; tone: Tone; intents: Intent[] } {
  const stripped = String(raw ?? "").replace(/```json/gi, "").replace(/```/g, "").trim();
  // Preferred path: the model returned the JSON contract.
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try {
      const j = JSON.parse(stripped.slice(first, last + 1));
      const say = String(j.say ?? j.reply ?? j.text ?? "").trim();
      if (say) {
        const intents = Array.isArray(j.intents) ? j.intents.filter((i: any) => i && i.type) : [];
        return { say, tone: (j.tone ?? "neutral") as Tone, intents };
      }
    } catch {
      // fall through to prose salvage
    }
  }
  // Fast general models often reply in plain prose (esp. for nudges) instead of the JSON
  // contract. Speak that prose directly rather than dropping to a stock "Ji, bataiye?" line.
  let prose = stripped;
  if (prose.startsWith("{")) {
    const m = prose.match(/"say"\s*:\s*"([^"]+)"/); // salvage say from broken JSON
    prose = m ? m[1] : "";
  }
  return { say: prose.slice(0, 500), tone: "neutral", intents: [] };
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
    ], { model: "sarvam-30b", maxTokens: 4000 }); // must clear the model's hidden reasoning or content truncates to empty; ~7-10s with real context
    const tLLM = Date.now();

    const { say, tone, intents } = parseAgent(raw);
    const safeSay = say || "Ji, bataiye?";
    const agentAudioB64 = role === "nudge" || body.skipTts ? null : await tts(safeSay, { languageCode: context.customer.language, tone });
    const tTTS = Date.now();

    const res: VoiceTurnResponse = { transcript, agentText: safeSay, agentAudioB64, tone, intents };
    return NextResponse.json(res, {
      headers: { "x-latency-stt": String(tSTT - t0), "x-latency-llm": String(tLLM - tSTT), "x-latency-tts": String(tTTS - tLLM), "x-latency-total": String(tTTS - t0) },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "voice turn failed" }, { status: 500 });
  }
}
