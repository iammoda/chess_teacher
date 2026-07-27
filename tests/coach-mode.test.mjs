import { test } from "node:test";
import assert from "node:assert/strict";
import { COACH_MODES, coachModeAllows } from "../lib/coach-mode.mjs";

test("hints mode allows every kind of coach speech", () => {
  for (const kind of ["live", "postgame", "drill"]) {
    assert.equal(coachModeAllows("hints", kind), true, kind);
  }
});

test("post_game mode blocks live interruptions only", () => {
  assert.equal(coachModeAllows("post_game", "live"), false);
  assert.equal(coachModeAllows("post_game", "postgame"), true);
  assert.equal(coachModeAllows("post_game", "drill"), true);
});

test("silent mode blocks all coach-initiated speech", () => {
  for (const kind of ["live", "postgame", "drill"]) {
    assert.equal(coachModeAllows("silent", kind), false, kind);
  }
});

test("unknown or missing modes fall back to hints (never accidentally mute)", () => {
  assert.equal(coachModeAllows(undefined, "live"), true);
  assert.equal(coachModeAllows("", "postgame"), true);
  assert.equal(coachModeAllows("bogus", "drill"), true);
});

test("mode list is stable for the settings dropdown", () => {
  assert.deepEqual(COACH_MODES, ["hints", "post_game", "silent"]);
});
