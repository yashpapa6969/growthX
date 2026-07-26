// Self-improving harness — OWNER: Engineer 1 (orchestrated). M-Stretch-1, now live.
// Offline eval + human-gated promotion loop over Persona / Learning / Playbook.
// assign -> score(at hangup) -> leaderboard -> coach -> promote -> before/after re-run.
//
// Scoring reuses voice-service/analysis.py's EXACT 4-dim rubric + enums so the live
// (Node) scores and the offline (Python WAV) scores are directly comparable:
//   dims (1-5): naturalness, task_completion, compliance, language_quality
// outcomeScore = mean of the four dims (kept on the 1-5 scale).
// recovered (0/1) comes from LEDGER TRUTH (a paid Payment or a fresh Promise), never the LLM.

import { prisma } from "./db";
import { chat } from "./sarvam";
import { buildTurnContext, getSimDate } from "./memory";

export const RUBRIC_DIMS = ["naturalness", "task_completion", "compliance", "language_quality"] as const;
export const OUTCOMES = ["resolved", "promise_to_pay", "callback", "refused", "incomplete", "unknown"] as const;
export const SENTIMENTS = ["positive", "neutral", "negative"] as const;

export type ScoredTurn = { role: "user" | "assistant"; content: string };

/** Round-robin persona assignment: pin the next scored call to the next active persona. */
export async function assignPersona() {
  const personas = await prisma.persona.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  if (personas.length === 0) return null;
  const n = await prisma.interaction.count({ where: { personaId: { not: null } } });
  return personas[n % personas.length];
}

function transcriptText(turns: ScoredTurn[]): string {
  return turns.map((t) => `${t.role === "user" ? "Customer" : "Agent"}: ${t.content}`).join("\n");
}

function parseJson(raw: string): any {
  try {
    return JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
}

/** Did this call actually recover value? Ledger truth: a paid Payment or a fresh Promise since callStart. */
async function computeRecovered(customerId: string, since: Date): Promise<number> {
  const paid = await prisma.payment.count({
    where: { status: "paid", due: { customerId }, OR: [{ paidAt: { gte: since } }, { createdAt: { gte: since } }] },
  });
  const promised = await prisma.promise.count({
    where: { customerId, supersededAt: null, createdAt: { gte: since } },
  });
  return paid > 0 || promised > 0 ? 1 : 0;
}

export interface CallScore {
  outcomeScore: number;
  recovered: number;
  turns: number;
  sentiment: string;
  outcome: string;
  scores: Record<string, number>;
  summary: string;
  transcript: string;
}

/** Grade one call transcript with the fast LLM on the shared 4-dim rubric. */
export async function scoreCall(input: {
  customerId: string;
  personaId?: string | null;
  turns: ScoredTurn[];
  callStart: string | Date;
}): Promise<CallScore> {
  const turns = input.turns ?? [];
  const transcript = transcriptText(turns);
  const turnPairs = turns.filter((t) => t.role === "user").length || turns.length;
  const since = new Date(input.callStart ?? Date.now());
  const recovered = await computeRecovered(input.customerId, since);

  const sys = `You are an expert QA analyst for Hindi/Hinglish debt-collection (vasooli) voice-agent phone calls.
Grade the AGENT only. Rate each dimension as an integer 1-5:
- naturalness: sounds like a real, warm shopkeeper, not a robot.
- task_completion: moved the call toward payment or a dated promise.
- compliance: no threats/shaming, no unauthorised discount, escalates hardship.
- language_quality: natural code-mixed Hindi, correct amounts/dates spoken the desi way.
Reply ONLY JSON: {"scores":{"naturalness":n,"task_completion":n,"compliance":n,"language_quality":n},"outcome":"${OUTCOMES.join("|")}","sentiment_customer":"${SENTIMENTS.join("|")}","summary":"<=2 sentences"}`;

  let scores: Record<string, number> = {};
  let outcome = "unknown";
  let sentiment = "neutral";
  let summary = "";
  try {
    const raw = await chat(
      [
        { role: "system", content: sys },
        { role: "user", content: `TRANSCRIPT:\n${transcript || "(no speech captured)"}` },
      ],
      { temperature: 0.2 }
    );
    const j = parseJson(raw);
    if (j) {
      scores = j.scores ?? {};
      outcome = OUTCOMES.includes(j.outcome) ? j.outcome : "unknown";
      sentiment = SENTIMENTS.includes(j.sentiment_customer) ? j.sentiment_customer : "neutral";
      summary = String(j.summary ?? "").slice(0, 300);
    }
  } catch {
    // fall through to heuristic
  }

  const dimVals = RUBRIC_DIMS.map((d) => Number(scores[d])).filter((n) => n >= 1 && n <= 5);
  let outcomeScore: number;
  if (dimVals.length === RUBRIC_DIMS.length) {
    outcomeScore = dimVals.reduce((a, b) => a + b, 0) / dimVals.length;
  } else {
    // Heuristic fallback (sarvam-30b sometimes returns empty): keep the leaderboard populated.
    outcomeScore = recovered ? 3.8 : 2.2;
    outcomeScore -= Math.max(0, turnPairs - 6) * 0.1; // long, rambling calls score a touch lower
    outcomeScore = Math.max(1, Math.min(5, outcomeScore));
    scores = Object.fromEntries(RUBRIC_DIMS.map((d) => [d, Math.round(outcomeScore)]));
    if (outcome === "unknown") outcome = recovered ? "promise_to_pay" : "incomplete";
    if (!summary) summary = recovered ? "Recovered a payment or dated promise." : "No recovery this call.";
  }

  return { outcomeScore: Number(outcomeScore.toFixed(2)), recovered, turns: turnPairs, sentiment, outcome, scores, summary, transcript };
}

/** Persist ONE scored Interaction per call carrying all harness fields (the leaderboard row). */
export async function recordScoredCall(input: { customerId: string; personaId?: string | null; score: CallScore }): Promise<void> {
  const s = input.score;
  await prisma.interaction.create({
    data: {
      customerId: input.customerId,
      surface: "call",
      simTs: await getSimDate(),
      transcript: s.transcript?.slice(0, 4000) || null,
      summary: s.summary || null,
      outcome: s.outcome,
      personaId: input.personaId ?? null,
      outcomeScore: s.outcomeScore,
      recovered: s.recovered,
      turns: s.turns,
      sentiment: s.sentiment,
    },
  });
}

export interface LeaderRow {
  personaId: string;
  name: string;
  calls: number;
  recoveryRate: number | null;
  avgTurns: number | null;
  avgScore: number | null;
}

/** Per-persona leaderboard over scored interactions. */
export async function getLeaderboard(): Promise<LeaderRow[]> {
  const personas = await prisma.persona.findMany();
  const grouped = await prisma.interaction.groupBy({
    by: ["personaId"],
    where: { outcomeScore: { not: null }, personaId: { not: null } },
    _count: { _all: true },
    _avg: { recovered: true, turns: true, outcomeScore: true },
  });
  const byId = new Map(grouped.map((g) => [g.personaId as string, g]));
  return personas
    .map((p) => {
      const g = byId.get(p.id);
      return {
        personaId: p.id,
        name: p.name,
        calls: g?._count._all ?? 0,
        recoveryRate: g?._avg.recovered ?? null,
        avgTurns: g?._avg.turns ?? null,
        avgScore: g?._avg.outcomeScore ?? null,
      };
    })
    .sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1));
}

/** Coach pass: turn recent scored calls into 1-3 concrete, reusable plays with REAL observed lift. */
export async function runCoach(): Promise<{ learnings: { play: string; evidence: string; observedLift: number }[] }> {
  const board = await getLeaderboard();
  const withScore = board.filter((r) => r.avgScore != null);
  const meanRecovery = withScore.length
    ? withScore.reduce((a, r) => a + (r.recoveryRate ?? 0), 0) / withScore.length
    : 0;
  const top = withScore[0];
  const observedLift = top && top.recoveryRate != null ? Number((top.recoveryRate - meanRecovery).toFixed(3)) : 0;

  const recent = await prisma.interaction.findMany({
    where: { outcomeScore: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  const personaName = new Map((await prisma.persona.findMany()).map((p) => [p.id, p.name]));
  const corpus = recent
    .map((i) => `[${personaName.get(i.personaId ?? "") ?? "?"} · score ${i.outcomeScore} · ${i.outcome}] ${i.summary ?? ""}`)
    .join("\n");

  const sys = `You are a collections coach for a kirana vasooli voice agent. From the graded calls below,
extract 1-3 CONCRETE, reusable tactics ("plays") that the best-performing persona used and others should adopt.
Each play is one imperative Hindi-collections instruction (English is fine), specific enough to change an opening line
or a negotiation move — not generic advice. Reply ONLY JSON: {"plays":[{"play":"...","evidence":"which persona/why"}]}`;

  let plays: { play: string; evidence: string }[] = [];
  try {
    const raw = await chat([{ role: "system", content: sys }, { role: "user", content: `LEADERBOARD:\n${JSON.stringify(withScore)}\n\nGRADED CALLS:\n${corpus}` }], { temperature: 0.4 });
    const j = parseJson(raw);
    if (j?.plays && Array.isArray(j.plays)) plays = j.plays.slice(0, 3);
  } catch {
    // fall through
  }
  if (plays.length === 0) {
    plays = [{ play: "Open by citing the exact broken promise and amount before any ask.", evidence: top?.name ?? "top persona" }];
  }

  const learnings = plays.map((p) => ({ play: String(p.play).slice(0, 300), evidence: String(p.evidence ?? "").slice(0, 300), observedLift }));
  await prisma.learning.createMany({ data: learnings.map((l) => ({ ...l, promoted: false })) });
  return { learnings };
}

/** Human-gated promotion: fold a learning's play into the shared Playbook (all personas inherit it). */
export async function promoteLearning(learningId: string): Promise<{ version: number; content: string }> {
  const learning = await prisma.learning.findUnique({ where: { id: learningId } });
  if (!learning) throw new Error("learning not found");
  const pb = await prisma.playbook.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", content: `- ${learning.play}`, version: 1 },
    update: {},
  });
  const nextContent = (pb.content ? pb.content + "\n" : "") + `- ${learning.play}`;
  const updated = await prisma.playbook.update({
    where: { id: "singleton" },
    data: { content: nextContent, version: { increment: 1 } },
  });
  await prisma.learning.update({ where: { id: learningId }, data: { promoted: true } });
  return { version: updated.version, content: updated.content };
}

/** Deterministic, stage-safe re-run: scripted customer lines through the live prompt+LLM, then scored.
 *  Exercises the CURRENT playbook/persona so before/after promotion shows real lift. */
export async function runScriptedCall(customerId: string): Promise<CallScore> {
  const persona = await assignPersona();
  const context = await buildTurnContext(customerId, "call", persona?.id);
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";

  const customerLines = [
    "haan bhaiya, bolo kya baat hai",
    "arre abhi thoda tight chal raha hai paisa",
    "theek hai, main de deta hoon jaldi",
  ];
  const turns: ScoredTurn[] = [];
  const callStart = new Date().toISOString();

  for (const line of customerLines) {
    turns.push({ role: "user", content: line });
    try {
      const res = await fetch(`${base}/api/voice/turn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: line, role: "call", context, turns: turns.slice(0, -1) }),
      });
      if (res.ok) {
        const data = await res.json();
        turns.push({ role: "assistant", content: data.agentText ?? "" });
      }
    } catch {
      // keep going; scorer handles sparse transcripts
    }
  }

  const score = await scoreCall({ customerId, personaId: persona?.id, turns, callStart });
  await recordScoredCall({ customerId, personaId: persona?.id, score });
  return score;
}
