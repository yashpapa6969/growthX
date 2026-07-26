"use client";
// Avatar with a swap interface. variant="orb" WORKS now (reliable fallback).
// variant="lottie" is the M4 stretch (Rive/Lottie rig) — hard-cut to "orb" by 3:20 if it fights you.
// The aura COLOR encodes the agent's emotional state -> makes the Voice tone ladder visible (Delight).

import { useEffect, useRef } from "react";

export type AgentState = "idle" | "listening" | "thinking" | "speaking";
export type AvatarTone = "warm" | "neutral" | "firm";

const COLOR: Record<AgentState, Record<AvatarTone, string>> = {
  idle: { warm: "#94a3b8", neutral: "#94a3b8", firm: "#94a3b8" },
  listening: { warm: "#3b82f6", neutral: "#3b82f6", firm: "#3b82f6" },
  thinking: { warm: "#f59e0b", neutral: "#f59e0b", firm: "#f59e0b" },
  speaking: { warm: "#f59e0b", neutral: "#10b981", firm: "#dc2626" },
};

export function Avatar({
  variant = "orb",
  state = "idle",
  tone = "neutral",
  amplitude = 0,
}: {
  variant?: "orb" | "lottie";
  state?: AgentState;
  tone?: AvatarTone;
  amplitude?: number; // 0..1, drive from TTS playback for liveness
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const raf = useRef<number>();
  const ampRef = useRef(0);

  useEffect(() => { ampRef.current = amplitude; }, [amplitude]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || variant !== "orb") return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = 240 * dpr; canvas.height = 240 * dpr; ctx.scale(dpr, dpr);
    let phase = 0;

    const draw = () => {
      const color = COLOR[state][tone];
      const amp = state === "speaking" ? Math.max(ampRef.current, 0.15) : state === "listening" ? 0.25 : 0.1;
      phase += 0.05;
      ctx.clearRect(0, 0, 240, 240);
      const cx = 120, cy = 120;
      const base = 52 + Math.sin(phase) * 3;
      for (let i = 3; i >= 1; i--) {
        ctx.beginPath();
        ctx.arc(cx, cy, base + i * (14 + amp * 26), 0, Math.PI * 2);
        ctx.fillStyle = color + Math.round(28 / i).toString(16).padStart(2, "0");
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, base, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      raf.current = requestAnimationFrame(draw);
    };
    draw();
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [variant, state, tone]);

  if (variant === "lottie") {
    // TODO(M4): render @lottiefiles/dotlottie-react or @rive-app/react-canvas here.
    // Swap loop by `state` (idle/talking/thinking); scale playback speed by `amplitude`.
    return <div className="flex h-60 items-center justify-center rounded-lg bg-gray-100 text-sm text-gray-500">Lottie rig — M4 (falls back to orb)</div>;
  }

  return (
    <div className="flex flex-col items-center">
      <canvas ref={ref} style={{ width: 240, height: 240 }} />
      <div className="text-xs uppercase tracking-wide text-gray-500">{state} · {tone}</div>
    </div>
  );
}
