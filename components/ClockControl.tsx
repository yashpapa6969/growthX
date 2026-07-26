"use client";
// Demo clock control (header bar) — reads the simulated date and advances it. Advancing
// re-reads all server components (router.refresh) so overdue states light up on cue.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

function fmt(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function ClockControl() {
  const router = useRouter();
  const [simDate, setSimDate] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/clock")
      .then((r) => r.json())
      .then((d) => setSimDate(d.simDate))
      .catch(() => {});
  }, []);

  async function advance(days: number) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      });
      const d = await res.json();
      if (d?.simDate) setSimDate(d.simDate);
      router.refresh();
    } catch {
      // non-fatal
    } finally {
      setBusy(false);
    }
  }

  const btn = "rounded border px-2 py-1 text-xs text-gray-600 hover:text-khata disabled:opacity-50";

  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      <span className="hidden sm:inline">
        sim: <span className="font-medium text-gray-700">{simDate ? fmt(simDate) : "…"}</span>
      </span>
      <button className={btn} disabled={busy} onClick={() => advance(1)}>+1 day</button>
      <button className={btn} disabled={busy} onClick={() => advance(3)}>+3 days</button>
      <button className={btn} disabled={busy} onClick={() => advance(5)}>Jump to overdue</button>
    </div>
  );
}
