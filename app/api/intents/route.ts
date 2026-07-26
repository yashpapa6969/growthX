// POST /api/intents — persist structured intents from a voice/nudge turn. OWNER: Engineer 2.
// The web layer builds context + gets intents from /api/voice/turn, then this route
// executes them against the ledger (executeIntent's first caller: /shop orders, /call & /nudge promises).
import { NextRequest, NextResponse } from "next/server";
import { executeIntent } from "@/lib/memory";
import { KhataError } from "@/lib/khata";
import type { Intent } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { customerId, intents } = (await req.json()) as { customerId: string; intents: Intent[] };
    if (!customerId) return NextResponse.json({ error: "customerId required" }, { status: 400 });
    if (!Array.isArray(intents)) return NextResponse.json({ error: "intents must be an array" }, { status: 400 });

    for (const intent of intents) await executeIntent(customerId, intent);

    return NextResponse.json({ ok: true, applied: intents.length });
  } catch (e: any) {
    if (e instanceof KhataError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: e?.message ?? "intents failed" }, { status: 500 });
  }
}
