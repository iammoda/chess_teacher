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

const META_MARKER = "<<<META ";

// Strip a META trailer that may have started to stream so users don't see
// the JSON leaking into the message bubble.
function trimTrailer(text) {
  const idx = String(text || "").indexOf(META_MARKER);
  return idx === -1 ? text : text.slice(0, idx);
}

// Streaming variant: calls `onDelta(streamedMessage)` with the accumulated
// user-visible message text as it arrives, and returns the final structured
// reply (same shape as sendCoachChat).
export async function streamCoachChat(payload, { onDelta, fetchImpl = fetch, signal } = {}) {
  const response = await fetchImpl("/api/coach/chat?stream=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.includes("text/event-stream")) {
    // Server fell back to JSON (e.g. offline coach or validation error) —
    // hand the parsed reply straight back so callers get the same shape.
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Coach request failed.");
    if (typeof onDelta === "function" && data.message) onDelta(data.message);
    return data;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let full = "";
  let final = null;
  let errorMessage = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = sseBuffer.indexOf("\n\n")) !== -1) {
      const block = sseBuffer.slice(0, sep);
      sseBuffer = sseBuffer.slice(sep + 2);
      const lines = block.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
      const dataLine = lines.find((line) => line.startsWith("data:"))?.slice(5).trim();
      if (!eventLine || !dataLine) continue;
      let payloadObj;
      try { payloadObj = JSON.parse(dataLine); } catch { continue; }
      if (eventLine === "delta") {
        full += payloadObj.text || "";
        onDelta?.(trimTrailer(full));
      } else if (eventLine === "done") {
        final = payloadObj;
      } else if (eventLine === "error") {
        errorMessage = payloadObj.message || "Coach stream error.";
      }
    }
  }

  if (final) return final;
  if (errorMessage) throw new Error(errorMessage);
  // Server closed without a `done` event — fall back to whatever we buffered.
  return { configured: true, message: trimTrailer(full).trim(), question: null, offer_rethink: false, memory_note: null };
}
