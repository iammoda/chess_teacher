const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateCoachPayload,
  stripJsonFence,
  extractOutputText,
  normalizeCoachResponse,
} = require("../lib/coach-helpers");

test("validateCoachPayload rejects non-objects", () => {
  assert.match(validateCoachPayload(null) || "", /JSON object/);
  assert.match(validateCoachPayload([]) || "", /JSON object/);
  assert.match(validateCoachPayload("hi") || "", /JSON object/);
});

test("validateCoachPayload requires context string", () => {
  assert.match(validateCoachPayload({}) || "", /context string/);
  assert.match(validateCoachPayload({ context: 42 }) || "", /context string/);
});

test("validateCoachPayload requires currentPosition.fen", () => {
  assert.match(validateCoachPayload({ context: "position" }) || "", /current position/);
  assert.match(
    validateCoachPayload({ context: "position", currentPosition: {} }) || "",
    /current position/,
  );
});

test("validateCoachPayload accepts a well-shaped payload", () => {
  const result = validateCoachPayload({
    context: "position",
    currentPosition: { fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" },
  });
  assert.equal(result, null);
});

test("stripJsonFence removes ```json wrappers", () => {
  assert.equal(stripJsonFence('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripJsonFence("```\n{}\n```"), "{}");
  assert.equal(stripJsonFence("plain"), "plain");
});

test("extractOutputText prefers output_text", () => {
  assert.equal(extractOutputText({ output_text: "hello" }), "hello");
});

test("extractOutputText falls back to walking output[].content[]", () => {
  const data = {
    output: [{ content: [{ text: "one" }, { text: "two" }] }],
  };
  assert.equal(extractOutputText(data), "one\ntwo");
});

test("normalizeCoachResponse parses fenced JSON and clamps arrays", () => {
  const text =
    '```json\n{"summary":"s","plan":"p","candidate_explanations":[1,2,3,4,5,6],"weakness_focus":"w","practice_recommendations":["a","b","c","d","e"]}\n```';
  const result = normalizeCoachResponse(text);
  assert.equal(result.configured, true);
  assert.equal(result.summary, "s");
  assert.equal(result.plan, "p");
  assert.equal(result.candidate_explanations.length, 5);
  assert.equal(result.practice_recommendations.length, 4);
  assert.equal(result.weakness_focus, "w");
});

test("normalizeCoachResponse falls back to raw text when not JSON", () => {
  const result = normalizeCoachResponse("plain text");
  assert.equal(result.configured, true);
  assert.equal(result.summary, "plain text");
  assert.deepEqual(result.candidate_explanations, []);
});
