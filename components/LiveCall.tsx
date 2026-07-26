"use client";
// Real-time voice via LiveKit (WebSocket/WebRTC). The Python agent worker joins the room
// and streams Saaras STT -> Sarvam-30B -> Bulbul TTS with native turn-taking + barge-in.
// This replaces push-to-talk: the mic stays open and you can interrupt the agent.
import { useRef, useState } from "react";
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";

type Cust = { id: string; name: string; language: string; escalationStage: string };

export function LiveCall({ customers }: { customers: Cust[] }) {
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [error, setError] = useState("");
  const [cid, setCid] = useState(customers[0]?.id ?? "");
  const [role, setRole] = useState<"order" | "call">("call");
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const roomRef = useRef<Room | null>(null);

  const start = async () => {
    setError(""); setStatus("connecting");
    try {
      const res = await fetch("/api/livekit/token", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: cid, role }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || `token ${res.status}`); setStatus("error"); return; }

      const room = new Room({ adaptiveStream: true });
      roomRef.current = room;
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach(); el.autoplay = true; (el as HTMLMediaElement).play?.().catch(() => {});
          document.getElementById("lk-audio")?.appendChild(el);
        }
      });
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) =>
        setAgentSpeaking(speakers.some((s) => s.identity !== `customer-${cid}`)));
      room.on(RoomEvent.Disconnected, () => setStatus("idle"));

      await room.connect(data.url, data.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      setStatus("live");
    } catch (e: any) {
      setError(e?.message ?? String(e)); setStatus("error");
    }
  };

  const stop = async () => { await roomRef.current?.disconnect(); roomRef.current = null; setStatus("idle"); };

  const live = status === "live";
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-semibold text-khata">Live Relationship Manager</span>
        <span className="text-xs uppercase text-gray-400">{status}{live && agentSpeaking ? " · speaking" : live ? " · listening" : ""}</span>
      </div>

      <div className={`mx-auto mb-3 h-40 w-40 rounded-full transition-transform ${live && agentSpeaking ? "scale-110 bg-teal-500" : live ? "scale-100 bg-blue-400" : "bg-gray-300"}`} />

      <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
        <select disabled={live} value={cid} onChange={(e) => setCid(e.target.value)} className="rounded border px-2 py-1">
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.escalationStage}</option>)}
        </select>
        <select disabled={live} value={role} onChange={(e) => setRole(e.target.value as any)} className="rounded border px-2 py-1">
          <option value="call">Collection call</option>
          <option value="order">Take an order</option>
        </select>
      </div>

      {!live ? (
        <button onClick={start} disabled={status === "connecting" || !cid} className="w-full rounded-md bg-khata py-3 font-medium text-white disabled:opacity-50">
          {status === "connecting" ? "Connecting…" : "Start live call"}
        </button>
      ) : (
        <button onClick={stop} className="w-full rounded-md bg-khata-firm py-3 font-medium text-white">End call</button>
      )}

      {error && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
      <p className="mt-2 text-xs text-gray-400">Mic stays open — you can interrupt the agent (barge-in). Allow microphone + use headphones.</p>
      <div id="lk-audio" />
    </div>
  );
}
