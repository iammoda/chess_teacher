// Learn-to-play curriculum for beginner mode. Pure data + tiny helpers so the
// browser app and the node tests can both import it. Every FEN and expected
// move is verified by tests/learn-lessons.test.mjs via chess.js:
//   - every step FEN parses,
//   - every task position is playable (not game over, White to move),
//   - every expected move is legal from its FEN,
//   - info steps may show finished positions (e.g. the stalemate example).
//
// Step kinds:
//   { kind: "info", fen, text, highlightSquares?: ["e4", ...] }
//     Text card; the learner presses Next. The board shows `fen` with the
//     listed squares softly highlighted. No move is accepted.
//   { kind: "task", fen, text, expectedMoves: ["e2e4", ...], targetSquares?,
//     hintSquares?, success, fail? }
//     The learner must play one of expectedMoves (UCI, promotion letter
//     appended for promotions). Anything else is undone with `fail` (or a
//     default) as feedback. Multi-capture sequences are modeled as separate
//     task steps with explicit FENs, so the app never has to fake a "pass"
//     move for the opponent.

export const LESSONS = [
  {
    id: "board",
    title: "The board",
    summary: "Files, ranks, and how the pieces line up.",
    tip: "The queen always starts on her own color: white queen on a light square, black queen on a dark square.",
    steps: [
      {
        kind: "info",
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        text: "This is the starting position. Columns are called files (a to h) and rows are called ranks (1 to 8). The highlighted squares are the e-file — every square on it is named e1 up to e8.",
        highlightSquares: ["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8"],
      },
      {
        kind: "info",
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        text: "Each side starts with 8 pawns, 2 rooks, 2 knights, 2 bishops, 1 queen, and 1 king. The queen starts on her own color — the white queen on the light square d1, the black queen on the dark square d8.",
        highlightSquares: ["d1", "d8"],
      },
      {
        kind: "info",
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        text: "The four highlighted squares are the center. Pieces control more squares from the center, so early moves usually fight for it. You'll see this again when you start playing real games.",
        highlightSquares: ["d4", "d5", "e4", "e5"],
      },
    ],
  },
  {
    id: "pawns",
    title: "Pawns",
    summary: "March forward, capture diagonally.",
    tip: "Pawns capture diagonally, one square forward — they can never move backward.",
    steps: [
      {
        kind: "task",
        fen: "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1",
        text: "Pawns move straight forward, one square at a time, and never backward. Move the e-pawn forward one square to the star.",
        expectedMoves: ["e2e3"],
        targetSquares: ["e3"],
        hintSquares: ["e2"],
        success: "That's the basic pawn step: one square forward.",
        fail: "Move the pawn on e2 forward one square, to e3.",
      },
      {
        kind: "task",
        fen: "4k3/8/8/8/8/8/3P4/4K3 w - - 0 1",
        text: "A pawn that hasn't moved yet gets one special option: it may leap two squares forward. Move the d-pawn two squares to the star.",
        expectedMoves: ["d2d4"],
        targetSquares: ["d4"],
        hintSquares: ["d2"],
        success: "The two-square leap is only allowed on a pawn's very first move.",
        fail: "Use the pawn's first-move leap: d2 straight to d4.",
      },
      {
        kind: "task",
        fen: "4k3/8/8/8/3p4/4P3/8/4K3 w - - 0 1",
        text: "Pawns capture differently than they move: one square diagonally forward. Your e3-pawn can capture the black pawn on d4. Take it.",
        expectedMoves: ["e3d4"],
        targetSquares: ["d4"],
        hintSquares: ["e3"],
        success: "Exactly — forward to move, diagonal to capture. A pawn can never capture straight ahead.",
        fail: "Capture diagonally: the e3-pawn takes on d4.",
      },
      {
        kind: "info",
        fen: "4k3/8/8/4p3/4P3/8/8/4K3 w - - 0 1",
        text: "One more pawn rule: pawns never capture straight ahead, so two pawns that meet head-on block each other completely. Neither of these pawns can move again until a capture opens the file. This is why pawns shape the whole board.",
        highlightSquares: ["e4", "e5"],
      },
    ],
  },
  {
    id: "rooks",
    title: "Rooks",
    summary: "Straight lines: files and ranks.",
    tip: "Rooks love open files — a rook on a file with no pawns controls the whole line.",
    steps: [
      {
        kind: "task",
        fen: "4k3/8/8/8/8/8/8/R3K3 w - - 0 1",
        text: "Rooks slide any number of squares along a rank or file, but they can't jump over pieces. Slide the rook up the a-file to the star.",
        expectedMoves: ["a1a4"],
        targetSquares: ["a4"],
        hintSquares: ["a1"],
        success: "Rooks cover long straight lines — files and ranks only.",
        fail: "Slide the rook straight up the a-file, from a1 to a4.",
      },
      {
        kind: "task",
        fen: "4k3/p7/8/8/R7/8/8/4K3 w - - 0 1",
        text: "Pieces capture by landing on an enemy piece's square. The a-file is open all the way to Black's pawn on a7 — capture it with the rook.",
        expectedMoves: ["a4a7"],
        targetSquares: ["a7"],
        hintSquares: ["a4"],
        success: "Captured. Every piece (except the pawn) captures exactly the way it moves.",
        fail: "Slide the rook up the a-file and capture the pawn on a7.",
      },
    ],
  },
  {
    id: "bishops",
    title: "Bishops",
    summary: "Diagonals only — one color forever.",
    tip: "Each bishop is stuck on one color for the whole game, so a pair of bishops covers both.",
    steps: [
      {
        kind: "task",
        fen: "4k3/8/8/8/8/8/P7/2B1K3 w - - 0 1",
        text: "Bishops slide any number of squares diagonally. A bishop that starts on a dark square stays on dark squares forever. Slide this one along its diagonal to the star.",
        expectedMoves: ["c1g5"],
        targetSquares: ["g5"],
        hintSquares: ["c1"],
        success: "Notice the bishop is still on a dark square — that never changes.",
        fail: "Slide the bishop along the diagonal from c1 to g5.",
      },
      {
        kind: "task",
        fen: "4k3/8/7p/6B1/8/8/P7/4K3 w - - 0 1",
        text: "Your bishop on g5 and Black's pawn on h6 share a diagonal. Capture the pawn.",
        expectedMoves: ["g5h6"],
        targetSquares: ["h6"],
        hintSquares: ["g5"],
        success: "Diagonal in, diagonal out — that's the bishop's whole life.",
        fail: "The pawn on h6 is one diagonal step from your bishop. Take it.",
      },
    ],
  },
  {
    id: "queen",
    title: "The queen",
    summary: "Rook + bishop in one piece.",
    tip: "The queen is your strongest piece — which is exactly why you shouldn't bring her out too early.",
    steps: [
      {
        kind: "task",
        fen: "4k3/8/8/8/8/8/8/3QK3 w - - 0 1",
        text: "The queen combines the rook and the bishop: any number of squares along a rank, file, or diagonal. Slide her straight up the d-file to the star.",
        expectedMoves: ["d1d5"],
        targetSquares: ["d5"],
        hintSquares: ["d1"],
        success: "Straight lines like a rook...",
        fail: "Move the queen straight up the d-file, from d1 to d5.",
      },
      {
        kind: "task",
        fen: "4k3/8/8/8/6p1/8/8/3QK3 w - - 0 1",
        text: "...and diagonals like a bishop. The black pawn on g4 sits on the queen's diagonal. Capture it.",
        expectedMoves: ["d1g4"],
        targetSquares: ["g4"],
        hintSquares: ["d1"],
        success: "That power is also a weakness: an early queen gets chased around while the opponent develops. Keep her home in the opening.",
        fail: "Capture diagonally, like a bishop: queen from d1 takes on g4.",
      },
    ],
  },
  {
    id: "knights",
    title: "Knights",
    summary: "The L-shape — and the only piece that jumps.",
    tip: "Knights are the only pieces that can jump over others — and a knight on the rim is dim.",
    steps: [
      {
        kind: "info",
        fen: "4k3/8/1p6/3p4/8/2p5/8/1N2K3 w - - 0 1",
        text: "Knights move in an L: two squares in one direction, then one square sideways. They are the only pieces that jump over anything in the way. Your knight on b1 can reach the pawn on c3 in one hop — let's collect all three black pawns.",
        highlightSquares: ["c3", "d5", "b6"],
      },
      {
        kind: "task",
        fen: "4k3/8/1p6/3p4/8/2p5/8/1N2K3 w - - 0 1",
        text: "First hop: two up, one right. Capture the pawn on c3.",
        expectedMoves: ["b1c3"],
        targetSquares: ["c3"],
        hintSquares: ["b1"],
        success: "One down, two to go.",
        fail: "From b1 the knight's L reaches c3. Capture the pawn there.",
      },
      {
        kind: "task",
        fen: "4k3/8/1p6/3p4/8/2N5/8/4K3 w - - 0 1",
        text: "Second hop: the pawn on d5 is another L away. Take it.",
        expectedMoves: ["c3d5"],
        targetSquares: ["d5"],
        hintSquares: ["c3"],
        success: "Good — you're getting the L-shape.",
        fail: "Two up, one right from c3 lands on d5. Capture the pawn.",
      },
      {
        kind: "task",
        fen: "4k3/8/1p6/3N4/8/8/8/4K3 w - - 0 1",
        text: "Last one: hop from d5 and capture the pawn on b6.",
        expectedMoves: ["d5b6"],
        targetSquares: ["b6"],
        hintSquares: ["d5"],
        success: "All three collected. Knight paths feel strange at first — this pattern gets automatic with play.",
        fail: "One more L: from d5 the knight reaches b6. Take the pawn.",
      },
    ],
  },
  {
    id: "king-check",
    title: "The king and check",
    summary: "One square at a time — and never into danger.",
    tip: "When you're in check there are only three ways out: move the king, block the check, or capture the attacker.",
    steps: [
      {
        kind: "task",
        fen: "4k3/8/8/8/8/8/5P2/4K3 w - - 0 1",
        text: "The king moves one square in any direction. He can never move onto a square an enemy piece attacks. Move your king one square — any legal square works.",
        expectedMoves: ["e1d1", "e1d2", "e1e2", "e1f1"],
        targetSquares: ["d1", "d2", "e2", "f1"],
        hintSquares: ["e1"],
        success: "Slow but precious: if your king is trapped, the game is over.",
        fail: "Move the king exactly one square in any direction.",
      },
      {
        kind: "task",
        fen: "4k3/8/8/8/4r3/8/8/4K3 w - - 0 1",
        text: "Check! Black's rook attacks your king along the e-file. When your king is attacked you must deal with it immediately. Here the only option is to move — step off the e-file.",
        expectedMoves: ["e1d1", "e1d2", "e1f1", "e1f2"],
        targetSquares: ["d1", "d2", "f1", "f2"],
        hintSquares: ["e1"],
        success: "Out of check. You may never make a move that leaves your own king attacked.",
        fail: "Your king must leave the e-file — the rook controls every square on it.",
      },
      {
        kind: "task",
        fen: "4k3/8/8/8/4r3/8/8/4K2Q w - - 0 1",
        text: "Check again — but this time you have a better answer. There are three ways out of check: move the king, block the attack, or capture the attacker. Your queen on h1 sees the rook on e4. Capture it.",
        expectedMoves: ["h1e4"],
        targetSquares: ["e4"],
        hintSquares: ["h1"],
        success: "Best of the three: the check is gone and you won a rook.",
        fail: "Moving the king works, but capturing is better here: queen takes the rook on e4.",
      },
    ],
  },
  {
    id: "checkmate",
    title: "Checkmate and stalemate",
    summary: "How games are won — and accidentally drawn.",
    tip: "Before you give a check, ask: does the enemy king have an answer? If not, it's mate.",
    steps: [
      {
        kind: "info",
        fen: "4k3/R7/1R6/8/8/8/8/4K3 w - - 0 1",
        text: "Checkmate ends the game: the king is in check and there is no way out — no escape square, no block, no capture. Your two rooks can finish this right now. One rook already seals the 7th rank.",
        highlightSquares: ["a7", "b6"],
      },
      {
        kind: "task",
        fen: "4k3/R7/1R6/8/8/8/8/4K3 w - - 0 1",
        text: "Deliver checkmate: check the king on the 8th rank while your other rook keeps the 7th rank locked so it can't escape forward.",
        expectedMoves: ["b6b8"],
        targetSquares: ["b8"],
        hintSquares: ["b6"],
        success: "Checkmate! The b8-rook checks along the 8th rank, and the a7-rook covers every escape square on the 7th. That two-rook ladder wins countless endgames.",
        fail: "Check on the 8th rank with the b6-rook — the a7-rook already stops the king from stepping to the 7th.",
      },
      {
        kind: "info",
        fen: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1",
        text: "Stalemate is the trap to avoid when you're winning: it's Black's turn, Black is NOT in check, but Black has no legal move at all. That's an instant draw. Here the queen covers g8 and h7, so the cornered king has nowhere to go — half a point thrown away. When you're far ahead, always leave the enemy king a legal move until you're ready to mate.",
        highlightSquares: ["g8", "h7", "h8"],
      },
    ],
  },
  {
    id: "special-moves",
    title: "Special moves",
    summary: "Castling, promotion, and en passant.",
    tip: "Castle early — it tucks your king into safety and brings a rook into the game in one move.",
    steps: [
      {
        kind: "task",
        fen: "4k3/8/8/8/8/8/PPPP1PPP/RNBQK2R w KQ - 0 1",
        text: "Castling is the only move that touches two of your pieces: the king slides two squares toward a rook and the rook jumps to the other side. It needs empty squares between them, neither piece may have moved, and the king can't castle out of, through, or into check. Castle kingside: move your king two squares to the star.",
        expectedMoves: ["e1g1"],
        targetSquares: ["g1"],
        hintSquares: ["e1"],
        success: "King safe in the corner, rook activated toward the center — castle early in real games.",
        fail: "Click the king on e1, then the star on g1 — the king slides two squares toward the rook.",
      },
      {
        kind: "task",
        fen: "8/4P3/8/8/8/2k5/8/4K3 w - - 0 1",
        text: "Promotion: a pawn that reaches the last rank transforms into a queen, rook, bishop, or knight of your choice. Push the pawn to e8 and choose a queen — it's almost always the right pick.",
        expectedMoves: ["e7e8q"],
        targetSquares: ["e8"],
        hintSquares: ["e7"],
        success: "A brand-new queen. This is why endgames revolve around pushing passed pawns.",
        fail: "Push the pawn to e8, and when the menu appears, pick the queen.",
      },
      {
        kind: "task",
        fen: "4k3/8/8/3Pp3/8/8/8/4K3 w - e6 0 1",
        text: "En passant (\"in passing\"): Black's pawn just leapt two squares to e5, landing right beside your d5-pawn. Only on this very next move, you may capture it as if it had moved one square. Capture on e6 — the star, not the pawn's square.",
        expectedMoves: ["d5e6"],
        targetSquares: ["e6"],
        hintSquares: ["d5"],
        success: "The e5-pawn disappears even though you landed on e6. Rare, surprising, and completely legal.",
        fail: "Move your d5-pawn diagonally to e6 — the black pawn gets captured in passing.",
      },
    ],
  },
  {
    id: "values",
    title: "Piece values and safe captures",
    summary: "What things are worth — and when taking is a mistake.",
    tip: "Rough values: pawn 1, knight 3, bishop 3, rook 5, queen 9. Before capturing, check what recaptures.",
    steps: [
      {
        kind: "info",
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        text: "Rough piece values: pawn 1, knight 3, bishop 3, rook 5, queen 9. The king is priceless. These numbers guide trades — giving a knight (3) to win a rook (5) is good business; giving your queen (9) for a pawn (1) is a disaster.",
      },
      {
        kind: "task",
        fen: "4k3/8/1b3p2/4p3/8/4Q3/8/4K3 w - - 0 1",
        text: "A capture is only good if it's safe. Your queen can take the pawn on e5 or the bishop on b6 — but the e5-pawn is guarded by the pawn on f6, and losing your queen for a pawn loses the game. Take the piece nobody defends.",
        expectedMoves: ["e3b6"],
        targetSquares: ["b6"],
        hintSquares: ["e3"],
        success: "A free bishop. Before every capture, ask: what takes back? That one habit prevents most beginner disasters.",
        fail: "Careful — the e5-pawn is defended by the f6-pawn. The bishop on b6 is free: take it with the queen.",
      },
      {
        kind: "info",
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        text: "That's every rule you need. Games end by checkmate, by resignation, or in a draw (stalemate, repetition, or when neither side can mate). A good first plan: push a center pawn, develop knights and bishops, castle early, and before every move check what your opponent just threatened. You're ready — play your first game!",
      },
    ],
  },
];

export function getLessonById(id) {
  return LESSONS.find((lesson) => lesson.id === id) || null;
}

export function lessonIndexById(id) {
  return LESSONS.findIndex((lesson) => lesson.id === id);
}

export function getNextLesson(completedIds) {
  const done = new Set(completedIds || []);
  return LESSONS.find((lesson) => !done.has(lesson.id)) || null;
}

export function allLessonsComplete(completedIds) {
  const done = new Set(completedIds || []);
  return LESSONS.every((lesson) => done.has(lesson.id));
}

// Rotating tips for the beginner-mode coach card.
export function beginnerTips() {
  return LESSONS.map((lesson) => lesson.tip).filter(Boolean);
}

// Structural + chess validation. `ChessCtor` is injected (tests pass the
// vendored chess.js class) so this module stays dependency-free for the app.
// Returns an array of human-readable problems; empty array = all good.
export function validateLessons(ChessCtor) {
  const problems = [];
  const seen = new Set();

  for (const lesson of LESSONS) {
    const where = `lesson "${lesson.id}"`;
    if (!lesson.id || seen.has(lesson.id)) problems.push(`${where}: missing or duplicate id`);
    seen.add(lesson.id);
    if (!lesson.title) problems.push(`${where}: missing title`);
    if (!lesson.tip) problems.push(`${where}: missing tip`);
    if (!Array.isArray(lesson.steps) || !lesson.steps.length) {
      problems.push(`${where}: has no steps`);
      continue;
    }

    lesson.steps.forEach((step, index) => {
      const stepWhere = `${where} step ${index + 1} (${step.kind})`;
      if (step.kind !== "info" && step.kind !== "task") {
        problems.push(`${stepWhere}: unknown kind`);
        return;
      }
      if (!step.text) problems.push(`${stepWhere}: missing text`);

      let game = null;
      try {
        game = new ChessCtor(step.fen);
      } catch (error) {
        problems.push(`${stepWhere}: invalid FEN (${error?.message || error})`);
        return;
      }

      if (step.kind === "info") return;

      if (game.turn() !== "w") problems.push(`${stepWhere}: tasks must have White to move`);
      if (game.isGameOver()) problems.push(`${stepWhere}: task position is already game over`);
      if (!Array.isArray(step.expectedMoves) || !step.expectedMoves.length) {
        problems.push(`${stepWhere}: task has no expectedMoves`);
        return;
      }
      if (!step.success) problems.push(`${stepWhere}: task missing success text`);

      for (const uci of step.expectedMoves) {
        const probe = new ChessCtor(step.fen);
        try {
          const move = probe.move({
            from: uci.slice(0, 2),
            to: uci.slice(2, 4),
            promotion: uci.slice(4) || undefined,
          });
          if (!move) problems.push(`${stepWhere}: expected move ${uci} is illegal`);
        } catch {
          problems.push(`${stepWhere}: expected move ${uci} is illegal`);
        }
      }
    });
  }

  return problems;
}
