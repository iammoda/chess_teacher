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

test("solutions alternate sides so scripted defender replies stay playable", () => {
  for (const position of ACTIVE_MATE_POSITIONS) {
    const solverColor = position.fen.split(" ")[1];
    const game = new Chess(position.fen);
    for (const [index, uci] of position.solution.entries()) {
      const expectedColor = index % 2 === 0 ? solverColor : (solverColor === "w" ? "b" : "w");
      assert.equal(game.turn(), expectedColor, `${position.id} ply ${index + 1} has the wrong side to move`);
      game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    }
    // The mate must be delivered by the solver, never the scripted defender.
    assert.equal(position.solution.length % 2, 1, `${position.id} should end on the solver's move`);
  }
});

test("every rung has enough positions to satisfy its own unlock rule", () => {
  const grouped = matesByRung();
  const rungs = [...grouped.keys()].sort((a, b) => a - b);
  assert.deepEqual(rungs, [1, 2, 3], "ladder should span three rungs");
  for (const rung of rungs.slice(0, -1)) {
    assert.ok(
      grouped.get(rung).length >= 3,
      `rung ${rung} needs at least 3 positions so rung ${rung + 1} can unlock`,
    );
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
