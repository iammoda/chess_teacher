import test from "node:test";
import assert from "node:assert/strict";
import { classifyMoveForSound } from "../lib/sounds.mjs";

const mateAfter = { isCheckmate: () => true, isCheck: () => true, turn: () => "b" };
const quietAfter = { isCheckmate: () => false, isCheck: () => false };

test("checkmate sound depends on who is listening, not who moved", () => {
  const whiteMates = { color: "w", san: "Qh7#" };
  // White (the player) delivers mate → win fanfare.
  assert.equal(classifyMoveForSound(whiteMates, mateAfter, "w"), "gameWin");
  // The bot (White) mates the human (Black) → loss sting, not a fanfare.
  assert.equal(classifyMoveForSound(whiteMates, mateAfter, "b"), "gameLoss");
});

test("non-mate move classification is unchanged", () => {
  assert.equal(classifyMoveForSound({ color: "w", san: "e4" }, quietAfter, "w"), "move");
  assert.equal(classifyMoveForSound({ color: "w", san: "exd5", captured: "p" }, quietAfter, "w"), "capture");
  assert.equal(classifyMoveForSound({ color: "w", san: "O-O" }, quietAfter, "w"), "castle");
  assert.equal(classifyMoveForSound({ color: "w", san: "e8=Q", promotion: "q" }, quietAfter, "w"), "promotion");
});
