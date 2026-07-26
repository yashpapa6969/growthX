// GET /api/customer?customerId=<id>  (or ?phone=<e164>)
// Full customer snapshot for the voice agent: profile, open dues, active promises,
// recent payments, and a most-frequent `usualItems` list derived from past orders.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  const phone = searchParams.get("phone");

  if (!customerId && !phone)
    return NextResponse.json({ error: "customerId or phone required" }, { status: 400 });

  try {
    const customer = customerId
      ? await prisma.customer.findUnique({ where: { id: customerId } })
      : await prisma.customer.findUnique({ where: { phone: phone! } });

    if (!customer) return NextResponse.json({ error: "customer not found" }, { status: 404 });

    const [dues, orders] = await Promise.all([
      prisma.due.findMany({
        where: { customerId: customer.id, status: { not: "paid" } },
        include: {
          promises: { where: { supersededAt: null, kept: false }, orderBy: { promisedDate: "asc" } },
          payments: { where: { status: "paid" }, orderBy: { paidAt: "desc" } },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.order.findMany({
        where: { customerId: customer.id },
        orderBy: { simDate: "desc" },
        take: 50,
      }),
    ]);

    // Most-frequent order items across past orders (by total quantity ordered).
    const freq = new Map<string, number>();
    for (const o of orders) {
      const items = Array.isArray(o.items) ? (o.items as any[]) : [];
      for (const it of items) {
        const name = String(it?.name ?? "").trim();
        if (!name) continue;
        freq.set(name, (freq.get(name) ?? 0) + (Number(it?.qty) || 1));
      }
    }
    const usualItems = Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, qty]) => ({ name, qty }));

    const openDues = dues.map((d) => ({
      id: d.id,
      orderId: d.orderId,
      amount: d.amount,
      balance: d.balance,
      status: d.status,
      createdAt: d.createdAt.toISOString(),
    }));

    const activePromises = dues.flatMap((d) =>
      d.promises.map((p) => ({
        id: p.id,
        dueId: p.dueId,
        promisedDate: p.promisedDate.toISOString(),
        source: p.source,
        kept: p.kept,
      }))
    );

    const recentPayments = dues.flatMap((d) =>
      d.payments.map((p) => ({
        dueId: p.dueId,
        amount: p.amount,
        status: p.status,
        paidOn: (p.paidAt ?? p.createdAt)?.toISOString() ?? null,
      }))
    );

    return NextResponse.json({
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        language: customer.language,
        trustScore: customer.trustScore,
        escalationStage: customer.escalationStage,
        historySummary: customer.historySummary ?? null,
      },
      openDues,
      activePromises,
      recentPayments,
      usualItems,
    });
  } catch (e: any) {
    console.error("[/api/customer]", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
