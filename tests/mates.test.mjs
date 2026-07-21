import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "../vendor/chess/chess.js";
import {
  ACTIVE_MATE_POSITIONS,
  getMatePositionById,
  matesByRung,
  isRungUnlocked,
  recordMateAttempt,
} from "../lib/mates.mjs";

test("every active mate position's solution ends in checkmate", () => {
  assert.ok(ACTIVE_MATE_POSITIONS.length >= 4, "ladder should have real content");
  for (const position of ACTIVE_MATE_POSITIONS) {
    const game = new Chess(position.fen);
    for (const [index, uci] of position.solution.entries()) {
      const move = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      assert.ok(move, `${position.id} ply ${index + 1} (${uci}) is illegal on ${game.fen()}`);
    }
    assert.ok(game.isCheckmate(), `${position.id} solution did not deliver checkmate — ended at ${game.fen()}`);
  }
});

test("positions have unique ids", () => {
  const ids = ACTIVE_MATE_POSITIONS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("getMatePositionById returns positions or null", () => {
  assert.ok(getMatePositionById(ACTIVE_MATE_POSITIONS[0].id));
  assert.equal(getMatePositionById("nope"), null);
});

test("matesByRung groups by rung level", () => {
  const grouped = matesByRung();
  assert.ok(grouped.size >= 1);
  for (const [rung, list] of grouped) {
    for (const item of list) assert.equal(item.rung, rung);
  }
});

test("rung 1 always unlocked; higher rungs need prior solves", () => {
  assert.equal(isRungUnlocked(1, null), true);
  assert.equal(isRungUnlocked(2, {}), false);
  assert.equal(isRungUnlocked(2, { rungSolved: { "1": 2 } }), false);
  assert.equal(isRungUnlocked(2, { rungSolved: { "1": 3 } }), true);
});

test("recordMateAttempt tallies solves per rung idempotently", () => {
  let progress = { solved: [], attempts: {}, rungSolved: {} };
  progress = recordMateAttempt(progress, "back-rank-1", 1, false);
  assert.equal(progress.attempts["back-rank-1"], 1);
  assert.equal(progress.rungSolved["1"], undefined);

  progress = recordMateAttempt(progress, "back-rank-1", 1, true);
  assert.equal(progress.solved.includes("back-rank-1"), true);
  assert.equal(progress.rungSolved["1"], 1);

  // Solving the same one again should not double-count for unlocks.
  progress = recordMateAttempt(progress, "back-rank-1", 1, true);
  assert.equal(progress.rungSolved["1"], 1);
});
