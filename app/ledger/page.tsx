// Khata ledger + unified cross-surface timeline (merchant/judge view).
// The timeline IS the Memory & Context evidence: one customer, every surface, one record.
import { prisma } from "@/lib/db";
import { PayButton } from "@/components/PayButton";
import { CallButton } from "@/components/CallButton";

export const dynamic = "force-dynamic";

async function getData() {
  try {
    const customers = await prisma.customer.findMany({
      include: { dues: { include: { promises: true, payments: true } }, interactions: { orderBy: { simTs: "asc" } } },
      orderBy: { trustScore: "desc" },
    });
    return customers;
  } catch { return []; }
}

export default async function LedgerPage() {
  const customers = await getData();
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Khata ledger &amp; timeline</h1>
      {customers.length === 0 && <p className="text-sm text-gray-500">Seed the DB to view the ledger.</p>}
      {customers.map((c) => {
        const balance = c.dues.reduce((s, d) => s + d.balance, 0);
        return (
          <div key={c.id} className="rounded-lg border bg-white p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{c.name} <span className="text-xs text-gray-400">trust {c.trustScore} · {c.escalationStage}</span></div>
              <div className={balance > 0 ? "font-bold text-khata-firm" : "font-bold text-khata"}>₹{balance} due</div>
            </div>
            {balance > 0 && <CallButton customerId={c.id} phone={c.phone} />}
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <div>
                <div className="text-xs font-medium uppercase text-gray-400">Dues</div>
                {c.dues.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 text-sm">
                    <span>₹{d.balance} of ₹{d.amount} · <span className="uppercase">{d.status}</span>{d.payments.length > 0 && ` · ${d.payments.length} payment(s)`}</span>
                    {d.status !== "paid" && d.balance > 0 && <PayButton dueId={d.id} amount={d.balance} />}
                  </div>
                ))}
              </div>
              <div>
                <div className="text-xs font-medium uppercase text-gray-400">Timeline (cross-surface)</div>
                {c.interactions.map((i) => (
                  <div key={i.id} className="text-sm"><span className="rounded bg-gray-100 px-1 text-xs uppercase">{i.surface}</span> {i.summary}</div>
                ))}
                {c.interactions.length === 0 && <div className="text-sm text-gray-400">No interactions yet.</div>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
