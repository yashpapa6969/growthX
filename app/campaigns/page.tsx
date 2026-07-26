// Outbound scheduler view — "where the cron sits". Shows who is eligible to be contacted
// right now (by the escalation ladder + guardrails) and what action the agent would take.
// In production a Railway Cron service POSTs /api/campaigns/run on this same logic; here the
// sim clock (time-jump) drives it. Outbound calls use Option B (LiveKit SIP) — dry-run for now.
import { selectContactList } from "@/lib/campaigns";
import { CampaignRunner } from "@/components/CampaignRunner";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  let data: Awaited<ReturnType<typeof selectContactList>> = { now: "", withinWindow: false, plans: [] };
  try { data = await selectContactList(); } catch {}
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-300 bg-slate-50 p-3 text-sm text-slate-700">
        <strong>Outbound scheduler.</strong> A Railway Cron service calls <code>POST /api/campaigns/run</code> every
        ~15–30 min during calling hours. It selects overdue dues by the escalation ladder (grace → nudge → call) with
        guardrails (grace period, live-promise hold, calling window, tone by history) and dispatches the next action.
        Calls use <strong>Option B — LiveKit SIP</strong>: dial the debtor into a room where <code>agent.py</code> runs
        with their context (so persona A/B, tool-calls, and hangup-scoring all apply). Real dialing needs a SIP trunk +
        caller number; below is a <strong>dry-run</strong>. In the demo, the time-jump (sim clock) stands in for the cron.
      </div>

      <div className="flex items-center gap-3 text-sm">
        <span>Sim clock: <strong>{data.now ? new Date(data.now).toLocaleString("en-GB") : "—"}</strong></span>
        <span className={data.withinWindow ? "text-green-600" : "text-amber-600"}>
          {data.withinWindow ? "within calling window (9am–9pm)" : "outside calling window — cron would skip calls"}
        </span>
      </div>

      <h1 className="text-xl font-bold">Eligible for contact now ({data.plans.length})</h1>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr><th className="p-2">Customer</th><th className="p-2">Balance</th><th className="p-2">Action</th><th className="p-2">Tone</th><th className="p-2">Why</th></tr>
          </thead>
          <tbody>
            {data.plans.map((p) => (
              <tr key={p.dueId} className="border-t">
                <td className="p-2 font-medium">{p.name}<div className="text-xs text-gray-400">{p.phone}</div></td>
                <td className="p-2">₹{p.balance}</td>
                <td className="p-2"><span className={p.action === "call" ? "rounded bg-red-100 px-2 py-0.5 text-xs text-red-700" : "rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700"}>{p.action}</span></td>
                <td className="p-2">{p.tone}</td>
                <td className="p-2 text-xs text-gray-500">{p.reason}</td>
              </tr>
            ))}
            {data.plans.length === 0 && <tr><td className="p-3 text-gray-400" colSpan={5}>No one eligible right now. Time-jump the clock (or reseed) to age dues past grace.</td></tr>}
          </tbody>
        </table>
      </div>

      <CampaignRunner />
    </div>
  );
}
