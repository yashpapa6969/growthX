// Shared khata (ledger) mutations — the single source of truth for order/promise/
// escalation writes. Both the `/api/khata` HTTP route (voice-agent tool calls) and
// `executeIntent()` (push-to-talk path) call these, so there is no duplicated logic.
// All timestamps use the simulated demo clock (getSimDate), never wall time.

import { prisma } from "./db";
import { getSimDate, logInteraction } from "./memory";

/** Thrown for expected, client-facing failures (missing input / not found). */
export class KhataError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface ResolvedItem {
  name: string;
  qty: number;
  price: number;
  productId?: string;
}

/**
 * Resolve requested items against the Product catalogue (case-insensitive contains
 * match on name / nameHi), compute the order total, and create Order + Due + log.
 * Falls back to `total_inr` for the total when any item can't be priced.
 */
export async function placeOnKhata(input: {
  customerId: string;
  items: { item: string; qty: number }[];
  total_inr?: number;
}): Promise<{ orderId: string; dueId: string; total: number; items: ResolvedItem[] }> {
  const { customerId } = input;
  if (!customerId) throw new KhataError("customerId required");
  if (!Array.isArray(input.items) || input.items.length === 0)
    throw new KhataError("items required");

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new KhataError("customer not found", 404);

  const resolved: ResolvedItem[] = [];
  let computed = 0;
  let allResolved = true;

  for (const raw of input.items) {
    const name = String(raw?.item ?? "").trim();
    // Coerce qty defensively: the LLM sometimes emits "1kg"/"2 packet" instead of a number.
    const qty = Number(raw?.qty) || Number(String(raw?.qty ?? "").match(/[\d.]+/)?.[0]) || 0;
    if (!name || qty <= 0) throw new KhataError("each item needs a name and positive qty");

    const product = await prisma.product.findFirst({
      where: {
        OR: [
          { name: { contains: name, mode: "insensitive" } },
          { nameHi: { contains: name, mode: "insensitive" } },
        ],
      },
    });

    if (product) {
      resolved.push({ name: product.name, qty, price: product.price, productId: product.id });
      computed += product.price * qty;
    } else {
      allResolved = false;
      resolved.push({ name, qty, price: 0 });
    }
  }

  const total = allResolved ? computed : input.total_inr ?? computed;
  const simDate = await getSimDate();

  const order = await prisma.order.create({
    data: {
      customerId,
      items: resolved as any,
      total,
      onKhata: true,
      simDate,
    },
  });
  const due = await prisma.due.create({
    data: { orderId: order.id, customerId, amount: total, balance: total, status: "open" },
  });

  const summary = `Ordered on khata: ${resolved
    .map((i) => `${i.qty}× ${i.name}`)
    .join(", ")} = ₹${total}.`;
  await logInteraction({ customerId, surface: "order", outcome: "ordered", summary });

  return { orderId: order.id, dueId: due.id, total, items: resolved };
}

/**
 * Record a promise-to-pay. Any existing non-superseded, unkept promise for the same
 * due is marked superseded (provenance kept) before the new promise is created.
 */
export async function recordPromise(input: {
  customerId: string;
  dueId: string;
  promised_date: string;
  source?: "call" | "nudge";
  verbatim?: string;
}): Promise<{ promiseId: string; promisedDate: string }> {
  const { customerId, dueId } = input;
  if (!customerId) throw new KhataError("customerId required");
  if (!dueId) throw new KhataError("dueId required");
  if (!input.promised_date) throw new KhataError("promised_date required");

  const promisedDate = new Date(input.promised_date);
  if (isNaN(promisedDate.getTime())) throw new KhataError("promised_date must be YYYY-MM-DD");

  const due = await prisma.due.findUnique({ where: { id: dueId } });
  if (!due) throw new KhataError("due not found", 404);

  const source = input.source === "nudge" ? "nudge" : "call";
  const simDate = await getSimDate();

  await prisma.promise.updateMany({
    where: { dueId, kept: false, supersededAt: null },
    data: { supersededAt: simDate },
  });

  const promise = await prisma.promise.create({
    data: { dueId, customerId, promisedDate, source, kept: false },
  });

  await logInteraction({
    customerId,
    surface: source,
    outcome: "promise_recorded",
    summary: `Promised ₹${due.balance} by ${input.promised_date}${input.verbatim ? ` ("${input.verbatim}")` : ""}.`,
  });

  return { promiseId: promise.id, promisedDate: promisedDate.toISOString() };
}

/** READ-ONLY: return a due's partial payments + current balance for a dispute ack. */
export async function acknowledgePartial(input: {
  dueId: string;
}): Promise<{ dueId: string; balance: number; payments: { amount: number; paidOn: string | null }[] }> {
  const { dueId } = input;
  if (!dueId) throw new KhataError("dueId required");

  const due = await prisma.due.findUnique({
    where: { id: dueId },
    include: { payments: { where: { status: "paid" }, orderBy: { paidAt: "asc" } } },
  });
  if (!due) throw new KhataError("due not found", 404);

  return {
    dueId,
    balance: due.balance,
    payments: due.payments.map((p) => ({
      amount: p.amount,
      paidOn: (p.paidAt ?? p.createdAt)?.toISOString() ?? null,
    })),
  };
}

/** Escalate a customer to a human. Sets escalationStage + logs the reason/summary. */
export async function escalate(input: {
  customerId: string;
  reason: string;
  summary: string;
}): Promise<{ ok: true }> {
  const { customerId } = input;
  if (!customerId) throw new KhataError("customerId required");
  if (!input.reason) throw new KhataError("reason required");

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new KhataError("customer not found", 404);

  await prisma.customer.update({
    where: { id: customerId },
    data: { escalationStage: "escalated" },
  });
  await logInteraction({
    customerId,
    surface: "call",
    outcome: "escalated",
    summary: `Escalated (${input.reason}): ${input.summary ?? ""}`.trim(),
  });

  return { ok: true };
}

/**
 * Close (or partially close) a due against a received payment. The SINGLE source of
 * truth for "money moved" — used by BOTH the Razorpay webhook and the mark-paid button,
 * so the ledger flip is identical on either path. Also logs a "paid" interaction so the
 * payment shows up on the /ledger cross-surface timeline (the demo's memorable moment).
 */
export async function closeDueByPayment(input: {
  dueId: string;
  amount: number;
  source?: "webhook" | "sim";
}): Promise<{ dueId: string; balance: number; status: string; amount: number }> {
  const { dueId } = input;
  if (!dueId) throw new KhataError("dueId required");

  const due = await prisma.due.findUnique({ where: { id: dueId } });
  if (!due) throw new KhataError("due not found", 404);

  const amount = input.amount && input.amount > 0 ? Math.round(input.amount) : due.balance;
  const newBalance = Math.max(0, due.balance - amount);
  const status = newBalance === 0 ? "paid" : "partial";

  await prisma.$transaction([
    prisma.payment.create({ data: { dueId, amount, status: "paid", paidAt: new Date() } }),
    prisma.due.update({ where: { id: dueId }, data: { balance: newBalance, status } }),
  ]);

  await logInteraction({
    customerId: due.customerId,
    surface: "call",
    outcome: "paid",
    summary: `₹${amount} received${input.source === "sim" ? " (simulated)" : ""} — balance ₹${newBalance}.`,
  });

  return { dueId, balance: newBalance, status, amount };
}

/**
 * Create a payment link for a due (via the razorpay link route) and persist a
 * pending Payment row attached to the Due. Used by the send_payment_link intent.
 */
export async function sendPaymentLink(input: {
  dueId: string;
  amount?: number;
}): Promise<{ dueId: string; amount: number; linkId: string | null; shortUrl: string | null }> {
  const { dueId } = input;
  if (!dueId) throw new KhataError("dueId required");

  const due = await prisma.due.findUnique({
    where: { id: dueId },
    include: { customer: true },
  });
  if (!due) throw new KhataError("due not found", 404);

  const amount = input.amount && input.amount > 0 ? input.amount : due.balance;

  let linkId: string | null = null;
  let shortUrl: string | null = null;
  try {
    const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
    const res = await fetch(`${base}/api/razorpay/link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dueId, amount, customerName: due.customer.name }),
    });
    if (res.ok) {
      const data = await res.json();
      linkId = data.id ?? null;
      shortUrl = data.short_url ?? null;
    }
  } catch {
    // Non-fatal: still persist the intent to send a link so the ledger reflects it.
  }

  await prisma.payment.create({
    data: { dueId, amount, status: "created", razorpayLinkId: linkId },
  });
  await logInteraction({
    customerId: due.customerId,
    surface: "call",
    outcome: "payment_link_sent",
    summary: `Sent payment link for ₹${amount}.`,
  });

  return { dueId, amount, linkId, shortUrl };
}
