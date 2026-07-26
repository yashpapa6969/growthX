// POST /api/harness/coach -> coach pass over recent scored calls -> 1-3 reusable plays (learnings).
// M-Stretch-1 harness. No body required.
import { NextResponse } from "next/server";
import { runCoach } from "@/lib/harness";

export const runtime = "nodejs";

export async function POST() {
  try {
    return NextResponse.json(await runCoach());
  } catch (e: any) {
    console.error("[/api/harness/coach]", e);
    return NextResponse.json({ error: e?.message ?? "coach failed" }, { status: 500 });
  }
}
