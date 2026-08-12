// Engine verification for heuristically detected tactic tags.
//
// The detectors in app.js run synchronously at move time with no engine data;
// they pattern-match forks/pins/skewers/hanging pieces and sometimes claim a
// tactic that Stockfish refutes (defended attacker, pinned piece, in-between
// move...). Once engine numbers exist we cross-check every tactical claim:
// if the played move barely moved the evaluation, the "missed" tactic wasn't
// actually better and the tag is dropped instead of shown to the player.

import { EVAL_THRESHOLDS } from "./classify.mjs";

// Tags that assert "something concretely better existed" — falsifiable by the
// engine. Principle nudges (opening_principle, king_safety, candidate_moves)
// are coaching advice, not claims, and always survive.
export const TACTICAL_CLAIM_CATEGORIES = new Set([
  "missed_mate",
  "missed_fork",
  "missed_pin",
  "missed_skewer",
  "missed_line_tactic",
  "missed_capture",
  "hanging_piece",
  "poor_trade",
]);

// evalDelta is a POSITIVE centipawn loss (see lib/classify.mjs).
// Returns { tags, removed, verified }.
export function verifyTagsWithEngine(tags, { evalDelta = null, mateBefore = null, mateAfter = null } = {}) {
  const list = Array.isArray(tags) ? tags : [];
  if (!list.length || !Number.isFinite(evalDelta)) {
    return { tags: list, removed: [], verified: false };
  }

  // Had a forced mate and genuinely let it slip — every tactical claim stands.
  // Mate scores are side-to-move: mateAfter <= 0 means the opponent is now
  // checkmated (0 = the move delivered mate) or still faces a forced mate,
  // so nothing was lost and claims stay falsifiable by the eval.
  const lostForcedMate =
    Number.isFinite(mateBefore) && mateBefore > 0 && !(Number.isFinite(mateAfter) && mateAfter <= 0);

  const kept = [];
  const removed = [];

  for (const tag of list) {
    const category = String(tag?.category || "");
    if (!TACTICAL_CLAIM_CATEGORIES.has(category)) {
      kept.push(tag);
      continue;
    }

    const evalRefutesClaim = evalDelta < EVAL_THRESHOLDS.inaccuracy && !lostForcedMate;
    if (!evalRefutesClaim) {
      kept.push(tag);
      continue;
    }

    if (category === "missed_mate") {
      // chess.js proved a mate-in-1 existed, so the tag is factually right —
      // but the played move still wins (often still forcing mate). Keep the
      // observation, downgraded so it reads as a slip rather than a missed win.
      kept.push({
        ...tag,
        severity: Math.min(Number(tag.severity) || 2, 2),
      });
      continue;
    }

    removed.push(tag);
  }

  return { tags: kept, removed, verified: true };
}
