# Vasooli — Kirana Relationship Manager

The agent that takes the order is the agent that collects the payment. One governed memory
across ordering, a WhatsApp-style nudge, and a voice call. Built for the Sarvam Epoch Buildathon.

**Control plane:** [`IDEA_SCOPE.md`](./IDEA_SCOPE.md). Read it before changing anything.
**Disclosure (say it in the demo):** WhatsApp and the call are *simulated surfaces in this app* — the voice AI, the memory, and the payment are real.

## Stack

Next.js (App Router, TS) · Prisma + Postgres · Sarvam (Saaras v3 STT · Sarvam-30B · Bulbul v3 TTS) · Razorpay test mode · Railway.

Voice is **push-to-talk over HTTP** (`/api/voice/turn`) — no WebSocket for the MVP.

## Run locally

```bash
npm install
cp .env.example .env            # fill SARVAM_API_KEY + DATABASE_URL (see note below)
npm run db:push                 # create tables
npm run db:seed                 # load catalogue + Rahul/Meena/Amit golden cases
npm run dev                     # http://localhost:3000
```

`VOICE_MOCK_MODE=1` (default) runs the whole app with **no Sarvam key** — canned transcript/reply,
no TTS audio. Flip to `0` the moment the M0 round-trip passes. `PAYMENT_MOCK_MODE=1` fakes the
Razorpay link + a "mark paid" path until the webhook is verified.

> **Secrets:** never commit `.env`. The Sarvam key lives only in `.env` (git-ignored) and Railway
> env vars. `.mcp.json` reads it via `${SARVAM_API_KEY}` expansion — export it in your shell for the MCP.

## Surfaces

| Route | What | Owner |
|---|---|---|
| `/shop` | Voice-order on khata (seeds memory) | Eng 2 UI · Eng 1 voice |
| `/inbox` | WhatsApp-sim nudge → excuse → promise | Eng 2 |
| `/call` | The vasooli call (scored Voice surface) | Eng 1 |
| `/ledger` | Khata + unified cross-surface timeline | Eng 2 |
| `/dashboard` | M-Stretch-1 harness (gated) | — |

## The one contract to keep in sync

`lib/types.ts` — voice service is **stateless**. Web builds `TurnContext` from the DB (`/api/context`),
`/api/voice/turn` returns transcript + agent speech + `intents`, web executes them (`lib/memory.ts`).

- **Engineer 1:** `app/api/voice/turn`, `lib/sarvam.ts`. Confirm STT/TTS field names at M0 (marked in `sarvam.ts`).
- **Engineer 2:** `lib/memory.ts`, the four views, `app/api/razorpay/*`, `app/api/clock`, the seed/reset.

## Deploy (Railway)

1. New project → deploy from `yashpapa6969/growthX`.
2. Add the **Postgres** plugin → it sets `DATABASE_URL`.
3. Set env vars: `SARVAM_API_KEY`, `VOICE_MOCK_MODE`, `RAZORPAY_*`, `APP_BASE_URL` (the Railway URL).
4. First deploy runs `prisma generate && next build`. Then run `npx prisma db push` and `npm run db:seed` against the Railway DB (one-off).
5. Point the Razorpay webhook at `https://<railway-url>/api/razorpay/webhook`.
