import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "../vendor/chess/chess.js";
import {
  LESSONS,
  getLessonById,
  lessonIndexById,
  getNextLesson,
  allLessonsComplete,
  beginnerTips,
  validateLessons,
} from "../lib/learn-lessons.mjs";

test("curriculum passes structural and chess validation", () => {
  const problems = validateLessons(Chess);
  assert.deepEqual(problems, [], `lesson problems:\n${problems.join("\n")}`);
});

test("curriculum has real coverage", () => {
  assert.ok(LESSONS.length >= 8, "curriculum should cover board, all pieces, check, mate, and special moves");
  const ids = LESSONS.map((lesson) => lesson.id);
  for (const required of ["board", "pawns", "rooks", "bishops", "queen", "knights", "king-check", "checkmate", "special-moves", "values"]) {
    assert.ok(ids.includes(required), `missing lesson: ${required}`);
  }
});

test("every task position is playable by White", () => {
  for (const lesson of LESSONS) {
    for (const step of lesson.steps) {
      if (step.kind !== "task") continue;
      const game = new Chess(step.fen);
      assert.equal(game.turn(), "w", `${lesson.id}: task must be White to move`);
      assert.equal(game.isGameOver(), false, `${lesson.id}: task position must be live (board interaction is blocked on finished games)`);
    }
  }
});

test("expected moves are legal and target squares match their destinations", () => {
  for (const lesson of LESSONS) {
    for (const step of lesson.steps) {
      if (step.kind !== "task") continue;
      for (const uci of step.expectedMoves) {
        const game = new Chess(step.fen);
        const move = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
        assert.ok(move, `${lesson.id}: expected move ${uci} illegal from ${step.fen}`);
        if (step.targetSquares?.length) {
          assert.ok(
            step.targetSquares.includes(uci.slice(2, 4)),
            `${lesson.id}: expected move ${uci} does not land on a starred square`,
          );
        }
      }
    }
  }
});

test("multi-step capture sequences chain: each next task FEN is reachable", () => {
  // The knight lesson models one hop per step; each step's FEN must equal the
  // previous position after the expected capture (with the turn handed back
  // to White). Compare piece placement only.
  const knights = getLessonById("knights");
  const tasks = knights.steps.filter((step) => step.kind === "task");
  for (let i = 0; i < tasks.length - 1; i += 1) {
    const game = new Chess(tasks[i].fen);
    const uci = tasks[i].expectedMoves[0];
    game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
    const placementAfter = game.fen().split(" ")[0];
    const nextPlacement = tasks[i + 1].fen.split(" ")[0];
    assert.equal(nextPlacement, placementAfter, `knight hop ${i + 1} does not chain into the next step`);
  }
});

test("checkmate lesson task actually delivers mate", () => {
  const lesson = getLessonById("checkmate");
  const task = lesson.steps.find((step) => step.kind === "task");
  const game = new Chess(task.fen);
  const uci = task.expectedMoves[0];
  game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
  assert.ok(game.isCheckmate(), "the mate task must end in checkmate");
});

test("stalemate info position is a real stalemate", () => {
  const lesson = getLessonById("checkmate");
  const info = lesson.steps.filter((step) => step.kind === "info").at(-1);
  const game = new Chess(info.fen);
  assert.ok(game.isStalemate(), "the stalemate example must be a genuine stalemate");
});

test("special moves lesson exercises castling, promotion, and en passant", () => {
  const lesson = getLessonById("special-moves");
  const sans = lesson.steps
    .filter((step) => step.kind === "task")
    .map((step) => {
      const game = new Chess(step.fen);
      const uci = step.expectedMoves[0];
      return game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
    });
  assert.ok(sans.some((san) => san.startsWith("O-O")), "castling task missing");
  assert.ok(sans.some((san) => san.includes("=Q")), "promotion task missing");
  const enPassant = lesson.steps.find((step) => step.fen.split(" ")[3] !== "-");
  assert.ok(enPassant, "en passant task missing (no FEN with an ep square)");
});

test("progress helpers walk the curriculum in order", () => {
  assert.equal(getNextLesson([]).id, LESSONS[0].id);
  assert.equal(getNextLesson([LESSONS[0].id]).id, LESSONS[1].id);
  assert.equal(getNextLesson(LESSONS.map((lesson) => lesson.id)), null);
  assert.equal(allLessonsComplete([]), false);
  assert.equal(allLessonsComplete(LESSONS.map((lesson) => lesson.id)), true);
  assert.equal(lessonIndexById(LESSONS.at(-1).id), LESSONS.length - 1);
  assert.equal(getLessonById("nope"), null);
});

test("every lesson contributes a beginner tip", () => {
  assert.equal(beginnerTips().length, LESSONS.length);
});
