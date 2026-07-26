// Mint a LiveKit access token for the browser + pre-create the room with metadata so the
// Python agent worker knows which customer this call is for. OWNER: Engineer 1 (LiveKit).
import { NextRequest, NextResponse } from "next/server";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

export const runtime = "nodejs";

const LK_URL = process.env.LIVEKIT_URL ?? "";
const API_KEY = process.env.LIVEKIT_API_KEY ?? "";
const API_SECRET = process.env.LIVEKIT_API_SECRET ?? "";

const httpUrl = (ws: string) => ws.replace(/^wss:/, "https:").replace(/^ws:/, "http:");

export async function POST(req: NextRequest) {
  const { customerId, role = "call" } = await req.json().catch(() => ({}));
  if (!customerId) return NextResponse.json({ error: "customerId required" }, { status: 400 });
  if (!LK_URL || !API_KEY || !API_SECRET) {
    return NextResponse.json({ error: "LiveKit not configured (set LIVEKIT_URL/API_KEY/API_SECRET)" }, { status: 501 });
  }

  const room = `vasooli-${customerId}-${Date.now()}`;
  const metadata = JSON.stringify({ customerId, role });

  // Pre-create the room carrying the customer id — the agent reads ctx.room.metadata on join.
  try {
    const svc = new RoomServiceClient(httpUrl(LK_URL), API_KEY, API_SECRET);
    await svc.createRoom({ name: room, metadata, emptyTimeout: 300, maxParticipants: 4 });
  } catch (e) {
    // Non-fatal: if the room already exists / service call fails, the token still works;
    // the agent falls back to participant metadata.
  }

  const at = new AccessToken(API_KEY, API_SECRET, { identity: `customer-${customerId}`, metadata });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true });
  const token = await at.toJwt();

  return NextResponse.json({ token, url: LK_URL, room });
}
