import test from "node:test";
import assert from "node:assert/strict";
import { squareCenter, arrowSvg, arrowsOverlaySvg, uciToArrow } from "../lib/board-arrows.mjs";

test("squareCenter maps files/ranks to 8x8 centers", () => {
  assert.deepEqual(squareCenter("a1", false), { x: 0.5, y: 7.5 });
  assert.deepEqual(squareCenter("h8", false), { x: 7.5, y: 0.5 });
  assert.deepEqual(squareCenter("e4", false), { x: 4.5, y: 4.5 });
});

test("squareCenter honors board flip", () => {
  assert.deepEqual(squareCenter("a1", true), { x: 7.5, y: 0.5 });
  assert.deepEqual(squareCenter("h8", true), { x: 0.5, y: 7.5 });
});

test("squareCenter rejects invalid squares", () => {
  assert.equal(squareCenter("z9", false), null);
  assert.equal(squareCenter("", false), null);
});

test("arrowSvg emits shaft + head with the requested kind class", () => {
  const svg = arrowSvg({ from: "e2", to: "e4", flipped: false, kind: "best" });
  assert.match(svg, /class="board-arrow arrow-best"/);
  assert.match(svg, /<line/);
  assert.match(svg, /<polygon/);
});

test("arrowSvg returns empty when from == to", () => {
  assert.equal(arrowSvg({ from: "e4", to: "e4", flipped: false }), "");
});

test("arrowsOverlaySvg composes multiple arrows, filters bad entries", () => {
  const overlay = arrowsOverlaySvg([
    { from: "e2", to: "e4", kind: "best" },
    { from: "d7", to: "d5", kind: "played" },
    null,
    { from: "a1" },
  ], false);
  assert.equal((overlay.match(/board-arrow/g) || []).length, 2);
  assert.match(overlay, /arrow-best/);
  assert.match(overlay, /arrow-played/);
});

test("uciToArrow parses UCI or returns null", () => {
  assert.deepEqual(uciToArrow("e2e4", "best"), { from: "e2", to: "e4", kind: "best" });
  assert.deepEqual(uciToArrow("e7e8q", "coach"), { from: "e7", to: "e8", kind: "coach" });
  assert.equal(uciToArrow("", "best"), null);
  assert.equal(uciToArrow("e2", "best"), null);
});
