// POST /api/khata — the tool-call surface the LiveKit voice agent invokes.
// Dispatches on body.action: place_on_khata | record_promise | acknowledge_partial | escalate.
// All writes go through lib/khata.ts (shared with executeIntent). Never throws a raw 500.
import { NextRequest, NextResponse } from "next/server";
import {
  KhataError,
  placeOnKhata,
  recordPromise,
  acknowledgePartial,
  escalate,
} from "@/lib/khata";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const action = body?.action;
  if (!action) return NextResponse.json({ ok: false, error: "action required" }, { status: 400 });

  try {
    switch (action) {
      case "place_on_khata": {
        const r = await placeOnKhata({
          customerId: body.customerId,
          items: body.items,
          total_inr: body.total_inr,
        });
        return NextResponse.json({ ok: true, ...r });
      }
      case "record_promise": {
        const r = await recordPromise({
          customerId: body.customerId,
          dueId: body.dueId,
          promised_date: body.promised_date,
          source: body.source,
          verbatim: body.verbatim,
        });
        return NextResponse.json({ ok: true, ...r });
      }
      case "acknowledge_partial": {
        const r = await acknowledgePartial({ dueId: body.dueId });
        return NextResponse.json({ ok: true, ...r });
      }
      case "escalate": {
        const r = await escalate({
          customerId: body.customerId,
          reason: body.reason,
          summary: body.summary,
        });
        return NextResponse.json(r);
      }
      default:
        return NextResponse.json({ ok: false, error: `unknown action: ${action}` }, { status: 400 });
    }
  } catch (e: any) {
    if (e instanceof KhataError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    console.error("[/api/khata]", action, e);
    return NextResponse.json({ ok: false, error: "internal error" }, { status: 500 });
  }
}
