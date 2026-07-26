"use client";
// Harness control surface (M-Stretch-1). OWNER: Engineer 1.
// Run Coach -> learnings; Promote a learning -> shared Playbook (versioned) the next call inherits;
// Re-run a scripted case -> shows before/after lift. All actions hit /api/harness/* then refresh.

import { useState } from "react";
import { useRouter } from "next/navigation";

type Learning = { id: string; play: string; evidence: string | null; observedLift: number | null; promoted: boolean };
type Playbook = { content: string; version: number } | null;
type Customer = { id: string; name: string };

export function HarnessPanel({ initialLearnings, playbook, customers }: { initialLearnings: Learning[]; playbook: Playbook; customers: Customer[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [rerun, setRerun] = useState<{ name: string; outcomeScore: number; recovered: number; outcome: string } | null>(null);

  async function post(path: string, body?: any) {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return res.ok ? res.json() : null;
  }

  async function coach() {
    setBusy("coach");
    try { await post("/api/harness/coach"); router.refresh(); } finally { setBusy(""); }
  }
  async function promote(id: string) {
    setBusy(id);
    try { await post("/api/harness/promote", { learningId: id }); router.refresh(); } finally { setBusy(""); }
  }
  async function doRerun(c: Customer) {
    setBusy(`rerun-${c.id}`);
    try {
      const r = await post("/api/harness/rerun", { customerId: c.id });
      if (r?.score) setRerun({ name: c.name, outcomeScore: r.score.outcomeScore, recovered: r.score.recovered, outcome: r.score.outcome });
      router.refresh();
    } finally { setBusy(""); }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Coach + learnings */}
      <div className="rounded-lg border bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Coach → learnings</h2>
          <button onClick={coach} disabled={!!busy} className="rounded bg-khata px-3 py-1 text-sm font-medium text-white disabled:opacity-50">
            {busy === "coach" ? "Analysing…" : "Run Coach"}
          </button>
        </div>
        <ul className="space-y-2">
          {initialLearnings.map((l) => (
            <li key={l.id} className="rounded border p-2 text-sm">
              <div className="font-medium">{l.play}</div>
              {l.evidence && <div className="text-xs text-gray-500">{l.evidence}</div>}
              <div className="mt-1 flex items-center justify-between">
                <span className="text-xs text-gray-400">lift {l.observedLift == null ? "—" : `${Math.round(l.observedLift * 100)}%`}</span>
                {l.promoted
                  ? <span className="text-xs text-green-600">✓ promoted</span>
                  : <button onClick={() => promote(l.id)} disabled={!!busy} className="rounded bg-green-600 px-2 py-0.5 text-xs text-white disabled:opacity-50">{busy === l.id ? "…" : "Promote"}</button>}
              </div>
            </li>
          ))}
          {initialLearnings.length === 0 && <li className="text-sm text-gray-400">No learnings yet — run Coach over the scored calls.</li>}
        </ul>
      </div>

      {/* Playbook + before/after re-run */}
      <div className="space-y-4">
        <div className="rounded-lg border bg-white p-4">
          <h2 className="mb-1 font-semibold">Shared playbook <span className="text-xs font-normal text-gray-400">v{playbook?.version ?? 1}</span></h2>
          {playbook?.content
            ? <pre className="whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs">{playbook.content}</pre>
            : <p className="text-sm text-gray-400">Empty — promote a learning to add the first tactic all personas inherit.</p>}
        </div>
        <div className="rounded-lg border bg-white p-4">
          <h2 className="mb-2 font-semibold">Before / after re-run</h2>
          <div className="flex flex-wrap gap-2">
            {customers.map((c) => (
              <button key={c.id} onClick={() => doRerun(c)} disabled={!!busy} className="rounded border px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50">
                {busy === `rerun-${c.id}` ? "Running…" : `Re-run ${c.name}`}
              </button>
            ))}
          </div>
          {rerun && (
            <p className="mt-2 text-sm">
              {rerun.name}: score <strong>{rerun.outcomeScore.toFixed(2)}/5</strong> · {rerun.recovered ? "recovered ✓" : "no recovery"} · {rerun.outcome}
            </p>
          )}
          <p className="mt-1 text-xs text-gray-400">Re-run once, Promote a play, then re-run again to see the lift on the leaderboard.</p>
        </div>
      </div>
    </div>
  );
}
