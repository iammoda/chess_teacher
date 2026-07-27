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

// Remove every <<<META …>>> span from the visible message. Models sometimes
// emit more than one trailer; none of them may leak raw JSON to the user.
function stripMetaSpans(raw) {
  let text = String(raw || "");
  let idx;
  while ((idx = text.indexOf(META_MARKER)) !== -1) {
    const end = text.indexOf(META_END, idx + META_MARKER.length);
    if (end === -1) {
      text = text.slice(0, idx);
      break;
    }
    text = text.slice(0, idx) + text.slice(end + META_END.length);
  }
  return text;
}

// Parse a streamed reply that ends with the META trailer. Returns
// {message, question, offer_rethink, memory_note} the same shape the
// non-streaming JSON mode used to produce. Reads the FIRST trailer (matching
// what extractStreamingMessage showed the user) and strips all of them.
function parseCoachReply(text) {
  const raw = String(text || "");
  const idx = raw.indexOf(META_MARKER);
  if (idx === -1) {
    return {
      configured: true,
      message: raw.trim() || "The coach had nothing to say — try again.",
      question: null,
      offer_rethink: false,
      memory_note: null,
    };
  }
  const message = stripMetaSpans(raw).trim();
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

// Serialized-context budget: everything in compactContext is stringified into
// the model input, so every field must be size-capped — a client can put
// anything in the payload and the transcript cap alone doesn't protect spend.
const MAX_CONTEXT_CHARS = 8000;
const MAX_SNAPSHOT_ENTRIES = 24;

function compactNumber(value) {
  return Number.isFinite(value) ? value : null;
}

// The skill snapshot is client-supplied. Keep only shallow numeric/short
// string entries (its legitimate shape) instead of copying it wholesale.
function compactSkillSnapshot(snapshot) {
  const compact = {};
  let entries = 0;
  for (const [key, value] of Object.entries(snapshot)) {
    if (entries >= MAX_SNAPSHOT_ENTRIES) break;
    const safeKey = truncate(String(key), 40);
    if (typeof value === "number" && Number.isFinite(value)) {
      compact[safeKey] = value;
      entries += 1;
    } else if (typeof value === "string" || typeof value === "boolean") {
      compact[safeKey] = typeof value === "string" ? truncate(value, 60) : value;
      entries += 1;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      const inner = {};
      let innerEntries = 0;
      for (const [innerKey, innerValue] of Object.entries(value)) {
        if (innerEntries >= 8) break;
        if (typeof innerValue === "number" && Number.isFinite(innerValue)) {
          inner[truncate(String(innerKey), 40)] = innerValue;
          innerEntries += 1;
        } else if (typeof innerValue === "string") {
          inner[truncate(String(innerKey), 40)] = truncate(innerValue, 60);
          innerEntries += 1;
        }
      }
      compact[safeKey] = inner;
      entries += 1;
    }
  }
  return compact;
}

function compactContext(payload) {
  const context = {
    game: {
      fen: truncate(payload.game.fen, 120),
      recentSan: Array.isArray(payload.game.recentSan)
        ? payload.game.recentSan.slice(-20).map((san) => truncate(String(san), 12))
        : [],
      phase: truncate(payload.game.phase || "", 24),
      sideToMove: truncate(payload.game.sideToMove || "", 12),
      playerColor: truncate(payload.game.playerColor || "", 12),
      opening: truncate(payload.game.opening || "", 80),
      result: truncate(payload.game.result || "", 60),
    },
  };
  if (payload.moment && typeof payload.moment === "object") {
    context.moment = {
      ply: compactNumber(payload.moment.ply),
      san: truncate(payload.moment.san, 12),
      quality: truncate(payload.moment.quality || "", 24),
      cpl: compactNumber(payload.moment.cpl),
      bestMoveSan: truncate(payload.moment.bestMoveSan || "", 12),
      principalVariation: Array.isArray(payload.moment.principalVariation)
        ? payload.moment.principalVariation.slice(0, 6).map((san) => truncate(String(san), 12))
        : [],
      fenBefore: truncate(payload.moment.fenBefore || "", 120),
      tags: Array.isArray(payload.moment.tags)
        ? payload.moment.tags.slice(0, 4).map((tag) => truncate(String(tag), 40))
        : [],
    };
  }
  if (Array.isArray(payload.candidates) && payload.candidates.length) {
    context.candidates = payload.candidates.slice(0, MAX_CANDIDATES).map((candidate) => ({
      san: truncate(candidate.san, 12),
      reason: truncate(candidate.reason, 160),
    }));
  }
  if (payload.skillSnapshot && typeof payload.skillSnapshot === "object" && !Array.isArray(payload.skillSnapshot)) {
    context.skillSnapshot = compactSkillSnapshot(payload.skillSnapshot);
  }
  if (Array.isArray(payload.weaknesses) && payload.weaknesses.length) {
    context.weaknesses = payload.weaknesses.slice(0, MAX_WEAKNESSES).map((weakness) => ({
      category: truncate(weakness.category, 40),
      label: truncate(weakness.label, 80),
      count: compactNumber(weakness.count),
      severity: compactNumber(weakness.severity),
    }));
  }
  const memory = payload.coachMemory;
  if (memory && typeof memory === "object") {
    context.coachMemory = {
      notes: Array.isArray(memory.notes) ? memory.notes.slice(0, MAX_MEMORY_NOTES).map((note) => truncate(note, 140)) : [],
      recentTraces: Array.isArray(memory.recentTraces)
        ? memory.recentTraces.slice(0, MAX_TRACES).map((trace) => ({
            san: truncate(trace.san, 12),
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
  // Hard ceiling on the serialized context — if a hostile payload still
  // manages to inflate it, cut the optional parts rather than ship megabytes
  // of input tokens.
  let context = compactContext(payload);
  if (JSON.stringify(context).length > MAX_CONTEXT_CHARS) {
    context = { game: context.game, moment: context.moment ?? null };
  }
  input.push({
    role: "user",
    content: `[context — not written by the player]\n${JSON.stringify(context)}`,
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
