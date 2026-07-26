"use client";
// Client-side orchestration of the eval suite: fires one /api/evals/run request per case
// with limited concurrency so the grid fills in live and no single request runs long.

import { useState } from "react";

type CaseMeta = { id: number; name: string; scenario: string; callGoal: string; expected: string };
type Result = { pass: boolean; actual: string; reason: string; flags: Record<string, any> };
type Row = { status: "idle" | "running" | "done" | "error"; result?: Result; error?: string };

const CONCURRENCY = 4;

export function EvalRunner({ cases, personas }: { cases: CaseMeta[]; personas: { id: string; name: string }[] }) {
  const [rows, setRows] = useState<Record<number, Row>>({});
  const [running, setRunning] = useState(false);
  const [personaId, setPersonaId] = useState("");

  async function runAll() {
    if (running) return;
    setRunning(true);
    setRows(Object.fromEntries(cases.map((c) => [c.id, { status: "idle" } as Row])));
    const queue = [...cases];
    async function worker() {
      while (queue.length) {
        const c = queue.shift()!;
        setRows((r) => ({ ...r, [c.id]: { status: "running" } }));
        try {
          const res = await fetch("/api/evals/run", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ caseId: c.id, personaId: personaId || undefined }),
          });
          const d = await res.json();
          if (!res.ok) setRows((r) => ({ ...r, [c.id]: { status: "error", error: d.error ?? res.status } }));
          else setRows((r) => ({ ...r, [c.id]: { status: "done", result: { pass: d.pass, actual: d.actual, reason: d.reason, flags: d.flags } } }));
        } catch (e: any) {
          setRows((r) => ({ ...r, [c.id]: { status: "error", error: e?.message ?? "failed" } }));
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRunning(false);
  }

  const done = cases.filter((c) => rows[c.id]?.status === "done");
  const passed = done.filter((c) => rows[c.id]?.result?.pass).length;
  const passRate = done.length ? Math.round((passed / done.length) * 100) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select value={personaId} onChange={(e) => setPersonaId(e.target.value)} disabled={running} className="rounded border px-2 py-1 text-sm">
          <option value="">Default (round-robin persona)</option>
          {personas.map((p) => <option key={p.id} value={p.id}>Persona: {p.name}</option>)}
        </select>
        <button onClick={runAll} disabled={running} className="rounded bg-khata px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {running ? `Running… (${done.length}/${cases.length})` : `Run all ${cases.length} cases`}
        </button>
        {passRate != null && (
          <span className="text-sm font-medium">
            Pass rate: <span className={passRate >= 70 ? "text-green-600" : "text-amber-600"}>{passRate}%</span> ({passed}/{done.length})
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="p-2">#</th><th className="p-2">Scenario</th><th className="p-2">Goal</th>
              <th className="p-2">Expected</th><th className="p-2">Actual</th><th className="p-2">Result</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => {
              const row = rows[c.id];
              const r = row?.result;
              return (
                <tr key={c.id} className="border-t align-top">
                  <td className="p-2 text-gray-400">{c.id}</td>
                  <td className="p-2"><div className="font-medium">{c.name}</div><div className="text-xs text-gray-500">{c.scenario}</div>{r?.reason && <div className="mt-1 text-xs text-gray-400">{r.reason}</div>}</td>
                  <td className="p-2"><span className={c.callGoal === "PASS" ? "text-green-600" : c.callGoal === "FAIL" ? "text-gray-500" : "text-amber-600"}>{c.callGoal}</span></td>
                  <td className="p-2 text-xs">{c.expected}</td>
                  <td className="p-2 text-xs">{r?.actual ?? "—"}</td>
                  <td className="p-2">
                    {!row || row.status === "idle" ? <span className="text-gray-300">·</span>
                      : row.status === "running" ? <span className="text-blue-500">running…</span>
                      : row.status === "error" ? <span className="text-red-600" title={row.error}>error</span>
                      : r?.pass ? <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">PASS</span>
                      : <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">FAIL</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400">
        &quot;Goal&quot; is the business outcome (PASS = payment/promise; FAIL = a correct non-payment close like hardship or refusal).
        &quot;Result&quot; is whether the agent&apos;s actual disposition matched the expected one for that scenario.
      </p>
    </div>
  );
}
