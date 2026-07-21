import test from "node:test";
import assert from "node:assert/strict";
import { verifyTagsWithEngine, TACTICAL_CLAIM_CATEGORIES } from "../lib/tag-verify.mjs";

const fork = { category: "missed_fork", label: "Missed fork", severity: 2, note: "Nd5 forks king and rook." };
const hanging = { category: "hanging_piece", label: "Loose piece", severity: 3, note: "The bishop is undefended." };
const principle = { category: "opening_principle", label: "Early queen move", severity: 2, note: "Develop first." };
const missedMate = { category: "missed_mate", label: "Missed mate", severity: 3, note: "Qh7 was mate." };

test("without engine data nothing changes and verified is false", () => {
  const result = verifyTagsWithEngine([fork, hanging], { evalDelta: null });
  assert.equal(result.verified, false);
  assert.deepEqual(result.tags, [fork, hanging]);
  assert.deepEqual(result.removed, []);
});

test("tactical claims are dropped when the engine says nothing was lost", () => {
  const result = verifyTagsWithEngine([fork, hanging, principle], { evalDelta: 12 });
  assert.equal(result.verified, true);
  assert.deepEqual(result.tags, [principle]);
  assert.deepEqual(result.removed, [fork, hanging]);
});

test("tactical claims survive when the engine confirms real loss", () => {
  const result = verifyTagsWithEngine([fork, hanging], { evalDelta: 180 });
  assert.deepEqual(result.tags, [fork, hanging]);
  assert.deepEqual(result.removed, []);
});

test("losing a forced mate keeps every claim even with a tiny eval delta", () => {
  const result = verifyTagsWithEngine([fork], { evalDelta: 10, mateBefore: 2, mateAfter: null });
  assert.deepEqual(result.tags, [fork]);
  assert.deepEqual(result.removed, []);
});

test("still-forcing-mate counts as keeping the win", () => {
  // mateBefore 1, played a slower move that still mates (mateAfter -3 =
  // opponent gets mated): claims with no eval backing are dropped.
  const result = verifyTagsWithEngine([fork], { evalDelta: 5, mateBefore: 1, mateAfter: -3 });
  assert.deepEqual(result.removed, [fork]);
});

test("missed mate-in-1 is downgraded, never dropped", () => {
  const stillWinning = verifyTagsWithEngine([missedMate], { evalDelta: 8, mateBefore: 1, mateAfter: -2 });
  assert.equal(stillWinning.tags.length, 1);
  assert.equal(stillWinning.tags[0].severity, 2, "downgraded below missed-win threshold");
  assert.deepEqual(stillWinning.removed, []);

  const lostIt = verifyTagsWithEngine([missedMate], { evalDelta: 350, mateBefore: 1, mateAfter: null });
  assert.equal(lostIt.tags[0].severity, 3, "kept at full severity when the win was lost");
});

test("principle nudges are never engine-falsified", () => {
  for (const category of ["opening_principle", "king_safety", "candidate_moves"]) {
    assert.ok(!TACTICAL_CLAIM_CATEGORIES.has(category), category);
    const tag = { category, label: "x", severity: 2, note: "" };
    const result = verifyTagsWithEngine([tag], { evalDelta: 0 });
    assert.deepEqual(result.tags, [tag]);
  }
});
