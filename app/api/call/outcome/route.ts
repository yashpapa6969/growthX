// POST /api/call/outcome — post-call write-back so the phone call updates the ledger + timeline.
// Called manually after a call (or later by a Sarvam post-call webhook). Dispatches by outcome.
import { NextRequest, NextResponse } from "next/server";
import { KhataError, recordPromise, closeDueByPayment, escalate } from "@/lib/khata";
import { logInteraction } from "@/lib/memory";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 }); }

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
