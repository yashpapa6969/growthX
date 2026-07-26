// Create a Razorpay TEST-MODE payment link mid-call. OWNER: Engineer 2.
// PAYMENT_MOCK_MODE=1 returns a fake link so the arc works before Razorpay is wired.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MOCK = process.env.PAYMENT_MOCK_MODE !== "0";

export async function POST(req: NextRequest) {
  const { dueId, amount, customerName } = await req.json();
  if (!dueId || !amount) return NextResponse.json({ error: "dueId and amount required" }, { status: 400 });

  if (MOCK) {
    // Fallback: a fake link + id. The /call view can show a "Simulate paid" button.
    return NextResponse.json({ id: `plink_mock_${dueId}`, short_url: `${process.env.APP_BASE_URL ?? ""}/call?paid=${dueId}`, mock: true });
  }

  // TODO(Eng2): real Razorpay Payment Links API (test keys).
  //   POST https://api.razorpay.com/v1/payment_links
  //   auth: Basic base64(RAZORPAY_KEY_ID:RAZORPAY_KEY_SECRET)
  //   body: { amount: amount*100, currency: "INR", description, customer, notes: { dueId }, callback_url }
  //   -> persist Payment{ razorpayLinkId } and return { id, short_url }.
  return NextResponse.json({ error: "real Razorpay not wired yet — set PAYMENT_MOCK_MODE=1" }, { status: 501 });
}
