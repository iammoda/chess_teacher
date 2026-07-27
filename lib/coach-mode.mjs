// Coach-mode gating: the Settings "Coach mode" contract in one pure rule.
//
//   hints (default) — full coaching, including live interruptions.
//   post_game       — no interruptions while you play; post-game messages
//                     and practice feedback still arrive.
//   silent          — the coach only ever speaks when you message it.
//
// Kinds of coach-initiated speech:
//   "live"     — proactive move comments, rethink (blunder) interception
//   "postgame" — game-end summaries and nudges
//   "drill"    — missed-practice-puzzle feedback
//
// User-initiated chat is never gated by this rule.

export const COACH_MODES = ["hints", "post_game", "silent"];

export function coachModeAllows(mode, kind) {
  const normalized = COACH_MODES.includes(mode) ? mode : "hints";
  if (normalized === "silent") return false;
  if (normalized === "post_game") return kind !== "live";
  return true;
}
