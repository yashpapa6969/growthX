"use client";
// Mark-paid button — POSTs to the sim payment route (same code path as the webhook),
// then refreshes the server components so the ledger balance + timeline update in place.
import { useState } from "react";
import { useRouter } from "next/navigation";

export function PayButton({ dueId, amount, label }: { dueId: string; amount?: number; label?: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "paying" | "paid">("idle");

  async function pay() {
    if (status !== "idle") return;
    setStatus("paying");
    try {
      const res = await fetch("/api/pay/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueId, amount }),
      });
      if (!res.ok) { setStatus("idle"); return; }
      setStatus("paid");
      router.refresh();
    } catch {
      setStatus("idle");
    }
  }

  return (
    <button
      onClick={pay}
      disabled={status !== "idle"}
      className="rounded-md border border-green-600 bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-70"
    >
      {status === "paying" ? "paying…" : status === "paid" ? "paid ✓" : label ?? "Simulate paid"}
    </button>
  );
}
