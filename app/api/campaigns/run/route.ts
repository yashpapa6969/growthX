// POST /api/campaigns/run  { dryRun?: boolean }  -> one scheduler tick.
// This is the endpoint a Railway Cron service calls every ~15-30 min during calling hours.
// It selects overdue dues by the escalation ladder + guardrails and dispatches the next
// action (WhatsApp nudge / LiveKit-SIP outbound call). DRY-RUN by default (no real telephony).
import { NextRequest, NextResponse } from "next/server";
import { runCampaign } from "@/lib/campaigns";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dryRun !== false; // default true — real dialing needs a SIP trunk
    return NextResponse.json(await runCampaign(dryRun));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "campaign run failed" }, { status: 500 });
  }
}
