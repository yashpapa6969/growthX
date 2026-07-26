// Outbound campaign scheduler — the "where the cron sits" logic.
// A Railway Cron service hits POST /api/campaigns/run every ~15-30 min in calling hours.
// This selects overdue dues by the escalation ladder + guardrails and dispatches the next
// action. Outbound calls use Option B (LiveKit SIP): dial the debtor into a room where
// agent.py runs with the customer's context — same agent that owns memory + the harness.
// Real dialing needs a SIP trunk + caller number; until then dispatch is DRY-RUN (logs intent).

import { prisma } from "./db";
import { getSimDate, escalationTone } from "./memory";

const GRACE_DAYS = 3;
const CALL_WINDOW = { start: 9, end: 21 }; // 9am–9pm local (IST)

export interface ContactPlan {
  customerId: string;
  name: string;
  phone: string;
  dueId: string;
  balance: number;
  action: "nudge" | "call";
  tone: string;
  reason: string;
}

/** IST hour of the (simulated) clock — Railway runs UTC, the merchant/customers are IST. */
function istHour(d: Date): number {
  return Math.floor(((d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440) / 60);
}

/** Who is eligible to be contacted right now, and with what action, per the ladder + guardrails. */
export async function selectContactList(): Promise<{ now: string; withinWindow: boolean; plans: ContactPlan[] }> {
  const now = await getSimDate();
  const withinWindow = (() => { const h = istHour(now); return h >= CALL_WINDOW.start && h < CALL_WINDOW.end; })();

  const dues = await prisma.due.findMany({
    where: { status: { not: "paid" } },
    include: { customer: true, promises: true },
    orderBy: { createdAt: "asc" },
  });

  const plans: ContactPlan[] = [];
  for (const d of dues) {
    const ageDays = (now.getTime() - d.createdAt.getTime()) / 86_400_000;
    const active = d.promises.filter((p) => !p.kept && !p.supersededAt);
    const broken = active.filter((p) => p.promisedDate < now).length;
    const hasPending = active.some((p) => p.promisedDate >= now);

    if (hasPending) continue;          // guardrail: waiting on a live promise — don't chase yet
    if (ageDays < GRACE_DAYS) continue; // guardrail: still inside the grace period

    const tone = escalationTone(d.customer.trustScore, broken);
    // Ladder: never-contacted + newly overdue -> warm nudge; already nudged, or a broken promise -> call.
    const escalated = ["nudged", "called", "escalated"].includes(d.customer.escalationStage);
    const action: "nudge" | "call" = broken >= 1 || escalated ? "call" : "nudge";
    const reason = broken >= 1
      ? `${broken} broken promise(s); ₹${d.balance} overdue ~${Math.floor(ageDays)}d`
      : `₹${d.balance} overdue ~${Math.floor(ageDays)}d past grace; stage=${d.customer.escalationStage}`;

    plans.push({ customerId: d.customerId, name: d.customer.name, phone: d.customer.phone, dueId: d.id, balance: d.balance, action, tone, reason });
  }
  return { now: now.toISOString(), withinWindow, plans };
}

/** Execute one contact. DRY-RUN by default (no real telephony). Real path = Option B (LiveKit SIP). */
export async function dispatchContact(plan: ContactPlan, dryRun = true): Promise<{ via: string; dispatched: boolean; note: string }> {
  if (plan.action === "nudge") {
    return { via: "whatsapp-sim", dispatched: false, note: `Send WhatsApp nudge to ${plan.name} — ₹${plan.balance} (${plan.tone}).` };
  }
  if (dryRun) {
    return { via: "livekit-sip", dispatched: false, note: `Dial ${plan.phone} via LiveKit SIP → agent.py (customer=${plan.customerId}, tone=${plan.tone}).` };
  }
  // TODO(real Option B): create a LiveKit room, mint a SIP participant to dial plan.phone,
  // and set room metadata {customerId, role:"call", personaId}. Needs a SIP trunk + caller number.
  throw new Error("real outbound dialing not configured — add a LiveKit SIP trunk + caller number");
}

/** One scheduler tick: what the Railway cron invokes. Returns the plan + (dry-run) dispatch results. */
export async function runCampaign(dryRun = true): Promise<{ now: string; withinWindow: boolean; count: number; results: (ContactPlan & { via: string; dispatched: boolean; note: string })[] }> {
  const { now, withinWindow, plans } = await selectContactList();
  const results = [];
  for (const p of plans) results.push({ ...p, ...(await dispatchContact(p, dryRun)) });
  return { now, withinWindow, count: results.length, results };
}
