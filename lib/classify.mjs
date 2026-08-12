export const ANALYSIS_DEPTH = 10;
// Post-game re-analysis depth. Live grading stays shallow so the bot replies
// quickly; once the game ends every player move is re-graded at this depth.
export const DEEP_ANALYSIS_DEPTH = 18;
export const MATE_SCORE_CP = 100_000;
export const MAX_MATE_DISTANCE = 100;

export const EVAL_THRESHOLDS = {
  blunder: 300,
  mistake: 150,
  inaccuracy: 50,
};

export const MOVE_QUALITIES = {
  best: {
    label: "Best",
    symbol: "*",
    tone: "positive",
    reason: "The engine also preferred this move.",
  },
  excellent: {
    label: "Excellent",
    symbol: "!",
    tone: "positive",
    reason: "This kept the evaluation steady.",
  },
  good: {
    label: "Good",
    symbol: "OK",
    tone: "positive",
    reason: "No major issue was tagged.",
  },
  book: {
    label: "Book",
    symbol: "B",
    tone: "positive",
    reason: "This follows a known opening line.",
  },
  inaccuracy: {
    label: "Inaccuracy",
    symbol: "?!",
    tone: "warning",
    reason: "This gave away a small amount of value.",
  },
  mistake: {
    label: "Mistake",
    symbol: "?",
    tone: "bad",
    reason: "The position became noticeably harder after this move.",
  },
  blunder: {
    label: "Blunder",
    symbol: "??",
    tone: "bad",
    reason: "The position dropped sharply after this move.",
  },
  missed_win: {
    label: "Missed win",
    symbol: "MW",
    tone: "bad",
    reason: "A forcing win or decisive tactic was missed.",
  },
};

export function classifyByEval(loss, fallback) {
  if (loss >= EVAL_THRESHOLDS.blunder) return "blunder";
  if (loss >= EVAL_THRESHOLDS.mistake) return "mistake";
  if (loss >= EVAL_THRESHOLDS.inaccuracy) return "inaccuracy";
  return fallback === "mistake" || fallback === "blunder" ? fallback : "neutral";
}

export function centipawnLossFromEvals(evalBefore, evalAfter) {
  if (typeof evalBefore !== "number" || typeof evalAfter !== "number") return null;
  return Math.max(0, evalBefore + evalAfter);
}

export function scoreToComparableCp(scoreCp, mate) {
  if (typeof mate === "number") {
    const distance = Math.min(Math.abs(mate), MAX_MATE_DISTANCE);
    const score = MATE_SCORE_CP - distance * 100;
    return mate > 0 ? score : -score;
  }
  return typeof scoreCp === "number" ? scoreCp : null;
}

export function centipawnLossFromEngineResults(before, after) {
  const beforeScore = scoreToComparableCp(before?.scoreCp, before?.mate);
  const afterScore = scoreToComparableCp(after?.scoreCp, after?.mate);
  return centipawnLossFromEvals(beforeScore, afterScore);
}

export function normalizeEngineAnalysis({ before, after, depth = ANALYSIS_DEPTH, bestMoveSan = "" }) {
  const loss = centipawnLossFromEngineResults(before, after);
  return {
    analysisStatus: loss === null ? "unavailable" : "complete",
    engineDepth: Number.isInteger(depth) ? depth : null,
    engineSource: String(before?.source || after?.source || ""),
    evalBefore: typeof before?.scoreCp === "number" ? before.scoreCp : null,
    evalAfter: typeof after?.scoreCp === "number" ? after.scoreCp : null,
    mateBefore: typeof before?.mate === "number" ? before.mate : null,
    mateAfter: typeof after?.mate === "number" ? after.mate : null,
    evalDelta: loss,
    bestMoveUci: String(before?.bestMove || ""),
    bestMoveSan: String(bestMoveSan || ""),
    principalVariation: Array.isArray(before?.pv) ? before.pv.slice(0, 8) : [],
  };
}

export function classifyMoveQuality({
  evalDelta = null,
  classification = "neutral",
  tags = [],
  playedUci = "",
  bestMoveUci = "",
  openingKnown = false,
  mateBefore = null,
  mateAfter = null,
} = {}) {
  const loss = typeof evalDelta === "number" ? Math.max(0, evalDelta) : null;
  const maxSeverity = Math.max(0, ...tags.map((tag) => Number(tag?.severity) || 0));
  const missedOpportunity = tags.some((tag) => String(tag?.category || "").startsWith("missed_"));
  // Mate scores are side-to-move: mateAfter <= 0 means the opponent is now
  // checkmated (0 = this move delivered mate — the best possible move) or
  // faces a forced mate (negative). A forced mate is only "missed" when the
  // after-position is actually known and no longer punishes the opponent —
  // an eval timeout (mateAfter null + no loss) must never be graded MW.
  const keptForcedMate = typeof mateAfter === "number" && mateAfter <= 0;
  const afterEvalKnown = loss !== null || typeof mateAfter === "number";
  const missedForcedMate = typeof mateBefore === "number" && mateBefore > 0 && afterEvalKnown && !keptForcedMate;
  const playedBest = Boolean(playedUci && bestMoveUci && normalizeUci(playedUci) === normalizeUci(bestMoveUci));

  let key = "good";
  if ((missedOpportunity && maxSeverity >= 3) || missedForcedMate) {
    key = "missed_win";
  } else if (loss !== null && loss >= EVAL_THRESHOLDS.blunder) {
    key = "blunder";
  } else if (loss !== null && loss >= EVAL_THRESHOLDS.mistake) {
    key = "mistake";
  } else if (loss !== null && loss >= EVAL_THRESHOLDS.inaccuracy) {
    key = "inaccuracy";
  } else if (classification === "blunder") {
    key = "blunder";
  } else if (classification === "mistake" || maxSeverity >= 3) {
    key = missedOpportunity ? "missed_win" : "mistake";
  } else if (classification === "inaccuracy" || maxSeverity >= 2) {
    key = "inaccuracy";
  } else if (openingKnown) {
    key = "book";
  } else if (playedBest && (loss === null || loss <= 25)) {
    key = "best";
  } else if (loss !== null && loss <= 20) {
    key = "excellent";
  }

  const quality = MOVE_QUALITIES[key] || MOVE_QUALITIES.good;
  return {
    key,
    label: quality.label,
    symbol: quality.symbol,
    tone: quality.tone,
    reason: qualityReasonFor(key, { loss, playedBest, openingKnown }),
  };
}

function normalizeUci(uci) {
  return String(uci || "").trim().toLowerCase();
}

function qualityReasonFor(key, { loss, playedBest, openingKnown }) {
  if (key === "best" && playedBest) return MOVE_QUALITIES.best.reason;
  if (key === "book" && openingKnown) return MOVE_QUALITIES.book.reason;
  if (key === "excellent" && loss !== null) return "This move kept the evaluation nearly unchanged.";
  if (key === "good" && loss !== null) return "The engine saw no major problem with this move.";
  if (key === "inaccuracy" && loss !== null) return `This gave away about ${pawnsOfAdvantage(loss)}.`;
  if (key === "mistake" && loss !== null) return `This lost about ${pawnsOfAdvantage(loss)}.`;
  if (key === "blunder" && loss !== null) return `This lost about ${pawnsOfAdvantage(loss)}.`;
  return MOVE_QUALITIES[key]?.reason || MOVE_QUALITIES.good.reason;
}

// Losses are measured in centipawns internally; players read pawn units
// ("1.5 pawns of advantage"), the convention chess sites use.
function pawnsOfAdvantage(lossCp) {
  const pawns = (lossCp / 100).toFixed(1);
  return pawns === "1.0" ? "a pawn of advantage" : `${pawns} pawns of advantage`;
}
