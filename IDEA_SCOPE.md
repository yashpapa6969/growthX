# IDEA_SCOPE.md

> This document is the control plane for the build. If a proposed change does not improve the active milestone's acceptance test or the chosen rubric strategy, place it in the parking lot.
>
> **This scope supersedes the "Meaning Receipt" scope (pivot decided pre-kickoff, July 26 — see Decision log).**

## 0. Scope status

| Field | Value |
|---|---|
| Event | Sarvam Epoch Buildathon — Razorpay Arena, Sunday, July 26, 2026 |
| Team | 2 engineers (Rohit + teammate); both strong, each owns a critical path |
| Build starts | 10:30 AM IST |
| Submission deadline | 4:30 PM IST |
| Demo duration | 3 min: 30s business context, 30s current pain, 2 min live demo |
| Current milestone | M0 |
| Scope owner | Rohit |
| Last updated | July 26, 2026, pre-kickoff |

### Status language

- **Specified:** described here but not implemented.
- **Implemented:** code exists.
- **Working locally:** golden path runs in the development environment.
- **Verified:** acceptance tests have passed.
- **Demo-ready:** reset, fallback, timing, and presentation have been rehearsed.

## 1. Idea lock

| Decision | Locked answer |
|---|---|
| One-sentence product | A kirana's unified relationship manager: the same Hindi voice agent that takes a customer's order on khata later recovers the dues — over WhatsApp-style nudges and a voice call — using one governed memory of the whole relationship, so vasooli works through context instead of pressure. |
| Specific user | The kirana/local merchant (payer); the khata customer (counterparty in the conversation) |
| Situation and repeated job | Customers buy on udhaar; dues age; the merchant must recover payment without burning the relationship. Declared job: **recover an overdue khata payment — payment received or promise-to-pay recorded — with the ledger updated, no human collector involved.** |
| Current workaround | The merchant nags in person/on calls, forgets who promised what, or hires recovery pressure that destroys repeat business; khata apps remind but don't converse, negotiate, or remember excuses |
| Hard input | Rambling, code-switched Hindi excuses and negotiation on a live call ("salary aane do… nahi wait, Monday pakka"), interruptions, a disputed "maine pay kar diya tha" claim |
| Final usable output or state change | Khata ledger closed or updated: real (test-mode) Razorpay payment received via link sent mid-call, webhook updates the ledger, agent confirms verbally; or a dated promise-to-pay recorded; full interaction timeline persisted |
| Sarvam parameter | **Voice Experience** |
| Team's unfair advantage | Two engineers fluent in realtime browser audio; native Hindi (+Bengali) speakers who can play the customer live and judge agent tone; payment-webhook plumbing is routine for them |
| Creativity thesis | Vasooli reframed as relationship continuity: the agent that *sold* is the agent that *collects*, and its escalation ladder (tone, timing, firmness) is governed by the customer's actual history — memory is the collection strategy |
| Delight thesis | At the hardest moment — customer claims "I already paid" — the agent checks the ledger *before* arguing, acknowledges the partial payment it finds by name and amount, and chases only the balance. Respectful judgment where collections normally fail |
| Decisive demo proof | One customer, one debt, live: voice order seeds memory on stage → time-jump → WhatsApp-style nudge citing the exact order → excuse recorded → voice call that opens with the broken promise, negotiates, sends a Razorpay link mid-call → payment lands, webhook flips the ledger, agent confirms on the call |

### Why this idea

#### Asymmetric fit

The scored surface is live Hindi voice under negotiation — exactly the team's no-learning zone (realtime browser audio + native speakers who can improvise authentic rambling excuses on stage). The differentiating layer, cross-channel unified memory, is a state-machine problem two strong engineers can build in hours while most voice teams ship stateless calls. Cutting Twilio/Meta (channels simulated, disclosed) trades wow for reliability precisely where the team had no existing account leverage, while keeping the payment loop real — and closing a Razorpay payment inside Razorpay Arena is a free narrative gift.

#### Decisive proof

Judges watch memory get *created* live (the order), *carried* across two channel surfaces (nudge → call), and *cash the debt* (payment webhook flips the ledger mid-call). The continuity is the hero; no moment is preloaded fakery, and the simulation boundary is stated in one sentence up front.

## 2. User and job

### User

- Who: A kirana/local merchant extending khata (informal credit) to regular customers.
- Context: Dozens of small dues (₹200–₹5,000) aging simultaneously; collection is awkward, manual, and relationship-risky.
- Frequency: Daily orders on credit; weekly/monthly collection cycles; every due requires multiple follow-ups.
- Existing behaviour: Paper khata or a khata app that records but doesn't converse; the merchant personally nags; excuses are forgotten; disputes are unresolvable ("maine pay kiya tha").
- Existing cost, delay, risk, or frustration: Locked working capital, forgotten promises, and the impossible trade-off between recovering money and keeping the customer.

### Job to be done

> When a khata payment is overdue, the merchant needs the due recovered (paid, or a dated promise recorded) without personally chasing it and without damaging the customer relationship, so that working capital comes back and the customer keeps buying.

### Definition of completion

The job is complete only when:

1. The overdue customer has been engaged across the escalation ladder (nudge → call) with the correct relationship context at each step.
2. Money has actually moved (test-mode Razorpay payment confirmed by webhook) **or** a dated promise-to-pay is recorded with the customer's assent on the call.
3. The khata ledger reflects the new state, and the interaction timeline (order, nudge, excuse, call, outcome) is persisted and inspectable.

Advice, transcription, extraction, or a chat response alone do not count. The ordering flow is the memory-seeding prologue, **not** a second scored job.

## 3. Product contract

### Golden path

1. **Seed:** Customer voice-orders in Hindi (browser mic, Saaras v3 streaming); agent recognises the returning customer, confirms items, books the order **on khata**; ledger and customer memory update.
2. **Time-jump:** Demo control advances the clock; the due crosses the grace period defined by business rules.
3. **Nudge:** The same agent sends a WhatsApp-style message (simulated surface, disclosed) citing the exact order, amount, and date, in the customer's language and a warm register. Customer replies with an excuse; the agent parses it and records a promise date.
4. **Call:** Promise date passes unpaid → agent escalates to a voice call (browser voice surface, disclosed). It opens with the relationship and the specific broken promise, handles rambling/interruptions, negotiates, and sends a Razorpay test payment link into the chat mid-call.
5. **Close:** Payment webhook fires → ledger updates → agent verbally confirms the received amount on the call, records any balance + new promise date. Timeline view shows one customer, three surfaces, one memory.

### Inputs

| Input | Format/source | Hard characteristics | Validation |
|---|---|---|---|
| Voice order | Browser mic → Saaras v3 streaming (hi-IN, codemix) | Casual Hindi, item quantities, returning-customer shorthand | Agent read-back before booking |
| WhatsApp-sim reply | Text in chat surface | Code-mixed excuse with a vague date ("Monday tak pakka") | Sarvam-30B parses to a dated promise; agent confirms interpretation in-chat |
| Live call speech | Browser mic → Saaras v3 streaming | Rambling excuses, interruptions, "already paid" dispute, mid-sentence corrections | Agent negotiation state machine; ledger check on dispute |
| Payment | Razorpay test-mode payment link | Paid on a phone on stage | Webhook → ledger; agent verbal confirmation |
| Demo clock | "Advance time" control | Deterministic | State machine driven by simulated date, not wall clock |

### Outputs and state changes

| Output/state change | Consumer | Required format | Proof of completion |
|---|---|---|---|
| Khata ledger entry (order, due, payment, balance) | Merchant | Ledger UI + DB record | Visible flip when webhook lands |
| Recorded promise-to-pay | Merchant/agent | Dated field on the due, shown in timeline | Call opens by citing it |
| Interaction timeline | Merchant + judges | Per-customer chronological view across surfaces | Shown as the demo kicker |
| Payment confirmation | Customer | Verbal on-call + chat receipt | Agent states the received amount unprompted |

### Memory boundary

What the product must remember:

- within one interaction: current negotiation state, amounts discussed, corrections.
- across sessions/surfaces: identity, order history, dues, language preference, every excuse and promise with dates, payment events, escalation stage.
- across users or team handoffs: merchant-facing timeline summarises the case; a second customer's data is invisible to the first (tenant boundary — demonstrate with two customer profiles).
- what it must deliberately forget: raw audio (not stored); interpretations the customer corrected are superseded, with the stale value struck through, not silently deleted.

### Human review boundary

- What can be automated: nudges, the call, promise recording, payment confirmation, ledger updates.
- What requires confirmation: any waiver/discount beyond rules; the agent's interpretation of a vague promise date (confirmed with the customer in-flow).
- What must be escalated: hostility, hardship claims, or a dispute the ledger can't resolve → flagged to the merchant with a case summary, never argued.
- How uncertainty is exposed: unverified claims marked "disputed" in the timeline; the agent says what it's checking ("ek second, khata dekh raha hoon") instead of stalling silently.

## 4. Creativity and Delight

### Obvious version

A collections voice bot that cold-calls debtors from a CSV with a script and threats-lite pressure. Stateless, adversarial, indistinguishable from library card #57 — Creativity L1 by the rubric's own examples.

### Structural creative mechanic

**The seller is the collector, and memory is the collection strategy.** One agent, one governed memory across ordering, nudging, and calling. The escalation ladder — when to nudge, when to call, how firm to be — is computed from the relationship (payment history, promise-keeping record, order recency), not from a fixed script. A good customer gets warmth and patience; a repeat promise-breaker gets firm brevity. Collection stops being an event and becomes a property of the relationship.

### Delight moment

The customer claims "maine pay kar diya tha." The agent checks the ledger live, finds the ₹500 partial payment from last week, acknowledges it by amount and date, apologises for the ambiguity, and chases only the ₹1,350 balance. Secondary: the agent confirming the mid-call payment verbally the moment the webhook lands.

### Why it is meaningful

Collections fail at exactly two moments: when the collector doesn't know the relationship (burns trust) and when the debtor disputes (argument with no facts). Both are memory failures. The mechanic and the delight moment each attack one of them directly.

### Ideas deliberately rejected

| Rejected mechanic | Reason |
|---|---|
| Real Twilio WhatsApp + PSTN | Account/credit/approval risk on the day; simulated surfaces disclosed honestly preserve the memory evidence at a fraction of the risk |
| Aggressive "recovery agent" persona for comedy | Memorable but torches the relationship-manager thesis and Delight |
| Multi-customer autonomous collection queue | Breadth over depth; one relationship end to end scores higher |
| Bhai-style vasooli humour in agent copy | One light touch max; judges score judgment, not gags |

## 5. Event and sponsor dependency

### Verified capability matrix

| Required capability | Product/API/model | Exact endpoint/access | Supported languages/inputs | Limits | Verification source |
|---|---|---|---|---|---|
| Streaming STT | Saaras v3 | Streaming/REST per STT overview | hi-IN (+bn-IN stretch), codemix mode | Latency unmeasured until M0 | docs.sarvam.ai models page, fetched 2026-07-25 |
| TTS | Bulbul v3 | Streaming/REST | hi-IN (+bn-IN), 30+ voices, pace/pitch control (tone ladder uses this) | 11-lang ceiling | Same |
| Reasoning/parsing/negotiation | Sarvam-30B | Chat completions | 11 langs incl. Hindi | — | Same |
| Payments | Razorpay Payment Links, **test mode** | Dashboard/API + webhook | UPI/card test flows | Test account needed — M0 | razorpay.com docs (verify at M0) |

### Load-bearing dependency

Live code-switched Hindi negotiation — rambling excuses, interruptions, disputes — transcribed and answered well enough to hold a firm-but-warm collection conversation, with Bulbul's pace/pitch control expressing the escalation ladder's tone. This is where Saaras/Bulbul are materially better than commodity ASR/TTS on Indic speech, and the demo's hard case exercises exactly that.

### Replacement test

If replaced with a generic stack:

- what remains commodity: the ledger, chat UI, webhook plumbing, state machine.
- what degrades: code-mixed Hindi STT under rambling and interruption; natural Hindi TTS with controllable register (the tone ladder becomes inaudible); excuse parsing in Hinglish.
- how the demo proves it: the entire scored 60-second call is conducted in exactly that speech.

### Unsupported assumptions

Must not enter the critical path: real WhatsApp Business API, real PSTN telephony, real money movement, voice cloning, "realtime" claims without on-screen numbers, Bengali as a promised feature (stretch flourish only), any scheme-level interest/penalty rules.

## 6. Rubric strategy

| Rubric dimension | Current evidence | Target level | Observable proof | Work required | Milestone |
|---|---|---|---|---|---|
| Job-to-be-done completion | None (L1) | **L5** | 3 repeated cases: overdue → engagement → payment or dated PTP → ledger updated, no builder touch | Full loop + webhook + 3 scripted cases | M1–M3, verified M5 |
| Memory and Context | None (L1) | **L4–L5** | Order context cited verbatim in nudge; excuse cited on call; correction supersedes; escalation governed by rules; customer B can't see customer A | Unified store + rules + tenant demo | M2, M4 |
| Creativity | Concept | **L4** | Seller-is-collector continuity + history-governed escalation ladder, both visible in one flow | Ladder logic + timeline view | M4 |
| Impact | Story | **L3–L4** | Khata credit is the default commerce mode for Indian kiranas; locked working capital + relationship cost baseline, conservative 10%+ recovery-effort claim, stated without invented statistics | 15 min sourcing + narration | M5 |
| Delight | None | **L4** | "Already paid" → ledger check → specific acknowledgment → balance-only ask | Dispute branch + partial-payment fixture | M4 |
| Sarvam parameter: Voice | None | **L4** | Live rambling code-switched negotiation; interruption handled; tone shifts between nudge-followup and firm ask; deliberate pacing via Bulbul controls | Streaming loop + negotiation prompts + tone mapping | M1, M3 |

### Sarvam strength

Voice Experience — the vasooli call is the scored centrepiece. WhatsApp-sim text earns Memory evidence, not Sarvam evidence, and we will not claim otherwise.

### Competence floor

Impact (honest narration, no invented numbers), UI (clean but minimal: chat surface, ledger, timeline), language breadth (Hindi; Bengali switch only if M4 finishes early).

### Evidence boundaries

- Call craft (code-switch, interruptions, tone, pacing) → **Voice**.
- Context carried across surfaces, promises recorded, corrections superseding, tenant boundary → **Memory**.
- Ledger closed by payment/PTP across repeated cases → **JTBD**.
- Seller-is-collector framing + history-governed ladder → **Creativity**.
- The "already paid" ledger-check moment → **Delight**.
- The same moment is never claimed twice. The demo script assigns each beat to one parameter.

### Rubric traps

- A charming call that ends without payment/PTP + ledger update = JTBD L1.
- Calling in-conversation flow "memory" — only cross-surface persisted state counts.
- Letting the ordering prologue balloon — it seeds memory, it is not the job.
- Simulation dishonesty: one plain sentence up front ("WhatsApp and the call are simulated surfaces in our app; the voice AI, memory, and payment are real") — a judge who discovers it themselves discounts everything.
- Comedy vasooli persona drifting into pressure = Delight L1.

## 7. Technical plan

### Stack (locked)

**One Next.js (App Router, TS) app on Railway + Railway Postgres (Prisma).** No separate voice microservice and no WebSocket for the MVP — voice is **push-to-talk over HTTP** (record utterance → POST → Saaras→30B→Bulbul → return audio). Streaming/WS is a stretch upgrade in M3 only if latency demands it. Repo: `github.com/yashpapa6969/growthX` (empty greenfield — no reuse). Avatar: sourced **Rive/Lottie** state-loops (idle/talking/thinking) behind an `<Avatar>` swap interface with an orb fallback; M4 task, hard-cut to orb by 3:20.

### Smallest architecture

```text
[Next.js app — routes: /shop /inbox /call /ledger ]
        ↓ HTTP (push-to-talk)
[API routes]
  /api/voice/turn  · Saaras v3 STT → Sarvam-30B (context+rules) → Bulbul v3 TTS → intents   (Eng 1)
  /api/razorpay/*  · create test link + webhook → ledger                                     (Eng 2)
  /api/clock       · demo time-jump                                                          (Eng 2)
  lib/memory       · customer, orders, dues, promises, interactions, escalation rules        (Eng 2)
        ↓
[Postgres (Railway): customer, product, order, due, promise, interaction, payment, demo_clock]
        ↓
[/ledger — khata + unified cross-surface timeline (merchant/judge-facing)]
```

### Voice-route contract (the Eng1 ↔ Eng2 interface — stateless voice, web is brain-of-record)

```text
POST /api/voice/turn
  in:  { audioBlob, role:'order'|'nudge'|'call',
         context:{ customer, dues, promises, history, rules, simDate } }
  out: { transcript, agentText, agentAudioB64, tone,
         intents:[{type,payload}] }   // add_to_cart, place_on_khata, record_promise,
                                       // send_payment_link, acknowledge_partial, escalate
```
Voice service is stateless: web builds `context` from the DB, voice returns intents, web persists + executes them.

### Components

| Component | Responsibility | Owner | Existing/new | Critical path? |
|---|---|---|---|---|
| Voice pipeline (order + call) | Streaming STT ↔ LLM ↔ TTS, interruption handling, latency instrumentation | Engineer 1 | New | **Yes** |
| Memory layer + ledger | Unified customer state, dues, promises, escalation rules, tenant boundary | Engineer 2 | New | **Yes** |
| WhatsApp-sim chat + timeline UI | Nudge render, reply intake, timeline kicker view | Engineer 2 | New | Yes (thin) |
| Razorpay test link + webhook | Link creation mid-call, webhook → ledger, agent notification | Engineer 2 | New | Yes |
| Demo clock control | Simulated date driving grace/escalation | Engineer 2 | New (trivial, build early) | Yes |

### Data and state

| Entity/state | Required fields | Storage | Lifetime |
|---|---|---|---|
| Customer | id, name, language, history summary, escalation stage | SQLite/Postgres (fastest available) | Persistent |
| Order / due | items, amount, date, status (open/partial/paid), balance | Same | Persistent |
| Promise | due id, promised date, source (chat/call), kept? | Same | Persistent |
| Interaction | surface, timestamp (simulated clock), transcript/summary, outcome | Same | Persistent |
| Call session | negotiation state, amounts discussed, per-hop latency | In-memory + log | Session |

### External dependencies

| Dependency | Why needed | Setup verified? | Failure fallback |
|---|---|---|---|
| Sarvam event API key + quotas | Everything scored | **NO — M0 task #1** | Blocker; none |
| Saaras v3 streaming | Both voice acts | No — M0 | Chunked REST push-to-talk turns |
| Razorpay test account + webhook reachability (tunnel/deploy) | Real payment close | No — M0 | "Mark paid" button, disclosed as simulated payment |
| Deploy target or localhost+tunnel | Webhook + demo | Known tooling | Localhost + hotspot |
| Wired headphones + phone for paying on stage | Demo hygiene | Bring/buy before kickoff | Earbuds; teammate's phone |

### Secrets and access

`SARVAM_API_KEY`, `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` (test mode), webhook secret → `.env`. Never committed, never in this document.

## 8. Time-boxed build ladder

Event clock: build 10:30–4:30.

### M0 — Feasibility and setup — **10:30–11:10**

**Purpose:** Kill unknown critical dependencies early.

Required:

- Sarvam key works; one recorded code-mixed Hindi clip round-trips STT → 30B → TTS with per-hop latency logged; streaming vs chunked decision made.
- Razorpay test account live; one payment link created and paid; webhook received (tunnel/deploy up).
- Repo scaffolded with the three views stubbed; demo clock control exists; resettable seed script.

Acceptance test:

> One Hindi utterance completes the full voice loop with measured latency, AND one test payment link fires our webhook.

Stop condition:

> Streaming not working by **11:10** → chunked push-to-talk permanently. Webhook not working by **11:10** → "mark paid" fallback becomes the plan of record (disclosed), revisit only in M5 slack.

### M1 — One-hour MVP — **by 11:40**

**Purpose:** Ugly end-to-end golden path. **Rubric intent: JTBD ≥ L3.**

Required:

- Voice order view: speak a Hindi order → agent read-back → khata ledger entry created for a seeded returning customer.
- Time-jump control marks the due overdue.
- Crude vasooli call view: agent opens citing the actual order/amount from memory, customer responds by voice, agent records a promise-to-pay → ledger shows PTP.
- Saved evidence of one full run. (Nudge/chat, payment, tone ladder, dispute branch all **excluded**.)

Acceptance test:

> The teammate who didn't build it runs order → overdue → call → recorded PTP without editing code.

Rubric vector after M1:

| Parameter | Demonstrated level | Evidence |
|---|---|---|
| JTBD | L3 | Real due recovered to a recorded PTP artifact |
| Memory | L3 | Order context survives into the call |
| Creativity | L2 | Continuity exists but ladder not visible |
| Impact | L2 | Story only |
| Delight | L1–L2 | Raw |
| Voice | L3 | Loop holds on clean Hindi |

### M2 — Nudge channel + unified memory — **11:40–1:00**

**Purpose:** The cross-surface Memory play.

Required:

- WhatsApp-sim chat surface: agent nudge cites order specifics; customer excuse reply parsed by 30B into a dated promise; agent confirms interpretation in-chat.
- Unified timeline view across all surfaces.
- Escalation driven by rules on the simulated clock (grace → nudge → call), not manual triggers.
- Second seeded customer proves the tenant boundary.
- Reset script returns the whole world to demo-start.

Acceptance test:

> A promise made in chat is cited verbatim by the agent on the subsequent call, and customer B's surfaces show nothing of customer A.

### M3 — The vasooli call, for real — **1:00–2:30**

**Purpose:** Sarvam-parameter excellence + the payment close.

Required:

- Negotiation handles: rambling code-switched excuses, interruption without context loss, partial-payment offers, mid-sentence corrections.
- Tone ladder audible: Bulbul pace/pitch/register differs between first follow-up and firm ask (play both for contrast).
- Razorpay test link sent into chat mid-call; webhook flips ledger; agent verbally confirms the received amount and records balance + new PTP.
- Latency p50/p95 visible.

Acceptance test:

> The full Act 3 — open with broken promise, negotiate, pay mid-call, verbal confirmation, ledger closed — runs without builder touch.

### M4 — Creativity and Delight — **2:30–3:20**

**Purpose:** The memorable behaviours, without destabilizing the core.

Required:

- "Already paid" dispute branch: ledger check announced, partial payment acknowledged by amount/date, balance-only ask. (Seed the partial-payment fixture.)
- Escalation-ladder governance visible in the timeline (why the agent chose this tone/step now).
- Corrections supersede with struck-through history.
- **Stretch only if ahead:** customer switches to Bengali mid-call; agent follows (Saaras + Bulbul both support bn-IN).

Acceptance test:

> A first-time user triggers the dispute moment on the normal golden path and the agent resolves it from the ledger unprompted; the timeline separately shows the governed ladder (Creativity evidence distinct from Delight evidence).

### M5 — Demo hardening and submission — **3:20–4:30 (protected; no new features)**

Required:

- Record the fallback video of a full successful run **first** (3:20).
- Three golden cases pass consecutively; reset script rehearsed.
- Simulation-disclosure sentence and Impact narration written into the 30+30s script.
- API-failure plan: Sarvam errors live → play recording and narrate; webhook slow → agent says it's confirming, presenter shows ledger after.
- Public link (or localhost+hotspot) verified; submission assets done before 4:30 lock.
- **Two consecutive timed 3-minute rehearsals, one on the fallback path.**

Acceptance test:

> Two consecutive timed rehearsals pass, including one using the fallback.

## 9. Test plan

### Golden cases

| Case | Why representative | Expected final output | Status |
|---|---|---|---|
| 1. Rahul: ₹1,850 grocery order on khata → excuse in chat ("Monday pakka") → call after broken promise → pays ₹1,000 via link mid-call | The full demo arc incl. partial payment | Ledger: ₹1,000 paid, ₹850 balance with new dated PTP | Specified |
| 2. Meena: overdue ₹600 → claims "already paid" on call → ledger shows ₹500 partial from last week | The Delight dispute branch | Agent acknowledges ₹500 by date, collects/records PTP for ₹100 | Specified |
| 3. Amit: chronic promise-breaker (2 broken PTPs seeded) → ladder skips warm nudge, call opens firm, direct ask | Proves governed escalation differs by history | Firm-register call, immediate link, ledger updated | Specified |

### Unseen hard case

Who chooses it: a judge plays the customer on the call with their own excuse.

What makes it difficult: unrehearsed code-switched negotiation, possible hostility or absurd excuse.

Success criteria: agent keeps context, negotiates to a payment or dated PTP, updates the ledger; if the judge stonewalls, the agent closes politely and flags escalation to the merchant — which is correct behaviour, and we say so.

### Failure cases

| Failure | Expected behaviour | User recovery | Tested? |
|---|---|---|---|
| Ambiguous promise date ("jaldi kar dunga") | Agent proposes a concrete date and asks for assent | Customer confirms/adjusts | No |
| Unsupported language on call | Polite Hindi/English notice of supported languages | Switch language | No |
| Sarvam API timeout mid-call | Turn marked failed, state intact, agent retries the question | Repeat utterance | No |
| Webhook delayed past 15s | Agent says confirmation is pending, doesn't claim payment | Presenter shows ledger update when it lands | No |
| Hostile/hardship response | No pressure; case flagged to merchant with summary | Merchant takes over | No |

## 10. Demo contract

### One-sentence setup

"Every kirana in India runs on khata credit — and recovering those dues today means choosing between your money and your customer."

**Disclosure sentence (mandatory, spoken in the first 15 seconds of the demo):** "WhatsApp and the phone call are simulated surfaces inside our app — the voice AI, the memory, and the payment are real."

### 60–120 second proof

| Time | What happens | What the judge sees | Rubric evidence |
|---:|---|---|---|
| 0–25s | Judge/teammate voice-orders in Hindi; agent recognises the regular, books on khata; ledger updates | Memory created live, not preloaded | Voice (order loop) |
| 25–45s | Time-jump → nudge cites exact order/amount warmly; customer types excuse; agent confirms "Monday" promise | Same brain, new surface, specifics carried | **Memory** |
| 45–90s | Promise broken → call: agent opens citing the promise, handles rambling/interruption, negotiates, sends Razorpay link; payment made on a phone; agent verbally confirms amount as webhook flips ledger | A collection actually completing, respectfully | Voice (craft) + JTBD (close) |
| 90–105s | "Maine pay kar diya tha" beat (case 2) or in-call dispute: ledger checked, partial acknowledged, balance-only ask | Judgment at the hardest moment | **Delight** |
| 105–120s | Timeline kicker: one customer, three surfaces, one governed memory; ladder rationale visible | Why this isn't a collections bot | **Creativity** |

### Live input

Judge or teammate as the customer, live mic, rehearsed arc with room to improvise.

### Fallback input

Recorded full-run video (captured at 3:20) + scripted golden cases replayable.

### Memorable moment

The agent confirming "₹1,000 abhi receive ho gaya" on the call the instant the judge's payment lands — inside Razorpay Arena.

### Final artifact/state shown

The closed/updated khata ledger + the unified timeline.

### Claims we can prove

- A real due recovered end to end with a real (test-mode) payment and webhook, three repeated cases, no builder touch.
- Context created on one surface cited verbatim on the next; escalation governed by history.
- Live code-switched Hindi negotiation with measured latency shown.

### Claims we must not make

- That the channels are real WhatsApp/PSTN (they are simulated and we say so first).
- Real money movement, production readiness, recovery-rate statistics we haven't sourced, Bengali support (unless the stretch shipped), "realtime" without numbers.

## 11. Risk register

| Risk | Probability | Damage | Earliest test | Mitigation | Fallback | Owner |
|---|---|---|---|---|---|---|
| Two live voice acts in hall noise | High | Garbled demo | M0 mic test; M5 rehearsal | Wired headset mic; push-to-talk toggle; short utterances | Fallback recording | Eng 1 |
| Negotiation LLM rambles or concedes absurdly | Medium | Voice + JTBD damage | M3 | Tight system prompt with rules (min amounts, no waivers, escalate on hardship); scripted-improv rehearsal | Constrain judge-as-customer to the rehearsed arc | Eng 1 |
| Webhook flaky on venue network | Medium | Kills the money moment | M0 | Tunnel + deployed backup; agent never claims payment before webhook | "Mark paid" disclosed button | Eng 2 |
| Demo reads as feature tour | Medium | JTBD/Creativity diluted | Script draft (M2) | One customer, one debt; declared-job sentence up front; timeline kicker ties it together | Cut the dispute beat, keep the close | Both |
| Scope: 3 surfaces + payment + rules in 6h | Medium-high | Nothing finishes | Continuous | Strict milestone cuts: M1 excludes chat/payment; Bengali stretch-gated; M5 protected | Ship M1+M2 arc (PTP close, no payment) | Rohit |
| Sarvam latency makes conversation laggy | Medium | Feel | M0 (11:10) | Instrument first; chunked fallback; short agent turns | Push-to-talk framing, honest | Eng 1 |

### Pre-mortem

It is judging time and the project has failed because:

1. **We built three surfaces and finished none** — countered by M1 deliberately excluding chat and payment, and each milestone having a named cut-to fallback.
2. **The live negotiation went off the rails with a judge improvising** — countered by rule-bounded prompts, the rehearsed-arc option, and "polite close + escalate flag" being a *correct* ending we can defend.
3. **The payment moment died on venue Wi-Fi** — countered by M0 webhook verification, tunnel + deployed backup, and the disclosed mark-paid fallback that keeps the arc intact.

## 12. Non-goals

The following are explicitly outside the build:

1. Real WhatsApp Business API, real telephony/PSTN, real money.
2. Multi-customer autonomous collection queues, merchant onboarding, catalogue management.
3. Interest/penalty computation, credit scoring, any lending-regulation territory.
4. Bengali as a committed feature (stretch flourish only), voice cloning, avatars, dashboards.

Any change to these requires an explicit scope decision.

## 13. Parking lot

| Idea | Potential value | Why not now | Revisit after |
|---|---|---|---|
| Real Twilio WhatsApp sandbox + PSTN call | Big credibility jump | Account/approval risk on the day | Post-event |
| Bengali mid-call language switch | Cheap Voice flourish (both langs supported) | Protect M4 core | If M4 done by 3:00 |
| Merchant daily digest ("aaj ki vasooli") | Nice JTBD artifact | Not the declared job | Post-event |
| Customer-initiated "khata kitna hua?" query | Two-way relationship depth | Scope | Post-event |
| Multi-merchant tenancy | Memory L5 depth | Two-customer boundary demo suffices today | Post-event |

## 14. Team execution

| Person/agent | Ownership | Current task | Acceptance test | Blocked by |
|---|---|---|---|---|
| Engineer 1 (Rohit) | Voice pipeline (order + call), negotiation prompts, latency | M0: Sarvam key + Hindi round trip + latency log | M0 voice half | Event API key |
| Engineer 2 (teammate) | Memory layer, ledger, chat surface, Razorpay webhook, demo clock, reset | M0: Razorpay test link + webhook + scaffold | M0 payment half | Razorpay test account |

### Coordination rules

- One owner per critical-path component.
- Integration occurs continuously, not at the final checkpoint.
- The golden path must remain runnable.
- New work begins only after the active milestone's acceptance test is preserved.

## 15. Current state

### Active milestone

M0 — Feasibility and setup (10:30–11:10).

### Implemented

- Nothing. Greenfield by rule.

### Working locally

- —

### Verified

- Sarvam capability surface (docs, 2026-07-25): Saaras v3 (hi/bn, codemix), Bulbul v3 (hi/bn, pace/pitch), Sarvam-30B.

### Demo-ready

- —

### Current blocker

Event Sarvam API key; Razorpay test account setup.

### Next single action

**Engineer 1: the moment the key lands, run one code-mixed Hindi clip through STT → 30B → TTS and log per-hop latency. In parallel, Engineer 2: create the Razorpay test account and fire one webhook.** Both must resolve by 11:10.

## 16. Decision log

| Time | Decision | Evidence/reason | Scope impact |
|---|---|---|---|
| Jul 25, evening | Direction A "Meaning Receipt" approved | Best risk-adjusted of three debated directions | Superseded below |
| Jul 26, pre-kickoff | **Pivot: vasooli agent as unified relationship manager (kirana khata)** | Team decision; stronger Memory & Context play (cross-surface continuity = rubric L4 example); Voice remains the scored parameter | Full scope rewrite; Meaning Receipt retired |
| Jul 26, pre-kickoff | Channels simulated (WhatsApp-style UI + browser call), disclosed up front | Cuts Meta/Twilio day-of risk; memory evidence preserved | Twilio to parking lot; disclosure sentence mandatory |
| Jul 26, pre-kickoff | Real Razorpay **test-mode** payment closes the loop mid-call | Strongest JTBD close; venue synergy; webhook is routine for team | Razorpay in M0 critical path with mark-paid fallback |
| Jul 26, pre-kickoff | Ordering flow = memory-seeding prologue, not a second scored job | JTBD requires one declared job | Demo script anchors on the collection |
