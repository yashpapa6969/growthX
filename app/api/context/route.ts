// GET /api/context?customerId=&role=  -> TurnContext for the voice service. OWNER: Engineer 2.
import { NextRequest, NextResponse } from "next/server";
import { buildTurnContext } from "@/lib/memory";
import type { Role } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  const role = (searchParams.get("role") ?? "call") as Role;
  const personaId = searchParams.get("personaId") ?? undefined;
  if (!customerId) return NextResponse.json({ error: "customerId required" }, { status: 400 });
  try {
    return NextResponse.json(await buildTurnContext(customerId, role, personaId));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "context failed" }, { status: 500 });
  }
}
