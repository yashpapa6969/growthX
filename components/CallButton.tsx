"use client";
// "Call now" on the ledger — dials the customer via Sarvam's hosted agent with agent_variables
// built from the DB, and shows exactly what context was sent (proving it's DB-derived).
import { useState } from "react";

export function CallButton({ customerId, phone }: { customerId: string; phone: string }) {
  const [dest, setDest] = useState(phone);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<"idle" | "dialing" | "done" | "error">("idle");
  const [vars, setVars] = useState<Record<string, string> | null>(null);
  const [message, setMessage] = useState("");

  async function call() {
    if (status === "dialing") return;
    setStatus("dialing"); setMessage(""); setVars(null);
    try {
      const res = await fetch("/api/call/dial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, toNumber: dest }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(res.status === 502
          ? "Sarvam voice key missing on server (SARVAM_SAMVAAD_API_KEY). Call not placed."
          : data?.error ?? "Call failed.");
        return;
      }
      setVars(data.agentVariables);
      setStatus("done");
      setMessage(`Dialing ${data.dialed}…`);
    } catch {
      setStatus("error"); setMessage("Network error placing call.");
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {editing ? (
          <input value={dest} onChange={(e) => setDest(e.target.value)} className="rounded border px-2 py-1 text-xs" placeholder="+91…" />
        ) : (
          <span className="text-xs text-gray-500">{dest}</span>
        )}
        <button onClick={() => setEditing((v) => !v)} className="text-xs text-blue-600 underline">{editing ? "done" : "edit #"}</button>
        <button onClick={call} disabled={status === "dialing"} className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-70">
          {status === "dialing" ? "dialing…" : "📞 Call now (real phone)"}
        </button>
      </div>
      {message && <div className={status === "error" ? "text-xs text-red-600" : "text-xs text-gray-600"}>{message}</div>}
      {vars && (
        <div className="rounded border bg-gray-50 p-2">
          <div className="text-xs font-medium uppercase text-gray-400">agent_variables sent (from DB)</div>
          <ul className="text-xs">
            {Object.entries(vars).map(([k, v]) => (
              <li key={k}><span className="text-gray-500">{k}:</span> {v || "—"}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
