// The vasooli call — the SCORED surface (Voice). Disclosed as a simulated call.
import { prisma } from "@/lib/db";
import { AssistantPanel } from "@/components/AssistantPanel";

export const dynamic = "force-dynamic";

async function getCustomers() {
  try { return await prisma.customer.findMany({ orderBy: { trustScore: "desc" } }); }
  catch { return []; }
}

export default async function CallPage() {
  const customers = await getCustomers();
  const rahul = customers.find((c) => c.name.startsWith("Rahul")) ?? customers[0];
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div>
        <h1 className="text-xl font-bold">Vasooli call <span className="text-sm font-normal text-gray-400">(simulated surface)</span></h1>
        <p className="mt-1 text-sm text-gray-600">The same agent that took the order and sent the nudge — now collecting. It opens on the relationship and the broken promise, never a threat.</p>
        <div className="mt-4 space-y-2">
          {customers.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg border bg-white p-3 text-sm">
              <div><span className="font-medium">{c.name}</span> · trust {c.trustScore} · {c.escalationStage}</div>
              <div className="text-gray-500">{c.historySummary?.slice(0, 60)}…</div>
            </div>
          ))}
        </div>
      </div>
      <aside>
        {rahul
          ? <AssistantPanel customerId={rahul.id} role="call" />
          : <div className="rounded-lg border bg-white p-4 text-sm text-gray-500">Seed the DB first.</div>}
      </aside>
    </div>
  );
}
