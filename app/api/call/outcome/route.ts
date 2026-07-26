// POST /api/call/outcome — post-call write-back so the phone call updates the ledger + timeline.
// Called manually after a call (or later by a Sarvam post-call webhook). Dispatches by outcome.
import { NextRequest, NextResponse } from "next/server";
import { KhataError, recordPromise, closeDueByPayment, escalate } from "@/lib/khata";
import { logInteraction } from "@/lib/memory";

export const runtime = "nodejs";

// GET: quick schema check + a marker that the route is deployed.
export async function GET() {
  return NextResponse.json({
    ok: true,
    expects: {
      customerId: "string (from agent_variables)",
      dueId: "string (from agent_variables)",
      outcome: "promise_to_pay | paid | partial | escalation | hardship | refused",
      promised_date: "YYYY-MM-DD (for promise_to_pay)",
      verbatim: "string",
      amount_paid: "number (for paid/partial)",
      reason: "string",
      summary: "string",
    },
  });
}

export async function POST(req: NextRequest) {
  // Log the RAW incoming webhook so we can see Sarvam's exact payload shape in the Railway logs.
  const raw = await req.text();
  console.log("[call/outcome] incoming webhook:", raw);
  let body: any;
  try { body = raw ? JSON.parse(raw) : {}; }
  catch { console.log("[call/outcome] non-JSON body"); return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 }); }

  const { customerId, outcome, dueId, promised_date, verbatim, amount_paid, reason, summary } = body ?? {};

  try {
    if (!customerId) throw new KhataError("customerId required");
    if (!outcome) throw new KhataError("outcome required");

    switch (outcome) {
      case "promise_to_pay": {
        const r = await recordPromise({ customerId, dueId, promised_date, source: "call", verbatim });
        return NextResponse.json({ ok: true, ...r });
      }
      case "paid":
      case "partial": {
        const r = await closeDueByPayment({ dueId, amount: Number(amount_paid) });
        return NextResponse.json({ ok: true, ...r });
      }
      case "escalation":
      case "hardship":
      case "refused": {
        const r = await escalate({ customerId, reason: reason ?? outcome, summary: summary ?? "" });
        await logInteraction({ customerId, surface: "call", outcome, summary: summary ?? `${outcome} on call.` });
        return NextResponse.json({ ...r });
      }
      default: {
        await logInteraction({ customerId, surface: "call", outcome, summary: summary ?? "" });
        return NextResponse.json({ ok: true });
      }
    }
  } catch (e: any) {
    if (e instanceof KhataError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    console.error("[/api/call/outcome]", e);
    return NextResponse.json({ ok: false, error: "internal error" }, { status: 500 });
  }
}
