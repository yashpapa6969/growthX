// POST /api/harness/rerun -> deterministic scripted re-run through the live prompt+LLM, then scored.
// Body: { customerId }. Used for before/after promotion lift. M-Stretch-1 harness.
import { NextRequest, NextResponse } from "next/server";
import { runScriptedCall } from "@/lib/harness";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { customerId } = await req.json();
    return NextResponse.json({ score: await runScriptedCall(customerId) });
  } catch (e: any) {
    console.error("[/api/harness/rerun]", e);
    return NextResponse.json({ error: e?.message ?? "rerun failed" }, { status: 500 });
  }
}
