"use client";
// Push-to-talk voice harness (the risky audio glue, given working). OWNER: shared.
// Hold the button -> MediaRecorder captures -> POST /api/voice/turn -> play agent audio,
// drive the Avatar amplitude from the TTS playback via an AnalyserNode.

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
  const [amp, setAmp] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [agentText, setAgentText] = useState("");
  const [intents, setIntents] = useState<VoiceTurnResponse["intents"]>([]);
  const [latency, setLatency] = useState<string>("");

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
    chunks.current = [];
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = () => stream.getTracks().forEach((t) => t.stop());
    rec.start();
    recorder.current = rec;
    setState("listening");
  }, []);

  const playAudio = useCallback(async (b64: string) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const audioCtx = new AudioContext();
    const buf = await audioCtx.decodeAudioData(bytes.buffer);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser); analyser.connect(audioCtx.destination);
    const data = new Uint8Array(analyser.frequencyBinCount);
    setState("speaking");
    const tick = () => {
      analyser.getByteFrequencyData(data);
      setAmp(Math.min(1, data.reduce((a, b) => a + b, 0) / data.length / 128));
      if (audioCtx.state !== "closed") requestAnimationFrame(tick);
    };
    tick();
    src.onended = () => { setState("idle"); setAmp(0); audioCtx.close(); };
    src.start();
  }, []);

  const stop = useCallback(async () => {
    const rec = recorder.current;
    if (!rec) return;
    await new Promise<void>((res) => { rec.onstop = () => res(); rec.stop(); });
    setState("thinking");

    const blob = new Blob(chunks.current, { type: "audio/webm" });
    const audioB64 = await blobToB64(blob);

    // Web builds context server-side from customerId; we pass a thin ref here.
    const res = await fetch("/api/voice/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioB64, mime: "audio/webm", role, context: await fetchContext(customerId, role) }),
    });
    setLatency(res.headers.get("x-latency-total") ? `${res.headers.get("x-latency-total")}ms` : "");
    const data = (await res.json()) as VoiceTurnResponse;
    setTranscript(data.transcript); setAgentText(data.agentText); setIntents(data.intents ?? []); setTone(data.tone);
    if (data.agentAudioB64) await playAudio(data.agentAudioB64);
    else setState("idle");
  }, [customerId, role, playAudio]);

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-khata">Relationship Manager</span>
        {latency && <span className="text-xs text-gray-400">total {latency}</span>}
      </div>
      <Avatar variant="orb" state={state} tone={tone} amplitude={amp} />
      <button
        onMouseDown={start}
        onMouseUp={stop}
        onTouchStart={start}
        onTouchEnd={stop}
        className="mt-3 w-full rounded-md bg-khata py-3 font-medium text-white active:bg-teal-800"
      >
        {state === "listening" ? "Listening… release to send" : "Hold to talk"}
      </button>
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

// TODO(Eng2): expose GET /api/context?customerId&role that returns buildTurnContext(...).
async function fetchContext(customerId: string, role: Role) {
  const res = await fetch(`/api/context?customerId=${customerId}&role=${role}`);
  if (res.ok) return res.json();
  // Minimal fallback so the panel works before /api/context exists.
  return { role, customer: { id: customerId, name: "Customer", language: "hi-IN" }, simDate: new Date().toISOString() };
}
