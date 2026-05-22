import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALYSIS_DEPTH,
  EVAL_THRESHOLDS,
  MATE_SCORE_CP,
  classifyMoveQuality,
  classifyByEval,
  centipawnLossFromEngineResults,
  centipawnLossFromEvals,
  normalizeEngineAnalysis,
  scoreToComparableCp,
} from "../lib/classify.mjs";

test("ANALYSIS_DEPTH is a sane positive integer", () => {
  assert.ok(Number.isInteger(ANALYSIS_DEPTH) && ANALYSIS_DEPTH > 0);
});

test("classifyByEval crosses thresholds correctly", () => {
  assert.equal(classifyByEval(0, "neutral"), "neutral");
  assert.equal(classifyByEval(49, "neutral"), "neutral");
  assert.equal(classifyByEval(EVAL_THRESHOLDS.inaccuracy, "neutral"), "inaccuracy");
  assert.equal(classifyByEval(149, "neutral"), "inaccuracy");
  assert.equal(classifyByEval(EVAL_THRESHOLDS.mistake, "neutral"), "mistake");
  assert.equal(classifyByEval(299, "neutral"), "mistake");
  assert.equal(classifyByEval(EVAL_THRESHOLDS.blunder, "neutral"), "blunder");
  assert.equal(classifyByEval(900, "neutral"), "blunder");
});

test("classifyByEval preserves a stronger heuristic fallback when eval says no loss", () => {
  // Heuristic flagged a mistake, eval saw zero centipawn loss — keep the heuristic call.
  assert.equal(classifyByEval(10, "mistake"), "mistake");
  assert.equal(classifyByEval(10, "blunder"), "blunder");
  assert.equal(classifyByEval(10, "inaccuracy"), "neutral");
  assert.equal(classifyByEval(10, "neutral"), "neutral");
});

test("centipawnLossFromEvals computes player-perspective loss", () => {
  // before +50 (player POV), after +300 (opponent POV) -> loss = 50 + 300 = 350
  assert.equal(centipawnLossFromEvals(50, 300), 350);
  // before +50, after -50 (opponent POV) -> player gained, clamped to 0
  assert.equal(centipawnLossFromEvals(50, -50), 0);
  // missing data
  assert.equal(centipawnLossFromEvals(null, 100), null);
  assert.equal(centipawnLossFromEvals(100, undefined), null);
});

test("scoreToComparableCp maps mate scores to large comparable values", () => {
  assert.equal(scoreToComparableCp(42, null), 42);
  assert.equal(scoreToComparableCp(null, 3), MATE_SCORE_CP - 300);
  assert.equal(scoreToComparableCp(null, -2), -(MATE_SCORE_CP - 200));
  assert.equal(scoreToComparableCp(null, undefined), null);
});

test("centipawnLossFromEngineResults is mate-aware", () => {
  assert.equal(
    centipawnLossFromEngineResults({ scoreCp: 50, mate: null }, { scoreCp: 300, mate: null }),
    350,
  );
  assert.equal(
    centipawnLossFromEngineResults({ scoreCp: 800, mate: null }, { scoreCp: null, mate: 4 }),
    MATE_SCORE_CP - 400 + 800,
  );
  assert.equal(
    centipawnLossFromEngineResults({ scoreCp: null, mate: 3 }, { scoreCp: null, mate: -2 }),
    0,
  );
});

test("normalizeEngineAnalysis returns stable move-record fields", () => {
  const result = normalizeEngineAnalysis({
    depth: 12,
    bestMoveSan: "Nf3",
    before: {
      source: "local",
      scoreCp: 40,
      mate: null,
      bestMove: "g1f3",
      pv: ["g1f3", "g8f6", "d2d4"],
    },
    after: {
      source: "local",
      scoreCp: 180,
      mate: null,
      bestMove: "g8f6",
      pv: ["g8f6"],
    },
  });

  assert.equal(result.analysisStatus, "complete");
  assert.equal(result.engineDepth, 12);
  assert.equal(result.engineSource, "local");
  assert.equal(result.evalBefore, 40);
  assert.equal(result.evalAfter, 180);
  assert.equal(result.evalDelta, 220);
  assert.equal(result.bestMoveUci, "g1f3");
  assert.equal(result.bestMoveSan, "Nf3");
  assert.deepEqual(result.principalVariation, ["g1f3", "g8f6", "d2d4"]);
});

test("classifyMoveQuality identifies engine-best and clean moves", () => {
  assert.deepEqual(
    classifyMoveQuality({
      evalDelta: 0,
      playedUci: "g1f3",
      bestMoveUci: "g1f3",
      tags: [],
    }),
    {
      key: "best",
      label: "Best",
      symbol: "*",
      tone: "positive",
      reason: "Stockfish also preferred this move.",
    },
  );

  const excellent = classifyMoveQuality({ evalDelta: 12, tags: [] });
  assert.equal(excellent.key, "excellent");
  assert.equal(excellent.label, "Excellent");

  const good = classifyMoveQuality({ evalDelta: null, tags: [] });
  assert.equal(good.key, "good");
});

test("classifyMoveQuality maps eval loss thresholds to cues", () => {
  assert.equal(classifyMoveQuality({ evalDelta: 50 }).key, "inaccuracy");
  assert.equal(classifyMoveQuality({ evalDelta: 150 }).key, "mistake");
  assert.equal(classifyMoveQuality({ evalDelta: 300 }).key, "blunder");
});

test("classifyMoveQuality handles book and heuristic fallback cues", () => {
  assert.equal(classifyMoveQuality({ openingKnown: true, evalDelta: null }).key, "book");
  assert.equal(classifyMoveQuality({
    classification: "inaccuracy",
    tags: [{ category: "opening_principle", severity: 2 }],
  }).key, "inaccuracy");
  assert.equal(classifyMoveQuality({
    tags: [{ category: "missed_fork", severity: 3 }],
  }).key, "missed_win");
});

test("classifyMoveQuality detects missed forced mate from mate scores", () => {
  assert.equal(classifyMoveQuality({ mateBefore: 2, mateAfter: null }).key, "missed_win");
  assert.equal(classifyMoveQuality({ mateBefore: 2, mateAfter: -3, evalDelta: 0 }).key, "excellent");
});
