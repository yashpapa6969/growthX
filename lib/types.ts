// The Eng1 <-> Eng2 contract. Voice service is STATELESS: web builds `context`
// from the DB, voice returns transcript + agent speech + structured intents,
// web persists + executes them. Keep this file in sync on both sides.

export type Role = "order" | "nudge" | "call";

export type IntentType =
  | "add_to_cart"
  | "place_on_khata"
  | "record_promise"
  | "send_payment_link"
  | "acknowledge_partial"
  | "escalate"
  | "none";

export interface Intent {
  type: IntentType;
  payload?: Record<string, any>;
}

export interface TurnContextCustomer {
  id: string;
  name: string;
  language: string; // e.g. hi-IN
  historySummary?: string;
  escalationStage?: string;
  trustScore?: number;
}

export interface TurnContext {
  role: Role;
  customer: TurnContextCustomer;
  dues?: { id: string; amount: number; balance: number; status: string }[];
  promises?: { promisedDate: string; source: string; kept: boolean }[];
  history?: { surface: string; summary: string; simTs: string }[];
  rules?: Record<string, any>;
  simDate: string;
  // M-Stretch-1: active persona prompt fragment + shared playbook, merged.
  personaPrompt?: string;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface VoiceTurnRequest {
  audioB64?: string; // base64 audio from the mic (push-to-talk)
  mime?: string; // audio mime from MediaRecorder, e.g. "audio/webm" (Saaras accepts webm/opus directly)
  text?: string; // typed fallback / inbox replies
  turns?: ConversationTurn[]; // prior turns this session -> continued conversation over HTTP (no websocket)
  role: Role;
  context: TurnContext;
}

export type Tone = "warm" | "neutral" | "firm";

export interface VoiceTurnResponse {
  transcript: string; // what the customer said
  agentText: string; // what the agent replied
  agentAudioB64: string | null; // Bulbul TTS audio (wav base64), null in text-only/mock
  tone: Tone;
  intents: Intent[];
}
