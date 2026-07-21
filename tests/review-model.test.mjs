import test from "node:test";
import assert from "node:assert/strict";
import { selectKeyMoments } from "../lib/review-model.mjs";

function move(overrides) {
  return {
    role: "player",
    ply: 1,
    san: "e4",
    beforeFen: "fen-before",
    afterFen: "fen-after",
    tags: [],
    ...overrides,
  };
}

test("empty and quiet games produce no moments", () => {
  assert.deepEqual(selectKeyMoments([]), []);
  const quiet = [
    move({ ply: 1, evalDelta: 10, qualityKey: "good" }),
    move({ ply: 3, evalDelta: 20, qualityKey: "good" }),
  ];
  assert.deepEqual(selectKeyMoments(quiet), []);
});

test("blunders and missed wins are picked and ordered by ply", () => {
  const moves = [
    move({ ply: 9, san: "Qh5", qualityKey: "blunder", evalDelta: 450 }),
    move({ ply: 3, san: "Nf3", qualityKey: "good", evalDelta: 5 }),
    move({ ply: 15, san: "Rd1", qualityKey: "missed_win", evalDelta: 300 }),
  ];
  const moments = selectKeyMoments(moves);
  assert.equal(moments.length, 2);
  assert.deepEqual(moments.map((m) => m.ply), [9, 15]);
  assert.equal(moments[0].cpl, 450);
  assert.match(moments[1].reason, /winning idea/i);
});

test("caps at three moments, keeping the biggest", () => {
  const moves = [
    move({ ply: 5, qualityKey: "blunder", evalDelta: 600 }),
    move({ ply: 11, qualityKey: "blunder", evalDelta: 500 }),
    move({ ply: 17, qualityKey: "mistake", evalDelta: 200 }),
    move({ ply: 23, qualityKey: "blunder", evalDelta: 800 }),
    move({ ply: 29, qualityKey: "mistake", evalDelta: 180 }),
  ];
  const moments = selectKeyMoments(moves);
  assert.equal(moments.length, 3);
  assert.deepEqual(moments.map((m) => m.ply), [5, 11, 23]);
});

test("adjacent plies dedupe to one moment", () => {
  const moves = [
    move({ ply: 9, qualityKey: "blunder", evalDelta: 500 }),
    move({ ply: 11, qualityKey: "blunder", evalDelta: 400 }),
  ];
  const moments = selectKeyMoments(moves);
  assert.equal(moments.length, 1);
  assert.equal(moments[0].ply, 9);
});

test("eval sign flips count as moments and engine/retracted moves are ignored", () => {
  const moves = [
    move({ ply: 13, san: "f4", evalBefore: 120, evalAfter: -140, evalDelta: 260, qualityKey: "mistake" }),
    move({ ply: 20, role: "engine", qualityKey: "blunder", evalDelta: 900 }),
    move({ ply: 21, qualityKey: "blunder", evalDelta: 900, retracted: true }),
  ];
  const moments = selectKeyMoments(moves);
  assert.equal(moments.length, 1);
  assert.equal(moments[0].ply, 13);
});

test("moment shape carries teaching context", () => {
  const moments = selectKeyMoments([
    move({
      ply: 9,
      san: "Qh5",
      qualityKey: "blunder",
      evalDelta: 450,
      bestMoveSan: "Nf3",
      principalVariation: ["Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d4"],
      tags: [{ label: "Hanging piece" }],
    }),
  ]);
  const moment = moments[0];
  assert.equal(moment.bestMoveSan, "Nf3");
  assert.equal(moment.principalVariation.length, 6);
  assert.deepEqual(moment.tags, ["Hanging piece"]);
  assert.equal(moment.fenBefore, "fen-before");
});
