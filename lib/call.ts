// Outbound phone dial via Sarvam's hosted Voice Agent ("Pooja") — but with agent_variables
// built FROM THE DB, not hand-typed. This is what makes the real phone call provably part of
// the unified memory: the context Pooja speaks is derived from the same khata the ledger shows.
// Mirrors voice-service/trigger_call.sh, parameterised from env.

import { prisma } from "@/lib/db";
import { getSimDate } from "@/lib/memory";
import { KhataError } from "@/lib/khata";

const human = (d: Date | null | undefined): string =>
  d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";

/** Build the Sarvam agent_variables for a customer's oldest open due, straight from the DB. */
export async function buildAgentVariables(customerId: string) {
  if (!customerId) throw new KhataError("customerId required");

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new KhataError("customer not found", 404);

  const due = await prisma.due.findFirst({
    where: { customerId, status: { not: "paid" } },
    orderBy: { createdAt: "asc" },
    include: {
      order: true,
      promises: { where: { supersededAt: null }, orderBy: { createdAt: "desc" } },
      payments: { where: { status: "paid" }, orderBy: { paidAt: "desc" } },
    },
  });
  if (!due) throw new KhataError("no open due for this customer", 404);

  const simDate = await getSimDate();

  // Order.items is Prisma Json — cast + guard. qty may be a string.
  const rawItems = due.order?.items as unknown;
  const items = Array.isArray(rawItems) ? (rawItems as { name: string; qty: number | string }[]) : [];
  const orderItemsSummary = items.map((i) => `${Number(i.qty) || i.qty} ${i.name}`).join(", ");

  const latestPromise = due.promises[0];
  const brokenPromisesCount = due.promises.filter(
    (p) => !p.kept && p.supersededAt === null && p.promisedDate < simDate
  ).length;

  // Promise has no verbatim column — pull it from the latest promise_recorded interaction.
  const promiseInteraction = latestPromise
    ? await prisma.interaction.findFirst({
        where: { customerId, outcome: "promise_recorded" },
        orderBy: { simTs: "desc" },
      })
    : null;

  const latestPaid = due.payments[0];
  const partialPaidTotal = due.payments.reduce((s, p) => s + p.amount, 0);

  // NOTE: Sarvam rejects (422) any agent_variable not declared in the app's config, so we do NOT
  // send customerId/dueId here. The post-call webhook correlates by phone number instead.
  const agentVariables = {
    userName: customer.name,
    order_items_summary: orderItemsSummary,
    due_amount: String(due.amount),
    order_date: human(due.order?.simDate ?? due.createdAt),
    promise_verbatim: promiseInteraction?.summary ?? "",
    promise_date: latestPromise ? human(latestPromise.promisedDate) : "",
    balance_amount: String(due.balance),
    broken_promises_count: String(brokenPromisesCount),
    partial_paid_amount: latestPaid ? String(partialPaidTotal) : "0",
    partial_paid_date: latestPaid ? human(latestPaid.paidAt ?? latestPaid.createdAt) : "",
  };

  return { agentVariables, customer, due };
}

/** Place the outbound call via the Sarvam outbounds API (all IDs from env; mirrors trigger_call.sh). */
export async function dialOutbound(userPhoneNumber: string, agentVariables: object) {
  const apiKey = process.env.SARVAM_SAMVAAD_API_KEY;
  if (!apiKey) throw new KhataError("SARVAM_SAMVAAD_API_KEY is not set on the server", 502);

  const org = process.env.SARVAM_OUTBOUND_ORG;
  const ws = process.env.SARVAM_OUTBOUND_WORKSPACE;
  const url = `https://apps.sarvam.ai/api/outbounds/v1/orgs/${org}/workspaces/${ws}/outbounds`;

  const body = {
    app_config: {
      app_id: process.env.SARVAM_OUTBOUND_APP_ID,
      app_version: Number(process.env.SARVAM_OUTBOUND_APP_VERSION ?? 2),
      app_type: "agent",
      connection_config: {
        connection_id: process.env.SARVAM_OUTBOUND_CONNECTION_ID,
        agent_phone_number: process.env.SARVAM_OUTBOUND_AGENT_PHONE,
      },
      agent_variables: agentVariables,
    },
    user_config: { user_phone_number: userPhoneNumber },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify(body),
  });

  try {
    return await res.json();
  } catch {
    return { ok: res.ok, status: res.status };
  }
}
