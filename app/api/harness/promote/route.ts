// POST /api/harness/promote -> human-gated promotion of a learning into the shared Playbook.
// Body: { learningId }. Returns the new Playbook { version, content }. M-Stretch-1 harness.
import { NextRequest, NextResponse } from "next/server";
import { promoteLearning } from "@/lib/harness";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { learningId } = await req.json();
    return NextResponse.json(await promoteLearning(learningId));
  } catch (e: any) {
    console.error("[/api/harness/promote]", e);
    return NextResponse.json({ error: e?.message ?? "promote failed" }, { status: 500 });
  }
}
