// Real-time LiveKit voice surface (WebSocket). Disclosed as a simulated call in the demo.
import { prisma } from "@/lib/db";
import { LiveCall } from "@/components/LiveCall";

export const dynamic = "force-dynamic";

async function getCustomers() {
  try {
    const cs = await prisma.customer.findMany({ orderBy: { trustScore: "desc" } });
    return cs.map((c) => ({ id: c.id, name: c.name, language: c.language, escalationStage: c.escalationStage }));
  } catch {
    return [];
  }
}

export default async function LivePage() {
  const customers = await getCustomers();
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div>
        <h1 className="text-xl font-bold">Live voice agent <span className="text-sm font-normal text-gray-400">(LiveKit · real-time)</span></h1>
        <p className="mt-1 text-sm text-gray-600">
          Streaming Saaras → Sarvam-30B → Bulbul with native turn-taking and barge-in — the same
          relationship manager, now real-time. Pick a customer and start; interrupt any time.
        </p>
        <ul className="mt-3 list-disc pl-5 text-sm text-gray-500">
          <li>Rahul — one broken promise (the main arc)</li>
          <li>Meena — “already paid” dispute (₹500 partial exists)</li>
          <li>Amit — chronic breaker (opens firm)</li>
        </ul>
      </div>
      <aside>
        {customers.length ? <LiveCall customers={customers} />
          : <div className="rounded-lg border bg-white p-4 text-sm text-gray-500">Seed the DB to load customers.</div>}
      </aside>
    </div>
  );
}
