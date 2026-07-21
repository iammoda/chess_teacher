import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Chess } from "../vendor/chess/chess.js";
import { normalizePackPuzzle, ratingBandForScore, selectRatedPuzzle } from "../lib/puzzle-packs.mjs";

const pack = JSON.parse(await readFile(new URL("../vendor/puzzles/lichess-pack.json", import.meta.url), "utf8"));

const KNOWN_CATEGORIES = new Set([
  "missed_mate", "missed_fork", "missed_pin", "missed_skewer",
  "missed_capture", "discovered_attack", "hanging_piece",
]);

test("the vendored pack is CC0-attributed and well-formed", () => {
  assert.match(pack.license, /CC0/);
  assert.ok(pack.puzzles.length >= 100, "pack should carry real volume");

  const ids = pack.puzzles.map((puzzle) => puzzle.id);
  assert.equal(new Set(ids).size, ids.length, "puzzle ids must be unique");

  for (const puzzle of pack.puzzles) {
    assert.ok(KNOWN_CATEGORIES.has(puzzle.category), `${puzzle.id}: unknown category ${puzzle.category}`);
    assert.ok(puzzle.band >= 1 && puzzle.band <= 4, `${puzzle.id}: bad band`);
    assert.ok(puzzle.rating >= 600 && puzzle.rating <= 1799, `${puzzle.id}: rating out of range`);
    assert.equal(puzzle.solutionLine.length % 2, 1, `${puzzle.id}: solution must end on the player's move`);
  }
});

test("every pack puzzle's solution line is legal and starts with the player to move", () => {
  for (const puzzle of pack.puzzles) {
    const game = new Chess(puzzle.fen);
    assert.equal(game.turn(), puzzle.playerColor, `${puzzle.id}: playerColor mismatch`);
    for (const [index, uci] of puzzle.solutionLine.entries()) {
      const move = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      assert.ok(move, `${puzzle.id} ply ${index + 1} (${uci}) is illegal on ${game.fen()}`);
    }
  }
});

test("mate puzzles actually end in checkmate", () => {
  const matePuzzles = pack.puzzles.filter((puzzle) =>
    puzzle.themes?.some((theme) => theme === "mateIn1" || theme === "mateIn2"));
  assert.ok(matePuzzles.length > 0);
  for (const puzzle of matePuzzles) {
    const game = new Chess(puzzle.fen);
    for (const uci of puzzle.solutionLine) {
      game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    }
    assert.ok(game.isCheckmate(), `${puzzle.id} did not end in mate`);
  }
});

test("normalizePackPuzzle produces the practice-trainer shape", () => {
  const raw = pack.puzzles[0];
  const puzzle = normalizePackPuzzle(raw);
  assert.equal(puzzle.source, "lichess");
  assert.equal(puzzle.sourceKey, `lichess:${raw.lichessId}`);
  assert.deepEqual(puzzle.expectedMoves, [raw.solutionLine[0]]);
  assert.deepEqual(puzzle.solutionLine, raw.solutionLine);
  assert.deepEqual(puzzle.targetSquares, [raw.solutionLine[0].slice(2, 4)]);
  assert.ok(puzzle.plainTitle.includes(String(raw.rating)));

  assert.equal(normalizePackPuzzle({}), null);
  assert.equal(normalizePackPuzzle({ fen: "x", solutionLine: [] }), null);
});

test("ratingBandForScore maps the training score range", () => {
  assert.equal(ratingBandForScore(null), 2);
  assert.equal(ratingBandForScore(650), 1);
  assert.equal(ratingBandForScore(1000), 2);
  assert.equal(ratingBandForScore(1350), 3);
  assert.equal(ratingBandForScore(1700), 4);
});

test("selectRatedPuzzle prefers unsolved, near-band, weakness-first", () => {
  const puzzles = [
    { id: "a", sourceKey: "k:a", band: 1, rating: 700, category: "missed_fork" },
    { id: "b", sourceKey: "k:b", band: 2, rating: 1000, category: "missed_pin" },
    { id: "c", sourceKey: "k:c", band: 2, rating: 1100, category: "missed_fork" },
    { id: "d", sourceKey: "k:d", band: 4, rating: 1600, category: "missed_mate" },
  ];

  // Band 2 score, fork weakness: picks the band-2 fork.
  const pick = selectRatedPuzzle(puzzles, { score: 1000, weaknessCategories: ["missed_fork"] });
  assert.equal(pick.id, "c");

  // Once solved, it falls back to the other band-2 puzzle.
  const next = selectRatedPuzzle(puzzles, {
    score: 1000,
    weaknessCategories: ["missed_fork"],
    solvedKeys: new Set(["k:c"]),
  });
  assert.equal(next.id, "b");

  // excludeKey skips the current drill; empty pool returns null.
  assert.equal(selectRatedPuzzle(puzzles, { excludeKey: "k:b", score: 1000 }).id, "c");
  assert.equal(selectRatedPuzzle([], {}), null);
});
