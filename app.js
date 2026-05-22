import { Chess } from "./vendor/chess/chess.js";
import { ANALYSIS_DEPTH, MOVE_QUALITIES, classifyByEval, classifyMoveQuality, normalizeEngineAnalysis } from "./lib/classify.mjs";
import { StockfishEngine } from "./lib/stockfish-engine.mjs";

const PIECES = {
  wp: "♙",
  wn: "♘",
  wb: "♗",
  wr: "♖",
  wq: "♕",
  wk: "♔",
  bp: "♟",
  bn: "♞",
  bb: "♝",
  br: "♜",
  bq: "♛",
  bk: "♚",
};

const PIECE_VALUES = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 100,
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["1", "2", "3", "4", "5", "6", "7", "8"];

const STORAGE_KEYS = {
  settings: "chess_teacher_settings_v1",
  activeGame: "chess_teacher_active_game_v1",
  profile: "chess_teacher_profile_v1",
  practice: "chess_teacher_practice_v1",
  practiceHistory: "chess_teacher_practice_history_v1",
  games: "chess_teacher_games_v1",
  placement: "chess_teacher_placement_v1",
  placementCardDismissed: "chess_teacher_placement_card_dismissed_v1",
  supabase: "chess_teacher_supabase_v1",
};

const LOCAL_STOCKFISH_BASE_URL = "/vendor/stockfish/";
const STOCKFISH_CDN_BASE_URL = "https://cdn.jsdelivr.net/npm/stockfish@16.0.0/src/";
const SUPABASE_CLIENT_URL = "https://esm.sh/@supabase/supabase-js@2.105.4?bundle";
const SUPABASE_PROJECT_REF = "kajifmxqfcceibwredjf";
const SUPABASE_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`;
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_MCwuWk-w1KTNSI-pjTGBsQ_hm7_hwBc";
const DEFAULT_SUPABASE_CONFIG = {
  url: SUPABASE_URL,
  anonKey: SUPABASE_PUBLISHABLE_KEY,
};

let supabaseModulePromise = null;

const PLACEMENT_TARGET_GAMES = 5;
const PLACEMENT_DEPTHS = [2, 4, 6, 8, 10];
const DEFAULT_PLACEMENT = {
  games: [],
  completedGameIds: [],
  estimatedScore: null,
  completedAt: null,
};

const STARTER_LESSONS = [
  {
    id: "loose-pieces",
    title: "Loose pieces",
    category: "hanging_piece",
    summary: "Check which pieces are attacked and which pieces are not defended before choosing a plan.",
    concepts: ["undefended pieces", "captures", "candidate moves"],
  },
  {
    id: "checks-captures-threats",
    title: "Checks, captures, threats",
    category: "candidate_moves",
    summary: "Look at forcing moves first so tactics are not missed during quiet positions.",
    concepts: ["checks", "captures", "threats"],
  },
  {
    id: "opening-principles",
    title: "Opening principles",
    category: "opening_principle",
    summary: "Fight for the center, develop pieces once, and castle before starting side operations.",
    concepts: ["center", "development", "castling"],
  },
  {
    id: "king-safety",
    title: "King safety",
    category: "king_safety",
    summary: "Treat exposed kings and weakened shelter as tactical liabilities.",
    concepts: ["castling", "king shelter", "open files"],
  },
  {
    id: "trade-quality",
    title: "Trade quality",
    category: "poor_trade",
    summary: "Before capturing, calculate the recapture and compare what remains on the board.",
    concepts: ["recapture", "piece value", "simplification"],
  },
  {
    id: "candidate-moves",
    title: "Candidate moves",
    category: "candidate_moves",
    summary: "Build a short list of forcing moves, improving moves, and opponent threats before moving.",
    concepts: ["checks", "captures", "threats", "worst piece"],
  },
];

const LESSON_GUIDES = {
  hanging_piece: {
    why: "Most tactics start because a piece is undefended or overloaded. Before calculating a long line, identify what can be taken safely.",
    lookFor: ["Which pieces are attacked?", "Which pieces are defended once?", "What changes after a capture?"],
    drill: "Name every undefended piece for both sides, then choose a move that either wins one or fixes yours.",
  },
  candidate_moves: {
    why: "Candidate moves keep you from moving on impulse. Checks, captures, and threats force the opponent to answer concrete problems.",
    lookFor: ["Checks first", "Captures that win material", "Threats that create a second problem"],
    drill: "Write down three candidate moves before choosing: one forcing move, one improving move, and one defensive move.",
  },
  opening_principle: {
    why: "Good openings create playable middlegames. Repeated piece moves, early queen moves, and delayed castling usually give away time.",
    lookFor: ["Center control", "One new piece developed", "King safety before side attacks"],
    drill: "Find the move that develops a piece or castles while still contesting the center.",
  },
  king_safety: {
    why: "An exposed king turns normal moves into tactics for the opponent. Safety often matters more than grabbing a pawn.",
    lookFor: ["Open files near the king", "Missing pawn shelter", "Checks available to the opponent"],
    drill: "Find the move that reduces checks or gets the king out of the center.",
  },
  poor_trade: {
    why: "A capture is only good if the position after the recapture is good. Count what remains, not only what you take.",
    lookFor: ["Forced recaptures", "Higher-value piece left en prise", "Trades that help the opponent's worst piece"],
    drill: "Calculate capture, recapture, and final material before moving.",
  },
};

const TRAINING_MODULES = [
  {
    id: "scholars-mate-line",
    title: "Four-move checkmate",
    type: "Opening trap",
    category: "candidate_moves",
    playerColor: "w",
    fen: "start",
    objective: "Practice the Scholar's Mate pattern as a forcing line.",
    steps: [
      { move: "e2e4", reply: "e7e5", idea: "Open lines for the queen and bishop." },
      { move: "f1c4", reply: "b8c6", idea: "Aim the bishop at f7, the weakest pawn near Black's king." },
      { move: "d1h5", reply: "g8f6", idea: "Create a direct threat on f7." },
      { move: "h5f7", reply: null, idea: "Qxf7# works because the bishop supports the queen." },
    ],
  },
  {
    id: "defend-scholars-mate",
    title: "Defend four-move checkmate",
    type: "Opening defense",
    category: "king_safety",
    playerColor: "b",
    fen: "rnbqkbnr/pppp1ppp/8/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2",
    objective: "Stop the early queen attack before it becomes mate on f7.",
    expectedMoves: ["g7g6", "b8c6"],
    successText: "Good. You either attacked the queen or defended the e5/f7 problem.",
  },
  {
    id: "queen-king-mate",
    title: "Queen and king checkmate",
    type: "Checkmate",
    category: "candidate_moves",
    playerColor: "w",
    fen: "6k1/8/6K1/8/8/8/8/5Q2 w - - 0 1",
    objective: "Finish the basic queen mate with king support.",
    expectedMoves: ["f1f7"],
    successText: "Qf7# works because your king protects the queen and the queen controls g8.",
  },
  {
    id: "back-rank-mate",
    title: "Back-rank mate",
    type: "Checkmate",
    category: "candidate_moves",
    playerColor: "w",
    fen: "4r1k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1",
    objective: "Use the back rank weakness to force mate.",
    expectedMoves: ["e1e8"],
    successText: "Rxe8# works because the king's own pawns remove its escape squares.",
  },
  {
    id: "italian-development",
    title: "Italian Game development",
    type: "Opening",
    category: "opening_principle",
    playerColor: "w",
    fen: "start",
    objective: "Practice a clean opening setup: center, knight, bishop, castle.",
    steps: [
      { move: "e2e4", reply: "e7e5", idea: "Take central space." },
      { move: "g1f3", reply: "b8c6", idea: "Develop while attacking e5." },
      { move: "f1c4", reply: "g8f6", idea: "Develop toward the king side." },
      { move: "e1g1", reply: null, idea: "Castle before starting side attacks." },
    ],
  },
  {
    id: "queens-gambit-development",
    title: "Queen's Gambit development",
    type: "Opening",
    category: "opening_principle",
    playerColor: "w",
    fen: "start",
    objective: "Practice the first moves and the development plan behind the Queen's Gambit.",
    steps: [
      { move: "d2d4", reply: "d7d5", idea: "Claim central space." },
      { move: "c2c4", reply: "e7e6", idea: "Pressure Black's center." },
      { move: "b1c3", reply: "g8f6", idea: "Develop and support d5 pressure." },
      { move: "c1g5", reply: null, idea: "Develop with pressure on the knight." },
    ],
  },
];

const PRACTICE_MOTIFS = {
  missed_mate: {
    term: "checkmate",
    definition: "Checkmate means the king is attacked and has no legal way to escape.",
    plainGoal: "Find the forcing move that traps the king with no escape squares.",
    scan: "Start with checks, then ask whether the king can move, capture, or block.",
  },
  missed_fork: {
    term: "fork",
    definition: "A fork is one move that attacks two important targets at the same time.",
    plainGoal: "Find a move that attacks two important pieces at once.",
    scan: "Look for knight, queen, or pawn moves that hit the king and another valuable piece.",
  },
  missed_pin: {
    term: "pin",
    definition: "A pin makes a piece hard to move because something more important is behind it.",
    plainGoal: "Find a move that freezes a defender in front of the king.",
    scan: "Use bishops, rooks, or queens to line up an enemy piece with its king.",
  },
  missed_skewer: {
    term: "skewer",
    definition: "A skewer attacks a valuable piece first, forcing it to move and exposing what sits behind it.",
    plainGoal: "Find a check that pushes the king away from a piece behind it.",
    scan: "Use a line piece to check the king and notice what is behind the king on that line.",
  },
  missed_capture: {
    term: "loose piece",
    definition: "A loose piece is not defended well enough, so a capture can win material.",
    plainGoal: "Find the valuable piece that can be taken safely.",
    scan: "Check captures first, then make sure your capturing piece cannot be won back for more.",
  },
  discovered_attack: {
    term: "discovered attack",
    definition: "A discovered attack happens when one piece moves away and opens a line for another piece.",
    plainGoal: "Move one piece so another piece behind it suddenly attacks something valuable.",
    scan: "Find your blocked bishop, rook, or queen, then move the blocker with tempo.",
  },
  king_safety: {
    term: "defense",
    definition: "Good defense stops the opponent's forcing idea before it becomes checkmate or material loss.",
    plainGoal: "Stop the threat before it becomes checkmate.",
    scan: "Ask what the opponent is threatening, then block it, capture it, or attack the attacking piece.",
  },
};

const CURATED_PRACTICE_PUZZLES = [
  {
    id: "mate-back-rank-1",
    source: "curated",
    category: "missed_mate",
    plainTitle: "No escape squares",
    title: "Back-rank mate",
    difficulty: 1,
    playerColor: "w",
    fen: "4r1k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1",
    expectedMoves: ["e1e8"],
    targetSquares: ["e8", "g8", "f7", "g7", "h7"],
    hintSquares: ["e1", "e8"],
    hintSteps: [
      "Look at checks first.",
      "The rook can reach the back rank.",
      "The king's own pawns remove its escape squares.",
    ],
    successText: "Correct. The rook gives check and the king has no escape squares.",
    missText: "Not yet. Start by checking every legal check.",
  },
  {
    id: "mate-queen-king-1",
    source: "curated",
    category: "missed_mate",
    plainTitle: "Protected queen",
    title: "Queen and king mate",
    difficulty: 1,
    playerColor: "w",
    fen: "6k1/8/6K1/8/8/8/8/5Q2 w - - 0 1",
    expectedMoves: ["f1f7"],
    targetSquares: ["f7", "g8"],
    hintSquares: ["f1", "f7", "g6"],
    hintSteps: [
      "The queen needs protection when it checks.",
      "Your king already protects f7.",
      "Move the queen next to the king where it cannot be captured.",
    ],
    successText: "Correct. The queen is protected, and the black king has no safe square.",
    missText: "Not yet. Look for a queen check protected by your king.",
  },
  {
    id: "fork-knight-1",
    source: "curated",
    category: "missed_fork",
    plainTitle: "Two targets",
    title: "Knight fork",
    difficulty: 1,
    playerColor: "w",
    fen: "q3k3/8/8/3N4/8/8/8/4K3 w - - 0 1",
    expectedMoves: ["d5c7"],
    targetSquares: ["e8", "a8"],
    hintSquares: ["d5", "c7"],
    hintSteps: [
      "Knights are good at attacking two separated targets.",
      "Look for a move that gives check.",
      "The same knight move also attacks the queen in the corner.",
    ],
    successText: "Correct. The knight checks the king and attacks the queen.",
    missText: "Not yet. Try to move the knight with check.",
  },
  {
    id: "pin-bishop-1",
    source: "curated",
    category: "missed_pin",
    plainTitle: "Freeze the defender",
    title: "Bishop pin",
    difficulty: 1,
    playerColor: "w",
    fen: "4k3/8/2n5/8/8/8/8/4KB2 w - - 0 1",
    expectedMoves: ["f1b5"],
    targetSquares: ["c6", "e8"],
    hintSquares: ["f1", "b5", "c6", "e8"],
    hintSteps: [
      "Line pieces can freeze defenders.",
      "The bishop can aim through the knight toward the king.",
      "Move the bishop to b5.",
    ],
    successText: "Correct. The knight is stuck in front of the king.",
    missText: "Not yet. Look for a bishop move that lines up with the king.",
  },
  {
    id: "skewer-rook-1",
    source: "curated",
    category: "missed_skewer",
    plainTitle: "King in front",
    title: "Rook skewer",
    difficulty: 2,
    playerColor: "w",
    fen: "4q3/4k3/8/8/8/8/R7/6K1 w - - 0 1",
    expectedMoves: ["a2e2"],
    targetSquares: ["e7", "e8"],
    hintSquares: ["a2", "e2", "e7", "e8"],
    hintSteps: [
      "Look for a checking move with the rook.",
      "The king and queen are on the same file.",
      "Move the rook to e2.",
    ],
    successText: "Correct. The king must move, and the queen behind it will be exposed.",
    missText: "Not yet. Find the rook check on the same file as the king and queen.",
  },
  {
    id: "loose-queen-1",
    source: "curated",
    category: "missed_capture",
    plainTitle: "Win the loose queen",
    title: "Loose queen",
    difficulty: 1,
    playerColor: "w",
    fen: "4k3/4q3/8/8/8/8/8/4R1K1 w - - 0 1",
    expectedMoves: ["e1e7"],
    targetSquares: ["e7", "e8"],
    hintSquares: ["e1", "e7"],
    hintSteps: [
      "Check captures before quiet moves.",
      "The queen is on the same file as your rook.",
      "Your rook can take the queen.",
    ],
    successText: "Correct. The rook wins the loose queen with check.",
    missText: "Not yet. Look for a safe capture of a valuable piece.",
  },
  {
    id: "discovered-attack-1",
    source: "curated",
    category: "discovered_attack",
    plainTitle: "Open the line",
    title: "Discovered attack",
    difficulty: 2,
    playerColor: "w",
    fen: "4q1k1/8/2N5/1B6/8/8/8/4K3 w - - 0 1",
    expectedMoves: ["c6e7"],
    targetSquares: ["g8", "e8"],
    hintSquares: ["c6", "e7", "b5", "e8"],
    hintSteps: [
      "One of your own pieces is blocking a bishop.",
      "Move the blocker with check.",
      "The bishop will then attack the queen.",
    ],
    successText: "Correct. The knight checks the king and opens the bishop's attack on the queen.",
    missText: "Not yet. Move the blocking knight with tempo.",
  },
  {
    id: "defense-scholars-1",
    source: "curated",
    category: "king_safety",
    plainTitle: "Stop the threat",
    title: "Defend mate threat",
    difficulty: 1,
    playerColor: "b",
    fen: "rnbqkbnr/pppp1ppp/8/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2",
    expectedMoves: ["g7g6", "b8c6"],
    targetSquares: ["h5", "f7", "e5"],
    hintSquares: ["h5", "f7", "g6", "c6"],
    hintSteps: [
      "White is aiming at f7.",
      "You can attack the queen or defend the key square.",
      "g6 or Nc6 both solve the immediate problem.",
    ],
    successText: "Correct. You stopped the early queen attack before it became mate.",
    missText: "Not yet. First identify what White is threatening on f7.",
  },
];

const INTERACTIVE_LESSONS = {
  "loose-pieces": {
    id: "lesson-loose-pieces",
    title: "Loose pieces",
    type: "Lesson",
    category: "hanging_piece",
    playerColor: "w",
    fen: "4k3/4q3/8/8/8/8/8/4R1K1 w - - 0 1",
    objective: "Your rook is lined up with an undefended queen. Win the loose piece and notice why it works.",
    expectedMoves: ["e1e7"],
    successText: "Good. Rxe7+ wins the undefended queen because the rook has a clear file and gives check.",
  },
  "checks-captures-threats": {
    id: "lesson-checks-captures-threats",
    title: "Checks, captures, threats",
    type: "Lesson",
    category: "candidate_moves",
    playerColor: "w",
    fen: "4r1k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1",
    objective: "Start with forcing moves. White has a check that is also a capture and mate.",
    expectedMoves: ["e1e8"],
    successText: "Correct. Rxe8# is the forcing move: check, capture, and mate because the king has no escape squares.",
  },
  "opening-principles": {
    id: "lesson-opening-principles",
    title: "Opening principles",
    type: "Lesson",
    category: "opening_principle",
    playerColor: "w",
    fen: "start",
    objective: "Build a clean opening: center, knight, bishop, castle.",
    steps: [
      { move: "e2e4", reply: "e7e5", idea: "Take central space first." },
      { move: "g1f3", reply: "b8c6", idea: "Develop a knight while attacking e5." },
      { move: "f1c4", reply: "g8f6", idea: "Develop the bishop toward the king side." },
      { move: "e1g1", reply: null, idea: "Castle before starting side attacks." },
    ],
  },
  "king-safety": {
    id: "lesson-king-safety",
    title: "King safety",
    type: "Lesson",
    category: "king_safety",
    playerColor: "b",
    fen: "rnbqkbnr/pppp1ppp/8/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2",
    objective: "White is aiming at f7. Stop the attack instead of making a random developing move.",
    expectedMoves: ["g7g6", "b8c6"],
    successText: "Good. You either hit the queen or defend the key square before the attack becomes mate.",
  },
  "trade-quality": {
    id: "lesson-trade-quality",
    title: "Trade quality",
    type: "Lesson",
    category: "poor_trade",
    playerColor: "w",
    fen: "4k3/8/8/3q4/3R4/8/8/4K3 w - - 0 1",
    objective: "Before trading, count the final position. Here the capture wins the queen cleanly.",
    expectedMoves: ["d4d5"],
    successText: "Correct. Rxd5 wins the queen. The key habit is calculating what remains after the capture.",
  },
  "candidate-moves": {
    id: "lesson-candidate-moves",
    title: "Candidate moves",
    type: "Lesson",
    category: "candidate_moves",
    playerColor: "w",
    fen: "6k1/5ppp/8/8/8/8/5PPP/5RK1 w - - 0 1",
    objective: "Compare checks, captures, and threats. There is a direct mate pattern available.",
    expectedMoves: ["f1e1"],
    successText: "Good. Re1 creates a back-rank mating pattern. Candidate moves reveal forcing ideas before quiet moves.",
  },
};

const OPENING_BOOK = [
  {
    name: "Ruy Lopez",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bb5"],
    plans: ["Castle quickly", "Build pressure on e5", "Prepare c3 and d4"],
  },
  {
    name: "Italian Game",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4"],
    plans: ["Castle quickly", "Prepare c3 and d4", "Watch tactics on f7"],
  },
  {
    name: "Scotch Game",
    moves: ["e4", "e5", "Nf3", "Nc6", "d4"],
    plans: ["Open the center", "Develop with tempo", "Avoid early queen exposure"],
  },
  {
    name: "Queen's Gambit",
    moves: ["d4", "d5", "c4"],
    plans: ["Pressure the center", "Develop smoothly", "Use the c-file later"],
  },
  {
    name: "London System",
    moves: ["d4", "d5", "Bf4"],
    plans: ["Support e5", "Develop the kingside", "Avoid autopilot piece placement"],
  },
  {
    name: "Sicilian Defense",
    moves: ["e4", "c5"],
    plans: ["Control d4", "Watch tactics on the c-file", "Balance development with counterplay"],
  },
  {
    name: "French Defense",
    moves: ["e4", "e6"],
    plans: ["Challenge the center with d5", "Solve the light bishop", "Attack pawn chains"],
  },
  {
    name: "Caro-Kann Defense",
    moves: ["e4", "c6"],
    plans: ["Challenge e4 with d5", "Develop before pawn grabs", "Aim for solid structure"],
  },
];

const DEFAULT_SETTINGS = {
  playerColor: "w",
  engineDepth: 5,
  coachMode: "post_game",
};

const els = {
  board: document.querySelector("#board"),
  newGameButton: document.querySelector("#newGameButton"),
  takeBackButton: document.querySelector("#takeBackButton"),
  seatOpponent: document.querySelector("#seatOpponent"),
  seatPlayer: document.querySelector("#seatPlayer"),
  opponentSeatName: document.querySelector("#opponentSeatName"),
  opponentSeatSub: document.querySelector("#opponentSeatSub"),
  opponentProgressDots: document.querySelector("#opponentProgressDots"),
  opponentAvatar: document.querySelector("#opponentAvatar"),
  playerSeatSub: document.querySelector("#playerSeatSub"),
  playerSeatPill: document.querySelector("#playerSeatPill"),
  ctxHeadTitle: document.querySelector("#ctxHeadTitle"),
  ctxHeadMeta: document.querySelector("#ctxHeadMeta"),
  practiceBadge: document.querySelector("#practiceBadge"),
  tabs: [...document.querySelectorAll(".tab")],
  panels: [...document.querySelectorAll(".panel")],
  coachPanel: document.querySelector("#coachPanel"),
  reviewPanel: document.querySelector("#reviewPanel"),
  practicePanel: document.querySelector("#practicePanel"),
  profilePanel: document.querySelector("#profilePanel"),
  lessonsPanel: document.querySelector("#lessonsPanel"),
  settingsPanel: document.querySelector("#settingsPanel"),
};

const state = {
  game: new Chess(),
  settings: loadJson(STORAGE_KEYS.settings, DEFAULT_SETTINGS),
  profile: loadJson(STORAGE_KEYS.profile, {}),
  practiceQueue: loadJson(STORAGE_KEYS.practice, []),
  practiceHistory: loadJson(STORAGE_KEYS.practiceHistory, []),
  localGames: loadJson(STORAGE_KEYS.games, []),
  placement: loadJson(STORAGE_KEYS.placement, DEFAULT_PLACEMENT),
  placementCardDismissed: loadJson(STORAGE_KEYS.placementCardDismissed, false),
  selectedSquare: null,
  selectedLessonId: null,
  legalTargets: new Set(),
  lastMove: null,
  moves: [],
  currentGameId: crypto.randomUUID(),
  currentTab: "coach",
  reviewPly: null,
  thinking: false,
  activeDrill: null,
  drillMessage: "",
  practiceTrainer: {
    attempts: 0,
    hintIndex: 0,
    status: "idle",
    lastMoveUci: "",
    scoreDelta: 0,
    feedback: "",
  },
  openAI: {
    configured: false,
    online: false,
    model: "",
    status: "Checking OpenAI coach...",
  },
  aiCoach: {
    loading: false,
    error: "",
    data: null,
    context: "",
  },
  supabaseConfig: normalizeSupabaseConfig(loadJson(STORAGE_KEYS.supabase, DEFAULT_SUPABASE_CONFIG)),
  supabase: null,
  supabaseHealth: "",
  supabaseReachable: null,
  supabaseAnalysisReachable: null,
  supabaseQualityReachable: null,
  engine: null,
};

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeSupabaseConfig(config) {
  return {
    ...DEFAULT_SUPABASE_CONFIG,
    ...config,
    url: config?.url || DEFAULT_SUPABASE_CONFIG.url,
    anonKey: config?.anonKey || DEFAULT_SUPABASE_CONFIG.anonKey,
  };
}

async function loadSupabaseCreateClient() {
  if (!supabaseModulePromise) {
    supabaseModulePromise = import(SUPABASE_CLIENT_URL).catch((error) => {
      supabaseModulePromise = null;
      throw error;
    });
  }

  const module = await supabaseModulePromise;
  if (typeof module.createClient !== "function") {
    throw new Error("Supabase client module did not expose createClient.");
  }
  return module.createClient;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function opposite(color) {
  return color === "w" ? "b" : "w";
}

function colorName(color) {
  return color === "w" ? "White" : "Black";
}

function pieceName(piece) {
  return {
    p: "pawn",
    n: "knight",
    b: "bishop",
    r: "rook",
    q: "queen",
    k: "king",
  }[piece] || "piece";
}

function normalizeSan(san) {
  return san.replace(/[+#?!]+/g, "");
}

function isBoardFlipped() {
  const playerColor = state.activeDrill ? state.activeDrill.playerColor : state.settings.playerColor;
  return playerColor === "b";
}

function getBoardSquares() {
  const flipped = isBoardFlipped();
  const ranks = flipped ? [...RANKS] : [...RANKS].reverse();
  const files = flipped ? [...FILES].reverse() : [...FILES];
  return ranks.flatMap((rank) => files.map((file) => `${file}${rank}`));
}

function isPracticeTrainerDrill(drill = state.activeDrill) {
  return Boolean(drill?.isPracticeTrainer);
}

function getPracticeBoardCue(square) {
  if (!isPracticeTrainerDrill()) return null;

  const trainer = state.practiceTrainer || {};
  const drill = state.activeDrill;
  const classes = [];
  let label = "";
  let badge = "";
  const lastMove = trainer.lastMoveUci || "";
  const lastFrom = lastMove.slice(0, 2);
  const lastTo = lastMove.slice(2, 4);
  const showHintSquares = trainer.hintIndex >= 2 || trainer.status === "solved";

  if (showHintSquares && drill.hintSquares?.includes(square)) {
    classes.push("practice-hint-square");
    label = "Hint square";
  }

  if (trainer.status === "solved" && drill.targetSquares?.includes(square)) {
    classes.push("practice-target-square");
    label = "Tactical target";
  }

  if (trainer.status === "solved" && lastMove && (square === lastFrom || square === lastTo)) {
    classes.push("practice-answer-square");
    label = square === lastTo ? "Correct move destination" : "Correct move origin";
    if (square === lastTo) badge = "✓";
  }

  if (!classes.length && !badge) return null;
  return {
    className: classes.join(" "),
    label,
    badge,
  };
}

function getMoveQuality(move) {
  if (!move?.qualityKey) return null;
  const key = String(move.qualityKey);
  const display = MOVE_QUALITIES[key] || MOVE_QUALITIES.good;
  return {
    key,
    label: move.qualityLabel || display.label,
    symbol: move.qualitySymbol || display.symbol,
    reason: move.qualityReason || display.reason,
    tone: display.tone,
  };
}

function qualityClassName(key) {
  return `quality-${String(key || "good").replace(/[^a-z0-9_-]/gi, "")}`;
}

function getLatestPlayerMove() {
  return [...state.moves].reverse().find((move) => move.role === "player") || null;
}

function getLiveMoveQualityCue() {
  if (!isPlacementComplete() || state.activeDrill) return null;
  const move = getLatestPlayerMove();
  const quality = getMoveQuality(move);
  return quality && move?.to ? { move, quality } : null;
}

function renderQualityBadgeHtml(move, extraClass = "") {
  const quality = getMoveQuality(move);
  if (!quality) return "";
  const label = `${quality.label}: ${quality.reason}`;
  return `<span class="move-quality-badge ${qualityClassName(quality.key)} ${extraClass}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${escapeHtml(quality.symbol)}</span>`;
}

function animateBoardMove(move) {
  if (!move?.from || !move?.to || !els.board?.parentElement) return false;
  const fromSquare = els.board.querySelector(`[data-square="${move.from}"]`);
  const toSquare = els.board.querySelector(`[data-square="${move.to}"]`);
  const host = els.board.parentElement;
  if (!fromSquare || !toSquare) return false;

  const hostRect = host.getBoundingClientRect();
  const fromRect = fromSquare.getBoundingClientRect();
  const toRect = toSquare.getBoundingClientRect();
  if (!fromRect.width || !toRect.width) return false;

  const pieceGlyph = PIECES[move.color + (move.promotion || move.piece)] || fromSquare.querySelector(".piece")?.textContent || "";
  if (!pieceGlyph) return false;

  fromSquare.classList.add("animating-from");
  toSquare.classList.add("animating-to");

  const ghost = document.createElement("span");
  ghost.className = `piece ${move.color} move-ghost`;
  ghost.textContent = pieceGlyph;
  ghost.style.width = `${fromRect.width}px`;
  ghost.style.height = `${fromRect.height}px`;
  ghost.style.left = `${fromRect.left - hostRect.left}px`;
  ghost.style.top = `${fromRect.top - hostRect.top}px`;
  host.append(ghost);

  const dx = toRect.left - fromRect.left;
  const dy = toRect.top - fromRect.top;
  window.requestAnimationFrame(() => {
    ghost.style.transform = `translate(${dx}px, ${dy}px)`;
  });
  window.setTimeout(() => ghost.remove(), 220);
  return true;
}

function renderAfterMoveAnimation(animated, callback) {
  const delay = animated ? 170 : 0;
  window.setTimeout(() => {
    renderAll();
    callback?.();
  }, delay);
}

function renderAll() {
  if (state.currentTab === "practice" && areRequiredServicesReady()) {
    ensurePracticeTrainer();
  }
  renderBoard();
  renderGameMeta();
  renderCurrentPanel();
  saveJson(STORAGE_KEYS.settings, state.settings);
  saveJson(STORAGE_KEYS.profile, state.profile);
  saveJson(STORAGE_KEYS.practice, state.practiceQueue);
  saveJson(STORAGE_KEYS.practiceHistory, state.practiceHistory);
  saveJson(STORAGE_KEYS.placement, state.placement);
  saveJson(STORAGE_KEYS.placementCardDismissed, state.placementCardDismissed);
}

function renderBoard() {
  els.board.innerHTML = "";

  if (!areRequiredServicesReady()) {
    els.board.innerHTML = `
      <div class="service-board-gate">
        <span>Required services</span>
        <strong>Supabase and OpenAI must be online</strong>
        <p>Use Settings or Check services to connect the database and personal coach.</p>
      </div>
    `;
    return;
  }

  const liveQualityCue = getLiveMoveQualityCue();

  for (const square of getBoardSquares()) {
    const fileIndex = FILES.indexOf(square[0]);
    const rankIndex = Number(square[1]) - 1;
    const piece = state.game.get(square);
    const squareQuality = liveQualityCue?.move.to === square ? liveQualityCue.quality : null;
    const practiceCue = getPracticeBoardCue(square);
    const button = document.createElement("button");
    button.type = "button";
    button.className = [
      "square",
      (fileIndex + rankIndex) % 2 === 0 ? "dark" : "light",
      state.selectedSquare === square ? "selected" : "",
      state.legalTargets.has(square) ? "target" : "",
      state.lastMove && (state.lastMove.from === square || state.lastMove.to === square) ? "last" : "",
      squareQuality ? "quality-cued" : "",
      squareQuality ? qualityClassName(squareQuality.key) : "",
      practiceCue?.className || "",
    ].filter(Boolean).join(" ");
    button.dataset.square = square;
    const ariaDetails = [
      squareQuality ? `${squareQuality.label}: ${squareQuality.reason}` : "",
      practiceCue?.label || "",
    ].filter(Boolean).join(" ");
    button.setAttribute("aria-label", ariaDetails ? `${square}. ${ariaDetails}` : square);
    if (squareQuality || practiceCue?.label) {
      button.title = [squareQuality ? `${squareQuality.label}: ${squareQuality.reason}` : "", practiceCue?.label || ""]
        .filter(Boolean)
        .join(" ");
    }

    if (piece) {
      const span = document.createElement("span");
      span.className = `piece ${piece.color}`;
      span.textContent = PIECES[piece.color + piece.type];
      button.append(span);
    }

    if (squareQuality) {
      const badge = document.createElement("span");
      badge.className = `move-quality-badge ${qualityClassName(squareQuality.key)}`;
      badge.textContent = squareQuality.symbol;
      badge.setAttribute("aria-hidden", "true");
      button.append(badge);
    }

    if (practiceCue?.badge) {
      const badge = document.createElement("span");
      badge.className = "practice-square-badge";
      badge.textContent = practiceCue.badge;
      badge.setAttribute("aria-hidden", "true");
      button.append(badge);
    }

    const flipped = isBoardFlipped();
    if (square[0] === (flipped ? "h" : "a")) {
      const rankCoord = document.createElement("span");
      rankCoord.className = "coord rank";
      rankCoord.textContent = square[1];
      button.append(rankCoord);
    }
    if (square[1] === (flipped ? "8" : "1")) {
      const fileCoord = document.createElement("span");
      fileCoord.className = "coord file";
      fileCoord.textContent = square[0];
      button.append(fileCoord);
    }

    button.addEventListener("click", () => handleSquareClick(square));
    els.board.append(button);
  }
}

function getPlayerSeatSubLabel() {
  const moveNumber = Math.floor(state.moves.length / 2) + 1;
  const playerColor = state.activeDrill?.playerColor || state.settings.playerColor;
  return `${colorName(playerColor)} · move ${moveNumber}`;
}

const PLACEMENT_INTENSITY = ["light", "light", "balanced", "challenging", "strongest"];

function getOpponentSeatLabels() {
  if (state.activeDrill) {
    if (isPracticeTrainerDrill()) {
      return { name: "Practice Trainer", sub: state.activeDrill.plainTitle || state.activeDrill.type || "Puzzle" };
    }
    return { name: "Training Board", sub: state.activeDrill.type || "Drill" };
  }
  const progress = getPlacementProgress();
  if (!progress.complete) {
    const level = Math.min(progress.completed + 1, progress.target);
    const intensity = PLACEMENT_INTENSITY[level - 1] || "light";
    return { name: "Placement Opponent", sub: `Level ${level} of 5 · ${intensity}` };
  }
  const score = getEstimatedTrainingScore();
  return { name: "Adaptive Opponent", sub: score ? `Adaptive · score ${score}` : "Adaptive" };
}

function fillProgressDots(container, completed, total = 5) {
  if (!container) return;
  const dots = container.querySelectorAll("i");
  for (let i = 0; i < dots.length; i++) {
    dots[i].classList.toggle("on", i < Math.min(total, completed));
  }
}

function getStorageStatusLabel() {
  if (state.supabaseReachable) return "Supabase ready";
  if (state.supabase) return "Supabase configured";
  if (state.supabaseConfig.url && !state.supabaseConfig.anonKey) return "Supabase key needed";
  if (state.supabaseReachable === false) return "Supabase unavailable";
  return "Supabase required";
}

function isSupabaseReady() {
  return state.supabaseReachable === true;
}

function isOpenAIReady() {
  return state.openAI.configured === true && state.openAI.online === true;
}

function areRequiredServicesReady() {
  return isSupabaseReady() && isOpenAIReady();
}

function getRequiredServiceRows() {
  return [
    {
      name: "Supabase",
      ready: isSupabaseReady(),
      detail: isSupabaseReady()
        ? "Online and writable."
        : state.supabaseHealth || (state.supabase ? "Checking database access..." : "Supabase must be configured and reachable."),
    },
    {
      name: "OpenAI coach",
      ready: isOpenAIReady(),
      detail: isOpenAIReady()
        ? `Online${state.openAI.model ? ` with ${state.openAI.model}` : ""}.`
        : state.openAI.status || "OpenAI must be configured and reachable.",
    },
  ];
}

function renderRequiredServicesCard() {
  const rows = getRequiredServiceRows().map((service) => `
    <div class="service-row ${service.ready ? "ready" : "blocked"}">
      <span class="service-dot"></span>
      <div>
        <strong>${escapeHtml(service.name)}</strong>
        <p>${escapeHtml(service.detail)}</p>
      </div>
    </div>
  `).join("");

  return `
    <article class="mini-card service-gate-card">
      <span class="label">Required services</span>
      <strong>Supabase and OpenAI must be online</strong>
      <p>The chess teacher is intentionally locked until the database and personal coach are reachable.</p>
      <div class="service-list">${rows}</div>
      <div class="button-row">
        <button id="checkRequiredServicesButton" type="button">Check services</button>
        <button id="openSettingsButton" type="button">Settings</button>
      </div>
    </article>
  `;
}

function bindRequiredServicesCard() {
  document.querySelector("#checkRequiredServicesButton")?.addEventListener("click", verifyRequiredServices);
  document.querySelector("#openSettingsButton")?.addEventListener("click", () => switchTab("settings"));
}

function renderLockedPanel(tab) {
  const panel = {
    coach: els.coachPanel,
    review: els.reviewPanel,
    practice: els.practicePanel,
    profile: els.profilePanel,
    lessons: els.lessonsPanel,
  }[tab];

  if (!panel) return false;
  panel.innerHTML = `
    <h2>${escapeHtml(tab)}</h2>
    <div class="stack">
      ${renderRequiredServicesCard()}
    </div>
  `;
  bindRequiredServicesCard();
  return true;
}

function renderGameMeta() {
  const progress = getPlacementProgress();
  const servicesReady = areRequiredServicesReady();

  // Opponent seat
  const opponentLabels = getOpponentSeatLabels();
  els.opponentSeatName.textContent = opponentLabels.name;
  els.opponentSeatSub.textContent = opponentLabels.sub;
  if (els.opponentAvatar) {
    els.opponentAvatar.textContent = state.activeDrill ? "T" : "N";
  }
  fillProgressDots(els.opponentProgressDots, progress.completed, progress.target);

  // Player seat
  els.playerSeatSub.textContent = getPlayerSeatSubLabel();
  const activePlayerColor = state.activeDrill?.playerColor || state.settings.playerColor;
  const playerToMove = state.game.turn() === activePlayerColor;
  els.playerSeatPill.classList.toggle("waiting", !servicesReady || !playerToMove);
  els.playerSeatPill.innerHTML = `<span class="dot"></span> ${servicesReady ? (playerToMove ? "Your move" : "Opponent thinking") : "Services required"}`;

  // Seat turn indicator
  els.seatOpponent.classList.toggle("turn", servicesReady && !playerToMove);
  els.seatPlayer.classList.toggle("turn", servicesReady && playerToMove);

  // Coach card ribbon dots (rendered inside the coach panel — query lazily)
  const coachDots = document.querySelector(".coach-card .progress-dots.coach");
  if (coachDots) {
    fillProgressDots(coachDots, progress.completed, progress.target);
  }

  // Practice tab badge
  if (els.practiceBadge) {
    const count = state.practiceQueue.length;
    els.practiceBadge.textContent = String(count);
    els.practiceBadge.hidden = count === 0;
  }

  // Ctx-head reflects the current tab
  updateCtxHead(state.currentTab);

  els.newGameButton.disabled = !servicesReady || state.thinking || Boolean(state.activeDrill);
  els.takeBackButton.disabled = !servicesReady || state.thinking || Boolean(state.activeDrill) || state.game.history().length < 2;
}

function updateCtxHead(tab) {
  if (!els.ctxHeadTitle || !els.ctxHeadMeta) return;
  const titles = {
    coach: "Coach",
    review: "Review",
    practice: "Practice",
    profile: "Profile",
    lessons: "Lessons",
    settings: "Settings",
  };
  els.ctxHeadTitle.textContent = titles[tab] || "";
  els.ctxHeadMeta.textContent = ctxHeadMetaFor(tab);
}

function ctxHeadMetaFor(tab) {
  const progress = getPlacementProgress();
  switch (tab) {
    case "coach":
      return progress.complete ? "Adaptive" : `Placement · ${progress.completed} / ${progress.target}`;
    case "review":
      return state.moves.length ? `${state.moves.length} ${state.moves.length === 1 ? "ply" : "plies"}` : "";
    case "practice": {
      if (progress.complete) {
        const stats = getPracticeStats();
        return `Trainer · streak ${stats.streak}`;
      }
      const n = state.practiceQueue.length;
      return n ? `${n} queued` : "Empty";
    }
    case "profile":
      return "";
    case "lessons":
      return `${STARTER_LESSONS.length} lessons`;
    case "settings":
      return state.openAI.status || "";
    default:
      return "";
  }
}

function renderCurrentPanel() {
  if (!areRequiredServicesReady() && state.currentTab !== "settings") {
    renderLockedPanel(state.currentTab);
    return;
  }

  if (state.currentTab === "coach") renderCoachPanel();
  if (state.currentTab === "review") renderReviewPanel();
  if (state.currentTab === "practice") renderPracticePanel();
  if (state.currentTab === "profile") renderProfilePanel();
  if (state.currentTab === "lessons") renderLessonsPanel();
  if (state.currentTab === "settings") renderSettingsPanel();
}

function renderCoachPanel() {
  if (state.activeDrill) {
    if (isPracticeTrainerDrill()) {
      els.coachPanel.innerHTML = `
        <h2>Coach</h2>
        <div class="stack">
          <article class="mini-card practice-trainer-card">
            <span class="label">Practice active</span>
            <strong>${escapeHtml(state.activeDrill.plainTitle || "Find the idea")}</strong>
            <p>${escapeHtml(state.drillMessage || state.activeDrill.plainGoal)}</p>
            <button id="openPracticeTrainerButton" type="button">Open practice trainer</button>
          </article>
        </div>
      `;
      document.querySelector("#openPracticeTrainerButton")?.addEventListener("click", () => switchTab("practice"));
      return;
    }

    const target = getCurrentDrillTarget();
    els.coachPanel.innerHTML = `
      <h2>Coach</h2>
      <div class="stack">
        <article class="mini-card">
          <span class="label">${escapeHtml(state.activeDrill.type)}</span>
          <strong>${escapeHtml(state.activeDrill.title)}</strong>
          <p>${escapeHtml(state.drillMessage || state.activeDrill.objective)}</p>
          <div class="candidate-list coach-candidates">
            ${target.expectedMoves.map((uci) => `
              <div class="candidate-row">
                <strong>${escapeHtml(uciToSan(state.game.fen(), uci) || uci)}</strong>
                <span>${escapeHtml(target.idea || explainCandidateByUci(state.game.fen(), { uci }))}</span>
              </div>
            `).join("")}
          </div>
        </article>
        ${renderAICoachCard("drill")}
      </div>
    `;
    bindAICoachButton("drill");
    return;
  }

  const candidates = rankCandidateMoves(state.game.fen()).slice(0, 5);
  const lastPlayerMove = [...state.moves].reverse().find((move) => move.role === "player");
  const shouldShowCandidates = isPlacementComplete() || state.game.isCheck();
  const candidateRows = candidates.slice(0, 3).map((move) => `
    <div class="candidate-row">
      <strong>${escapeHtml(move.san)}</strong>
      <span>${escapeHtml(explainCandidateMove(state.game.fen(), move))}</span>
    </div>
  `).join("");

  els.coachPanel.innerHTML = `
    <h2>Coach</h2>
    <div class="stack">
      ${renderPlacementCard()}
      ${renderPositionBriefCard()}
      ${shouldShowCandidates ? `<article class="mini-card">
        <strong>Candidate moves</strong>
        <p>${escapeHtml(getCandidateMovePrompt())}</p>
        <div class="candidate-list coach-candidates">
          ${candidateRows || "<p class=\"empty-state\">No legal moves.</p>"}
        </div>
      </article>` : ""}
      ${lastPlayerMove ? renderMoveReviewCard(lastPlayerMove) : ""}
      ${renderAICoachCard("position")}
    </div>
  `;
  bindPlacementDismiss();
  bindAICoachButton("position");
}

function renderPlacementCard() {
  if (state.placementCardDismissed) return "";

  const progress = getPlacementProgress();
  const score = getEstimatedTrainingScore();

  if (progress.complete) {
    return `
      <article class="mini-card placement-card dismissible-card">
        <button class="dismiss-card-button" type="button" data-dismiss-placement aria-label="Hide placement card">x</button>
        <span class="label">Player model</span>
        <strong>Personal coach unlocked</strong>
        <p>Your first ${progress.target} completed games set the starting score${score ? ` at ${score}` : ""}. Bot strength now adapts from recent results, mistake severity, and practice outcomes.</p>
      </article>
    `;
  }

  return `
    <article class="mini-card placement-card dismissible-card">
      <button class="dismiss-card-button" type="button" data-dismiss-placement aria-label="Hide placement card">x</button>
      <span class="label">Placement</span>
      <strong>Game ${progress.completed + 1} of ${progress.target}</strong>
      <p>Finish ${progress.remaining} more completed game${progress.remaining === 1 ? "" : "s"} to unlock the personal coach. The opponent adjusts automatically while the app watches results, openings, and mistake patterns.</p>
    </article>
  `;
}

function bindPlacementDismiss() {
  document.querySelector("[data-dismiss-placement]")?.addEventListener("click", () => {
    state.placementCardDismissed = true;
    saveJson(STORAGE_KEYS.placementCardDismissed, state.placementCardDismissed);
    renderCoachPanel();
  });
}

function renderPositionBriefCard() {
  const brief = getPositionBrief();
  return `
    <article class="mini-card">
      <strong>${escapeHtml(brief.title)}</strong>
      <p>${escapeHtml(brief.body)}</p>
      ${brief.details.length ? `
        <div class="tag-list">
          ${brief.details.map((detail) => `<span class="tag">${escapeHtml(detail)}</span>`).join("")}
        </div>
      ` : ""}
    </article>
  `;
}

function renderMoveReviewCard(move) {
  const quality = getMoveQuality(move);
  const pendingQuality = move.qualityEligible && move.analysisStatus === "pending" && !quality;
  const moveTags = move.tags || [];
  const tags = moveTags.length
    ? moveTags.map((tag) => `<span class="tag ${tag.severity >= 3 ? "danger" : "warn"}">${escapeHtml(tag.label)}</span>`).join("")
    : "<span class=\"tag good\">No issue tagged</span>";
  const qualityPill = quality
    ? `<span class="quality-pill ${qualityClassName(quality.key)}">${renderQualityBadgeHtml(move, "inline-quality-badge")}${escapeHtml(quality.label)}</span>`
    : pendingQuality
      ? "<span class=\"quality-pill quality-pending\">Analyzing</span>"
      : "";

  return `
    <article class="mini-card">
      <strong>Move review: ${escapeHtml(move.san)}</strong>
      ${qualityPill ? `<div class="quality-summary">${qualityPill}</div>` : ""}
      <p>${escapeHtml(quality?.reason || describeMoveImpact(move))}</p>
      <div class="tag-list">${tags}</div>
    </article>
  `;
}

function getCandidateMovePrompt() {
  if (state.game.isGameOver()) return "The game is complete. Review the move list to find the turning point.";
  if (state.game.isCheck()) return "You are in check. Compare king moves, captures of the checking piece, and blocks.";
  const lastEngineMove = [...state.moves].reverse().find((move) => move.role === "engine");
  if (lastEngineMove) {
    return `After ${lastEngineMove.san}, first ask what changed, then compare the forcing candidates below.`;
  }
  return "Before choosing, compare forcing moves and one improving move from the current board.";
}

function getPositionBrief() {
  if (state.game.isGameOver()) {
    return {
      title: "Game complete",
      body: getResultLabel(),
      details: [],
    };
  }

  if (state.game.isCheck()) {
    return {
      title: "You are in check",
      body: "Solve the check before thinking about plans. Legal replies are the only candidates that matter.",
      details: ["king move", "capture", "block"],
    };
  }

  const lastEngineMove = [...state.moves].reverse().find((move) => move.role === "engine");
  const threat = getOpponentThreatSummary();
  const opening = detectOpening();
  const details = [getPhase(state.game), opening.name].filter(Boolean);

  if (lastEngineMove) {
    const impact = describeMoveImpact(lastEngineMove);
    return {
      title: `Position after ${lastEngineMove.san}`,
      body: threat ? `${impact} Main danger to check: ${threat}.` : impact,
      details,
    };
  }

  return {
    title: "Starting position",
    body: isPlacementComplete()
      ? "Choose a first move that fits the opening you want to practice. The coach will adapt the plan from your game history."
      : "Play the move you would normally choose. Placement is measuring habits first; after each move, the coach will review what changed.",
    details,
  };
}

function getOpponentThreatSummary() {
  try {
    const opponentFen = setTurn(state.game.fen(), opposite(state.game.turn()));
    const threats = rankCandidateMoves(opponentFen)
      .filter((move) => move.san.includes("+") || move.score >= 6)
      .slice(0, 2)
      .map((move) => move.san);
    if (!threats.length) return "";
    return threats.length === 1 ? threats[0] : `${threats[0]} or ${threats[1]}`;
  } catch {
    return "";
  }
}

function describeMoveImpact(move) {
  const parts = [];
  if (move.captured) parts.push(`It captured a ${pieceName(move.captured)}.`);
  if (move.san.includes("+")) parts.push("It gave check.");
  if (move.san.includes("O-O")) parts.push("It improved king safety.");
  if (getPhase(move.beforeFen || state.game.fen()) === "opening" && ["n", "b"].includes(move.piece)) {
    parts.push(`It developed a ${pieceName(move.piece)}.`);
  }
  if (isCenterSquare(move.to)) parts.push(`It contested ${move.to}.`);
  if (move.tags?.length) {
    parts.push(move.note || move.tags[0].note);
  } else if (move.role === "player") {
    parts.push(move.note || "No immediate issue was tagged, but still compare the opponent's next forcing move.");
  } else {
    parts.push("Now check what this attacks, defends, or leaves behind.");
  }
  return parts.join(" ");
}

function renderAICoachCard(context) {
  const data = state.aiCoach.data;
  const loading = state.aiCoach.loading;
  const hasData = data && state.aiCoach.context === context;
  const progress = getPlacementProgress();

  if (!progress.complete) {
    return `
      <article class="mini-card ai-coach-card locked-card">
        <span class="label">Personal coach</span>
        <strong>Locked during placement</strong>
        <p>Complete ${progress.remaining} more game${progress.remaining === 1 ? "" : "s"} first. Until then the app records results, mistakes, openings, and practice outcomes so the coach has enough personal evidence to work from.</p>
      </article>
    `;
  }

  if (loading) {
    return `
      <article class="mini-card ai-coach-card">
        <strong>Personal coach</strong>
        <p>Reading your current position, recent games, weaknesses, and practice history...</p>
      </article>
    `;
  }

  if (state.aiCoach.error) {
    return `
      <article class="mini-card ai-coach-card">
        <strong>Personal coach</strong>
        <p>${escapeHtml(state.aiCoach.error)}</p>
        <button id="askAICoachButton" type="button">Try again</button>
      </article>
    `;
  }

  if (!hasData) {
    return `
      <article class="mini-card ai-coach-card">
        <strong>Personal coach</strong>
        <p>${state.openAI.configured ? "Use OpenAI to tailor this advice to your actual games, mistakes, openings, and practice history." : "Connect an OpenAI key in .env and restart the Node server to unlock personalized coaching."}</p>
        <button id="askAICoachButton" type="button">${state.openAI.configured ? "Ask personal coach" : "Check coach setup"}</button>
      </article>
    `;
  }

  const candidateRows = (data.candidate_explanations || []).map((item) => `
    <div class="candidate-row">
      <strong>${escapeHtml(item.move || "Move")}</strong>
      <span>${escapeHtml(item.reason || "")}</span>
    </div>
  `).join("");
  const practiceRows = (data.practice_recommendations || []).map((item) => `<span class="candidate">${escapeHtml(item)}</span>`).join("");

  return `
    <article class="mini-card ai-coach-card">
      <span class="label">Personal coach${state.openAI.model ? ` - ${escapeHtml(state.openAI.model)}` : ""}</span>
      <strong>${escapeHtml(data.summary || "Personalized read")}</strong>
      <p>${escapeHtml(data.plan || "")}</p>
      ${candidateRows ? `<div class="candidate-list coach-candidates">${candidateRows}</div>` : ""}
      ${data.weakness_focus ? `<p><strong>Focus:</strong> ${escapeHtml(data.weakness_focus)}</p>` : ""}
      ${practiceRows ? `<div class="tag-list">${practiceRows}</div>` : ""}
      <button id="askAICoachButton" type="button">Refresh personal coach</button>
    </article>
  `;
}

function bindAICoachButton(context) {
  document.querySelector("#askAICoachButton")?.addEventListener("click", () => requestAICoach(context));
}

function formatPlanList(plans) {
  return plans.map((plan) => plan.endsWith(".") ? plan : `${plan}.`).join(" ");
}

function explainCandidateMove(fen, candidate) {
  try {
    const game = new Chess(fen);
    const verbose = game.moves({ verbose: true }).find((move) => (
      move.from === candidate.from &&
      move.to === candidate.to &&
      (move.promotion || "") === (candidate.promotion || "")
    ));
    if (!verbose) return "Compare this move because it appears in the current candidate list.";

    const clone = new Chess(fen);
    clone.move({ from: verbose.from, to: verbose.to, promotion: verbose.promotion || "q" });
    const phase = getPhase(game);
    const reasons = [];

    if (clone.isCheckmate()) reasons.push("It gives checkmate.");
    else if (clone.isCheck()) reasons.push("It gives check and forces a response.");

    if (verbose.captured) {
      const gain = (PIECE_VALUES[verbose.captured] || 0) - (PIECE_VALUES[verbose.piece] || 0);
      reasons.push(gain >= 0 ? `It wins or contests a ${pieceName(verbose.captured)}.` : `It starts a forcing trade, so calculate the recapture.`);
    }

    if (verbose.san.includes("O-O")) {
      reasons.push("It improves king safety and connects the rooks.");
    }

    if (phase === "opening" && ["n", "b"].includes(verbose.piece)) {
      reasons.push("It develops a minor piece toward useful squares.");
    }

    if (phase === "opening" && isCenterSquare(verbose.to)) {
      reasons.push("It fights for the center.");
    }

    if (!reasons.length && createsImmediateThreat(clone, verbose.color)) {
      reasons.push("It creates a concrete threat for the next move.");
    }

    if (!reasons.length) {
      reasons.push("It improves the position without an obvious material concession.");
    }

    if (isMoveHanging(clone, verbose.color, verbose.to) && PIECE_VALUES[verbose.piece] >= 3) {
      reasons.push("Before playing it, confirm the piece is not left loose.");
    }

    return reasons.slice(0, 2).join(" ");
  } catch {
    return "Use this as a candidate, then check what your opponent can force in reply.";
  }
}

function explainCandidateByUci(fen, candidate) {
  if (!candidate.uci) return "Use this move as a comparison point.";
  return explainCandidateMove(fen, {
    from: candidate.uci.slice(0, 2),
    to: candidate.uci.slice(2, 4),
    promotion: candidate.uci[4] || "",
    san: candidate.san,
  });
}

function uciToSan(fen, uci) {
  try {
    const game = new Chess(fen);
    const move = game.move(moveFromUci(uci));
    return move?.san || null;
  } catch {
    return null;
  }
}

function buildPracticePrompt(item) {
  const guide = LESSON_GUIDES[item.category] || LESSON_GUIDES.candidate_moves;
  if (item.playedMove) {
    return `This came from your move ${item.playedMove}. ${item.note || ""} ${guide.drill}`;
  }
  return `${item.prompt} ${guide.drill}`;
}

function buildPersonalLessonGuide(lesson) {
  if (!lesson) return LESSON_GUIDES.candidate_moves;

  const guide = LESSON_GUIDES[lesson.category] || LESSON_GUIDES.candidate_moves;
  const weakness = state.profile[lesson.category];
  const latestExample = weakness?.examples?.[0];
  const opening = detectOpening();
  const candidates = rankCandidateMoves(state.game.fen()).slice(0, 2).map((move) => move.san);

  if (weakness?.count) {
    return {
      why: `${lesson.title} is showing up in your games ${weakness.count} time${weakness.count === 1 ? "" : "s"}. Most recent note: ${weakness.lastNote || latestExample?.note || guide.why}`,
      lookFor: [
        ...guide.lookFor.slice(0, 2),
        latestExample?.san ? `Review your ${latestExample.san} decision` : `Compare ${candidates.join(" and ") || "candidate moves"}`,
      ],
      drill: latestExample?.san
        ? `Replay the position before ${latestExample.san}. Before moving, say what your opponent threatens and why your candidate fixes or improves it.`
        : guide.drill,
    };
  }

  return {
    why: `${lesson.title} has not become a recurring weakness yet. In your current ${opening.name} position, use it as a thinking checkpoint before you move.`,
    lookFor: candidates.length
      ? [`Compare ${candidates[0]}`, candidates[1] ? `Compare ${candidates[1]}` : "Find one quiet improving move", ...guide.lookFor.slice(0, 1)]
      : guide.lookFor,
    drill: `From the current board, choose a move and explain which ${lesson.concepts[0] || "idea"} it improves. ${guide.drill}`,
  };
}

function getCategoryPriority(category) {
  const weakness = state.profile[category];
  const weaknessScore = weakness ? weakness.count * weakness.severity * 20 : 0;
  const recentMistakeScore = state.moves
    .slice(-16)
    .filter((move) => move.role === "player" && move.tags?.some((tag) => tag.category === category))
    .length * 18;
  const queuedScore = state.practiceQueue.filter((item) => item.category === category).length * 12;
  const missedScore = state.practiceHistory.filter((item) => item.category === category && item.result === "missed").length * 14;
  const solvedScore = state.practiceHistory.filter((item) => item.category === category && item.result === "solved").length * 8;
  return Math.max(0, weaknessScore + recentMistakeScore + queuedScore + missedScore - solvedScore);
}

function getPriorityReason(category) {
  const weakness = state.profile[category];
  const missed = state.practiceHistory.filter((item) => item.category === category && item.result === "missed").length;
  const queued = state.practiceQueue.filter((item) => item.category === category).length;

  if (weakness?.count) {
    return `${weakness.label} has appeared ${weakness.count} time${weakness.count === 1 ? "" : "s"} in your games.`;
  }

  if (missed) {
    return `You missed ${missed} recent drill${missed === 1 ? "" : "s"} in this area.`;
  }

  if (queued) {
    return `${queued} practice position${queued === 1 ? "" : "s"} are waiting from your games.`;
  }

  return "Foundation skill: keep it warm even when it is not your top weakness.";
}

function prioritizeLessons() {
  return STARTER_LESSONS
    .map((lesson) => ({
      ...lesson,
      priority: getCategoryPriority(lesson.category),
      reason: getPriorityReason(lesson.category),
    }))
    .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
}

function prioritizeTrainingModules() {
  return TRAINING_MODULES
    .map((module) => ({
      ...module,
      priority: getCategoryPriority(module.category),
      reason: getPriorityReason(module.category),
    }))
    .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));
}

function getNextTrainingFocus() {
  const lessons = prioritizeLessons();
  const top = lessons[0];
  if (!top) return null;
  return {
    category: top.category,
    title: top.title,
    priority: top.priority,
    reason: top.reason,
  };
}

function normalizePlacementState() {
  state.placement = {
    ...DEFAULT_PLACEMENT,
    ...state.placement,
    games: Array.isArray(state.placement?.games) ? state.placement.games : [],
    completedGameIds: Array.isArray(state.placement?.completedGameIds) ? state.placement.completedGameIds : [],
  };
}

function getCompletedGames() {
  return state.localGames.filter((game) => (
    game.result &&
    game.result !== "in_progress" &&
    Array.isArray(game.moves) &&
    game.moves.some((move) => move.role === "player")
  ));
}

function getPlayerResultScore(result, playerColor) {
  if (!result || result === "in_progress") return 0.5;
  if (result.startsWith("Draw")) return 0.5;
  if (!result.includes("wins")) return 0.5;
  return result.includes(`${colorName(playerColor)} wins`) ? 1 : 0;
}

function summarizeMistakes(moves = []) {
  const playerMoves = moves.filter((move) => move.role === "player");
  const mistakeTags = playerMoves.flatMap((move) => move.tags || []);
  const severityTotal = mistakeTags.reduce((sum, tag) => sum + (tag.severity || 0), 0);
  return {
    playerMoveCount: playerMoves.length,
    mistakeCount: mistakeTags.length,
    severeMistakes: mistakeTags.filter((tag) => (tag.severity || 0) >= 3).length,
    averageMistakeSeverity: playerMoves.length ? severityTotal / playerMoves.length : 0,
  };
}

function summarizeGameForPlacement(gameRecord) {
  const mistakes = summarizeMistakes(gameRecord.moves || []);
  return {
    gameId: gameRecord.id,
    completedAt: gameRecord.updatedAt || new Date().toISOString(),
    result: gameRecord.result || "Game complete",
    playerColor: gameRecord.playerColor || state.settings.playerColor,
    playerScore: getPlayerResultScore(gameRecord.result, gameRecord.playerColor || state.settings.playerColor),
    engineDepth: Number(gameRecord.engineLevel || state.settings.engineDepth || 5),
    openingName: gameRecord.openingName || "Unknown opening",
    ...mistakes,
  };
}

function getPlacementGames() {
  normalizePlacementState();
  const stored = state.placement.games.slice(0, PLACEMENT_TARGET_GAMES);
  const storedIds = new Set(stored.map((game) => game.gameId));
  const derived = getCompletedGames()
    .filter((game) => !storedIds.has(game.id))
    .map(summarizeGameForPlacement)
    .slice(0, Math.max(0, PLACEMENT_TARGET_GAMES - stored.length));
  return [...stored, ...derived].slice(0, PLACEMENT_TARGET_GAMES);
}

function getPlacementCompletedCount() {
  return Math.min(PLACEMENT_TARGET_GAMES, getPlacementGames().length);
}

function isPlacementComplete() {
  return getPlacementCompletedCount() >= PLACEMENT_TARGET_GAMES;
}

function getPlacementProgress() {
  const completed = getPlacementCompletedCount();
  return {
    completed,
    target: PLACEMENT_TARGET_GAMES,
    remaining: Math.max(0, PLACEMENT_TARGET_GAMES - completed),
    complete: completed >= PLACEMENT_TARGET_GAMES,
  };
}

function estimateTrainingScoreFromGames(games) {
  if (!games.length) return null;
  const total = games.reduce((sum, game) => {
    const depth = Number(game.engineDepth || 5);
    const mistakePenalty = (game.averageMistakeSeverity || 0) * 12 + (game.severeMistakes || 0) * 25;
    return sum + 550 + depth * 70 + (game.playerScore || 0) * 260 - mistakePenalty;
  }, 0);
  return clamp(Math.round(total / games.length), 400, 1800);
}

function getEstimatedTrainingScore() {
  const placementScore = Number(state.placement?.estimatedScore);
  if (placementScore) return placementScore;
  return estimateTrainingScoreFromGames(getPlacementGames()) || estimateTrainingScoreFromGames(getCompletedGames().map(summarizeGameForPlacement));
}

function getAdaptiveBotDepth() {
  const score = getEstimatedTrainingScore() || 900;
  let depth = 3;
  if (score >= 700) depth = 4;
  if (score >= 900) depth = 5;
  if (score >= 1100) depth = 6;
  if (score >= 1300) depth = 8;
  if (score >= 1500) depth = 10;

  const recent = getCompletedGames().slice(0, 3).map((game) => getPlayerResultScore(game.result, game.playerColor));
  if (recent.length >= 2) {
    const average = recent.reduce((sum, value) => sum + value, 0) / recent.length;
    if (average >= 0.67) depth += 1;
    if (average <= 0.25) depth -= 1;
  }

  return clamp(depth, 2, 12);
}

function getCurrentBotDepth() {
  if (!isPlacementComplete()) {
    return PLACEMENT_DEPTHS[Math.min(getPlacementCompletedCount(), PLACEMENT_DEPTHS.length - 1)];
  }
  return getAdaptiveBotDepth();
}

function getOpponentStatusLabel() {
  if (state.activeDrill) return "Training board";
  const progress = getPlacementProgress();
  if (!progress.complete) {
    return `Placement opponent ${progress.completed + 1}/${progress.target}`;
  }
  return "Adaptive opponent";
}

function recordCompletedGameForPlacement(result) {
  normalizePlacementState();
  if (state.placement.completedGameIds.includes(state.currentGameId)) return;

  const current = state.localGames.find((game) => game.id === state.currentGameId);
  if (!current) return;

  const summary = summarizeGameForPlacement({ ...current, result });
  state.placement.completedGameIds = [...new Set([...state.placement.completedGameIds, state.currentGameId])];

  if (state.placement.games.length < PLACEMENT_TARGET_GAMES) {
    state.placement.games = [...state.placement.games, summary].slice(0, PLACEMENT_TARGET_GAMES);
  }

  state.placement.estimatedScore = estimateTrainingScoreFromGames(getPlacementGames());
  if (isPlacementComplete() && !state.placement.completedAt) {
    state.placement.completedAt = new Date().toISOString();
  }
  saveJson(STORAGE_KEYS.placement, state.placement);
}

function getProfileSummary() {
  const games = getCompletedGames().length;
  const solved = state.practiceHistory.filter((item) => item.result === "solved").length;
  const missed = state.practiceHistory.filter((item) => item.result === "missed").length;
  const weaknessPenalty = Object.values(state.profile).reduce((sum, item) => sum + item.count * item.severity * 8, 0);
  const placementScore = getEstimatedTrainingScore();
  const score = Math.round(clamp((placementScore || 900) + solved * 10 - missed * 5 - weaknessPenalty, 400, 1800));
  const strengths = STARTER_LESSONS
    .filter((lesson) => !state.profile[lesson.category] || state.profile[lesson.category].count <= 1)
    .slice(0, 3)
    .map((lesson) => ({
      title: lesson.title,
      note: state.profile[lesson.category]
        ? "Only one recent issue tagged here."
        : "No recurring issue tagged here yet.",
      score: state.profile[lesson.category] ? "OK" : "Clean",
    }));

  return {
    score,
    games,
    solved,
    placement: getPlacementProgress(),
    strengths,
  };
}

function addPracticeFromLesson(lessonId) {
  const lesson = STARTER_LESSONS.find((item) => item.id === lessonId);
  if (!lesson) return;

  const candidates = rankCandidateMoves(state.game.fen()).slice(0, 3).map((candidate) => ({
    san: candidate.san,
    uci: `${candidate.from}${candidate.to}${candidate.promotion || ""}`,
  }));

  const guide = LESSON_GUIDES[lesson.category] || LESSON_GUIDES.candidate_moves;
  const item = {
    id: crypto.randomUUID(),
    sourceKey: `${state.game.fen()}|lesson|${lesson.id}`,
    gameId: state.currentGameId,
    moveId: null,
    fen: state.game.fen(),
    title: lesson.title,
    category: lesson.category,
    prompt: guide.drill,
    candidates,
    createdAt: new Date().toISOString(),
  };

  const exists = state.practiceQueue.some((entry) => entry.sourceKey === item.sourceKey);
  state.practiceQueue = exists
    ? state.practiceQueue
    : [item, ...state.practiceQueue].slice(0, 50);
  saveJson(STORAGE_KEYS.practice, state.practiceQueue);
  switchTab("practice");
}

async function checkOpenAIHealth(options = {}) {
  state.openAI.status = "Checking OpenAI coach...";
  state.openAI.online = false;
  if (options.render !== false) renderAll();

  try {
    const response = await fetch("/api/health?check=1");
    if (!response.ok) throw new Error("Coach server is not responding.");
    const data = await response.json();
    state.openAI.configured = Boolean(data.openaiConfigured);
    state.openAI.model = data.model || "";
    state.openAI.online = Boolean(data.openaiOnline);
    state.openAI.status = state.openAI.online
      ? "OpenAI coach online"
      : state.openAI.configured
        ? data.openaiError || "OpenAI coach is configured, but the API is not reachable."
        : "Missing OPENAI_API_KEY";
  } catch (error) {
    state.openAI.configured = false;
    state.openAI.online = false;
    state.openAI.model = "";
    state.openAI.status = error.message || "Start the Node server with npm start.";
  }

  if (options.render !== false) {
    renderAll();
  }

  return isOpenAIReady();
}

async function verifyRequiredServices() {
  state.supabaseHealth = "Testing Supabase connection...";
  state.openAI.status = "Checking OpenAI coach...";
  state.openAI.online = false;
  renderAll();

  const [supabaseReady, openAIReady] = await Promise.all([
    verifySupabaseConnection({ syncStart: true, render: false }),
    checkOpenAIHealth({ render: false }),
  ]);

  renderAll();
  if (supabaseReady && openAIReady && !state.game.isGameOver() && state.game.turn() !== state.settings.playerColor) {
    maybeEngineMove();
  }
  return supabaseReady && openAIReady;
}

async function requestAICoach(context) {
  if (!isPlacementComplete()) {
    state.aiCoach = {
      loading: false,
      error: "",
      data: null,
      context,
    };
    renderCoachPanel();
    return;
  }

  state.aiCoach = {
    loading: true,
    error: "",
    data: null,
    context,
  };
  renderCoachPanel();

  try {
    const response = await fetch("/api/coach", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildCoachContext(context)),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Personal coach request failed.");

    state.openAI.configured = Boolean(data.configured);
    if (!data.configured) {
      state.openAI.status = "Missing OPENAI_API_KEY";
    }
    state.aiCoach = {
      loading: false,
      error: "",
      data,
      context,
    };
  } catch (error) {
    state.aiCoach = {
      loading: false,
      error: error.message || "Personal coach request failed.",
      data: null,
      context,
    };
  }

  renderCoachPanel();
}

function buildCoachContext(context) {
  const opening = detectOpening();
  const candidates = rankCandidateMoves(state.game.fen()).slice(0, 6).map((move) => ({
    san: move.san,
    uci: `${move.from}${move.to}${move.promotion || ""}`,
    reason: explainCandidateMove(state.game.fen(), move),
    score: Number(move.score.toFixed(2)),
  }));
  const lastPlayerMove = [...state.moves].reverse().find((move) => move.role === "player") || null;
  const selectedLesson = STARTER_LESSONS.find((lesson) => lesson.id === state.selectedLessonId) || null;
  const profileSummary = getProfileSummary();

  return {
    context,
    currentPosition: {
      fen: state.game.fen(),
      pgn: state.game.pgn(),
      sideToMove: colorName(state.game.turn()),
      phase: getPhase(state.game),
      result: getResultLabel(),
      playerColor: colorName(state.settings.playerColor),
      botDepth: getCurrentBotDepth(),
      botMode: isPlacementComplete() ? "adaptive" : "placement",
      opening: {
        name: opening.name,
        plans: opening.plans,
      },
    },
    candidateMoves: candidates,
    recentMoves: state.moves.slice(-12).map((move) => ({
      ply: move.ply,
      role: move.role,
      color: colorName(move.color),
      san: move.san,
      classification: move.classification,
      note: move.note,
      tags: move.tags,
      quality: move.qualityLabel || "",
      qualityReason: move.qualityReason || "",
      analysisStatus: move.analysisStatus,
      evalDelta: move.evalDelta,
      evalBefore: move.evalBefore,
      evalAfter: move.evalAfter,
      mateBefore: move.mateBefore,
      mateAfter: move.mateAfter,
      bestMove: move.bestMoveSan || move.bestMoveUci || "",
      principalVariation: move.principalVariation || [],
    })),
    lastPlayerMove,
    placement: {
      progress: getPlacementProgress(),
      games: getPlacementGames(),
      estimatedScore: getEstimatedTrainingScore(),
      currentBotDepth: getCurrentBotDepth(),
    },
    weaknessProfile: Object.values(state.profile).sort((a, b) => b.count * b.severity - a.count * a.severity).slice(0, 8),
    profileSummary,
    practiceQueue: state.practiceQueue.slice(0, 8).map((item) => ({
      title: item.title,
      category: item.category,
      prompt: item.prompt,
      note: item.note,
      playedMove: item.playedMove,
    })),
    practiceHistory: state.practiceHistory.slice(0, 12).map((item) => ({
      title: item.title,
      category: item.category,
      result: item.result,
      attemptedAt: item.attemptedAt,
    })),
    selectedLesson,
    activeDrill: state.activeDrill ? {
      title: state.activeDrill.title,
      type: state.activeDrill.type,
      objective: state.activeDrill.objective,
      message: state.drillMessage,
    } : null,
    availablePracticeModules: TRAINING_MODULES.map((module) => ({
      id: module.id,
      title: module.title,
      type: module.type,
      category: module.category,
      objective: module.objective,
    })),
  };
}

function renderReviewPanel() {
  if (!state.moves.length) {
    els.reviewPanel.innerHTML = `
      <h2>Review</h2>
      <p class="empty-state">No moves yet. Play a game to review it here.</p>
    `;
    return;
  }

  const selectedMove = state.reviewPly != null
    ? state.moves.find((move) => move.ply === state.reviewPly)
    : state.moves[state.moves.length - 1];
  const boardFen = selectedMove ? selectedMove.afterFen : state.game.fen();
  const turningPoints = getReviewTurningPoints();
  const analysisCard = renderSelectedMoveAnalysis(selectedMove);

  const rows = state.moves.map((move) => {
    const isSelected = selectedMove && move.ply === selectedMove.ply;
    const evalText = formatEvalDelta(move);
    const quality = getMoveQuality(move);
    const tagPills = (move.tags || []).map((tag) =>
      `<span class="tag ${reviewTagClass(tag.severity)}">${escapeHtml(tag.label)}</span>`
    ).join("");
    const classText = quality ? quality.label : prettyClassification(move.classification);
    const className = quality ? `quality-pill ${qualityClassName(quality.key)}` : reviewClassClass(move.classification);
    return `
      <div class="move-row ${isSelected ? "selected" : ""}" role="button" tabindex="0" data-ply="${move.ply}">
        <div class="move-meta">
          <span class="move-ply">${move.ply}.</span>
          ${quality ? renderQualityBadgeHtml(move, "row-quality-badge") : ""}
          <span class="move-san">${escapeHtml(move.san)}</span>
          <span class="move-class ${className}">${escapeHtml(classText)}</span>
          ${evalText ? `<span class="move-eval">${evalText}</span>` : ""}
        </div>
        ${move.note ? `<div class="move-note">${escapeHtml(move.note)}</div>` : ""}
        ${tagPills ? `<div class="tag-list">${tagPills}</div>` : ""}
      </div>
    `;
  }).join("");

  const turningPointHtml = turningPoints.length ? `
    <article class="mini-card">
      <strong>Turning points</strong>
      <p>Your biggest centipawn drops this game.</p>
      <div class="candidate-list">
        ${turningPoints.map((point) => `
          <button type="button" class="candidate turning-point" data-ply="${point.ply}">
            ${point.ply}. ${escapeHtml(point.san)} <span class="move-eval">-${point.evalDelta}cp</span>
          </button>
        `).join("")}
      </div>
    </article>
  ` : "";

  const boardCard = renderReviewBoardCard(selectedMove, boardFen);

  els.reviewPanel.innerHTML = `
    <h2>Review</h2>
    <div class="stack">
      ${boardCard}
      ${analysisCard}
      ${turningPointHtml}
      <div class="move-list">${rows}</div>
    </div>
  `;

  els.reviewPanel.querySelectorAll(".move-row[data-ply]").forEach((row) => {
    row.addEventListener("click", () => {
      const ply = Number(row.dataset.ply);
      state.reviewPly = state.reviewPly === ply ? null : ply;
      renderReviewPanel();
    });
  });
  els.reviewPanel.querySelectorAll(".turning-point[data-ply]").forEach((button) => {
    button.addEventListener("click", () => {
      state.reviewPly = Number(button.dataset.ply);
      renderReviewPanel();
    });
  });
}

function renderReviewBoardCard(move, boardFen) {
  if (!move) return "";

  const quality = getMoveQuality(move);
  const playedHighlights = buildMoveHighlights(move.uci, "played", quality?.key);
  const bestHighlights = buildMoveHighlights(move.bestMoveUci, "best");
  const showBestBoard = move.role === "player" && move.bestMoveUci && move.bestMoveUci !== move.uci;

  return `
    <article class="mini-card review-board-card">
      <span class="label">Move view${quality ? ` · ${escapeHtml(quality.label)}` : move.evalDelta ? ` · -${move.evalDelta}cp` : ""}</span>
      <div class="review-board-grid">
        <div class="review-board-panel">
          <span class="label">Played ${escapeHtml(move.ply)}. ${escapeHtml(move.san)}</span>
          ${renderMiniBoard(boardFen, playedHighlights)}
        </div>
        ${showBestBoard ? `
          <div class="review-board-panel">
            <span class="label">Best ${escapeHtml(move.bestMoveSan || move.bestMoveUci)}</span>
            ${renderMiniBoard(move.beforeFen, bestHighlights)}
          </div>
        ` : ""}
      </div>
    </article>
  `;
}

function buildMoveHighlights(uci, type, qualityKey = "") {
  if (!uci || uci.length < 4) return {};
  return {
    [uci.slice(0, 2)]: { className: `${type}-from` },
    [uci.slice(2, 4)]: { className: `${type}-to`, qualityKey },
  };
}

function renderSelectedMoveAnalysis(move) {
  if (!move || move.role !== "player") return "";
  const quality = getMoveQuality(move);

  if (move.analysisStatus === "pending") {
    return `
      <article class="mini-card">
        <span class="label">Engine analysis</span>
        <strong>Analysis pending</strong>
        <p>Stockfish is evaluating the position before and after this move.</p>
      </article>
    `;
  }

  const hasAnalysis = move.analysisStatus === "complete" || typeof move.evalDelta === "number" || move.bestMoveUci;
  if (!hasAnalysis) {
    return `
      <article class="mini-card">
        <span class="label">${quality ? "Move quality" : "Engine analysis"}</span>
        <strong>${quality ? escapeHtml(quality.label) : "Unavailable"}</strong>
        <p>${escapeHtml(quality?.reason || "Stockfish was not available for this move, so the review is using heuristic tags only.")}</p>
      </article>
    `;
  }

  const bestMove = move.bestMoveSan || move.bestMoveUci || "No best move returned";
  const bestText = !move.bestMoveUci
    ? "Stockfish did not return a best alternative for this move."
    : move.bestMoveUci === move.uci
      ? `Stockfish also preferred ${bestMove}.`
      : `Stockfish preferred ${bestMove} over ${move.san}.`;
  const pv = formatPrincipalVariation(move.beforeFen, move.principalVariation || []);

  return `
    <article class="mini-card">
      <span class="label">Engine analysis${move.engineSource ? ` · ${escapeHtml(move.engineSource)}` : ""}${move.engineDepth ? ` · depth ${move.engineDepth}` : ""}</span>
      <strong>${quality ? escapeHtml(quality.label) : formatEvalDelta(move) || "No centipawn loss"}</strong>
      <p>${escapeHtml(quality ? `${quality.reason} ${bestText}` : bestText)}</p>
      <div class="candidate-list">
        <span class="candidate">Before ${escapeHtml(formatEngineScore(move.evalBefore, move.mateBefore))}</span>
        <span class="candidate">After ${escapeHtml(formatEngineScore(move.evalAfter, move.mateAfter))}</span>
      </div>
      ${pv ? `
        <div class="candidate-list coach-candidates">
          <div class="candidate-row">
            <strong>PV</strong>
            <span>${escapeHtml(pv)}</span>
          </div>
        </div>
      ` : ""}
    </article>
  `;
}

function formatEngineScore(scoreCp, mate) {
  if (typeof mate === "number") return mate > 0 ? `M${mate}` : `-M${Math.abs(mate)}`;
  if (typeof scoreCp === "number") return `${scoreCp > 0 ? "+" : ""}${scoreCp}cp`;
  return "n/a";
}

function formatPrincipalVariation(fen, pv) {
  if (!Array.isArray(pv) || !pv.length) return "";
  try {
    const game = new Chess(fen);
    const sans = [];
    for (const uci of pv.slice(0, 6)) {
      const move = game.move(moveFromUci(uci));
      if (!move) break;
      sans.push(move.san);
    }
    return sans.join(" ");
  } catch {
    return pv.slice(0, 6).join(" ");
  }
}

function getReviewTurningPoints() {
  return state.moves
    .filter((move) => move.role === "player" && typeof move.evalDelta === "number" && move.evalDelta >= 100)
    .slice()
    .sort((a, b) => b.evalDelta - a.evalDelta)
    .slice(0, 3)
    .sort((a, b) => a.ply - b.ply);
}

function formatEvalDelta(move) {
  if (typeof move.evalDelta !== "number" || move.evalDelta < 50) return "";
  return `-${move.evalDelta}cp`;
}

function reviewClassClass(classification) {
  if (classification === "blunder") return "class-blunder";
  if (classification === "mistake") return "class-mistake";
  if (classification === "inaccuracy") return "class-inaccuracy";
  return "class-neutral";
}

function reviewTagClass(severity) {
  if (severity >= 3) return "danger";
  if (severity >= 2) return "warn";
  return "";
}

function prettyClassification(classification) {
  if (!classification || classification === "neutral") return "OK";
  return classification[0].toUpperCase() + classification.slice(1);
}

function renderMiniBoard(fen, highlights = {}) {
  const piecesField = fen.split(" ")[0];
  const ranks = piecesField.split("/");
  let html = '<div class="mini-board">';
  for (let rank = 0; rank < 8; rank++) {
    let file = 0;
    for (const ch of ranks[rank]) {
      if (/[1-8]/.test(ch)) {
        const skip = Number(ch);
        for (let k = 0; k < skip; k++) {
          const dark = (rank + file) % 2 === 1;
          const square = `${FILES[file]}${8 - rank}`;
          html += renderMiniSquare(square, dark, "", "", highlights);
          file++;
        }
      } else {
        const color = ch === ch.toUpperCase() ? "w" : "b";
        const dark = (rank + file) % 2 === 1;
        const square = `${FILES[file]}${8 - rank}`;
        const glyph = PIECES[color + ch.toLowerCase()] || "";
        html += renderMiniSquare(square, dark, glyph, color, highlights);
        file++;
      }
    }
  }
  html += "</div>";
  return html;
}

function renderMiniSquare(square, dark, glyph, color, highlights) {
  const highlight = highlights[square] || {};
  const highlightClass = typeof highlight === "string" ? highlight : highlight.className || "";
  const qualityKey = typeof highlight === "string" ? "" : highlight.qualityKey || "";
  const quality = qualityKey ? MOVE_QUALITIES[qualityKey] || MOVE_QUALITIES.good : null;
  const markerText = quality?.symbol || (highlightClass.endsWith("-to") ? (highlightClass.startsWith("best") ? "B" : "P") : "");
  const marker = markerText ? `<span class="mini-marker ${quality ? qualityClassName(qualityKey) : ""}">${escapeHtml(markerText)}</span>` : "";
  return `
    <div class="mini-sq ${dark ? "dark" : "light"} ${highlightClass} ${quality ? qualityClassName(qualityKey) : ""}">
      ${glyph ? `<span class="mini-piece piece ${color}">${glyph}</span>` : ""}
      ${marker}
    </div>
  `;
}

function getPracticeMotifGuide(category) {
  const aliases = {
    hanging_piece: "missed_capture",
    poor_trade: "missed_capture",
    candidate_moves: "missed_mate",
    opening_principle: "king_safety",
  };
  return PRACTICE_MOTIFS[category] || PRACTICE_MOTIFS[aliases[category]] || {
    term: "candidate move",
    definition: "A candidate move is a move worth calculating before you decide.",
    plainGoal: "Find the most forcing useful move in the position.",
    scan: "Check checks, captures, threats, and the opponent's threat before choosing.",
  };
}

function getPracticeCategoryPriority(category) {
  const related = {
    missed_capture: ["missed_capture", "hanging_piece", "poor_trade"],
    missed_mate: ["missed_mate", "candidate_moves"],
    missed_fork: ["missed_fork", "candidate_moves"],
    missed_pin: ["missed_pin", "missed_line_tactic"],
    missed_skewer: ["missed_skewer", "missed_line_tactic"],
    discovered_attack: ["discovered_attack", "candidate_moves"],
    king_safety: ["king_safety", "opening_principle"],
  }[category] || [category];

  return Math.max(0, ...related.map((item) => getCategoryPriority(item)));
}

function getPracticeSourceKey(puzzle) {
  if (!puzzle) return "";
  return puzzle.sourceKey || `practice:${puzzle.id}`;
}

function normalizePracticePuzzle(puzzle) {
  if (!puzzle?.fen || !Array.isArray(puzzle.expectedMoves) || !puzzle.expectedMoves.length) return null;
  const guide = getPracticeMotifGuide(puzzle.category);
  return {
    ...puzzle,
    isPracticeTrainer: true,
    source: puzzle.source || "curated",
    sourceKey: getPracticeSourceKey(puzzle),
    type: puzzle.type || "Practice puzzle",
    term: puzzle.term || guide.term,
    definition: puzzle.definition || guide.definition,
    plainGoal: puzzle.plainGoal || guide.plainGoal,
    scan: puzzle.scan || guide.scan,
    objective: puzzle.plainGoal || guide.plainGoal,
    hintSteps: Array.isArray(puzzle.hintSteps) && puzzle.hintSteps.length
      ? puzzle.hintSteps
      : [guide.scan],
    targetSquares: Array.isArray(puzzle.targetSquares) ? puzzle.targetSquares : [],
    hintSquares: Array.isArray(puzzle.hintSquares) ? puzzle.hintSquares : [],
    expectedMoves: puzzle.expectedMoves.filter(Boolean),
  };
}

function practiceItemToPuzzle(item) {
  if (!item?.fen) return null;
  const candidates = (item.candidates || []).filter((candidate) => candidate.uci);
  if (!candidates.length) return null;

  const guide = getPracticeMotifGuide(item.category);
  const turn = item.fen.split(" ")[1] || state.settings.playerColor;
  const bestCandidate = candidates[0];
  return normalizePracticePuzzle({
    id: `queue-${item.id}`,
    source: "personal",
    sourceKey: item.sourceKey,
    queueItemId: item.id,
    category: item.category,
    plainTitle: plainPracticeTitleForCategory(item.category),
    title: item.title || guide.term,
    difficulty: 2,
    playerColor: turn,
    fen: item.fen,
    expectedMoves: candidates.map((candidate) => candidate.uci),
    targetSquares: candidates.map((candidate) => candidate.uci.slice(2, 4)).filter(Boolean),
    hintSquares: bestCandidate?.uci ? [bestCandidate.uci.slice(0, 2), bestCandidate.uci.slice(2, 4)] : [],
    plainGoal: plainPracticeGoalForItem(item),
    hintSteps: [
      item.note || guide.scan,
      bestCandidate?.san ? `Compare the candidate ${bestCandidate.san}.` : guide.scan,
      guide.definition,
    ],
    successText: "Correct. This fixes the pattern that came from your game.",
    missText: "Not yet. Compare checks, captures, and threats from this exact position.",
  });
}

function plainPracticeTitleForCategory(category) {
  return {
    missed_mate: "Trap the king",
    missed_fork: "Two targets",
    missed_pin: "Freeze a defender",
    missed_skewer: "King in front",
    missed_capture: "Win the loose piece",
    hanging_piece: "Win the loose piece",
    poor_trade: "Calculate the trade",
    discovered_attack: "Open the line",
    king_safety: "Stop the threat",
    opening_principle: "Stop the threat",
  }[category] || "Find the idea";
}

function plainPracticeGoalForItem(item) {
  const guide = getPracticeMotifGuide(item.category);
  if (item.playedMove) {
    return `This came from your move ${item.playedMove}. Find the stronger idea in the position.`;
  }
  return item.prompt || guide.plainGoal;
}

function getRecentlySolvedPracticeKeys(limit = 12) {
  return new Set(state.practiceHistory
    .filter((item) => item.result === "solved")
    .slice(0, limit)
    .map((item) => item.sourceKey)
    .filter(Boolean));
}

function selectNextPracticePuzzle(options = {}) {
  const excludeKey = options.excludeKey || getPracticeSourceKey(state.activeDrill);
  const personal = state.practiceQueue
    .map(practiceItemToPuzzle)
    .filter(Boolean)
    .sort((a, b) => getPracticeCategoryPriority(b.category) - getPracticeCategoryPriority(a.category));
  const personalPick = personal.find((puzzle) => getPracticeSourceKey(puzzle) !== excludeKey);
  if (personalPick) return personalPick;

  const solvedKeys = getRecentlySolvedPracticeKeys();
  const curated = CURATED_PRACTICE_PUZZLES
    .map(normalizePracticePuzzle)
    .filter(Boolean)
    .sort((a, b) => {
      const aSolved = solvedKeys.has(getPracticeSourceKey(a)) ? 1 : 0;
      const bSolved = solvedKeys.has(getPracticeSourceKey(b)) ? 1 : 0;
      return aSolved - bSolved
        || getPracticeCategoryPriority(b.category) - getPracticeCategoryPriority(a.category)
        || a.difficulty - b.difficulty
        || a.plainTitle.localeCompare(b.plainTitle);
    });

  return curated.find((puzzle) => getPracticeSourceKey(puzzle) !== excludeKey && !solvedKeys.has(getPracticeSourceKey(puzzle)))
    || curated.find((puzzle) => getPracticeSourceKey(puzzle) !== excludeKey)
    || curated[0]
    || null;
}

function resetPracticeTrainerState() {
  state.practiceTrainer = {
    attempts: 0,
    hintIndex: 0,
    status: "trying",
    lastMoveUci: "",
    scoreDelta: 0,
    feedback: "",
  };
}

function startPracticePuzzle(puzzle, options = {}) {
  const normalized = normalizePracticePuzzle(puzzle);
  if (!normalized) return false;

  if (!state.activeDrill && options.saveCurrent !== false) {
    saveCurrentGame();
  }

  state.activeDrill = structuredClone(normalized);
  state.activeDrill.step = 0;
  state.activeDrill.source = normalized.source;
  state.drillMessage = normalized.plainGoal;
  resetPracticeTrainerState();
  state.game = normalized.fen === "start" ? new Chess() : new Chess(normalized.fen);
  state.moves = [];
  state.selectedSquare = null;
  state.legalTargets = new Set();
  state.lastMove = null;
  state.thinking = false;
  state.reviewPly = null;

  if (options.render !== false) {
    if (options.switchTab === false) {
      renderAll();
    } else {
      switchTab("practice");
    }
  }

  return true;
}

function ensurePracticeTrainer() {
  if (!isPlacementComplete() || isPracticeTrainerDrill()) return false;
  const next = selectNextPracticePuzzle();
  return startPracticePuzzle(next, { render: false, switchTab: false });
}

function startNextPracticePuzzle() {
  const next = selectNextPracticePuzzle({ excludeKey: getPracticeSourceKey(state.activeDrill) });
  startPracticePuzzle(next, { render: true });
}

function retryPracticePuzzle() {
  if (!isPracticeTrainerDrill()) return;
  startPracticePuzzle(state.activeDrill, { render: true, saveCurrent: false });
}

function advancePracticeHint() {
  if (!isPracticeTrainerDrill()) return;
  const maxHints = state.activeDrill.hintSteps?.length || 0;
  state.practiceTrainer.hintIndex = Math.min(maxHints, state.practiceTrainer.hintIndex + 1);
  state.practiceTrainer.feedback = getCurrentPracticeHint() || state.activeDrill.scan;
  state.drillMessage = state.practiceTrainer.feedback;
  renderAll();
}

function getCurrentPracticeHint() {
  const hintIndex = state.practiceTrainer?.hintIndex || 0;
  if (!hintIndex) return "";
  return state.activeDrill?.hintSteps?.[hintIndex - 1] || "";
}

function getPracticeStats() {
  const solved = state.practiceHistory.filter((item) => item.result === "solved").length;
  const missed = state.practiceHistory.filter((item) => item.result === "missed").length;
  let streak = 0;
  for (const item of state.practiceHistory) {
    if (item.result !== "solved") break;
    streak += 1;
  }
  return {
    solved,
    missed,
    streak,
    score: Math.max(0, solved * 10 - missed * 3),
  };
}

function renderPracticeTrainer() {
  if (!isPracticeTrainerDrill()) return "";

  const puzzle = state.activeDrill;
  const trainer = state.practiceTrainer;
  const stats = getPracticeStats();
  const solved = trainer.status === "solved";
  const currentHint = getCurrentPracticeHint();
  const revealTerm = solved || trainer.hintIndex >= (puzzle.hintSteps?.length || 1);
  const feedback = trainer.feedback || state.drillMessage || puzzle.plainGoal;
  const label = puzzle.source === "personal"
    ? "Adaptive practice - from your games"
    : `Adaptive practice - difficulty ${puzzle.difficulty || 1}`;
  const heading = solved
    ? `Solved: ${puzzle.term}`
    : (puzzle.plainTitle || plainPracticeTitleForCategory(puzzle.category));
  const canHint = !solved && trainer.hintIndex < (puzzle.hintSteps?.length || 0);

  return `
    <article class="mini-card practice-trainer-card ${solved ? "solved" : trainer.status === "missed" ? "missed" : ""}">
      <span class="label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(heading)}</strong>
      <p>${escapeHtml(feedback)}</p>
      <div class="practice-trainer-stats">
        <div>
          <span class="label">Score</span>
          <strong>${stats.score}${trainer.scoreDelta ? ` ${trainer.scoreDelta > 0 ? "+" : ""}${trainer.scoreDelta}` : ""}</strong>
        </div>
        <div>
          <span class="label">Streak</span>
          <strong>${stats.streak}</strong>
        </div>
        <div>
          <span class="label">Tries</span>
          <strong>${trainer.attempts}</strong>
        </div>
      </div>
      <div class="button-row">
        ${solved ? `<button id="practiceNextButton" class="primary-action" type="button">Next puzzle</button>` : ""}
        <button id="practiceHintButton" type="button"${canHint ? "" : " disabled"}>Hint</button>
        <button id="practiceRetryButton" type="button">Retry</button>
        <button id="resumeGameButton" type="button">Resume game</button>
      </div>
    </article>
    <article class="mini-card practice-explain-card">
      <span class="label">${revealTerm ? "Pattern learned" : "How to look"}</span>
      <strong>${escapeHtml(revealTerm ? puzzle.term : "Scan the position")}</strong>
      <p>${escapeHtml(revealTerm ? `${puzzle.definition} ${puzzle.scan}` : (currentHint || puzzle.scan))}</p>
      ${solved ? `<div class="tag-list"><span class="tag good">Solved</span><span class="tag">${escapeHtml(puzzle.term)}</span></div>` : ""}
    </article>
  `;
}

function renderPracticePanel() {
  const progress = getPlacementProgress();
  if (!progress.complete) {
    els.practicePanel.innerHTML = `
      <h2>Practice</h2>
      <div class="stack">
        <article class="mini-card placement-card">
          <span class="label">Practice trainer</span>
          <strong>Unlocks after placement</strong>
          <p>Finish ${progress.remaining} more placement game${progress.remaining === 1 ? "" : "s"} to unlock adaptive mate, fork, pin, skewer, loose-piece, and defense puzzles.</p>
        </article>
      </div>
    `;
    return;
  }

  ensurePracticeTrainer();

  const queuedPractice = state.practiceQueue
    .slice(0, 4)
    .sort((a, b) => getCategoryPriority(b.category) - getCategoryPriority(a.category));
  const nextFocus = getNextTrainingFocus();
  const trainer = renderPracticeTrainer();
  const personalCards = queuedPractice.map((item) => `
    <article class="practice-card">
      <span class="label">From your games - priority ${getCategoryPriority(item.category)}</span>
      <strong>${escapeHtml(plainPracticeTitleForCategory(item.category))}</strong>
      <p>${escapeHtml(plainPracticeGoalForItem(item))}</p>
      <div class="button-row">
        <button type="button" data-practice-board="${item.id}">Practice on board</button>
      </div>
    </article>
  `).join("");
  const foundationCards = CURATED_PRACTICE_PUZZLES.map((puzzle) => `
    <button class="practice-card practice-select" type="button" data-start-puzzle="${escapeAttr(puzzle.id)}">
      <span class="label">Foundation - difficulty ${puzzle.difficulty}</span>
      <strong>${escapeHtml(puzzle.plainTitle)}</strong>
      <p>${escapeHtml(puzzle.plainGoal || getPracticeMotifGuide(puzzle.category).plainGoal)}</p>
    </button>
  `).join("");

  els.practicePanel.innerHTML = `
    <h2>Practice</h2>
    <div class="stack">
      ${trainer}
      ${nextFocus ? `
        <article class="mini-card priority-card">
          <span class="label">Priority queue</span>
          <strong>${escapeHtml(nextFocus.title)}</strong>
          <p>${escapeHtml(nextFocus.reason)}</p>
        </article>
      ` : ""}
      <h3>From Your Games</h3>
      ${personalCards || "<p class=\"empty-state\">Personal practice positions appear after the coach tags your games.</p>"}
      <h3>Foundation Skills</h3>
      <div class="lesson-grid">${foundationCards}</div>
    </div>
  `;

  document.querySelector("#practiceHintButton")?.addEventListener("click", advancePracticeHint);
  document.querySelector("#practiceRetryButton")?.addEventListener("click", retryPracticePuzzle);
  document.querySelector("#practiceNextButton")?.addEventListener("click", startNextPracticePuzzle);
  document.querySelector("#resumeGameButton")?.addEventListener("click", resumeSavedGame);
  els.practicePanel.querySelectorAll("[data-practice-board]").forEach((button) => {
    button.addEventListener("click", () => startQueuedPractice(button.dataset.practiceBoard));
  });
  els.practicePanel.querySelectorAll("[data-start-puzzle]").forEach((button) => {
    const puzzle = CURATED_PRACTICE_PUZZLES.find((item) => item.id === button.dataset.startPuzzle);
    button.addEventListener("click", () => startPracticePuzzle(puzzle, { render: true }));
  });
}

function renderProfilePanel() {
  const summary = getProfileSummary();
  const progress = getPlacementProgress();
  const weaknessRows = Object.values(state.profile)
    .sort((a, b) => b.count * b.severity - a.count * a.severity)
    .map((item) => `
      <div class="profile-row">
        <div>
          <strong>${escapeHtml(item.label)}</strong>
          <span>${escapeHtml(item.lastNote || "Tracked from your games.")}</span>
        </div>
        <div class="score">${item.count}</div>
      </div>
    `).join("");
  const strengthRows = summary.strengths.map((item) => `
    <div class="profile-row">
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.note)}</span>
      </div>
      <div class="score good-score">${escapeHtml(item.score)}</div>
    </div>
  `).join("");

  els.profilePanel.innerHTML = `
    <h2>Profile</h2>
    <div class="stack">
      <article class="profile-summary">
        <div>
          <span class="label">${progress.complete ? "Current training score" : "Placement progress"}</span>
          <strong>${progress.complete ? summary.score : `${progress.completed}/${progress.target}`}</strong>
        </div>
        <div>
          <span class="label">Games tracked</span>
          <strong>${summary.games}</strong>
        </div>
        <div>
          <span class="label">Practice solved</span>
          <strong>${summary.solved}</strong>
        </div>
      </article>
      <article class="mini-card">
        <span class="label">${progress.complete ? "Adaptive model" : "Placement model"}</span>
        <strong>${progress.complete ? "Coach is using your history" : `${progress.remaining} more game${progress.remaining === 1 ? "" : "s"} needed`}</strong>
        <p>${progress.complete
          ? `Estimated score ${summary.score}. Opponent strength adjusts from recent game results plus mistake severity.`
          : "Strengths, weaknesses, and OpenAI coach advice stay provisional until there are enough completed games to avoid guessing from one position."}</p>
      </article>
      <h3>Strengths</h3>
      ${progress.complete ? (strengthRows || "<p class=\"empty-state\">Strengths need more solved practice positions.</p>") : "<p class=\"empty-state\">Strengths unlock after placement.</p>"}
      <h3>Weaknesses</h3>
      ${progress.complete ? (weaknessRows || "<p class=\"empty-state\">No recurring weaknesses tagged yet.</p>") : "<p class=\"empty-state\">Weaknesses are being collected during placement.</p>"}
    </div>
  `;
}

function renderLessonsPanel() {
  const profileCategories = new Set(Object.keys(state.profile));
  const sorted = prioritizeLessons();
  const selectedLesson = sorted.find((lesson) => lesson.id === state.selectedLessonId) || sorted[0];
  state.selectedLessonId = selectedLesson?.id || null;
  const personalized = buildPersonalLessonGuide(selectedLesson);
  const cards = sorted.map((lesson) => {
    const recommended = profileCategories.has(lesson.category);
    return `
      <button class="lesson-card lesson-select ${lesson.id === state.selectedLessonId ? "selected" : ""}" type="button" data-lesson="${escapeAttr(lesson.id)}">
        <span class="label">${recommended ? "Recommended" : "Lesson"} - priority ${lesson.priority}</span>
        <strong>${escapeHtml(lesson.title)}</strong>
        <p>${escapeHtml(lesson.summary)}</p>
        <p>${escapeHtml(lesson.reason)}</p>
        <div class="tag-list">
          ${lesson.concepts.map((concept) => `<span class="tag ${recommended ? "warn" : ""}">${escapeHtml(concept)}</span>`).join("")}
        </div>
      </button>
    `;
  }).join("");

  els.lessonsPanel.innerHTML = `
    <h2>Lessons</h2>
    <div class="stack">
      <article class="lesson-detail">
        <span class="label">Selected lesson</span>
        <strong>${escapeHtml(selectedLesson.title)}</strong>
        <p>${escapeHtml(personalized.why)}</p>
        <div class="candidate-list">
          ${personalized.lookFor.map((item) => `<span class="candidate">${escapeHtml(item)}</span>`).join("")}
        </div>
        <p>${escapeHtml(personalized.drill)}</p>
        <button id="startLessonButton" type="button">Start interactive lesson</button>
      </article>
      <div class="lesson-grid">${cards}</div>
    </div>
  `;

  els.lessonsPanel.querySelectorAll("[data-lesson]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedLessonId = button.dataset.lesson;
      renderLessonsPanel();
    });
  });

  document.querySelector("#startLessonButton")?.addEventListener("click", () => startLesson(state.selectedLessonId));
}

function renderSettingsPanel() {
  const progress = getPlacementProgress();
  els.settingsPanel.innerHTML = `
    <h2>Settings</h2>
    <div class="settings-grid">
      ${renderRequiredServicesCard()}
      <article class="mini-card">
        <strong>Bot difficulty</strong>
        <p>${progress.complete
          ? "Adaptive mode is active. The opponent adjusts automatically from your estimated score, recent results, and mistake severity."
          : `Placement mode is active. The opponent adjusts automatically while ${progress.remaining} placement game${progress.remaining === 1 ? "" : "s"} remain.`}</p>
      </article>
      <article class="mini-card">
        <strong>OpenAI personal coach</strong>
        <p>${isOpenAIReady() ? `Online through the local server${state.openAI.model ? ` using ${escapeHtml(state.openAI.model)}` : ""}.` : escapeHtml(state.openAI.status || "Not connected. Add OPENAI_API_KEY to .env, then restart the Node server.")}</p>
        <button id="testOpenAIButton" type="button">Test OpenAI coach</button>
      </article>
      <article class="mini-card">
        <strong>Supabase sync</strong>
        <p class="sync-status-row"><span class="label">Storage</span> ${escapeHtml(getStorageStatusLabel())}</p>
        <p>${state.supabaseReachable ? "Connected. Games, moves, practice, and profile events can sync." : "Required. The app stays locked until Supabase is reachable and writable."}</p>
        ${state.supabaseHealth ? `<p>${escapeHtml(state.supabaseHealth)}</p>` : ""}
      </article>
      <label class="field">
        <span>Player color</span>
        <select id="playerColorInput">
          <option value="w"${state.settings.playerColor === "w" ? " selected" : ""}>White</option>
          <option value="b"${state.settings.playerColor === "b" ? " selected" : ""}>Black</option>
        </select>
      </label>
      <label class="field">
        <span>Coach mode</span>
        <select id="coachModeInput">
          <option value="hints"${state.settings.coachMode === "hints" ? " selected" : ""}>Hints during play</option>
          <option value="post_game"${state.settings.coachMode === "post_game" ? " selected" : ""}>Post-game review</option>
          <option value="silent"${state.settings.coachMode === "silent" ? " selected" : ""}>Silent</option>
        </select>
      </label>
      <details class="advanced-settings">
        <summary>Connection details</summary>
        <label class="field">
          <span>Supabase URL</span>
          <input id="supabaseUrlInput" type="url" value="${escapeAttr(state.supabaseConfig.url)}" placeholder="https://project.supabase.co">
        </label>
        <label class="field">
          <span>Publishable key</span>
          <input id="supabaseKeyInput" type="password" value="${escapeAttr(state.supabaseConfig.anonKey)}" placeholder="Publishable key">
        </label>
      </details>
      <div class="button-row">
        <button id="saveSettingsButton" type="button">Save settings</button>
        <button id="testSupabaseButton" type="button">Test Supabase</button>
        <button id="resetLocalButton" type="button" class="danger-button">Clear local data</button>
      </div>
    </div>
  `;

  bindRequiredServicesCard();
  document.querySelector("#saveSettingsButton").addEventListener("click", () => saveSettingsFromPanel());
  document.querySelector("#testOpenAIButton").addEventListener("click", checkOpenAIHealth);
  document.querySelector("#testSupabaseButton").addEventListener("click", testSupabaseConnection);
  document.querySelector("#resetLocalButton").addEventListener("click", resetLocalData);
}

function handleSquareClick(square) {
  if (!areRequiredServicesReady()) return;

  const playerColor = state.activeDrill ? state.activeDrill.playerColor : state.settings.playerColor;
  if (state.thinking || state.game.isGameOver() || state.game.turn() !== playerColor) {
    return;
  }

  const piece = state.game.get(square);

  if (!state.selectedSquare) {
    if (piece && piece.color === playerColor) {
      selectSquare(square);
    }
    return;
  }

  if (state.selectedSquare === square) {
    clearSelection();
    return;
  }

  if (piece && piece.color === playerColor) {
    selectSquare(square);
    return;
  }

  const beforeFen = state.game.fen();
  const move = state.game.move({ from: state.selectedSquare, to: square, promotion: "q" });

  if (move) {
    if (state.activeDrill) {
      clearSelection({ render: false });
      handleDrillMove(move, beforeFen);
      return;
    }
    const animated = animateBoardMove(move);
    clearSelection({ render: false });
    recordMove(move, beforeFen, "player");
    renderAfterMoveAnimation(animated, maybeEngineMove);
    return;
  }

  clearSelection();
}

function selectSquare(square) {
  state.selectedSquare = square;
  state.legalTargets = new Set(state.game.moves({ square, verbose: true }).map((move) => move.to));
  renderBoard();
}

function clearSelection(options = {}) {
  state.selectedSquare = null;
  state.legalTargets = new Set();
  if (options.render !== false) renderBoard();
}

async function maybeEngineMove() {
  if (!areRequiredServicesReady()) return;

  if (state.game.isGameOver() || state.game.turn() === state.settings.playerColor) {
    await finalizeIfGameOver();
    return;
  }

  state.thinking = true;
  renderGameMeta();
  let engineAnimationDelay = 0;

  try {
    await wait(180);

    const fen = state.game.fen();
    let uci = null;
    const botDepth = getCurrentBotDepth();

    try {
      uci = await state.engine?.bestMove(fen, botDepth);
    } catch {
      uci = null;
      state.engine = null;
    }

    const preferredMove = uci ? moveFromUci(uci) : null;
    const fallbackMove = chooseFallbackMove(fen, botDepth);
    const movesToTry = [preferredMove, fallbackMove].filter(Boolean);

    for (const move of movesToTry) {
      const beforeFen = state.game.fen();
      const played = state.game.move(move);
      if (played) {
        engineAnimationDelay = animateBoardMove(played) ? 170 : 0;
        recordMove(played, beforeFen, "engine");
        break;
      }
    }
  } catch (error) {
    console.warn("Engine move failed", error);
  } finally {
    state.thinking = false;
    await finalizeIfGameOver();
    if (engineAnimationDelay) await wait(engineAnimationDelay);
    renderAll();
  }
}

function moveFromUci(uci) {
  if (!uci || uci.length < 4) return null;
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci[4] || "q",
  };
}

function moveToUci(move) {
  if (!move?.from || !move?.to) return "";
  return `${move.from}${move.to}${move.promotion || ""}`;
}

function chooseFallbackMove(fen, depth = getCurrentBotDepth()) {
  const ranked = rankCandidateMoves(fen);
  if (!ranked.length) return null;
  const poolSize = depth >= 8 ? 2 : depth >= 5 ? 4 : 7;
  const pool = ranked.slice(0, Math.min(poolSize, ranked.length));
  const selected = pool[Math.floor(Math.random() * pool.length)];
  return {
    from: selected.from,
    to: selected.to,
    promotion: selected.promotion || "q",
  };
}

function recordMove(move, beforeFen, role) {
  const afterFen = state.game.fen();
  const record = {
    id: crypto.randomUUID(),
    gameId: state.currentGameId,
    ply: state.moves.length + 1,
    role,
    color: move.color,
    san: move.san,
    uci: `${move.from}${move.to}${move.promotion || ""}`,
    from: move.from,
    to: move.to,
    piece: move.piece,
    captured: move.captured || null,
    beforeFen,
    afterFen,
    classification: "neutral",
    tags: [],
    note: "",
    analysisStatus: role === "player" && state.engine?.ready ? "pending" : "unavailable",
    qualityEligible: role === "player" && !state.activeDrill && isPlacementComplete(),
    qualityKey: "",
    qualityLabel: "",
    qualityReason: "",
    qualitySymbol: "",
    engineDepth: null,
    engineSource: "",
    evalBefore: null,
    evalAfter: null,
    mateBefore: null,
    mateAfter: null,
    evalDelta: null,
    bestMoveUci: "",
    bestMoveSan: "",
    principalVariation: [],
    createdAt: new Date().toISOString(),
  };

  if (role === "player") {
    const analysis = analyzePlayerMove(beforeFen, move, afterFen);
    record.classification = analysis.classification;
    record.tags = analysis.tags;
    record.note = analysis.note;
    updateWeaknessProfile(record);
    maybeCreatePractice(record, analysis.candidates);
    if (record.qualityEligible && !state.engine?.ready) {
      updateMoveQuality(record);
    }
  } else {
    record.note = "Engine reply.";
  }

  state.moves.push(record);
  state.lastMove = { from: move.from, to: move.to };
  saveCurrentGame();
  const moveSyncPromise = syncMove(record);

  if (role === "player" && state.engine?.ready) {
    enrichPlayerMoveWithEngineEval(record, beforeFen, afterFen, moveSyncPromise);
  } else if (record.qualityKey) {
    moveSyncPromise.then(() => syncMoveAnalysis(record)).catch((error) => console.warn("Move quality sync failed", error));
  }
}

function updateMoveQuality(record) {
  if (!record?.qualityEligible) return null;
  const quality = classifyMoveQuality({
    evalDelta: record.evalDelta,
    classification: record.classification,
    tags: record.tags || [],
    playedUci: record.uci,
    bestMoveUci: record.bestMoveUci,
    openingKnown: isKnownOpeningMove(record),
    mateBefore: record.mateBefore,
    mateAfter: record.mateAfter,
  });

  record.qualityKey = quality.key;
  record.qualityLabel = quality.label;
  record.qualityReason = quality.reason;
  record.qualitySymbol = quality.symbol;
  return quality;
}

function isKnownOpeningMove(record) {
  if (!record || getPhase(record.beforeFen || state.game.fen()) !== "opening") return false;
  const moves = state.moves.some((move) => move.id === record.id) ? state.moves : [...state.moves, record];
  const sequence = moves
    .filter((move) => move.ply <= record.ply)
    .map((move) => normalizeSan(move.san));

  return OPENING_BOOK.some((opening) => {
    if (sequence.length > opening.moves.length) return false;
    return sequence.every((san, index) => san === normalizeSan(opening.moves[index] || ""));
  });
}

async function enrichPlayerMoveWithEngineEval(record, beforeFen, afterFen, moveSyncPromise) {
  if (!state.engine?.ready) return;
  try {
    const before = await state.engine.evaluatePosition(beforeFen, ANALYSIS_DEPTH);
    const after = await state.engine.evaluatePosition(afterFen, ANALYSIS_DEPTH);
    const bestMoveSan = before.bestMove ? uciToSan(beforeFen, before.bestMove) : "";
    const analysis = normalizeEngineAnalysis({
      before,
      after,
      depth: ANALYSIS_DEPTH,
      bestMoveSan,
    });

    Object.assign(record, analysis);
    if (record.evalDelta !== null) {
      record.classification = classifyByEval(record.evalDelta, record.classification);
    }
    updateMoveQuality(record);

    saveCurrentGame();
    await moveSyncPromise;
    await syncMoveAnalysis(record);
    renderBoard();
    if (state.currentTab === "coach" || state.currentTab === "review") {
      renderCurrentPanel();
    }
  } catch (error) {
    record.analysisStatus = "unavailable";
    updateMoveQuality(record);
    saveCurrentGame();
    await moveSyncPromise;
    await syncMoveAnalysis(record);
    renderBoard();
    if (state.currentTab === "coach" || state.currentTab === "review") {
      renderCurrentPanel();
    }
    console.warn("Move enrichment failed", error);
  }
}

function analyzePlayerMove(beforeFen, playedMove, afterFen) {
  const tags = [];
  const before = new Chess(beforeFen);
  const after = new Chess(afterFen);
  const candidates = rankCandidateMoves(beforeFen).slice(0, 4);
  const playedUci = `${playedMove.from}${playedMove.to}${playedMove.promotion || ""}`;
  const best = candidates[0];
  const playedCandidate = candidates.find((move) => `${move.from}${move.to}${move.promotion || ""}` === playedUci);
  const phase = getPhase(before);

  if (best && (!playedCandidate || best.score - playedCandidate.score >= 3.5)) {
    tags.push({
      category: "candidate_moves",
      label: "Candidate moves",
      severity: 2,
      note: `Consider forcing moves like ${best.san}.`,
    });
  }

  const tactic = detectMissedTacticalOpportunity(before, playedMove);
  if (tactic) tags.push(tactic);

  if (phase === "opening") {
    const openingTag = detectOpeningIssue(before, playedMove);
    if (openingTag) tags.push(openingTag);
  }

  const hanging = detectHangingPiece(after, playedMove.color, playedMove.to);
  if (hanging) tags.push(hanging);

  const trade = detectPoorTrade(after, playedMove);
  if (trade) tags.push(trade);

  const kingSafety = detectKingSafetyIssue(after, playedMove.color);
  if (kingSafety) tags.push(kingSafety);

  const uniqueTags = dedupeTags(tags);
  const classification = classifyTags(uniqueTags);
  const note = buildMoveNote(uniqueTags, best);

  return {
    classification,
    tags: uniqueTags,
    note,
    candidates,
  };
}

function rankCandidateMoves(fen) {
  const game = new Chess(fen);
  const moves = game.moves({ verbose: true });
  return moves.map((move) => {
    const score = scoreMove(game, move);
    return {
      from: move.from,
      to: move.to,
      san: move.san,
      promotion: move.promotion || "",
      score,
    };
  }).sort((a, b) => b.score - a.score);
}

function scoreMove(game, move) {
  let score = 0;
  const phase = getPhase(game);
  const movingValue = PIECE_VALUES[move.piece] || 0;

  if (move.captured) {
    score += 4 + (PIECE_VALUES[move.captured] || 0) - movingValue * 0.35;
  }

  const clone = new Chess(game.fen());
  clone.move({ from: move.from, to: move.to, promotion: move.promotion || "q" });

  if (clone.isCheckmate()) score += 100;
  if (clone.isCheck()) score += 3;
  if (move.promotion) score += 8;
  if (move.san.includes("O-O")) score += phase === "opening" ? 4 : 1;

  if (phase === "opening") {
    if (["e4", "d4", "e5", "d5", "c4", "c5", "Nf3", "Nc3", "Nf6", "Nc6", "Bc4", "Bb5", "Bf4"].some((token) => move.san.startsWith(token))) {
      score += 2;
    }
    if (move.piece === "q") score -= 2.5;
    if (move.piece === "n" || move.piece === "b") score += 1.5;
  }

  if (isCenterSquare(move.to)) score += 0.8;
  if (isMoveHanging(clone, move.color, move.to)) score -= movingValue >= 3 ? 4 : 1.5;
  if (createsImmediateThreat(clone, move.color)) score += 1.4;
  const fork = describeForkMove(game, move);
  if (fork) score += fork.severity >= 3 ? 8 : 4;
  const lineTactic = describeLineTacticMove(game, move);
  if (lineTactic) score += lineTactic.severity >= 3 ? 7 : 3.5;

  return score;
}

function isCenterSquare(square) {
  return ["d4", "e4", "d5", "e5", "c4", "f4", "c5", "f5"].includes(square);
}

function createsImmediateThreat(game, color) {
  try {
    const replyPosition = new Chess(setTurn(game.fen(), color));
    return replyPosition.moves({ verbose: true }).some((move) => move.captured && move.color === color && PIECE_VALUES[move.captured] >= 3 && move.to);
  } catch {
    return false;
  }
}

function setTurn(fen, color) {
  const parts = fen.split(" ");
  parts[1] = color;
  return parts.join(" ");
}

function getPhase(gameOrFen) {
  const game = typeof gameOrFen === "string" ? new Chess(gameOrFen) : gameOrFen;
  const fullMove = Number(game.fen().split(" ")[5]);
  const material = game.board().flat().filter(Boolean).reduce((sum, piece) => sum + (piece.type === "k" ? 0 : PIECE_VALUES[piece.type]), 0);
  if (fullMove <= 10) return "opening";
  if (material <= 24) return "endgame";
  return "middlegame";
}

function detectOpeningIssue(before, move) {
  const fullMove = Number(before.fen().split(" ")[5]);
  if (fullMove > 10) return null;

  if (move.piece === "q" && !move.captured && !move.san.includes("+")) {
    return {
      category: "opening_principle",
      label: "Early queen move",
      severity: 2,
      note: "Develop minor pieces and secure the king before queen moves.",
    };
  }

  const history = state.moves.filter((item) => item.role === "player" && item.color === move.color);
  const repeatedPiece = history.some((item) => item.piece === move.piece && item.to === move.from && ["n", "b"].includes(move.piece));
  if (repeatedPiece && !move.captured) {
    return {
      category: "opening_principle",
      label: "Repeated piece move",
      severity: 2,
      note: "In the opening, develop the rest of the army before moving one piece again.",
    };
  }

  return null;
}

function detectHangingPiece(game, color, movedTo) {
  const piece = game.get(movedTo);
  if (!piece || piece.color !== color || PIECE_VALUES[piece.type] < 3) return null;

  if (isMoveHanging(game, color, movedTo)) {
    return {
      category: "hanging_piece",
      label: "Loose piece",
      severity: PIECE_VALUES[piece.type] >= 5 ? 3 : 2,
      note: `The ${pieceName(piece.type)} on ${movedTo} can be attacked without enough support.`,
    };
  }

  return null;
}

function isMoveHanging(game, color, square) {
  const attacked = attacksSquare(game.fen(), opposite(color), square);
  const defended = attacksSquare(game.fen(), color, square);
  return attacked && !defended;
}

function attacksSquare(fen, attackerColor, square) {
  try {
    const game = new Chess(fen);
    for (const rank of RANKS) {
      for (const file of FILES) {
        const from = `${file}${rank}`;
        const piece = game.get(from);
        if (piece?.color === attackerColor && pieceAttacksSquare(game, piece, from, square)) {
          return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

function pieceAttacksSquare(game, piece, from, to) {
  if (from === to) return false;

  const fromFile = FILES.indexOf(from[0]);
  const fromRank = RANKS.indexOf(from[1]);
  const toFile = FILES.indexOf(to[0]);
  const toRank = RANKS.indexOf(to[1]);
  const df = toFile - fromFile;
  const dr = toRank - fromRank;
  const absDf = Math.abs(df);
  const absDr = Math.abs(dr);

  if (piece.type === "p") {
    const direction = piece.color === "w" ? 1 : -1;
    return absDf === 1 && dr === direction;
  }

  if (piece.type === "n") {
    return (absDf === 1 && absDr === 2) || (absDf === 2 && absDr === 1);
  }

  if (piece.type === "k") {
    return absDf <= 1 && absDr <= 1;
  }

  if (piece.type === "b") {
    return absDf === absDr && isClearLine(game, fromFile, fromRank, toFile, toRank);
  }

  if (piece.type === "r") {
    return (df === 0 || dr === 0) && isClearLine(game, fromFile, fromRank, toFile, toRank);
  }

  if (piece.type === "q") {
    const diagonal = absDf === absDr;
    const straight = df === 0 || dr === 0;
    return (diagonal || straight) && isClearLine(game, fromFile, fromRank, toFile, toRank);
  }

  return false;
}

function isClearLine(game, fromFile, fromRank, toFile, toRank) {
  const stepFile = Math.sign(toFile - fromFile);
  const stepRank = Math.sign(toRank - fromRank);
  let file = fromFile + stepFile;
  let rank = fromRank + stepRank;

  while (file !== toFile || rank !== toRank) {
    const square = `${FILES[file]}${RANKS[rank]}`;
    if (game.get(square)) return false;
    file += stepFile;
    rank += stepRank;
  }

  return true;
}

function detectPoorTrade(game, move) {
  if (!move.captured) return null;

  const movedPiece = game.get(move.to);
  if (!movedPiece) return null;

  const movedValue = PIECE_VALUES[movedPiece.type] || 0;
  const capturedValue = PIECE_VALUES[move.captured] || 0;
  const canBeRecaptured = attacksSquare(game.fen(), opposite(move.color), move.to);

  if (canBeRecaptured && movedValue - capturedValue >= 2) {
    return {
      category: "poor_trade",
      label: "Poor trade",
      severity: movedValue - capturedValue >= 4 ? 3 : 2,
      note: "Calculate the recapture before starting the trade.",
    };
  }

  return null;
}

function detectKingSafetyIssue(game, color) {
  const phase = getPhase(game);
  if (phase !== "opening") return null;

  const fullMove = Number(game.fen().split(" ")[5]);
  const kingSquare = findKing(game, color);
  if (fullMove >= 8 && ((color === "w" && kingSquare === "e1") || (color === "b" && kingSquare === "e8"))) {
    return {
      category: "king_safety",
      label: "King still central",
      severity: 2,
      note: "Your king is still in the center while the position is opening up.",
    };
  }

  return null;
}

function detectMissedTacticalOpportunity(before, playedMove) {
  const playedUci = moveToUci(playedMove);
  const legalMoves = before.moves({ verbose: true });
  if (moveCreatesCheckmate(before, playedMove)) return null;

  const playedTactics = describeMoveTactics(before, playedMove);

  const mateMove = legalMoves.find((move) => moveCreatesCheckmate(before, move));
  if (mateMove && moveToUci(mateMove) !== playedUci) {
    return {
      category: "missed_mate",
      label: "Missed mate",
      severity: 3,
      note: `${mateMove.san} was checkmate. Start every forcing scan with checks.`,
    };
  }

  const opportunities = legalMoves
    .filter((move) => moveToUci(move) !== playedUci)
    .flatMap((move) => describeMoveTactics(before, move))
    .filter((tactic) => !playedTactics.some((played) => played.category === tactic.category))
    .sort((a, b) => b.severity - a.severity || b.priority - a.priority);

  const best = opportunities[0];
  if (!best) return null;

  return {
    category: best.category,
    label: best.label,
    severity: best.severity,
    note: best.note,
  };
}

function describeMoveTactics(game, move) {
  return [
    describeForkMove(game, move),
    describeLineTacticMove(game, move),
    describeLoosePieceCapture(game, move),
  ].filter(Boolean);
}

function moveCreatesCheckmate(game, move) {
  try {
    const clone = new Chess(game.fen());
    clone.move({ from: move.from, to: move.to, promotion: move.promotion || "q" });
    return clone.isCheckmate();
  } catch {
    return false;
  }
}

function describeForkMove(game, move) {
  try {
    const clone = new Chess(game.fen());
    clone.move({ from: move.from, to: move.to, promotion: move.promotion || "q" });
    const piece = clone.get(move.to);
    if (!piece || piece.color !== move.color) return null;

    const targets = getAttackedTargetsByPiece(clone, piece, move.to, opposite(move.color));
    if (targets.length < 2) return null;

    const includesKing = targets.some((target) => target.type === "k");
    const materialTargets = targets.filter((target) => target.type !== "k");
    const bestMaterial = Math.max(0, ...materialTargets.map((target) => target.value));
    const targetScore = targets.reduce((sum, target) => sum + target.value, 0);
    if (!includesKing && targetScore < 8) return null;

    const severity = includesKing && bestMaterial >= 5 ? 3 : 2;
    const targetText = formatTacticalTargets(targets);
    return {
      category: "missed_fork",
      label: "Missed fork",
      severity,
      priority: targetScore + (includesKing ? 20 : 0),
      note: `${move.san} would fork ${targetText}. Look for moves that attack two targets at once.`,
    };
  } catch {
    return null;
  }
}

function describeLineTacticMove(game, move) {
  try {
    const clone = new Chess(game.fen());
    clone.move({ from: move.from, to: move.to, promotion: move.promotion || "q" });
    const piece = clone.get(move.to);
    if (!piece || piece.color !== move.color || !["b", "r", "q"].includes(piece.type)) return null;

    const tactic = findLineTactic(clone, move.to, piece);
    if (!tactic) return null;

    return {
      category: tactic.category,
      label: tactic.label,
      severity: tactic.severity,
      priority: tactic.priority,
      note: `${move.san} would ${tactic.note}. Use line pieces to find pins, skewers, and overloaded pieces.`,
    };
  } catch {
    return null;
  }
}

function describeLoosePieceCapture(game, move) {
  if (!move.captured || (PIECE_VALUES[move.captured] || 0) < 5) return null;

  try {
    const clone = new Chess(game.fen());
    clone.move({ from: move.from, to: move.to, promotion: move.promotion || "q" });
    const movedPiece = clone.get(move.to);
    if (!movedPiece) return null;

    const capturedValue = PIECE_VALUES[move.captured] || 0;
    const movedValue = PIECE_VALUES[movedPiece.type] || 0;
    const canBeRecaptured = attacksSquare(clone.fen(), opposite(move.color), move.to);
    if (canBeRecaptured && movedValue >= capturedValue) return null;

    return {
      category: "missed_capture",
      label: "Missed loose piece",
      severity: capturedValue >= 9 ? 3 : 2,
      priority: capturedValue,
      note: `${move.san} would win a ${pieceName(move.captured)}. Check captures on loose major pieces before quiet moves.`,
    };
  } catch {
    return null;
  }
}

function getAttackedTargetsByPiece(game, piece, from, targetColor) {
  const targets = [];
  for (const rank of RANKS) {
    for (const file of FILES) {
      const square = `${file}${rank}`;
      const target = game.get(square);
      if (target?.color === targetColor && target.type !== "p" && pieceAttacksSquare(game, piece, from, square)) {
        targets.push({
          square,
          type: target.type,
          value: target.type === "k" ? 20 : PIECE_VALUES[target.type] || 0,
        });
      }
    }
  }
  return targets.sort((a, b) => b.value - a.value);
}

function formatTacticalTargets(targets) {
  return targets
    .slice(0, 3)
    .map((target) => target.type === "k" ? `the king on ${target.square}` : `the ${pieceName(target.type)} on ${target.square}`)
    .join(" and ");
}

function findLineTactic(game, from, piece) {
  const directions = getSlidingDirections(piece.type);
  let best = null;

  for (const [df, dr] of directions) {
    const seen = getPiecesOnRay(game, from, df, dr);
    if (seen.length < 2) continue;

    const [front, back] = seen;
    if (front.piece.color !== opposite(piece.color) || back.piece.color !== opposite(piece.color)) continue;

    let tactic = null;
    if (back.piece.type === "k" && front.piece.type !== "k") {
      tactic = {
        category: "missed_pin",
        label: "Missed pin",
        severity: PIECE_VALUES[front.piece.type] >= 3 ? 3 : 2,
        priority: 15 + (PIECE_VALUES[front.piece.type] || 0),
        note: `pin the ${pieceName(front.piece.type)} on ${front.square} to the king`,
      };
    } else if (front.piece.type === "k" && (PIECE_VALUES[back.piece.type] || 0) >= 5) {
      tactic = {
        category: "missed_skewer",
        label: "Missed skewer",
        severity: 3,
        priority: 16 + (PIECE_VALUES[back.piece.type] || 0),
        note: `skewer the king and win the ${pieceName(back.piece.type)} on ${back.square}`,
      };
    } else if ((PIECE_VALUES[front.piece.type] || 0) >= 5 && (PIECE_VALUES[back.piece.type] || 0) >= 3) {
      tactic = {
        category: "missed_line_tactic",
        label: "Missed line tactic",
        severity: 2,
        priority: (PIECE_VALUES[front.piece.type] || 0) + (PIECE_VALUES[back.piece.type] || 0),
        note: `line up the ${pieceName(front.piece.type)} on ${front.square} with the ${pieceName(back.piece.type)} on ${back.square}`,
      };
    }

    if (tactic && (!best || tactic.priority > best.priority)) best = tactic;
  }

  return best;
}

function getSlidingDirections(pieceType) {
  const diagonals = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const straights = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  if (pieceType === "b") return diagonals;
  if (pieceType === "r") return straights;
  if (pieceType === "q") return [...diagonals, ...straights];
  return [];
}

function getPiecesOnRay(game, from, df, dr) {
  const pieces = [];
  let file = FILES.indexOf(from[0]) + df;
  let rank = RANKS.indexOf(from[1]) + dr;

  while (file >= 0 && file < 8 && rank >= 0 && rank < 8) {
    const square = `${FILES[file]}${RANKS[rank]}`;
    const piece = game.get(square);
    if (piece) pieces.push({ square, piece });
    file += df;
    rank += dr;
  }

  return pieces;
}

function findKing(game, color) {
  for (const rank of RANKS) {
    for (const file of FILES) {
      const square = `${file}${rank}`;
      const piece = game.get(square);
      if (piece?.type === "k" && piece.color === color) return square;
    }
  }
  return null;
}

function dedupeTags(tags) {
  const map = new Map();
  for (const tag of tags) {
    if (!map.has(tag.category) || map.get(tag.category).severity < tag.severity) {
      map.set(tag.category, tag);
    }
  }
  return [...map.values()];
}

function classifyTags(tags) {
  const maxSeverity = Math.max(0, ...tags.map((tag) => tag.severity));
  if (maxSeverity >= 3) return "mistake";
  if (maxSeverity >= 2) return "inaccuracy";
  return "neutral";
}

function buildMoveNote(tags, best) {
  if (!tags.length) {
    return best ? `Candidate scan looked acceptable. Also consider ${best.san}.` : "No issue tagged.";
  }

  const primary = tags[0];
  const candidateText = best ? ` Candidate to compare: ${best.san}.` : "";
  return `${primary.note}${candidateText}`;
}

function updateWeaknessProfile(record) {
  for (const tag of record.tags) {
    const existing = state.profile[tag.category] || {
      category: tag.category,
      label: tag.label,
      count: 0,
      severity: tag.severity,
      examples: [],
    };

    existing.count += 1;
    existing.severity = Math.max(existing.severity, tag.severity);
    existing.lastSeen = new Date().toISOString();
    existing.lastNote = tag.note;
    existing.examples = [
      {
        fen: record.beforeFen,
        san: record.san,
        note: tag.note,
        at: existing.lastSeen,
      },
      ...(existing.examples || []),
    ].slice(0, 5);

    state.profile[tag.category] = existing;
    syncWeakness(tag, record, existing);
  }
}

function maybeCreatePractice(record, candidates) {
  if (!record.tags.length || !candidates.length) return;

  const primary = record.tags[0];
  const sourceKey = `${record.beforeFen}|${primary.category}`;
  const exists = state.practiceQueue.some((item) => item.sourceKey === sourceKey);
  if (exists) return;

  const item = {
    id: crypto.randomUUID(),
    sourceKey,
    gameId: state.currentGameId,
    moveId: record.id,
    fen: record.beforeFen,
    title: primary.label,
    category: primary.category,
    playedMove: record.san,
    note: primary.note,
    prompt: `From this position, find a better candidate than ${record.san}.`,
    candidates: candidates.slice(0, 3).map((candidate) => ({
      san: candidate.san,
      uci: `${candidate.from}${candidate.to}${candidate.promotion || ""}`,
    })),
    createdAt: new Date().toISOString(),
  };

  state.practiceQueue = [item, ...state.practiceQueue].slice(0, 50);
  syncPosition(record, item);
}

async function markPractice(id, result) {
  const item = state.practiceQueue.find((entry) => entry.id === id);
  if (!item) return;

  item.lastResult = result;
  item.attemptedAt = new Date().toISOString();
  state.practiceHistory = [
    {
      ...item,
      result,
      attemptedAt: item.attemptedAt,
    },
    ...state.practiceHistory,
  ].slice(0, 100);

  if (result === "solved") {
    state.practiceQueue = state.practiceQueue.filter((entry) => entry.id !== id);
  } else {
    state.practiceQueue = [item, ...state.practiceQueue.filter((entry) => entry.id !== id)];
  }

  saveJson(STORAGE_KEYS.practice, state.practiceQueue);
  saveJson(STORAGE_KEYS.practiceHistory, state.practiceHistory);
  await syncPracticeAttempt(item, result);
  renderPracticePanel();
  renderProfilePanel();
}

function startDrill(id) {
  const drill = TRAINING_MODULES.find((item) => item.id === id);
  if (!drill) return;
  startTrainingSession(drill, "practice");
}

function startLesson(lessonId) {
  const lesson = INTERACTIVE_LESSONS[lessonId];
  if (!lesson) return;
  startTrainingSession(lesson, "lesson");
}

function startQueuedPractice(id) {
  const item = state.practiceQueue.find((entry) => entry.id === id);
  if (!item) return;
  startPracticePuzzle(practiceItemToPuzzle(item), { render: true });
}

function startTrainingSession(drill, source) {
  if (!state.activeDrill) {
    saveCurrentGame();
  }
  state.activeDrill = structuredClone(drill);
  state.activeDrill.step = 0;
  state.activeDrill.source = source;
  state.drillMessage = drill.objective;
  state.game = drill.fen === "start" ? new Chess() : new Chess(drill.fen);
  state.moves = [];
  state.selectedSquare = null;
  state.legalTargets = new Set();
  state.lastMove = null;
  switchTab("coach");
  renderAll();
}

function resumeSavedGame() {
  state.activeDrill = null;
  state.drillMessage = "";
  resetPracticeTrainerState();
  state.practiceTrainer.status = "idle";
  restoreActiveGame();
  switchTab("coach");
  renderAll();
}

async function handleDrillMove(move, beforeFen) {
  if (isPracticeTrainerDrill()) {
    await handlePracticeTrainerMove(move, beforeFen);
    return;
  }

  const playedUci = `${move.from}${move.to}${move.promotion || ""}`;
  const target = getCurrentDrillTarget();

  if (!target.expectedMoves.includes(playedUci)) {
    state.game.undo();
    state.drillMessage = `Not that move. Look for: ${target.idea}`;
    state.practiceHistory = [{
      id: crypto.randomUUID(),
      title: state.activeDrill.title,
      category: state.activeDrill.category,
      fen: beforeFen,
      result: "missed",
      attemptedAt: new Date().toISOString(),
    }, ...state.practiceHistory].slice(0, 100);
    saveJson(STORAGE_KEYS.practiceHistory, state.practiceHistory);
    renderAll();
    return;
  }

  state.lastMove = { from: move.from, to: move.to };
  state.drillMessage = target.successText || target.idea || "Correct.";
  renderAll();

  if (target.reply) {
    state.thinking = true;
    renderGameMeta();
    await wait(350);
    const reply = state.game.move(moveFromUci(target.reply));
    if (reply) {
      state.lastMove = { from: reply.from, to: reply.to };
    }
    state.thinking = false;
    state.activeDrill.step += 1;
    state.drillMessage = getCurrentDrillTarget().idea || state.activeDrill.objective;
    renderAll();
    return;
  }

  completeDrill(beforeFen);
}

async function handlePracticeTrainerMove(move, beforeFen) {
  const playedUci = `${move.from}${move.to}${move.promotion || ""}`;
  const puzzle = state.activeDrill;
  const trainer = state.practiceTrainer;
  const solved = (puzzle.expectedMoves || []).includes(playedUci);
  trainer.attempts += 1;

  if (!solved) {
    state.game.undo();
    trainer.status = "missed";
    trainer.scoreDelta = -3;
    if (!trainer.hintIndex && puzzle.hintSteps?.length) {
      trainer.hintIndex = 1;
    }
    const hint = getCurrentPracticeHint();
    trainer.feedback = `${puzzle.missText || "Not yet."}${hint ? ` ${hint}` : ""}`;
    state.drillMessage = trainer.feedback;
    recordPracticeHistory(puzzle, "missed", beforeFen, playedUci);
    await syncPracticeAttempt(getPracticeAttemptPayload(puzzle, beforeFen), "missed", playedUci);
    renderAll();
    return;
  }

  state.lastMove = { from: move.from, to: move.to };
  trainer.status = "solved";
  trainer.lastMoveUci = playedUci;
  trainer.scoreDelta = trainer.attempts === 1 && !trainer.hintIndex ? 10 : 6;
  trainer.feedback = puzzle.successText || "Correct.";
  state.drillMessage = trainer.feedback;
  recordPracticeHistory(puzzle, "solved", beforeFen, playedUci);

  if (puzzle.queueItemId) {
    state.practiceQueue = state.practiceQueue.filter((item) => item.id !== puzzle.queueItemId);
    saveJson(STORAGE_KEYS.practice, state.practiceQueue);
  }

  await syncPracticeAttempt(getPracticeAttemptPayload(puzzle, beforeFen), "solved", playedUci);
  renderAll();
}

function getPracticeAttemptPayload(puzzle, fen) {
  return {
    sourceKey: getPracticeSourceKey(puzzle),
    fen,
    candidates: (puzzle.expectedMoves || []).map((uci) => ({ uci })),
  };
}

function recordPracticeHistory(puzzle, result, fen, chosenMove = "") {
  state.practiceHistory = [{
    id: crypto.randomUUID(),
    sourceKey: getPracticeSourceKey(puzzle),
    title: puzzle.title || puzzle.term || puzzle.plainTitle,
    category: puzzle.category,
    fen,
    result,
    chosenMove,
    expectedMoves: puzzle.expectedMoves || [],
    attemptedAt: new Date().toISOString(),
  }, ...state.practiceHistory].slice(0, 100);
  saveJson(STORAGE_KEYS.practiceHistory, state.practiceHistory);
}

function getCurrentDrillTarget() {
  const drill = state.activeDrill;
  if (drill.steps?.length) {
    const step = drill.steps[Math.min(drill.step, drill.steps.length - 1)];
    return {
      expectedMoves: [step.move],
      reply: step.reply,
      idea: step.idea,
      successText: step.idea,
    };
  }

  return {
    expectedMoves: drill.expectedMoves || [],
    reply: null,
    idea: drill.objective,
    successText: drill.successText,
  };
}

function completeDrill(fen) {
  state.drillMessage = `${state.activeDrill.successText || "Correct."} Drill complete.`;
  const completedDrill = state.activeDrill;
  state.practiceHistory = [{
    id: crypto.randomUUID(),
    title: completedDrill.title,
    category: completedDrill.category,
    fen,
    result: "solved",
    attemptedAt: new Date().toISOString(),
  }, ...state.practiceHistory].slice(0, 100);
  if (completedDrill.queueItemId) {
    state.practiceQueue = state.practiceQueue.filter((item) => item.id !== completedDrill.queueItemId);
    saveJson(STORAGE_KEYS.practice, state.practiceQueue);
  }
  saveJson(STORAGE_KEYS.practiceHistory, state.practiceHistory);
  syncPracticeAttempt({
    sourceKey: `training:${completedDrill.id}`,
    fen,
    candidates: getCurrentDrillTarget().expectedMoves.map((uci) => ({ uci })),
  }, "solved");
  renderAll();
}

function detectOpening() {
  const sans = state.moves.map((move) => normalizeSan(move.san));
  let best = null;

  for (const opening of OPENING_BOOK) {
    const matchLength = opening.moves.reduce((count, san, index) => {
      return sans[index] === san ? count + 1 : count;
    }, 0);

    const prefixMatches = opening.moves.slice(0, matchLength).every((san, index) => sans[index] === san);
    if (prefixMatches && matchLength > 0 && (!best || matchLength > best.matchLength)) {
      best = { ...opening, matchLength };
    }
  }

  if (best && best.matchLength >= Math.min(2, best.moves.length)) {
    return best;
  }

  if (!state.moves.length) {
    return {
      name: "Starting position",
      plans: ["Develop pieces", "Control the center", "Castle efficiently"],
    };
  }

  return {
    name: "Unbooked line",
    plans: ["Track the first recurring mistake", "Use the move review instead of memorizing a name"],
  };
}

function getResultLabel() {
  if (!state.game.isGameOver()) return "In progress";
  if (state.game.isCheckmate()) return `${colorName(opposite(state.game.turn()))} wins by checkmate`;
  if (state.game.isStalemate()) return "Draw by stalemate";
  if (state.game.isThreefoldRepetition()) return "Draw by repetition";
  if (state.game.isInsufficientMaterial()) return "Draw by insufficient material";
  if (state.game.isDraw()) return "Draw";
  return "Game complete";
}

async function finalizeIfGameOver() {
  if (!state.game.isGameOver()) return;
  const existing = state.localGames.find((game) => game.id === state.currentGameId);
  if (existing?.result && existing.result !== "in_progress") return;
  const result = getResultLabel();
  saveCurrentGame(result);
  recordCompletedGameForPlacement(result);
  await syncGameEnd(result);
}

function saveCurrentGame(result = "in_progress") {
  const opening = detectOpening();
  const gameRecord = {
    id: state.currentGameId,
    startedAt: state.startedAt,
    updatedAt: new Date().toISOString(),
    playerColor: state.settings.playerColor,
    engineLevel: getCurrentBotDepth(),
    result,
    openingName: opening.name,
    openingKey: state.moves.slice(0, 8).map((move) => normalizeSan(move.san)).join(" "),
    fen: state.game.fen(),
    pgn: state.game.pgn(),
    moves: state.moves,
  };

  const others = state.localGames.filter((item) => item.id !== state.currentGameId);
  state.localGames = [gameRecord, ...others].slice(0, 30);
  saveJson(STORAGE_KEYS.games, state.localGames);
  saveJson(STORAGE_KEYS.activeGame, gameRecord);
}

function restoreActiveGame() {
  const active = loadJson(STORAGE_KEYS.activeGame, null);
  if (!active?.id) return false;

  try {
    const restored = new Chess();
    if (active.pgn) {
      restored.loadPgn(active.pgn);
    } else if (active.fen) {
      restored.load(active.fen);
    }

    state.game = restored;
    state.currentGameId = active.id;
    state.startedAt = active.startedAt || new Date().toISOString();
    state.moves = Array.isArray(active.moves) ? active.moves : [];
    state.lastMove = state.moves.length
      ? {
          from: state.moves[state.moves.length - 1].from,
          to: state.moves[state.moves.length - 1].to,
        }
      : null;

    if (active.playerColor) {
      state.settings.playerColor = active.playerColor;
    }

    return true;
  } catch (error) {
    console.warn("Could not restore active game", error);
    localStorage.removeItem(STORAGE_KEYS.activeGame);
    return false;
  }
}

async function setupSupabase() {
  const { url, anonKey } = state.supabaseConfig;
  if (!url || !anonKey) {
    state.supabase = null;
    state.supabaseReachable = false;
    state.supabaseAnalysisReachable = false;
    state.supabaseQualityReachable = false;
    state.supabaseHealth = "Supabase URL and publishable key are required.";
    return false;
  }

  try {
    const createClient = await loadSupabaseCreateClient();
    state.supabase = createClient(url, anonKey);
    state.supabaseReachable = null;
    state.supabaseAnalysisReachable = null;
    state.supabaseQualityReachable = null;
    renderGameMeta();
    return true;
  } catch (error) {
    console.warn("Supabase client could not load", error);
    state.supabase = null;
    state.supabaseReachable = false;
    state.supabaseAnalysisReachable = false;
    state.supabaseQualityReachable = false;
    state.supabaseHealth = "Supabase client could not load.";
    renderGameMeta();
    return false;
  }
}

async function syncGameStart() {
  if (!state.supabase) return false;
  const opening = detectOpening();
  return await safeSupabase(() => state.supabase.from("games").upsert({
    id: state.currentGameId,
    started_at: state.startedAt,
    player_color: state.settings.playerColor,
    engine_level: getCurrentBotDepth(),
    result: "in_progress",
    opening_name: opening.name,
    opening_key: "",
    pgn: "",
    status: "in_progress",
  }));
}

async function verifySupabaseConnection(options = {}) {
  if (!state.supabase) {
    const loaded = await setupSupabase();
    if (!loaded) {
      if (!state.supabaseHealth) state.supabaseHealth = "Supabase is required before the app can be used.";
      state.supabaseReachable = false;
      state.supabaseAnalysisReachable = false;
      state.supabaseQualityReachable = false;
      if (options.render !== false) renderAll();
      return false;
    }
  }

  state.supabaseHealth = "Testing Supabase connection...";
  if (options.render !== false) renderAll();

  try {
    const { error: gamesError } = await state.supabase.from("games").select("id", { count: "exact", head: true });
    if (gamesError) throw new Error(`games table: ${formatSupabaseError(gamesError)}`);

    const { error: movesError } = await state.supabase.from("moves").select("id", { count: "exact", head: true });
    if (movesError) throw new Error(`moves table: ${formatSupabaseError(movesError)}`);

    const { error: analysisError } = await state.supabase.from("moves").select("analysis_status", { count: "exact", head: true });
    state.supabaseAnalysisReachable = !analysisError;
    const { error: qualityError } = await state.supabase.from("moves").select("quality_key", { count: "exact", head: true });
    state.supabaseQualityReachable = !qualityError;
    const schemaWarnings = [
      analysisError ? `engine analysis columns are not available yet: ${formatOptionalColumnError(analysisError, "analysis_status")}` : "",
      qualityError ? `move quality columns are not available yet: ${formatOptionalColumnError(qualityError, "quality_key")}` : "",
    ].filter(Boolean);
    const analysisWarning = schemaWarnings.length
      ? ` ${schemaWarnings.join(" ")}. Apply supabase/schema.sql to persist review data.`
      : "";

    if (options.syncStart !== false) {
      const saved = await syncGameStart();
      if (!saved) {
        state.supabaseHealth = "Supabase is reachable, but saving the active game failed.";
        state.supabaseReachable = false;
        if (options.render !== false) renderAll();
        return false;
      }
    }

    state.supabaseHealth = `Supabase is online and writable.${analysisWarning}`;
    state.supabaseReachable = true;
    if (options.render !== false) renderAll();
    return true;
  } catch (error) {
    state.supabaseHealth = `Supabase is required, but it is not reachable: ${formatSupabaseError(error)}`;
    state.supabaseReachable = false;
    state.supabaseAnalysisReachable = false;
    state.supabaseQualityReachable = false;
    if (options.render !== false) renderAll();
    return false;
  }
}

function formatSupabaseError(error) {
  if (!error) return "unknown error";
  if (typeof error === "string") return error;

  const parts = [
    error.message,
    error.details,
    error.hint,
    error.code ? `code ${error.code}` : "",
  ].filter(Boolean);

  if (parts.length) return parts.join(" ");

  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== "{}" ? serialized : "unknown error";
  } catch {
    return "unknown error";
  }
}

function formatOptionalColumnError(error, column) {
  const formatted = formatSupabaseError(error);
  if (!formatted || formatted === "unknown error" || formatted === "{\"message\":\"\"}") {
    return `${column} column is missing`;
  }
  return formatted;
}

async function syncGameEnd(result) {
  if (!state.supabase) return;
  const opening = detectOpening();
  const savedGame = state.localGames.find((game) => game.id === state.currentGameId);
  await safeSupabase(() => state.supabase.from("games").update({
    ended_at: new Date().toISOString(),
    result,
    engine_level: savedGame?.engineLevel || getCurrentBotDepth(),
    opening_name: opening.name,
    opening_key: state.moves.slice(0, 8).map((move) => normalizeSan(move.san)).join(" "),
    pgn: state.game.pgn(),
    status: "complete",
  }).eq("id", state.currentGameId));
}

async function syncMove(record) {
  if (!state.supabase) return;
  await safeSupabase(() => state.supabase.from("moves").insert({
    id: record.id,
    game_id: record.gameId,
    ply: record.ply,
    role: record.role,
    color: record.color,
    san: record.san,
    uci: record.uci,
    piece: record.piece,
    captured: record.captured,
    fen_before: record.beforeFen,
    fen_after: record.afterFen,
    classification: record.classification,
    tags: record.tags,
    note: record.note,
  }));
}

async function syncMoveAnalysis(record) {
  if (!state.supabase) return;
  const payload = {
    classification: record.classification,
    tags: record.tags,
    note: record.note,
  };

  if (state.supabaseAnalysisReachable === true) {
    Object.assign(payload, {
      analysis_status: record.analysisStatus,
      engine_depth: record.engineDepth,
      engine_source: record.engineSource,
      eval_before: record.evalBefore,
      eval_after: record.evalAfter,
      eval_delta: record.evalDelta,
      mate_before: record.mateBefore,
      mate_after: record.mateAfter,
      best_move_uci: record.bestMoveUci,
      best_move_san: record.bestMoveSan,
      principal_variation: record.principalVariation || [],
    });
  }

  if (state.supabaseQualityReachable === true) {
    payload.quality_key = record.qualityKey || null;
    payload.quality_label = record.qualityLabel || null;
    payload.quality_reason = record.qualityReason || null;
  }

  await safeSupabase(() => state.supabase.from("moves").update(payload).eq("id", record.id));
}

async function syncWeakness(tag, record, aggregate) {
  if (!state.supabase) return;

  await safeSupabase(() => state.supabase.from("weakness_events").insert({
    game_id: state.currentGameId,
    move_id: record.id,
    category: tag.category,
    label: tag.label,
    severity: tag.severity,
    fen: record.beforeFen,
    note: tag.note,
  }));

  await safeSupabase(() => state.supabase.from("weaknesses").upsert({
    category: tag.category,
    label: tag.label,
    count: aggregate.count,
    severity: aggregate.severity,
    last_seen: aggregate.lastSeen,
    examples: aggregate.examples,
    updated_at: new Date().toISOString(),
  }, { onConflict: "category" }));
}

async function syncPosition(record, item) {
  if (!state.supabase) return;
  await safeSupabase(() => state.supabase.from("positions").insert({
    game_id: state.currentGameId,
    move_id: record.id,
    fen: item.fen,
    phase: getPhase(item.fen),
    category: item.category,
    tags: record.tags,
    prompt: item.prompt,
    best_candidates: item.candidates,
  }));
}

async function syncPracticeAttempt(item, result, chosenMove = null) {
  if (!state.supabase) return;
  await safeSupabase(() => state.supabase.from("practice_attempts").insert({
    source_key: item.sourceKey,
    fen: item.fen,
    chosen_move: chosenMove,
    expected_moves: item.candidates,
    result,
  }));
}

async function safeSupabase(operation) {
  try {
    const { error } = await operation();
    if (error) throw error;
    state.supabaseReachable = true;
    renderGameMeta();
    return true;
  } catch (error) {
    console.warn("Supabase sync failed", error);
    renderGameMeta();
    return false;
  }
}

async function testSupabaseConnection() {
  await saveSettingsFromPanel({ syncStart: false });

  await verifySupabaseConnection({ syncStart: true });
}

async function saveSettingsFromPanel(options = {}) {
  state.settings.playerColor = document.querySelector("#playerColorInput").value;
  state.settings.coachMode = document.querySelector("#coachModeInput").value;
  state.supabaseConfig.url = document.querySelector("#supabaseUrlInput").value.trim();
  state.supabaseConfig.anonKey = document.querySelector("#supabaseKeyInput").value.trim();
  saveJson(STORAGE_KEYS.settings, state.settings);
  saveJson(STORAGE_KEYS.supabase, state.supabaseConfig);
  renderAll();

  const connected = await setupSupabase();
  if (!connected) return false;
  return await verifySupabaseConnection({ syncStart: options.syncStart !== false, render: true });
}

function resetLocalData() {
  localStorage.removeItem(STORAGE_KEYS.profile);
  localStorage.removeItem(STORAGE_KEYS.practice);
  localStorage.removeItem(STORAGE_KEYS.practiceHistory);
  localStorage.removeItem(STORAGE_KEYS.games);
  localStorage.removeItem(STORAGE_KEYS.activeGame);
  localStorage.removeItem(STORAGE_KEYS.placement);
  localStorage.removeItem(STORAGE_KEYS.placementCardDismissed);
  state.profile = {};
  state.practiceQueue = [];
  state.practiceHistory = [];
  state.localGames = [];
  state.placement = structuredClone(DEFAULT_PLACEMENT);
  state.placementCardDismissed = false;
  state.activeDrill = null;
  state.drillMessage = "";
  resetPracticeTrainerState();
  state.practiceTrainer.status = "idle";
  renderAll();
}

function newGame() {
  if (!areRequiredServicesReady()) return;

  state.game = new Chess();
  state.selectedSquare = null;
  state.legalTargets = new Set();
  state.lastMove = null;
  state.moves = [];
  state.reviewPly = null;
  state.currentGameId = crypto.randomUUID();
  state.startedAt = new Date().toISOString();
  state.thinking = false;
  state.activeDrill = null;
  state.drillMessage = "";
  resetPracticeTrainerState();
  state.practiceTrainer.status = "idle";
  saveCurrentGame();
  syncGameStart();
  renderAll();

  if (state.settings.playerColor === "b") {
    maybeEngineMove();
  }
}

function onClickTakeBack() {
  if (!areRequiredServicesReady()) return;
  if (state.thinking || state.activeDrill || state.game.history().length < 2) return;

  state.game.undo();
  state.game.undo();
  state.moves = state.moves.slice(0, -2);

  const tail = state.moves[state.moves.length - 1];
  state.lastMove = tail ? { from: tail.from, to: tail.to } : null;
  state.selectedSquare = null;
  state.legalTargets = new Set();

  saveCurrentGame();
  renderAll();

  if (!state.game.isGameOver() && state.game.turn() !== state.settings.playerColor) {
    maybeEngineMove();
  }
}

function switchTab(tab) {
  state.currentTab = tab;
  const boardChanged = tab === "practice" && areRequiredServicesReady() && ensurePracticeTrainer();
  els.tabs.forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  els.panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tab));
  updateCtxHead(tab);
  if (tab === "practice" || boardChanged) {
    renderBoard();
    renderGameMeta();
  }
  renderCurrentPanel();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

async function initEngine() {
  const sources = [
    { baseUrl: LOCAL_STOCKFISH_BASE_URL, label: "local" },
    { baseUrl: STOCKFISH_CDN_BASE_URL, label: "cdn" },
  ];

  for (const source of sources) {
    const engine = new StockfishEngine(source);
    try {
      await engine.init();
      state.engine = engine;
      renderGameMeta();
      return;
    } catch (error) {
      console.warn(`Stockfish ${source.label} engine failed`, error);
      engine.destroy();
    }
  }

  state.engine = null;
  renderGameMeta();
}

function bindEvents() {
  els.newGameButton.addEventListener("click", newGame);
  els.takeBackButton.addEventListener("click", onClickTakeBack);
  els.tabs.forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });
}

function boot() {
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
  normalizePlacementState();
  state.startedAt = new Date().toISOString();
  restoreActiveGame();
  bindEvents();
  renderAll();
  verifyRequiredServices();
  initEngine();

  if (areRequiredServicesReady() && !state.game.isGameOver() && state.game.turn() !== state.settings.playerColor) {
    maybeEngineMove();
  }
}

boot();
