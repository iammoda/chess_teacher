const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CHAT_EVENTS,
  META_MARKER,
  META_END,
  validateChatPayload,
  reasoningEffortForEvent,
  buildChatInput,
  normalizeChatResponse,
  parseCoachReply,
  extractStreamingMessage,
  extractOutputText,
} = require("../lib/coach-chat");

function basePayload(overrides = {}) {
  return {
    event: "user_message",
    messages: [
      { role: "assistant", content: "How is your king feeling?" },
      { role: "user", content: "A bit drafty." },
    ],
    game: {
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      recentSan: ["e4", "e5"],
      phase: "opening",
      sideToMove: "w",
      playerColor: "w",
      opening: "King's Pawn",
    },
    ...overrides,
  };
}

test("validateChatPayload accepts a well-formed payload", () => {
  assert.equal(validateChatPayload(basePayload()), null);
});

test("validateChatPayload rejects bad shapes", () => {
  assert.match(validateChatPayload(null), /JSON object/);
  assert.match(validateChatPayload([]), /JSON object/);
  assert.match(validateChatPayload(basePayload({ event: "lecture" })), /event must be one of/);
  assert.match(validateChatPayload(basePayload({ messages: "hi" })), /messages array/);
  assert.match(validateChatPayload(basePayload({ messages: [{ role: "system", content: "x" }] })), /role must be user or assistant/);
  assert.match(validateChatPayload(basePayload({ messages: [{ role: "user", content: 42 }] })), /string content/);
  assert.match(validateChatPayload(basePayload({ game: {} })), /current game position/);

  const tooMany = Array.from({ length: 13 }, () => ({ role: "user", content: "hi" }));
  assert.match(validateChatPayload(basePayload({ messages: tooMany })), /too many messages/);

  const huge = [{ role: "user", content: "x".repeat(41_000) }];
  assert.match(validateChatPayload(basePayload({ messages: huge })), /too large/);
});

test("every chat event validates", () => {
  for (const event of CHAT_EVENTS) {
    assert.equal(validateChatPayload(basePayload({ event })), null, event);
  }
});

test("reasoning effort is low only for proactive comments", () => {
  assert.equal(reasoningEffortForEvent("proactive_comment"), "low");
  assert.equal(reasoningEffortForEvent("user_message"), "medium");
  assert.equal(reasoningEffortForEvent("review_moment"), "medium");
});

test("buildChatInput leads with the persona and preserves transcript order", () => {
  const input = buildChatInput(basePayload());

  assert.equal(input[0].role, "developer");
  assert.match(input[0].content, /personal chess coach/);
  assert.match(input[0].content, /Ask what they were thinking/);
  assert.match(input[0].content, /Never invent moves/);
  assert.match(input[0].content, /offer_rethink/);
  assert.match(input[0].content, /<<<META /);
  assert.match(input[0].content, /Current event: user_message/);

  assert.equal(input[1].role, "assistant");
  assert.equal(input[1].content, "How is your king feeling?");
  assert.equal(input[2].role, "user");
  assert.equal(input[2].content, "A bit drafty.");

  const context = input[input.length - 1];
  assert.equal(context.role, "user");
  assert.match(context.content, /\[context — not written by the player\]/);
  assert.match(context.content, /"fen":/);
});

test("buildChatInput compacts context and clamps list sizes", () => {
  const payload = basePayload({
    event: "rethink_prompt",
    moment: {
      ply: 11,
      san: "Qh5",
      quality: "blunder",
      cpl: 420,
      bestMoveSan: "Nf3",
      principalVariation: ["Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d4", "exd4", "cxd4"],
      fenBefore: "fen-before",
      tags: [{ label: "hanging piece" }],
    },
    candidates: Array.from({ length: 9 }, (_, i) => ({ san: `m${i}`, reason: "why" })),
    weaknesses: Array.from({ length: 9 }, (_, i) => ({ category: `c${i}`, label: `w${i}`, count: 2, severity: 2 })),
    coachMemory: {
      notes: Array.from({ length: 30 }, (_, i) => `note ${i}`),
      recentTraces: Array.from({ length: 9 }, (_, i) => ({ san: "e4", question: "q", answer: "a", takeaway: "t" })),
    },
  });

  const context = JSON.parse(buildChatInput(payload).at(-1).content.split("\n").slice(1).join("\n"));
  assert.equal(context.candidates.length, 4);
  assert.equal(context.weaknesses.length, 5);
  assert.equal(context.coachMemory.notes.length, 20);
  assert.equal(context.coachMemory.recentTraces.length, 5);
  assert.equal(context.moment.principalVariation.length, 6);
  assert.equal(context.moment.san, "Qh5");
});

test("normalizeChatResponse parses the META trailer format", () => {
  const raw = `That knight is doing three jobs at once.\n${META_MARKER}{"question":"What was your plan with Qh5?","offer_rethink":true,"memory_note":"Tends to attack before developing."}${META_END}`;
  const result = normalizeChatResponse(raw);
  assert.equal(result.configured, true);
  assert.equal(result.message, "That knight is doing three jobs at once.");
  assert.equal(result.question, "What was your plan with Qh5?");
  assert.equal(result.offer_rethink, true);
  assert.equal(result.memory_note, "Tends to attack before developing.");
});

test("legacy JSON responses still parse for old fixtures", () => {
  const legacy = normalizeChatResponse(JSON.stringify({
    message: "Nice recovery.",
    question: null,
    offer_rethink: false,
    memory_note: null,
  }));
  assert.equal(legacy.message, "Nice recovery.");
  assert.equal(legacy.question, null);
  assert.equal(legacy.offer_rethink, false);
});

test("META trailer clamps long memory notes", () => {
  const raw = `ok\n${META_MARKER}{"memory_note":"${"n".repeat(200)}"}${META_END}`;
  const result = normalizeChatResponse(raw);
  assert.equal(result.memory_note.length, 120);
});

test("normalizeChatResponse falls back when there's no trailer or JSON", () => {
  const junk = normalizeChatResponse("The engine hums quietly.");
  assert.equal(junk.message, "The engine hums quietly.");
  assert.equal(junk.question, null);

  const empty = normalizeChatResponse("");
  assert.match(empty.message, /try again/i);
});

test("parseCoachReply handles a truncated META trailer gracefully", () => {
  const raw = `Solid recovery — you noticed the pin.\n${META_MARKER}{"memory_note":"scans for pins now"`;
  const result = parseCoachReply(raw);
  assert.equal(result.message, "Solid recovery — you noticed the pin.");
  assert.equal(result.memory_note, null);
});

test("extractStreamingMessage hides a trailer that has started to stream", () => {
  assert.equal(extractStreamingMessage("hello world"), "hello world");
  assert.equal(extractStreamingMessage(`hello\n${META_MARKER}{"question"`), "hello\n");
});

test("extractOutputText reads output_text and nested content", () => {
  assert.equal(extractOutputText({ output_text: "hi" }), "hi");
  assert.equal(
    extractOutputText({ output: [{ content: [{ text: "a" }, { text: "b" }] }] }),
    "a\nb",
  );
});
