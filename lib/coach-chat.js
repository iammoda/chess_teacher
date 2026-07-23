const CHAT_EVENTS = [
  "user_message",
  "proactive_comment",
  "rethink_prompt",
  "rethink_followup",
  "review_moment",
  "game_summary",
  "drill_feedback",
];

// Shared persona catalog for server-side CommonJS.
const { PERSONA_KEYS, getPersona } = require("./personas.cjs");

const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 2000;
const MAX_TRANSCRIPT_CHARS = 40_000;
const MAX_MEMORY_NOTES = 20;
const MAX_TRACES = 5;
const MAX_WEAKNESSES = 5;
const MAX_CANDIDATES = 4;

// Events where the coach only needs a quick reaction, not deliberation.
const LOW_EFFORT_EVENTS = new Set(["proactive_comment", "drill_feedback"]);

function validateChatPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "Chat payload must be a JSON object.";
  }
  if (!CHAT_EVENTS.includes(payload.event)) {
    return `Chat payload event must be one of: ${CHAT_EVENTS.join(", ")}.`;
  }
  if (!Array.isArray(payload.messages)) {
    return "Chat payload is missing the messages array.";
  }
  if (payload.messages.length > MAX_MESSAGES) {
    return `Chat payload has too many messages (max ${MAX_MESSAGES}).`;
  }
  let transcriptChars = 0;
  for (const message of payload.messages) {
    if (!message || typeof message !== "object") return "Each chat message must be an object.";
    if (message.role !== "user" && message.role !== "assistant") {
      return "Each chat message role must be user or assistant.";
    }
    if (typeof message.content !== "string") return "Each chat message needs string content.";
    transcriptChars += message.content.length;
  }
  if (transcriptChars > MAX_TRANSCRIPT_CHARS) {
    return "Chat transcript is too large.";
  }
  if (!payload.game || typeof payload.game !== "object" || typeof payload.game.fen !== "string") {
    return "Chat payload is missing the current game position.";
  }
  if (payload.persona !== undefined && !PERSONA_KEYS.includes(payload.persona)) {
    return `Chat payload persona must be one of: ${PERSONA_KEYS.join(", ")}.`;
  }
  return null;
}

function reasoningEffortForEvent(event) {
  return LOW_EFFORT_EVENTS.has(event) ? "low" : "medium";
}

function truncate(text, max) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

const META_MARKER = "<<<META ";
const META_END = ">>>";

function buildPersona(payload) {
  const lines = [
    "You are this player's personal chess coach. You have coached them for a while and you remember them.",
    "Voice: warm, direct, encouraging. Occasionally challenge them. Never generic. Talk like a person, not a report.",
    "",
    "Coaching rules:",
    "- Ask what they were thinking before telling them what to think. One question at a time.",
    "- Connect this moment to their recorded patterns and past answers by name when relevant.",
    "- Never invent moves. Only reference moves given in the context (candidates, best move, principal variation, recent moves).",
    "- For proactive_comment events: 1-2 sentences, immediate and specific. No lectures mid-game.",
    "- For rethink_prompt events: do NOT reveal the best move. Ask what their idea was, and hint at what the move overlooks.",
    "- For rethink_followup events: respond to their stated idea, give a concrete hint about what to re-examine, still don't hand them the answer.",
    "- For review_moment events: first ask what they were thinking at this moment; if their answer is already in the transcript, teach the lesson using the engine data and tie it to their skill profile.",
    "- For game_summary events: 1-2 takeaways max, tied to their recurring patterns, plus one thing they did well.",
    "- For drill_feedback events: the player just missed a practice puzzle. In 1-2 sentences, contrast their attempt with the expected idea using the motif named in the context. Encourage a retry; never assign new work.",
    "- Match language to the player's level for the relevant skill dimension: below 800, name concrete pieces and squares; 800-1200, short concrete plans; above 1200, plans and trade-offs.",
    "",
    "OUTPUT FORMAT:",
    "1. Write your conversational reply first, as plain prose (1-4 sentences).",
    `2. On a NEW line at the very end, output a metadata trailer: ${META_MARKER}{"question":"...","offer_rethink":false,"memory_note":"..."}${META_END}`,
    "   - question: one question to ask the player, or null. Set for rethink_prompt / review_moment events; otherwise usually null.",
    "   - offer_rethink: true ONLY for rethink_prompt events.",
    "   - memory_note: one durable insight (max 120 chars) about how this player thinks, or null. Use sparingly.",
    "Do not write any prose after the trailer. Do not wrap your reply in quotes or code blocks.",
  ];

  // Optional persona: a voice overlay that never changes the method.
  const persona = getPersona(payload.persona);
  if (persona.tone.length) {
    lines.push("", ...persona.tone, "This changes tone only — every coaching rule above still applies.");
  }

  const event = payload.event;
  lines.push("", `Current event: ${event}.`);
  return lines.join("\n");
}

// Parse a streamed reply that ends with the META trailer. Returns
// {message, question, offer_rethink, memory_note} the same shape the
// non-streaming JSON mode used to produce.
function parseCoachReply(text) {
  const raw = String(text || "");
  const idx = raw.lastIndexOf(META_MARKER);
  if (idx === -1) {
    return {
      configured: true,
      message: raw.trim() || "The coach had nothing to say — try again.",
      question: null,
      offer_rethink: false,
      memory_note: null,
    };
  }
  const message = raw.slice(0, idx).trim();
  const end = raw.indexOf(META_END, idx + META_MARKER.length);
  const jsonSlice = end === -1
    ? raw.slice(idx + META_MARKER.length).trim()
    : raw.slice(idx + META_MARKER.length, end).trim();
  let meta = {};
  try {
    meta = JSON.parse(jsonSlice);
  } catch {
    meta = {};
  }
  return {
    configured: true,
    message: message || (typeof meta.message === "string" ? meta.message.trim() : "The coach had nothing to say — try again."),
    question: typeof meta.question === "string" && meta.question.trim() ? meta.question.trim() : null,
    offer_rethink: meta.offer_rethink === true,
    memory_note: typeof meta.memory_note === "string" && meta.memory_note.trim()
      ? truncate(meta.memory_note.trim(), 120)
      : null,
  };
}

// Given the currently-buffered raw text, return the portion of the
// user-visible message that has arrived so far (excluding a trailer that may
// have started to stream).
function extractStreamingMessage(buffer) {
  const raw = String(buffer || "");
  const idx = raw.indexOf(META_MARKER);
  return idx === -1 ? raw : raw.slice(0, idx);
}

function compactContext(payload) {
  const context = {
    game: {
      fen: payload.game.fen,
      recentSan: Array.isArray(payload.game.recentSan) ? payload.game.recentSan.slice(-20) : [],
      phase: payload.game.phase || "",
      sideToMove: payload.game.sideToMove || "",
      playerColor: payload.game.playerColor || "",
      opening: payload.game.opening || "",
      result: payload.game.result || "",
    },
  };
  if (payload.moment && typeof payload.moment === "object") {
    context.moment = {
      ply: payload.moment.ply,
      san: payload.moment.san,
      quality: payload.moment.quality || "",
      cpl: payload.moment.cpl ?? null,
      bestMoveSan: payload.moment.bestMoveSan || "",
      principalVariation: Array.isArray(payload.moment.principalVariation)
        ? payload.moment.principalVariation.slice(0, 6)
        : [],
      fenBefore: payload.moment.fenBefore || "",
      tags: Array.isArray(payload.moment.tags) ? payload.moment.tags.slice(0, 4) : [],
    };
  }
  if (Array.isArray(payload.candidates) && payload.candidates.length) {
    context.candidates = payload.candidates.slice(0, MAX_CANDIDATES).map((candidate) => ({
      san: candidate.san,
      reason: truncate(candidate.reason, 160),
    }));
  }
  if (payload.skillSnapshot && typeof payload.skillSnapshot === "object") {
    context.skillSnapshot = payload.skillSnapshot;
  }
  if (Array.isArray(payload.weaknesses) && payload.weaknesses.length) {
    context.weaknesses = payload.weaknesses.slice(0, MAX_WEAKNESSES).map((weakness) => ({
      category: weakness.category,
      label: weakness.label,
      count: weakness.count,
      severity: weakness.severity,
    }));
  }
  const memory = payload.coachMemory;
  if (memory && typeof memory === "object") {
    context.coachMemory = {
      notes: Array.isArray(memory.notes) ? memory.notes.slice(0, MAX_MEMORY_NOTES).map((note) => truncate(note, 140)) : [],
      recentTraces: Array.isArray(memory.recentTraces)
        ? memory.recentTraces.slice(0, MAX_TRACES).map((trace) => ({
            san: trace.san,
            question: truncate(trace.question, 160),
            answer: truncate(trace.answer, 240),
            takeaway: truncate(trace.takeaway, 160),
          }))
        : [],
    };
  }
  return context;
}

function buildChatInput(payload) {
  const input = [
    { role: "developer", content: buildPersona(payload) },
  ];
  for (const message of payload.messages.slice(-MAX_MESSAGES)) {
    input.push({
      role: message.role,
      content: truncate(message.content, MAX_MESSAGE_CHARS),
    });
  }
  input.push({
    role: "user",
    content: `[context — not written by the player]\n${JSON.stringify(compactContext(payload))}`,
  });
  return input;
}

function stripJsonFence(text) {
  return String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function extractOutputText(data) {
  if (data.output_text) return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function normalizeChatResponse(text) {
  // Preferred format: prose message ending with a META trailer. Fall back
  // to legacy JSON parsing for older captured fixtures.
  const raw = String(text || "").trim();
  if (raw.includes(META_MARKER)) return parseCoachReply(raw);

  const unfenced = stripJsonFence(raw);
  try {
    const parsed = JSON.parse(unfenced);
    const message = typeof parsed.message === "string" && parsed.message.trim()
      ? parsed.message.trim()
      : "";
    if (!message) throw new Error("empty message");
    return {
      configured: true,
      message,
      question: typeof parsed.question === "string" && parsed.question.trim() ? parsed.question.trim() : null,
      offer_rethink: parsed.offer_rethink === true,
      memory_note: typeof parsed.memory_note === "string" && parsed.memory_note.trim()
        ? truncate(parsed.memory_note.trim(), 120)
        : null,
    };
  } catch {
    return {
      configured: true,
      message: raw || "The coach had nothing to say — try again.",
      question: null,
      offer_rethink: false,
      memory_note: null,
    };
  }
}

module.exports = {
  CHAT_EVENTS,
  META_MARKER,
  META_END,
  validateChatPayload,
  reasoningEffortForEvent,
  buildChatInput,
  normalizeChatResponse,
  parseCoachReply,
  extractStreamingMessage,
  stripJsonFence,
  extractOutputText,
};
