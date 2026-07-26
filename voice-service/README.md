# voice-service

FastAPI sidecar for the vasooli app:

- **Sarvam voice pipeline** (`/api/voice/turn`): Saaras v3 STT → Sarvam-30B → Bulbul v3 TTS (see `voice_agent.py`).
- **Twilio call recording**: `/incoming` proxies the Twilio number webhook to Sarvam's Samvaad runtime and starts a dual-channel recording (caller = left, agent = right); `/recording-done` saves the finished WAV to `recordings/`.
- **Call-review dashboard** (`/dashboard`): human-in-the-loop QA for the voice agent.
  Diarizes each recording (per-channel VAD → per-utterance Saaras v3 STT), computes
  hard metrics (talk ratio, overlap, interruptions, response latency), runs a
  Sarvam-LLM auto-evaluation (outcome, sentiment, rubric scores, flags), and lets a
  human grade every call (1–5 rubric + tags + notes, stored in SQLite at
  `data/review.db`). API under `/api/review/*` (see `review.py`, `analysis.py`).
  Analyses are cached in `data/analysis/` — re-run with the "Re-analyze" button
  (`?force=true`), and "Swap speakers" if the Customer/Agent labels look reversed.

## Run

```bash
cd voice-service
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env   # fill in keys
.venv/bin/uvicorn server:app --host 0.0.0.0 --port 8000
```

Expose with `ngrok http 8000`, put the ngrok URL in `PUBLIC_BASE_URL`, and point the
Twilio number's **"A call comes in"** webhook at `https://<ngrok>/incoming` (POST).

Recordings: `GET /recordings` lists, `GET /recordings/{name}` downloads.
