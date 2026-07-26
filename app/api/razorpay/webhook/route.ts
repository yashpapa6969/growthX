// Razorpay webhook -> close the khata ledger. OWNER: Engineer 2.
// This is the JTBD "money moved" proof: on payment.captured, update Payment + Due,
// so the agent can verbally confirm the amount on the call.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const raw = await req.text();

  // TODO(Eng2): verify signature BEFORE trusting the body:
  //   const sig = req.headers.get("x-razorpay-signature");
  //   HMAC-SHA256(raw, RAZORPAY_WEBHOOK_SECRET) === sig   (else 400)

  let event: any;
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  if (event?.event === "payment_link.paid" || event?.event === "payment.captured") {
    const dueId: string | undefined = event?.payload?.payment_link?.entity?.notes?.dueId ?? event?.payload?.payment?.entity?.notes?.dueId;
    const paise: number = event?.payload?.payment?.entity?.amount ?? 0;
    const amount = Math.round(paise / 100);

    if (dueId) {
      const due = await prisma.due.findUnique({ where: { id: dueId } });
      if (due) {
        const newBalance = Math.max(0, due.balance - amount);
        await prisma.$transaction([
          prisma.payment.create({ data: { dueId, amount, status: "paid", paidAt: new Date() } }),
          prisma.due.update({ where: { id: dueId }, data: { balance: newBalance, status: newBalance === 0 ? "paid" : "partial" } }),
        ]);
      }
    }
  }
  return NextResponse.json({ ok: true });
}
