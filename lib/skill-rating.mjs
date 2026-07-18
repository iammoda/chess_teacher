// Per-dimension skill model. Each graded move updates an EWMA of move
// performance for the dimensions it touches; ratings derive from that
// performance so one bad game moves the needle without erasing history.

export const SKILL_DIMENSIONS = ["tactics", "openings", "endgames", "calculation"];

const EWMA_ALPHA = 0.12;
const RATING_FLOOR = 400;
const RATING_SPAN = 1400; // rating = 400 + perf * 1400 → 400..1800
const CONFIDENCE_SAMPLES = 40;
const TREND_WINDOW = 30;
const RESULT_K = 25;

export const DIMENSION_LABELS = {
  tactics: "Tactics",
  openings: "Openings",
  endgames: "Endgames",
  calculation: "Calculation",
};

// What "the next level" looks like per dimension per rating band — surfaced to
// the player and sent to the coach so its advice targets the right rung.
const NEXT_LEVEL_TABLE = {
  tactics: [
    [800, "Before every move, name any piece of yours that is undefended."],
    [1100, "Scan checks, captures, and threats for both sides before deciding."],
    [1400, "Calculate two-move forcing sequences: your threat, their best defense."],
    [1800, "Spot quiet moves that create two threats at once."],
  ],
  openings: [
    [800, "Develop knights and bishops before moving the same piece twice."],
    [1100, "Castle by move 10 and know why your first three moves fight for the center."],
    [1400, "Learn the main plan behind your two most-played openings, not just the moves."],
    [1800, "Recognize when your opponent leaves theory and how to punish it."],
  ],
  endgames: [
    [800, "Activate your king as soon as the queens leave the board."],
    [1100, "Master king-and-pawn basics: opposition and the square of the pawn."],
    [1400, "Convert a one-pawn advantage by trading pieces, not pawns."],
    [1800, "Know rook endgame fundamentals: rook behind the passed pawn, Lucena, Philidor."],
  ],
  calculation: [
    [800, "Before moving, ask what your opponent's last move threatens."],
    [1100, "Pick two candidate moves and compare them before committing."],
    [1400, "Follow forcing lines until the position is quiet, not just one ply."],
    [1800, "Evaluate the end of a line by material, king safety, and piece activity."],
  ],
};

export function createEmptySkillState() {
  const dims = {};
  for (const dim of SKILL_DIMENSIONS) {
    dims[dim] = {
      rating: null,
      perf: null,
      samples: 0,
      confidence: 0,
      trend: 0,
      recent: [],
      updatedAt: null,
    };
  }
  return { version: 1, dims, calibratedAt: null };
}

// Seed every dimension from a single scalar score (calibration or legacy
// placement) with modest confidence, so early coaching has a starting point.
export function seedSkillStateFromScore(score, now = new Date().toISOString()) {
  const state = createEmptySkillState();
  const perf = clamp((Number(score) - RATING_FLOOR) / RATING_SPAN, 0, 1);
  if (!Number.isFinite(perf)) return state;
  for (const dim of SKILL_DIMENSIONS) {
    state.dims[dim] = {
      rating: Math.round(RATING_FLOOR + perf * RATING_SPAN),
      perf,
      samples: 15,
      confidence: 0.4,
      trend: 0,
      recent: [],
      updatedAt: now,
    };
  }
  state.calibratedAt = now;
  return state;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Which dimensions a graded move speaks to.
export function dimensionsForMove(record) {
  const dims = new Set();
  const phase = record.phase || "middlegame";
  if (phase === "opening") dims.add("openings");
  else if (phase === "endgame") dims.add("endgames");
  else dims.add("calculation");

  const tags = record.tags || [];
  const tactical =
    tags.some((tag) => String(tag.category || tag).startsWith("missed_") || (tag.category || tag) === "hanging_piece") ||
    ["blunder", "missed_win"].includes(record.qualityKey) ||
    (Number.isFinite(record.evalDelta) && Math.abs(record.evalDelta) >= 150) ||
    Number.isFinite(record.mateBefore) ||
    Number.isFinite(record.mateAfter);
  if (tactical) dims.add("tactics");

  return [...dims];
}

// Move performance in [0, 1] from centipawn loss.
export function movePerformance(record) {
  if (["best", "excellent", "book"].includes(record.qualityKey)) return 1;
  if (!Number.isFinite(record.evalDelta)) return null;
  const cpl = Math.max(0, -record.evalDelta);
  return clamp(1 - cpl / 300, 0, 1);
}

export function applyMoveToSkillState(state, record, now = new Date().toISOString()) {
  const p = movePerformance(record);
  if (p === null) return state;

  for (const dim of dimensionsForMove(record)) {
    const entry = state.dims[dim];
    if (!entry) continue;
    entry.perf = entry.perf === null ? p : entry.perf + EWMA_ALPHA * (p - entry.perf);
    entry.samples += 1;
    entry.confidence = Math.min(1, entry.samples / CONFIDENCE_SAMPLES);
    entry.rating = Math.round(RATING_FLOOR + entry.perf * RATING_SPAN);
    entry.recent = [...(entry.recent || []), p].slice(-TREND_WINDOW);
    entry.trend = computeTrend(entry.recent);
    entry.updatedAt = now;
  }
  return state;
}

function computeTrend(recent) {
  if (!recent || recent.length < 10) return 0;
  const half = Math.floor(recent.length / 2);
  const older = recent.slice(0, half);
  const newer = recent.slice(half);
  const avg = (list) => list.reduce((sum, value) => sum + value, 0) / list.length;
  const delta = avg(newer) - avg(older);
  if (delta > 0.06) return 1;
  if (delta < -0.06) return -1;
  return 0;
}

// Game-result nudge: rating moves toward the result vs the expected score
// against an opponent of the given Elo.
export function applyGameResultToSkillState(state, { resultScore, opponentElo }, now = new Date().toISOString()) {
  if (!Number.isFinite(resultScore) || !Number.isFinite(opponentElo)) return state;
  for (const dim of SKILL_DIMENSIONS) {
    const entry = state.dims[dim];
    if (!entry || entry.rating === null) continue;
    const expected = 1 / (1 + 10 ** ((opponentElo - entry.rating) / 400));
    entry.rating = Math.round(clamp(entry.rating + RESULT_K * (resultScore - expected), RATING_FLOOR, RATING_FLOOR + RATING_SPAN));
    entry.perf = clamp((entry.rating - RATING_FLOOR) / RATING_SPAN, 0, 1);
    entry.updatedAt = now;
  }
  return state;
}

export function overallRating(state) {
  let weighted = 0;
  let totalWeight = 0;
  for (const dim of SKILL_DIMENSIONS) {
    const entry = state.dims[dim];
    if (!entry || entry.rating === null) continue;
    const weight = Math.max(0.05, entry.confidence);
    weighted += entry.rating * weight;
    totalWeight += weight;
  }
  return totalWeight ? Math.round(weighted / totalWeight) : null;
}

export function nextLevelFor(dim, rating) {
  const table = NEXT_LEVEL_TABLE[dim] || [];
  for (const [ceiling, description] of table) {
    if (!Number.isFinite(rating) || rating < ceiling) return description;
  }
  return table.length ? table[table.length - 1][1] : "";
}

// Compact snapshot for the coach payload and the profile UI.
export function skillSnapshot(state) {
  const snapshot = { overall: overallRating(state) };
  for (const dim of SKILL_DIMENSIONS) {
    const entry = state.dims[dim];
    snapshot[dim] = {
      rating: entry?.rating ?? null,
      confidence: Number((entry?.confidence ?? 0).toFixed(2)),
      trend: entry?.trend ?? 0,
      nextLevel: nextLevelFor(dim, entry?.rating),
    };
  }
  return snapshot;
}
