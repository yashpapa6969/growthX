// Unified memory layer + governance rules — OWNER: Engineer 2.
// This is the Memory & Context rubric evidence. Web is the brain-of-record:
// it builds TurnContext for the voice service and executes the intents that come back.

import { prisma } from "./db";
import type { Intent, Role, TurnContext } from "./types";

const GRACE_DAYS = 3;

/** Current simulated clock. Single-row table so the demo can time-jump deterministically. */
export async function getSimDate(): Promise<Date> {
  const c = await prisma.demoClock.findUnique({ where: { id: "singleton" } });
  return c?.simDate ?? new Date();
}

export async function advanceDays(days: number): Promise<Date> {
  const cur = await getSimDate();
  const next = new Date(cur.getTime() + days * 86_400_000);
  await prisma.demoClock.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", simDate: next },
    update: { simDate: next },
  });
  return next;
}

/** History-governed escalation: tone hardens as trust drops / promises break. */
export function escalationTone(trustScore: number, brokenPromises: number): "warm" | "neutral" | "firm" {
  if (brokenPromises >= 2 || trustScore < 50) return "firm";
  if (brokenPromises >= 1 || trustScore < 80) return "neutral";
  return "warm";
}

/** Build the stateless context the voice service needs for one turn. */
export async function buildTurnContext(customerId: string, role: Role): Promise<TurnContext> {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
  const dues = await prisma.due.findMany({
    where: { customerId, status: { not: "paid" } },
    include: { promises: true },
    orderBy: { createdAt: "asc" },
  });
  const interactions = await prisma.interaction.findMany({
    where: { customerId },
    orderBy: { simTs: "desc" },
    take: 5,
  });
  const promises = dues.flatMap((d) =>
    d.promises.filter((p) => !p.supersededAt).map((p) => ({
      promisedDate: p.promisedDate.toISOString(),
      source: p.source,
      kept: p.kept,
    }))
  );
  const broken = dues.flatMap((d) => d.promises).filter((p) => !p.kept && p.promisedDate < new Date()).length;

  // TODO(M-Stretch-1): merge active persona.promptFragment + Playbook.content into personaPrompt.
  return {
    role,
    customer: {
      id: customer.id,
      name: customer.name,
      language: customer.language,
      historySummary: customer.historySummary ?? undefined,
      escalationStage: customer.escalationStage,
      trustScore: customer.trustScore,
    },
    dues: dues.map((d) => ({ id: d.id, amount: d.amount, balance: d.balance, status: d.status })),
    promises,
    history: interactions.map((i) => ({ surface: i.surface, summary: i.summary ?? "", simTs: i.simTs.toISOString() })),
    rules: { graceDays: GRACE_DAYS, minAcceptablePayment: 0.3, noWaivers: true, tone: escalationTone(customer.trustScore, broken) },
    simDate: (await getSimDate()).toISOString(),
  };
}

/** Execute one intent returned by the voice service. Add a case per IntentType as you build. */
export async function executeIntent(customerId: string, intent: Intent): Promise<void> {
  switch (intent.type) {
    case "place_on_khata":
      // TODO(Eng2): create Order + Due from cart in intent.payload.items
      break;
    case "record_promise": {
      // TODO(Eng2): supersede any prior open promise for this due, then create the new one.
      break;
    }
    case "send_payment_link":
      // TODO(Eng2): call /api/razorpay/link, attach to the Due, surface link in the chat/call view.
      break;
    case "acknowledge_partial":
      // Delight branch: ledger already reflects the partial; nothing to write, agent just acknowledges.
      break;
    case "escalate":
      await prisma.customer.update({ where: { id: customerId }, data: { escalationStage: "escalated" } });
      break;
    case "add_to_cart":
    case "none":
    default:
      break;
  }
}

/** Persist every turn — this log is the cross-surface timeline (Memory evidence). */
export async function logInteraction(input: {
  customerId: string;
  surface: Role;
  transcript?: string;
  summary?: string;
  outcome?: string;
  tone?: string;
}): Promise<void> {
  await prisma.interaction.create({
    data: { ...input, simTs: await getSimDate() },
  });
}
