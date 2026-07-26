"use client";
// Live WhatsApp-style nudge thread. OWNER: Engineer 2.
// Mounts -> generates the agent's opening nudge (role=nudge, text-only). The customer types an
// excuse -> POST /api/voice/turn -> agent parses it to a dated promise. When a record_promise
// intent comes back it is persisted via /api/intents so the promise shows on the /ledger timeline
// and is cited on the later collection call (cross-surface memory evidence).

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ConversationTurn, VoiceTurnResponse } from "@/lib/types";

type Msg = { side: "left" | "right"; text: string };

export function NudgeThread({ customerId, dueId, customerName }: { customerId: string; dueId: string; customerName?: string }) {
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [promised, setPromised] = useState(false);
  const ctx = useRef<any>(null);
  const turns = useRef<ConversationTurn[]>([]);
  const opened = useRef(false);

  async function loadContext() {
    if (ctx.current) return ctx.current;
    const res = await fetch(`/api/context?customerId=${customerId}&role=nudge`);
    ctx.current = res.ok ? await res.json() : null;
    return ctx.current;
  }

  // Generate the opening nudge once.
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    (async () => {
      setBusy(true);
      try {
        const context = await loadContext();
        if (!context) return;
        const res = await fetch("/api/voice/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "nudge", context, text: "" }),
        });
        const data = (await res.json()) as VoiceTurnResponse;
        if (data.agentText) {
          setMsgs([{ side: "left", text: data.agentText }]);
          turns.current = [{ role: "assistant" as const, content: data.agentText }];
        }
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send() {
    const reply = input.trim();
    if (!reply || busy) return;
    setInput("");
    setMsgs((m) => [...m, { side: "right", text: reply }]);
    setBusy(true);
    try {
      const context = await loadContext();
      const res = await fetch("/api/voice/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "nudge", context, text: reply, turns: turns.current }),
      });
      const data = (await res.json()) as VoiceTurnResponse & { error?: string };
      const agentText = data.agentText || "…";
      setMsgs((m) => [...m, { side: "left", text: agentText }]);
      turns.current = [...turns.current, { role: "user" as const, content: reply }, { role: "assistant" as const, content: agentText }].slice(-12);

      const hasPromise = (data.intents ?? []).some((i) => i.type === "record_promise");
      if (data.intents?.length) {
        await fetch("/api/intents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId, intents: data.intents }) });
        if (hasPromise) setPromised(true);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border bg-[#e5ddd5] p-3">
      <div className="mb-2 text-center text-xs text-gray-500">{customerName ?? "Customer"} · khata reminder</div>
      <div className="space-y-2">
        {msgs.map((m, i) => (
          <div key={i} className={m.side === "right" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.side === "right" ? "bg-[#dcf8c6]" : "bg-white"}`}>{m.text}</div>
          </div>
        ))}
        {busy && <div className="flex justify-start"><div className="rounded-lg bg-white px-3 py-2 text-sm text-gray-400">typing…</div></div>}
        {promised && <div className="text-center text-xs text-green-700">✓ Promise recorded — see it on the ledger timeline.</div>}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Type the customer's reply…"
          className="flex-1 rounded-full border px-3 py-2 text-sm outline-none focus:border-khata"
        />
        <button onClick={send} disabled={busy} className="rounded-full bg-khata px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Send</button>
      </div>
    </div>
  );
}
