// M-Stretch-1: optimization harness dashboard. GATED — only build out if M3 is verified by 2:30.
// Honest scope: offline eval + human-gated promotion. NO online learning, NO stat-sig claims.
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getPersonaStats() {
  try {
    const personas = await prisma.persona.findMany();
    // TODO(M-Stretch-1): aggregate Interaction.outcomeScore / recovered by personaId per persona.
    return personas.map((p) => ({ name: p.name, calls: 0, recoveryRate: null as number | null, avgTurns: null as number | null }));
  } catch { return []; }
}

export default async function DashboardPage() {
  const rows = await getPersonaStats();
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
        <strong>M-Stretch-1 (gated).</strong> Build this out ONLY if the vasooli call (M3) is verified by 2:30.
        It adds Creativity (the promotion mechanism) + narrated Impact (recovery-rate lever) — never the live scored call.
      </div>
      <h1 className="text-xl font-bold">Persona leaderboard</h1>
      <table className="w-full overflow-hidden rounded-lg border bg-white text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr><th className="p-2">Persona</th><th className="p-2">Calls</th><th className="p-2">Recovery rate</th><th className="p-2">Avg turns</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t">
              <td className="p-2 font-medium">{r.name}</td>
              <td className="p-2">{r.calls}</td>
              <td className="p-2">{r.recoveryRate == null ? "—" : `${Math.round(r.recoveryRate * 100)}%`}</td>
              <td className="p-2">{r.avgTurns ?? "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="p-3 text-gray-400" colSpan={4}>Seed the DB to load personas.</td></tr>}
        </tbody>
      </table>
      <p className="text-xs text-gray-500">
        Next: (1) tag each call with personaId, (2) auto-score at hangup, (3) &quot;Coach&quot; pass → learnings,
        (4) human-gated &quot;Promote&quot; → shared Playbook, (5) before/after re-run on one seeded case.
      </p>
    </div>
  );
}
