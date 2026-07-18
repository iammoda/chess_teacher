const CHAT_EVENTS = [
  "user_message",
  "proactive_comment",
  "rethink_prompt",
  "rethink_followup",
  "review_moment",
  "game_summary",
  "drill_feedback",
];

const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 2000;
const MAX_TRANSCRIPT_CHARS = 40_000;
const MAX_MEMORY_NOTES = 20;
const MAX_TRACES = 5;
const MAX_WEAKNESSES = 5;
const MAX_CANDIDATES = 4;

// Events where the coach only needs a quick reaction, not deliberation.
const LOW_EFFORT_EVENTS = new Set(["proactive_comment"]);

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
  return null;
}

function reasoningEffortForEvent(event) {
  return LOW_EFFORT_EVENTS.has(event) ? "low" : "medium";
}

function truncate(text, max) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

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
    "- Match language to the player's level for the relevant skill dimension: below 800, name concrete pieces and squares; 800-1200, short concrete plans; above 1200, plans and trade-offs.",
    "",
    'Return only valid JSON: {"message": "your reply, 1-4 sentences", "question": "one question for the player or null", "offer_rethink": boolean, "memory_note": "one durable insight (max 120 chars) about how this player thinks, or null"}',
    "Set offer_rethink true only for rethink_prompt events. Use memory_note sparingly — only for genuinely new insights about their thinking habits.",
  ];
  const event = payload.event;
  lines.push("", `Current event: ${event}.`);
  return lines.join("\n");
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
  try {
    const parsed = JSON.parse(stripJsonFence(text));
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
    const fallback = String(text || "").trim();
    return {
      configured: true,
      message: fallback || "The coach had nothing to say — try again.",
      question: null,
      offer_rethink: false,
      memory_note: null,
    };
  }
}

module.exports = {
  CHAT_EVENTS,
  validateChatPayload,
  reasoningEffortForEvent,
  buildChatInput,
  normalizeChatResponse,
  stripJsonFence,
  extractOutputText,
};
