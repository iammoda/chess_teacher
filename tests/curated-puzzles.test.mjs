import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Chess } from "../vendor/chess/chess.js";

// The curated puzzles live inside app.js (no build step, not importable).
// Extract the array literal and evaluate it — it's plain data.
const appSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app.js"),
  "utf8",
);

function extractArray(name) {
  const start = appSource.indexOf(`const ${name} = [`);
  assert.notEqual(start, -1, `${name} found in app.js`);
  const open = appSource.indexOf("[", start);
  let depth = 0;
  for (let i = open; i < appSource.length; i += 1) {
    if (appSource[i] === "[") depth += 1;
    if (appSource[i] === "]") {
      depth -= 1;
      if (depth === 0) {
        return new Function(`return ${appSource.slice(open, i + 1)}`)();
      }
    }
  }
  assert.fail(`unterminated ${name} array`);
}

const puzzles = extractArray("CURATED_PRACTICE_PUZZLES");

test("curated puzzles have loadable FENs and the right side to move", () => {
  assert.ok(puzzles.length >= 5);
  for (const puzzle of puzzles) {
    const chess = new Chess(puzzle.fen);
    assert.equal(chess.turn(), puzzle.playerColor, `${puzzle.id}: playerColor matches FEN turn`);
  }
});

test("every curated expected move is legal", () => {
  for (const puzzle of puzzles) {
    for (const uci of puzzle.expectedMoves) {
      const chess = new Chess(puzzle.fen);
      assert.doesNotThrow(
        () => chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" }),
        `${puzzle.id}: ${uci} is legal`,
      );
    }
  }
});

test("mate puzzles actually deliver checkmate", () => {
  for (const puzzle of puzzles.filter((p) => p.category === "missed_mate")) {
    for (const uci of puzzle.expectedMoves) {
      const chess = new Chess(puzzle.fen);
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" });
      assert.ok(chess.isCheckmate(), `${puzzle.id}: ${uci} is checkmate`);
    }
  }
});

test("expected moves never hang the moved piece to an unanswerable capture", () => {
  // A puzzle solution that can be immediately refuted by capturing the piece
  // we just moved — with no recapture available — teaches losing chess
  // (this caught a real bug: discovered-attack-1's knight hung to Qxe7).
  for (const puzzle of puzzles) {
    for (const uci of puzzle.expectedMoves) {
      const chess = new Chess(puzzle.fen);
      const played = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" });
      if (chess.isGameOver()) continue;
      const dest = played.to;
      for (const reply of chess.moves({ verbose: true })) {
        if (reply.to !== dest || !reply.captured) continue;
        // Opponent can capture our moved piece — we must have a recapture.
        const after = new Chess(chess.fen());
        after.move(reply);
        const recapture = after.moves({ verbose: true }).some((m) => m.to === dest && m.captured);
        assert.ok(
          recapture,
          `${puzzle.id}: after ${played.san}, ${reply.san} wins the moved piece with no recapture`,
        );
      }
    }
  }
});
