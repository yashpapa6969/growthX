// Demo clock — GET reads simulated date, POST advances it. OWNER: Engineer 2.
import { NextRequest, NextResponse } from "next/server";
import { advanceDays, getSimDate } from "@/lib/memory";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ simDate: (await getSimDate()).toISOString() });
}

export async function POST(req: NextRequest) {
  const { days } = await req.json().catch(() => ({ days: 1 }));
  const simDate = await advanceDays(Number(days) || 1);
  return NextResponse.json({ simDate: simDate.toISOString() });
}
