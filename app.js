import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.0.0/dist/esm/chess.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";

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

const STOCKFISH_URL = "https://cdn.jsdelivr.net/npm/stockfish@16.0.0/src/stockfish-nnue-16-single.js";
const SUPABASE_PROJECT_REF = "kajifmxqfcceibwredjf";
const SUPABASE_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`;
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_MCwuWk-w1KTNSI-pjTGBsQ_hm7_hwBc";
const DEFAULT_SUPABASE_CONFIG = {
  url: SUPABASE_URL,
  anonKey: SUPABASE_PUBLISHABLE_KEY,
};

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
  engineStatus: document.querySelector("#engineStatus"),
  storageStatus: document.querySelector("#storageStatus"),
  newGameButton: document.querySelector("#newGameButton"),
  turnText: document.querySelector("#turnText"),
  openingText: document.querySelector("#openingText"),
  resultText: document.querySelector("#resultText"),
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
  thinking: false,
  activeDrill: null,
  drillMessage: "",
  openAI: {
    configured: false,
    model: "",
    status: "Not checked",
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
  engine: null,
};

class StockfishEngine {
  constructor(url) {
    this.url = url;
    this.worker = null;
    this.ready = false;
    this.pending = null;
    this.bootResolve = null;
    this.bootReject = null;
  }

  async init() {
    if (!window.Worker) {
      throw new Error("Workers unavailable");
    }

    const source = `
      self.Module = {
        locateFile: function(path) {
          return "https://cdn.jsdelivr.net/npm/stockfish@16.0.0/src/" + path;
        }
      };
      importScripts("${this.url}");
    `;
    const blob = new Blob([source], { type: "text/javascript" });
    const workerUrl = URL.createObjectURL(blob);
    this.worker = new Worker(workerUrl);
    URL.revokeObjectURL(workerUrl);

    this.worker.onmessage = (event) => this.handleMessage(String(event.data));
    this.worker.onerror = () => {
      this.ready = false;
      if (this.bootReject) {
        this.bootReject(new Error("Stockfish worker failed"));
      }
    };

    const bootPromise = new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error("Stockfish readiness timed out"));
      }, 5000);

      this.bootResolve = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      this.bootReject = (error) => {
        window.clearTimeout(timeout);
        reject(error);
      };
    });

    this.post("uci");
    window.setTimeout(() => this.post("isready"), 250);
    await bootPromise;
  }

  post(command) {
    if (this.worker) {
      this.worker.postMessage(command);
    }
  }

  handleMessage(line) {
    if (line === "readyok" || line === "uciok") {
      this.ready = true;
      if (line === "readyok" && this.bootResolve) {
        this.bootResolve();
        this.bootResolve = null;
        this.bootReject = null;
      }
    }

    if (this.pending && line.startsWith("info ")) {
      this.pending.info.push(line);
    }

    if (this.pending && line.startsWith("bestmove ")) {
      const move = line.split(/\s+/)[1];
      const pending = this.pending;
      this.pending = null;
      pending.resolve(move && move !== "(none)" ? move : null);
    }
  }

  async bestMove(fen, depth) {
    if (!this.ready || this.pending) {
      return null;
    }

    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        if (this.pending) {
          this.pending = null;
          resolve(null);
        }
      }, 4500);

      this.pending = {
        info: [],
        resolve: (move) => {
          window.clearTimeout(timeout);
          resolve(move);
        },
      };

      this.post(`position fen ${fen}`);
      this.post(`go depth ${depth}`);
    });
  }
}

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

function renderAll() {
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

  for (const square of getBoardSquares()) {
    const fileIndex = FILES.indexOf(square[0]);
    const rankIndex = Number(square[1]) - 1;
    const piece = state.game.get(square);
    const button = document.createElement("button");
    button.type = "button";
    button.className = [
      "square",
      (fileIndex + rankIndex) % 2 === 0 ? "dark" : "light",
      state.selectedSquare === square ? "selected" : "",
      state.legalTargets.has(square) ? "target" : "",
      state.lastMove && (state.lastMove.from === square || state.lastMove.to === square) ? "last" : "",
    ].filter(Boolean).join(" ");
    button.dataset.square = square;
    button.setAttribute("aria-label", square);

    if (piece) {
      const span = document.createElement("span");
      span.className = `piece ${piece.color}`;
      span.textContent = PIECES[piece.color + piece.type];
      button.append(span);
    }

    const flipped = isBoardFlipped();
    if (square[0] === (flipped ? "h" : "a") || square[1] === (flipped ? "8" : "1")) {
      const coord = document.createElement("span");
      coord.className = "coord";
      coord.textContent = square;
      button.append(coord);
    }

    button.addEventListener("click", () => handleSquareClick(square));
    els.board.append(button);
  }
}

function renderGameMeta() {
  els.turnText.textContent = state.activeDrill ? `${colorName(state.game.turn())} drill` : colorName(state.game.turn());
  els.openingText.textContent = detectOpening().name;
  els.resultText.textContent = state.activeDrill ? state.activeDrill.title : getResultLabel();

  const storageReady = Boolean(state.supabase);
  const needsKey = Boolean(state.supabaseConfig.url && !state.supabaseConfig.anonKey);
  els.storageStatus.textContent = state.supabaseReachable
    ? "Supabase ready"
    : storageReady
      ? "Supabase configured"
      : needsKey
        ? "Supabase key needed"
        : "Local storage";
  els.storageStatus.className = state.supabaseReachable
    ? "status-pill"
    : storageReady || needsKey
      ? "status-pill warn"
      : "status-pill muted";

  const engineReady = state.engine?.ready;
  els.engineStatus.textContent = getOpponentStatusLabel();
  els.engineStatus.className = engineReady || state.activeDrill ? "status-pill" : "status-pill warn";

  els.newGameButton.disabled = state.thinking;
}

function renderCurrentPanel() {
  if (state.currentTab === "coach") renderCoachPanel();
  if (state.currentTab === "review") renderReviewPanel();
  if (state.currentTab === "practice") renderPracticePanel();
  if (state.currentTab === "profile") renderProfilePanel();
  if (state.currentTab === "lessons") renderLessonsPanel();
  if (state.currentTab === "settings") renderSettingsPanel();
}

function renderCoachPanel() {
  if (state.activeDrill) {
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
  const tags = move.tags.length
    ? move.tags.map((tag) => `<span class="tag ${tag.severity >= 3 ? "danger" : "warn"}">${escapeHtml(tag.label)}</span>`).join("")
    : "<span class=\"tag good\">No issue tagged</span>";

  return `
    <article class="mini-card">
      <strong>Move review: ${escapeHtml(move.san)}</strong>
      <p>${escapeHtml(describeMoveImpact(move))}</p>
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

async function checkOpenAIHealth() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error("Coach server is not responding.");
    const data = await response.json();
    state.openAI.configured = Boolean(data.openaiConfigured);
    state.openAI.model = data.model || "";
    state.openAI.status = state.openAI.configured ? "Connected" : "Missing OPENAI_API_KEY";
  } catch {
    state.openAI.configured = false;
    state.openAI.model = "";
    state.openAI.status = "Start the Node server with npm start.";
  }

  if (state.currentTab === "settings") {
    renderSettingsPanel();
  } else if (state.currentTab === "coach") {
    renderCoachPanel();
  }
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
  const rows = state.moves.map((move) => `
    <div class="move-row">
      <div>${move.ply}.</div>
      <div class="move-san">${escapeHtml(move.san)}</div>
      <div class="move-note">${escapeHtml(move.note || move.classification)}</div>
    </div>
  `).join("");

  els.reviewPanel.innerHTML = `
    <h2>Review</h2>
    <div class="move-list">
      ${rows || "<p class=\"empty-state\">No moves yet.</p>"}
    </div>
  `;
}

function renderPracticePanel() {
  const recommendedCategories = new Set(Object.keys(state.profile));
  const modules = prioritizeTrainingModules();
  const queuedPractice = state.practiceQueue
    .slice(0, 10)
    .sort((a, b) => getCategoryPriority(b.category) - getCategoryPriority(a.category));
  const nextFocus = getNextTrainingFocus();
  const drillStatus = state.activeDrill ? `
    <article class="practice-card active-drill-card">
      <span class="label">Active drill</span>
      <strong>${escapeHtml(state.activeDrill.title)}</strong>
      <p>${escapeHtml(state.drillMessage || state.activeDrill.objective)}</p>
      <div class="button-row">
        <button id="resumeGameButton" type="button">Resume game</button>
        <button id="restartDrillButton" type="button">Restart drill</button>
      </div>
    </article>
  ` : "";
  const cards = queuedPractice.map((item) => `
    <article class="practice-card">
      <span class="label">From your games - priority ${getCategoryPriority(item.category)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(buildPracticePrompt(item))}</p>
      <div class="candidate-list coach-candidates">
        ${item.candidates.map((candidate) => `
          <div class="candidate-row">
            <strong>${escapeHtml(candidate.san)}</strong>
            <span>${escapeHtml(explainCandidateByUci(item.fen, candidate))}</span>
          </div>
        `).join("")}
      </div>
      <div class="button-row">
        <button type="button" data-practice-board="${item.id}">Practice on board</button>
        <button type="button" data-practice="${item.id}" data-result="solved">Solved</button>
        <button type="button" data-practice="${item.id}" data-result="missed">Missed</button>
        <button type="button" data-practice="${item.id}" data-result="skipped">Skip</button>
      </div>
    </article>
  `).join("");
  const moduleCards = modules.map((module) => {
    const recommended = recommendedCategories.has(module.category);
    return `
      <button class="practice-card practice-select" type="button" data-start-drill="${escapeAttr(module.id)}">
        <span class="label">${escapeHtml(module.type)}${recommended ? " - recommended" : ""} - priority ${module.priority}</span>
        <strong>${escapeHtml(module.title)}</strong>
        <p>${escapeHtml(module.objective)}</p>
        <p>${escapeHtml(module.reason)}</p>
      </button>
    `;
  }).join("");

  els.practicePanel.innerHTML = `
    <h2>Practice</h2>
    <div class="stack">
      ${nextFocus ? `
        <article class="mini-card priority-card">
          <span class="label">Priority queue</span>
          <strong>${escapeHtml(nextFocus.title)}</strong>
          <p>${escapeHtml(nextFocus.reason)}</p>
        </article>
      ` : ""}
      ${drillStatus}
      <h3>Recommended From Your Games</h3>
      ${cards || "<p class=\"empty-state\">Mistake-based drills appear after the coach tags your games.</p>"}
      <h3>Training Library</h3>
      <div class="lesson-grid">${moduleCards}</div>
    </div>
  `;

  els.practicePanel.querySelectorAll("[data-practice]").forEach((button) => {
    button.addEventListener("click", () => markPractice(button.dataset.practice, button.dataset.result));
  });
  els.practicePanel.querySelectorAll("[data-practice-board]").forEach((button) => {
    button.addEventListener("click", () => startQueuedPractice(button.dataset.practiceBoard));
  });
  els.practicePanel.querySelectorAll("[data-start-drill]").forEach((button) => {
    button.addEventListener("click", () => startDrill(button.dataset.startDrill));
  });
  document.querySelector("#resumeGameButton")?.addEventListener("click", resumeSavedGame);
  document.querySelector("#restartDrillButton")?.addEventListener("click", () => startDrill(state.activeDrill.id));
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
      <article class="mini-card">
        <strong>Bot difficulty</strong>
        <p>${progress.complete
          ? "Adaptive mode is active. The opponent adjusts automatically from your estimated score, recent results, and mistake severity."
          : `Placement mode is active. The opponent adjusts automatically while ${progress.remaining} placement game${progress.remaining === 1 ? "" : "s"} remain.`}</p>
      </article>
      <article class="mini-card">
        <strong>OpenAI personal coach</strong>
        <p>${state.openAI.configured ? `Connected through the local server${state.openAI.model ? ` using ${escapeHtml(state.openAI.model)}` : ""}.` : "Not connected. Add OPENAI_API_KEY to .env, then restart the Node server."}</p>
        <button id="testOpenAIButton" type="button">Test OpenAI coach</button>
      </article>
      <article class="mini-card">
        <strong>Supabase sync</strong>
        <p>${state.supabaseReachable ? "Connected. Games, moves, practice, and profile events can sync." : "Configured. Use the test button if sync looks wrong."}</p>
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

  document.querySelector("#saveSettingsButton").addEventListener("click", saveSettingsFromPanel);
  document.querySelector("#testOpenAIButton").addEventListener("click", checkOpenAIHealth);
  document.querySelector("#testSupabaseButton").addEventListener("click", testSupabaseConnection);
  document.querySelector("#resetLocalButton").addEventListener("click", resetLocalData);
}

function handleSquareClick(square) {
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
    clearSelection();
    if (state.activeDrill) {
      handleDrillMove(move, beforeFen);
      return;
    }
    recordMove(move, beforeFen, "player");
    renderAll();
    maybeEngineMove();
    return;
  }

  clearSelection();
}

function selectSquare(square) {
  state.selectedSquare = square;
  state.legalTargets = new Set(state.game.moves({ square, verbose: true }).map((move) => move.to));
  renderBoard();
}

function clearSelection() {
  state.selectedSquare = null;
  state.legalTargets = new Set();
  renderBoard();
}

async function maybeEngineMove() {
  if (state.game.isGameOver() || state.game.turn() === state.settings.playerColor) {
    await finalizeIfGameOver();
    return;
  }

  state.thinking = true;
  renderGameMeta();

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
        recordMove(played, beforeFen, "engine");
        break;
      }
    }
  } catch (error) {
    console.warn("Engine move failed", error);
  } finally {
    state.thinking = false;
    await finalizeIfGameOver();
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
    createdAt: new Date().toISOString(),
  };

  if (role === "player") {
    const analysis = analyzePlayerMove(beforeFen, move, afterFen);
    record.classification = analysis.classification;
    record.tags = analysis.tags;
    record.note = analysis.note;
    updateWeaknessProfile(record);
    maybeCreatePractice(record, analysis.candidates);
  } else {
    record.note = "Engine reply.";
  }

  state.moves.push(record);
  state.lastMove = { from: move.from, to: move.to };
  saveCurrentGame();
  syncMove(record);
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

  const turn = item.fen.split(" ")[1] || state.settings.playerColor;
  const queuedDrill = {
    id: `queue-${item.id}`,
    title: item.title,
    type: "Personal drill",
    category: item.category,
    playerColor: turn,
    fen: item.fen,
    objective: buildPracticePrompt(item),
    expectedMoves: item.candidates.map((candidate) => candidate.uci).filter(Boolean),
    successText: "Correct. This is now marked solved in your practice queue.",
    queueItemId: item.id,
  };

  startTrainingSession(queuedDrill, "personal");
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
  restoreActiveGame();
  switchTab("coach");
  renderAll();
}

async function handleDrillMove(move, beforeFen) {
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

function setupSupabase() {
  const { url, anonKey } = state.supabaseConfig;
  if (!url || !anonKey) {
    state.supabase = null;
    state.supabaseReachable = null;
    return;
  }

  try {
    state.supabase = createClient(url, anonKey);
    state.supabaseReachable = null;
  } catch {
    state.supabase = null;
    state.supabaseReachable = null;
  }
}

async function syncGameStart() {
  if (!state.supabase) return;
  const opening = detectOpening();
  await safeSupabase(() => state.supabase.from("games").upsert({
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

async function syncPracticeAttempt(item, result) {
  if (!state.supabase) return;
  await safeSupabase(() => state.supabase.from("practice_attempts").insert({
    source_key: item.sourceKey,
    fen: item.fen,
    chosen_move: null,
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
    state.supabaseReachable = false;
    renderGameMeta();
    return false;
  }
}

async function testSupabaseConnection() {
  saveSettingsFromPanel();

  if (!state.supabase) {
    state.supabaseHealth = "Supabase is not configured.";
    renderSettingsPanel();
    renderGameMeta();
    return;
  }

  state.supabaseHealth = "Testing Supabase connection...";
  renderSettingsPanel();

  try {
    const { error } = await state.supabase.from("games").select("id", { count: "exact", head: true });
    if (error) throw error;
    state.supabaseHealth = "Supabase is connected and the games table is reachable.";
    state.supabaseReachable = true;
  } catch (error) {
    state.supabaseHealth = `Supabase client is configured, but the schema is not reachable yet: ${error.message || "unknown error"}`;
    state.supabaseReachable = false;
  }

  renderSettingsPanel();
  renderGameMeta();
}

function saveSettingsFromPanel() {
  state.settings.playerColor = document.querySelector("#playerColorInput").value;
  state.settings.coachMode = document.querySelector("#coachModeInput").value;
  state.supabaseConfig.url = document.querySelector("#supabaseUrlInput").value.trim();
  state.supabaseConfig.anonKey = document.querySelector("#supabaseKeyInput").value.trim();
  saveJson(STORAGE_KEYS.settings, state.settings);
  saveJson(STORAGE_KEYS.supabase, state.supabaseConfig);
  setupSupabase();
  renderAll();
  syncGameStart();
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
  renderAll();
}

function newGame() {
  state.game = new Chess();
  state.selectedSquare = null;
  state.legalTargets = new Set();
  state.lastMove = null;
  state.moves = [];
  state.currentGameId = crypto.randomUUID();
  state.startedAt = new Date().toISOString();
  state.thinking = false;
  state.activeDrill = null;
  state.drillMessage = "";
  saveCurrentGame();
  syncGameStart();
  renderAll();

  if (state.settings.playerColor === "b") {
    maybeEngineMove();
  }
}

function switchTab(tab) {
  state.currentTab = tab;
  els.tabs.forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  els.panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tab));
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
  try {
    const engine = new StockfishEngine(STOCKFISH_URL);
    await engine.init();
    state.engine = engine;
  } catch {
    state.engine = null;
  }
  renderGameMeta();
}

function bindEvents() {
  els.newGameButton.addEventListener("click", newGame);
  els.tabs.forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });
}

function boot() {
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
  normalizePlacementState();
  state.startedAt = new Date().toISOString();
  restoreActiveGame();
  setupSupabase();
  bindEvents();
  renderAll();
  syncGameStart();
  checkOpenAIHealth();
  initEngine();

  if (!state.game.isGameOver() && state.game.turn() !== state.settings.playerColor) {
    maybeEngineMove();
  }
}

boot();
