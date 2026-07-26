# livekit-agent — real-time Vasooli voice agent

LiveKit worker + Sarvam plugins (Saaras STT · Sarvam-30B · Bulbul TTS) with native
turn-taking and barge-in. The browser joins a LiveKit room via the web app's
`/api/livekit/token`; this worker auto-dispatches in, reads room metadata
`{customerId, role}`, fetches the khata from `WEB_BASE_URL/api/context`, and completes
the job through function tools that call `WEB_BASE_URL/api/khata`.

## Local

```bash
cd livekit-agent
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env          # fill LIVEKIT_*, SARVAM_API_KEY, WEB_BASE_URL
.venv/bin/python agent.py console      # talk in the terminal (no browser needed)
.venv/bin/python agent.py dev          # run as a worker against LiveKit Cloud
```

Open the browser client at `<web-app>/live`, pick a customer, Start live call.

## Deploy (Railway, separate service)

The worker connects OUT to LiveKit Cloud (no public traffic needed) but binds `$PORT`
for Railway's health check. Deploy this folder as its own service with env:
`LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, SARVAM_API_KEY, WEB_BASE_URL, VOICE_AGENT_SPEAKER`.

## Tool contract (implemented by the web app, branch `feature/tool-calls`)

- `POST /api/khata` `{action: place_on_khata|record_promise|acknowledge_partial|escalate, ...}`
- `POST /api/razorpay/link` `{dueId, amount}`
- `GET /api/context?customerId&role` — the khata injected as agent memory
