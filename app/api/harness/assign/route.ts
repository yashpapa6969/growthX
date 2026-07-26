// GET /api/harness/assign?customerId= -> round-robin next active persona for the next scored call.
// M-Stretch-1 harness. assignPersona() is stateless round-robin; customerId is accepted for symmetry.
import { NextRequest, NextResponse } from "next/server";
import { assignPersona } from "@/lib/harness";

export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  try {
    const persona = await assignPersona();
    return NextResponse.json({ personaId: persona?.id ?? null, personaName: persona?.name ?? null });
  } catch (e: any) {
    console.error("[/api/harness/assign]", e);
    return NextResponse.json({ error: e?.message ?? "assign failed" }, { status: 500 });
  }
}
