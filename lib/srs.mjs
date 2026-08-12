// SM-2-lite spaced repetition. Grades: 0 = missed, 1 = hard, 2 = solved.

export const GRADE_MISSED = 0;
export const GRADE_HARD = 1;
export const GRADE_SOLVED = 2;

const EASE_START = 2.5;
const EASE_FLOOR = 1.3;
const DAY_MS = 24 * 60 * 60 * 1000;
// Intervals grow geometrically; without a ceiling they eventually overflow
// Date math entirely (and a year is a long enough gap for training material).
const MAX_INTERVAL_DAYS = 365;

export function createSrs(now = new Date()) {
  return {
    ease: EASE_START,
    intervalDays: 0,
    dueAt: new Date(now).toISOString(),
    reps: 0,
    lapses: 0,
  };
}

export function ensureSrs(item, now = new Date()) {
  if (item.srs && typeof item.srs === "object" && Number.isFinite(item.srs.ease)) return item;
  return { ...item, srs: createSrs(now) };
}

export function applyGrade(srs, grade, now = new Date()) {
  const next = { ...srs };
  if (grade === GRADE_SOLVED) {
    next.reps += 1;
    // Ease recovers on success (capped at the starting value) so a card that
    // was hard once isn't penalized toward the floor forever.
    next.ease = Math.min(EASE_START, next.ease + 0.1);
    next.intervalDays = next.reps === 1 ? 1 : next.reps === 2 ? 3 : Math.round(next.intervalDays * next.ease);
    next.intervalDays = Math.min(MAX_INTERVAL_DAYS, Math.max(1, next.intervalDays));
  } else if (grade === GRADE_HARD) {
    next.ease = Math.max(EASE_FLOOR, next.ease - 0.05);
    // "Hard" must come back sooner than a clean solve — rescheduling the full
    // current interval made it indistinguishable from solved.
    next.intervalDays = Math.max(1, Math.round((next.intervalDays || 1) * 0.5));
  } else {
    next.reps = 0;
    next.lapses += 1;
    next.intervalDays = 0; // due immediately, behind other due items
    next.ease = Math.max(EASE_FLOOR, next.ease - 0.2);
  }
  next.dueAt = new Date(now.getTime() + next.intervalDays * DAY_MS).toISOString();
  return next;
}

export function isDue(item, now = new Date()) {
  const dueAt = item?.srs?.dueAt;
  if (!dueAt) return true;
  return new Date(dueAt).getTime() <= now.getTime();
}

// Due items first-due-first; lapsed items (interval 0) queue behind items
// that were already waiting.
export function selectDue(items, now = new Date(), limit = Infinity) {
  return (items || [])
    .filter((item) => isDue(item, now))
    .sort((a, b) => new Date(a.srs?.dueAt || 0) - new Date(b.srs?.dueAt || 0))
    .slice(0, limit);
}

export function nextDueLabel(item, now = new Date()) {
  if (isDue(item, now)) return "due now";
  const msLeft = new Date(item.srs.dueAt).getTime() - now.getTime();
  // Round to the nearest day so "due in 25 hours" reads as tomorrow, not
  // "in 2 days".
  const days = Math.max(1, Math.round(msLeft / DAY_MS));
  return days <= 1 ? "due tomorrow" : `due in ${days} days`;
}
