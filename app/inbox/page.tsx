// WhatsApp-style nudge surface (simulated, disclosed). OWNER: Engineer 2.
// Switch between customers to see each one's distinct khata history; a promise parsed here is
// written to the ledger and cited on the later call (unified memory).
import { prisma } from "@/lib/db";
import Link from "next/link";
import { NudgeThread } from "@/components/NudgeThread";

export const dynamic = "force-dynamic";

export default async function InboxPage({ searchParams }: { searchParams: { customerId?: string } }) {
  let customers: { id: string; name: string; dues: { id: string }[] }[] = [];
  try {
    customers = await prisma.customer.findMany({
      include: { dues: { where: { status: { not: "paid" } }, orderBy: { createdAt: "asc" } } },
      orderBy: { trustScore: "desc" },
    });
  } catch {}

  const selected = customers.find((c) => c.id === searchParams.customerId) ?? customers[0];
  const due = selected?.dues?.[0];

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-3 text-xl font-bold">Inbox <span className="text-sm font-normal text-gray-400">(WhatsApp — simulated)</span></h1>

      {customers.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {customers.map((c) => (
            <Link
              key={c.id}
              href={`/inbox?customerId=${c.id}`}
              className={`rounded-full border px-3 py-1 text-xs ${selected?.id === c.id ? "border-khata bg-khata text-white" : "border-gray-300 text-gray-600 hover:border-khata"}`}
            >
              {c.name}
            </Link>
          ))}
        </div>
      )}

      {selected && due ? (
        <NudgeThread key={selected.id} customerId={selected.id} dueId={due.id} customerName={selected.name} />
      ) : selected ? (
        <div className="rounded-lg border bg-[#e5ddd5] p-6 text-center text-sm text-gray-600">{selected.name} has no open dues.</div>
      ) : (
        <div className="rounded-lg border bg-[#e5ddd5] p-6 text-center text-sm text-gray-600">Seed the DB to load threads.</div>
      )}

      <p className="mt-3 text-xs text-gray-500">
        Simulated surface — the agent, its memory, and the parsed promise are real. Switch customers to see each one&apos;s
        distinct history; a promise made here is cited on the later call.
      </p>
    </div>
  );
}
