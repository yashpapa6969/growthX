"""Vasooli real-time voice agent — LiveKit worker + Sarvam plugins.

The browser joins a LiveKit room (via /api/livekit/token on the web app). This worker
auto-dispatches into the room, reads room metadata {customerId, role}, fetches that
customer's khata from the web backend (/api/context), builds the collection-agent
instructions, and runs Saaras STT -> Sarvam-30B -> Bulbul TTS with native turn-taking
and barge-in. Function tools call the web backend to actually complete the job.

Run locally:  python agent.py console      (talk to it in the terminal)
Run worker:   python agent.py dev|start    (connects to LiveKit Cloud, waits for rooms)

Env: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, SARVAM_API_KEY,
     WEB_BASE_URL (where /api/context and /api/khata live), VOICE_AGENT_SPEAKER.

NOTE: pinned to the livekit-agents 1.x API. If an import/signature differs on your
installed version, run `python agent.py console` and adjust — the error points to it.
"""
import json
import logging
import os
from datetime import datetime, timezone

import httpx
from dotenv import load_dotenv
from livekit.agents import JobContext, WorkerOptions, cli, function_tool, RunContext
from livekit.agents.voice import Agent, AgentSession
from livekit.plugins import openai, sarvam, silero

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("vasooli-agent")

WEB = os.environ.get("WEB_BASE_URL", "http://localhost:3000").rstrip("/")
SPEAKER = os.environ.get("VOICE_AGENT_SPEAKER", "priya")  # bulbul:v3 voice


async def _get(path: str, params: dict) -> dict:
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(f"{WEB}{path}", params=params)
        r.raise_for_status()
        return r.json()


async def _post(path: str, body: dict) -> dict:
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(f"{WEB}{path}", json=body)
        return r.json() if r.headers.get("content-type", "").startswith("application/json") else {"ok": r.is_success}


def _extract_turns(session) -> list:
    """Best-effort transcript extraction for hangup scoring. session.history is a ChatContext
    whose items carry role + text content; shapes differ across livekit-agents versions, so probe
    defensively and keep only clean user/assistant text turns. Never raises."""
    turns: list = []
    try:
        history = getattr(session, "history", None)
        items = getattr(history, "items", None) if history is not None else None
        if items is None and history is not None:
            items = getattr(history, "messages", None) or list(history)
        for it in items or []:
            role = getattr(it, "role", None)
            if role not in ("user", "assistant"):
                continue
            content = getattr(it, "content", None)
            if content is None:
                content = getattr(it, "text", None)
            if isinstance(content, (list, tuple)):
                content = " ".join(str(c) for c in content if c is not None)
            text = str(content).strip() if content is not None else ""
            if text:
                turns.append({"role": role, "content": text})
    except Exception:
        pass
    return turns


def build_instructions(role: str, ctx: dict) -> str:
    """Vasooli collection-agent persona — mirrors voice-service/prompts.py minus the JSON
    output contract (LiveKit uses native function tools instead of emitted intents)."""
    lang = (ctx.get("customer") or {}).get("language", "hi-IN")
    surface = {
        "order": "You are taking an order at the counter. Book it on khata; this is a sales moment, not a collection one.",
        "nudge": "You are sending a short, warm reminder about an overdue amount.",
        "call": "You are on a live collection (vasooli) call. Open by citing the relationship and the SPECIFIC broken promise from CONTEXT, never a threat.",
    }.get(role, "You are the relationship manager.")
    return f"""You are the AI relationship manager for a neighbourhood kirana store in India, and ONE agent across
ordering, reminders, and collection calls. {surface}

LANGUAGE: Speak natural conversational Hindi/Hinglish the way an Indian shopkeeper talks ({lang}). Never plain English.
Say amounts the desi way ("pandrah sau pachaas"), dates naturally ("19 July ko") — never ISO format.
BREVITY: Live conversation — one or two short sentences per turn, one question at a time.
TRUTH: The CONTEXT below is the khata (ledger) and the ONLY source of truth. Never invent an amount, date, or payment.
Before answering a dispute, say you're checking, then use the check_partial tool.
NEGOTIATION: You may NOT waive or discount — only the merchant can (use escalate). Minimum partial payment is 30% of
the balance or ₹200. A promise-to-pay needs a concrete date within 7 days; propose one for vague answers and get a clear
haan/na before calling record_promise. Never threaten or shame. On hardship or hostility, close warmly and use escalate.

TOOLS (call them at the right moment; never mention tools aloud):
- place_on_khata(items, total_inr): after you read the order back and the customer confirms.
- record_promise(due_id, promised_date, verbatim): after the customer agrees to a specific date.
- send_payment_link(due_id, amount_inr): when the customer agrees to pay now.
- check_partial(due_id): to resolve an "I already paid" dispute before you respond.
- escalate(reason, summary): hardship, hostility, or a discount request. A polite close + escalate is a CORRECT ending.

CONTEXT (the khata — source of truth):
{json.dumps({k: ctx.get(k) for k in ("customer", "dues", "promises", "orders", "history", "rules") if ctx.get(k) is not None}, ensure_ascii=False, indent=2)}""" + (f"\n\n{ctx.get('personaPrompt')}" if ctx.get("personaPrompt") else "")


class VasooliAgent(Agent):
    def __init__(self, instructions: str, customer_id: str, ctx: dict, role: str = "call"):
        self.ctx = ctx
        self.role = role
        lang = (ctx.get("customer") or {}).get("language", "hi-IN")
        # Fast dialogue brain (Gemini/OpenAI-compat) when LLM_* env is set; else slow sarvam-30b.
        # Saaras STT + Bulbul TTS stay Sarvam (the scored Voice).
        if os.environ.get("LLM_BASE_URL") and os.environ.get("LLM_API_KEY") and os.environ.get("LLM_MODEL"):
            llm = openai.LLM(model=os.environ["LLM_MODEL"], base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
            log.info("dialogue LLM: %s (fast, OpenAI-compat)", os.environ["LLM_MODEL"])
        else:
            llm = sarvam.LLM(model="sarvam-30b")
            log.info("dialogue LLM: sarvam-30b (fallback)")
        super().__init__(
            instructions=instructions,
            stt=sarvam.STT(model="saaras:v3", mode="transcribe", language=lang),
            llm=llm,
            tts=sarvam.TTS(target_language_code=lang, model="bulbul:v3", speaker=SPEAKER),
        )
        self.customer_id = customer_id

    async def on_enter(self):
        # Gemini's OpenAI-compat endpoint 400s on a system-only request (no user turn yet), so we
        # speak a templated opener that cites the khata, then let the LLM drive every later turn
        # (those carry the customer's STT text, so `contents` is non-empty and Gemini is happy).
        c = self.ctx.get("customer") or {}
        name = c.get("name", "")
        dues = self.ctx.get("dues") or []
        bal = dues[0].get("balance") if dues else None
        if self.role == "order":
            opener = f"Namaste {name} ji, Sharma Kirana Store. Bataiye, aaj kya chahiye?"
        elif bal:
            opener = f"Namaste {name} ji, Sharma Kirana Store se. Aapka {bal} rupaye ka hisaab pending hai — kya is baare mein baat kar sakte hain?"
        else:
            opener = f"Namaste {name} ji, Sharma Kirana Store se baat kar rahe hain."
        self.session.say(opener)

    @function_tool
    async def place_on_khata(self, ctx: RunContext, items: list, total_inr: float = 0):
        """Book the confirmed order on the customer's khata (credit). Call ONLY after reading the order back and the customer confirms."""
        return await _post("/api/khata", {"action": "place_on_khata", "customerId": self.customer_id, "items": items, "total_inr": total_inr})

    @function_tool
    async def record_promise(self, ctx: RunContext, due_id: str, promised_date: str, verbatim: str = ""):
        """Record a promise-to-pay after the customer clearly agrees to a specific date (YYYY-MM-DD)."""
        return await _post("/api/khata", {"action": "record_promise", "customerId": self.customer_id, "dueId": due_id, "promised_date": promised_date, "source": "call", "verbatim": verbatim})

    @function_tool
    async def send_payment_link(self, ctx: RunContext, due_id: str, amount_inr: float):
        """Send a Razorpay payment link when the customer agrees to pay now."""
        return await _post("/api/razorpay/link", {"dueId": due_id, "amount": amount_inr})

    @function_tool
    async def check_partial(self, ctx: RunContext, due_id: str):
        """Look up existing partial payments to resolve an 'I already paid' dispute."""
        return await _post("/api/khata", {"action": "acknowledge_partial", "dueId": due_id})

    @function_tool
    async def escalate(self, ctx: RunContext, reason: str, summary: str):
        """Escalate to the merchant on hardship, hostility, or a discount request."""
        return await _post("/api/khata", {"action": "escalate", "customerId": self.customer_id, "reason": reason, "summary": summary})


async def entrypoint(ctx: JobContext):
    await ctx.connect()
    meta = {}
    try:
        meta = json.loads(ctx.room.metadata or "{}")
    except Exception:
        pass
    customer_id = meta.get("customerId")
    persona_id = meta.get("personaId")  # A/B persona pinned by the token route
    role = meta.get("role", "call")
    call_start = datetime.now(timezone.utc).isoformat()
    log.info("room=%s customer=%s role=%s persona=%s", ctx.room.name, customer_id, role, persona_id)

    data = {}
    if customer_id:
        params = {"customerId": customer_id, "role": role}
        if persona_id:
            params["personaId"] = persona_id
        try:
            data = await _get("/api/context", params)
        except Exception as e:
            log.warning("context fetch failed: %s", e)
    persona_id = persona_id or data.get("personaId")  # fall back to whatever /api/context assigned
    instructions = build_instructions(role, data) if data else "You are a kirana relationship manager. Speak Hindi/Hinglish, be brief."

    session = AgentSession(vad=silero.VAD.load())

    # Score the collection call at hangup: serialize the transcript and POST it to the harness.
    # Best-effort — never crash the worker if the history API differs on the installed version.
    async def _score_on_shutdown():
        if not customer_id or role != "call":
            return
        try:
            turns = _extract_turns(session)
            if not turns:
                log.info("hangup: no turns to score")
                return
            await _post("/api/harness/score", {"customerId": customer_id, "personaId": persona_id, "turns": turns, "callStart": call_start})
            log.info("hangup: scored call (%d turns, persona=%s)", len(turns), persona_id)
        except Exception as e:
            log.warning("hangup scoring failed: %s", e)

    ctx.add_shutdown_callback(_score_on_shutdown)

    await session.start(agent=VasooliAgent(instructions, customer_id or "", data, role), room=ctx.room)


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, port=int(os.environ.get("PORT", 8081)), host="0.0.0.0"))
