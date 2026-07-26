// POST /api/evals/run  { caseId, personaId? } -> runs ONE eval case through the real agent
// and returns the graded result. The client orchestrates the suite (one request per case)
// so progress streams in and no single request runs long.
import { NextRequest, NextResponse } from "next/server";
import { runEvalCase } from "@/lib/evals/runner";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { caseId, personaId } = await req.json();
    if (typeof caseId !== "number") return NextResponse.json({ error: "caseId (number) required" }, { status: 400 });
    const result = await runEvalCase(caseId, personaId || undefined);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "eval failed" }, { status: 500 });
  }
}
