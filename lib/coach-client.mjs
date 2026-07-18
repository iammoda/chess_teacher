// Client-side helpers for the conversational coach. Pure data-shaping lives
// here so it can be unit-tested; app.js supplies the live state.

export const MAX_SENT_MESSAGES = 12;
export const COMPACT_AT_MESSAGES = 24;
export const MAX_MEMORY_NOTES = 20;
export const MAX_STORED_TRACES = 200;

// Keep the sendable transcript small: once a game's chat grows past
// COMPACT_AT_MESSAGES, fold everything before the recent tail into one
// synthetic summary line so old context survives without the token cost.
export function compactTranscript(messages) {
  if (!Array.isArray(messages) || messages.length <= COMPACT_AT_MESSAGES) {
    return Array.isArray(messages) ? messages.slice(-MAX_SENT_MESSAGES) : [];
  }
  const tail = messages.slice(-(MAX_SENT_MESSAGES - 1));
  const folded = messages
    .slice(0, messages.length - tail.length)
    .map((message) => `${message.role === "user" ? "player" : "coach"}: ${firstLine(message.content, 90)}`)
    .join(" | ");
  return [
    { role: "assistant", content: `Earlier in this conversation: ${folded}`.slice(0, 1800) },
    ...tail,
  ];
}

function firstLine(text, max) {
  const line = String(text || "").split("\n")[0];
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function appendMemoryNote(memory, note) {
  if (!note) return memory;
  const notes = Array.isArray(memory.notes) ? memory.notes : [];
  if (notes.includes(note)) return memory;
  return { ...memory, notes: [...notes, note].slice(-MAX_MEMORY_NOTES) };
}

export function appendTrace(memory, trace) {
  const traces = Array.isArray(memory.traces) ? memory.traces : [];
  return { ...memory, traces: [...traces, trace].slice(-MAX_STORED_TRACES) };
}

export function memoryForPayload(memory) {
  return {
    notes: Array.isArray(memory.notes) ? memory.notes.slice(-MAX_MEMORY_NOTES) : [],
    recentTraces: Array.isArray(memory.traces)
      ? memory.traces.slice(-5).map((trace) => ({
          san: trace.san,
          question: trace.question,
          answer: trace.answer,
          takeaway: trace.takeaway || "",
        }))
      : [],
  };
}

export async function sendCoachChat(payload, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl("/api/coach/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Coach request failed.");
  }
  return data;
}
