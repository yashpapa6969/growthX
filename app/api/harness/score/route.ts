// POST /api/harness/score -> grade one call transcript, persist the scored Interaction (leaderboard row).
// Body: { customerId, personaId, turns, callStart }. M-Stretch-1 harness.
import { NextRequest, NextResponse } from "next/server";
import { scoreCall, recordScoredCall } from "@/lib/harness";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { customerId, personaId, turns, callStart } = body ?? {};
    const score = await scoreCall({ customerId, personaId, turns, callStart });
    await recordScoredCall({ customerId, personaId, score });
    return NextResponse.json({ ok: true, score });
  } catch (e: any) {
    console.error("[/api/harness/score]", e);
    return NextResponse.json({ error: e?.message ?? "score failed" }, { status: 500 });
  }
}
