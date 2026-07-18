import test from "node:test";
import assert from "node:assert/strict";
import {
  SKILL_CATALOG,
  getSkillById,
  getSkillCategories,
  getSkillForCategory,
  skillMatchesCategory,
} from "../lib/skill-model.mjs";

test("skill catalog exposes stable Skill Lab ids", () => {
  const ids = SKILL_CATALOG.map((skill) => skill.id);
  assert.ok(ids.includes("forks"));
  assert.ok(ids.includes("checkmates"));
  assert.ok(ids.includes("candidate-moves"));
});

test("categories route to the expected Skill Lab", () => {
  assert.equal(getSkillForCategory("missed_fork").id, "forks");
  assert.equal(getSkillForCategory("missed_pin").id, "pins");
  assert.equal(getSkillForCategory("hanging_piece").id, "loose-pieces");
  assert.equal(getSkillForCategory("unknown_category").id, "candidate-moves");
});

test("skill matching includes related transfer categories", () => {
  const kingSafety = getSkillById("king-safety");
  assert.ok(skillMatchesCategory(kingSafety, "king_safety"));
  assert.ok(skillMatchesCategory(kingSafety, "opening_principle"));
  assert.deepEqual([...new Set(getSkillCategories(kingSafety))], getSkillCategories(kingSafety));
});
