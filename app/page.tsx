import Link from "next/link";

const surfaces = [
  { href: "/shop", title: "1 · Shop", desc: "Voice-order on khata. Seeds the relationship memory live." },
  { href: "/inbox", title: "2 · Inbox", desc: "WhatsApp-sim nudge that cites the exact order. Excuse → promise." },
  { href: "/call", title: "3 · Call", desc: "The vasooli call: opens on the broken promise, negotiates, collects." },
  { href: "/ledger", title: "Ledger", desc: "Khata + unified cross-surface timeline (merchant view)." },
  { href: "/dashboard", title: "Dashboard", desc: "M-Stretch-1: persona leaderboard + coach. Gated." },
];

export default function Home() {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-white p-6">
        <h1 className="text-2xl font-bold">The agent that takes the order is the agent that collects.</h1>
        <p className="mt-2 text-gray-600">
          One governed memory across ordering, a WhatsApp-style nudge, and a voice call.
          <span className="font-medium"> Simulated surfaces — the voice AI, the memory, and the payment are real.</span>
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {surfaces.map((s) => (
          <Link key={s.href} href={s.href} className="rounded-lg border bg-white p-4 hover:border-khata">
            <div className="font-semibold text-khata">{s.title}</div>
            <div className="mt-1 text-sm text-gray-600">{s.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
