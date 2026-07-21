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
  {
    id: "philidor-finish",
    rung: 2,
    label: "Mate in 2 · Smothered finish",
    // Queen sacrifice forces the rook to seal its own king in; the knight
    // delivers the classic smothered mate.
    fen: "5r1k/6pp/7N/8/2Q5/8/8/6K1 w - - 0 1",
    solution: ["c4g8", "f8g8", "h6f7"],
    hint: "The knight on h6 guards g8. Offer your queen there — the rook has to take, and then the king is sealed in.",
    explanation: "Qg8+! Rxg8 Nf7# — the rook is forced to block its own king's only square. Philidor's legacy.",
  },
  {
    id: "back-rank-deflection",
    rung: 2,
    label: "Mate in 2 · Back-rank deflection",
    // Rook sacrifice drags the defender off the back rank; the queen mates.
    fen: "3r2k1/5ppp/8/1Q6/8/8/8/4R1K1 w - - 0 1",
    solution: ["e1e8", "d8e8", "b5e8"],
    hint: "Black's rook is the only back-rank defender. Force it to take something.",
    explanation: "Re8+! Rxe8 Qxe8# — the rook deflects the defender, and the queen recaptures with mate behind the pawn wall.",
  },
  {
    id: "rook-ladder-2",
    rung: 2,
    label: "Mate in 2 · Rook ladder",
    // Two rooks walk the king to the edge one rank at a time.
    fen: "8/3k4/R7/8/8/8/8/1R4K1 w - - 0 1",
    solution: ["b1b7", "d7d8", "a6a8"],
    hint: "One rook already fences the 6th rank. Check on the 7th to push the king back, then finish on the 8th.",
    explanation: "Rb7+ drives the king to the last rank, and Ra8# closes the ladder.",
  },
  {
    id: "smothered-full",
    rung: 3,
    label: "Mate in 3 · Philidor's legacy",
    // The full sequence: double check, queen sacrifice, smothered mate.
    fen: "5rk1/5Npp/8/8/2Q5/8/8/6K1 w - - 0 1",
    solution: ["f7h6", "g8h8", "c4g8", "f8g8", "h6f7"],
    hint: "Move the knight with double check — the king must go to the corner. Then the queen sacrifice seals the smother.",
    explanation: "Nh6+! Kh8 Qg8+! Rxg8 Nf7# — double check forces the corner, the queen sac forces the block, the knight mates.",
  },
  {
    id: "rook-ladder-3",
    rung: 3,
    label: "Mate in 3 · Long rook ladder",
    // Three rungs of the ladder: 6th, 7th, then mate on the 8th.
    fen: "8/8/3k4/R7/8/8/8/1R4K1 w - - 0 1",
    solution: ["b1b6", "d6d7", "a5a7", "d7d8", "b6b8"],
    hint: "Alternate the rooks: check a rank, let the other rook hold the fence, repeat until the king runs out of board.",
    explanation: "Rb6+ Kd7, Ra7+ Kd8, Rb8# — each rook takes a turn cutting off the next rank.",
  },
  {
    id: "queen-rook-ladder",
    rung: 3,
    label: "Mate in 3 · Queen joins the ladder",
    // Same ladder idea with mixed pieces: queen and rook alternate checks.
    fen: "8/8/3k4/R7/7Q/8/8/6K1 w - - 0 1",
    solution: ["h4h6", "d6d7", "a5a7", "d7d8", "h6h8"],
    hint: "The rook holds the 5th rank. Use queen and rook alternately to drive the king up the board.",
    explanation: "Qh6+ Kd7, Ra7+ Kd8, Qh8# — queen and rook ladder the king to the edge together.",
  },
];

// Active ladder positions must have a FEN and at least one solution ply.
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
