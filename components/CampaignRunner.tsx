"use client";
// Fire one scheduler tick (dry-run) and show what the cron would dispatch.
import { useState } from "react";

type Res = { via: string; note: string; action: string; name: string };

export function CampaignRunner() {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Res[] | null>(null);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch("/api/campaigns/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dryRun: true }) });
      const d = await res.json();
      setResults(d.results ?? []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Run scheduler tick (dry-run)</h2>
        <button onClick={run} disabled={busy} className="rounded bg-khata px-3 py-1 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Running…" : "Run now"}
        </button>
      </div>
      {results && (
        <ul className="space-y-1 text-sm">
          {results.map((r, i) => (
            <li key={i} className="rounded border p-2">
              <span className="mr-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs">{r.via}</span>{r.note}
            </li>
          ))}
          {results.length === 0 && <li className="text-gray-400">Nothing dispatched — no one eligible / outside window.</li>}
        </ul>
      )}
      <p className="mt-2 text-xs text-gray-400">Dry-run — logs what would be dispatched. Real calls need a LiveKit SIP trunk + caller number.</p>
    </div>
  );
}
