// Seeds the demo world: catalogue + the three golden-case customers (IDEA_SCOPE.md §9).
// Run: npm run db:seed  (after npm run db:push)
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Fixed simulated "now" so the demo is deterministic.
const SIM_NOW = new Date("2026-07-26T10:00:00+05:30");
const daysAgo = (n: number) => new Date(SIM_NOW.getTime() - n * 86_400_000);

async function main() {
  await prisma.$transaction([
    prisma.payment.deleteMany(),
    prisma.promise.deleteMany(),
    prisma.due.deleteMany(),
    prisma.order.deleteMany(),
    prisma.interaction.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.product.deleteMany(),
    prisma.persona.deleteMany(),
    prisma.learning.deleteMany(),
  ]);

  await prisma.demoClock.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", simDate: SIM_NOW },
    update: { simDate: SIM_NOW },
  });

  await prisma.product.createMany({
    data: [
      { name: "Aashirvaad Atta 5kg", nameHi: "आटा ५ किलो", price: 250, category: "Staples" },
      { name: "Basmati Rice 1kg", nameHi: "बासमती चावल", price: 120, category: "Staples" },
      { name: "Toor Dal 1kg", nameHi: "तूर दाल", price: 160, category: "Staples" },
      { name: "Fortune Oil 1L", nameHi: "तेल १ लीटर", price: 140, category: "Staples" },
      { name: "Amul Milk 1L", nameHi: "दूध १ लीटर", price: 66, category: "Dairy" },
      { name: "Sugar 1kg", nameHi: "चीनी", price: 45, category: "Staples" },
      { name: "Tata Tea 250g", nameHi: "चाय", price: 130, category: "Beverages" },
      { name: "Parle-G Pack", nameHi: "पारले-जी", price: 30, category: "Snacks" },
      { name: "Maggi 4-pack", nameHi: "मैगी", price: 60, category: "Snacks" },
      { name: "Surf Excel 1kg", nameHi: "सर्फ़", price: 110, category: "Household" },
    ],
  });

  // --- Case 1: Rahul — good regular, ONE broken promise. The main demo arc. ---
  const rahul = await prisma.customer.create({
    data: {
      name: "Rahul Sharma", phone: "+919614711534", language: "hi-IN",
      trustScore: 85, escalationStage: "nudged",
      historySummary: "Regular since 8 months. Usually buys atta, dal, Parle-G. Pays within a week normally.",
    },
  });
  // Items sum to EXACTLY the total: 250×4 + 160×3 + 140×2 + 30×3 = 1000+480+280+90 = 1850.
  const rOrder = await prisma.order.create({
    data: { customerId: rahul.id, total: 1850, onKhata: true, simDate: daysAgo(14),
      items: [{ name: "Aashirvaad Atta 5kg", qty: 4, price: 250 }, { name: "Toor Dal 1kg", qty: 3, price: 160 }, { name: "Fortune Oil 1L", qty: 2, price: 140 }, { name: "Parle-G Pack", qty: 3, price: 30 }] as any },
  });
  const rDue = await prisma.due.create({ data: { orderId: rOrder.id, customerId: rahul.id, amount: 1850, balance: 1850, status: "open" } });
  // Broken promise: promised Monday 20 Jul 2026 (daysAgo(6) from Sun 26 Jul), now overdue.
  await prisma.promise.create({ data: { dueId: rDue.id, customerId: rahul.id, promisedDate: daysAgo(6), source: "nudge", kept: false } });
  await prisma.interaction.create({ data: { customerId: rahul.id, surface: "nudge", simTs: daysAgo(9), summary: "Nudged about ₹1850. Replied 'Monday (20 July) tak pakka'.", outcome: "promise_recorded", tone: "warm" } });

  // --- Case 2: Meena — "already paid" dispute. ₹500 partial exists; ₹100 balance. Delight. ---
  const meena = await prisma.customer.create({
    data: { name: "Meena Devi", phone: "+919000000002", language: "hi-IN", trustScore: 90, escalationStage: "called",
      historySummary: "Reliable. Paid ₹500 of ₹600 last week; small balance remains." },
  });
  // Items sum to EXACTLY the total: 130×1 + 66×5 + 140×1 = 130+330+140 = 600.
  const mOrder = await prisma.order.create({ data: { customerId: meena.id, total: 600, onKhata: true, simDate: daysAgo(12), items: [{ name: "Tata Tea 250g", qty: 1, price: 130 }, { name: "Amul Milk 1L", qty: 5, price: 66 }, { name: "Fortune Oil 1L", qty: 1, price: 140 }] as any } });
  const mDue = await prisma.due.create({ data: { orderId: mOrder.id, customerId: meena.id, amount: 600, balance: 100, status: "partial" } });
  await prisma.payment.create({ data: { dueId: mDue.id, amount: 500, status: "paid", paidAt: daysAgo(6) } });

  // --- Case 3: Amit — chronic promise-breaker. Ladder opens FIRM. ---
  const amit = await prisma.customer.create({
    data: { name: "Amit Kumar", phone: "+918587979420", language: "hi-IN", trustScore: 40, escalationStage: "escalated",
      historySummary: "Broke two prior promises. Slow payer. Needs a firm, direct ask." },
  });
  // Items sum to EXACTLY the total: 250×4 + 140×10 = 1000+1400 = 2400.
  const aOrder = await prisma.order.create({ data: { customerId: amit.id, total: 2400, onKhata: true, simDate: daysAgo(25), items: [{ name: "Aashirvaad Atta 5kg", qty: 4, price: 250 }, { name: "Fortune Oil 1L", qty: 10, price: 140 }] as any } });
  const aDue = await prisma.due.create({ data: { orderId: aOrder.id, customerId: amit.id, amount: 2400, balance: 2400, status: "open" } });
  await prisma.promise.createMany({ data: [
    { dueId: aDue.id, customerId: amit.id, promisedDate: daysAgo(14), source: "call", kept: false },
    { dueId: aDue.id, customerId: amit.id, promisedDate: daysAgo(5), source: "nudge", kept: false },
  ] });

  // --- M-Stretch-1 personas + empty shared playbook (unused until gated). ---
  await prisma.persona.createMany({ data: [
    { name: "Warm Didi", promptFragment: "Speak like a caring elder sister. Lead with the relationship, never threaten." },
    { name: "Firm Munim", promptFragment: "Speak like a respectful but no-nonsense accountant. State the amount early, be brief." },
    { name: "Data-driven Negotiator", promptFragment: "Offer a concrete partial-payment plan first; anchor on numbers and dates." },
  ] });
  await prisma.playbook.upsert({ where: { id: "singleton" }, create: { id: "singleton", content: "" }, update: {} });

  // --- Scored-call baseline so the harness leaderboard shows a REAL persona gap on stage. ---
  // createMany returns no ids, so re-fetch personas and map by name.
  const personas = await prisma.persona.findMany();
  const pid = (name: string) => personas.find((p) => p.name === name)!.id;
  const custIds = [rahul.id, meena.id, amit.id];
  const scored = [
    // Warm Didi — leader: recovery ~0.80, avg score ~4.28
    { persona: "Warm Didi", score: 4.5, recovered: 1, turns: 5, sentiment: "positive", outcome: "resolved" },
    { persona: "Warm Didi", score: 4.2, recovered: 1, turns: 6, sentiment: "positive", outcome: "promise_to_pay" },
    { persona: "Warm Didi", score: 4.4, recovered: 1, turns: 4, sentiment: "positive", outcome: "resolved" },
    { persona: "Warm Didi", score: 4.0, recovered: 1, turns: 7, sentiment: "neutral", outcome: "promise_to_pay" },
    { persona: "Warm Didi", score: 4.3, recovered: 0, turns: 6, sentiment: "neutral", outcome: "incomplete" },
    // Data-driven Negotiator — mid: recovery ~0.60, avg score ~3.78
    { persona: "Data-driven Negotiator", score: 3.9, recovered: 1, turns: 6, sentiment: "neutral", outcome: "promise_to_pay" },
    { persona: "Data-driven Negotiator", score: 3.8, recovered: 1, turns: 7, sentiment: "neutral", outcome: "resolved" },
    { persona: "Data-driven Negotiator", score: 3.7, recovered: 0, turns: 8, sentiment: "negative", outcome: "incomplete" },
    { persona: "Data-driven Negotiator", score: 3.9, recovered: 1, turns: 5, sentiment: "positive", outcome: "promise_to_pay" },
    { persona: "Data-driven Negotiator", score: 3.6, recovered: 0, turns: 9, sentiment: "neutral", outcome: "callback" },
    // Firm Munim — lowest: recovery ~0.50, avg score ~3.40
    { persona: "Firm Munim", score: 3.5, recovered: 1, turns: 4, sentiment: "neutral", outcome: "resolved" },
    { persona: "Firm Munim", score: 3.2, recovered: 0, turns: 6, sentiment: "negative", outcome: "refused" },
    { persona: "Firm Munim", score: 3.6, recovered: 1, turns: 5, sentiment: "neutral", outcome: "promise_to_pay" },
    { persona: "Firm Munim", score: 3.3, recovered: 0, turns: 7, sentiment: "negative", outcome: "incomplete" },
  ];
  await prisma.interaction.createMany({
    data: scored.map((s, i) => ({
      customerId: custIds[i % custIds.length],
      surface: "call",
      simTs: daysAgo(3 + (i % 5)),
      summary: `${s.persona}: ${s.outcome.replace(/_/g, " ")} (score ${s.score}/5).`,
      outcome: s.outcome,
      tone: s.persona === "Warm Didi" ? "warm" : s.persona === "Firm Munim" ? "firm" : "neutral",
      personaId: pid(s.persona),
      outcomeScore: s.score,
      recovered: s.recovered,
      turns: s.turns,
      sentiment: s.sentiment,
    })),
  });

  console.log("Seeded: 10 products, 3 customers (Rahul/Meena/Amit), 3 personas,", scored.length, "scored calls. simDate =", SIM_NOW.toISOString());
  console.log("Canonical story — Rahul: ₹1850 due, broke Monday 20-Jul promise. Meena: ₹100 balance of ₹600 (paid ₹500). Amit: ₹2400 due, 2 broken promises.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
