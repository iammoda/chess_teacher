import test from "node:test";
import assert from "node:assert/strict";
import {
  GRADE_MISSED,
  GRADE_HARD,
  GRADE_SOLVED,
  createSrs,
  ensureSrs,
  applyGrade,
  isDue,
  selectDue,
  nextDueLabel,
} from "../lib/srs.mjs";

const NOW = new Date("2026-07-18T12:00:00Z");

test("new items are due immediately", () => {
  const srs = createSrs(NOW);
  assert.equal(isDue({ srs }, NOW), true);
  assert.equal(srs.reps, 0);
  assert.equal(srs.ease, 2.5);
});

test("ensureSrs adds fields without clobbering existing state", () => {
  const bare = ensureSrs({ id: "x" }, NOW);
  assert.equal(bare.srs.reps, 0);

  const existing = { id: "y", srs: { ease: 2.1, intervalDays: 3, dueAt: "2026-08-01T00:00:00Z", reps: 2, lapses: 1 } };
  assert.equal(ensureSrs(existing, NOW).srs.ease, 2.1);
});

test("solved progression: 1 day, 3 days, then interval * ease", () => {
  let srs = createSrs(NOW);
  srs = applyGrade(srs, GRADE_SOLVED, NOW);
  assert.equal(srs.intervalDays, 1);
  srs = applyGrade(srs, GRADE_SOLVED, NOW);
  assert.equal(srs.intervalDays, 3);
  srs = applyGrade(srs, GRADE_SOLVED, NOW);
  assert.equal(srs.intervalDays, Math.round(3 * 2.5));
  assert.equal(isDue({ srs }, NOW), false);
});

test("missed resets reps, lowers ease with a floor, and is due now", () => {
  let srs = createSrs(NOW);
  srs = applyGrade(srs, GRADE_SOLVED, NOW);
  srs = applyGrade(srs, GRADE_SOLVED, NOW);
  srs = applyGrade(srs, GRADE_MISSED, NOW);
  assert.equal(srs.reps, 0);
  assert.equal(srs.lapses, 1);
  assert.equal(srs.intervalDays, 0);
  assert.equal(isDue({ srs }, NOW), true);

  for (let i = 0; i < 20; i++) srs = applyGrade(srs, GRADE_MISSED, NOW);
  assert.equal(srs.ease, 1.3);
});

test("hard keeps the interval but chips the ease", () => {
  let srs = createSrs(NOW);
  srs = applyGrade(srs, GRADE_SOLVED, NOW);
  const easeBefore = srs.ease;
  srs = applyGrade(srs, GRADE_HARD, NOW);
  assert.equal(srs.intervalDays, 1);
  assert.ok(srs.ease < easeBefore);
});

test("selectDue orders by due date and respects the limit", () => {
  const items = [
    { id: "later", srs: { ...createSrs(NOW), dueAt: "2026-07-18T11:00:00Z" } },
    { id: "earliest", srs: { ...createSrs(NOW), dueAt: "2026-07-17T00:00:00Z" } },
    { id: "future", srs: { ...createSrs(NOW), dueAt: "2026-09-01T00:00:00Z" } },
    { id: "no-srs" },
  ];
  const due = selectDue(items, NOW);
  assert.deepEqual(due.map((item) => item.id), ["no-srs", "earliest", "later"]);
  assert.equal(selectDue(items, NOW, 1).length, 1);
});

test("nextDueLabel is human readable", () => {
  const dueNow = { srs: createSrs(NOW) };
  assert.equal(nextDueLabel(dueNow, NOW), "due now");
  const tomorrow = { srs: { ...createSrs(NOW), dueAt: new Date(NOW.getTime() + 20 * 60 * 60 * 1000).toISOString() } };
  assert.equal(nextDueLabel(tomorrow, NOW), "due tomorrow");
  const nextWeek = { srs: { ...createSrs(NOW), dueAt: new Date(NOW.getTime() + 6.5 * 24 * 60 * 60 * 1000).toISOString() } };
  assert.equal(nextDueLabel(nextWeek, NOW), "due in 7 days");
});
