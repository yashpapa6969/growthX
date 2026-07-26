// Read-only database viewer — schema + all data for demo/debugging.
// Every model rendered as its own section. Server component; queries run per request.
import { prisma } from "@/lib/db";
import { DbTable } from "@/components/DbTable";

export const dynamic = "force-dynamic";

const TAKE = 200;

// Serialize Prisma rows to plain, client-safe objects: Date -> ISO string,
// Json fields stay as plain objects/arrays (already serializable). Keeps the
// server->client boundary free of non-POJO values.
function serialize(rows: unknown[]): any[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      out[k] = v instanceof Date ? v.toISOString() : v;
    }
    return out;
  });
}

export default async function DbPage() {
  let tables: { name: string; rows: any[] }[] = [];
  let error: string | null = null;

  try {
    const [
      customers,
      products,
      orders,
      dues,
      promises,
      payments,
      interactions,
      demoClocks,
      personas,
      learnings,
      playbooks,
    ] = await Promise.all([
      prisma.customer.findMany({ take: TAKE, orderBy: { createdAt: "desc" } }),
      prisma.product.findMany({ take: TAKE }),
      prisma.order.findMany({ take: TAKE, orderBy: { createdAt: "desc" } }),
      prisma.due.findMany({ take: TAKE, orderBy: { createdAt: "desc" } }),
      prisma.promise.findMany({ take: TAKE, orderBy: { createdAt: "desc" } }),
      prisma.payment.findMany({ take: TAKE, orderBy: { createdAt: "desc" } }),
      prisma.interaction.findMany({ take: TAKE, orderBy: { createdAt: "desc" } }),
      prisma.demoClock.findMany({ take: TAKE }),
      prisma.persona.findMany({ take: TAKE }),
      prisma.learning.findMany({ take: TAKE, orderBy: { createdAt: "desc" } }),
      prisma.playbook.findMany({ take: TAKE }),
    ]);

    tables = [
      { name: "Customer", rows: serialize(customers) },
      { name: "Product", rows: serialize(products) },
      { name: "Order", rows: serialize(orders) },
      { name: "Due", rows: serialize(dues) },
      { name: "Promise", rows: serialize(promises) },
      { name: "Payment", rows: serialize(payments) },
      { name: "Interaction", rows: serialize(interactions) },
      { name: "DemoClock", rows: serialize(demoClocks) },
      { name: "Persona", rows: serialize(personas) },
      { name: "Learning", rows: serialize(learnings) },
      { name: "Playbook", rows: serialize(playbooks) },
    ];
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold">Database viewer</h1>
        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs uppercase tracking-wide text-gray-500">
          read-only
        </span>
      </div>
      <p className="text-sm text-gray-500">
        Every model, capped at {TAKE} rows each. Ordered newest-first where a{" "}
        <code>createdAt</code> exists. This page never writes.
      </p>

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <strong>Database not reachable.</strong> Check <code>DATABASE_URL</code> and that
          migrations/seed have run.
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-red-600">{error}</pre>
        </div>
      ) : (
        tables.map((t) => <DbTable key={t.name} name={t.name} rows={t.rows} />)
      )}
    </div>
  );
}
