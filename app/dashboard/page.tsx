// M-Stretch-1: self-improving harness dashboard — now LIVE.
// Real per-persona leaderboard over scored calls + coach/promote/re-run loop.
// Honest scope: offline eval + human-gated promotion. NO online learning, NO stat-sig claims.
import { prisma } from "@/lib/db";
import { getLeaderboard } from "@/lib/harness";
import { HarnessPanel } from "@/components/HarnessPanel";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let rows: Awaited<ReturnType<typeof getLeaderboard>> = [];
  let learnings: { id: string; play: string; evidence: string | null; observedLift: number | null; promoted: boolean }[] = [];
  let playbook: { content: string; version: number } | null = null;
  let customers: { id: string; name: string }[] = [];
  try {
    rows = await getLeaderboard();
    learnings = (await prisma.learning.findMany({ orderBy: { createdAt: "desc" } })).map((l) => ({
      id: l.id, play: l.play, evidence: l.evidence, observedLift: l.observedLift, promoted: l.promoted,
    }));
    const pb = await prisma.playbook.findUnique({ where: { id: "singleton" } });
    playbook = pb ? { content: pb.content, version: pb.version } : null;
    customers = await prisma.customer.findMany({ select: { id: true, name: true }, orderBy: { trustScore: "desc" } });
  } catch {}

  const pct = (r: number | null) => (r == null ? "—" : `${Math.round(r * 100)}%`);
  const num = (n: number | null, d = 1) => (n == null ? "—" : n.toFixed(d));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
        <strong>Self-improving harness.</strong> Personas are A/B-assigned per call and graded at hangup on the same
        4-dim rubric as the offline call-review engine. Coach extracts winning plays; a human promotes one into the
        shared playbook that the next call inherits. Offline eval + human-gated promotion only — no online learning.
      </div>

      <h1 className="text-xl font-bold">Persona leaderboard</h1>
      <table className="w-full overflow-hidden rounded-lg border bg-white text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="p-2">Persona</th><th className="p-2">Calls</th>
            <th className="p-2">Recovery rate</th><th className="p-2">Avg turns</th><th className="p-2">Avg score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.personaId} className={`border-t ${idx === 0 && r.avgScore != null ? "bg-green-50" : ""}`}>
              <td className="p-2 font-medium">{r.name}{idx === 0 && r.avgScore != null && <span className="ml-2 text-xs text-green-600">▲ leader</span>}</td>
              <td className="p-2">{r.calls}</td>
              <td className="p-2">{pct(r.recoveryRate)}</td>
              <td className="p-2">{num(r.avgTurns, 1)}</td>
              <td className="p-2">{r.avgScore == null ? "—" : `${r.avgScore.toFixed(2)}/5`}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="p-3 text-gray-400" colSpan={5}>Seed the DB to load personas.</td></tr>}
        </tbody>
      </table>

      <HarnessPanel initialLearnings={learnings} playbook={playbook} customers={customers} />
    </div>
  );
}
