"""FastAPI server that captures Twilio call recordings for the vasooli app.

Recording capture works on three redundant layers, because calls arrive in
different ways and callbacks can be lost:
  1. /incoming (inbound calls): TwiML proxy to Sarvam's runtime that also
     starts a dual-channel recording on the live call.
  2. Call watcher (all calls, incl. outbound-api from Samvaad's dialer, which
     never hit the number's inbound webhook): polls Twilio for in-progress
     calls and starts a dual-channel recording on any call without one.
  3. Recording sync (safety net): periodically downloads any completed Twilio
     recording missing from ./recordings/ — covers /recording-done callbacks
     lost to a dead/rotated ngrok URL.

Run:
  uvicorn server:app --host 0.0.0.0 --port 8000
"""

import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse, Response

load_dotenv()

# Optional: only needed for the recording webhooks/watcher, not the voice agent.
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN")

RECORDINGS_DIR = Path(__file__).parent / "recordings"
RECORDINGS_DIR.mkdir(exist_ok=True)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    watcher = asyncio.create_task(_call_watcher())
    yield
    watcher.cancel()


app = FastAPI(title="Vasooli Relationship Manager", lifespan=_lifespan)

from payment_tools import router as payment_router  # noqa: E402
from voice_agent import router as voice_router  # noqa: E402

app.include_router(voice_router)
app.include_router(payment_router)

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


# ------------------------------------------------- call watcher + sync ---

_watched: set[str] = set()  # call sids that already have a recording


def _twilio_api() -> str:
    return f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}"


async def _call_watcher() -> None:
    """Poll Twilio for in-progress calls and start a dual-channel recording on
    any call that doesn't have one yet. This is what captures outbound-api
    calls (e.g. Samvaad's dialer), which never touch the number's inbound
    webhook. Every ~60 s it also reconciles finished recordings to disk."""
    poll = float(os.environ.get("RECORDING_POLL_SEC", "3"))
    if not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN) or poll <= 0:
        return
    base = _twilio_api()
    sync_countdown = 0.0
    async with httpx.AsyncClient(auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
                                 timeout=30) as client:
        while True:
            try:
                r = await client.get(f"{base}/Calls.json",
                                     params={"Status": "in-progress", "PageSize": 20})
                for call in r.json().get("calls", []):
                    sid = call["sid"]
                    if sid in _watched:
                        continue
                    # /incoming may have beaten us to it — don't double-record.
                    rr = await client.get(f"{base}/Calls/{sid}/Recordings.json",
                                          params={"PageSize": 1})
                    if rr.json().get("recordings"):
                        _watched.add(sid)
                        continue
                    data = {"RecordingChannels": "dual"}
                    pub = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
                    if pub:
                        data["RecordingStatusCallback"] = f"{pub}/recording-done"
                    resp = await client.post(f"{base}/Calls/{sid}/Recordings.json", data=data)
                    if resp.status_code in (200, 201):
                        _watched.add(sid)
                        print(f"watcher: recording started on {sid} ({call.get('direction')})")
                    else:
                        print(f"watcher: start failed on {sid}: "
                              f"{resp.status_code} {resp.text[:120]}")
                sync_countdown -= poll
                if sync_countdown <= 0:
                    await _sync_recordings(client)
                    sync_countdown = 60.0
            except asyncio.CancelledError:
                raise
            except Exception as e:  # keep the watcher alive through blips
                print(f"watcher error: {e}")
            await asyncio.sleep(poll)


async def _sync_recordings(client: httpx.AsyncClient, page_size: int = 25) -> list[str]:
    """Download completed Twilio recordings that are missing locally.

    Only looks back RECORDING_SYNC_DAYS (default 30) so ancient recordings from
    other projects on the same Twilio account don't flood the dashboard."""
    horizon_days = float(os.environ.get("RECORDING_SYNC_DAYS", "30"))
    fetched: list[str] = []
    r = await client.get(f"{_twilio_api()}/Recordings.json", params={"PageSize": page_size})
    for rec in r.json().get("recordings", []):
        if rec.get("status") != "completed":
            continue
        if int(float(rec.get("duration") or 0)) < 2:  # skip blip recordings
            continue
        sid, call_sid = rec["sid"], rec["call_sid"]
        if any(RECORDINGS_DIR.glob(f"*_{sid}.wav")):
            continue
        try:  # recording creation time ≈ call answer time
            dt = datetime.strptime(rec["date_created"],
                                   "%a, %d %b %Y %H:%M:%S %z").astimezone(timezone.utc)
        except (ValueError, KeyError):
            dt = datetime.now(timezone.utc)
        if (datetime.now(timezone.utc) - dt).days > horizon_days:
            continue
        out = RECORDINGS_DIR / f"{dt.strftime('%Y%m%d-%H%M%S')}_{call_sid}_{sid}.wav"
        resp = await client.get(f"{_twilio_api()}/Recordings/{sid}.wav",
                                follow_redirects=True, timeout=120)
        if resp.status_code == 200:
            out.write_bytes(resp.content)
            fetched.append(out.name)
            print(f"sync: fetched {out.name}")
    return fetched


@app.post("/sync-recordings")
async def sync_recordings_endpoint():
    """Manual reconcile: pull any Twilio recordings missing from ./recordings/."""
    if not (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN):
        raise HTTPException(status_code=500, detail="Twilio credentials not configured")
    async with httpx.AsyncClient(auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
                                 timeout=30) as client:
        fetched = await _sync_recordings(client)
    return {"ok": True, "fetched": fetched}


@app.get("/health")
async def health():
    return {"ok": True}
