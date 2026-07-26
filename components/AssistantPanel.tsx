"use client";
// Push-to-talk voice harness. OWNER: shared.
// Hold the button -> MediaRecorder captures -> POST /api/voice/turn -> play agent audio.
// Playback uses a plain <audio> element (data URL) so it survives the async gap after the
// mouse-up gesture — a WebAudio AudioContext created post-await is suspended and stays silent.

import { useCallback, useRef, useState } from "react";
import { Avatar, type AgentState } from "./Avatar";
import type { Role, VoiceTurnResponse } from "@/lib/types";

function blobToB64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export function AssistantPanel({ customerId, role }: { customerId: string; role: Role }) {
  const [state, setState] = useState<AgentState>("idle");
  const [tone, setTone] = useState<"warm" | "neutral" | "firm">("neutral");
  const [transcript, setTranscript] = useState("");
  const [agentText, setAgentText] = useState("");
  const [intents, setIntents] = useState<VoiceTurnResponse["intents"]>([]);
  const [latency, setLatency] = useState("");
  const [error, setError] = useState("");

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const turns = useRef<{ role: "user" | "assistant"; content: string }[]>([]); // continued conversation memory

  const start = useCallback(async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      recorder.current = rec;
      rec.start();
      setState("listening");
    } catch (e: any) {
      setError(`mic error: ${e?.message ?? e}. Allow microphone access and use https.`);
      setState("idle");
    }
  }, []);

  const playAudio = useCallback((b64: string) => {
    return new Promise<void>((resolve) => {
      const el = audioEl.current ?? new Audio();
      audioEl.current = el;
      el.src = `data:audio/wav;base64,${b64}`;
      setState("speaking");
      el.onended = () => { setState("idle"); resolve(); };
      el.onerror = () => { setState("idle"); resolve(); };
      el.play().catch(() => {
        setError("tap 'Hold to talk' once to enable audio (browser blocked autoplay), then try again");
        setState("idle");
        resolve();
      });
    });
  }, []);

  const stop = useCallback(async () => {
    const rec = recorder.current;
    if (!rec || rec.state === "inactive") { setState("idle"); return; }
    await new Promise<void>((res) => { rec.onstop = () => res(); rec.stop(); });
    rec.stream.getTracks().forEach((t) => t.stop());
    setState("thinking");

    try {
      const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
      if (blob.size === 0) { setError("no audio captured — hold the button while speaking"); setState("idle"); return; }
      const audioB64 = await blobToB64(blob);

      const res = await fetch("/api/voice/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioB64, mime: "audio/webm", role, turns: turns.current, context: await fetchContext(customerId, role) }),
      });
      setLatency(res.headers.get("x-latency-total") ? `${res.headers.get("x-latency-total")}ms` : "");
      const data = (await res.json()) as VoiceTurnResponse & { error?: string };
      if (!res.ok || data.error) { setError(`server: ${data.error ?? res.status}`); setState("idle"); return; }

      setTranscript(data.transcript); setAgentText(data.agentText); setIntents(data.intents ?? []); setTone(data.tone);
      turns.current = [...turns.current, { role: "user" as const, content: data.transcript }, { role: "assistant" as const, content: data.agentText }].slice(-12);
      if (data.agentAudioB64) await playAudio(data.agentAudioB64);
      else setState("idle");
    } catch (e: any) {
      setError(`request failed: ${e?.message ?? e}`);
      setState("idle");
    }
  }, [customerId, role, playAudio]);

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-khata">Relationship Manager</span>
        {latency && <span className="text-xs text-gray-400">total {latency}</span>}
      </div>
      <Avatar variant="orb" state={state} tone={tone} amplitude={state === "speaking" ? 0.5 : 0} />
      <button
        onMouseDown={start}
        onMouseUp={stop}
        onMouseLeave={() => recorder.current?.state === "recording" && stop()}
        onTouchStart={(e) => { e.preventDefault(); start(); }}
        onTouchEnd={(e) => { e.preventDefault(); stop(); }}
        className="mt-3 w-full select-none rounded-md bg-khata py-3 font-medium text-white active:bg-teal-800"
      >
        {state === "listening" ? "Listening… release to send" : state === "thinking" ? "Thinking…" : "Hold to talk"}
      </button>
      {error && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
      {transcript && <p className="mt-3 text-sm"><span className="text-gray-400">You:</span> {transcript}</p>}
      {agentText && <p className="mt-1 text-sm"><span className="text-gray-400">Agent:</span> {agentText}</p>}
      {intents.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {intents.map((i, k) => <span key={k} className="rounded bg-gray-100 px-2 py-0.5 text-xs">{i.type}</span>)}
        </div>
      )}
    </div>
  );
}

async function fetchContext(customerId: string, role: Role) {
  try {
    const res = await fetch(`/api/context?customerId=${customerId}&role=${role}`);
    if (res.ok) return res.json();
  } catch {}
  return { role, customer: { id: customerId, name: "Customer", language: "hi-IN" }, simDate: new Date().toISOString() };
}
