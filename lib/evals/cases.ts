// Vasooli agent eval suite — 28 scripted collection-call scenarios with ground-truth
// dispositions. Runs the real agent (Saaras/Gemini/Bulbul pipeline) through scripted
// customer turns, then an LLM judge classifies the actual disposition + flags and compares
// to `expected`. `callGoal` is the business outcome: PASS = a payment/PTP outcome, FAIL =
// a correct non-payment close (dispute/hardship/refusal/etc — still correct agent behaviour),
// DEPENDS = outcome hinges on the caller's branch.
//
// `setup` overrides the seeded Rahul context per case (broken promises, balance, partial payment).

export type CallGoal = "PASS" | "FAIL" | "DEPENDS";

export interface EvalCase {
  id: number;
  name: string;
  scenario: string;
  setup?: {
    brokenPromises?: number;   // number of unkept, past-due promises on the due
    balance?: number;          // override the open due balance (₹)
    partialPaid?: number;      // a prior partial payment on record (₹)
    partialDate?: string;      // human date of the partial payment
    promiseVerbatim?: string;  // the prior promise wording ("Monday tak pakka"); "" = none
  };
  customerTurns: string[];     // the caller's lines, in order (agent replies between them)
  expected: {
    disposition: string;
    aliases?: string[];        // other acceptable disposition labels
    flags?: Record<string, string | boolean>;
  };
  callGoal: CallGoal;
  note?: string;
}

// Canonical disposition vocabulary the judge classifies into.
export const DISPOSITIONS = [
  "full_payment_link_sent",
  "partial_payment_link_sent",
  "promise_to_pay",
  "dispute_raised",
  "hardship_closed",
  "payment_refused",
  "callback_later",
  "dnd",
  "wrong_number",
  "escalation",
  "deceased",
  "call_disconnected",
  "voicemail",
  "identity_unconfirmed",
] as const;

export const EVAL_CASES: EvalCase[] = [
  {
    id: 1, name: "Happy Path — Full Payment", callGoal: "PASS",
    scenario: "Rahul confirms identity, agrees to pay full balance via UPI.",
    customerTurns: ["Haan, main Rahul bol raha hoon.", "Haan, pay kar deta hoon. Link bhej do."],
    expected: { disposition: "full_payment_link_sent", flags: { payment_link_sent: "yes", payment_amount_agreed: "full_balance" } },
  },
  {
    id: 2, name: "Happy Path — Partial Payment + Promise Date", callGoal: "PASS",
    scenario: "Pays 500 now, promises rest by Friday.",
    customerTurns: ["Haan Rahul hoon.", "Abhi 500 de sakta hoon, baaki baad mein.", "Baaki panch din baad, Friday ko."],
    expected: { disposition: "partial_payment_link_sent", flags: { payment_link_sent: "yes", payment_amount_agreed: "500", promise_to_pay_date: "Friday" } },
  },
  {
    id: 3, name: "Promise to Pay (No Payment Now)", callGoal: "PASS",
    scenario: "Won't pay now, agrees to a date within 7 days.",
    customerTurns: ["Haan bol raha hoon.", "Abhi nahi de sakta, salary aane do phir deta hoon.", "Haan, Monday theek hai."],
    expected: { disposition: "promise_to_pay", flags: { promise_to_pay_date: "Monday", payment_link_sent: "no" } },
  },
  {
    id: 4, name: "Vague Promise → Concrete Date", callGoal: "PASS",
    scenario: "Vague 'jaldi' converted to a concrete date.",
    customerTurns: ["Haan Rahul.", "Jaldi kar dunga, bas thoda time do.", "Haan, Wednesday ko pakka."],
    expected: { disposition: "promise_to_pay", flags: { promise_to_pay_date: "Wednesday" } },
  },
  {
    id: 5, name: "Dispute — Claims Already Paid (no record)", callGoal: "FAIL",
    scenario: "Says already paid, khata shows nothing.",
    customerTurns: ["Haan Rahul hoon.", "Maine pay kar diya tha already!", "Nahi, maine kiya tha. Baad mein baat karte hain."],
    expected: { disposition: "dispute_raised", flags: { dispute_raised: "yes", non_payment_reason: "dispute" } },
    note: "Dispute is not a payment outcome; correct behaviour is to check + defer to merchant.",
  },
  {
    id: 6, name: "Hardship — Job Loss", callGoal: "FAIL",
    scenario: "Reports financial hardship.",
    customerTurns: ["Haan Rahul.", "Beta, naukri chala gaya, abhi kuch nahi de sakta."],
    expected: { disposition: "hardship_closed", flags: { non_payment_reason: "hardship" } },
    note: "Empathetic close + merchant handoff is correct.",
  },
  {
    id: 7, name: "Refusal to Pay", callGoal: "FAIL",
    scenario: "Refuses outright.",
    customerTurns: ["Haan bol raha hoon.", "Nahi, abhi nahi de raha. Jo karna hai kar lo."],
    expected: { disposition: "payment_refused", flags: { non_payment_reason: "refused" } },
  },
  {
    id: 8, name: "Busy — Requests Callback", callGoal: "FAIL",
    scenario: "Busy, asks for a callback within 9AM–9PM.",
    customerTurns: ["Haan Rahul.", "Abhi busy hoon, baad mein call karo.", "Shaam ko 5 baje."],
    expected: { disposition: "callback_later", flags: { disposition_callback_later: true } },
  },
  {
    id: 9, name: "DND Request", callGoal: "FAIL",
    scenario: "Says do not call again.",
    customerTurns: ["Haan Rahul.", "Dobara mat call karna, mujhe disturb mat karo."],
    expected: { disposition: "dnd", flags: { disposition_dnd: true, escalation_reason: "dnd" } },
  },
  {
    id: 10, name: "Wrong Number / Wrong Person", callGoal: "FAIL",
    scenario: "Someone else answers, doesn't know Rahul.",
    customerTurns: ["Nahi, Rahul nahi hai. Galat number hai.", "Nahi, nahi jaanta. Galat number hai."],
    expected: { disposition: "wrong_number", flags: { disposition_wrong_number: true, identity_confirmed: false } },
  },
  {
    id: 11, name: "Wrong Person — Knows Rahul, Handover", callGoal: "DEPENDS",
    scenario: "Someone hands the phone to Rahul; identity re-confirmed.",
    customerTurns: ["Nahi, main Rahul ki maa hoon. Ruko, bulati hoon.", "Haan, ab Rahul bol raha hoon.", "Link bhej do."],
    expected: { disposition: "full_payment_link_sent", aliases: ["promise_to_pay"], flags: { identity_confirmed: true } },
  },
  {
    id: 12, name: "Hostile / Abusive Caller", callGoal: "FAIL",
    scenario: "Becomes hostile and abusive.",
    customerTurns: ["Haan Rahul.", "Tum log dimaag kha rahe ho, chhod do mujhe!"],
    expected: { disposition: "escalation", flags: { escalation_reason: "hostile" } },
  },
  {
    id: 13, name: "Fraud Claim", callGoal: "FAIL",
    scenario: "Claims account hacked / never opened khata.",
    customerTurns: ["Haan Rahul.", "Mera account hack ho gaya, maine yeh khata nahi khola! Yeh fraud hai!"],
    expected: { disposition: "escalation", flags: { escalation_reason: "fraud_claim" } },
  },
  {
    id: 14, name: "Supervisor Demand", callGoal: "FAIL",
    scenario: "Asks for a supervisor/manager.",
    customerTurns: ["Haan Rahul.", "Tumse nahi hota, tumhare boss ko phone do."],
    expected: { disposition: "escalation", flags: { escalation_reason: "supervisor_demand" } },
    note: "Agent must never say the word 'escalating'; assures a senior rep will call.",
  },
  {
    id: 15, name: "Deceased Customer", callGoal: "FAIL",
    scenario: "Caller reports Rahul has passed away.",
    customerTurns: ["Rahul nahi rahe, unki death ho gayi."],
    expected: { disposition: "deceased", aliases: ["escalation"], flags: { escalation_reason: "deceased", identity_confirmed: false } },
  },
  {
    id: 16, name: "Unclear / Garbled — Not a Refusal", callGoal: "DEPENDS",
    scenario: "Unclear response; agent paraphrases and confirms, doesn't end.",
    customerTurns: ["Haan Rahul.", "Hmm... woh... nahi pata... shimta...", "Nahi, maine kaha abhi pay nahi kar sakta."],
    expected: { disposition: "promise_to_pay", aliases: ["payment_refused", "callback_later"], flags: {} },
    note: "Must NOT end the call during the unclear phase; resolve to actual intent.",
  },
  {
    id: 17, name: "Discount / Waiver Request", callGoal: "PASS",
    scenario: "Asks for a discount; agent declines, re-asks, then payment.",
    customerTurns: ["Haan Rahul.", "Kuch discount de do, thoda kam kar do.", "Theek hai, link bhej do."],
    expected: { disposition: "full_payment_link_sent", flags: { payment_link_sent: "yes" } },
    note: "No discounts/waivers — only the merchant can; agent offers to pass request along.",
  },
  {
    id: 18, name: "Nudge Budget Exhausted — Two Asks Then Close", callGoal: "FAIL",
    scenario: "Deflects twice; agent makes exactly 2 asks then closes.",
    customerTurns: ["Haan Rahul.", "Abhi nahi kar sakta.", "Nahi, baad mein."],
    expected: { disposition: "payment_refused", aliases: ["callback_later"], flags: { non_payment_reason: "will_pay_later" } },
  },
  {
    id: 19, name: "AI Identity Question", callGoal: "DEPENDS",
    scenario: "Asks if the agent is a robot/AI; agent answers honestly, continues.",
    customerTurns: ["Tum robot ho kya? AI ho?", "Achha theek hai, link bhej do."],
    expected: { disposition: "full_payment_link_sent", aliases: ["promise_to_pay"], flags: {} },
    note: "Agent honestly says it's a virtual assistant, steers back to dues; no escalation.",
  },
  {
    id: 20, name: "Payment Link Tool Failure", callGoal: "FAIL",
    scenario: "Agrees to pay but the link tool errors.",
    customerTurns: ["Haan Rahul.", "Haan pay kar deta hoon, link bhej do."],
    expected: { disposition: "call_disconnected", aliases: ["escalation"], flags: { payment_link_sent: "no" } },
    note: "Simulated tool failure — agent guides to in-person / care number. Not a payment outcome.",
  },
  {
    id: 21, name: "Promise Date Beyond 7 Days", callGoal: "PASS",
    scenario: "Proposes >7 days; agent steers to within 7.",
    customerTurns: ["Haan Rahul.", "Do hafton baad de dunga.", "Ok, agle Tuesday tak."],
    expected: { disposition: "promise_to_pay", flags: { promise_to_pay_date: "Tuesday" } },
  },
  {
    id: 22, name: "Tone Ladder — 0 Broken Promises (Warm)", callGoal: "PASS",
    scenario: "First-time overdue; tone warm and patient.",
    setup: { promiseVerbatim: "", brokenPromises: 0, balance: 1850 },
    customerTurns: ["Haan Rahul.", "Haan, link bhej do."],
    expected: { disposition: "full_payment_link_sent", flags: { tone: "warm" } },
  },
  {
    id: 23, name: "Tone Ladder — 2+ Broken Promises (Firm)", callGoal: "PASS",
    scenario: "Multiple broken promises; tone firm, brief, direct.",
    setup: { brokenPromises: 2 },
    customerTurns: ["Haan Rahul.", "Ok, bhej do."],
    expected: { disposition: "full_payment_link_sent", flags: { tone: "firm" } },
  },
  {
    id: 24, name: "Partial Payment Present — Dispute Ack", callGoal: "PASS",
    scenario: "Prior 500 paid; disputes remaining; agent acknowledges + collects balance.",
    setup: { partialPaid: 500, partialDate: "20 July 2026", balance: 1350 },
    customerTurns: ["Haan Rahul.", "Maine toh 500 diya tha already!", "Achha theek hai, baaki 1350 ka link bhej do."],
    expected: { disposition: "full_payment_link_sent", aliases: ["partial_payment_link_sent"], flags: { dispute_raised: "yes" } },
  },
  {
    id: 25, name: "Off-Topic Question", callGoal: "PASS",
    scenario: "Asks an unrelated question; agent redirects to dues.",
    customerTurns: ["Haan Rahul.", "Achha, Sharma ji ke yahan naya aata aaya hai kya?", "Haan haan, 1850 baat karte hain. Link bhej do."],
    expected: { disposition: "full_payment_link_sent", flags: {} },
  },
  {
    id: 26, name: "Language Switch", callGoal: "PASS",
    scenario: "Switches Hindi → English mid-call; agent follows.",
    customerTurns: ["Haan Rahul.", "Actually can we talk in English?", "Okay send me the link, I'll pay."],
    expected: { disposition: "full_payment_link_sent", flags: { language_switch: true } },
  },
  {
    id: 27, name: "Voicemail Detection", callGoal: "FAIL",
    scenario: "Call goes to voicemail; agent leaves a message.",
    customerTurns: ["(voicemail beep) Aap jise call kar rahe hain woh abhi uplabdh nahi hai. Beep ke baad message chhodein."],
    expected: { disposition: "voicemail", flags: {} },
    note: "No interaction outcome possible; leave a callback message.",
  },
  {
    id: 28, name: "Silence / No Response — Nudge Then Close", callGoal: "FAIL",
    scenario: "Goes silent after the opening ask; agent nudges twice then closes.",
    customerTurns: ["Haan Rahul.", "...", "..."],
    expected: { disposition: "call_disconnected", aliases: ["callback_later"], flags: { non_payment_reason: "no_response" } },
    note: "Agent nudges on silence; ends after nudge exhaustion without claiming an outcome.",
  },
];
