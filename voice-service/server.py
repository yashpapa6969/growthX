"""FastAPI server that receives Twilio recording callbacks and saves call recordings.

Flow:
  1. You start a call with Record=true, RecordingChannels=dual,
     RecordingStatusCallback=https://<public-url>/recording-done
  2. When the recording is ready, Twilio POSTs here.
  3. We download the dual-channel WAV (caller=left, agent=right) into ./recordings/

Run:
  uvicorn server:app --host 0.0.0.0 --port 8000
"""

import asyncio
import os
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse, Response

load_dotenv()

# Optional: only needed for the /recording-done Twilio webhook, not the voice agent.
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN")

RECORDINGS_DIR = Path(__file__).parent / "recordings"
RECORDINGS_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Vasooli Relationship Manager")

from voice_agent import router as voice_router  # noqa: E402

app.include_router(voice_router)

from review import router as review_router  # noqa: E402

app.include_router(review_router)


@app.get("/")
async def index():
    return RedirectResponse("/dashboard")


@app.get("/dashboard")
async def dashboard():
    return FileResponse(Path(__file__).parent / "static" / "dashboard.html", media_type="text/html")


@app.post("/recording-done")
async def recording_done(
    RecordingSid: str = Form(...),
    RecordingUrl: str = Form(...),
    RecordingStatus: str = Form(...),
    CallSid: str = Form(""),
    RecordingDuration: str = Form("0"),
):
    """Twilio RecordingStatusCallback webhook."""
    if not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN):
        raise HTTPException(status_code=500, detail="Twilio credentials not configured")
    if RecordingStatus != "completed":
        return {"ok": True, "ignored": RecordingStatus}

    # RecordingUrl has no extension; append .wav for dual-channel PCM WAV
    wav_url = f"{RecordingUrl}.wav"
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    out_path = RECORDINGS_DIR / f"{ts}_{CallSid or 'call'}_{RecordingSid}.wav"

    async with httpx.AsyncClient(auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)) as client:
        # Recording may take a moment to be fetchable; Twilio retries the
        # callback on 5xx, so surface failures as 500 to get a retry.
        resp = await client.get(wav_url, follow_redirects=True, timeout=120)
        if resp.status_code != 200:
            raise HTTPException(status_code=500, detail=f"download failed: {resp.status_code}")
        out_path.write_bytes(resp.content)

    print(f"saved {out_path} ({RecordingDuration}s)")
    return {"ok": True, "saved": str(out_path)}


@app.get("/recordings")
async def list_recordings():
    files = sorted(RECORDINGS_DIR.glob("*.wav"), reverse=True)
    return [
        {"name": f.name, "size_bytes": f.stat().st_size, "url": f"/recordings/{f.name}"}
        for f in files
    ]


@app.get("/recordings/{name}")
async def get_recording(name: str):
    path = RECORDINGS_DIR / Path(name).name  # Path(...).name blocks traversal
    if not path.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(path, media_type="audio/wav")


SARVAM_TWILIO_WEBHOOK = "https://apps.sarvam.ai/api/app-runtime/channels/twilio"


async def _start_recording_when_live(call_sid: str) -> None:
    """Poll the call until it's in-progress, then start a dual-channel recording."""
    base = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
    rec_url = (
        f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}"
        f"/Calls/{call_sid}/Recordings.json"
    )
    data = {"RecordingChannels": "dual"}
    if base:
        data["RecordingStatusCallback"] = f"{base}/recording-done"

    async with httpx.AsyncClient(auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)) as client:
        for _ in range(15):  # ~15 s of retries
            resp = await client.post(rec_url, data=data, timeout=30)
            if resp.status_code in (200, 201):
                print(f"recording started on {call_sid}")
                return
            await asyncio.sleep(1)
        print(f"failed to start recording on {call_sid}: {resp.status_code} {resp.text}")


@app.post("/incoming")
async def incoming(request: Request):
    """TwiML proxy: forward the inbound-call webhook to Sarvam's runtime and
    return its TwiML unchanged, while starting a recording in the background.

    Point the Twilio number's 'A call comes in' webhook here.
    """
    form = dict((await request.form()).items())
    call_sid = form.get("CallSid", "")

    async with httpx.AsyncClient() as client:
        resp = await client.post(SARVAM_TWILIO_WEBHOOK, data=form, timeout=30)

    if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and call_sid:
        asyncio.create_task(_start_recording_when_live(call_sid))

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        media_type=resp.headers.get("content-type", "application/xml"),
    )


@app.post("/call-status")
async def call_status(
    CallSid: str = Form(...),
    CallStatus: str = Form(...),
):
    """Twilio 'Call status changes' webhook.

    The inbound webhook goes straight to Sarvam's runtime, so we can't set
    Record=true in TwiML. Instead, when the call is answered we start a
    recording on the live call via the REST API.
    """
    if not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN):
        raise HTTPException(status_code=500, detail="Twilio credentials not configured")
    if CallStatus != "in-progress":
        return {"ok": True, "ignored": CallStatus}

    base = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
    url = (
        f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}"
        f"/Calls/{CallSid}/Recordings.json"
    )
    data = {"RecordingChannels": "dual"}
    if base:
        data["RecordingStatusCallback"] = f"{base}/recording-done"

    async with httpx.AsyncClient(auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)) as client:
        resp = await client.post(url, data=data, timeout=30)
        if resp.status_code not in (200, 201):
            raise HTTPException(status_code=500, detail=f"start recording failed: {resp.text}")

    print(f"recording started on {CallSid}")
    return {"ok": True, "recording": "started"}


@app.get("/health")
async def health():
    return {"ok": True}
