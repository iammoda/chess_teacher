// Key-moment selection for the guided post-game review: the 2-3 plies where
// the game actually turned, deduped so adjacent mistakes count once.

const MAX_MOMENTS = 3;
const MIN_CPL_FOR_MOMENT = 120;
const ADJACENT_PLY_GAP = 3;

export function selectKeyMoments(moves, options = {}) {
  const maxMoments = options.maxMoments || MAX_MOMENTS;
  const playerMoves = (moves || []).filter((move) => move.role === "player" && !move.retracted);

  const scored = playerMoves
    .map((move) => ({ move, score: momentScore(move) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const chosen = [];
  for (const { move } of scored) {
    if (chosen.length >= maxMoments) break;
    if (chosen.some((existing) => Math.abs(existing.ply - move.ply) < ADJACENT_PLY_GAP)) continue;
    chosen.push({
      ply: move.ply,
      san: move.san,
      quality: move.qualityKey || move.classification || "",
      cpl: Number.isFinite(move.evalDelta) ? Math.max(0, -move.evalDelta) : null,
      bestMoveSan: move.bestMoveSan || "",
      principalVariation: (move.principalVariation || []).slice(0, 6),
      fenBefore: move.beforeFen,
      fenAfter: move.afterFen,
      tags: (move.tags || []).map((tag) => tag.label),
      reason: momentReason(move),
    });
  }

  return chosen.sort((a, b) => a.ply - b.ply);
}

function momentScore(move) {
  let score = 0;
  const cpl = Number.isFinite(move.evalDelta) ? Math.max(0, -move.evalDelta) : 0;

  if (move.qualityKey === "missed_win") score += 500;
  if (move.qualityKey === "blunder") score += 400;
  if (move.qualityKey === "mistake") score += 150;

  if (cpl >= MIN_CPL_FOR_MOMENT) score += cpl;

  // Eval sign flip — the game changed hands on this move.
  if (
    Number.isFinite(move.evalBefore) &&
    Number.isFinite(move.evalAfter) &&
    Math.sign(move.evalBefore) !== Math.sign(move.evalAfter) &&
    Math.abs(move.evalAfter - move.evalBefore) >= 150
  ) {
    score += 200;
  }

  return score;
}

function momentReason(move) {
  if (move.qualityKey === "missed_win") return "You had a winning idea here and let it slip.";
  if (move.qualityKey === "blunder") return "This move gave away the most in the whole game.";
  if (move.qualityKey === "mistake") return "A better option was available at this moment.";
  return "The evaluation swung here — the game changed direction.";
}
