// WhatsApp-style nudge surface (simulated, disclosed). OWNER: Engineer 2.
// M2: agent nudge cites the exact order/amount; customer reply -> parsed promise (live).
import { prisma } from "@/lib/db";
import { NudgeThread } from "@/components/NudgeThread";

export const dynamic = "force-dynamic";

async function getThread() {
  try {
    return await prisma.customer.findFirst({ where: { name: "Rahul Sharma" }, include: { dues: { where: { status: { not: "paid" } } } } });
  } catch { return null; }
}

export default async function InboxPage() {
  const rahul = await getThread();
  const due = rahul?.dues[0];
  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-3 text-xl font-bold">Inbox <span className="text-sm font-normal text-gray-400">(WhatsApp — simulated)</span></h1>
      {rahul && due ? (
        <NudgeThread customerId={rahul.id} dueId={due.id} customerName={rahul.name} />
      ) : (
        <div className="rounded-lg border bg-[#e5ddd5] p-6 text-center text-sm text-gray-600">Seed the DB to load the thread.</div>
      )}
      <p className="mt-3 text-xs text-gray-500">
        Simulated surface — the agent, its memory, and the parsed promise are real. The agent that took the
        order is the same one nudging here; a promise made in chat is cited on the later call.
      </p>
    </div>
  );
}
