import test from "node:test";
import assert from "node:assert/strict";
import { Chess } from "../vendor/chess/chess.js";
import { REPERTOIRE, getOpeningById, getLineById, learnerPlaysAt } from "../lib/repertoire.mjs";

test("every repertoire line replays legally through chess.js", () => {
  for (const opening of REPERTOIRE) {
    for (const line of opening.lines) {
      const game = new Chess();
      for (const [index, moveEntry] of line.moves.entries()) {
        let played;
        try {
          played = game.move(moveEntry.san);
        } catch (error) {
          assert.fail(`${opening.id}/${line.id} ply ${index + 1} (${moveEntry.san}) is illegal: ${error.message}`);
        }
        assert.ok(played, `${opening.id}/${line.id} ply ${index + 1} (${moveEntry.san}) did not apply`);
      }
    }
  }
});

test("lines are long enough to teach and have unique ids", () => {
  const ids = new Set();
  for (const opening of REPERTOIRE) {
    assert.ok(opening.lines.length >= 1, `${opening.id} has no lines`);
    for (const line of opening.lines) {
      assert.ok(!ids.has(line.id), `duplicate line id ${line.id}`);
      ids.add(line.id);
      assert.ok(line.moves.length >= 12, `${line.id} has only ${line.moves.length} plies`);
    }
  }
  const openingIds = REPERTOIRE.map((opening) => opening.id);
  assert.equal(new Set(openingIds).size, openingIds.length);
});

test("every learner-side move carries a why", () => {
  for (const opening of REPERTOIRE) {
    for (const line of opening.lines) {
      for (const [index, moveEntry] of line.moves.entries()) {
        if (learnerPlaysAt(opening.side, index)) {
          assert.ok(
            typeof moveEntry.why === "string" && moveEntry.why.length >= 10,
            `${line.id} learner ply ${index + 1} (${moveEntry.san}) is missing a why`,
          );
        }
      }
    }
  }
});

test("repertoire covers both colors", () => {
  assert.ok(REPERTOIRE.some((opening) => opening.side === "w"));
  assert.ok(REPERTOIRE.some((opening) => opening.side === "b"));
  assert.ok(REPERTOIRE.length >= 10);
});

test("lookups resolve openings and lines", () => {
  assert.equal(getOpeningById("italian")?.name, "Italian Game");
  assert.equal(getOpeningById("nope"), null);
  const found = getLineById("najdorf-main");
  assert.equal(found.opening.id, "sicilian-najdorf-black");
  assert.equal(getLineById("nope"), null);
});

test("learnerPlaysAt alternates correctly for both sides", () => {
  assert.equal(learnerPlaysAt("w", 0), true);
  assert.equal(learnerPlaysAt("w", 1), false);
  assert.equal(learnerPlaysAt("b", 0), false);
  assert.equal(learnerPlaysAt("b", 1), true);
});
