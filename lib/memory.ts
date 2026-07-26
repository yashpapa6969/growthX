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

  // Catalogue only for ordering (keeps the collection-call prompt lean).
  const catalogue = role === "order"
    ? (await prisma.product.findMany()).map((p) => ({ name: p.name, nameHi: p.nameHi, price: p.price }))
    : undefined;

  // TODO(M-Stretch-1): merge active persona.promptFragment + Playbook.content into personaPrompt.
  return {
    catalogue,
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

/**
 * Execute one intent returned by the voice service (push-to-talk path).
 * Shares all ledger-mutation logic with the /api/khata route via lib/khata.ts.
 * The voice contract uses snake_case payload keys (due_id, promised_date, amount_inr).
 */
export async function executeIntent(customerId: string, intent: Intent): Promise<void> {
  // Dynamic import breaks the memory<->khata module cycle (khata imports from here).
  const { placeOnKhata, recordPromise, sendPaymentLink, escalate } = await import("./khata");
  const p = intent.payload ?? {};
  switch (intent.type) {
    case "place_on_khata":
      await placeOnKhata({
        customerId,
        items: (p.items ?? []) as { item: string; qty: number }[],
        total_inr: p.total_inr,
      });
      break;
    case "record_promise":
      await recordPromise({
        customerId,
        dueId: p.due_id ?? p.dueId,
        promised_date: p.promised_date,
        source: p.source ?? "call",
        verbatim: p.verbatim,
      });
      break;
    case "send_payment_link":
      await sendPaymentLink({
        dueId: p.due_id ?? p.dueId,
        amount: p.amount_inr ?? p.amount,
      });
      break;
    case "acknowledge_partial":
      // Delight branch: ledger already reflects the partial; nothing to write. The
      // agent reads the partial back from context; no mutation needed here.
      break;
    case "escalate":
      await escalate({
        customerId,
        reason: p.reason ?? "unspecified",
        summary: p.summary ?? "",
      });
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
