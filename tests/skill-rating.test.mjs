import test from "node:test";
import assert from "node:assert/strict";
import {
  SKILL_DIMENSIONS,
  createEmptySkillState,
  seedSkillStateFromScore,
  dimensionsForMove,
  movePerformance,
  applyMoveToSkillState,
  applyGameResultToSkillState,
  overallRating,
  nextLevelFor,
  skillSnapshot,
} from "../lib/skill-rating.mjs";

test("empty state has all four dimensions with no data", () => {
  const state = createEmptySkillState();
  assert.deepEqual(Object.keys(state.dims).sort(), [...SKILL_DIMENSIONS].sort());
  for (const dim of SKILL_DIMENSIONS) {
    assert.equal(state.dims[dim].rating, null);
    assert.equal(state.dims[dim].samples, 0);
  }
  assert.equal(overallRating(state), null);
});

test("seeding from a scalar score sets every dimension with modest confidence", () => {
  const state = seedSkillStateFromScore(1100);
  for (const dim of SKILL_DIMENSIONS) {
    assert.equal(state.dims[dim].rating, 1100);
    assert.equal(state.dims[dim].confidence, 0.4);
    assert.equal(state.dims[dim].samples, 15);
  }
  assert.equal(overallRating(state), 1100);
});

test("dimensionsForMove maps phases and tactical signals", () => {
  assert.deepEqual(dimensionsForMove({ phase: "opening", tags: [] }), ["openings"]);
  assert.deepEqual(dimensionsForMove({ phase: "endgame", tags: [] }), ["endgames"]);
  assert.deepEqual(dimensionsForMove({ phase: "middlegame", tags: [] }), ["calculation"]);

  const withFork = dimensionsForMove({ phase: "middlegame", tags: [{ category: "missed_fork" }] });
  assert.ok(withFork.includes("tactics"));
  assert.ok(withFork.includes("calculation"));

  const blunder = dimensionsForMove({ phase: "opening", tags: [], qualityKey: "blunder" });
  assert.ok(blunder.includes("tactics"));

  const bigSwing = dimensionsForMove({ phase: "middlegame", tags: [], evalDelta: 200 });
  assert.ok(bigSwing.includes("tactics"));
});

test("movePerformance rewards best moves and scales with centipawn loss", () => {
  assert.equal(movePerformance({ qualityKey: "best" }), 1);
  assert.equal(movePerformance({ qualityKey: "book" }), 1);
  assert.equal(movePerformance({ evalDelta: 0 }), 1);
  assert.equal(movePerformance({ evalDelta: 150 }), 0.5);
  assert.equal(movePerformance({ evalDelta: 300 }), 0);
  assert.equal(movePerformance({ evalDelta: 900 }), 0);
  assert.equal(movePerformance({}), null);
});

test("EWMA updates move ratings smoothly and confidence grows", () => {
  const state = seedSkillStateFromScore(1000);
  const before = state.dims.calculation.rating;

  applyMoveToSkillState(state, { phase: "middlegame", tags: [], evalDelta: 400, qualityKey: "blunder" });
  const after = state.dims.calculation.rating;
  assert.ok(after < before, "bad move lowers rating");
  assert.ok(before - after < 120, "one move does not crater the rating");
  assert.equal(state.dims.calculation.samples, 16);

  for (let i = 0; i < 30; i++) {
    applyMoveToSkillState(state, { phase: "middlegame", tags: [], evalDelta: 0, qualityKey: "best" });
  }
  assert.ok(state.dims.calculation.rating > after, "good moves recover the rating");
  assert.equal(state.dims.calculation.confidence, 1);
});

test("ungraded moves leave the state untouched", () => {
  const state = seedSkillStateFromScore(1000);
  const snapshotBefore = JSON.stringify(state.dims);
  applyMoveToSkillState(state, { phase: "middlegame", tags: [] });
  assert.equal(JSON.stringify(state.dims), snapshotBefore);
});

test("game results nudge ratings toward the expected score", () => {
  const win = seedSkillStateFromScore(1000);
  applyGameResultToSkillState(win, { resultScore: 1, opponentElo: 1000 });
  assert.ok(win.dims.tactics.rating > 1000);

  const loss = seedSkillStateFromScore(1000);
  applyGameResultToSkillState(loss, { resultScore: 0, opponentElo: 1000 });
  assert.ok(loss.dims.tactics.rating < 1000);

  // Beating a much weaker opponent barely moves the needle.
  const easyWin = seedSkillStateFromScore(1400);
  applyGameResultToSkillState(easyWin, { resultScore: 1, opponentElo: 700 });
  assert.ok(easyWin.dims.tactics.rating - 1400 <= 2);
});

test("nextLevelFor returns band-appropriate guidance", () => {
  assert.match(nextLevelFor("tactics", 600), /undefended/);
  assert.match(nextLevelFor("tactics", 1000), /checks, captures/i);
  assert.match(nextLevelFor("endgames", 500), /king/i);
  assert.ok(nextLevelFor("calculation", 9999));
});

test("skillSnapshot is compact and includes next-level text", () => {
  const state = seedSkillStateFromScore(900);
  const snapshot = skillSnapshot(state);
  assert.equal(snapshot.overall, 900);
  for (const dim of SKILL_DIMENSIONS) {
    assert.equal(snapshot[dim].rating, 900);
    assert.equal(typeof snapshot[dim].nextLevel, "string");
    assert.ok(snapshot[dim].nextLevel.length > 0);
  }
});
