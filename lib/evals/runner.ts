// Eval runner — drives one scripted case through the REAL agent (Saaras/Gemini/Bulbul
// pipeline via /api/voice/turn, TTS skipped) then an LLM judge classifies the actual
// disposition + flags and compares to the case's ground truth. Optionally pins a persona
// so the same suite yields a per-persona pass rate (objective harness scoring).

import { chat } from "../sarvam";
import { buildTurnContext } from "../memory";
import { prisma } from "../db";
import { EVAL_CASES, DISPOSITIONS, type EvalCase } from "./cases";

export { EVAL_CASES } from "./cases";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";

export interface EvalResult {
  id: number;
  name: string;
  callGoal: string;
  expected: string;
  actual: string;
  pass: boolean;
  reason: string;
  flags: Record<string, any>;
  transcript: string;
}

function parseJson(raw: string): any {
  const s = String(raw ?? "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a === -1 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

/** Build Rahul's context and apply the case's setup overrides so the agent behaves per-scenario. */
async function buildEvalContext(caseDef: EvalCase, personaId?: string) {
  const rahul = await prisma.customer.findFirstOrThrow({ where: { name: "Rahul Sharma" } });
  const ctx: any = await buildTurnContext(rahul.id, "call", personaId);
  const s = caseDef.setup ?? {};
  if (ctx.dues?.[0]) {
    if (s.balance != null) { ctx.dues[0].balance = s.balance; ctx.dues[0].amount = Math.max(ctx.dues[0].amount, s.balance); }
  }
  if (s.brokenPromises != null) {
    ctx.promises = Array.from({ length: s.brokenPromises }, () => ({ promisedDate: new Date().toISOString(), source: "call", kept: false }));
    ctx.rules = { ...(ctx.rules || {}), tone: s.brokenPromises >= 2 ? "firm" : s.brokenPromises === 1 ? "neutral" : "warm" };
  }
  if (s.promiseVerbatim === "") ctx.promises = [];
  if (s.partialPaid != null) {
    ctx.customer.historySummary = `Paid ₹${s.partialPaid}${s.partialDate ? " on " + s.partialDate : ""}; balance ₹${s.balance ?? ctx.dues?.[0]?.balance} remains.`;
  }
  return ctx;
}

async function runTurns(context: any, lines: string[]) {
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  const intents: any[] = [];
  for (const line of lines) {
    turns.push({ role: "user", content: line });
    try {
      const res = await fetch(`${BASE}/api/voice/turn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: line, role: "call", context, turns: turns.slice(0, -1), skipTts: true }),
      });
      if (res.ok) {
        const d = await res.json();
        turns.push({ role: "assistant", content: d.agentText ?? "" });
        for (const it of d.intents ?? []) if (it?.type) intents.push(it);
      } else {
        turns.push({ role: "assistant", content: "" });
      }
    } catch {
      turns.push({ role: "assistant", content: "" });
    }
  }
  return { turns, intents };
}

async function judge(caseDef: EvalCase, turns: any[], intents: any[]) {
  const transcript = turns.map((t) => `${t.role === "user" ? "Customer" : "Agent"}: ${t.content}`).join("\n");
  const sys = `You grade a Hindi/Hinglish kirana debt-collection (vasooli) call. Read the transcript and classify how the AGENT handled it.
Choose ONE disposition from: ${DISPOSITIONS.join(", ")}.
Also extract observed flags where present: payment_link_sent (yes/no), payment_amount_agreed, promise_to_pay_date, dispute_raised (yes/no), escalation_reason, non_payment_reason, identity_confirmed (true/false), tone (warm/neutral/firm), language_switch (true/false), disposition_callback_later, disposition_dnd, disposition_wrong_number.
Detected tool intents: ${JSON.stringify(intents.map((i) => i.type))}.
Reply ONLY JSON: {"disposition":"...","flags":{...},"reason":"<one sentence>"}`;
  const raw = await chat([{ role: "system", content: sys }, { role: "user", content: transcript || "(no transcript)" }], { temperature: 0.1 });
  const j = parseJson(raw) ?? {};
  const actual = DISPOSITIONS.includes(j.disposition) ? j.disposition : "unknown";
  return { actual, flags: j.flags ?? {}, reason: String(j.reason ?? "").slice(0, 200), transcript };
}

/** Run one eval case (optionally with a pinned persona) and grade it. */
export async function runEvalCase(caseId: number, personaId?: string): Promise<EvalResult> {
  const caseDef = EVAL_CASES.find((c) => c.id === caseId);
  if (!caseDef) throw new Error(`unknown case ${caseId}`);
  const context = await buildEvalContext(caseDef, personaId);
  const { turns, intents } = await runTurns(context, caseDef.customerTurns);
  const { actual, flags, reason, transcript } = await judge(caseDef, turns, intents);
  const accepted = [caseDef.expected.disposition, ...(caseDef.expected.aliases ?? [])];
  const pass = accepted.includes(actual);
  return {
    id: caseDef.id, name: caseDef.name, callGoal: caseDef.callGoal,
    expected: caseDef.expected.disposition, actual, pass, reason, flags, transcript,
  };
}
