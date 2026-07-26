// POST /api/call/dial { customerId, toNumber? } — dial the customer via Sarvam's hosted agent
// with agent_variables built FROM THE DB, and log a timeline row. The context is provably
// DB-derived (returned in the response so the UI can show it).
import { NextRequest, NextResponse } from "next/server";
import { buildAgentVariables, dialOutbound } from "@/lib/call";
import { logInteraction } from "@/lib/memory";
import { KhataError } from "@/lib/khata";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 }); }

  try {
    const { customerId, toNumber } = body ?? {};
    if (!customerId) throw new KhataError("customerId required");

    const { agentVariables, customer, due } = await buildAgentVariables(customerId);
    const dialed = toNumber || customer.phone;
    if (!dialed) throw new KhataError("no destination phone number");

    const sarvam = await dialOutbound(dialed, agentVariables);

    await logInteraction({
      customerId,
      surface: "call",
      outcome: "call_initiated",
      summary: `Dialed ${customer.name} at ${dialed} — context from khata: ₹${due.balance}, promise ${agentVariables.promise_date || "none"}.`,
    });

    return NextResponse.json({ ok: true, agentVariables, dialed, sarvam });
  } catch (e: any) {
    if (e instanceof KhataError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    console.error("[/api/call/dial]", e);
    return NextResponse.json({ ok: false, error: "internal error" }, { status: 500 });
  }
}
