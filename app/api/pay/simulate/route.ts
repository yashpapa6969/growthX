// Simulated payment — the reliable stand-in for the Razorpay webhook on stage.
// Hits the EXACT same ledger code path (closeDueByPayment) so the /ledger timeline
// flips identically whether money moved via webhook or this button.
import { NextRequest, NextResponse } from "next/server";
import { closeDueByPayment, KhataError } from "@/lib/khata";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { dueId, amount } = await req.json().catch(() => ({}));
    const result = await closeDueByPayment({ dueId, amount: Number(amount) || 0, source: "sim" });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof KhataError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
