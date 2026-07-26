// WhatsApp-style nudge surface (simulated, disclosed). OWNER: Engineer 2.
// M2: agent nudge cites the exact order/amount; customer reply -> parsed promise.
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getThread() {
  try {
    const rahul = await prisma.customer.findFirst({ where: { name: "Rahul Sharma" }, include: { dues: true } });
    return rahul;
  } catch { return null; }
}

export default async function InboxPage() {
  const rahul = await getThread();
  const due = rahul?.dues[0];
  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-3 text-xl font-bold">Inbox <span className="text-sm font-normal text-gray-400">(WhatsApp — simulated)</span></h1>
      <div className="space-y-2 rounded-lg border bg-[#e5ddd5] p-3">
        {due ? (
          <>
            <Bubble side="left">
              नमस्ते Rahul जी 🙏 आपका ₹{due.amount} का हिसाब बाकी है (आटा, दाल, तेल)। कोई जल्दी नहीं — बस याद दिला रहा हूँ। कब तक हो पाएगा?
            </Bubble>
            <Bubble side="right">salary aane do bhaiya, Monday tak pakka</Bubble>
            <Bubble side="left">बिल्कुल ठीक है 👍 Monday note कर लिया। धन्यवाद!</Bubble>
          </>
        ) : (
          <p className="p-6 text-center text-sm text-gray-600">Seed the DB to load the thread.</p>
        )}
      </div>
      <p className="mt-3 text-xs text-gray-500">
        TODO(Eng2 · M2): make replies live — POST typed reply to <code>/api/voice/turn</code> with role=&quot;nudge&quot;,
        parse the promise, write a <code>Promise</code>, and show it in the timeline.
      </p>
    </div>
  );
}

function Bubble({ side, children }: { side: "left" | "right"; children: React.ReactNode }) {
  return (
    <div className={side === "right" ? "flex justify-end" : "flex justify-start"}>
      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${side === "right" ? "bg-[#dcf8c6]" : "bg-white"}`}>{children}</div>
    </div>
  );
}
