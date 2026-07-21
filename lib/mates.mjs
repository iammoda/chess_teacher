// Curated checkmate ladder. Each position is verified by tests/mates.test.mjs
// via chess.js: the listed solution must produce checkmate on the final ply.

export const MATE_LADDER = [
  {
    id: "back-rank-1",
    rung: 1,
    label: "Mate in 1 · Back rank",
    // Black to move: rook on e6 slides to e1 for a back-rank mate against a
    // white king boxed in by its own pawns on f2/g2/h2.
    fen: "6k1/5ppp/4r3/8/8/8/5PPP/6K1 b - - 0 1",
    solution: ["e6e1"],
    hint: "White's king has no back-rank escape squares. A rook can deliver mate along the 1st rank.",
    explanation: "Re1# — the rook checks along the 1st rank and the king's own pawns block every flight square.",
  },
  {
    id: "queen-h7-mate",
    rung: 1,
    label: "Mate in 1 · Queen delivered",
    // White to play: Qxh7#. Black king on g8, pawn on f7 blocks flight, White queen on h5, knight on f6 defends h7.
    fen: "5rk1/5ppp/5N2/7Q/8/8/8/6K1 w - - 0 1",
    solution: ["h5h7"],
    hint: "The knight on f6 defends h7, which is the only unblocked light square next to the king.",
    explanation: "Qxh7# — Black's king can't move to h8 (defended by the queen) or f8 (defended by the knight).",
  },
  {
    id: "kq-corner-mate",
    rung: 1,
    label: "Mate in 1 · King + queen corner",
    // Black king boxed in the corner by the white king; white queen delivers.
    fen: "7k/8/6KQ/8/8/8/8/8 w - - 0 1",
    solution: ["h6h7"],
    hint: "The white king on g6 covers f7, g7, and h7's escape. The queen just needs to check.",
    explanation: "Qh7# — the queen supported by its own king ends the game against the cornered king.",
  },
  {
    id: "ladder-mate",
    rung: 1,
    label: "Mate in 1 · Ladder finish",
    // White to play, two rooks vs king: king on h8, rook on a7 (covers 7th), rook on b1, mate with Rb8#.
    fen: "7k/R7/8/8/8/8/8/1R5K w - - 0 1",
    solution: ["b1b8"],
    hint: "One rook already cuts off the 7th. Slide the other one home.",
    explanation: "Rb8# — the rook checks along the 8th rank and the 7th is covered.",
  },
  {
    id: "scholars-mate",
    rung: 2,
    label: "Mate in 1 · Scholar's finish",
    // The famous four-move attack — deliver the final blow.
    fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
    solution: ["h5f7"],
    hint: "Two pieces already aim at f7 — the weakest square in Black's uncastled camp.",
    explanation: "Qxf7# — the queen is defended by the bishop on c4, and Black's king has no escape.",
  },
];

// Prune out the placeholders (rung 2/3) that we didn't finish authoring.
export const ACTIVE_MATE_POSITIONS = MATE_LADDER.filter((position) => position.fen && position.solution?.length);

export function getMatePositionById(id) {
  return ACTIVE_MATE_POSITIONS.find((position) => position.id === id) || null;
}

export function matesByRung() {
  const map = new Map();
  for (const position of ACTIVE_MATE_POSITIONS) {
    if (!map.has(position.rung)) map.set(position.rung, []);
    map.get(position.rung).push(position);
  }
  return map;
}

// Ladder progression rule: rung N unlocked after solving ≥ 3 positions on rung
// N-1. Rung 1 is always unlocked.
export function isRungUnlocked(rung, progress) {
  if (rung <= 1) return true;
  const prior = progress?.rungSolved?.[String(rung - 1)] || 0;
  return prior >= 3;
}

export function recordMateAttempt(progress, positionId, rung, solved) {
  const next = {
    solved: new Set(progress?.solved || []),
    attempts: { ...(progress?.attempts || {}) },
    rungSolved: { ...(progress?.rungSolved || {}) },
  };
  next.attempts[positionId] = (next.attempts[positionId] || 0) + 1;
  if (solved && !next.solved.has(positionId)) {
    next.solved.add(positionId);
    const key = String(rung);
    next.rungSolved[key] = (next.rungSolved[key] || 0) + 1;
  }
  return {
    solved: [...next.solved],
    attempts: next.attempts,
    rungSolved: next.rungSolved,
  };
}
