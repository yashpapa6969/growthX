# Pitch script — 3 minutes (30s context · 30s pain · 2 min live demo)

## 0:00–0:30 — Business context

> Every kirana in India runs on khata. A regular walks in, takes ₹1,850 of
> groceries, says "likh lo bhaiya", and walks out. That's not a bug — informal
> credit IS how neighbourhood retail works. But that money has to come back,
> and today, getting it back means the merchant choosing between their money
> and their customer.

## 0:30–1:00 — Current pain + what we built

> The merchant nags in person, forgets who promised what, and when a customer
> says "maine pay kar diya tha", it's an argument with no facts. Khata apps
> record and remind — they don't converse, negotiate, or remember excuses.
>
> So we built the kirana's relationship manager: the **same AI agent that took
> the order on khata later recovers the due** — a WhatsApp nudge, then a real
> phone call — using one memory of the whole relationship. Vasooli through
> context, not pressure.

**Disclosure (say it here, before the demo):**

> One disclosure: the phone call you'll hear is a **real call on a real
> number** — Sarvam's voice agent end to end. The WhatsApp thread is a
> simulated surface in our app, and the payment is Razorpay test mode.

## 1:00–3:00 — Live demo (golden case: Rahul, ₹1,850)

| Time | Beat | Line to say |
|---:|---|---|
| 1:00 | Show ledger + timeline: Rahul's 12 July order, due 19 July, WhatsApp nudge citing the exact items/amount, his reply | "It nudged him on WhatsApp citing his exact order. He replied 'Monday tak pakka' — the agent recorded that as a dated promise. Monday came and went." |
| 1:20 | Dial live — phone rings on stage. Pooja opens by citing his own broken promise | "Listen to the opening — it's not a script. It's his own words, from our khata, on a real phone line." |
| 1:50 | Teammate plays Rahul: rambling code-mixed excuse, interruption. Agent stays on the ask, negotiates | (let the call carry this — don't talk over it) |
| 2:15 | **Delight beat:** "maine pay kar diya tha" → agent says "ek second, khata dekh raha hoon", answers only from the ledger — no arguing, no conceding | "This is where collections normally die. It checks before it argues." |
| 2:35 | Close: payment / dated promise → ledger and timeline update | "Payment link sent mid-call" — or, if payment isn't wired: "a new dated promise, recorded with his assent, back in the ledger." |
| 2:50 | Kicker | "One customer, three surfaces, one memory. The agent that **sold** is the agent that **collects** — that's the whole idea. And it just recovered a due inside Razorpay Arena." |

## Guardrails

- **Never claim:** real money, real WhatsApp Business API, recovery-rate
  statistics, production readiness.
- If the judge-as-customer stonewalls or claims hardship: the agent closes
  politely and flags the merchant. Say out loud: "That's correct behaviour —
  a relationship manager knows when to stop."
- If Sarvam/Twilio fails live: play the fallback recording and narrate the
  same beats.
- Before dialing: confirm the agent's KHATA CONTEXT block is set to Rahul /
  ₹1,850 / broken 21-July promise (edit in platform.sarvam.ai, Variables tab).
