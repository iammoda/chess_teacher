import { Chess } from "./vendor/chess/chess.js";
import { ANALYSIS_DEPTH, DEEP_ANALYSIS_DEPTH, MOVE_QUALITIES, classifyByEval, classifyMoveQuality, normalizeEngineAnalysis } from "./lib/classify.mjs";
import { verifyTagsWithEngine } from "./lib/tag-verify.mjs";
import { SKILL_CATALOG, getSkillById, getSkillCategories, getSkillForCategory } from "./lib/skill-model.mjs";
import { StockfishEngine } from "./lib/stockfish-engine.mjs";
import { attachDragHandlers } from "./lib/board-drag.mjs";
import { arrowsOverlaySvg, uciToArrow } from "./lib/board-arrows.mjs";
import { playSound, classifyMoveForSound } from "./lib/sounds.mjs";
import { burstConfetti } from "./lib/confetti.mjs";
import { compactTranscript, appendMemoryNote, appendTrace, memoryForPayload, streamCoachChat } from "./lib/coach-client.mjs";
import { createApiClient, ApiError } from "./lib/api-client.mjs";
import { scorePassword, MIN_PASSWORD_LENGTH } from "./lib/password-strength.mjs";
import {
  SKILL_DIMENSIONS,
  DIMENSION_LABELS,
  SEED_SAMPLES,
  createEmptySkillState,
  seedSkillStateFromScore,
  applyMoveToSkillState,
  applyGameResultToSkillState,
  overallRating,
  skillSnapshot,
} from "./lib/skill-rating.mjs";
import { selectKeyMoments } from "./lib/review-model.mjs";
import { REPERTOIRE, getOpeningById, getLineById, learnerPlaysAt } from "./lib/repertoire.mjs";
import { ACTIVE_MATE_POSITIONS, getMatePositionById, matesByRung, isRungUnlocked, recordMateAttempt } from "./lib/mates.mjs";
import { GRADE_MISSED, GRADE_HARD, GRADE_SOLVED, createSrs, ensureSrs, applyGrade, selectDue, nextDueLabel } from "./lib/srs.mjs";
import { normalizePackPuzzle, ratingBandForScore, selectRatedPuzzle } from "./lib/puzzle-packs.mjs";
import { COACH_PERSONAS, normalizePersonaKey } from "./lib/personas.mjs";
import { coachModeAllows as coachModeAllowsForMode } from "./lib/coach-mode.mjs";
import { LESSONS, getLessonById, getNextLesson, allLessonsComplete, beginnerTips } from "./lib/learn-lessons.mjs";

const PIECE_SPRITE_ROOT = "/vendor/pieces/";
const DEFAULT_PIECE_SET = "merida";
// Single source of truth for the version shown in the rail footer.
const APP_VERSION = "0.7";

// Board palettes: keys map to [data-board-theme] blocks in styles.css; the
// swatch colors here only draw the Settings previews.
const BOARD_THEMES = [
  { key: "slate", label: "Slate", light: "#dee3e6", dark: "#8ca2ad" },
  { key: "walnut", label: "Walnut", light: "#f0d9b5", dark: "#b58863" },
  { key: "green", label: "Green", light: "#eeeed2", dark: "#769656" },
  { key: "ocean", label: "Ocean", light: "#e6eef5", dark: "#88a8c3" },
  { key: "rosewood", label: "Rosewood", light: "#f0e0dd", dark: "#ab7168" },
  { key: "candy", label: "Candy", light: "#fdf1f7", dark: "#eda3c9" },
  { key: "sorbet", label: "Sorbet", light: "#fbf1d7", dark: "#66c2ae" },
  { key: "nebula", label: "Nebula", light: "#6b7a99", dark: "#3d4a66" },
  { key: "middle-realm", label: "Middle Realm", light: "#e8e0c0", dark: "#7d8a5c" },
];

function normalizeBoardThemeKey(key) {
  return BOARD_THEMES.some((theme) => theme.key === key) ? key : "slate";
}

function applyBoardTheme(key) {
  const theme = normalizeBoardThemeKey(key);
  if (theme === "slate") {
    delete document.documentElement.dataset.boardTheme;
  } else {
    document.documentElement.dataset.boardTheme = theme;
  }
}

// App looks: whole-app skins. Keys map to [data-app-theme] token blocks in
// styles.css; "classic" is the bare :root and needs no attribute. The
// preview colors here only draw the Settings swatches.
const APP_THEMES = [
  { key: "woodland", label: "Cozy", blurb: "Warm and friendly", colors: ["#f6efdf", "#fffdf6", "#9c5617", "#33291c"] },
  { key: "arcade", label: "Arcade", blurb: "Candy-bright and loud", colors: ["#f7e8a9", "#ffc93c", "#d02c7d", "#2f45e6"] },
  { key: "classic", label: "Classic", blurb: "Quiet and focused", colors: ["#f6f8fa", "#ffffff", "#2f6fed", "#1b2126"] },
];

// Each look suggests a matching board palette. Applied only while the player
// has never hand-picked a board theme (see boardThemeAuto).
const APP_THEME_BOARD_SUGGESTIONS = {
  woodland: "walnut",
  arcade: "sorbet",
  classic: "slate",
};

function normalizeAppThemeKey(key) {
  return APP_THEMES.some((theme) => theme.key === key) ? key : "woodland";
}

function applyAppTheme(key) {
  const theme = normalizeAppThemeKey(key);
  if (theme === "classic") {
    delete document.documentElement.dataset.appTheme;
  } else {
    document.documentElement.dataset.appTheme = theme;
  }
  syncArcadeEmojis();
}

// ── Arcade floating emojis ──
// Decorative stickers scattered at random spots around the viewport — never
// on the board — and reshuffled with a little pop every minute or so. The
// layer is aria-hidden and pointer-events: none (see styles.css), so this is
// pure set dressing: reduced-motion users never see it, and it only runs
// while the arcade look is active.
const ARCADE_EMOJIS = ["👾", "👽", "🤖", "🎮", "🕹️", "🎱", "⭐", "🌟", "✨", "🛸", "🌙", "🪐"];
const ARCADE_EMOJI_SHUFFLE_MS = 60000;
let arcadeEmojiTimer = null;

function arcadeEmojiCount() {
  return window.innerWidth <= 900 ? 10 : ARCADE_EMOJIS.length * 2;
}

// Picks a random spot for one emoji, rejecting anything that would touch the
// board (inflated a bit so nothing kisses the edge) or the mobile nav strip.
function pickArcadeEmojiSpot(size, boardRect) {
  const pad = 20;
  const mobile = window.innerWidth <= 900;
  const maxX = Math.max(1, window.innerWidth - size - 8);
  const maxY = Math.max(1, window.innerHeight - size - (mobile ? 84 : 8));
  for (let attempt = 0; attempt < 12; attempt++) {
    const x = 4 + Math.random() * maxX;
    const y = 4 + Math.random() * maxY;
    if (!boardRect
      || x + size < boardRect.left - pad
      || x > boardRect.right + pad
      || y + size < boardRect.top - pad
      || y > boardRect.bottom + pad) {
      return { x, y };
    }
  }
  // Every try landed on the board (tiny viewport): park it at the top edge.
  return { x: 4 + Math.random() * maxX, y: 4 };
}

function placeArcadeEmoji(span, boardRect) {
  const mobile = window.innerWidth <= 900;
  const size = mobile ? 16 + Math.random() * 10 : 16 + Math.random() * 20;
  const spot = pickArcadeEmojiSpot(size, boardRect);
  span.style.left = `${Math.round(spot.x)}px`;
  span.style.top = `${Math.round(spot.y)}px`;
  span.style.fontSize = `${Math.round(size)}px`;
  span.style.setProperty("--rot", `${Math.round(-25 + Math.random() * 47)}deg`);
  span.style.setProperty("--dur", `${(6 + Math.random() * 5).toFixed(1)}s`);
  span.style.setProperty("--delay", `${(-Math.random() * 6).toFixed(1)}s`);
}

function getArcadeBoardRect() {
  const board = document.querySelector("#board");
  if (!board || !board.offsetParent) return null;
  const rect = board.getBoundingClientRect();
  return rect.width > 0 ? rect : null;
}

// (Re)builds and scatters the emoji layer. With { pop: true } each emoji
// hops to its new spot with a staggered scale-bounce so the room ripples.
function placeArcadeEmojis({ pop = false } = {}) {
  const layer = document.querySelector(".arcade-float");
  if (!layer) return;
  const count = arcadeEmojiCount();
  while (layer.children.length < count) {
    const span = document.createElement("span");
    span.textContent = ARCADE_EMOJIS[layer.children.length % ARCADE_EMOJIS.length];
    layer.append(span);
  }
  while (layer.children.length > count) layer.lastElementChild.remove();
  const boardRect = getArcadeBoardRect();
  [...layer.children].forEach((span, i) => {
    span.classList.toggle("ufo", span.textContent === "🛸");
    if (!pop) {
      placeArcadeEmoji(span, boardRect);
      return;
    }
    setTimeout(() => {
      // Re-check the board on each hop — a panel switch or resize may have
      // moved it while the ripple was still playing out.
      placeArcadeEmoji(span, getArcadeBoardRect());
      span.classList.remove("popping");
      void span.offsetWidth; // restart the pop animation
      span.classList.add("popping");
    }, i * 220);
  });
}

function syncArcadeEmojis() {
  if (!arcadeEmojisActive()) {
    clearTimeout(arcadeEmojiTimer);
    arcadeEmojiTimer = null;
    document.querySelector(".arcade-float")?.replaceChildren();
    return;
  }
  if (arcadeEmojiTimer) return;
  placeArcadeEmojis();
  // ±10s jitter so the shuffle never feels metronomic. Re-check activity per
  // tick: reduced-motion can be toggled on mid-session, and shuffling an
  // invisible layer forever would be pure waste.
  const tick = () => {
    if (!document.hidden && arcadeEmojisActive()) placeArcadeEmojis({ pop: true });
    arcadeEmojiTimer = setTimeout(tick, ARCADE_EMOJI_SHUFFLE_MS + (Math.random() * 20000 - 10000));
  };
  arcadeEmojiTimer = setTimeout(tick, ARCADE_EMOJI_SHUFFLE_MS + (Math.random() * 20000 - 10000));
}

let arcadeEmojiResizeTimer = null;

// True while the arcade look is active for a user who is OK with motion —
// the only state in which the emoji layer exists.
function arcadeEmojisActive() {
  return document.documentElement.dataset.appTheme === "arcade"
    && !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}

// Layout changed under the emojis (resize, tab switch showing/hiding the
// board): re-scatter so none of them sit where the board now is. Skipped
// when the layer doesn't exist so it never re-creates spans uselessly.
function refreshArcadeEmojiPlacement() {
  if (!arcadeEmojisActive()) return;
  clearTimeout(arcadeEmojiResizeTimer);
  arcadeEmojiResizeTimer = setTimeout(() => placeArcadeEmojis(), 250);
}

window.addEventListener("resize", refreshArcadeEmojiPlacement);

// Clicking an emoji zaps it — it shrinks away and stays gone until the next
// shuffle tops the layer back up. Delegated so re-created spans keep working.
document.addEventListener("click", (event) => {
  const span = event.target instanceof Element ? event.target.closest(".arcade-float span") : null;
  if (!span || span.classList.contains("zapped")) return;
  span.classList.add("zapped");
  setTimeout(() => span.remove(), 400);
});

// One entry point for every "you did it!" moment (game won, puzzle solved,
// lesson finished, calibration done). Confetti volume follows the app look:
// classic stays quiet, arcade goes full carnival. burstConfetti() itself
// no-ops for prefers-reduced-motion users.
function celebrate(kind = "win") {
  const theme = normalizeAppThemeKey(state.settings.appTheme);
  const intensity = theme === "arcade" ? "big" : theme === "woodland" ? "medium" : "small";
  const colors = theme === "arcade"
    ? ["#d02c7d", "#2f45e6", "#ffc93c", "#66c2ae", "#ff7a30", "#fffdf6"]
    : theme === "woodland"
      ? ["#edb95e", "#9c5617", "#3e6f34", "#e8563f", "#fffdf6", "#c4b28a"]
      : undefined;
  // Milestones (first calibration, ladder rungs) always get the full burst.
  burstConfetti({ intensity: kind === "milestone" ? "big" : intensity, colors });
}

function getActivePieceSet() {
  const configured = state.settings.pieceSet || DEFAULT_PIECE_SET;
  const available = state.server.pieceSets || [];
  if (available.length && !available.includes(configured)) return DEFAULT_PIECE_SET;
  return configured;
}

function pieceSpriteUrl(color, type, set = getActivePieceSet()) {
  return `${PIECE_SPRITE_ROOT}${set}/${color}${type.toUpperCase()}.svg`;
}

// Warm the browser cache so switching sets never flashes empty squares.
function preloadPieceSet(set) {
  for (const color of ["w", "b"]) {
    for (const type of ["p", "n", "b", "r", "q", "k"]) {
      const img = new Image();
      img.src = pieceSpriteUrl(color, type, set);
    }
  }
}

function pieceImageHtml(color, type, className = "piece") {
  return `<img class="${className} ${color}" src="${pieceSpriteUrl(color, type)}" alt="" draggable="false">`;
}

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
const CAPTURE_ORDER = ["q", "r", "b", "n", "p"];
const MOVE_ANIMATION_MS = 240;

// Base storage keys. When the server has auth configured, every key is
// namespaced per signed-in user (see applyStorageNamespace) so two accounts
// on one browser never bleed into each other. Legacy local mode keeps the
// bare keys.
const STORAGE_KEY_BASES = {
  settings: "chess_teacher_settings_v1",
  activeGame: "chess_teacher_active_game_v1",
  profile: "chess_teacher_profile_v1",
  practice: "chess_teacher_practice_v1",
  practiceHistory: "chess_teacher_practice_history_v1",
  games: "chess_teacher_games_v1",
  calibration: "chess_teacher_calibration_v1",
  skill: "chess_teacher_skill_v1",
  repertoire: "chess_teacher_repertoire_v1",
  mateLadder: "chess_teacher_mate_ladder_v1",
  daily: "chess_teacher_daily_v1",
  coachChat: "chess_teacher_coach_chat_v1",
  coachMemory: "chess_teacher_coach_memory_v1",
  learn: "chess_teacher_learn_v1",
  tour: "chess_teacher_tour_v1",
  syncOutbox: "chess_teacher_sync_outbox_v1",
};

let STORAGE_KEYS = buildStorageKeys("");

// Skin the boot veil and auth gate before per-user settings hydrate. The
// bare settings key is the best pre-auth guess; boot() re-applies the
// signed-in user's real choice right after hydrateStateFromStorage.
try {
  applyAppTheme(JSON.parse(localStorage.getItem(STORAGE_KEY_BASES.settings) || "{}")?.appTheme);
} catch {
  applyAppTheme();
}

function buildStorageKeys(userId) {
  const keys = {};
  for (const [name, base] of Object.entries(STORAGE_KEY_BASES)) {
    keys[name] = userId ? `${base}::${userId}` : base;
  }
  return keys;
}

// Point all storage at the signed-in user. The first time an account signs in
// on a browser that has legacy single-user data, that data is copied over so
// nothing is lost.
function applyStorageNamespace(userId) {
  STORAGE_KEYS = buildStorageKeys(userId);
  if (!userId) return;

  const marker = `${STORAGE_KEY_BASES.settings}::${userId}`;
  if (localStorage.getItem(marker) !== null) return;

  for (const base of Object.values(STORAGE_KEY_BASES)) {
    const legacy = localStorage.getItem(base);
    if (legacy !== null && localStorage.getItem(`${base}::${userId}`) === null) {
      localStorage.setItem(`${base}::${userId}`, legacy);
    }
  }
}

const LOCAL_STOCKFISH_BASE_URL = "/vendor/stockfish/";
const STOCKFISH_CDN_BASE_URL = "https://cdn.jsdelivr.net/npm/stockfish@16.0.0/src/";
// supabase-js is used ONLY for authentication (sign in/up, session refresh).
// All data traffic goes through the Node server, which holds the service key.
const SUPABASE_CLIENT_URL = "https://esm.sh/@supabase/supabase-js@2.105.4?bundle";

let supabaseModulePromise = null;

const CALIBRATION_DEPTH = 6;
// Placement blends the scores of the first N completed games. Features unlock
// after game one (done: true); games two and three silently refine the score.
const CALIBRATION_GAME_TARGET = 3;
const DEFAULT_CALIBRATION = {
  done: false,
  games: [], // [{ gameId, score, at }]
  estimatedScore: null,
  completedAt: null,
};

// Learn-to-play progress for beginner mode. `pathChosen` records that the
// first-launch "new to chess?" question was answered so it never re-appears.
// `stepByLesson` keeps one resume point per lesson so reviewing a finished
// lesson never clobbers progress in another. `active` marks that a lesson was
// on the board (drives auto-resume after a reload).
const DEFAULT_LEARN = {
  completed: [], // [lessonId]
  lessonId: null, // last opened not-yet-completed lesson (Continue pointer)
  stepIndex: 0, // legacy mirror of stepByLesson[lessonId]
  stepByLesson: {}, // { [lessonId]: stepIndex }
  active: false,
  pathChosen: false,
  cheatSheetDismissed: false,
};

// Pre-calibration storage keys, migrated then removed on boot.
const LEGACY_STORAGE_KEYS = {
  placement: "chess_teacher_placement_v1",
  placementCardDismissed: "chess_teacher_placement_card_dismissed_v1",
};

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
    fen: "7k/8/6K1/8/8/8/8/5Q2 w - - 0 1",
    expectedMoves: ["f1f8"],
    targetSquares: ["f8", "h8"],
    hintSquares: ["f1", "f8", "g6"],
    hintSteps: [
      "The cornered king has almost no squares.",
      "Your king already covers g7 and h7.",
      "Slide the queen to the back rank.",
    ],
    successText: "Correct. Qf8 is checkmate — your king covers every escape square.",
    missText: "Not yet. Look for a queen check along the back rank.",
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
    fen: "4k3/8/4q3/8/8/8/8/4R1K1 w - - 0 1",
    expectedMoves: ["e1e6"],
    targetSquares: ["e6", "e8"],
    hintSquares: ["e1", "e6"],
    hintSteps: [
      "Check captures before quiet moves.",
      "The queen is on the same file as your rook — and nothing defends it.",
      "Your rook can take the queen.",
    ],
    successText: "Correct. The rook wins the undefended queen with check.",
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
    fen: "4q1k1/8/2NP4/1B6/8/8/8/4K3 w - - 0 1",
    expectedMoves: ["c6e7"],
    targetSquares: ["g8", "e8"],
    hintSquares: ["c6", "e7", "b5", "e8"],
    hintSteps: [
      "One of your own pieces is blocking a bishop.",
      "Move the blocker with check — your pawn on d6 keeps it safe.",
      "The bishop will then attack the queen.",
    ],
    successText: "Correct. The knight checks the king (protected by the d6 pawn) and opens the bishop's attack on the queen.",
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
    expectedMoves: ["b8c6"],
    targetSquares: ["h5", "f7", "e5"],
    hintSquares: ["h5", "f7", "c6"],
    hintSteps: [
      "White is aiming at f7 — and the queen also eyes your e5 pawn.",
      "Find a move that defends e5 while developing a piece.",
      "Nc6 guards the pawn and gets a piece out. (g6 would lose the e5 pawn to Qxe5+, forking the rook!)",
    ],
    successText: "Correct. Nc6 defends e5, develops a piece, and the early queen attack fizzles.",
    missText: "Not yet. First check what the queen attacks — both f7 AND the e5 pawn.",
  },
];

const DEFAULT_SETTINGS = {
  displayName: "You",
  botName: "Opponent",
  playerColor: "w",
  // The user's chosen color for NEW games. playerColor tracks the game
  // currently on the board (reviewing/resuming an old game as Black may flip
  // it) and must never silently overwrite this preference.
  preferredColor: "",
  engineDepth: 5,
  coachMode: "hints",
  // Older builds ignored coachMode entirely, so persisted values don't
  // reflect a deliberate choice. This flag marks settings written after the
  // setting became functional (see boot()).
  coachModeV2: true,
  showBestArrow: true,
  showEvalBar: true,
  soundEnabled: true,
  timeControl: "unlimited", // "unlimited" | "5+0" | "10+0" | "15+10"
  appTheme: "woodland", // "woodland" | "arcade" | "classic"
  boardTheme: "slate",
  // True until the player hand-picks a board theme; while true, switching
  // the app look may swap the board palette to a matching suggestion.
  boardThemeAuto: true,
  pieceSet: "merida",
  coachPersona: "classic",
  familyMode: false,
  beginnerMode: false,
};

const SKILL_LAB_MODES = [
  {
    id: "focus",
    label: "Focus",
    description: "Every board trains the selected skill so the pattern is easy to see.",
  },
  {
    id: "mixed",
    label: "Mixed",
    description: "Scan without a label and decide which forcing idea matters first.",
  },
  {
    id: "game_transfer",
    label: "From games",
    description: "Retry positions pulled from your own mistakes and review notes.",
  },
];

let boardDrag = null;

const els = {
  board: document.querySelector("#board"),
  boardArrows: document.querySelector("#boardArrows"),
  evalBar: document.querySelector("#evalBar"),
  evalBarFill: document.querySelector("#evalBarFill"),
  evalBarLabel: document.querySelector("#evalBarLabel"),
  newGameButton: document.querySelector("#newGameButton"),
  resignButton: document.querySelector("#resignButton"),
  seatOpponent: document.querySelector("#seatOpponent"),
  seatPlayer: document.querySelector("#seatPlayer"),
  opponentSeatName: document.querySelector("#opponentSeatName"),
  opponentSeatSub: document.querySelector("#opponentSeatSub"),
  opponentAvatar: document.querySelector("#opponentAvatar"),
  opponentSeatPill: document.querySelector("#opponentSeatPill"),
  opponentCaptureTray: document.querySelector("#opponentCaptureTray"),
  playerSeatName: document.querySelector("#playerSeatName"),
  playerAvatar: document.querySelector("#playerAvatar"),
  playerSeatSub: document.querySelector("#playerSeatSub"),
  playerSeatPill: document.querySelector("#playerSeatPill"),
  playerCaptureTray: document.querySelector("#playerCaptureTray"),
  playerClock: document.querySelector("#playerClock"),
  opponentClock: document.querySelector("#opponentClock"),
  ctxHeadTitle: document.querySelector("#ctxHeadTitle"),
  ctxHeadMeta: document.querySelector("#ctxHeadMeta"),
  practiceBadge: document.querySelector("#practiceBadge"),
  tabs: [...document.querySelectorAll(".tab")],
  panels: [...document.querySelectorAll(".panel")],
  coachPanel: document.querySelector("#coachPanel"),
  todayPanel: document.querySelector("#todayPanel"),
  reviewPanel: document.querySelector("#reviewPanel"),
  practicePanel: document.querySelector("#practicePanel"),
  learnPanel: document.querySelector("#learnPanel"),
  profilePanel: document.querySelector("#profilePanel"),
  settingsPanel: document.querySelector("#settingsPanel"),
};

const state = {
  game: new Chess(),
  // Storage-backed fields start as defaults and are filled by
  // hydrateStateFromStorage() once the storage namespace is known (after
  // sign-in when auth is configured, immediately in legacy local mode).
  settings: structuredClone(DEFAULT_SETTINGS),
  profile: {},
  practiceQueue: [],
  practiceHistory: [],
  localGames: [],
  calibration: structuredClone(DEFAULT_CALIBRATION),
  learn: structuredClone(DEFAULT_LEARN),
  // Transient lesson feedback: { text, tone: "success" | "miss" | "note" }.
  lessonFlash: null,
  // Id of the live game saved when a drill/lesson took over the board; exit
  // paths only restore the saved game when the id still matches.
  pausedGameId: null,
  skill: null,
  // { myOpenings: [openingId], lines: { [lineId]: { srs, reps, perfect } } }
  repertoire: { myOpenings: [], lines: {} },
  openingDrill: null,
  mateLadder: { solved: [], attempts: {}, rungSolved: {} },
  daily: { streak: 0, lastCompletedDate: null, todayCompleted: {} },
  clocks: null, // { white: ms, black: ms, increment: ms, side: "w"|"b", intervalId, gameFlagged: false }
  coachChat: { gameId: null, messages: [] },
  coachMemory: { notes: [], traces: [] },
  coachThinking: false,
  coachError: "",
  coachRetry: null,
  pendingCoachQuestion: null,
  proactive: { count: 0, lastCommentPly: 0, turningPointUsed: false, praiseCount: 0 },
  rethink: { active: false, record: null, remaining: 2, resolve: null, stage: "ask" },
  selectedSquare: null,
  selectedSkillId: null,
  legalTargets: new Set(),
  lastMove: null,
  moves: [],
  currentGameId: crypto.randomUUID(),
  currentTab: "play",
  reviewPly: null,
  timeline: null,
  guidedReview: null,
  // { baseFen, moves: [{uci, san, fenAfter}], index }: temporary board view
  // driven by a PV replay in Review; when active, renderBoard reads from
  // getDisplayGame() instead of state.game.
  variationReplay: null,
  thinking: false,
  pendingBoardRender: false,
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
  featureFlags: {
    remoteHistoryEraseEnabled: false,
  },
  historyErase: {
    busy: false,
    status: "",
    error: "",
  },
  // Inline rename of the opponent seat name (click-to-edit).
  opponentRename: { active: false },
  // Post-game deep engine re-analysis progress (see runDeepGameAnalysis).
  deepAnalysis: {
    gameId: null,
    running: false,
    cancelled: false,
    done: 0,
    total: 0,
  },
  // Imported rated tactics (vendor/puzzles/lichess-pack.json).
  puzzlePack: {
    status: "idle", // idle | loading | ready | error
    puzzles: [],
  },
  openAI: {
    configured: false,
    online: false,
    model: "",
    status: "Checking coach...",
  },
  // Server-provided config from /api/health.
  server: {
    loaded: false,
    authRequired: false,
    syncConfigured: false,
    supabaseAuth: null, // { url, publishableKey }
    pieceSets: [DEFAULT_PIECE_SET],
  },
  // Supabase Auth session state (identity only; data goes through /api).
  auth: {
    client: null,
    session: null,
    user: null,
    screen: "sign_in", // sign_in | sign_up | confirm_sent | reset | reset_sent | recovery
    draft: { name: "", email: "", password: "" },
    showPassword: false,
    pendingEmail: "",
    resendKind: "signup", // signup | reset — which email the sent screen re-sends
    resendAvailableAt: 0,
    busy: false,
    error: "",
    notice: "",
    recovery: false,
  },
  // Cloud sync status through the server API.
  sync: {
    reachable: null,
    health: "",
  },
  account: {
    busy: false,
    status: "",
    error: "",
  },
  engine: null,
  engineFallback: false,
};

// Storage-backed state, re-read whenever the storage namespace changes.
function hydrateStateFromStorage() {
  state.settings = loadJson(STORAGE_KEYS.settings, DEFAULT_SETTINGS);
  state.profile = loadJson(STORAGE_KEYS.profile, {});
  state.practiceQueue = loadJson(STORAGE_KEYS.practice, []);
  state.practiceHistory = loadJson(STORAGE_KEYS.practiceHistory, []);
  state.localGames = loadJson(STORAGE_KEYS.games, []);
  state.calibration = loadJson(STORAGE_KEYS.calibration, DEFAULT_CALIBRATION);
  state.skill = loadJson(STORAGE_KEYS.skill, null);
  state.repertoire = loadJson(STORAGE_KEYS.repertoire, { myOpenings: [], lines: {} });
  state.mateLadder = loadJson(STORAGE_KEYS.mateLadder, { solved: [], attempts: {}, rungSolved: {} });
  state.daily = loadJson(STORAGE_KEYS.daily, { streak: 0, lastCompletedDate: null, todayCompleted: {} });
  state.coachChat = loadJson(STORAGE_KEYS.coachChat, { gameId: null, messages: [] });
  state.coachMemory = loadJson(STORAGE_KEYS.coachMemory, { notes: [], traces: [] });
  state.learn = { ...structuredClone(DEFAULT_LEARN), ...loadJson(STORAGE_KEYS.learn, {}) };
  if (!Array.isArray(state.learn.completed)) state.learn.completed = [];
  if (!state.learn.stepByLesson || typeof state.learn.stepByLesson !== "object") {
    state.learn.stepByLesson = {};
  }
  // Migrate the legacy single-slot resume point into the per-lesson map.
  if (state.learn.lessonId && state.learn.stepIndex > 0 && state.learn.stepByLesson[state.learn.lessonId] == null) {
    state.learn.stepByLesson[state.learn.lessonId] = state.learn.stepIndex;
  }
}

function saveLearnState() {
  saveJson(STORAGE_KEYS.learn, state.learn);
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}

let storageWriteFailed = false;

// Returns true when the write landed. localStorage can throw synchronously
// (quota exceeded, private-browsing restrictions); persistence is
// best-effort — a failed save must never break the caller — but callers that
// LOOP on stored state (the sync outbox) must know the write didn't stick.
function saveJson(key, value) {
  // A deactivated tab (the app is open in another tab) must never write:
  // its stale in-memory state would clobber the active tab's storage.
  if (tabDeactivated) return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    storageWriteFailed = false;
    return true;
  } catch (error) {
    if (!storageWriteFailed) {
      console.warn("Could not save to this browser's storage (it may be full):", error?.message || error);
    }
    storageWriteFailed = true;
    return false;
  }
}

// ─────────── Dialogs + toasts ───────────
//
// Native window.confirm shows "localhost says…" chrome and can't be styled —
// jarring inside an otherwise designed app. showConfirmDialog is a drop-in
// async replacement; showToast covers transient feedback that previously had
// no home at all (it only existed as panel re-render text).

function showConfirmDialog(message, { title = "Are you sure?", confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "app-dialog-overlay";
    overlay.innerHTML = `
      <div class="app-dialog" role="dialog" aria-modal="true" aria-label="${escapeAttr(title)}">
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(message)}</p>
        <div class="button-row">
          <button type="button" class="dialog-cancel">${escapeHtml(cancelLabel)}</button>
          <button type="button" class="dialog-confirm ${danger ? "danger-button" : "primary-action"}">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;

    const previousFocus = document.activeElement;
    const finish = (answer) => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      if (previousFocus instanceof HTMLElement) previousFocus.focus?.();
      resolve(answer);
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        finish(false);
      } else if (event.key === "Tab") {
        // Two-button focus trap.
        const buttons = [...overlay.querySelectorAll("button")];
        const index = buttons.indexOf(document.activeElement);
        event.preventDefault();
        const next = event.shiftKey
          ? buttons[(index - 1 + buttons.length) % buttons.length]
          : buttons[(index + 1) % buttons.length];
        next?.focus();
      }
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(false);
    });
    overlay.querySelector(".dialog-cancel").addEventListener("click", () => finish(false));
    overlay.querySelector(".dialog-confirm").addEventListener("click", () => finish(true));
    document.addEventListener("keydown", onKey, true);

    document.body.append(overlay);
    overlay.querySelector(".dialog-confirm").focus();
  });
}

const TOAST_DURATION_MS = 4000;

function showToast(message, { tone = "info" } = {}) {
  let host = document.querySelector("#toastHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "toastHost";
    host.className = "toast-host";
    document.body.append(host);
  }
  const toast = document.createElement("div");
  toast.className = `toast toast-${tone}`;
  toast.setAttribute("role", "status");
  toast.textContent = message;
  host.append(toast);
  // Cap the stack so a burst of events can't wallpaper the screen.
  while (host.children.length > 3) host.firstChild.remove();
  window.setTimeout(() => {
    toast.classList.add("leaving");
    window.setTimeout(() => toast.remove(), 300);
  }, TOAST_DURATION_MS);
}

// ─────────── Single-active-tab lock ───────────
//
// Two open tabs each hold full in-memory copies of every store and re-persist
// them on render — last-writer-wins clobbering of games, calibration, chat,
// clocks, and double-flushing of the sync outbox. Instead of trying to merge,
// only ONE tab is active at a time: opening the app in a new tab deactivates
// the old one behind a "use here" overlay (the WhatsApp Web pattern).
const TAB_ID = (() => {
  try { return crypto.randomUUID(); } catch { return String(Math.random()); }
})();
let tabDeactivated = false;
let tabChannel = null;
let tabClaimTs = 0;

function initTabLock() {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    tabChannel = new BroadcastChannel("chess_teacher_tab_v1");
  } catch {
    return;
  }
  tabChannel.onmessage = (event) => {
    const message = event.data;
    if (!message || message.id === TAB_ID) return;
    if (message.type === "claim") {
      // Two tabs booting at the same instant would deactivate each other —
      // the newer claim wins; ties break deterministically on tab id.
      const theirTs = Number(message.ts) || 0;
      if (theirTs > tabClaimTs || (theirTs === tabClaimTs && String(message.id) > TAB_ID)) {
        deactivateThisTab();
      } else if (!tabDeactivated) {
        claimActiveTab();
      }
    }
  };
  claimActiveTab();
}

function claimActiveTab() {
  tabClaimTs = Date.now();
  tabChannel?.postMessage({ type: "claim", id: TAB_ID, ts: tabClaimTs });
}

function deactivateThisTab() {
  if (tabDeactivated) return;
  tabDeactivated = true;
  // Stop everything that writes or ticks: this tab is now read-only scenery.
  stopClockTicker();
  cancelDeepAnalysis();
  activeCoachAbort?.abort();
  if (syncOutboxTimer) {
    window.clearTimeout(syncOutboxTimer);
    syncOutboxTimer = null;
  }

  let overlay = document.querySelector("#tabLockOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "tabLockOverlay";
    overlay.className = "tab-lock-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "App opened in another tab");
    overlay.innerHTML = `
      <div class="tab-lock-card">
        <strong>Chess Teacher is open in another tab</strong>
        <p>To keep your games and progress safe, only one tab can be active at a time.</p>
        <button id="tabLockUseHereButton" class="primary-action" type="button">Use here instead</button>
      </div>
    `;
    document.body.append(overlay);
    // Reload rather than resume in place: the other tab may have changed
    // every store, and a fresh boot re-hydrates and re-claims cleanly.
    overlay.querySelector("#tabLockUseHereButton")?.addEventListener("click", () => {
      window.location.reload();
    });
  }
  overlay.hidden = false;
}

// The server API client. Every cloud request carries the current session's
// access token; when signed out the endpoints reject and sync stays local.
const api = createApiClient({
  getToken: () => state.auth.session?.access_token || null,
});

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

function playGameSound(kind) {
  playSound(kind, { enabled: state.settings.soundEnabled !== false });
}

function playSoundForMove(move, chessAfter) {
  const kind = classifyMoveForSound(move, chessAfter, getActivePlayerColor());
  playGameSound(kind);
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
  if (isLessonDrill()) return getLessonBoardCue(square);
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

// ─────────── Learn-to-play lessons (beginner mode) ───────────

function isLessonDrill(drill = state.activeDrill) {
  return Boolean(drill?.isLesson);
}

function getActiveLesson() {
  return isLessonDrill() ? getLessonById(state.activeDrill.lessonId) : null;
}

function getActiveLessonStep() {
  const lesson = getActiveLesson();
  return lesson?.steps[state.activeDrill.stepIndex] || null;
}

function getLessonBoardCue(square) {
  const step = getActiveLessonStep();
  if (!step || state.activeDrill.completed) return null;
  if (step.kind === "info") {
    if (step.highlightSquares?.includes(square)) {
      return { className: "lesson-info-square", label: "Highlighted square", badge: "" };
    }
    return null;
  }
  if (step.targetSquares?.includes(square)) {
    return { className: "lesson-target-square", label: "Move here", badge: "★" };
  }
  if (step.hintSquares?.includes(square)) {
    return { className: "lesson-hint-square", label: "This piece moves", badge: "" };
  }
  return null;
}

// Family mode swaps the display language of harsh labels; keys, symbols, and
// tone classes (colors) stay identical so analysis and UI wiring never change.
const FAMILY_QUALITY_LABELS = {
  blunder: { label: "Oops — big one", reason: "This move gave a lot away. Let's find a safer idea." },
  mistake: { label: "Not the best", reason: "There was a stronger move here. Worth another look." },
  missed_win: { label: "Almost had it!", reason: "A winning idea was hiding here. You'll spot it next time." },
  inaccuracy: { label: "Hmm — look again", reason: "This gave a little bit away." },
};

function isFamilyMode() {
  return state.settings.familyMode === true;
}

function getActivePersonaKey() {
  if (isFamilyMode()) return "sunny";
  return normalizePersonaKey(state.settings.coachPersona);
}

function getMoveQuality(move) {
  if (!move?.qualityKey) return null;
  const key = String(move.qualityKey);
  const display = MOVE_QUALITIES[key] || MOVE_QUALITIES.good;
  const softened = isFamilyMode() ? FAMILY_QUALITY_LABELS[key] : null;
  return {
    key,
    label: softened?.label || move.qualityLabel || display.label,
    symbol: move.qualitySymbol || display.symbol,
    reason: softened?.reason || move.qualityReason || display.reason,
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
  if (!isCalibrationComplete() || state.activeDrill) return null;
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

function toTitleCaseLabel(value) {
  const normalized = String(value ?? "").trim().replaceAll("_", " ").replace(/\s+/g, " ");
  if (!normalized) return "";
  return normalized.split(" ").map((token) => {
    if (!token) return "";
    if (token.toUpperCase() === token && /[A-Z]/.test(token)) return token;
    if (/\d/.test(token)) return token;
    if (token.toLowerCase() === "n/a") return "N/A";
    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
  }).join(" ");
}

function formatCountLabel(count, singular, plural = `${singular}s`) {
  const total = Number.isFinite(Number(count)) ? Number(count) : 0;
  return `${total} ${toTitleCaseLabel(total === 1 ? singular : plural)}`;
}

function animateBoardMove(move) {
  if (!move?.from || !move?.to || !els.board?.parentElement) return Promise.resolve(false);
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return Promise.resolve(false);
  const fromSquare = els.board.querySelector(`[data-square="${move.from}"]`);
  const toSquare = els.board.querySelector(`[data-square="${move.to}"]`);
  const host = els.board.parentElement;
  if (!fromSquare || !toSquare) return Promise.resolve(false);

  const hostRect = host.getBoundingClientRect();
  const fromRect = fromSquare.getBoundingClientRect();
  const toRect = toSquare.getBoundingClientRect();
  if (!fromRect.width || !toRect.width) return Promise.resolve(false);

  const pieceType = move.promotion || move.piece;
  if (!pieceType || !move.color) return Promise.resolve(false);

  els.board.classList.add("animating");
  fromSquare.classList.add("animating-from");
  toSquare.classList.add("animating-to");

  const ghost = document.createElement("span");
  ghost.className = `piece ${move.color} move-ghost`;
  ghost.innerHTML = pieceImageHtml(move.color, pieceType);
  ghost.style.width = `${fromRect.width}px`;
  ghost.style.height = `${fromRect.height}px`;
  ghost.style.left = `${fromRect.left - hostRect.left}px`;
  ghost.style.top = `${fromRect.top - hostRect.top}px`;
  host.append(ghost);

  const dx = toRect.left - fromRect.left;
  const dy = toRect.top - fromRect.top;

  return new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      ghost.remove();
      fromSquare.classList.remove("animating-from");
      toSquare.classList.remove("animating-to");
      els.board.classList.remove("animating");
      resolve(true);
    };

    ghost.addEventListener("transitionend", finish, { once: true });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        ghost.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      });
    });
    window.setTimeout(finish, MOVE_ANIMATION_MS + 80);
  });
}

async function renderAfterMoveAnimation(animation, callback) {
  await animation;
  renderAll();
  await callback?.();
}

function renderAll() {
  if (state.currentTab === "practice") {
    ensurePracticeTrainer();
  }
  renderBoard();
  renderGameMeta();
  renderClocks();
  renderCurrentPanel();
  saveJson(STORAGE_KEYS.settings, state.settings);
  saveJson(STORAGE_KEYS.profile, state.profile);
  saveJson(STORAGE_KEYS.practice, state.practiceQueue);
  saveJson(STORAGE_KEYS.practiceHistory, state.practiceHistory);
  saveJson(STORAGE_KEYS.calibration, state.calibration);
}

// The board can display either the live game or a variation replay walkthrough.
// getDisplayGame returns whichever chess.js instance to read positions from,
// and isInReplay signals to input handlers that clicks should not attempt moves.
function getDisplayGame() {
  const replay = state.variationReplay;
  if (replay?.chess) return replay.chess;
  const timelineChess = getTimelineChess();
  if (timelineChess) return timelineChess;
  return state.game;
}

function isInReplay() {
  return Boolean(state.variationReplay) || isTimelineActive();
}

// ─────────── Game timeline scrubbing ───────────
//
// Finished games can be stepped through on the MAIN board (arrow keys, move
// rows, the scrub bar) — before this, review only ever showed the final
// position. state.timeline = { ply } shows the position after that move
// (ply 0 = the starting position); null = live/final position.

let timelineCache = { ply: null, gameId: null, chess: null };

function isTimelineActive() {
  return Boolean(state.timeline);
}

function getTimelineChess() {
  const timeline = state.timeline;
  if (!timeline) return null;
  if (timelineCache.ply === timeline.ply && timelineCache.gameId === state.currentGameId && timelineCache.chess) {
    return timelineCache.chess;
  }
  let chess = null;
  try {
    if (timeline.ply <= 0) {
      chess = new Chess();
    } else {
      const record = state.moves.find((move) => move.ply === timeline.ply);
      if (record?.afterFen) chess = new Chess(record.afterFen);
    }
  } catch (error) {
    console.warn("Timeline position could not load", error);
  }
  if (!chess) {
    state.timeline = null;
    return null;
  }
  timelineCache = { ply: timeline.ply, gameId: state.currentGameId, chess };
  return chess;
}

// Steps the timeline. Reaching the final move returns to the live board.
function setTimelinePly(ply) {
  const total = state.moves.length;
  if (!total || !isCurrentGameFinished() || state.activeDrill || state.variationReplay) return;
  const clamped = Math.max(0, Math.min(total, ply));
  if (clamped >= total) {
    state.timeline = null;
    state.reviewPly = null;
  } else {
    state.timeline = { ply: clamped };
    state.reviewPly = clamped > 0 ? clamped : null;
  }
  clearSelection({ render: false });
  renderBoard();
  if (state.currentTab === "review") renderReviewPanel();
}

function stepTimeline(delta) {
  const total = state.moves.length;
  if (!total) return;
  const current = state.timeline ? state.timeline.ply : total;
  setTimelinePly(current + delta);
}

function clearTimeline(options = {}) {
  if (!state.timeline) return;
  state.timeline = null;
  timelineCache = { ply: null, gameId: null, chess: null };
  if (options.render !== false) renderBoard();
}

function renderBoard() {
  if (boardDrag?.isDragging()) {
    state.pendingBoardRender = true;
    return;
  }
  state.pendingBoardRender = false;
  // Rebuilding the grid destroys keyboard focus — remember which square had
  // it so the rebuilt board puts focus straight back.
  const focusedSquare = document.activeElement?.classList?.contains("square")
    ? document.activeElement.dataset.square
    : null;
  els.board.innerHTML = "";

  const displayGame = getDisplayGame();
  const inReplay = isInReplay();
  const liveQualityCue = inReplay ? null : getLiveMoveQualityCue();
  const selectedPiece = !inReplay && state.selectedSquare ? state.game.get(state.selectedSquare) : null;
  const replayLastMove = state.variationReplay?.moves?.[state.variationReplay.index - 1];
  const replayFrom = replayLastMove?.uci?.slice(0, 2);
  const replayTo = replayLastMove?.uci?.slice(2, 4);
  // Timeline scrubbing highlights the move that produced the shown position.
  const timelineRecord = state.timeline && state.timeline.ply > 0
    ? state.moves.find((move) => move.ply === state.timeline.ply)
    : null;

  for (const square of getBoardSquares()) {
    const fileIndex = FILES.indexOf(square[0]);
    const rankIndex = Number(square[1]) - 1;
    const piece = displayGame.get(square);
    const legalTarget = !inReplay && state.legalTargets.has(square);
    const targetCapture = legalTarget && selectedPiece && piece && piece.color !== selectedPiece.color;
    const squareQuality = liveQualityCue?.move.to === square ? liveQualityCue.quality : null;
    const practiceCue = inReplay ? null : getPracticeBoardCue(square);
    // In replay/timeline mode, highlight the relevant move instead of the
    // game's last move.
    const lastFromSquare = state.variationReplay
      ? replayFrom
      : state.timeline
        ? timelineRecord?.from
        : state.lastMove?.from;
    const lastToSquare = state.variationReplay
      ? replayTo
      : state.timeline
        ? timelineRecord?.to
        : state.lastMove?.to;
    const button = document.createElement("button");
    button.type = "button";
    button.className = [
      "square",
      (fileIndex + rankIndex) % 2 === 0 ? "dark" : "light",
      !inReplay && state.selectedSquare === square ? "selected" : "",
      legalTarget ? "target" : "",
      targetCapture ? "target-capture" : "",
      lastFromSquare === square ? "last-from" : "",
      lastToSquare === square ? "last-to" : "",
      squareQuality ? "quality-cued" : "",
      squareQuality ? qualityClassName(squareQuality.key) : "",
      practiceCue?.className || "",
    ].filter(Boolean).join(" ");
    button.dataset.square = square;
    // The occupying piece leads the label: without it a blind user hears
    // "e4, button" with no way to know a white pawn sits there.
    const occupant = piece ? `${piece.color === "w" ? "White" : "Black"} ${pieceName(piece.type)}` : "";
    const ariaDetails = [
      occupant,
      state.selectedSquare === square ? "Selected piece" : "",
      legalTarget ? (targetCapture ? "Legal capture" : "Legal move") : "",
      state.lastMove?.from === square ? "Last move started here" : "",
      state.lastMove?.to === square ? "Last move ended here" : "",
      squareQuality ? `${squareQuality.label}: ${squareQuality.reason}` : "",
      practiceCue?.label || "",
    ].filter(Boolean).join(". ");
    button.setAttribute("aria-label", ariaDetails ? `${square}. ${ariaDetails}` : `${square}. Empty square`);
    if (squareQuality || practiceCue?.label) {
      button.title = [squareQuality ? `${squareQuality.label}: ${squareQuality.reason}` : "", practiceCue?.label || ""]
        .filter(Boolean)
        .join(" ");
    }

    if (piece) {
      const img = document.createElement("img");
      img.className = `piece ${piece.color}`;
      img.src = pieceSpriteUrl(piece.color, piece.type);
      img.alt = "";
      img.draggable = false;
      button.append(img);
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

  if (focusedSquare) {
    els.board.querySelector(`[data-square="${focusedSquare}"]`)?.focus();
  }

  paintBoardArrows();
  paintEvalBar();
}

function paintBoardArrows() {
  if (!els.boardArrows) return;
  const arrows = getActiveBoardArrows();
  const flipped = isBoardFlipped();
  els.boardArrows.innerHTML = arrowsOverlaySvg(arrows, flipped);
  els.boardArrows.setAttribute("data-count", String(arrows.length));
  els.boardArrows.classList.toggle("has-arrows", arrows.length > 0);
}

function getActiveBoardArrows() {
  const arrows = [];
  if (state.variationReplay?.moves?.length) {
    // Show the next PV move so the user knows what's coming.
    const upcoming = state.variationReplay.moves[state.variationReplay.index];
    if (upcoming) arrows.push({ ...uciToArrow(upcoming.uci, "replay") });
    return arrows;
  }
  if (!state.settings.showBestArrow || !isCalibrationComplete()) return arrows;
  // Timeline scrubbing shows the position AFTER the selected move — a
  // best-move arrow (computed for the before-position) would point at the
  // wrong board. The last-move highlight already marks the played move.
  if (isTimelineActive()) return arrows;
  const latest = getLatestPlayerMove();
  if (!latest) return arrows;
  if (state.currentTab === "review") {
    // In Review, show a comparison for the selected move: played + best —
    // but only when the big board actually displays the position that move
    // was played in (the latest one). For earlier plies the main board still
    // shows the final position, so arrows there would point at squares
    // occupied by entirely different pieces.
    const selected = state.reviewPly != null
      ? state.moves.find((move) => move.ply === state.reviewPly)
      : null;
    const focus = selected?.role === "player" ? selected : latest;
    const lastPly = state.moves.length ? state.moves[state.moves.length - 1].ply : null;
    if (focus?.ply !== lastPly && selected) return arrows;
    if (focus?.uci) arrows.push({ from: focus.uci.slice(0, 2), to: focus.uci.slice(2, 4), kind: "played" });
    if (focus?.bestMoveUci && focus.bestMoveUci !== focus.uci) {
      arrows.push({ ...uciToArrow(focus.bestMoveUci, "best") });
    }
    return arrows;
  }
  // In play, only show the best-move arrow when the player's most recent
  // move was a real mistake and it isn't your turn (arrow points at what
  // they should have played on their prior move).
  if (["blunder", "missed_win", "mistake"].includes(latest.qualityKey) && latest.bestMoveUci && latest.bestMoveUci !== latest.uci) {
    arrows.push({ ...uciToArrow(latest.bestMoveUci, "best") });
  }
  return arrows;
}

function paintEvalBar() {
  if (!els.evalBar) return;
  const enabled = state.settings.showEvalBar && isCalibrationComplete() && !state.activeDrill;
  if (!enabled) {
    els.evalBar.hidden = true;
    return;
  }
  const latest = getLatestGradedMove();
  if (!latest) {
    els.evalBar.hidden = true;
    return;
  }
  els.evalBar.hidden = false;
  const { percent, label } = evalBarFromMove(latest);
  // The bar tracks board orientation like chess sites: the white fill is
  // anchored to whichever side White plays from, so "my side growing = good
  // for me" holds when playing Black too (see .eval-bar.flipped in CSS).
  els.evalBar.classList.toggle("flipped", isBoardFlipped());
  els.evalBarFill.style.height = `${percent}%`;
  els.evalBarLabel.textContent = label;
}

function getLatestGradedMove() {
  for (let i = state.moves.length - 1; i >= 0; i--) {
    const move = state.moves[i];
    if (typeof move.evalAfter === "number" || typeof move.mateAfter === "number") return move;
  }
  return null;
}

function evalBarFromMove(move) {
  // eval is from the side-to-move's perspective in the position AFTER the
  // move; convert to White's perspective for the bar.
  const afterFen = move.afterFen || "";
  const sideToMove = afterFen.split(" ")[1] || "w";
  const sign = sideToMove === "w" ? 1 : -1;
  if (typeof move.mateAfter === "number") {
    const whiteMate = move.mateAfter * sign;
    return {
      percent: whiteMate > 0 ? 100 : 0,
      label: whiteMate > 0 ? `M${whiteMate}` : `-M${Math.abs(whiteMate)}`,
    };
  }
  if (typeof move.evalAfter === "number") {
    const whiteCp = move.evalAfter * sign;
    // Smooth sigmoid so ±800cp is nearly capped.
    const clamped = Math.max(-1000, Math.min(1000, whiteCp));
    const percent = 50 + 50 * Math.tanh(clamped / 350);
    const displayPawns = (whiteCp / 100).toFixed(1);
    return { percent, label: `${whiteCp > 0 ? "+" : ""}${displayPawns}` };
  }
  return { percent: 50, label: "" };
}

function getPlayerSeatSubLabel() {
  // Drill boards never populate state.moves — a frozen "White · move 1"
  // through a whole mate ladder read as broken. Show the training context.
  if (state.activeDrill) {
    return `${colorName(state.activeDrill.playerColor || "w")} · training`;
  }
  const moveNumber = Math.floor(state.moves.length / 2) + 1;
  return `${colorName(state.settings.playerColor)} · move ${moveNumber}`;
}

function normalizeDisplayName(name) {
  const normalized = String(name || "").trim().replace(/\s+/g, " ");
  return normalized.slice(0, 32) || DEFAULT_SETTINGS.displayName;
}

function getDisplayName() {
  return normalizeDisplayName(state.settings.displayName);
}

function getAvatarLabel(name = getDisplayName()) {
  return normalizeDisplayName(name).slice(0, 1).toUpperCase() || "Y";
}

function normalizeBotName(name) {
  const normalized = String(name || "").trim().replace(/\s+/g, " ");
  return normalized.slice(0, 32) || DEFAULT_SETTINGS.botName;
}

function getBotName() {
  return normalizeBotName(state.settings.botName);
}

function getOpponentSeatLabels() {
  if (state.activeDrill) {
    if (isLessonDrill()) {
      return { name: "Chess Teacher", sub: getActiveLesson()?.title || "Learn to play" };
    }
    if (isPracticeTrainerDrill()) {
      return { name: "Practice Trainer", sub: state.activeDrill.plainTitle || state.activeDrill.type || "Puzzle" };
    }
    return { name: "Training Board", sub: state.activeDrill.type || "Drill" };
  }
  const fallbackSuffix = state.engineFallback && !state.engine ? " · simplified engine" : "";
  const name = getBotName();
  if (!isCalibrationComplete()) {
    if (state.settings.beginnerMode === true) {
      return { name, sub: `Gentle opponent · no clock${fallbackSuffix}` };
    }
    return { name, sub: `First game · finding your level${fallbackSuffix}` };
  }
  const score = getEstimatedTrainingScore();
  return { name, sub: `${score ? `Adaptive · score ${score}` : "Adaptive"}${fallbackSuffix}` };
}

// Click-to-edit rename for the opponent seat: the name button swaps to a
// text input; Enter/blur commits, Escape cancels. Disabled during drills
// (the seat is a trainer/lab label there, not the bot).
function startOpponentRename() {
  if (state.activeDrill || state.opponentRename.active) return;
  state.opponentRename.active = true;

  const nameButton = els.opponentSeatName;
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 32;
  input.value = getBotName();
  input.className = "seat-rename-input";
  input.setAttribute("aria-label", "Opponent name");

  nameButton.hidden = true;
  nameButton.insertAdjacentElement("afterend", input);
  input.focus();
  input.select();

  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    if (commit) {
      state.settings.botName = normalizeBotName(input.value);
      saveJson(STORAGE_KEYS.settings, state.settings);
    }
    input.remove();
    nameButton.hidden = false;
    state.opponentRename.active = false;
    renderGameMeta();
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
}

function sortCapturedPieces(pieces) {
  return [...pieces].sort((a, b) => {
    const valueDiff = (PIECE_VALUES[b.type] || 0) - (PIECE_VALUES[a.type] || 0);
    if (valueDiff) return valueDiff;
    return CAPTURE_ORDER.indexOf(a.type) - CAPTURE_ORDER.indexOf(b.type);
  });
}

function getCapturedPieces() {
  const playerColor = state.activeDrill?.playerColor || state.settings.playerColor;
  const capturedByPlayer = [];
  const capturedByOpponent = [];

  for (const move of state.moves) {
    if (!move.captured) continue;
    const capturedPiece = {
      type: move.captured,
      color: opposite(move.color),
      value: PIECE_VALUES[move.captured] || 0,
    };
    if (move.color === playerColor) {
      capturedByPlayer.push(capturedPiece);
    } else {
      capturedByOpponent.push(capturedPiece);
    }
  }

  return {
    player: sortCapturedPieces(capturedByPlayer),
    opponent: sortCapturedPieces(capturedByOpponent),
  };
}

function getMaterialBalance(captures = getCapturedPieces()) {
  const playerValue = captures.player.reduce((sum, piece) => sum + piece.value, 0);
  const opponentValue = captures.opponent.reduce((sum, piece) => sum + piece.value, 0);
  return playerValue - opponentValue;
}

function renderCapturedTray(label, pieces, balanceText = "") {
  const pieceHtml = pieces.map((piece) => `
    <span class="captured-piece ${piece.color}" aria-label="${escapeAttr(colorName(piece.color))} ${escapeAttr(pieceName(piece.type))}">${pieceImageHtml(piece.color, piece.type, "captured-piece-img")}</span>
  `).join("");
  return `
    <span class="capture-label">${escapeHtml(toTitleCaseLabel(label))}</span>
    <span class="captured-pieces">${pieceHtml || `<span class="capture-empty">${escapeHtml(toTitleCaseLabel("No captures"))}</span>`}</span>
    ${balanceText ? `<span class="material-balance">${escapeHtml(balanceText)}</span>` : ""}
  `;
}

function getStorageStatusLabel() {
  if (state.sync.reachable) return "Cloud sync ready";
  if (!state.server.syncConfigured) return "Local only";
  if (!isSignedIn()) return "Sign in required";
  if (state.sync.reachable === false) return "Cloud sync unavailable";
  return "Cloud sync configured";
}

function isSignedIn() {
  return Boolean(state.auth.session && state.auth.user);
}

function canCloudSync() {
  return state.server.syncConfigured && isSignedIn();
}

function isSupabaseReady() {
  return state.sync.reachable === true;
}

function isOpenAIReady() {
  return state.openAI.configured === true && state.openAI.online === true;
}

function isCoachAvailable() {
  // Configured is what matters for the input: a momentarily-failed health
  // probe must not lock the chat box. If the service is truly down, sending
  // fails with a friendly error and a retry button.
  return state.openAI.configured === true;
}

function getRequiredServiceRows() {
  const syncDetail = isSupabaseReady()
    ? "Online and writable."
    : state.sync.health
      || (!state.server.syncConfigured
        ? "Not configured on the server. History stays in this browser."
        : isSignedIn() ? "Checking cloud sync..." : "Sign in to sync your history.");

  return [
    {
      name: "Account & sync",
      ready: isSupabaseReady(),
      detail: syncDetail,
    },
    {
      name: "Personal coach",
      ready: isOpenAIReady(),
      detail: isOpenAIReady()
        ? "Online."
        : state.openAI.status || "The coach is not available right now.",
    },
    {
      name: "Chess engine",
      ready: Boolean(state.engine),
      detail: state.engine
        ? "Ready — runs on your device."
        : state.engineFallback
          ? "The engine failed to load — you're facing a simplified opponent and move review uses basic analysis only. Reload to retry."
          : "Loading the engine...",
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
      <span class="label">Services</span>
      <strong>Coach and sync status</strong>
      <p>Play always works on this device. The personal coach and long-term history sync need a connection and a signed-in account.</p>
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
  document.querySelector("#openSettingsButton")?.addEventListener("click", () => switchTab("you"));
}

function renderCoachOfflineBanner() {
  if (isCoachAvailable()) return "";
  return `
    <article class="mini-card coach-offline-banner">
      <span class="label">Coach offline</span>
      <p>Playing with local analysis only. ${escapeHtml(state.openAI.status || "The personal coach is offline right now — check Settings.")}</p>
    </article>
  `;
}

function renderGameMeta() {
  const activePlayerColor = state.activeDrill?.playerColor || state.settings.playerColor;
  const playerToMove = state.game.turn() === activePlayerColor;
  const gameOver = state.game.isGameOver();
  const captures = getCapturedPieces();
  const materialBalance = getMaterialBalance(captures);

  // Opponent seat
  const opponentLabels = getOpponentSeatLabels();
  if (!state.opponentRename?.active) {
    els.opponentSeatName.textContent = opponentLabels.name;
  }
  els.opponentSeatName.disabled = Boolean(state.activeDrill);
  els.opponentSeatSub.textContent = opponentLabels.sub;
  if (els.opponentAvatar) {
    els.opponentAvatar.textContent = state.activeDrill ? "LAB" : getAvatarLabel(getBotName());
  }

  // Player seat
  if (els.playerSeatName) {
    els.playerSeatName.textContent = getDisplayName();
  }
  if (els.playerAvatar) {
    els.playerAvatar.textContent = getAvatarLabel();
  }
  els.playerSeatSub.textContent = getPlayerSeatSubLabel();
  const playerPillText = state.activeDrill
    ? (state.activeDrill.solved || state.activeDrill.completed ? "Solved" : "Training")
    : gameOver
      ? "Game Over"
      : playerToMove
        ? "Your Turn"
        : "Waiting";
  const opponentPillText = state.activeDrill
    ? "Training"
    : gameOver
      ? "Game Over"
      : playerToMove
        ? "Waiting"
        : (state.thinking ? "Opponent Thinking" : "Opponent Turn");
  els.playerSeatPill.classList.toggle("active", !gameOver && playerToMove);
  els.playerSeatPill.classList.toggle("waiting", gameOver || !playerToMove);
  els.playerSeatPill.innerHTML = `<span class="dot"></span> ${escapeHtml(toTitleCaseLabel(playerPillText))}`;
  if (els.opponentSeatPill) {
    els.opponentSeatPill.classList.toggle("active", !gameOver && !playerToMove);
    els.opponentSeatPill.classList.toggle("waiting", gameOver || playerToMove);
    els.opponentSeatPill.innerHTML = `<span class="dot"></span> ${escapeHtml(toTitleCaseLabel(opponentPillText))}`;
  }
  if (els.playerCaptureTray) {
    els.playerCaptureTray.classList.toggle("empty", captures.player.length === 0);
    setTrayContent(els.playerCaptureTray, renderCapturedTray("You captured", captures.player, materialBalance > 0 ? `+${materialBalance}` : ""));
  }
  if (els.opponentCaptureTray) {
    els.opponentCaptureTray.classList.toggle("empty", captures.opponent.length === 0);
    setTrayContent(els.opponentCaptureTray, renderCapturedTray("They captured", captures.opponent, materialBalance < 0 ? `+${Math.abs(materialBalance)}` : ""));
  }

  // Seat turn indicator
  els.seatOpponent.classList.toggle("turn", !gameOver && !playerToMove);
  els.seatPlayer.classList.toggle("turn", !gameOver && playerToMove);
  els.seatOpponent.classList.toggle("inactive-turn", !gameOver && playerToMove);
  els.seatPlayer.classList.toggle("inactive-turn", !gameOver && !playerToMove);

  announceGameStatus(gameOver, playerToMove);

  // Practice tab badge
  if (els.practiceBadge) {
    const count = state.practiceQueue.length;
    els.practiceBadge.textContent = String(count);
    els.practiceBadge.hidden = count === 0;
  }

  // Ctx-head reflects the current tab
  updateCtxHead(state.currentTab);

  els.newGameButton.disabled = state.thinking || Boolean(state.activeDrill);
  // Resign only makes sense for a live game with real moves — it gives an
  // honest way out (counted like any loss) instead of stranding abandoned
  // games as "In progress" forever.
  if (els.resignButton) {
    els.resignButton.hidden = Boolean(state.activeDrill)
      || !state.moves.length
      || state.game.isGameOver()
      || Boolean(state.clocks?.flagged);
  }
}

// Turn/check/game-over changes are announced once to screen readers (color
// changes on the pills alone are invisible to them).
let lastGameStatusAnnounced = "";

function announceGameStatus(gameOver, playerToMove) {
  const announcer = document.querySelector("#gameStatusAnnouncer");
  if (!announcer) return;
  let status = "";
  if (state.activeDrill) {
    status = "";
  } else if (gameOver || state.clocks?.flagged) {
    status = `Game over. ${getResultLabel()}`;
  } else {
    status = playerToMove ? "Your turn" : "Opponent's turn";
    if (state.game.isCheck()) status += ". Check";
  }
  if (status && status !== lastGameStatusAnnounced) {
    lastGameStatusAnnounced = status;
    announcer.textContent = status;
  }
}

function updateCtxHead(tab) {
  if (!els.ctxHeadTitle || !els.ctxHeadMeta) return;
  const titles = {
    today: "Today",
    play: "Play",
    review: "Review",
    practice: "Practice",
    learn: "Learn",
    you: "You",
  };
  els.ctxHeadTitle.textContent = titles[tab] || "";
  els.ctxHeadMeta.textContent = ctxHeadMetaFor(tab);
}

function ctxHeadMetaFor(tab) {
  const calibrated = isCalibrationComplete();
  switch (tab) {
    case "today":
      return calibrated ? todayLocalKey() : "Getting started";
    case "play":
      if (state.activeDrill) return "Training";
      return calibrated ? "Adaptive" : "Calibration game";
    case "review": {
      if (!isCurrentGameFinished()) return "";
      const moveCount = Math.ceil(state.moves.length / 2);
      return moveCount ? `${moveCount} ${moveCount === 1 ? "move" : "moves"}` : "";
    }
    case "practice": {
      if (calibrated) {
        const stats = getPracticeStats();
        return `Trainer · streak ${stats.streak}`;
      }
      return "Locked until calibration";
    }
    case "learn": {
      const done = LESSONS.filter((lesson) => state.learn.completed.includes(lesson.id)).length;
      return done >= LESSONS.length ? "Complete" : `${done}/${LESSONS.length} lessons`;
    }
    default:
      return "";
  }
}

function renderCurrentPanel() {
  if (state.currentTab === "today") renderTodayPanel();
  if (state.currentTab === "play") renderCoachPanel();
  if (state.currentTab === "review") renderReviewPanel();
  if (state.currentTab === "practice") renderPracticePanel();
  if (state.currentTab === "learn") renderLearnPanel();
  if (state.currentTab === "you") {
    // "You" stacks both sections in one scroll (their <h2>s become visible
    // section headers via CSS).
    renderProfilePanel();
    renderSettingsPanel();
  }
}

// The capture trays are aria-live regions: rewriting identical markup on
// every render makes screen readers re-announce "You captured …" after every
// move. Only touch the DOM when the content actually changed.
function setTrayContent(tray, html) {
  if (tray.dataset.sig === html) return;
  tray.dataset.sig = html;
  tray.innerHTML = html;
}

function renderCoachPanel() {
  if (state.activeDrill) {
    if (isLessonDrill()) {
      els.coachPanel.innerHTML = `
        <h2>Coach</h2>
        <div class="stack">
          <article class="mini-card lesson-active-card">
            <span class="label">Lesson active</span>
            <strong>${escapeHtml(getActiveLesson()?.title || "Learn to play")}</strong>
            <p>${escapeHtml(state.lessonFlash?.text || state.drillMessage || "")}</p>
            <button id="openLearnTabButton" type="button">Open the lesson</button>
          </article>
        </div>
      `;
      document.querySelector("#openLearnTabButton")?.addEventListener("click", () => switchTab("learn"));
      return;
    }
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

    // Mate/opening drills keep their answers in drill-specific fields and
    // their live feedback in drillMessage — the old "candidate reveal" here
    // read a field no reachable drill populates and rendered nothing.
    els.coachPanel.innerHTML = `
      <h2>Coach</h2>
      <div class="stack">
        <article class="mini-card">
          <span class="label">${escapeHtml(state.activeDrill.type)}</span>
          <strong>${escapeHtml(state.activeDrill.title)}</strong>
          <p>${escapeHtml(state.drillMessage || state.activeDrill.objective)}</p>
          <button id="openDrillTabButton" type="button">Open the practice board</button>
        </article>
      </div>
    `;
    document.querySelector("#openDrillTabButton")?.addEventListener("click", () => switchTab("practice"));
    return;
  }

  if (!isCalibrationComplete()) {
    // Brand-new player on this account: ask about experience before pointing
    // them at a silent calibration game. Empty "New game" presses don't count
    // as playing — only games with moves dismiss the question.
    const hasPlayedAnything = state.localGames.some((game) => Array.isArray(game.moves) && game.moves.length);
    const freshStart = !state.learn.pathChosen
      && !state.learn.completed.length
      && !hasPlayedAnything
      && !state.moves.length;
    if (freshStart) {
      els.coachPanel.innerHTML = `
        <h2>Coach</h2>
        <div class="stack">
          <article class="mini-card learn-path-card">
            <span class="label">Welcome</span>
            <strong>Have you played chess before?</strong>
            <p>If you're new (or rusty), a short set of interactive lessons teaches every rule right on the board. If you already know how to play, jump straight into your first game.</p>
            <div class="button-row">
              <button id="choosePathBeginnerButton" class="primary-action" type="button">I'm new — teach me</button>
              <button id="choosePathExperiencedButton" type="button">I know how to play</button>
            </div>
          </article>
          ${renderCoachOfflineBanner()}
        </div>
      `;
      document.querySelector("#choosePathBeginnerButton")?.addEventListener("click", () => chooseLearnPath(true));
      document.querySelector("#choosePathExperiencedButton")?.addEventListener("click", () => chooseLearnPath(false));
      return;
    }

    // Beginner path: nudge toward the lessons until they're done (or the
    // learner starts a game anyway — playing is always allowed).
    if (state.settings.beginnerMode === true && !allLessonsComplete(state.learn.completed) && !state.moves.length) {
      const next = getResumeLesson();
      els.coachPanel.innerHTML = `
        <h2>Coach</h2>
        <div class="stack">
          <article class="mini-card learn-path-card">
            <span class="label">Learn to play</span>
            <strong>${state.learn.completed.length ? "Keep going — you're learning fast" : "Start with the lessons"}</strong>
            <p>${escapeHtml(next ? `Next up: ${next.title}. ${next.summary}` : "")}</p>
            <p class="lesson-tip">Tip: ${escapeHtml(getCurrentBeginnerTip())}</p>
            <div class="button-row">
              <button id="resumeLessonsButton" class="primary-action" type="button">${state.learn.completed.length ? "Continue lessons" : "Start lessons"}</button>
            </div>
            <p class="lesson-task-note">Prefer to just play? Make a move on the board — your first finished game calibrates the coach.</p>
          </article>
          ${renderCoachOfflineBanner()}
        </div>
      `;
      document.querySelector("#resumeLessonsButton")?.addEventListener("click", () => {
        const target = getResumeLesson();
        if (target) startLesson(target.id);
        else switchTab("learn");
      });
      return;
    }

    els.coachPanel.innerHTML = `
      <h2>Coach</h2>
      <div class="stack">
        <article class="mini-card calibration-card">
          <span class="label">Calibration game</span>
          <strong>Play your first game</strong>
          <p>No hints or commentary during this one — just play the moves you'd normally play. When it ends, coaching, move feedback, and an opponent matched to your level all unlock.</p>
          ${state.settings.beginnerMode === true ? `<p>Beginner mode is on: the opponent stays gentle while you find your feet.</p>` : ""}
        </article>
        ${state.settings.beginnerMode === true ? renderBeginnerCheatSheet() : ""}
        ${renderCoachOfflineBanner()}
      </div>
    `;
    bindBeginnerCheatSheet();
    return;
  }

  const draft = captureChatDraft();
  els.coachPanel.innerHTML = `
    <h2>Coach</h2>
    <div class="coach-chat">
      ${renderCoachOfflineBanner()}
      ${renderRethinkCard()}
      <div class="coach-chat-log" id="coachChatLog">
        ${renderChatMessages()}
      </div>
      <div id="coachChatAnnouncer" class="visually-hidden" aria-live="polite"></div>
      <form class="coach-chat-form" id="coachChatForm">
        <input
          id="coachChatInput"
          type="text"
          autocomplete="off"
          aria-label="Ask your coach"
          placeholder="${state.pendingCoachQuestion ? "Answer the coach..." : "Ask your coach anything..."}"
          ${isCoachAvailable() ? "" : "disabled"}
        >
        <button type="submit" ${isCoachAvailable() ? "" : "disabled"}>Send</button>
      </form>
    </div>
  `;
  bindCoachChat();
  restoreChatDraft(draft);
  announceLatestCoachMessage();
  scrollChatToBottom();
}

function renderChatMessages() {
  const messages = getCurrentChatMessages();
  // IMPORTANT: bubbles use `white-space: pre-wrap`, so this markup must not
  // contain any incidental template whitespace — it would render as phantom
  // padding inside every bubble.
  const rows = messages.map(chatBubbleHtml).join("");
  const streamingHasContent = messages.some((message) => message.streaming && message.content);
  const thinking = state.coachThinking && !streamingHasContent
    ? '<div class="chat-message from-coach chat-thinking"><span></span><span></span><span></span></div>'
    : "";
  const error = state.coachError
    ? `<div class="chat-message chat-error">${escapeHtml(state.coachError)}${state.coachRetry ? ` <button id="coachRetryButton" class="chat-retry" type="button">Try again</button>` : ""}</div>`
    : "";
  if (!rows && !thinking && !error) {
    return `<p class="empty-state coach-chat-empty">I'm here for the whole game — I'll speak up at important moments, and you can ask me anything: plans, threats, what to study.</p>`;
  }
  return rows + thinking + error;
}

function chatBubbleHtml(message) {
  if (message.kind === "divider") {
    return `<div class="chat-divider"><span>${escapeHtml(message.content || "New game")}</span></div>`;
  }
  // An empty bubble would render as a bare pill — during streaming the
  // thinking dots cover that phase; finalized empty messages (e.g. a
  // question-only reply) simply don't render.
  if (!message.content) return "";
  const classes = ["chat-message", message.role === "user" ? "from-user" : "from-coach"];
  if (message.isQuestion) classes.push("coach-question");
  return `<div class="${classes.join(" ")}"${message.streaming ? ` data-streaming="${escapeAttr(message.streaming)}"` : ""}>${escapeHtml(message.content)}</div>`;
}

function captureChatDraft() {
  const input = document.querySelector("#coachChatInput");
  if (!input) return null;
  return {
    value: input.value,
    focused: document.activeElement === input,
    start: input.selectionStart,
    end: input.selectionEnd,
  };
}

function restoreChatDraft(draft) {
  if (!draft || (!draft.value && !draft.focused)) return;
  const input = document.querySelector("#coachChatInput");
  if (!input) return;
  input.value = draft.value;
  if (draft.focused) {
    input.focus();
    try {
      input.setSelectionRange(draft.start, draft.end);
    } catch {
      /* selection restore is best-effort */
    }
  }
}

// Screen-reader announcements: the chat log itself is NOT a live region
// (innerHTML repaints would re-announce the whole transcript). Instead, the
// latest completed coach message is mirrored once into a hidden announcer.
let lastAnnouncedChatAt = "";

function announceLatestCoachMessage() {
  const announcer = document.querySelector("#coachChatAnnouncer");
  if (!announcer) return;
  const messages = getCurrentChatMessages();
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.kind || message.streaming) continue;
    if (message.role !== "assistant") return;
    if (message.at === lastAnnouncedChatAt) return;
    lastAnnouncedChatAt = message.at;
    announcer.textContent = message.content;
    return;
  }
}

// Targeted chat update: repaints the log and form state without rebuilding
// the whole panel, so an in-progress draft (and its caret) is never touched.
function renderChatLog() {
  if (state.currentTab !== "play") return;
  const log = document.querySelector("#coachChatLog");
  if (!log) {
    renderCoachPanel();
    return;
  }
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  log.innerHTML = renderChatMessages();
  log.querySelector("#coachRetryButton")?.addEventListener("click", retryCoachChat);
  announceLatestCoachMessage();
  const form = document.querySelector("#coachChatForm");
  if (form) {
    const button = form.querySelector("button[type=submit]");
    // Messages sent while the coach is thinking queue up behind the current
    // reply (requestCoachChat serializes them), so the button stays usable.
    if (button) button.disabled = !isCoachAvailable();
    const input = form.querySelector("input");
    if (input) input.placeholder = state.pendingCoachQuestion ? "Answer the coach..." : "Ask your coach anything...";
  }
  if (nearBottom) log.scrollTop = log.scrollHeight;
}

function scrollChatToBottom() {
  const log = document.querySelector("#coachChatLog");
  if (log) log.scrollTop = log.scrollHeight;
}

function bindCoachChat() {
  document.querySelector("#coachChatForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#coachChatInput");
    const text = input?.value.trim();
    if (!text) return;
    input.value = "";
    // Sending while the coach is mid-reply is fine: requestCoachChat
    // serializes requests, so this message queues behind the current one.
    handleUserChatMessage(text);
  });
  // The retry button also renders in full-panel paints, not only in
  // renderChatLog's targeted repaint — bind it here too or it plays dead
  // after any tab switch.
  document.querySelector("#coachRetryButton")?.addEventListener("click", retryCoachChat);
  bindRethinkCard();
}

// ("Today's skill focus" card removed here: it had regressed into
// unreachable dead code. Phase 2's coach action buttons reintroduce the
// skill-focus handoff properly.)

function renderPositionBriefCard() {
  const brief = getPositionBrief();
  return `
    <article class="mini-card">
      <strong>${escapeHtml(brief.title)}</strong>
      <p>${escapeHtml(brief.body)}</p>
      ${brief.details.length ? `
        <div class="tag-list">
          ${brief.details.map((detail) => `<span class="tag">${escapeHtml(toTitleCaseLabel(detail))}</span>`).join("")}
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
    ? moveTags.map((tag) => `<span class="tag ${tag.severity >= 3 ? "danger" : "warn"}">${escapeHtml(toTitleCaseLabel(formatTagTerm(tag)))}</span>`).join("")
    : `<span class="tag good">${escapeHtml(toTitleCaseLabel("No issue tagged"))}</span>`;
  const qualityPill = quality
    ? `<span class="quality-pill ${qualityClassName(quality.key)}">${renderQualityBadgeHtml(move, "inline-quality-badge")}${escapeHtml(toTitleCaseLabel(quality.label))}</span>`
    : pendingQuality
      ? `<span class="quality-pill quality-pending">${escapeHtml(toTitleCaseLabel("Analyzing"))}</span>`
      : "";
  const reviewLines = formatMoveReviewTeaching(move, quality);
  const explanations = moveTags.map((tag) => `
    <div class="candidate-row teaching-row">
      <strong>${escapeHtml(formatTagTerm(tag))}</strong>
      <span>${escapeHtml(explainMoveTag(tag, move))}</span>
    </div>
  `).join("");

  return `
    <article class="mini-card">
      <strong>You played ${escapeHtml(move.san)}</strong>
      ${qualityPill ? `<div class="quality-summary">${qualityPill}</div>` : ""}
      ${reviewLines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
      <div class="tag-list">${tags}</div>
      ${explanations ? `<div class="candidate-list coach-candidates">${explanations}</div>` : ""}
    </article>
  `;
}

function getCandidateMovePrompt() {
  if (state.game.isGameOver()) return "The game is complete. Review the move list to find the turning point.";
  if (state.game.isCheck()) return "You are in check. Candidate moves are the legal replies: king moves, captures of the checking piece, and blocks.";
  const lastEngineMove = [...state.moves].reverse().find((move) => move.role === "engine");
  if (lastEngineMove) {
    return `A candidate move is a move worth checking before deciding. After ${lastEngineMove.san}, ask what changed, then compare the forcing options below.`;
  }
  return "A candidate move is a move worth checking before deciding. Compare forcing moves and one improving move from the current board.";
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
  const details = [
    formatPhaseLabel(getPhase(state.game)),
    shouldShowOpeningContext(opening) ? "opening context" : "",
  ].filter(Boolean);

  if (lastEngineMove) {
    const impact = describeMoveImpact(lastEngineMove);
    const body = [
      impact,
      threat ? `Check whether ${colorName(opposite(state.settings.playerColor))} is threatening ${threat}.` : "",
      formatOpeningContext(opening),
    ].filter(Boolean).join(" ");
    return {
      title: `Position after ${lastEngineMove.san}`,
      body,
      details,
    };
  }

  return {
    title: "Starting position",
    body: isCalibrationComplete()
      ? "Choose a first move that fits the opening you want to practice. The coach will adapt the plan from your game history."
      : "Play the move you would normally choose. This calibration game measures your habits; the coach unlocks when it ends.",
    details: details.filter((detail) => detail !== "opening context"),
  };
}

function formatPhaseLabel(phase) {
  if (phase === "opening") return "opening";
  if (phase === "middlegame") return "middlegame";
  if (phase === "endgame") return "endgame";
  return "";
}

function shouldShowOpeningContext(opening) {
  return Boolean(opening?.name && !["Starting position", "Unbooked line"].includes(opening.name));
}

function formatOpeningContext(opening) {
  if (!opening?.name) return "";
  if (opening.name === "Starting position") return "";
  if (opening.name === "Unbooked line") {
    return "This is no longer a named book line, which is fine. Use the position in front of you instead of memorizing a name.";
  }
  const planText = Array.isArray(opening.plans) && opening.plans.length
    ? ` The useful idea is: ${formatPlanList(opening.plans.slice(0, 2))}`
    : "";
  return `Opening context: ${opening.name} is a common early setup. You do not need to memorize the name yet.${planText}`;
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
  if (move.role === "player" && !move.tags?.length) {
    parts.push(move.note || "No immediate issue was tagged, but still compare the opponent's next forcing move.");
  } else if (move.role !== "player") {
    parts.push("Now check what this attacks, defends, or leaves behind.");
  }
  return parts.join(" ");
}

function formatMoveReviewTeaching(move, quality) {
  const lines = [];
  const impact = describeMoveImpact(move);
  if (impact) lines.push(`What changed: ${impact}`);
  if (quality?.reason) lines.push(quality.reason);

  const primary = move.tags?.[0];
  if (primary) {
    lines.push(formatHabitForTag(primary, move));
  } else if (!quality?.reason) {
    lines.push("Habit: after every move, check what your opponent can force next.");
  }

  return lines.length ? lines : ["No immediate issue was tagged. Still check the opponent's forcing reply before relaxing."];
}

function formatHabitForTag(tag, move) {
  const bestMove = move.bestMoveSan || move.bestMoveUci || extractMoveFromNote(move.note) || "";
  if (tag.category === "candidate_moves") {
    return bestMove
      ? `Habit: before quiet moves, name one move worth checking. Here, ${bestMove} was worth checking first.`
      : "Habit: before quiet moves, name one forcing move worth checking first.";
  }
  if (tag.category === "missed_pin" || tag.category === "missed_line_tactic") {
    return "Habit: scan bishop, rook, and queen lines before moving. A line piece can freeze a defender when something valuable sits behind it.";
  }
  if (tag.category === "missed_fork") {
    return "Habit: look for moves that attack two targets at once, especially checks by knights and queens.";
  }
  if (tag.category === "missed_mate") {
    return "Habit: check every legal check before choosing a quiet move.";
  }
  if (tag.category === "missed_capture" || tag.category === "hanging_piece") {
    return "Habit: before choosing a plan, ask which pieces are loose and whether any capture is safe.";
  }
  if (tag.category === "poor_trade") {
    return "Habit: calculate capture, recapture, and the final position before starting a trade.";
  }
  if (tag.category === "opening_principle") {
    return "Habit: in the opening, prefer center control, one new developed piece, and king safety before side ideas.";
  }
  if (tag.category === "king_safety") {
    return "Habit: when your king is central or exposed, check opponent checks before taking material.";
  }
  return tag.note || "Habit: pause before moving and compare at least one forcing alternative.";
}

function extractMoveFromNote(note) {
  const match = String(note || "").match(/\b([KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|O-O(?:-O)?)\b/);
  return match?.[1] || "";
}

function formatTagTerm(tag) {
  const terms = {
    candidate_moves: "Candidate move",
    missed_pin: "Pin",
    missed_line_tactic: "Line tactic",
    missed_skewer: "Skewer",
    missed_fork: "Fork",
    missed_mate: "Checkmate",
    missed_capture: "Loose piece",
    hanging_piece: "Loose piece",
    poor_trade: "Trade",
    opening_principle: "Opening habit",
    king_safety: "King safety",
  };
  return terms[tag?.category] || tag?.label || "Habit";
}

function explainMoveTag(tag, move) {
  const note = tag?.note || move.note || "";
  const bestMove = move.bestMoveSan || move.bestMoveUci || extractMoveFromNote(move.note) || "";
  const suffix = note ? ` ${note}` : "";
  if (tag.category === "candidate_moves") {
    return bestMove
      ? `A candidate move is a move worth checking before deciding. ${bestMove} deserved a look because forcing moves can change the position immediately.`
      : "A candidate move is a move worth checking before deciding, usually a check, capture, threat, or important defensive move.";
  }
  if (tag.category === "missed_pin") {
    return `A pin means one piece is stuck because the king or a more valuable piece is behind it.${suffix}`;
  }
  if (tag.category === "missed_line_tactic") {
    return `A line tactic uses a bishop, rook, or queen along a rank, file, or diagonal.${suffix}`;
  }
  if (tag.category === "missed_skewer") {
    return `A skewer attacks the valuable front piece first, then wins what sits behind it.${suffix}`;
  }
  if (tag.category === "missed_fork") {
    return `A fork is one move that attacks two important targets at the same time.${suffix}`;
  }
  if (tag.category === "missed_mate") {
    return `Checkmate means the king is attacked and has no legal escape.${suffix}`;
  }
  if (tag.category === "missed_capture" || tag.category === "hanging_piece") {
    return `A loose piece is not defended enough. Look for safe captures before quiet moves.${suffix}`;
  }
  if (tag.category === "poor_trade") {
    return `A trade is only good if the final position after the recapture is good for you.${suffix}`;
  }
  if (tag.category === "opening_principle") {
    return `Opening habits are about reaching a playable middlegame: center, development, and king safety.${suffix}`;
  }
  if (tag.category === "king_safety") {
    return `King safety matters because checks can force every move after that.${suffix}`;
  }
  return note || "This is a thinking habit to check before choosing your move.";
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

function buildPersonalSkillGuide(skill) {
  if (!skill) return LESSON_GUIDES.candidate_moves;

  const categories = getSkillCategories(skill);
  const primaryCategory = categories.find((category) => state.profile[category]) || skill.categoryAliases?.[0] || categories[0] || "candidate_moves";
  const guide = LESSON_GUIDES[primaryCategory] || LESSON_GUIDES.candidate_moves;
  const weakness = categories.map((category) => state.profile[category]).find(Boolean);
  const latestExample = weakness?.examples?.[0];
  const opening = detectOpening();
  const candidates = rankCandidateMoves(state.game.fen()).slice(0, 2).map((move) => move.san);

  if (weakness?.count) {
    return {
      why: `${skill.label} is showing up in your games ${weakness.count} time${weakness.count === 1 ? "" : "s"}. Most recent note: ${weakness.lastNote || latestExample?.note || guide.why}`,
      lookFor: [
        skill.scanPrompt,
        latestExample?.san ? `Review your ${latestExample.san} decision` : `Compare ${candidates.join(" and ") || "candidate moves"}`,
      ],
      drill: latestExample?.san
        ? `Replay the position before ${latestExample.san}. Before moving, say what your opponent threatens and why your candidate fixes or improves it.`
        : skill.focusPrompt || guide.drill,
    };
  }

  return {
    why: `${skill.label} has not become a recurring weakness yet. In this ${formatOpeningForGuide(opening)}, use it as a thinking checkpoint before you move.`,
    lookFor: candidates.length
      ? [`Compare ${candidates[0]}`, candidates[1] ? `Compare ${candidates[1]}` : "Find one quiet improving move", ...guide.lookFor.slice(0, 1)]
      : guide.lookFor,
    drill: skill.focusPrompt || `From the current board, choose a move and explain which ${skill.concepts?.[0] || "idea"} it improves. ${guide.drill}`,
  };
}

function formatOpeningForGuide(opening) {
  if (shouldShowOpeningContext(opening)) return `${opening.name} setup, a common opening pattern`;
  if (opening?.name === "Unbooked line") return "position outside a named opening line";
  return "position";
}

function buildFoundationSkillGuide(skill) {
  if (!skill) return LESSON_GUIDES.candidate_moves;
  return {
    why: `The coach is still learning your baseline. For now, ${skill.label.toLowerCase()} boards are general practice, not a claim about your weaknesses.`,
    lookFor: [
      skill.scanPrompt,
      "Play normally so the coach can learn from real decisions.",
    ],
    drill: skill.focusPrompt || "Use the board to practice one clear thinking habit before you move.",
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

function getSkillPriority(skill) {
  return getSkillCategories(skill).reduce((sum, category) => sum + getCategoryPriority(category), 0);
}

function getSkillPriorityReason(skill) {
  const categories = getSkillCategories(skill);
  const weakness = categories.map((category) => state.profile[category]).find(Boolean);
  const missed = state.practiceHistory.filter((item) => categories.includes(item.category) && item.result === "missed").length;
  const queued = state.practiceQueue.filter((item) => categories.includes(item.category)).length;

  if (weakness?.count) {
    return `${weakness.label} has appeared ${weakness.count} time${weakness.count === 1 ? "" : "s"} in your games.`;
  }

  if (missed) {
    return `You missed ${missed} recent drill${missed === 1 ? "" : "s"} in this area.`;
  }

  if (queued) {
    return `${queued} practice position${queued === 1 ? "" : "s"} are waiting from your games.`;
  }

  return skill.summary || "Foundation skill: keep it warm even when it is not your top weakness.";
}

function prioritizeSkills() {
  return SKILL_CATALOG
    .map((skill) => ({
      ...skill,
      priority: getSkillPriority(skill),
      reason: getSkillPriorityReason(skill),
    }))
    .sort((a, b) => b.priority - a.priority || a.label.localeCompare(b.label));
}

function getNextTrainingFocus() {
  const skills = prioritizeSkills();
  const top = skills[0];
  if (!top) return null;
  return {
    skillId: top.id,
    category: top.categoryAliases?.[0] || "candidate_moves",
    title: top.label,
    priority: top.priority,
    reason: top.reason,
  };
}

function normalizeCalibrationState() {
  const calibration = { ...DEFAULT_CALIBRATION, ...state.calibration };
  if (!Array.isArray(calibration.games)) calibration.games = [];
  // Legacy single-game shape: fold the one recorded score into the list.
  if (!calibration.games.length && calibration.done && Number.isFinite(calibration.estimatedScore)) {
    calibration.games = [{
      gameId: calibration.gameId || null,
      score: calibration.estimatedScore,
      at: calibration.completedAt || null,
    }];
  }
  state.calibration = calibration;
}

// Users who finished (or even started) the old 5-game placement flow already
// gave the app real evidence — count them as calibrated and reuse their score.
function migrateLegacyPlacement() {
  const legacy = loadJson(LEGACY_STORAGE_KEYS.placement, null);
  if (legacy) {
    const legacyGames = Array.isArray(legacy.games) ? legacy.games.length : 0;
    if (!state.calibration.done && (legacy.completedAt || legacyGames >= 1)) {
      const score = Number(legacy.estimatedScore) || estimateTrainingScoreFromGames(legacy.games || []);
      // A record with no usable score would seed calibration with null and
      // drag every later average toward the floor — skip instead.
      if (Number.isFinite(score) && score > 0) {
        const completedAt = legacy.completedAt || new Date().toISOString();
        state.calibration = {
          done: true,
          games: [{ gameId: legacy.games?.[0]?.gameId || null, score, at: completedAt }],
          estimatedScore: score,
          completedAt,
        };
        saveJson(STORAGE_KEYS.calibration, state.calibration);
      }
    }
  }
  localStorage.removeItem(LEGACY_STORAGE_KEYS.placement);
  localStorage.removeItem(LEGACY_STORAGE_KEYS.placementCardDismissed);
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

function summarizeGameForScore(gameRecord) {
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

function isCalibrationComplete() {
  return state.calibration?.done === true;
}

// ─────────── Per-dimension skill model ───────────

function ensureSkillState() {
  if (state.skill?.dims) return state.skill;
  const seedScore = Number(state.calibration?.estimatedScore) || null;
  state.skill = seedScore ? seedSkillStateFromScore(seedScore) : createEmptySkillState();
  saveJson(STORAGE_KEYS.skill, state.skill);
  return state.skill;
}

function updateSkillFromMove(record) {
  // Records are only ever created for real games (drill moves never reach
  // recordMove), so gate on the record itself — checking state.activeDrill
  // here would silently drop a live-game move whose grade happened to
  // resolve while a drill owned the board.
  if (!record || record.role !== "player") return;
  const skill = ensureSkillState();
  applyMoveToSkillState(skill, {
    phase: getPhase(record.beforeFen || state.game.fen()),
    tags: record.tags,
    qualityKey: record.qualityKey,
    evalDelta: record.evalDelta,
    evalBefore: record.evalBefore,
    mateBefore: record.mateBefore,
    mateAfter: record.mateAfter,
  });
  saveJson(STORAGE_KEYS.skill, skill);
}

function updateSkillFromGameResult(result) {
  const skill = ensureSkillState();
  applyGameResultToSkillState(skill, {
    resultScore: getPlayerResultScore(result, state.settings.playerColor),
    opponentElo: getCurrentBotElo(),
  });
  saveJson(STORAGE_KEYS.skill, skill);
  syncSkillRatings(skill);
}

// True while the current game IS the calibration game.
function isCalibrationGameActive() {
  return !isCalibrationComplete() && !state.activeDrill;
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

// Continuous calibration: the per-dimension skill model is the source of
// truth once it has data; otherwise blend the calibration seed with recent
// game evidence.
function getEstimatedTrainingScore() {
  const skillOverall = state.skill?.dims ? overallRating(state.skill) : null;
  if (skillOverall) return skillOverall;
  const seed = Number(state.calibration?.estimatedScore) || null;
  const recentScore = estimateTrainingScoreFromGames(getCompletedGames().slice(0, 8).map(summarizeGameForScore));
  if (seed && recentScore) return Math.round((seed + recentScore * 2) / 3);
  return recentScore || seed;
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
  if (isBeginnerBotActive()) {
    return 1;
  }
  if (!isCalibrationComplete()) {
    return CALIBRATION_DEPTH;
  }
  return getAdaptiveBotDepth();
}

// Beginner mode pins the opponent to the floor until the calibration games
// hand control to the adaptive skill model.
function isBeginnerBotActive() {
  return state.settings.beginnerMode === true && !isCalibrationComplete();
}

// Human-like opponent strength: Stockfish is Elo-limited instead of only
// depth-capped, so weaker settings blunder like people rather than playing
// shallow-but-perfect chess.
function getCurrentBotElo() {
  if (isBeginnerBotActive()) {
    return 500;
  }
  if (!isCalibrationComplete()) {
    return 1100;
  }
  const score = getEstimatedTrainingScore() || 900;
  const recent = getCompletedGames().slice(0, 3).map((game) => getPlayerResultScore(game.result, game.playerColor));
  let elo = score;
  if (recent.length >= 2) {
    const average = recent.reduce((sum, value) => sum + value, 0) / recent.length;
    if (average >= 0.67) elo += 100;
    if (average <= 0.25) elo -= 100;
  }
  // Beginner mode promises a gentle opponent — that must stay true after
  // calibration too (it used to silently become a normal adaptive bot).
  if (state.settings.beginnerMode === true) {
    elo = Math.min(elo, 800);
  }
  return clamp(Math.round(elo), 500, 2400);
}

function getOpponentStatusLabel() {
  if (state.activeDrill) return "Training board";
  if (!isCalibrationComplete()) return "Calibration opponent";
  return "Adaptive opponent";
}

// Average centipawn loss over graded player moves; null with too little data.
// evalDelta is a POSITIVE centipawn loss (see lib/classify.mjs).
function computeGameAcpl(moves) {
  const losses = (moves || [])
    .filter((move) => move.role === "player" && Number.isFinite(move.evalDelta))
    .map((move) => Math.max(0, move.evalDelta));
  if (losses.length < 4) return null;
  return losses.reduce((sum, value) => sum + value, 0) / losses.length;
}

// One game's placement score from result + measured centipawn loss.
function computeCalibrationGameScore(gameRecord, result) {
  const resultScore = getPlayerResultScore(result, gameRecord.playerColor || state.settings.playerColor);
  const acpl = computeGameAcpl(gameRecord.moves);
  const summary = summarizeGameForScore({ ...gameRecord, result });
  const acplPenalty = acpl === null
    ? (summary.averageMistakeSeverity || 0) * 40
    : acpl * 1.6;
  return clamp(Math.round(600 + CALIBRATION_DEPTH * 70 + resultScore * 260 - acplPenalty), 400, 1800);
}

// A calibration game must contain enough of the player's own moves to say
// anything about their level — a 1-move resignation must not complete
// placement off a single junk data point.
const CALIBRATION_MIN_PLAYER_MOVES = 8;

function recordCompletedGameForCalibration(result) {
  if (state.activeDrill) return;
  normalizeCalibrationState();
  const calibration = state.calibration;
  if (calibration.games.length >= CALIBRATION_GAME_TARGET) return;
  if (calibration.games.some((game) => game.gameId === state.currentGameId)) return;

  const current = state.localGames.find((game) => game.id === state.currentGameId);
  if (!current) return;

  const playerMoves = (current.moves || []).filter((move) => move.role === "player").length;
  if (playerMoves < CALIBRATION_MIN_PLAYER_MOVES) {
    if (!calibration.done) {
      pushChatMessage("assistant", "That one was too short to measure your level — play a fuller game (at least a handful of your own moves) and I'll set your starting point from it.");
      if (state.currentTab === "play") renderCoachPanel();
    }
    return;
  }

  const score = computeCalibrationGameScore(current, result);
  calibration.games = [...calibration.games, {
    gameId: state.currentGameId,
    score,
    at: new Date().toISOString(),
  }];
  applyCalibrationScores();
}

// Recomputes the blended placement score and (re)seeds untouched skill dims.
function applyCalibrationScores() {
  const calibration = state.calibration;
  // A legacy migration can leave entries without a usable score — averaging
  // them as 0 would drag the estimate toward the 400 floor.
  const scoredGames = calibration.games.filter((game) => Number.isFinite(game.score));
  if (!scoredGames.length) return;

  const mean = scoredGames.reduce((sum, game) => sum + game.score, 0) / scoredGames.length;
  calibration.estimatedScore = Math.round(mean);
  calibration.done = true;
  calibration.completedAt = calibration.completedAt || new Date().toISOString();
  saveJson(STORAGE_KEYS.calibration, calibration);

  // Seed skill dimensions that real graded moves haven't touched yet; dims
  // that already accumulated live data keep it. A seeded dim carries
  // SEED_SAMPLES synthetic samples — only samples beyond those count as
  // real data, otherwise games 2-3 could never refine the initial seed.
  const skill = ensureSkillState();
  const seeded = seedSkillStateFromScore(calibration.estimatedScore);
  for (const dim of SKILL_DIMENSIONS) {
    const entry = skill.dims[dim];
    const realSamples = entry ? (entry.seeded ? Math.max(0, entry.samples - SEED_SAMPLES) : entry.samples) : 0;
    if (!entry || entry.perf === null || realSamples < 8) {
      skill.dims[dim] = seeded.dims[dim];
    }
  }
  skill.calibratedAt = calibration.completedAt;
  saveJson(STORAGE_KEYS.skill, skill);
}

// After the deep post-game pass, the measured centipawn loss is far more
// trustworthy than the live depth-10 numbers — re-score any placement game.
function recalibrateFromDeepAnalysis(gameId) {
  normalizeCalibrationState();
  const entry = state.calibration.games.find((game) => game.gameId === gameId);
  if (!entry) return;

  const gameRecord = state.localGames.find((game) => game.id === gameId);
  if (!gameRecord?.result || gameRecord.result === "in_progress") return;

  const score = computeCalibrationGameScore(gameRecord, gameRecord.result);
  if (score === entry.score) return;
  entry.score = score;
  entry.deepened = true;
  applyCalibrationScores();
  if (state.currentTab === "you") {
    renderCurrentPanel();
  }
}

function getProfileSummary() {
  const games = getCompletedGames().length;
  const solved = state.practiceHistory.filter((item) => item.result === "solved").length;
  const missed = state.practiceHistory.filter((item) => item.result === "missed").length;
  const weaknessPenalty = Object.values(state.profile).reduce((sum, item) => sum + item.count * item.severity * 8, 0);
  const baseScore = getEstimatedTrainingScore();
  const score = Math.round(clamp((baseScore || 900) + solved * 10 - missed * 5 - weaknessPenalty, 400, 1800));
  const strengths = SKILL_CATALOG
    .filter((skill) => {
      const categories = getSkillCategories(skill);
      return !categories.some((category) => state.profile[category]?.count > 1);
    })
    .slice(0, 3)
    .map((skill) => {
      const categories = getSkillCategories(skill);
      const touched = categories.some((category) => state.profile[category]);
      return {
        title: skill.label,
        note: touched ? "Only one recent issue tagged here." : "No recurring issue tagged here yet.",
        score: touched ? "OK" : "Clean",
      };
    });

  return {
    score,
    games,
    solved,
    calibration: { done: isCalibrationComplete() },
    strengths,
  };
}

// Failures reaching the UI carry messages written for people ("Sign in
// required.") as often as messages written for logs ("Request failed with
// HTTP 502.", "Failed to fetch"). Pass the human ones through and swap the
// technical ones for a friendly fallback.
function friendlyServiceMessage(error, fallback) {
  const message = String(error?.message || "").trim();
  if (!message) return fallback;
  if (/HTTP\s*\d{3}/i.test(message)) return fallback;
  if (/^(failed to fetch|load failed|networkerror|typeerror|the operation was aborted)/i.test(message)) return fallback;
  return message;
}

async function checkOpenAIHealth(options = {}) {
  state.openAI.status = "Checking coach...";
  state.openAI.online = false;
  if (options.render !== false) renderAll();

  try {
    const data = await api.health(true);
    applyServerConfig(data);
    state.openAI.configured = Boolean(data.openaiConfigured);
    state.openAI.model = data.model || "";
    state.openAI.online = Boolean(data.openaiOnline);
    state.openAI.status = state.openAI.online
      ? "Coach online"
      : state.openAI.configured
        ? data.openaiError || "The coach is set up, but the service is not reachable right now."
        : "The coach is not set up on this server.";
    if ("dataOnline" in data && !data.dataOnline && data.dataError) {
      state.sync.health = data.dataError;
    }
  } catch (error) {
    // A failed *check* is not proof the coach is unconfigured. Flipping
    // `configured` off here used to disable the chat input entirely — even
    // for a 429 from clicking "Check services" a few times. Keep the last
    // known configuration and only report the check problem.
    state.openAI.online = false;
    const rateLimited = error instanceof ApiError && error.status === 429;
    state.openAI.status = rateLimited
      ? "Checked too often — give it a minute and try again."
      : friendlyServiceMessage(error, "Could not reach the server. Check your connection and try again.");
  }

  if (options.render !== false) {
    renderAll();
  }

  return isOpenAIReady();
}

// Copies /api/health server-level fields into state.
function applyServerConfig(data) {
  state.server.loaded = true;
  state.server.authRequired = Boolean(data.authRequired);
  state.server.syncConfigured = Boolean(data.syncConfigured);
  state.server.supabaseAuth = data.supabaseAuth || null;
  if (Array.isArray(data.pieceSets) && data.pieceSets.length) {
    state.server.pieceSets = data.pieceSets;
  }
  state.featureFlags.remoteHistoryEraseEnabled = Boolean(data.remoteHistoryEraseEnabled);
}

async function verifyRequiredServices() {
  state.sync.health = "Testing cloud sync...";
  state.openAI.status = "Checking coach...";
  state.openAI.online = false;
  renderAll();

  const openAIReady = await checkOpenAIHealth({ render: false });
  const syncReady = await verifyCloudSync({ render: false });

  renderAll();
  return syncReady && openAIReady;
}

// ─────────── Conversational coach ───────────

const CHAT_HISTORY_LIMIT = 80;

// Adds (or relabels) a divider row marking a game boundary in the transcript.
function appendChatDivider(label) {
  const messages = Array.isArray(state.coachChat.messages) ? state.coachChat.messages : [];
  const last = messages[messages.length - 1];
  if (last?.kind === "divider") {
    last.content = label;
  } else if (messages.length) {
    messages.push({ kind: "divider", role: "system", content: label, at: new Date().toISOString() });
  }
  state.coachChat.messages = messages.slice(-CHAT_HISTORY_LIMIT);
}

function getCurrentChatMessages() {
  if (state.coachChat.gameId !== state.currentGameId) {
    // Keep the visible transcript across games — a divider marks the boundary
    // instead of wiping the history the player may still want to re-read.
    appendChatDivider("New game");
    state.coachChat.gameId = state.currentGameId;
    persistCoachChat();
  }
  if (!Array.isArray(state.coachChat.messages)) state.coachChat.messages = [];
  return state.coachChat.messages;
}

// Only the current game's turns go to the model: everything after the last
// divider. Older games stay visible in the UI but out of the LLM context.
function currentGameChatTurns() {
  const messages = getCurrentChatMessages();
  let start = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].kind === "divider") {
      start = i + 1;
      break;
    }
  }
  return messages.slice(start).filter((message) => !message.kind);
}

function pushChatMessage(role, content, options = {}) {
  const messages = getCurrentChatMessages();
  messages.push({ role, content, isQuestion: Boolean(options.isQuestion), at: new Date().toISOString() });
  if (messages.length > CHAT_HISTORY_LIMIT) messages.splice(0, messages.length - CHAT_HISTORY_LIMIT);
  persistCoachChat();
  if (role === "assistant") notifyCoachMessage(content);
}

// ─────────── Ambient coach presence ───────────
//
// Coach messages arriving while the user is on another tab used to vanish
// silently. Show a dismissible bubble near the board plus an unread dot on
// the Play nav item.

let coachBubbleTimer = null;

function notifyCoachMessage(content) {
  if (!content || state.currentTab === "play") return;
  if (!isCalibrationComplete() || state.activeDrill) return;
  state.coachUnread = true;
  updateCoachUnreadBadge();
  showCoachBubble(content);
}

function updateCoachUnreadBadge() {
  const badge = document.querySelector("#coachUnreadBadge");
  if (badge) badge.hidden = !state.coachUnread;
}

function clearCoachUnread() {
  state.coachUnread = false;
  updateCoachUnreadBadge();
  hideCoachBubble();
}

function showCoachBubble(content) {
  const stage = document.querySelector(".stage");
  if (!stage) return;
  let bubble = document.querySelector("#coachBubble");
  if (!bubble) {
    bubble = document.createElement("button");
    bubble.id = "coachBubble";
    bubble.className = "coach-bubble";
    bubble.type = "button";
    stage.append(bubble);
    bubble.addEventListener("click", () => {
      hideCoachBubble();
      switchTab("play");
    });
  }
  const text = String(content);
  bubble.innerHTML = `
    <img src="./assets/squirrel_chess.svg" alt="" aria-hidden="true">
    <span>${escapeHtml(text.length > 120 ? `${text.slice(0, 119)}…` : text)}</span>
  `;
  bubble.setAttribute("aria-label", `Coach: ${text.slice(0, 160)}. Open the Play tab to reply.`);
  bubble.hidden = false;
  window.clearTimeout(coachBubbleTimer);
  coachBubbleTimer = window.setTimeout(hideCoachBubble, 8000);
}

function hideCoachBubble() {
  window.clearTimeout(coachBubbleTimer);
  coachBubbleTimer = null;
  const bubble = document.querySelector("#coachBubble");
  if (bubble) bubble.hidden = true;
}

function saveCoachMemory() {
  saveJson(STORAGE_KEYS.coachMemory, state.coachMemory);
}

function buildSkillSnapshotForChat() {
  const snapshot = state.skill?.dims ? skillSnapshot(state.skill) : { overall: getEstimatedTrainingScore() || null };
  snapshot.calibrated = isCalibrationComplete();
  return snapshot;
}

function momentFromMoveRecord(record) {
  if (!record) return null;
  return {
    ply: record.ply,
    san: record.san,
    quality: record.qualityKey || record.classification || "",
    cpl: Number.isFinite(record.evalDelta) ? Math.max(0, record.evalDelta) : null,
    bestMoveSan: record.bestMoveSan || "",
    principalVariation: (record.principalVariation || []).slice(0, 6),
    fenBefore: record.beforeFen || "",
    tags: (record.tags || []).slice(0, 4).map((tag) => tag.label),
  };
}

function buildChatPayload(event, moment = null) {
  // Moment-anchored events (review moments, rethink prompts, drill feedback)
  // are about a SPECIFIC position — the model must see that position and its
  // candidate moves, not the live board's final position. The prompt tells it
  // to only reference moves from the context, so wrong-position candidates
  // produce confidently wrong coaching.
  const momentFen = moment?.fenBefore && event !== "user_message" ? moment.fenBefore : null;
  let anchorFen = state.game.fen();
  let anchorChess = null;
  if (momentFen) {
    try {
      anchorChess = new Chess(momentFen);
      anchorFen = momentFen;
    } catch {
      anchorChess = null;
    }
  }
  const candidates = rankCandidateMoves(anchorFen).slice(0, 4).map((move) => ({
    san: move.san,
    reason: explainCandidateMove(anchorFen, move),
  }));
  const opening = detectOpening();
  const anchor = anchorChess || state.game;
  return {
    event,
    persona: getActivePersonaKey(),
    messages: compactTranscript(currentGameChatTurns().map(({ role, content }) => ({ role, content }))),
    coachMemory: memoryForPayload(state.coachMemory),
    skillSnapshot: buildSkillSnapshotForChat(),
    weaknesses: Object.values(state.profile)
      .sort((a, b) => b.count * b.severity - a.count * a.severity)
      .slice(0, 5)
      .map((item) => ({ category: item.category, label: item.label, count: item.count, severity: item.severity })),
    game: {
      fen: anchorFen,
      recentSan: state.moves.slice(-20).map((move) => move.san),
      phase: getPhase(anchor),
      sideToMove: colorName(anchor.turn()),
      playerColor: colorName(state.settings.playerColor),
      opening: opening.name,
      result: state.game.isGameOver() ? getResultLabel() : "",
    },
    moment,
    candidates,
  };
}

// Coach requests are serialized: concurrent streams would cross-write each
// other's bubbles and race the coachThinking flag. Disposable coach-initiated
// events (proactive commentary, drill nudges) are dropped instead of queued
// when a stream is already active — they are moment-bound and would land
// stale. User messages and structured flows queue up in order.
let coachChatChain = Promise.resolve();
let coachStreamSeq = 0;
let activeCoachAbort = null;
const DISPOSABLE_CHAT_EVENTS = new Set(["proactive_comment", "drill_feedback"]);

// Never persist an in-flight streaming bubble: reloading mid-stream would
// resurrect it as a permanently empty message.
function persistCoachChat() {
  saveJson(STORAGE_KEYS.coachChat, {
    gameId: state.coachChat.gameId,
    messages: (state.coachChat.messages || []).filter((message) => !message.streaming),
  });
}

// Requests queue behind whatever the coach is answering right now. Depth is
// tracked so a reply that arrives with a question knows whether the player
// already sent another message (in which case the question must not capture
// that unrelated message as its "answer").
let coachQueueDepth = 0;

async function requestCoachChat(event, moment = null) {
  if (state.coachThinking && DISPOSABLE_CHAT_EVENTS.has(event)) return null;
  // Game-scoped coach events (proactive comments, review moments, rethink
  // prompts) queued behind a slow reply must not fire into a DIFFERENT game.
  const expectedGameId = state.currentGameId;
  coachQueueDepth += 1;
  const run = coachChatChain.then(() => {
    if (event !== "user_message" && state.currentGameId !== expectedGameId) return null;
    return performCoachChat(event, moment);
  });
  coachChatChain = run.catch(() => {}).then(() => {
    coachQueueDepth -= 1;
  });
  return run;
}

// Re-sends the request behind the most recent coach error (usually the
// player's own question) so an undelivered message doesn't have to be retyped.
function retryCoachChat() {
  const retry = state.coachRetry;
  if (!retry) return;
  state.coachRetry = null;
  state.coachError = "";
  requestCoachChat(retry.event, retry.moment);
}

// No streamed byte for this long = the connection is dead (mobile network
// switch, dead proxy). Without a client-side watchdog, reader.read() can hang
// forever with the Send button disabled and the dots bouncing.
const COACH_CLIENT_IDLE_TIMEOUT_MS = 60_000;

async function performCoachChat(event, moment) {
  state.coachThinking = true;
  state.coachError = "";
  state.coachRetry = null;
  // Push an empty streaming bubble that fills in as deltas arrive. The unique
  // id ties deltas to THIS bubble even if another request follows immediately.
  const streamId = String(++coachStreamSeq);
  const streamingMessage = { role: "assistant", content: "", isQuestion: false, at: new Date().toISOString(), streaming: streamId };
  getCurrentChatMessages().push(streamingMessage);
  renderChatLog();

  const removeStreamingBubble = () => {
    const messages = getCurrentChatMessages();
    const index = messages.indexOf(streamingMessage);
    if (index !== -1) messages.splice(index, 1);
  };

  const controller = new AbortController();
  activeCoachAbort = controller;
  let watchdog = null;
  let watchdogFired = false;
  const armWatchdog = () => {
    window.clearTimeout(watchdog);
    watchdog = window.setTimeout(() => {
      watchdogFired = true;
      controller.abort();
    }, COACH_CLIENT_IDLE_TIMEOUT_MS);
  };
  armWatchdog();

  try {
    const data = await streamCoachChat(buildChatPayload(event, moment), {
      fetchImpl: api.authedFetch,
      signal: controller.signal,
      onDelta: (partial) => {
        armWatchdog();
        streamingMessage.content = partial;
        if (state.currentTab !== "play") return;
        const log = document.querySelector("#coachChatLog");
        if (!log) return;
        const bubble = log.querySelector(`[data-streaming="${streamId}"]`);
        if (bubble) {
          // Cheap live update: patch the bubble's text without re-rendering.
          bubble.textContent = partial;
        } else {
          // First delta: swap the thinking dots for the streaming bubble.
          renderChatLog();
        }
        log.scrollTop = log.scrollHeight;
      },
    });

    state.coachThinking = false;

    if (data.configured === false) {
      removeStreamingBubble();
      state.openAI.configured = false;
      state.coachError = data.message || "The coach is offline.";
      persistCoachChat();
      if (state.currentTab === "play") renderCoachPanel();
      return null;
    }

    // Finalize the streamed bubble with the full text.
    streamingMessage.content = data.message;
    streamingMessage.isQuestion = Boolean(data.question);
    delete streamingMessage.streaming;
    // A question-only reply has no message body: drop the empty bubble
    // instead of leaving an invisible entry in the transcript.
    if (!data.message) removeStreamingBubble();
    else notifyCoachMessage(data.message);

    // The server closed without a done event: what we have is possibly cut
    // off. Keep the partial text (it may still be useful) but say so.
    if (data.incomplete) {
      state.coachError = "The coach's reply may have been cut off.";
      state.coachRetry = { event, moment };
    }

    if (data.memory_note) {
      state.coachMemory = appendMemoryNote(state.coachMemory, data.memory_note);
      saveCoachMemory();
    }
    if (data.question) {
      // If the player already queued another message while this reply was
      // streaming, that message is NOT the answer to this question — don't
      // arm the capture, or an unrelated reply gets recorded as a reasoning
      // trace anchored to the wrong move.
      if (coachQueueDepth <= 1) {
        state.pendingCoachQuestion = {
          question: data.question,
          ply: moment?.ply ?? state.moves.length,
          san: moment?.san || "",
          fen: moment?.fenBefore || state.game.fen(),
        };
      }
      pushChatMessage("assistant", data.question, { isQuestion: true });
    } else {
      persistCoachChat();
    }
    renderChatLog();
    return data;
  } catch (error) {
    state.coachThinking = false;
    removeStreamingBubble();
    // A deliberate abort (game teardown, page hide) is not a failure the
    // user should see — and arming a retry here would resend the OLD game's
    // moment into the NEW game's context. The watchdog's own abort (a stall)
    // IS worth reporting, with a retry.
    if (error.name === "AbortError" && !watchdogFired) {
      persistCoachChat();
      renderChatLog();
      return null;
    }
    const message = error.name === "AbortError"
      ? "The coach stopped responding. Try again."
      : friendlyServiceMessage(error, "The coach couldn't respond. Try again in a moment.");
    state.coachError = message;
    // Offer a one-click resend for requests worth retrying (the player's own
    // messages and coach flows — disposable commentary just disappears).
    if (!DISPOSABLE_CHAT_EVENTS.has(event)) {
      state.coachRetry = { event, moment };
    }
    // A hard failure means the "Online" badge is stale — reflect reality so
    // the Services card stops claiming the coach works. Rate limiting and
    // deliberate aborts are not outages.
    if (error.name !== "AbortError" && !/too many coach requests/i.test(message)) {
      state.openAI.online = false;
      state.openAI.status = message;
    }
    persistCoachChat();
    renderChatLog();
    return null;
  } finally {
    window.clearTimeout(watchdog);
    if (activeCoachAbort === controller) activeCoachAbort = null;
  }
}

async function handleUserChatMessage(text) {
  pushChatMessage("user", text);

  // Answering a coach question captures a reasoning trace: what the player
  // said they were thinking, anchored to the move it was about.
  if (state.pendingCoachQuestion) {
    state.coachMemory = appendTrace(state.coachMemory, {
      id: crypto.randomUUID(),
      gameId: state.currentGameId,
      ply: state.pendingCoachQuestion.ply,
      fen: state.pendingCoachQuestion.fen,
      san: state.pendingCoachQuestion.san,
      question: state.pendingCoachQuestion.question,
      answer: text,
      takeaway: "",
      createdAt: new Date().toISOString(),
    });
    saveCoachMemory();
    syncReasoningTrace(state.coachMemory.traces[state.coachMemory.traces.length - 1]);
    state.pendingCoachQuestion = null;
  }

  if (state.rethink.active && state.rethink.stage === "ask") {
    state.rethink.stage = "decide";
    renderCoachPanel();
    await requestCoachChat("rethink_followup", momentFromMoveRecord(state.rethink.record));
    renderCoachPanel();
    return;
  }

  renderChatLog();
  await requestCoachChat("user_message");
}

// ─────────── Proactive commentary ───────────

const PROACTIVE_LIMIT_PER_GAME = 6;
const PROACTIVE_MIN_PLY_GAP = 4;

function resetProactiveState() {
  state.proactive = { count: 0, lastCommentPly: 0, turningPointUsed: false, praiseCount: 0 };
}

// The Settings "Coach mode" contract lives in lib/coach-mode.mjs (pure +
// unit-tested). Kinds: "live" (proactive comments, rethink interception),
// "postgame" (game-end nudges), "drill" (missed-puzzle feedback).
function coachModeAllows(kind) {
  return coachModeAllowsForMode(state.settings.coachMode, kind);
}

function canCoachSpeak() {
  return isCoachAvailable() && isCalibrationComplete() && !state.activeDrill && !state.rethink.active && coachModeAllows("live");
}

function shouldCommentOnMove(record) {
  if (!canCoachSpeak()) return null;
  if (state.proactive.count >= PROACTIVE_LIMIT_PER_GAME) return null;
  if (record.ply - state.proactive.lastCommentPly < PROACTIVE_MIN_PLY_GAP) return null;

  const quality = record.qualityKey;
  if (quality === "blunder" || quality === "missed_win") return "mistake";
  if (quality === "mistake" && record.ply - state.proactive.lastCommentPly >= 6) return "mistake";

  // Eval sign flip = the game turned around; worth one comment per game.
  // Scores are side-to-move: evalAfter is the OPPONENT's perspective and must
  // be negated before comparing signs with evalBefore (the player's).
  if (!state.proactive.turningPointUsed && Number.isFinite(record.evalBefore) && Number.isFinite(record.evalAfter)) {
    const playerBefore = record.evalBefore;
    const playerAfter = -record.evalAfter;
    if (Math.sign(playerBefore) !== Math.sign(playerAfter) && Math.abs(playerAfter - playerBefore) >= 150) {
      return "turning_point";
    }
  }

  if (quality === "best" && state.proactive.praiseCount < 2) {
    const recentRough = state.moves.slice(-6, -1).some((move) => move.role === "player" && ["mistake", "blunder"].includes(move.qualityKey));
    if (recentRough) return "praise";
  }

  return null;
}

async function maybeTriggerProactiveCoach(record) {
  // The grade can resolve after the player has already moved on to another
  // game or the game ended — never comment cross-game or post-game.
  if (record.gameId !== state.currentGameId || state.game.isGameOver()) return;
  const trigger = shouldCommentOnMove(record);
  if (!trigger) return;

  state.proactive.count += 1;
  state.proactive.lastCommentPly = record.ply;
  if (trigger === "turning_point") state.proactive.turningPointUsed = true;
  if (trigger === "praise") state.proactive.praiseCount += 1;

  await requestCoachChat("proactive_comment", momentFromMoveRecord(record));
}

// ─────────── Rethink flow ───────────

const RETHINK_GRADE_TIMEOUT_MS = 3000;
const RETHINKS_PER_GAME = 2;

function resetRethinkState() {
  // Never strand the attemptPlayerMove continuation that awaits a rethink
  // decision — resolving false ("play on") lets it complete; the ownership
  // guards downstream keep it from acting on whatever game owns the board now.
  const pendingResolve = state.rethink?.resolve || null;
  state.rethink = { active: false, record: null, remaining: RETHINKS_PER_GAME, resolve: null, stage: "ask" };
  pendingResolve?.(false);
}

// Cancels every pending board-level interaction owned by the game being torn
// down. MUST run before state.game / state.currentGameId change so no async
// continuation (promotion pick, rethink decision, clock tick) can act on the
// wrong game.
function teardownBoardInteractions() {
  cancelActivePromotionPicker();
  resetRethinkState();
  stopClockTicker();
  // A leftover replay/timeline board from the outgoing game would keep
  // rendering the OLD position and block all input on the new one.
  state.variationReplay = null;
  state.timeline = null;
  timelineCache = { ply: null, gameId: null, chess: null };
  // An in-flight coach stream belongs to the outgoing game — abort it rather
  // than let it keep streaming (and spending tokens) into the new context.
  activeCoachAbort?.abort();
}

function shouldOfferRethink(record) {
  return (
    record?.role === "player" &&
    record.gameId === state.currentGameId &&
    ["blunder", "missed_win"].includes(record.qualityKey) &&
    !record.rethinkOffered &&
    state.rethink.remaining > 0 &&
    isCalibrationComplete() &&
    coachModeAllows("live") &&
    !state.activeDrill &&
    !state.game.isGameOver()
  );
}

function renderRethinkCard() {
  if (!state.rethink.active) return "";
  const record = state.rethink.record;
  const showDecide = state.rethink.stage === "decide";
  return `
    <article class="mini-card rethink-card">
      <span class="label">Hold on</span>
      <strong>${escapeHtml(record?.san || "That move")} looks costly</strong>
      ${showDecide ? `
        <div class="button-row">
          <button class="primary-action" id="rethinkRetryButton" type="button">Rethink the move</button>
          <button id="rethinkPlayOnButton" type="button">Play on</button>
        </div>
      ` : `
        <p>Tell the coach what your idea was in the chat below — then decide whether to rethink it.</p>
        <div class="button-row">
          <button id="rethinkSkipButton" type="button">Skip and decide now</button>
        </div>
      `}
    </article>
  `;
}

function bindRethinkCard() {
  document.querySelector("#rethinkRetryButton")?.addEventListener("click", () => resolveRethink(true));
  document.querySelector("#rethinkPlayOnButton")?.addEventListener("click", () => resolveRethink(false));
  document.querySelector("#rethinkSkipButton")?.addEventListener("click", () => {
    state.rethink.stage = "decide";
    renderCoachPanel();
  });
}

function resolveRethink(takeBack) {
  const record = state.rethink.record;
  const resolve = state.rethink.resolve;
  state.rethink.active = false;
  state.rethink.record = null;
  state.rethink.resolve = null;
  state.rethink.stage = "ask";

  if (takeBack && record) {
    // Undo exactly the player's ply. The move record is kept in the game log
    // (marked retracted) so the weakness profile keeps the data point.
    state.game.undo();
    record.retracted = true;
    state.moves = state.moves.filter((move) => move.id !== record.id);
    const tail = state.moves[state.moves.length - 1];
    state.lastMove = tail ? { from: tail.from, to: tail.to } : null;
    // Hand the clock back to the player: onMoveClockUpdate already switched
    // sides and paid the increment for the retracted move. Without this the
    // opponent's clock runs during the player's rethink and the retracted
    // move keeps its earned increment.
    if (state.clocks && !state.clocks.flagged) {
      const moverKey = record.color === "w" ? "white" : "black";
      if (state.clocks.incrementMs) {
        state.clocks[moverKey] = Math.max(0, state.clocks[moverKey] - state.clocks.incrementMs);
      }
      state.clocks.side = record.color;
      state.clocks.lastTick = Date.now();
    }
    pushChatMessage("assistant", "Take another look. What does your opponent's last move attack or threaten?");
    saveCurrentGame();
    renderAll();
  }

  resolve?.(takeBack);
}

// Called from the engine-reply path: waits briefly for grading, and if the
// move was a blunder, interrupts with a coach conversation before the bot
// replies. Resolves true when the player takes the move back.
async function maybeOfferRethink(record) {
  if (!record?.gradePromise) return false;

  await Promise.race([record.gradePromise, wait(RETHINK_GRADE_TIMEOUT_MS)]);
  if (!shouldOfferRethink(record)) return false;

  record.rethinkOffered = true;
  state.rethink.active = true;
  state.rethink.record = record;
  state.rethink.remaining -= 1;
  // With no coach to talk to, the "tell the coach your idea" stage would
  // point at a disabled chat box — go straight to the decision.
  state.rethink.stage = isCoachAvailable() ? "ask" : "decide";

  const rethinkDecision = new Promise((resolve) => {
    state.rethink.resolve = resolve;
  });

  if (state.currentTab !== "play") switchTab("play");
  renderCoachPanel();

  if (isCoachAvailable()) {
    // Ask for the player's idea. Local fallback keeps the flow moving.
    const response = await requestCoachChat("rethink_prompt", momentFromMoveRecord(record));
    if (!response) {
      pushChatMessage("assistant", `That drops material or misses something big. What was your idea with ${record.san}?`, { isQuestion: true });
      state.pendingCoachQuestion = {
        question: `What was your idea with ${record.san}?`,
        ply: record.ply,
        san: record.san,
        fen: record.beforeFen,
      };
      renderCoachPanel();
    }
  } else {
    pushChatMessage("assistant", `${record.san} looks costly — it may drop material or miss something big. Want to take another look?`);
    renderCoachPanel();
  }

  return rethinkDecision;
}

// ─────────── Guided review ───────────

function startGuidedReview() {
  const moments = selectKeyMoments(state.moves);
  if (!moments.length) {
    // The explanation must land on the tab the user is looking at — pushing
    // it into the Coach chat made the button look broken from Review.
    state.guidedReview = { active: false, noMoments: true };
    renderReviewPanel();
    return;
  }
  markDailyItemComplete("review");
  state.guidedReview = { active: true, moments, index: 0, step: "ask", lastCoachMessage: "" };
  advanceGuidedReviewMoment();
}

async function advanceGuidedReviewMoment() {
  const review = state.guidedReview;
  const moment = review.moments[review.index];
  state.reviewPly = moment.ply;
  review.step = "ask";
  review.lastCoachMessage = "";
  renderReviewPanel();

  const data = await requestCoachChat("review_moment", moment);
  review.lastCoachMessage = data?.message || `Look at this position before ${moment.san}. ${moment.reason} What were you thinking here?`;
  if (!data) {
    state.pendingCoachQuestion = {
      question: "What were you thinking at this moment?",
      ply: moment.ply,
      san: moment.san,
      fen: moment.fenBefore,
    };
  }
  renderReviewPanel();
}

async function submitGuidedReviewAnswer(text) {
  const review = state.guidedReview;
  const moment = review.moments[review.index];

  pushChatMessage("user", text);
  state.coachMemory = appendTrace(state.coachMemory, {
    id: crypto.randomUUID(),
    gameId: state.currentGameId,
    ply: moment.ply,
    fen: moment.fenBefore,
    san: moment.san,
    question: state.pendingCoachQuestion?.question || "What were you thinking at this moment?",
    answer: text,
    takeaway: "",
    createdAt: new Date().toISOString(),
  });
  saveCoachMemory();
  syncReasoningTrace(state.coachMemory.traces[state.coachMemory.traces.length - 1]);
  state.pendingCoachQuestion = null;

  review.step = "teach";
  review.lastCoachMessage = "";
  renderReviewPanel();

  // The answer is now in the transcript, so the coach teaches this moment.
  const data = await requestCoachChat("review_moment", moment);
  review.lastCoachMessage = data?.message || (moment.bestMoveSan
    ? `The engine preferred ${moment.bestMoveSan} here. Compare what it does to what ${moment.san} allowed.`
    : `Compare the position before and after ${moment.san} — look for what changed for your opponent.`);
  renderReviewPanel();
}

async function nextGuidedReviewMoment() {
  const review = state.guidedReview;
  if (review.index + 1 < review.moments.length) {
    review.index += 1;
    await advanceGuidedReviewMoment();
    return;
  }
  // Show a visible conclusion on the tab the user is on; the full summary
  // also lands in the Coach chat.
  state.guidedReview = { active: false, finished: true };
  state.reviewPly = null;
  renderReviewPanel();
  await requestCoachChat("game_summary");
  if (state.currentTab === "review") renderReviewPanel();
}

// Players read scoresheet move numbers, not plies: ply 24 is Black's 12th
// move ("12…"), not "move 24".
function moveNumberLabel(ply) {
  const num = Math.ceil(ply / 2);
  return ply % 2 === 1 ? `${num}.` : `${num}…`;
}

function renderGuidedReviewCard() {
  const gameDone = state.game.isGameOver();
  if (!isCalibrationComplete()) return "";

  if (!state.guidedReview?.active) {
    if (!gameDone) return "";
    if (state.guidedReview?.noMoments) {
      return `
        <article class="mini-card guided-review-card">
          <span class="label">Guided review</span>
          <strong>No single moment decided this game</strong>
          <p>Your biggest slips were small — a pretty clean game. Browse the move list below, or start another game.</p>
        </article>
      `;
    }
    if (state.guidedReview?.finished) {
      return `
        <article class="mini-card guided-review-card">
          <span class="label">Guided review</span>
          <strong>Review complete</strong>
          <p>Nice work. The coach's summary is waiting in the Coach tab — or jump straight into another game.</p>
        </article>
      `;
    }
    // The flow has full local fallbacks for every coach prompt, so it works
    // offline too — never disable the button just because the coach is out.
    return `
      <article class="mini-card guided-review-card">
        <span class="label">Guided review</span>
        <strong>Walk through the key moments</strong>
        <p>The coach picks the 2-3 moments that decided this game, asks what you were thinking, and teaches from there.</p>
        <button class="primary-action" id="startGuidedReviewButton" type="button">Start guided review</button>
      </article>
    `;
  }

  const review = state.guidedReview;
  const moment = review.moments[review.index];
  const coachText = review.lastCoachMessage
    ? `<p class="guided-coach-message">${escapeHtml(review.lastCoachMessage)}</p>`
    : `<p class="guided-coach-message guided-loading">Coach is looking at this moment...</p>`;

  return `
    <article class="mini-card guided-review-card">
      <span class="label">Guided review · moment ${review.index + 1} of ${review.moments.length}</span>
      <strong>${moveNumberLabel(moment.ply)} ${escapeHtml(moment.san)}</strong>
      <p>${escapeHtml(moment.reason)}</p>
      ${coachText}
      ${review.step === "ask" && review.lastCoachMessage ? `
        <form id="guidedReviewForm" class="guided-review-form">
          <input id="guidedReviewInput" type="text" autocomplete="off" placeholder="What was your plan here?">
          <button type="submit">Answer</button>
        </form>
      ` : ""}
      ${review.step === "teach" && review.lastCoachMessage ? `
        <div class="button-row">
          <button class="primary-action" id="guidedReviewNextButton" type="button">${review.index + 1 < review.moments.length ? "Next moment" : "Finish review"}</button>
        </div>
      ` : ""}
    </article>
  `;
}

function bindGuidedReviewCard() {
  document.querySelector("#startGuidedReviewButton")?.addEventListener("click", startGuidedReview);
  document.querySelector("#guidedReviewNextButton")?.addEventListener("click", nextGuidedReviewMoment);
  document.querySelector("#guidedReviewForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#guidedReviewInput");
    const text = input?.value.trim();
    if (!text) return;
    submitGuidedReviewAnswer(text);
  });
}

// Progress card for the deep post-game pass. Quality pills, the eval graph,
// and turning points refresh live as each ply is re-graded at depth 18.
function renderDeepAnalysisStatus() {
  const deep = state.deepAnalysis;
  if (!deep?.running || deep.gameId !== state.currentGameId) return "";
  return `
    <article class="mini-card deep-analysis-card">
      <span class="label">Deep review</span>
      <p>Double-checking your moves with deeper analysis: ${deep.done}/${deep.total} done. Badges sharpen as it goes.</p>
    </article>
  `;
}

function describeGameRecord(record) {
  const when = record.updatedAt || record.startedAt;
  const date = when
    ? new Date(when).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "";
  const opening = record.openingName && record.openingName !== "Unbooked line" ? record.openingName : "";
  return [date, opening].filter(Boolean).join(" · ") || "Earlier game";
}

// Recent games (current one included, disabled) so finishing a game never
// orphans the review of the ones before it.
function renderGamePickerCard() {
  const games = state.localGames.filter((game) => Array.isArray(game.moves) && game.moves.length);
  const others = games.filter((game) => game.id !== state.currentGameId);
  if (!others.length) return "";
  const rows = games.slice(0, 12).map((game) => {
    const current = game.id === state.currentGameId;
    const result = game.result && game.result !== "in_progress" ? game.result : "In progress";
    const text = `${describeGameRecord(game)} — ${result}${current ? " (current)" : ""}`;
    return `<button type="button" class="candidate game-pick${current ? " selected" : ""}" data-load-game="${escapeAttr(game.id)}"${current ? " disabled" : ""}>${escapeHtml(text)}</button>`;
  }).join("");
  return `
    <article class="mini-card game-picker-card">
      <span class="label">Your games</span>
      <strong>Review an earlier game</strong>
      <div class="candidate-list">${rows}</div>
    </article>
  `;
}

// Loads a stored game (with its per-move analysis) back onto the board and
// into Review. The game being left is already saved incrementally, so it
// remains in this same list and can be reopened the same way.
function loadGameForReview(gameId) {
  if (state.activeDrill) return;
  // While the bot is thinking the board is about to change — the epoch guard
  // in maybeEngineMove would discard the result, but blocking here avoids a
  // confusing half-loaded flash. The think window is a few seconds at most.
  if (state.thinking) return;
  const record = state.localGames.find((game) => game.id === gameId);
  if (!record || record.id === state.currentGameId) return;

  let restored;
  try {
    restored = new Chess();
    if (record.pgn) restored.loadPgn(record.pgn);
    else if (record.fen) restored.load(record.fen);
  } catch (error) {
    console.warn("Could not load game for review", error);
    return;
  }

  cancelDeepAnalysis();
  teardownBoardInteractions();
  // Mark the transcript boundary with a descriptive divider before the game
  // id changes (otherwise getCurrentChatMessages inserts a generic one).
  appendChatDivider(`Reviewing ${describeGameRecord(record)}`);
  state.coachChat.gameId = record.id;
  persistCoachChat();

  state.game = restored;
  state.currentGameId = record.id;
  state.startedAt = record.startedAt || new Date().toISOString();
  state.moves = Array.isArray(record.moves) ? record.moves : [];
  if (record.playerColor) state.settings.playerColor = record.playerColor;
  state.lastMove = state.moves.length
    ? { from: state.moves[state.moves.length - 1].from, to: state.moves[state.moves.length - 1].to }
    : null;
  state.selectedSquare = null;
  state.legalTargets = new Set();
  state.reviewPly = null;
  state.guidedReview = null;
  state.pendingCoachQuestion = null;
  state.coachError = "";
  state.coachRetry = null;
  resetProactiveState();
  resetRethinkState();
  // Unfinished timed games come back with their clock (paused-at-save);
  // finished games and untimed games show none. Ticker restarts below only
  // when there is genuinely time to run.
  state.clocks = record.clocks && !state.game.isGameOver()
    && Number.isFinite(record.clocks.white) && Number.isFinite(record.clocks.black)
    ? {
        white: Math.max(0, record.clocks.white),
        black: Math.max(0, record.clocks.black),
        incrementMs: record.clocks.incrementMs || 0,
        side: restored.turn(),
        lastTick: Date.now(),
        intervalId: null,
        flagged: record.clocks.flagged || null,
      }
    : null;
  if (state.clocks && !state.clocks.flagged) startClockTicker();
  // Deliberately NOT saved into the activeGame slot: reviewing an old game
  // must not make a reload boot into it — the slot keeps the live game.
  renderAll();

  // Reopening an unfinished game with the bot to move: let it move.
  if (!state.game.isGameOver() && state.game.turn() !== state.settings.playerColor) {
    maybeEngineMove();
  }
}

// Review is a post-game activity: the current game only unlocks its
// breakdown once it has actually ended (checkmate, draw, or a clock flag).
function isCurrentGameFinished() {
  return state.game.isGameOver() || Boolean(state.clocks?.flagged);
}

function renderReviewPanel() {
  if (!isCurrentGameFinished() || !state.moves.length) {
    const explainer = state.moves.length
      ? "Game in progress. When it ends, your coach breaks it down here move by move."
      : "When you finish a game, your coach breaks it down here move by move.";
    els.reviewPanel.innerHTML = `
      <h2>Review</h2>
      <div class="stack">
        <div class="empty-state empty-state-mascot">
          <img src="./assets/squirrel_chess.svg" alt="" aria-hidden="true">
          <p>${explainer}</p>
        </div>
        ${renderGamePickerCard()}
      </div>
    `;
    bindGamePickerCard(els.reviewPanel);
    return;
  }
  const selectedMove = state.reviewPly != null
    ? state.moves.find((move) => move.ply === state.reviewPly)
    : state.moves[state.moves.length - 1];
  // During a guided review "ask" step, show the position BEFORE the key move
  // so the player re-reads the board the way they saw it in the game.
  const boardFen = state.guidedReview?.active && state.guidedReview.step === "ask" && selectedMove
    ? selectedMove.beforeFen
    : selectedMove ? selectedMove.afterFen : state.game.fen();
  const turningPoints = getReviewTurningPoints();
  const analysisCard = renderSelectedMoveAnalysis(selectedMove);
  const skillCard = renderReviewSkillCard(selectedMove);

  const rows = state.moves.map((move) => {
    const isSelected = selectedMove && move.ply === selectedMove.ply;
    const evalText = formatEvalDelta(move);
    const quality = getMoveQuality(move);
    const tagPills = (move.tags || []).map((tag) =>
      `<span class="tag ${reviewTagClass(tag.severity)}">${escapeHtml(toTitleCaseLabel(tag.label))}</span>`
    ).join("");
    const classText = toTitleCaseLabel(quality ? quality.label : prettyClassification(move.classification));
    const className = quality ? `quality-pill ${qualityClassName(quality.key)}` : reviewClassClass(move.classification);
    return `
      <div class="move-row ${isSelected ? "selected" : ""}" role="button" tabindex="0" data-ply="${escapeAttr(move.ply)}">
        <div class="move-meta">
          <span class="move-ply">${moveNumberLabel(move.ply)}</span>
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
      <p>The moments where the game swung most against you.</p>
      <div class="candidate-list">
        ${turningPoints.map((point) => `
          <button type="button" class="candidate turning-point" data-ply="${escapeAttr(point.ply)}">
            ${moveNumberLabel(point.ply)} ${escapeHtml(point.san)} <span class="move-eval">-${formatPawns(point.evalDelta)}</span>
          </button>
        `).join("")}
      </div>
    </article>
  ` : "";

  const boardCard = renderReviewBoardCard(selectedMove, boardFen);

  // Scrub bar: steps the MAIN board through the game. Mirrors the arrow keys.
  const timelinePosition = state.timeline ? state.timeline.ply : state.moves.length;
  const timelineLabel = !state.timeline
    ? "Final position"
    : timelinePosition === 0
      ? "Start"
      : (() => {
          const record = state.moves.find((move) => move.ply === timelinePosition);
          return record ? `After ${moveNumberLabel(record.ply)} ${record.san}` : "";
        })();
  const scrubBar = `
    <div class="timeline-bar" role="group" aria-label="Step through the game">
      <button type="button" id="timelineStartButton" aria-label="Go to start" ${timelinePosition === 0 ? "disabled" : ""}>⏮</button>
      <button type="button" id="timelineBackButton" aria-label="Previous move" ${timelinePosition === 0 ? "disabled" : ""}>◀</button>
      <span class="timeline-label">${escapeHtml(timelineLabel)} <span class="timeline-hint">(arrow keys work too)</span></span>
      <button type="button" id="timelineForwardButton" aria-label="Next move" ${state.timeline ? "" : "disabled"}>▶</button>
      <button type="button" id="timelineLiveButton" ${state.timeline ? "" : "disabled"}>Final</button>
    </div>
  `;

  els.reviewPanel.innerHTML = `
    <h2>Review</h2>
    <div class="stack">
      ${renderDeepAnalysisStatus()}
      ${renderVariationReplayCard()}
      ${renderGuidedReviewCard()}
      ${renderEvalGraphCard()}
      ${scrubBar}
      ${boardCard}
      ${analysisCard}
      ${skillCard}
      ${turningPointHtml}
      <div class="move-list">${rows}</div>
      ${renderGamePickerCard()}
    </div>
  `;
  bindVariationReplayCard();
  bindGuidedReviewCard();
  bindReplayPvButtons(els.reviewPanel);
  bindEvalGraphCard();
  bindGamePickerCard(els.reviewPanel);
  document.querySelector("#timelineStartButton")?.addEventListener("click", () => setTimelinePly(0));
  document.querySelector("#timelineBackButton")?.addEventListener("click", () => stepTimeline(-1));
  document.querySelector("#timelineForwardButton")?.addEventListener("click", () => stepTimeline(1));
  document.querySelector("#timelineLiveButton")?.addEventListener("click", () => setTimelinePly(state.moves.length));

  els.reviewPanel.querySelectorAll(".move-row[data-ply]").forEach((row) => {
    const activate = () => {
      const ply = Number(row.dataset.ply);
      // Toggle: selecting an already-selected move returns to the live board.
      setTimelinePly(state.reviewPly === ply ? state.moves.length : ply);
      paintBoardArrows();
    };
    row.addEventListener("click", activate);
    // These are divs with role="button": unlike real buttons they don't
    // synthesize clicks from the keyboard, so Enter/Space must be wired up.
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
  });
  els.reviewPanel.querySelectorAll(".turning-point[data-ply]").forEach((button) => {
    button.addEventListener("click", () => {
      setTimelinePly(Number(button.dataset.ply));
      paintBoardArrows();
    });
  });
  els.reviewPanel.querySelectorAll("[data-review-retry]").forEach((button) => {
    button.addEventListener("click", () => startReviewRetry(button.dataset.reviewRetry));
  });
  els.reviewPanel.querySelectorAll("[data-review-skill]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedSkillId = button.dataset.reviewSkill;
      switchTab("practice");
    });
  });
}

function bindGamePickerCard(root) {
  root.querySelectorAll("[data-load-game]").forEach((button) => {
    button.addEventListener("click", () => loadGameForReview(button.dataset.loadGame));
  });
}

function renderReviewSkillCard(move) {
  if (!shouldOfferSkillTraining(move)) return "";
  const skill = getPrimarySkillForMove(move);
  if (!skill) return "";
  const tag = move.tags?.[0];
  const reason = tag?.note || move.qualityReason || "This move is worth retrying with a focused scan.";
  return `
    <article class="mini-card skill-transfer-card">
      <span class="label">Skill transfer</span>
      <strong>${escapeHtml(skill.label)}</strong>
      <p>${escapeHtml(reason)}</p>
      <div class="button-row">
        <button class="primary-action" type="button" data-review-retry="${escapeAttr(move.ply)}">Retry this position</button>
        <button type="button" data-review-skill="${escapeAttr(skill.id)}">Open lab</button>
      </div>
    </article>
  `;
}

function renderReviewBoardCard(move, boardFen) {
  if (!move) return "";

  const quality = getMoveQuality(move);
  const playedHighlights = buildMoveHighlights(move.uci, "played", quality?.key);
  const bestHighlights = buildMoveHighlights(move.bestMoveUci, "best");
  const showBestBoard = move.role === "player" && move.bestMoveUci && move.bestMoveUci !== move.uci;

  return `
    <article class="mini-card review-board-card">
      <span class="label">Move view${quality ? ` · ${escapeHtml(quality.label)}` : formatEvalDelta(move) ? ` · ${formatEvalDelta(move)}` : ""}</span>
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
        <p>The engine is evaluating the position before and after this move.</p>
      </article>
    `;
  }

  const hasAnalysis = move.analysisStatus === "complete" || typeof move.evalDelta === "number" || move.bestMoveUci;
  if (!hasAnalysis) {
    return `
      <article class="mini-card">
        <span class="label">${quality ? "Move quality" : "Engine analysis"}</span>
        <strong>${quality ? escapeHtml(quality.label) : "Unavailable"}</strong>
        <p>${escapeHtml(quality?.reason || "The engine was not available for this move, so the review is using quick estimates only.")}</p>
      </article>
    `;
  }

  const bestMove = move.bestMoveSan || move.bestMoveUci || "No best move returned";
  const bestText = !move.bestMoveUci
    ? "The engine did not return a best alternative for this move."
    : move.bestMoveUci === move.uci
      ? `The engine also preferred ${bestMove}.`
      : `The engine preferred ${bestMove} over ${move.san}.`;
  const pv = formatPrincipalVariation(move.beforeFen, move.principalVariation || []);

  return `
    <article class="mini-card">
      <span class="label">Engine analysis</span>
      <strong>${quality ? escapeHtml(quality.label) : formatEvalDelta(move) || "No advantage lost"}</strong>
      <p>${escapeHtml(quality ? `${quality.reason} ${bestText}` : bestText)}</p>
      <div class="candidate-list">
        <span class="candidate">Before ${escapeHtml(formatEngineScore(move.evalBefore, move.mateBefore))}</span>
        <span class="candidate">After ${escapeHtml(formatEngineScore(move.evalAfter, move.mateAfter))}</span>
      </div>
      ${pv ? `
        <div class="candidate-list coach-candidates">
          <div class="candidate-row">
            <strong>Engine line</strong>
            <span>${escapeHtml(pv)}</span>
          </div>
        </div>
        <div class="button-row">
          <button type="button" data-replay-pv="${escapeAttr(move.id)}">Replay engine line on board</button>
        </div>
      ` : ""}
    </article>
  `;
}

// Engine scores are centipawns internally; players see pawn units ("+1.5"),
// the same convention chess sites use.
function formatPawns(cp) {
  return (Math.abs(cp) / 100).toFixed(1);
}

function formatEngineScore(scoreCp, mate) {
  if (typeof mate === "number") {
    return mate > 0 ? `Mate in ${mate}` : `Mate in ${Math.abs(mate)} against you`;
  }
  if (typeof scoreCp === "number") {
    return `${scoreCp > 0 ? "+" : scoreCp < 0 ? "-" : ""}${formatPawns(scoreCp)}`;
  }
  return "—";
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

// ─────────── Eval graph ───────────

function renderEvalGraphCard() {
  const points = state.moves
    .map((move) => {
      // Scores are from the side-to-move's perspective in the position AFTER
      // the move; that side is the OPPOSITE of the mover, so multiplying by
      // the mover's color gives White-perspective. Mate scores need the same
      // flip (mateAfter 0 = the side to move is checkmated).
      const sign = move.color === "w" ? -1 : 1;
      if (typeof move.mateAfter === "number") {
        const stmCp = move.mateAfter > 0 ? 1200 : -1200;
        return { ply: move.ply, whiteCp: stmCp * sign, mate: true };
      }
      if (typeof move.evalAfter === "number") {
        return { ply: move.ply, whiteCp: move.evalAfter * sign, mate: false };
      }
      return null;
    })
    .filter(Boolean);

  if (points.length < 2) return "";

  const width = 300;
  const height = 90;
  const step = width / Math.max(points.length - 1, 1);
  const midY = height / 2;

  const scale = (cp) => {
    const clamped = Math.max(-1000, Math.min(1000, cp));
    // Same tanh scale as the eval bar so bar and graph agree visually.
    return midY - Math.tanh(clamped / 350) * (height / 2 - 4);
  };

  const pathD = points.map((point, index) => `${index === 0 ? "M" : "L"}${(index * step).toFixed(1)},${scale(point.whiteCp).toFixed(1)}`).join(" ");
  const areaD = `${pathD} L${((points.length - 1) * step).toFixed(1)},${height} L0,${height} Z`;

  const markers = points
    .map((point, index) => {
      const move = state.moves.find((m) => m.ply === point.ply);
      const quality = move?.qualityKey;
      if (!quality || !["blunder", "mistake", "missed_win", "inaccuracy"].includes(quality)) return "";
      const cx = (index * step).toFixed(1);
      const cy = scale(point.whiteCp).toFixed(1);
      return `<circle class="eval-graph-marker ${qualityClassName(quality)}" cx="${cx}" cy="${cy}" r="3" data-ply="${escapeAttr(point.ply)}"></circle>`;
    })
    .filter(Boolean)
    .join("");

  return `
    <article class="mini-card eval-graph-card">
      <span class="label">Evaluation graph</span>
      <svg id="evalGraphSvg" class="eval-graph" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Evaluation over time" data-plies="${points.map((point) => point.ply).join(",")}">
        <line x1="0" y1="${midY}" x2="${width}" y2="${midY}" class="eval-graph-mid"></line>
        <path d="${areaD}" class="eval-graph-area"></path>
        <path d="${pathD}" class="eval-graph-line"></path>
        ${markers}
      </svg>
    </article>
  `;
}

function bindEvalGraphCard() {
  const svg = document.querySelector("#evalGraphSvg");
  if (!svg) return;
  svg.querySelectorAll(".eval-graph-marker").forEach((circle) => {
    circle.addEventListener("click", () => {
      setTimelinePly(Number(circle.dataset.ply));
    });
  });
  svg.addEventListener("click", (event) => {
    if (event.target.tagName === "circle") return; // handled above
    const rect = svg.getBoundingClientRect();
    const x = event.clientX - rect.left;
    // The graph only plots moves that have evals — map the click onto that
    // same list, not state.moves (they diverge whenever a move lacks a grade).
    const plies = String(svg.dataset.plies || "").split(",").map(Number).filter(Number.isFinite);
    if (!plies.length) return;
    const index = Math.round((x / rect.width) * (plies.length - 1));
    const ply = plies[Math.min(Math.max(index, 0), plies.length - 1)];
    if (Number.isFinite(ply)) {
      setTimelinePly(ply);
    }
  });
}

// ─────────── Variation replay ───────────

function startVariationReplay(fen, uciList) {
  if (!Array.isArray(uciList) || !uciList.length) return;
  // Records come from localStorage/cloud sync — a corrupted FEN or PV must
  // not crash the Review click handler (chess.js throws, not returns null).
  let chess;
  const moves = [];
  try {
    chess = new Chess(fen);
    for (const uci of uciList) {
      const move = chess.move(moveFromUci(uci));
      if (!move) break;
      moves.push({ uci, san: move.san, fenAfter: chess.fen() });
    }
  } catch (error) {
    console.warn("Variation replay could not load this line", error);
    if (!moves.length) return;
  }
  if (!moves.length) return;
  // Rewind the sim to the start position; index tracks how far the user has stepped.
  chess.load(fen);
  state.variationReplay = { baseFen: fen, chess, moves, index: 0 };
  clearSelection({ render: false });
  renderAll();
}

function stepVariationReplay(direction) {
  const replay = state.variationReplay;
  if (!replay) return;
  try {
    if (direction === "forward" && replay.index < replay.moves.length) {
      replay.chess.move(moveFromUci(replay.moves[replay.index].uci));
      replay.index += 1;
    } else if (direction === "back" && replay.index > 0) {
      replay.index -= 1;
      replay.chess.load(replay.index === 0 ? replay.baseFen : replay.moves[replay.index - 1].fenAfter);
    }
  } catch (error) {
    console.warn("Variation replay step failed", error);
    stopVariationReplay();
    return;
  }
  renderBoard();
  renderCurrentPanel();
}

function stopVariationReplay() {
  state.variationReplay = null;
  renderAll();
}

function renderVariationReplayCard() {
  const replay = state.variationReplay;
  if (!replay) return "";
  const sans = replay.moves.map((move, index) => (
    `<span class="pv-step ${index < replay.index ? "played" : ""} ${index === replay.index ? "next" : ""}">${escapeHtml(move.san)}</span>`
  )).join(" ");
  return `
    <article class="mini-card replay-card">
      <span class="label">Replaying engine line · ${replay.index}/${replay.moves.length}</span>
      <div class="pv-steps">${sans}</div>
      <div class="button-row">
        <button id="replayBackButton" type="button" ${replay.index === 0 ? "disabled" : ""}>◀ Back</button>
        <button class="primary-action" id="replayForwardButton" type="button" ${replay.index >= replay.moves.length ? "disabled" : ""}>Forward ▶</button>
        <button id="replayExitButton" type="button">Exit replay</button>
      </div>
    </article>
  `;
}

function bindVariationReplayCard() {
  document.querySelector("#replayForwardButton")?.addEventListener("click", () => stepVariationReplay("forward"));
  document.querySelector("#replayBackButton")?.addEventListener("click", () => stepVariationReplay("back"));
  document.querySelector("#replayExitButton")?.addEventListener("click", stopVariationReplay);
}

function bindReplayPvButtons(root) {
  root.querySelectorAll("[data-replay-pv]").forEach((button) => {
    button.addEventListener("click", () => {
      const move = state.moves.find((entry) => entry.id === button.dataset.replayPv);
      if (move) startVariationReplay(move.beforeFen, move.principalVariation || []);
    });
  });
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
  return `-${formatPawns(move.evalDelta)}`;
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
  // Family mode softens every harsh label — including this fallback path
  // (legacy records with a classification but no quality key used to leak
  // "Blunder"/"Mistake" past the softened labels).
  const softened = isFamilyMode() ? FAMILY_QUALITY_LABELS[classification] : null;
  if (softened) return softened.label;
  return classification[0].toUpperCase() + classification.slice(1);
}

function renderMiniBoard(fen, highlights = {}) {
  const piecesField = String(fen || "").split(" ")[0];
  const ranks = piecesField.split("/");
  // Records come from storage/sync — a malformed FEN must degrade to an
  // empty tile, not throw and take the whole Review panel down with it.
  if (ranks.length !== 8) return '<div class="mini-board"></div>';
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
        html += renderMiniSquare(square, dark, ch.toLowerCase(), color, highlights);
        file++;
      }
    }
  }
  html += "</div>";
  return html;
}

function renderMiniSquare(square, dark, pieceType, color, highlights) {
  const highlight = highlights[square] || {};
  const highlightClass = typeof highlight === "string" ? highlight : highlight.className || "";
  const qualityKey = typeof highlight === "string" ? "" : highlight.qualityKey || "";
  const quality = qualityKey ? MOVE_QUALITIES[qualityKey] || MOVE_QUALITIES.good : null;
  const markerText = quality?.symbol || (highlightClass.endsWith("-to") ? (highlightClass.startsWith("best") ? "B" : "P") : "");
  const marker = markerText ? `<span class="mini-marker ${quality ? qualityClassName(qualityKey) : ""}">${escapeHtml(markerText)}</span>` : "";
  return `
    <div class="mini-sq ${dark ? "dark" : "light"} ${highlightClass} ${quality ? qualityClassName(qualityKey) : ""}">
      ${pieceType ? pieceImageHtml(color, pieceType, "mini-piece") : ""}
      ${marker}
    </div>
  `;
}

function getSkillForPractice(item) {
  return getSkillById(item?.skillId) || getSkillForCategory(item?.category);
}

function getPrimarySkillForMove(move) {
  const tag = move?.tags?.[0];
  if (tag?.category) return getSkillForCategory(tag.category);
  if (move?.bestMoveUci && move.bestMoveUci !== move.uci) return getSkillById("candidate-moves");
  return null;
}

function shouldOfferSkillTraining(move) {
  if (!move || move.role !== "player") return false;
  if (move.tags?.length) return true;
  if (["inaccuracy", "mistake", "blunder", "missed_win"].includes(move.qualityKey)) return true;
  return typeof move.evalDelta === "number" && move.evalDelta >= 50 && Boolean(move.bestMoveUci);
}

function getSkillLabCounts(skill) {
  const categories = getSkillCategories(skill);
  return {
    focus: CURATED_PRACTICE_PUZZLES.filter((puzzle) => categories.includes(puzzle.category)).length,
    mixed: CURATED_PRACTICE_PUZZLES.length,
    game_transfer: state.practiceQueue.filter((item) => categories.includes(item.category)).length,
  };
}

function getPersonalSkillPractice(skill) {
  const categories = getSkillCategories(skill);
  return state.practiceQueue
    .filter((item) => categories.includes(item.category))
    .sort((a, b) => getCategoryPriority(b.category) - getCategoryPriority(a.category));
}

function withSkillLabMode(puzzle, skill, mode) {
  if (!puzzle || !skill) return null;
  const modeInfo = SKILL_LAB_MODES.find((item) => item.id === mode) || SKILL_LAB_MODES[0];
  const titlePrefix = mode === "game_transfer" ? "From your game" : `${skill.label} ${modeInfo.label}`;
  return {
    ...puzzle,
    skillId: skill.id,
    labMode: mode,
    type: `${skill.label} lab`,
    title: puzzle.title || titlePrefix,
    plainTitle: mode === "mixed" ? "Mixed tactic scan" : mode === "game_transfer" ? "From your game" : (puzzle.plainTitle || skill.shortLabel),
    plainGoal: mode === "focus"
      ? skill.focusPrompt
      : mode === "mixed"
        ? skill.mixedPrompt
        : (puzzle.plainGoal || skill.transferPrompt),
    hintSteps: [
      skill.scanPrompt,
      ...(Array.isArray(puzzle.hintSteps) ? puzzle.hintSteps : []),
    ].filter(Boolean).slice(0, 4),
    successText: puzzle.successText || `Correct. That is the ${skill.shortLabel || skill.label} pattern.`,
    missText: puzzle.missText || `Not yet. ${skill.scanPrompt}`,
  };
}

function getCuratedSkillPuzzles(skill) {
  const categories = getSkillCategories(skill);
  const matches = CURATED_PRACTICE_PUZZLES.filter((puzzle) => categories.includes(puzzle.category));
  return matches.length ? matches : CURATED_PRACTICE_PUZZLES;
}

function selectSkillLabPuzzle(skill, mode = "focus") {
  const solvedKeys = getRecentlySolvedPracticeKeys();
  const personal = getPersonalSkillPractice(skill)
    .map(practiceItemToPuzzle)
    .filter(Boolean);

  if (mode === "game_transfer") {
    const puzzle = personal.find((item) => !solvedKeys.has(getPracticeSourceKey(item))) || personal[0];
    return withSkillLabMode(puzzle, skill, "game_transfer");
  }

  const curatedPool = mode === "mixed" ? CURATED_PRACTICE_PUZZLES : getCuratedSkillPuzzles(skill);
  const curated = curatedPool
    .map((puzzle) => withSkillLabMode(puzzle, skill, mode))
    .filter(Boolean)
    .sort((a, b) => {
      const aSolved = solvedKeys.has(getPracticeSourceKey(a)) ? 1 : 0;
      const bSolved = solvedKeys.has(getPracticeSourceKey(b)) ? 1 : 0;
      return aSolved - bSolved
        || getSkillPriority(getSkillForPractice(b)) - getSkillPriority(getSkillForPractice(a))
        || (a.difficulty || 1) - (b.difficulty || 1);
    });

  return curated[0] || null;
}

function startSkillLab(skillId = state.selectedSkillId, mode = "focus") {
  const skill = getSkillById(skillId) || prioritizeSkills()[0] || SKILL_CATALOG[0];
  const puzzle = selectSkillLabPuzzle(skill, mode);
  if (!puzzle) return false;
  state.selectedSkillId = skill.id;
  return startPracticePuzzle(puzzle, { render: true });
}

function reviewMoveToPuzzle(move) {
  if (!move?.beforeFen) return null;
  const skill = getPrimarySkillForMove(move) || getSkillById("candidate-moves");
  const tag = move.tags?.[0];
  const ranked = rankCandidateMoves(move.beforeFen).slice(0, 3);
  const candidates = move.bestMoveUci
    ? [{ san: move.bestMoveSan || uciToSan(move.beforeFen, move.bestMoveUci) || move.bestMoveUci, uci: move.bestMoveUci }]
    : ranked.map((candidate) => ({
        san: candidate.san,
        uci: `${candidate.from}${candidate.to}${candidate.promotion || ""}`,
      }));

  if (!candidates.length) return null;

  return normalizePracticePuzzle({
    id: `review-${move.id}`,
    source: "personal",
    sourceKey: `review:${move.id}:${skill.id}`,
    skillId: skill.id,
    labMode: "game_transfer",
    category: tag?.category || skill.categoryAliases?.[0] || "candidate_moves",
    plainTitle: "Retry from review",
    title: skill.label,
    difficulty: 2,
    playerColor: move.beforeFen.split(" ")[1] || state.settings.playerColor,
    fen: move.beforeFen,
    expectedMoves: candidates.map((candidate) => candidate.uci),
    targetSquares: candidates.map((candidate) => candidate.uci.slice(2, 4)).filter(Boolean),
    hintSquares: candidates[0]?.uci ? [candidates[0].uci.slice(0, 2), candidates[0].uci.slice(2, 4)] : [],
    plainGoal: `This is the position before ${move.san}. Find the stronger ${skill.shortLabel || skill.label} idea.`,
    hintSteps: [
      tag?.note || skill.transferPrompt,
      candidates[0]?.san ? `Compare ${candidates[0].san}.` : skill.scanPrompt,
      skill.scanPrompt,
    ].filter(Boolean),
    successText: "Correct. You found the better idea from your reviewed game.",
    missText: "Not yet. Slow down and run the scan before moving.",
  });
}

function startReviewRetry(ply) {
  const move = state.moves.find((item) => item.ply === Number(ply));
  const puzzle = reviewMoveToPuzzle(move);
  if (!puzzle) return false;
  state.selectedSkillId = puzzle.skillId || state.selectedSkillId;
  return startPracticePuzzle(puzzle, { render: true });
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
  const skill = getSkillForPractice(puzzle);
  return {
    ...puzzle,
    isPracticeTrainer: true,
    source: puzzle.source || "curated",
    sourceKey: getPracticeSourceKey(puzzle),
    skillId: skill?.id || "",
    labMode: puzzle.labMode || (puzzle.source === "personal" ? "game_transfer" : "focus"),
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
  const skill = getSkillForPractice(item);
  const turn = item.fen.split(" ")[1] || state.settings.playerColor;
  const bestCandidate = candidates[0];
  return normalizePracticePuzzle({
    id: `queue-${item.id}`,
    source: "personal",
    sourceKey: item.sourceKey,
    queueItemId: item.id,
    skillId: skill?.id || "",
    labMode: item.labMode || "game_transfer",
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
  const curated = [...CURATED_PRACTICE_PUZZLES, ...getRatedPuzzlesNearLevel()]
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

// ─────────── Rated tactics pack (Lichess CC0 import) ───────────

async function loadPuzzlePack() {
  if (state.puzzlePack.status === "loading" || state.puzzlePack.status === "ready") return;
  state.puzzlePack.status = "loading";
  try {
    const response = await fetch("/vendor/puzzles/lichess-pack.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.puzzlePack.puzzles = (data.puzzles || []).map(normalizePackPuzzle).filter(Boolean);
    state.puzzlePack.status = "ready";
  } catch (error) {
    console.warn("Rated tactics pack could not load", error);
    state.puzzlePack.status = "error";
  }
  if (state.currentTab === "practice") renderPracticePanel();
}

// Pack puzzles within one difficulty band of the player's level, for the
// autostart rotation.
function getRatedPuzzlesNearLevel() {
  if (state.puzzlePack.status !== "ready") return [];
  const band = ratingBandForScore(getEstimatedTrainingScore());
  return state.puzzlePack.puzzles.filter((puzzle) => Math.abs((puzzle.band || 2) - band) <= 1);
}

function getWeaknessCategoriesRanked() {
  return Object.values(state.profile)
    .sort((a, b) => (b.count * b.severity) - (a.count * a.severity))
    .map((entry) => entry.category);
}

function startRatedPuzzle() {
  const puzzle = selectRatedPuzzle(state.puzzlePack.puzzles, {
    score: getEstimatedTrainingScore(),
    solvedKeys: getRecentlySolvedPracticeKeys(60),
    weaknessCategories: getWeaknessCategoriesRanked(),
    excludeKey: getPracticeSourceKey(state.activeDrill),
  });
  if (puzzle) startPracticePuzzle(puzzle, { render: true });
}

function resetPracticeTrainerState() {
  state.practiceTrainer = {
    attempts: 0,
    hintIndex: 0,
    status: "trying",
    lastMoveUci: "",
    scoreDelta: 0,
    feedback: "",
    hadMiss: false,
  };
}

function startPracticePuzzle(puzzle, options = {}) {
  const normalized = normalizePracticePuzzle(puzzle);
  if (!normalized) return false;
  cancelDeepAnalysis();
  teardownBoardInteractions();

  if (!state.activeDrill && options.saveCurrent !== false) {
    state.pausedGameId = savePausedGameForDrill();
  }
  // The saved game keeps its remaining time; the drill itself is untimed.
  state.clocks = null;
  renderClocks();

  state.activeDrill = structuredClone(normalized);
  state.activeDrill.step = 0;
  state.activeDrill.source = normalized.source;
  // Multi-move puzzles restart from the top of the scripted line (a retry may
  // pass a drill whose lineIndex/hints advanced mid-solve).
  if (Array.isArray(state.activeDrill.solutionLine) && state.activeDrill.solutionLine.length) {
    const first = state.activeDrill.solutionLine[0];
    state.activeDrill.lineIndex = 0;
    state.activeDrill.targetSquares = [first.slice(2, 4)];
    state.activeDrill.hintSquares = [first.slice(0, 2)];
  }
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

function hasLiveGameInProgress() {
  return !state.activeDrill && state.moves.length > 0 && !state.game.isGameOver() && !state.clocks?.flagged;
}

function ensurePracticeTrainer(options = {}) {
  if (!isCalibrationComplete() || state.activeDrill) return false;
  // Never silently replace a board with moves on it — live OR just finished.
  // (Auto-seating a puzzle right after a game ended vanished the game the
  // app had just pointed the player at for review.) The Practice panel
  // offers an explicit "Start practice" button instead.
  if (state.moves.length > 0 && !options.force) return false;
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
    ? `${getSkillForPractice(puzzle)?.label || "Skill"} lab - from your games`
    : `${getSkillForPractice(puzzle)?.label || "Skill"} lab - ${puzzle.labMode === "mixed" ? "mixed" : `difficulty ${puzzle.difficulty || 1}`}`;
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
      ${solved ? `<div class="tag-list"><span class="tag good">${escapeHtml(toTitleCaseLabel("Solved"))}</span><span class="tag">${escapeHtml(toTitleCaseLabel(puzzle.term))}</span></div>` : ""}
    </article>
  `;
}

function renderOpeningDrillCard() {
  if (!isOpeningDrill()) return "";
  const drill = state.activeDrill;
  const found = getLineById(drill.openingLineId);
  const total = found?.line.moves.length || 0;
  return `
    <article class="mini-card practice-trainer-card">
      <span class="label">Opening trainer · move ${Math.min(drill.plyIndex + 1, total)} of ${total}</span>
      <strong>${escapeHtml(drill.title)}</strong>
      <p>${escapeHtml(state.drillMessage || drill.objective)}</p>
      <div class="button-row">
        <button id="exitOpeningDrillButton" type="button">Exit drill</button>
      </div>
    </article>
  `;
}

// Active checkmate-ladder drill card: shows the drill's live feedback (which
// used to render only in the Coach tab — invisible from Practice, where the
// drill actually lives) and always offers a way out.
function renderMateDrillCard() {
  if (!isMateDrill()) return "";
  const drill = state.activeDrill;
  return `
    <article class="mini-card practice-trainer-card">
      <span class="label">Checkmate ladder</span>
      <strong>${escapeHtml(drill.title)}</strong>
      <p>${escapeHtml(state.drillMessage || drill.objective)}</p>
      <div class="button-row">
        ${drill.solved
          ? `<button id="nextMateDrillButton" class="primary-action" type="button">Next mate</button>`
          : ""}
        <button id="exitMateDrillButton" type="button">${drill.solved ? "Done" : "Exit drill"}</button>
      </div>
    </article>
  `;
}

function bindMateDrillCard() {
  document.querySelector("#exitMateDrillButton")?.addEventListener("click", exitMateDrill);
  document.querySelector("#nextMateDrillButton")?.addEventListener("click", () => {
    const solvedSet = new Set(state.mateLadder.solved || []);
    const next = ACTIVE_MATE_POSITIONS.find((position) =>
      isRungUnlocked(position.rung, state.mateLadder) && !solvedSet.has(position.id));
    if (next) {
      startMateDrill(next.id);
    } else {
      exitMateDrill();
    }
  });
}

function exitMateDrill() {
  if (!isMateDrill()) return;
  state.activeDrill = null;
  state.drillMessage = "";
  restorePausedGameOrFreshBoard();
  restartClocksForRestoredGame();
  renderAll();
}

function bindOpeningDrillCard() {
  document.querySelector("#exitOpeningDrillButton")?.addEventListener("click", () => {
    state.activeDrill = null;
    state.drillMessage = "";
    restorePausedGameOrFreshBoard();
    restartClocksForRestoredGame();
    renderAll();
  });
}

function renderOpeningTrainerSection() {
  const mine = state.repertoire.myOpenings;
  const selected = mine.length
    ? REPERTOIRE.filter((opening) => mine.includes(opening.id))
    : [];

  const lineCards = selected.flatMap((opening) => opening.lines.map((line) => {
    const progress = state.repertoire.lines[line.id];
    const dueText = progress ? nextDueLabel(ensureSrs(progress)) : "not started";
    const reps = progress?.reps || 0;
    return `
      <article class="practice-card">
        <span class="label">${escapeHtml(opening.name)} · ${escapeHtml(colorName(opening.side))} · ${escapeHtml(dueText)}${reps ? ` · ${reps} rep${reps === 1 ? "" : "s"}` : ""}</span>
        <strong>${escapeHtml(line.name)}</strong>
        <p>${escapeHtml(opening.summary)}</p>
        <div class="button-row">
          <button class="primary-action" type="button" data-opening-drill="${escapeAttr(line.id)}">Drill this line</button>
        </div>
      </article>
    `;
  })).join("");

  const pickers = REPERTOIRE.map((opening) => `
    <button class="candidate opening-pick ${mine.includes(opening.id) ? "picked" : ""}" type="button" data-toggle-opening="${escapeAttr(opening.id)}">
      ${escapeHtml(opening.name)} (${opening.side === "w" ? "White" : "Black"})
    </button>
  `).join("");

  return `
    ${lineCards || "<p class=\"empty-state\">Pick 2-4 openings below to build your repertoire. The trainer walks you through each line and explains every move.</p>"}
    <article class="mini-card">
      <span class="label">Choose my openings (up to 4)</span>
      <div class="candidate-list">${pickers}</div>
    </article>
  `;
}

function bindOpeningTrainerSection() {
  els.practicePanel.querySelectorAll("[data-toggle-opening]").forEach((button) => {
    button.addEventListener("click", () => toggleMyOpening(button.dataset.toggleOpening));
  });
  els.practicePanel.querySelectorAll("[data-opening-drill]").forEach((button) => {
    button.addEventListener("click", () => startOpeningDrill(button.dataset.openingDrill));
  });
}

function renderMateLadderSection() {
  const grouped = matesByRung();
  if (!grouped.size) return "<p class=\"empty-state\">No mate positions available yet.</p>";
  const rungs = [...grouped.keys()].sort((a, b) => a - b);
  const solvedSet = new Set(state.mateLadder.solved || []);
  const cards = rungs.map((rung) => {
    const unlocked = isRungUnlocked(rung, state.mateLadder);
    const positions = grouped.get(rung);
    return `
      <div class="mate-rung ${unlocked ? "" : "locked"}">
        <div class="mate-rung-head">
          <strong>Rung ${rung}</strong>
          <span>${unlocked ? "unlocked" : "solve 3 on lower rungs to unlock"}</span>
        </div>
        <div class="mate-list">
          ${positions.map((position) => `
            <button class="practice-card mate-card ${solvedSet.has(position.id) ? "solved" : ""}" type="button" data-start-mate="${escapeAttr(position.id)}" ${unlocked ? "" : "disabled"}>
              <strong>${escapeHtml(position.label)}</strong>
              <p>${escapeHtml(position.hint)}</p>
              ${solvedSet.has(position.id) ? "<span class=\"tag good\">Solved</span>" : ""}
            </button>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");
  return `<div class="stack">${cards}</div>`;
}

function bindMateLadderSection() {
  els.practicePanel.querySelectorAll("[data-start-mate]").forEach((button) => {
    button.addEventListener("click", () => startMateDrill(button.dataset.startMate));
  });
}

function renderWeaknessLabsSection() {
  const sorted = prioritizeSkills().slice(0, 4);
  const cards = sorted.map((skill) => {
    const counts = getSkillLabCounts(skill);
    return `
      <article class="practice-card">
        <span class="label">${skill.priority > 0 ? "Recommended focus" : "Skill"}</span>
        <strong>${escapeHtml(skill.label)}</strong>
        <p>${escapeHtml(skill.summary)}</p>
        <div class="button-row">
          <button type="button" data-start-weakness-lab="${escapeAttr(skill.id)}">Train this pattern</button>
          ${counts.game_transfer ? `<button type="button" data-start-weakness-transfer="${escapeAttr(skill.id)}">${escapeHtml(formatCountLabel(counts.game_transfer, "position from your game", "positions from your games"))}</button>` : ""}
        </div>
      </article>
    `;
  }).join("");
  return cards || "<p class=\"empty-state\">Weakness labs appear as the coach tags patterns in your games.</p>";
}

function bindWeaknessLabsSection() {
  els.practicePanel.querySelectorAll("[data-start-weakness-lab]").forEach((button) => {
    button.addEventListener("click", () => startSkillLab(button.dataset.startWeaknessLab, "focus"));
  });
  els.practicePanel.querySelectorAll("[data-start-weakness-transfer]").forEach((button) => {
    button.addEventListener("click", () => startSkillLab(button.dataset.startWeaknessTransfer, "game_transfer"));
  });
}

function renderPracticePanel() {
  if (!isCalibrationComplete()) {
    const lessonsPending = state.settings.beginnerMode === true && !allLessonsComplete(state.learn.completed);
    els.practicePanel.innerHTML = `
      <h2>Practice</h2>
      <div class="stack">
        <article class="mini-card calibration-card">
          <span class="label">Practice trainer</span>
          <strong>${lessonsPending ? "Lessons first, then practice" : "Unlocks after your calibration game"}</strong>
          <p>${lessonsPending
            ? "Finish the learn-to-play lessons, then play your first game. After that, the trainer builds puzzles matched to how you actually play."
            : "Finish your first game so the trainer can match puzzle difficulty to how you actually play."}</p>
          ${lessonsPending ? `<button id="practiceGoToLessonsButton" class="primary-action" type="button">Go to lessons</button>` : ""}
        </article>
      </div>
    `;
    document.querySelector("#practiceGoToLessonsButton")?.addEventListener("click", () => switchTab("learn"));
    return;
  }

  // A lesson owns the board — showing the full catalog here let one stray
  // click silently kill the lesson mid-step.
  if (isLessonDrill()) {
    els.practicePanel.innerHTML = `
      <h2>Practice</h2>
      <div class="stack">
        <article class="mini-card practice-start-card">
          <span class="label">Lesson in progress</span>
          <strong>${escapeHtml(getActiveLesson()?.title || "Learn to play")}</strong>
          <p>Finish (or exit) the lesson first — the practice trainer takes over the same board.</p>
          <div class="button-row">
            <button id="practiceBackToLessonButton" class="primary-action" type="button">Back to the lesson</button>
            <button id="practiceExitLessonButton" type="button">Exit lesson</button>
          </div>
        </article>
      </div>
    `;
    document.querySelector("#practiceBackToLessonButton")?.addEventListener("click", () => switchTab("learn"));
    document.querySelector("#practiceExitLessonButton")?.addEventListener("click", () => {
      exitLesson();
      renderPracticePanel();
    });
    return;
  }

  ensurePracticeTrainer();

  const hasLive = hasLiveGameInProgress();
  const hasFinishedOnBoard = !state.activeDrill && state.moves.length > 0 && !hasLive;
  const pausedGameCard = !state.activeDrill && (hasLive || hasFinishedOnBoard) ? `
    <article class="mini-card practice-start-card">
      <span class="label">Practice trainer</span>
      <strong>${hasLive ? "You have a game in progress" : "Your finished game stays on the board"}</strong>
      <p>${hasLive
        ? `Starting practice pauses your game. It's saved automatically — "Resume game" brings it right back.`
        : "Starting practice clears the board. The game is saved in Review whenever you want it."}</p>
      <div class="button-row">
        <button id="startPracticeSessionButton" class="primary-action" type="button">Start practice</button>
        <button id="backToGameButton" type="button">${hasLive ? "Back to my game" : "Back to review"}</button>
      </div>
    </article>
  ` : "";

  const dueItems = selectDue(state.practiceQueue.map((item) => ensureSrs(item)), new Date(), 4)
    .sort((a, b) => getCategoryPriority(b.category) - getCategoryPriority(a.category));
  const nextFocus = getNextTrainingFocus();
  const trainer = renderPracticeTrainer();
  const dueCards = dueItems.map((item) => `
    <article class="practice-card">
      <span class="label">${escapeHtml(getSkillForPractice(item)?.label || "Skill")} · from your games · ${escapeHtml(nextDueLabel(item))}</span>
      <strong>${escapeHtml(plainPracticeTitleForCategory(item.category))}</strong>
      <p>${escapeHtml(plainPracticeGoalForItem(item))}</p>
      <div class="button-row">
        <button type="button" data-practice-board="${escapeAttr(item.id)}">Practice on board</button>
      </div>
    </article>
  `).join("");
  const foundationCards = CURATED_PRACTICE_PUZZLES.map((puzzle) => `
    <button class="practice-card practice-select" type="button" data-start-puzzle="${escapeAttr(puzzle.id)}">
      <span class="label">${escapeHtml(getSkillForPractice(puzzle)?.label || "Foundation")} · difficulty ${puzzle.difficulty}</span>
      <strong>${escapeHtml(puzzle.plainTitle)}</strong>
      <span class="card-text">${escapeHtml(puzzle.plainGoal || getPracticeMotifGuide(puzzle.category).plainGoal)}</span>
    </button>
  `).join("");

  els.practicePanel.innerHTML = `
    <h2>Practice</h2>
    <div class="stack">
      ${pausedGameCard}
      ${renderDailyPlanCard()}
      ${renderOpeningDrillCard()}
      ${renderMateDrillCard()}
      ${trainer}
      ${nextFocus ? `
        <article class="mini-card priority-card">
          <span class="label">Priority queue</span>
          <strong>${escapeHtml(nextFocus.title)}</strong>
          <p>${escapeHtml(nextFocus.reason)}</p>
        </article>
      ` : ""}
      <h3>Due Drills</h3>
      ${dueCards || "<p class=\"empty-state\">Nothing due right now. Drills from your mistakes come back on a spaced schedule.</p>"}
      <h3>Rated Tactics</h3>
      ${renderRatedTacticsSection()}
      <h3>Checkmate Ladder</h3>
      ${renderMateLadderSection()}
      <h3>My Openings</h3>
      ${renderOpeningTrainerSection()}
      <h3>Weakness Labs</h3>
      ${renderWeaknessLabsSection()}
      <h3>Foundation Skills</h3>
      <div class="lesson-grid">${foundationCards}</div>
    </div>
  `;

  document.querySelector("#practiceHintButton")?.addEventListener("click", advancePracticeHint);
  document.querySelector("#practiceRetryButton")?.addEventListener("click", retryPracticePuzzle);
  document.querySelector("#startPracticeSessionButton")?.addEventListener("click", () => {
    ensurePracticeTrainer({ force: true });
    renderAll();
  });
  document.querySelector("#backToGameButton")?.addEventListener("click", () => {
    switchTab(hasLiveGameInProgress() ? "play" : "review");
  });
  bindOpeningDrillCard();
  bindMateDrillCard();
  bindOpeningTrainerSection();
  bindMateLadderSection();
  bindWeaknessLabsSection();
  document.querySelector("#practiceNextButton")?.addEventListener("click", startNextPracticePuzzle);
  document.querySelector("#resumeGameButton")?.addEventListener("click", resumeSavedGame);
  document.querySelector("#startRatedPuzzleButton")?.addEventListener("click", startRatedPuzzle);
  document.querySelector("#retryPuzzlePackButton")?.addEventListener("click", () => {
    state.puzzlePack.status = "idle";
    loadPuzzlePack();
    renderPracticePanel();
  });
  els.practicePanel.querySelectorAll("[data-practice-board]").forEach((button) => {
    button.addEventListener("click", () => startQueuedPractice(button.dataset.practiceBoard));
  });
  els.practicePanel.querySelectorAll("[data-start-puzzle]").forEach((button) => {
    const puzzle = CURATED_PRACTICE_PUZZLES.find((item) => item.id === button.dataset.startPuzzle);
    button.addEventListener("click", () => startPracticePuzzle(puzzle, { render: true }));
  });

  if (state.puzzlePack.status === "idle") {
    loadPuzzlePack();
  }
}

// Rated tactics pulled from the imported Lichess pack (CC0), matched to the
// player's current level and weakness profile.
function renderRatedTacticsSection() {
  const pack = state.puzzlePack;
  if (pack.status === "error") {
    return `
      <article class="mini-card rated-tactics-card">
        <p class="empty-state">The rated tactics pack could not load.</p>
        <div class="button-row">
          <button id="retryPuzzlePackButton" type="button">Try again</button>
        </div>
      </article>
    `;
  }
  if (pack.status !== "ready") {
    return "<p class=\"empty-state\">Loading rated tactics...</p>";
  }

  const band = ratingBandForScore(getEstimatedTrainingScore());
  const nearLevel = getRatedPuzzlesNearLevel();
  const solvedKeys = getRecentlySolvedPracticeKeys(60);
  const solvedCount = pack.puzzles.filter((puzzle) => solvedKeys.has(puzzle.sourceKey)).length;
  const bandLabel = ["", "600-899", "900-1199", "1200-1499", "1500-1799"][band] || "";

  return `
    <article class="mini-card rated-tactics-card">
      <span class="label">Around your level (${escapeHtml(bandLabel)})</span>
      <strong>${pack.puzzles.length} real-game puzzles, ${nearLevel.length} near your rating</strong>
      <p>Multi-move tactics from the Lichess puzzle database, picked for your level and weak spots. Solved recently: ${solvedCount}.</p>
      <div class="button-row">
        <button id="startRatedPuzzleButton" type="button" class="primary-action">Solve a rated puzzle</button>
      </div>
      <p class="empty-state">Puzzles: Lichess database (CC0).</p>
    </article>
  `;
}

function renderProfilePanel() {
  const summary = getProfileSummary();
  const calibrated = isCalibrationComplete();
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
          <span class="label">${calibrated ? "Current training score" : "Calibration"}</span>
          <strong>${calibrated ? summary.score : "1 game to go"}</strong>
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
      ${calibrated ? renderSkillDimensionCard() : ""}
      <article class="mini-card">
        <span class="label">${calibrated ? "Adaptive model" : "Calibration model"}</span>
        <strong>${calibrated ? "Coach is using your history" : "One calibration game needed"}</strong>
        <p>${calibrated
          ? `Estimated score ${summary.score}. Opponent strength adjusts from recent game results plus mistake severity.`
          : "Strengths, weaknesses, and coach advice unlock after your first completed game, then keep refining with every move you play."}</p>
      </article>
      <h3>Strengths</h3>
      ${calibrated ? (strengthRows || "<p class=\"empty-state\">Strengths need more solved practice positions.</p>") : "<p class=\"empty-state\">Strengths unlock after your calibration game.</p>"}
      <h3>Weaknesses</h3>
      ${calibrated ? (weaknessRows || "<p class=\"empty-state\">No recurring weaknesses tagged yet.</p>") : "<p class=\"empty-state\">Weaknesses are collected as you play.</p>"}
    </div>
  `;
}

// Tiny inline SVG sparkline from a dimension's recent per-move performance
// samples (0..1). Purely decorative — aria-hidden, the trend arrow carries
// the same information for screen readers.
function sparklineSvg(recent) {
  const points = (recent || []).filter((value) => Number.isFinite(value));
  if (points.length < 5) return "";
  const width = 72;
  const height = 20;
  const step = width / (points.length - 1);
  const path = points
    .map((value, index) => `${index === 0 ? "M" : "L"}${(index * step).toFixed(1)},${(height - 2 - value * (height - 4)).toFixed(1)}`)
    .join(" ");
  return `
    <svg class="skill-sparkline" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">
      <path d="${path}" fill="none"></path>
    </svg>
  `;
}

function renderSkillDimensionCard() {
  if (!state.skill?.dims) return "";
  const snapshot = skillSnapshot(state.skill);
  const rows = SKILL_DIMENSIONS.map((dim) => {
    const entry = snapshot[dim];
    if (!entry || entry.rating === null) return "";
    const percent = clamp(Math.round(((entry.rating - 400) / 1400) * 100), 2, 100);
    const trendArrow = entry.trend > 0 ? "▲" : entry.trend < 0 ? "▼" : "•";
    const trendClass = entry.trend > 0 ? "up" : entry.trend < 0 ? "down" : "flat";
    const spark = sparklineSvg(state.skill.dims[dim]?.recent);
    return `
      <div class="skill-dim-row">
        <div class="skill-dim-head">
          <strong>${escapeHtml(DIMENSION_LABELS[dim] || dim)}</strong>
          <span class="skill-dim-rating">${spark}${entry.rating} <span class="skill-trend ${trendClass}" title="Recent trend">${trendArrow}</span></span>
        </div>
        <div class="skill-dim-meter"><i style="width: ${percent}%"></i></div>
        <p class="skill-dim-next">Next level: ${escapeHtml(entry.nextLevel)}</p>
      </div>
    `;
  }).join("");
  if (!rows.trim()) return "";
  return `
    <article class="mini-card skill-dims-card">
      <span class="label">Skill dimensions</span>
      ${rows}
    </article>
  `;
}

// ─────────── Learn tab: lesson engine + panel ───────────

// Persist the learner's position in an unfinished lesson. Reviews of
// completed lessons never move resume points.
function persistLessonProgress(lessonId, stepIndex) {
  if (state.learn.completed.includes(lessonId)) return;
  state.learn.lessonId = lessonId;
  state.learn.stepIndex = stepIndex;
  state.learn.stepByLesson = { ...state.learn.stepByLesson, [lessonId]: stepIndex };
  state.learn.active = true;
  saveLearnState();
}

function setLessonFlash(text, tone = "note") {
  state.lessonFlash = text ? { text, tone } : null;
}

// Seats the board for a lesson. Lessons reuse the drill pipeline (scripted
// boards, no engine replies, no grading) with `isLesson` as the marker.
function startLesson(lessonId, options = {}) {
  const lesson = getLessonById(lessonId);
  if (!lesson) return false;
  cancelDeepAnalysis();
  teardownBoardInteractions();

  if (!state.activeDrill) {
    state.pausedGameId = savePausedGameForDrill();
  }
  state.clocks = null;
  renderClocks();

  // Resume this lesson's own progress unless this is an explicit restart.
  const resume = options.restart === true
    ? 0
    : clamp(state.learn.stepByLesson?.[lessonId] || 0, 0, lesson.steps.length - 1);

  state.activeDrill = {
    isLesson: true,
    lessonId,
    stepIndex: resume,
    completed: false,
    awaitingAdvance: false,
    playerColor: "w",
    title: lesson.title,
  };
  persistLessonProgress(lessonId, resume);
  setLessonFlash(null);
  seatLessonStep();

  if (options.switchTab === false) {
    renderAll();
  } else {
    switchTab("learn");
    renderAll();
  }
  return true;
}

function seatLessonStep() {
  const step = getActiveLessonStep();
  if (!step) return;
  state.game = new Chess(step.fen);
  state.moves = [];
  state.selectedSquare = null;
  state.legalTargets = new Set();
  state.lastMove = null;
  state.thinking = false;
  state.reviewPly = null;
  state.drillMessage = step.text;
}

function advanceLessonStep() {
  const lesson = getActiveLesson();
  if (!lesson) return;
  const nextIndex = state.activeDrill.stepIndex + 1;
  if (nextIndex >= lesson.steps.length) {
    markActiveLessonComplete(lesson);
    return;
  }
  state.activeDrill.stepIndex = nextIndex;
  persistLessonProgress(lesson.id, nextIndex);
  seatLessonStep();
  renderAll();
}

function markActiveLessonComplete(lesson) {
  state.activeDrill.completed = true;
  if (!state.learn.completed.includes(lesson.id)) {
    state.learn.completed = [...state.learn.completed, lesson.id];
  }
  // Only clear the Continue pointer when it pointed here — completing a
  // review of lesson A must not orphan in-progress lesson B.
  if (state.learn.lessonId === lesson.id || !state.learn.lessonId) {
    state.learn.lessonId = null;
    state.learn.stepIndex = 0;
  }
  state.learn.active = false;
  const stepByLesson = { ...state.learn.stepByLesson };
  delete stepByLesson[lesson.id];
  state.learn.stepByLesson = stepByLesson;
  saveLearnState();
  playGameSound("drillSolved");
  const courseDone = allLessonsComplete(state.learn.completed);
  celebrate(courseDone ? "milestone" : "lesson");
  state.drillMessage = courseDone
    ? "That was the last lesson — you know every rule of chess. Time to play your first real game."
    : `Lesson complete: ${lesson.title}.`;
  renderAll();
}

// Lesson moves never touch grading, history, or sync — the board is a
// teaching prop. Wrong moves (and any move on an info step) are rolled back.
async function handleLessonMove(move) {
  const drill = state.activeDrill;
  const step = getActiveLessonStep();

  // A move landed during the post-success pause (fast learner): skip straight
  // to the next step instead of judging the move against the old task.
  if (drill.awaitingAdvance) {
    state.game.undo();
    drill.awaitingAdvance = false;
    advanceLessonStep();
    return;
  }

  if (!step || step.kind !== "task" || drill.completed) {
    state.game.undo();
    setLessonFlash(drill.completed
      ? "Lesson complete — pick your next lesson in the panel."
      : "Read the card in the Learn panel, then press Next.", "note");
    renderAll();
    return;
  }

  const playedUci = `${move.from}${move.to}${move.promotion || ""}`;
  if (!step.expectedMoves.includes(playedUci)) {
    state.game.undo();
    playGameSound("drillMissed");
    setLessonFlash(step.fail || "Not quite — try again.", "miss");
    // Guide the retry: pre-select the piece that should move so its legal
    // squares light up alongside the ★ target.
    const hintFrom = step.hintSquares?.[0] || step.expectedMoves[0]?.slice(0, 2);
    if (hintFrom && state.game.get(hintFrom)?.color === "w") {
      state.selectedSquare = hintFrom;
      state.legalTargets = new Set(state.game.moves({ square: hintFrom, verbose: true }).map((m) => m.to));
    }
    renderAll();
    return;
  }

  state.lastMove = { from: move.from, to: move.to };
  playGameSound("drillSolved");
  setLessonFlash(step.success || "Correct!", "success");
  drill.awaitingAdvance = true;
  renderAll();

  // Let the success flash and the final position breathe before re-seating.
  // Clicking the board (or moving again) during the pause skips it.
  await wait(800);
  if (state.activeDrill !== drill || !drill.awaitingAdvance) return;
  drill.awaitingAdvance = false;
  advanceLessonStep();
}

function exitLesson() {
  if (!isLessonDrill()) return;
  teardownBoardInteractions();
  state.activeDrill = null;
  state.drillMessage = "";
  setLessonFlash(null);
  state.learn.active = false;
  saveLearnState();
  restorePausedGameOrFreshBoard();
  restartClocksForRestoredGame();
  renderAll();
}

// First-launch answer to "have you played chess before?".
function chooseLearnPath(beginner) {
  state.learn.pathChosen = true;
  saveLearnState();
  if (beginner) {
    state.settings.beginnerMode = true;
    saveJson(STORAGE_KEYS.settings, state.settings);
    const next = getNextLesson(state.learn.completed);
    if (next) {
      startLesson(next.id);
      return;
    }
    switchTab("learn");
  }
  renderAll();
}

function startFirstRealGame() {
  // newGame() clears the lesson drill; no confirm fires because drills are
  // never counted as games in progress.
  newGame();
  switchTab("play");
}

function getCurrentBeginnerTip() {
  const tips = beginnerTips();
  if (!tips.length) return "";
  return tips[state.learn.completed.length % tips.length];
}

// The lesson the learner should land in next: their own in-progress lesson
// first, then the first incomplete one in curriculum order.
function getResumeLesson() {
  if (state.learn.lessonId && !state.learn.completed.includes(state.learn.lessonId)) {
    return getLessonById(state.learn.lessonId);
  }
  return getNextLesson(state.learn.completed);
}

// Static rules reminders shown during beginner pre-calibration games. Rules
// only — no engine advice — so the calibration measurement stays honest.
function renderBeginnerCheatSheet() {
  if (state.learn.cheatSheetDismissed) return "";
  return `
    <article class="mini-card lesson-cheat-card dismissible-card">
      <button class="dismiss-card-button" id="dismissCheatSheetButton" type="button" aria-label="Dismiss reminders">×</button>
      <span class="label">Quick reminders</span>
      <ul class="cheat-list">
        <li>Piece values: pawn 1 · knight 3 · bishop 3 · rook 5 · queen 9.</li>
        <li>Before every move: what did their last move attack?</li>
        <li>Before every capture: what takes back?</li>
        <li>Develop knights and bishops, castle early.</li>
      </ul>
    </article>
  `;
}

function bindBeginnerCheatSheet() {
  document.querySelector("#dismissCheatSheetButton")?.addEventListener("click", () => {
    state.learn.cheatSheetDismissed = true;
    saveLearnState();
    renderCoachPanel();
  });
}

// A reload mid-lesson should put the lesson back on the board instead of
// stranding the learner on the paused (usually empty) game. A restored real
// game with moves always wins over the lesson.
function maybeResumeLessonOnBoot() {
  // Anyone can be mid-lesson, not only beginner-mode users — a non-beginner
  // reloading mid-lesson used to be dumped on their old game with
  // learn.active stuck true (a surprise auto-resume waiting to happen).
  if (!state.learn.active || !state.learn.lessonId) return;
  if (state.learn.completed.includes(state.learn.lessonId)) {
    state.learn.active = false;
    saveLearnState();
    return;
  }
  if (state.moves.length) {
    // A live game takes priority over resuming the lesson; clear the stale
    // flag so the lesson doesn't resurrect on some future boot.
    state.learn.active = false;
    saveLearnState();
    return;
  }
  // Seat the lesson without a tab switch, then apply the Learn tab's classes
  // via the history-neutral path; boot's replaceState snapshots the result.
  startLesson(state.learn.lessonId, { switchTab: false });
  switchTab("learn", { fromHistory: true });
}

function renderLearnPanel() {
  const learn = state.learn;
  const doneCount = LESSONS.filter((lesson) => learn.completed.includes(lesson.id)).length;
  const allDone = allLessonsComplete(learn.completed);
  const percent = Math.round((doneCount / LESSONS.length) * 100);

  const progressCard = `
    <article class="mini-card learn-progress-card">
      <span class="label">Learn to play</span>
      <strong>${allDone ? "You know the rules" : "The rules of chess, one board at a time"}</strong>
      <div class="learn-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${LESSONS.length}" aria-valuenow="${doneCount}" aria-label="Lessons completed">
        <div class="learn-progress-fill" style="width:${percent}%"></div>
      </div>
      <p>${allDone
        ? "Every rule is covered. You can revisit any lesson below, or start playing — the coach takes it from here."
        : `${doneCount} of ${LESSONS.length} lessons done. Short interactive boards — you learn by moving the pieces.`}</p>
      ${allDone ? `<button class="primary-action js-play-first-game" type="button">Play a real game</button>` : ""}
    </article>
  `;

  const activeCard = isLessonDrill() ? renderActiveLessonCard() : "";

  const rows = LESSONS.map((lesson, index) => {
    const done = learn.completed.includes(lesson.id);
    const isActive = isLessonDrill() && state.activeDrill.lessonId === lesson.id;
    const resumable = !done && (learn.stepByLesson?.[lesson.id] || 0) > 0;
    const status = done ? "✓ Done" : resumable ? "In progress" : "";
    const action = isActive ? "" : `<button type="button" data-lesson-start="${escapeAttr(lesson.id)}">${done ? "Review" : resumable ? "Continue" : "Start"}</button>`;
    return `
      <article class="lesson-row${done ? " done" : ""}${isActive ? " active" : ""}">
        <span class="lesson-index">${index + 1}</span>
        <div class="lesson-row-body">
          <strong>${escapeHtml(lesson.title)}</strong>
          <p>${escapeHtml(lesson.summary)}</p>
        </div>
        ${status ? `<span class="lesson-status">${escapeHtml(status)}</span>` : ""}
        ${action}
      </article>
    `;
  }).join("");

  els.learnPanel.innerHTML = `
    <h2>Learn</h2>
    <div class="stack">
      ${activeCard}
      ${progressCard}
      <div class="lesson-list">${rows}</div>
    </div>
  `;

  els.learnPanel.querySelectorAll("[data-lesson-start]").forEach((button) => {
    button.addEventListener("click", () => startLesson(button.dataset.lessonStart));
  });
  document.querySelector("#lessonNextButton")?.addEventListener("click", () => {
    setLessonFlash(null);
    advanceLessonStep();
  });
  document.querySelector("#lessonNextLessonButton")?.addEventListener("click", () => {
    const next = getNextLesson(state.learn.completed);
    if (next) startLesson(next.id);
  });
  document.querySelector("#lessonRestartButton")?.addEventListener("click", () => {
    startLesson(state.activeDrill.lessonId, { restart: true });
  });
  document.querySelector("#lessonExitButton")?.addEventListener("click", exitLesson);
  els.learnPanel.querySelectorAll(".js-play-first-game").forEach((button) => {
    button.addEventListener("click", startFirstRealGame);
  });
}

function renderLessonFlashHtml() {
  const flash = state.lessonFlash;
  // The element is always present (zero-height when empty) so aria-live
  // announcements fire when feedback text arrives.
  return `<p class="lesson-flash${flash ? ` ${flash.tone}` : " empty"}" aria-live="polite">${flash ? escapeHtml(flash.text) : ""}</p>`;
}

function renderActiveLessonCard() {
  const lesson = getActiveLesson();
  if (!lesson) return "";
  const drill = state.activeDrill;
  const step = lesson.steps[drill.stepIndex];
  const completed = drill.completed;
  const lessonNumber = LESSONS.findIndex((entry) => entry.id === lesson.id) + 1;
  const allDone = allLessonsComplete(state.learn.completed);
  const nextLesson = getNextLesson(state.learn.completed);

  const buttons = completed
    ? `
      ${allDone
        ? `<button class="primary-action js-play-first-game" type="button">Play your first game</button>`
        : `<button id="lessonNextLessonButton" class="primary-action" type="button">Next lesson: ${escapeHtml(nextLesson?.title || "")}</button>`}
      <button id="lessonRestartButton" type="button">Replay lesson</button>
      <button id="lessonExitButton" type="button">Exit</button>
    `
    : `
      ${step.kind === "info" ? `<button id="lessonNextButton" class="primary-action" type="button">Next</button>` : ""}
      <button id="lessonRestartButton" type="button">Restart lesson</button>
      <button id="lessonExitButton" type="button">Exit</button>
    `;

  return `
    <article class="mini-card lesson-active-card${completed ? " solved" : ""}">
      <span class="label">Lesson ${lessonNumber} of ${LESSONS.length} · Step ${Math.min(drill.stepIndex + 1, lesson.steps.length)} of ${lesson.steps.length}</span>
      <strong>${escapeHtml(completed ? `Lesson complete: ${lesson.title}` : lesson.title)}</strong>
      ${renderLessonFlashHtml()}
      <p>${escapeHtml(completed ? state.drillMessage : step.text)}</p>
      ${!completed && step.kind === "task" ? `<p class="lesson-task-note">Your move — play it on the board.</p>` : ""}
      <div class="button-row">${buttons}</div>
    </article>
  `;
}

function renderSettingsPanel() {
  const calibrated = isCalibrationComplete();
  const erase = state.historyErase;
  const account = state.account;
  const remoteEraseAvailable = canCloudSync() || state.featureFlags.remoteHistoryEraseEnabled;
  els.settingsPanel.innerHTML = `
    <h2>Settings</h2>
    <div class="settings-grid">
      ${renderAccountCard()}
      ${renderRequiredServicesCard()}
      <article class="mini-card">
        <strong>Bot difficulty</strong>
        <p>${calibrated
          ? "Adaptive mode is active. The opponent adjusts automatically from your estimated score, recent results, and mistake severity."
          : "Calibration mode is active. Finish your first game and the opponent starts adapting to you."}</p>
      </article>
      <article class="mini-card">
        <strong>Personal coach</strong>
        <p>${isOpenAIReady() ? "Online and ready to coach." : escapeHtml(state.openAI.status || "The coach is not available right now.")}</p>
        <button id="testOpenAIButton" type="button">Test coach</button>
      </article>
      <article class="mini-card">
        <strong>Cloud sync</strong>
        <p class="sync-status-row"><span class="label">Storage</span> ${escapeHtml(getStorageStatusLabel())}</p>
        <p>${state.sync.reachable
          ? "Connected. Games, moves, practice, and profile events sync to your account."
          : state.server.syncConfigured
            ? "Sign in to keep long-term history in your account. Play always works locally."
            : "Not configured on the server. Play always works locally; history stays in this browser."}</p>
        ${state.sync.health ? `<p>${escapeHtml(state.sync.health)}</p>` : ""}
      </article>
      <label class="field">
        <span>Your name</span>
        <input id="displayNameInput" type="text" maxlength="32" value="${escapeAttr(getDisplayName())}" placeholder="You">
      </label>
      <label class="field">
        <span>Player color</span>
        <select id="playerColorInput">
          <option value="w"${getPreferredColor() === "w" ? " selected" : ""}>White</option>
          <option value="b"${getPreferredColor() === "b" ? " selected" : ""}>Black</option>
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
      <label class="field">
        <span>Time control</span>
        <select id="timeControlInput">
          <option value="unlimited"${state.settings.timeControl === "unlimited" ? " selected" : ""}>Unlimited</option>
          <option value="5+0"${state.settings.timeControl === "5+0" ? " selected" : ""}>5 min blitz</option>
          <option value="10+0"${state.settings.timeControl === "10+0" ? " selected" : ""}>10 min rapid</option>
          <option value="15+10"${state.settings.timeControl === "15+10" ? " selected" : ""}>15 + 10 rapid</option>
        </select>
      </label>
      <label class="field checkbox-field">
        <input id="soundEnabledInput" type="checkbox"${state.settings.soundEnabled !== false ? " checked" : ""}>
        <span>Move sounds</span>
      </label>
      <label class="field checkbox-field">
        <input id="showBestArrowInput" type="checkbox"${state.settings.showBestArrow !== false ? " checked" : ""}>
        <span>Show best-move arrow after mistakes</span>
      </label>
      <label class="field checkbox-field">
        <input id="showEvalBarInput" type="checkbox"${state.settings.showEvalBar !== false ? " checked" : ""}>
        <span>Show evaluation bar</span>
      </label>
      <label class="field checkbox-field">
        <input id="familyModeInput" type="checkbox"${isFamilyMode() ? " checked" : ""}>
        <span>Family mode — gentle coach, softer feedback</span>
      </label>
      <label class="field checkbox-field">
        <input id="beginnerModeInput" type="checkbox"${state.settings.beginnerMode === true ? " checked" : ""}>
        <span>Beginner mode — learn-to-play lessons, gentle opponent, no clocks</span>
      </label>
      ${renderAppearanceCards()}
      ${renderPersonaCard()}
      <div class="button-row">
        <button id="testSupabaseButton" type="button">Test cloud sync</button>
      </div>
      ${isFamilyMode() ? "" : `
      <article class="mini-card danger-zone-card">
        <span class="label">Danger zone</span>
        <strong>Erase history</strong>
        <p>Clear games, moves, calibration, weakness profile, practice queue, and practice history. Settings and your account stay saved.</p>
        ${erase.status ? `<p class="sync-status-row good-status"><span class="label">Status</span> ${escapeHtml(erase.status)}</p>` : ""}
        ${erase.error ? `<p class="sync-status-row danger-status"><span class="label">Error</span> ${escapeHtml(erase.error)}</p>` : ""}
        <div class="button-row">
          <button id="eraseLocalHistoryButton" type="button" class="danger-button"${erase.busy ? " disabled" : ""}>Erase local history</button>
          ${remoteEraseAvailable ? `<button id="eraseRemoteHistoryButton" type="button" class="danger-button"${erase.busy ? " disabled" : ""}>Erase local + cloud history</button>` : ""}
        </div>
      </article>
      `}
    </div>
  `;

  bindRequiredServicesCard();
  // Every field applies on change — the old split model (some fields instant,
  // others behind a "Save settings" button) silently discarded edits whenever
  // an instant toggle re-rendered the panel.
  for (const selector of [
    "#displayNameInput",
    "#playerColorInput",
    "#coachModeInput",
    "#timeControlInput",
    "#soundEnabledInput",
    "#showBestArrowInput",
    "#showEvalBarInput",
  ]) {
    document.querySelector(selector)?.addEventListener("change", () => saveSettingsFromPanel());
  }
  document.querySelector("#testOpenAIButton").addEventListener("click", () => checkOpenAIHealth());
  document.querySelector("#testSupabaseButton").addEventListener("click", testSupabaseConnection);
  document.querySelector("#eraseLocalHistoryButton")?.addEventListener("click", eraseLocalHistory);
  document.querySelector("#eraseRemoteHistoryButton")?.addEventListener("click", eraseRemoteHistory);
  document.querySelector("#signOutButton")?.addEventListener("click", signOut);
  document.querySelector("#signInAgainButton")?.addEventListener("click", () => {
    signInAgain().catch((error) => console.warn("Sign-in flow failed", error));
  });
  document.querySelector("#exportDataButton")?.addEventListener("click", exportAccountData);
  document.querySelector("#familyModeInput")?.addEventListener("change", (event) => setFamilyMode(event.target.checked));
  document.querySelector("#beginnerModeInput")?.addEventListener("change", (event) => setBeginnerMode(event.target.checked));
  els.settingsPanel.querySelectorAll("[data-app-theme-key]").forEach((button) => {
    button.addEventListener("click", () => setAppTheme(button.dataset.appThemeKey));
  });
  els.settingsPanel.querySelectorAll("[data-board-theme-key]").forEach((button) => {
    button.addEventListener("click", () => setBoardTheme(button.dataset.boardThemeKey));
  });
  els.settingsPanel.querySelectorAll("[data-piece-set-key]").forEach((button) => {
    button.addEventListener("click", () => setPieceSet(button.dataset.pieceSetKey));
  });
  els.settingsPanel.querySelectorAll("[data-persona-key]").forEach((button) => {
    button.addEventListener("click", () => setCoachPersona(button.dataset.personaKey));
  });
}

// Board theme swatches + piece set previews. Both apply instantly on click.
function renderAppearanceCards() {
  const activeAppTheme = normalizeAppThemeKey(state.settings.appTheme);
  const appLooks = APP_THEMES.map((theme) => {
    const cells = theme.colors.map((color) => `<span style="background:${color}"></span>`).join("");
    return `
      <button type="button" class="theme-swatch app-look-option${theme.key === activeAppTheme ? " selected" : ""}" data-app-theme-key="${escapeAttr(theme.key)}">
        <span class="theme-swatch-preview app-look-preview">${cells}</span>
        <strong>${escapeHtml(theme.label)}</strong>
        <span class="app-look-blurb">${escapeHtml(theme.blurb)}</span>
      </button>
    `;
  }).join("");

  const activeTheme = normalizeBoardThemeKey(state.settings.boardTheme);
  const swatches = BOARD_THEMES.map((theme) => {
    const cells = [0, 1, 2, 3, 4, 5, 6, 7].map((index) => {
      const isDark = (index + Math.floor(index / 4)) % 2 === 1;
      return `<span style="background:${isDark ? theme.dark : theme.light}"></span>`;
    }).join("");
    return `
      <button type="button" class="theme-swatch${theme.key === activeTheme ? " selected" : ""}" data-board-theme-key="${escapeAttr(theme.key)}">
        <span class="theme-swatch-preview">${cells}</span>
        ${escapeHtml(theme.label)}
      </button>
    `;
  }).join("");

  const activeSet = getActivePieceSet();
  const setOptions = (state.server.pieceSets || [DEFAULT_PIECE_SET]).map((set) => `
    <button type="button" class="piece-set-option${set === activeSet ? " selected" : ""}" data-piece-set-key="${escapeAttr(set)}">
      <span class="piece-set-preview">
        <img src="${escapeAttr(pieceSpriteUrl("w", "n", set))}" alt="" draggable="false">
        <img src="${escapeAttr(pieceSpriteUrl("b", "q", set))}" alt="" draggable="false">
      </span>
      ${escapeHtml(toTitleCaseLabel(set))}
    </button>
  `).join("");

  return `
    <article class="mini-card">
      <strong>App look</strong>
      <p>How the whole app feels — colors, type, and celebration energy.</p>
      <div class="theme-swatch-grid app-look-grid">${appLooks}</div>
    </article>
    <article class="mini-card">
      <strong>Board theme</strong>
      <div class="theme-swatch-grid">${swatches}</div>
    </article>
    <article class="mini-card">
      <strong>Pieces</strong>
      <div class="piece-set-grid">${setOptions}</div>
    </article>
  `;
}

// Persona picker: voice only — locked to Sunny while Family mode is on.
function renderPersonaCard() {
  const activeKey = getActivePersonaKey();
  const locked = isFamilyMode();
  const options = Object.entries(COACH_PERSONAS).map(([key, persona]) => `
    <button type="button" class="persona-option${key === activeKey ? " selected" : ""}" data-persona-key="${escapeAttr(key)}"${locked ? " disabled" : ""}>
      <strong>${escapeHtml(persona.label)}</strong>
      <span>${escapeHtml(persona.description)}</span>
    </button>
  `).join("");

  return `
    <article class="mini-card">
      <strong>Coach personality</strong>
      ${locked ? "<p>Family mode keeps Sunny as the coach.</p>" : "<p>Voice only — the coaching itself never changes.</p>"}
      <div class="persona-list">${options}</div>
    </article>
  `;
}

function setAppTheme(key) {
  const next = normalizeAppThemeKey(key);
  state.settings.appTheme = next;
  // Suggest the matching board palette while the board is still on
  // auto-pilot (the player has never hand-picked one).
  const suggested = APP_THEME_BOARD_SUGGESTIONS[next];
  if (state.settings.boardThemeAuto !== false && suggested && !isFamilyMode()) {
    state.settings.boardTheme = suggested;
    applyBoardTheme(suggested);
  }
  saveJson(STORAGE_KEYS.settings, state.settings);
  applyAppTheme(next);
  renderSettingsPanel();
}

function setBoardTheme(key) {
  state.settings.boardTheme = normalizeBoardThemeKey(key);
  // A hand-picked board sticks across app-look switches from now on.
  state.settings.boardThemeAuto = false;
  saveJson(STORAGE_KEYS.settings, state.settings);
  applyBoardTheme(state.settings.boardTheme);
  renderSettingsPanel();
}

function setPieceSet(key) {
  const available = state.server.pieceSets || [DEFAULT_PIECE_SET];
  state.settings.pieceSet = available.includes(key) ? key : DEFAULT_PIECE_SET;
  saveJson(STORAGE_KEYS.settings, state.settings);
  preloadPieceSet(getActivePieceSet());
  renderBoard();
  renderGameMeta();
  renderSettingsPanel();
}

function setCoachPersona(key) {
  if (isFamilyMode()) return;
  state.settings.coachPersona = normalizePersonaKey(key);
  saveJson(STORAGE_KEYS.settings, state.settings);
  renderSettingsPanel();
}

function setBeginnerMode(enabled) {
  state.settings.beginnerMode = Boolean(enabled);
  saveJson(STORAGE_KEYS.settings, state.settings);
  // The checkbox promises "no clocks" — honor it right away on a board with
  // no live game (mid-game clocks are left alone; the next game is unclocked).
  if (enabled && state.clocks && !state.moves.length && !state.activeDrill) {
    stopClockTicker();
    state.clocks = null;
  } else if (!enabled && !state.clocks && !state.moves.length && !state.activeDrill && !state.game.isGameOver()) {
    initClocksForNewGame();
  }
  // Bot strength and clock behavior read this live; repaint everything.
  renderAll();
}

function setFamilyMode(enabled) {
  state.settings.familyMode = Boolean(enabled);
  if (state.settings.familyMode) {
    // Remember the user's persona so turning family mode off restores it
    // instead of leaving Sunny selected forever.
    if (state.settings.coachPersona !== "sunny") {
      state.settings.prevPersona = state.settings.coachPersona;
    }
    state.settings.coachPersona = "sunny";
    if (normalizeBoardThemeKey(state.settings.boardTheme) === "slate") {
      state.settings.boardTheme = "candy";
      applyBoardTheme("candy");
    }
  } else if (state.settings.prevPersona) {
    state.settings.coachPersona = state.settings.prevPersona;
    state.settings.prevPersona = "";
  }
  saveJson(STORAGE_KEYS.settings, state.settings);
  // Quality labels across every panel change with this toggle.
  renderAll();
}

// Account card: identity, sign out, data export. Only meaningful when the
// server has auth configured; local mode explains itself instead.
function renderAccountCard() {
  if (!state.server.authRequired) {
    return `
      <article class="mini-card account-card">
        <span class="label">Account</span>
        <strong>Local mode</strong>
        <p>No account is configured on this server. Progress stays in this browser.</p>
      </article>
    `;
  }

  const email = state.auth.user?.email || "";
  return `
    <article class="mini-card account-card">
      <span class="label">Account</span>
      <strong>${isSignedIn() ? escapeHtml(email || "Signed in") : "Signed out"}</strong>
      <p>${isSignedIn()
        ? "Your games, coach memory, and skill profile sync to this account."
        : "Sign in to sync your training history."}</p>
      <div class="button-row">
        ${isSignedIn() ? `
          <button id="exportDataButton" type="button"${state.account.busy ? " disabled" : ""}>Export my data</button>
          <button id="signOutButton" type="button">Sign out</button>
        ` : `
          <button id="signInAgainButton" class="primary-action" type="button">Sign in</button>
        `}
      </div>
      ${state.account.status || state.account.error ? `
        <p class="${state.account.error ? "auth-error" : "auth-notice"}">${escapeHtml(state.account.error || state.account.status)}</p>
      ` : ""}
    </article>
  `;
}

// Signed out with auth configured: re-open the sign-in gate on demand. The
// card used to be a dead end (reload was the only path back to the gate).
async function signInAgain() {
  if (!state.auth.client) {
    const ready = await initAuthClient();
    if (!ready) {
      state.sync.health = state.auth.error || "Sign-in is unavailable right now.";
      renderSettingsPanel();
      return;
    }
  }
  state.auth.recovery = false;
  state.auth.screen = "sign_in";
  state.auth.allowDismiss = true;
  await ensureSignedIn();
  state.auth.allowDismiss = false;
  if (isSignedIn()) {
    // A (possibly different) account signed in — reload to re-namespace.
    window.location.reload();
  }
}

function getActivePlayerColor() {
  return state.activeDrill ? state.activeDrill.playerColor : state.settings.playerColor;
}

// Modal-ish overlay anchored above the promotion square. Returns "q"/"r"/"b"/"n"
// or null if the user dismisses.
// The promotion picker is the only board interaction that outlives its event
// handler via a Promise. Track a cancel hook so game teardown can dismiss it
// (resolving null = "no move") instead of leaving a stale overlay + document
// keydown listener over a different game.
let activePromotionCancel = null;

function cancelActivePromotionPicker() {
  activePromotionCancel?.();
}

function askForPromotionPiece(color, square) {
  return new Promise((resolve) => {
    const host = els.board.parentElement;
    if (!host) { resolve("q"); return; }
    const squareEl = els.board.querySelector(`[data-square="${square}"]`);
    if (!squareEl) { resolve("q"); return; }

    const overlay = document.createElement("div");
    overlay.className = "promotion-overlay";

    const menu = document.createElement("div");
    menu.className = `promotion-menu ${color === "w" ? "for-white" : "for-black"}`;
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-modal", "true");
    menu.setAttribute("aria-label", "Choose a piece to promote to");
    const hostRect = host.getBoundingClientRect();
    const squareRect = squareEl.getBoundingClientRect();
    menu.style.left = `${squareRect.left - hostRect.left + squareRect.width / 2}px`;
    // The menu opens toward the board's center, based on where the square
    // actually is ON SCREEN — not on piece color. The board is flipped for a
    // Black player, so their promotion square renders at the TOP; a
    // color-based rule would place the menu off-board (invisible, clipped by
    // the host's overflow), leaving an unclickable overlay.
    const squareInTopHalf =
      squareRect.top - hostRect.top < hostRect.height / 2;
    if (squareInTopHalf) {
      // Extend downward from the square.
      menu.style.top = `${squareRect.bottom - hostRect.top - squareRect.width * 0.2}px`;
    } else {
      // Extend upward so all four choices stay on the board.
      menu.style.top = `${squareRect.top - hostRect.top - squareRect.width * 3.8}px`;
    }

    const pieces = ["q", "r", "b", "n"];
    for (const type of pieces) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "promotion-choice";
      button.innerHTML = `<img src="${pieceSpriteUrl(color, type)}" alt="${pieceName(type)}" draggable="false">`;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        cleanup();
        playGameSound("click");
        resolve(type);
      });
      menu.append(button);
    }

    function cleanup() {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      if (activePromotionCancel === cancel) activePromotionCancel = null;
    }
    function cancel() {
      cleanup();
      resolve(null);
    }
    function onKey(event) {
      if (event.key === "Escape") { cleanup(); resolve(null); }
    }
    overlay.addEventListener("click", () => { cleanup(); resolve(null); });
    document.addEventListener("keydown", onKey);
    activePromotionCancel = cancel;

    overlay.append(menu);
    host.append(overlay);
    // Keyboard users need focus INSIDE the dialog to reach the choices.
    menu.querySelector("button")?.focus();
  });
}

function canInteractWithBoard() {
  if (isInReplay()) return false;
  if (state.clocks?.flagged) return false;
  const playerColor = getActivePlayerColor();
  return !state.thinking && !state.game.isGameOver() && state.game.turn() === playerColor;
}

async function handleSquareClick(square) {
  // A click during the lesson's post-success pause skips straight to the
  // next step (the pause is just breathing room, never a lock).
  if (isLessonDrill() && state.activeDrill.awaitingAdvance) {
    state.activeDrill.awaitingAdvance = false;
    advanceLessonStep();
    return;
  }
  if (!canInteractWithBoard()) return;

  const playerColor = getActivePlayerColor();
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

  await attemptPlayerMove(state.selectedSquare, square);
}

async function attemptPlayerMove(from, to, options = {}) {
  const beforeFen = state.game.fen();
  const gameId = state.currentGameId;

  // Detect a pawn promotion: if any legal move from→to has a promotion flag,
  // ask the player which piece to promote to instead of auto-queening.
  const legal = state.game.moves({ verbose: true }).filter((m) => m.from === from && m.to === to);
  if (legal.length && legal[0].promotion && !options.promotion) {
    clearSelection();
    const choice = await askForPromotionPiece(state.game.turn(), to);
    if (!choice) return false;
    // The picker is async: the game may have flagged on time, been replaced,
    // or otherwise moved on while it was open. Never play into that.
    if (state.currentGameId !== gameId || state.game.fen() !== beforeFen) return false;
    if (!state.activeDrill && !canInteractWithBoard()) return false;
    return attemptPlayerMove(from, to, { ...options, promotion: choice });
  }

  let move = null;
  try {
    move = state.game.move({ from, to, promotion: options.promotion || "q" });
  } catch {
    move = null;
  }

  if (!move) {
    // Beginners get told why nothing happened; a silent snap-back reads as a
    // broken app when you don't yet know the movement rules.
    if (isLessonDrill() && !state.activeDrill.awaitingAdvance && !state.activeDrill.completed
      && getActiveLessonStep()?.kind === "task") {
      setLessonFlash("That piece can't move there — aim for the ★ square.", "miss");
      clearSelection({ render: false });
      renderAll();
      return false;
    }
    clearSelection();
    return false;
  }

  playSoundForMove(move, state.game);

  if (state.activeDrill) {
    clearSelection({ render: false });
    // Deliberately not awaited (the caller's return signals "move accepted"),
    // but a rejection inside the async drill handlers must not become an
    // unhandled rejection with the board stuck half-updated.
    handleDrillMove(move, beforeFen).catch((error) => {
      console.warn("Drill move handling failed", error);
      state.drillMessage = "Something went wrong with this exercise. Use the exit button to leave it.";
      renderAll();
    });
    return true;
  }

  const animation = options.animate === false ? Promise.resolve(false) : animateBoardMove(move);
  clearSelection({ render: false });
  const record = recordMove(move, beforeFen, "player");
  await renderAfterMoveAnimation(animation, async () => {
    // Serious mistake? Pause for a coach conversation before the bot replies.
    const tookBack = await maybeOfferRethink(record);
    if (tookBack) return;
    // The rethink pause (or its teardown) may have outlived this game — if
    // the board was replaced meanwhile, this continuation owns nothing.
    if (record.gameId !== state.currentGameId || state.activeDrill) return;
    record?.gradePromise?.then(() => maybeTriggerProactiveCoach(record));
    await maybeEngineMove();
  });
  return true;
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
  // Drills own the board (scripted replies only) and a second concurrent
  // engine think would double-move — both are hard no-gos. A deactivated
  // tab (app open elsewhere) must not play moves either.
  if (state.activeDrill || state.thinking || tabDeactivated) return;
  // A flagged game is over even though chess.js doesn't know it — the bot
  // must never move (and overwrite the "wins on time" result) after a flag.
  if (state.clocks?.flagged) return;
  if (state.game.isGameOver() || state.game.turn() === state.settings.playerColor) {
    await finalizeIfGameOver();
    return;
  }

  state.thinking = true;
  renderGameMeta();
  let engineAnimation = Promise.resolve(false);
  // Epoch: if the board is replaced while the engine thinks (game loaded for
  // review, drill started, new game), the result must be discarded.
  const gameId = state.currentGameId;

  try {
    await wait(180);

    const fen = state.game.fen();
    let uci = null;
    const botDepth = getCurrentBotDepth();

    try {
      uci = await state.engine?.bestMove(fen, botDepth, getCurrentBotElo());
    } catch {
      uci = null;
      state.engine = null;
      state.engineFallback = true;
    }
    // A post-boot worker crash returns null without throwing — surface it and
    // try to recover instead of silently playing the weak heuristic forever.
    handleEngineCrashIfNeeded();

    if (state.currentGameId !== gameId || state.activeDrill || state.clocks?.flagged || state.game.fen() !== fen) {
      return;
    }
    // Resignation ends a game without changing the board — never move into
    // a game whose stored result is already final.
    const storedResult = state.localGames.find((game) => game.id === gameId)?.result;
    if (storedResult && storedResult !== "in_progress") return;

    const preferredMove = uci ? moveFromUci(uci) : null;
    const fallbackMove = chooseFallbackMove(fen, botDepth);
    const movesToTry = [preferredMove, fallbackMove].filter(Boolean);

    for (const move of movesToTry) {
      const beforeFen = state.game.fen();
      let played = null;
      try {
        played = state.game.move(move);
      } catch {
        played = null;
      }
      if (played) {
        engineAnimation = animateBoardMove(played);
        recordMove(played, beforeFen, "engine");
        playSoundForMove(played, state.game);
        break;
      }
    }
  } catch (error) {
    console.warn("Engine move failed", error);
  } finally {
    state.thinking = false;
    if (state.currentGameId === gameId && !state.activeDrill) {
      await finalizeIfGameOver();
    }
    await engineAnimation;
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
    qualityEligible: role === "player" && !state.activeDrill && isCalibrationComplete(),
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

  let pendingWeaknessSyncs = [];
  let pendingPracticeItem = null;
  if (role === "player") {
    const analysis = analyzePlayerMove(beforeFen, move, afterFen);
    record.classification = analysis.classification;
    record.tags = analysis.tags;
    record.note = analysis.note;
    pendingWeaknessSyncs = updateWeaknessProfile(record);
    pendingPracticeItem = maybeCreatePractice(record, analysis.candidates);
    if (record.qualityEligible && !state.engine?.ready) {
      updateMoveQuality(record);
      // Engine-graded moves update the skill model when the eval resolves;
      // heuristic-graded moves must not silently skip it.
      if (record.qualityKey) updateSkillFromMove(record);
    }
  } else {
    record.note = "Engine reply.";
  }

  onMoveClockUpdate(record);
  // Clocks arm at game start but only begin ticking with the first move.
  if (state.clocks && !state.clocks.flagged && !state.clocks.intervalId && !state.activeDrill) {
    startClockTicker();
  }
  state.moves.push(record);
  state.lastMove = { from: move.from, to: move.to };
  saveCurrentGame();
  const moveSyncPromise = syncMove(record);

  // weakness_events and positions carry FKs to this move's row — sending
  // them before the move insert lands guarantees a rejection.
  if (pendingWeaknessSyncs.length || pendingPracticeItem) {
    moveSyncPromise
      .then(async () => {
        for (const { tag, aggregate } of pendingWeaknessSyncs) {
          await syncWeakness(tag, record, aggregate);
        }
        if (pendingPracticeItem) await syncPosition(record, pendingPracticeItem);
      })
      .catch((error) => console.warn("Weakness/position sync failed", error));
  }

  if (role === "player" && state.engine?.ready) {
    // Non-enumerable so the promise never leaks into localStorage/Supabase.
    Object.defineProperty(record, "gradePromise", {
      value: enrichPlayerMoveWithEngineEval(record, beforeFen, afterFen, moveSyncPromise),
      enumerable: false,
    });
  } else if (record.qualityKey) {
    moveSyncPromise.then(() => syncMoveAnalysis(record)).catch((error) => console.warn("Move quality sync failed", error));
  }
  return record;
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
  // An async grade can resolve after the player loaded another game — never
  // evaluate this record against a different game's live move list.
  if (record.gameId && record.gameId !== state.currentGameId) return false;
  const moves = state.moves.some((move) => move.id === record.id) ? state.moves : [...state.moves, record];
  const sequence = moves
    .filter((move) => move.ply <= record.ply)
    .map((move) => normalizeSan(move.san));

  return OPENING_BOOK.some((opening) => {
    if (sequence.length > opening.moves.length) return false;
    return sequence.every((san, index) => san === normalizeSan(opening.moves[index] || ""));
  });
}

// Applies engine numbers to a move record: assign fields, re-derive the
// classification from verified tags + eval, cross-check heuristic tactic tags
// against the engine, and re-grade quality. Shared by the live shallow pass
// and the post-game deep pass.
function applyEngineAnalysisToRecord(record, analysis) {
  Object.assign(record, analysis);

  const verification = verifyTagsWithEngine(record.tags || [], {
    evalDelta: record.evalDelta,
    mateBefore: record.mateBefore,
    mateAfter: record.mateAfter,
  });
  if (verification.verified) {
    record.tags = verification.tags;
    record.tagsVerified = true;
    if (verification.removed.length) {
      // The note must not keep echoing a refuted claim.
      record.note = record.tags.length ? record.tags[0].note : "";
      for (const tag of verification.removed) {
        retractWeaknessEvidence(tag, record);
      }
    }
  }

  if (record.evalDelta !== null) {
    record.classification = classifyByEval(record.evalDelta, classifyTags(record.tags || []));
  }
  updateMoveQuality(record);
}

// A heuristic tag turned out to be a false positive: walk back the weakness
// profile evidence and any untouched practice drill created from it.
function retractWeaknessEvidence(tag, record) {
  const entry = state.profile[tag.category];
  if (entry) {
    entry.count = Math.max(0, (entry.count || 0) - 1);
    entry.examples = (entry.examples || []).filter(
      (example) => !(example.fen === record.beforeFen && example.san === record.san),
    );
    if (entry.count <= 0) {
      delete state.profile[tag.category];
    }
    saveJson(STORAGE_KEYS.profile, state.profile);
    syncWeaknessAggregate(tag.category, entry.count > 0 ? entry : { ...entry, count: 0 });
  }

  const sourceKey = `${record.beforeFen}|${tag.category}`;
  const remaining = state.practiceQueue.filter(
    (item) => !(item.sourceKey === sourceKey && !item.lastResult),
  );
  if (remaining.length !== state.practiceQueue.length) {
    state.practiceQueue = remaining;
    saveJson(STORAGE_KEYS.practice, state.practiceQueue);
  }
}

// Persist async grading results to the record's OWN game without clobbering
// whatever game or drill currently owns the board. When the record's game is
// still current a normal incremental save keeps everything fresh — but the
// stored result is preserved (a checkmate must never revert to "in_progress"
// because a straggling eval resolved after finalize).
function persistRecordOwnedGame(record) {
  const stored = state.localGames.find((game) => game.id === record.gameId);
  if (record.gameId === state.currentGameId && !state.activeDrill) {
    const keepResult = stored?.result && stored.result !== "in_progress" ? stored.result : "in_progress";
    saveCurrentGame(keepResult);
    return;
  }
  // The board moved on (new game, drill, or review of another game): the
  // record object already lives inside the stored game's moves array, so a
  // re-serialize of the games list is all that's needed.
  if (stored) {
    stored.updatedAt = new Date().toISOString();
    saveJson(STORAGE_KEYS.games, state.localGames);
  }
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

    applyEngineAnalysisToRecord(record, analysis);
    updateSkillFromMove(record);

    persistRecordOwnedGame(record);
    await moveSyncPromise;
    await syncMoveAnalysis(record);
    if (record.gameId !== state.currentGameId) return;
    renderBoard();
    if (state.currentTab === "play" || state.currentTab === "review") {
      renderCurrentPanel();
    }
  } catch (error) {
    record.analysisStatus = "unavailable";
    updateMoveQuality(record);
    persistRecordOwnedGame(record);
    await moveSyncPromise;
    await syncMoveAnalysis(record);
    if (record.gameId === state.currentGameId) {
      renderBoard();
      if (state.currentTab === "play" || state.currentTab === "review") {
        renderCurrentPanel();
      }
    }
    console.warn("Move enrichment failed", error);
  }
}

// ─────────── Deep post-game re-analysis ───────────
//
// Live grading runs at ANALYSIS_DEPTH (10) so the bot replies fast; that is
// noisy in sharp positions. Once a game finishes, every player move is
// re-graded at DEEP_ANALYSIS_DEPTH (18) on the idle engine: badges, the eval
// graph, turning points, tactic-tag verification, and the calibration score
// all firm up. Cancelled instantly when a new game or drill takes the board.

const DEEP_ANALYSIS_EVAL_TIMEOUT_MS = 20_000;

function cancelDeepAnalysis() {
  if (state.deepAnalysis?.running) {
    state.deepAnalysis.cancelled = true;
    state.engine?.stop();
  }
}

// A request that arrives while a cancelled pass is still winding down (the
// in-flight eval can take up to its 20s timeout to settle) is remembered and
// re-run — otherwise the new game would silently stay shallow-graded forever.
let deepAnalysisRerunQueued = false;

async function runDeepGameAnalysis() {
  if (!state.engine?.ready || state.activeDrill) return;
  if (state.deepAnalysis?.running) {
    deepAnalysisRerunQueued = true;
    return;
  }

  const gameId = state.currentGameId;
  const gameResult = state.localGames.find((game) => game.id === gameId)?.result || "in_progress";
  const targets = state.moves.filter((move) =>
    move.role === "player" &&
    !move.retracted &&
    !(move.analysisStatus === "complete" && (move.engineDepth || 0) >= DEEP_ANALYSIS_DEPTH));
  if (!targets.length) return;

  state.deepAnalysis = { gameId, running: true, cancelled: false, done: 0, total: targets.length };
  if (state.currentTab === "review") renderCurrentPanel();

  // Positions repeat across records only rarely, but evals are expensive at
  // this depth — dedupe just in case (e.g. retracted/replayed lines).
  const evalCache = new Map();
  const evaluate = async (fen) => {
    if (evalCache.has(fen)) return evalCache.get(fen);
    const result = await state.engine.evaluatePosition(fen, DEEP_ANALYSIS_DEPTH, {
      timeoutMs: DEEP_ANALYSIS_EVAL_TIMEOUT_MS,
    });
    evalCache.set(fen, result);
    return result;
  };

  for (const record of targets) {
    if (state.deepAnalysis.cancelled || state.currentGameId !== gameId || state.activeDrill) break;
    try {
      const before = await evaluate(record.beforeFen);
      if (state.deepAnalysis.cancelled) break;
      const after = await evaluate(record.afterFen);
      if (state.deepAnalysis.cancelled) break;

      const bestMoveSan = before.bestMove ? uciToSan(record.beforeFen, before.bestMove) : "";
      const analysis = normalizeEngineAnalysis({ before, after, depth: DEEP_ANALYSIS_DEPTH, bestMoveSan });
      // A timed-out search must never wipe good shallow numbers.
      if (analysis.analysisStatus === "complete") {
        applyEngineAnalysisToRecord(record, analysis);
        // Persist each re-grade as it lands. The single save at the end only
        // runs if the game is still current — switching games mid-pass used
        // to lose every applied grade locally while the cloud had them.
        persistRecordOwnedGame(record);
        syncMoveAnalysis(record);
      }
    } catch (error) {
      console.warn(`Deep analysis failed at ply ${record.ply}`, error);
    }
    state.deepAnalysis.done += 1;
    if (state.currentTab === "review") renderCurrentPanel();
  }

  state.deepAnalysis.running = false;
  if (state.currentGameId === gameId && !state.activeDrill) {
    saveCurrentGame(gameResult);
    recalibrateFromDeepAnalysis(gameId);
    renderBoard();
    if (["review", "play", "you"].includes(state.currentTab)) {
      renderCurrentPanel();
    }
  }

  // Another game asked for a deep pass while this one was winding down.
  if (deepAnalysisRerunQueued) {
    deepAnalysisRerunQueued = false;
    runDeepGameAnalysis().catch((error) => console.warn("Queued deep analysis pass failed", error));
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
      label: "Candidate move",
      severity: 2,
      note: `${best.san} was a move worth checking before deciding.`,
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
    return best ? `Your move looked playable. ${best.san} was another move worth checking.` : "No issue tagged.";
  }

  const primary = tags[0];
  const candidateText = best ? ` Also check ${best.san} before deciding.` : "";
  return `${primary.note}${candidateText}`;
}

// Updates the local weakness profile and returns the (tag, aggregate) pairs
// that need syncing. The cloud ops are the CALLER's job, chained after the
// move insert — weakness_events reference moves(id), so syncing them first
// guarantees a foreign-key rejection.
function updateWeaknessProfile(record) {
  const pending = [];
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
    pending.push({ tag, aggregate: existing });
  }
  return pending;
}

function maybeCreatePractice(record, candidates) {
  if (!record.tags.length || !candidates.length) return null;

  const primary = record.tags[0];
  const skill = getSkillForCategory(primary.category);
  const sourceKey = `${record.beforeFen}|${primary.category}`;
  const exists = state.practiceQueue.some((item) => item.sourceKey === sourceKey);
  if (exists) return null;

  const item = {
    id: crypto.randomUUID(),
    sourceKey,
    gameId: state.currentGameId,
    moveId: record.id,
    fen: record.beforeFen,
    title: primary.label,
    category: primary.category,
    skillId: skill?.id || "",
    labMode: "game_transfer",
    playedMove: record.san,
    note: primary.note,
    prompt: `From this position, find a better candidate than ${record.san}.`,
    candidates: candidates.slice(0, 3).map((candidate) => ({
      san: candidate.san,
      uci: `${candidate.from}${candidate.to}${candidate.promotion || ""}`,
    })),
    srs: createSrs(),
    createdAt: new Date().toISOString(),
  };

  state.practiceQueue = [item, ...state.practiceQueue].slice(0, 50);
  // Positions reference moves(id) — the caller syncs this after the move
  // insert lands.
  return item;
}

function startQueuedPractice(id) {
  const item = state.practiceQueue.find((entry) => entry.id === id);
  if (!item) return;
  startPracticePuzzle(practiceItemToPuzzle(item), { render: true });
}

// After a drill hands the board back, resume the restored game's clock (if
// the game is still live). restoreActiveGame() itself never starts a ticker.
function restartClocksForRestoredGame() {
  if (state.clocks && !state.clocks.flagged && !state.game.isGameOver()) {
    startClockTicker();
  }
  renderClocks();
}

// Restores the game this drill paused (matching state.pausedGameId), or seats
// a fresh board. Never resurrects a stale active-game record from an earlier
// session — that could bring back a game the player already finished with.
function restorePausedGameOrFreshBoard() {
  // Whatever the drill left behind ("thinking", scripted-reply pauses) is
  // over — the restored board must always be interactive.
  state.thinking = false;
  const paused = loadJson(STORAGE_KEYS.activeGame, null);
  const restorable = Boolean(state.pausedGameId)
    && paused?.id === state.pausedGameId
    && Array.isArray(paused.moves)
    && paused.moves.length > 0;
  if (!restorable || !restoreActiveGame()) {
    state.game = new Chess();
    state.moves = [];
    state.lastMove = null;
    state.selectedSquare = null;
    state.legalTargets = new Set();
    state.reviewPly = null;
    state.currentGameId = crypto.randomUUID();
    state.startedAt = new Date().toISOString();
  }
  state.pausedGameId = null;
}

function resumeSavedGame() {
  state.activeDrill = null;
  state.drillMessage = "";
  resetPracticeTrainerState();
  state.practiceTrainer.status = "idle";
  restorePausedGameOrFreshBoard();
  restartClocksForRestoredGame();
  switchTab("play");
  renderAll();
}

// ─────────── Opening trainer ───────────

function isOpeningDrill() {
  return Boolean(state.activeDrill?.openingLineId);
}

function getRepertoireLineProgress(lineId) {
  if (!state.repertoire.lines[lineId]) {
    state.repertoire.lines[lineId] = { srs: createSrs(), reps: 0, perfect: 0 };
  }
  return state.repertoire.lines[lineId];
}

function saveRepertoire() {
  saveJson(STORAGE_KEYS.repertoire, state.repertoire);
}

function startOpeningDrill(lineId) {
  const found = getLineById(lineId);
  if (!found) return;
  cancelDeepAnalysis();
  const { opening, line } = found;

  teardownBoardInteractions();
  if (!state.activeDrill) {
    // Like every other drill: remember which game we paused so the exit
    // paths can restore it (a bare save leaves pausedGameId null and the
    // guarded restore would seat a fresh board instead).
    state.pausedGameId = savePausedGameForDrill();
  }
  state.clocks = null;
  renderClocks();
  state.activeDrill = {
    id: `opening:${line.id}`,
    openingLineId: line.id,
    openingId: opening.id,
    title: `${opening.name} — ${line.name}`,
    type: "Opening trainer",
    objective: `Play the ${opening.name} main line as ${colorName(opening.side)}. Wrong moves snap back with the idea explained.`,
    playerColor: opening.side,
    plyIndex: 0,
    mistakes: 0,
    category: "opening_principle",
    source: "opening",
  };
  state.drillMessage = state.activeDrill.objective;
  state.game = new Chess();
  state.moves = [];
  state.selectedSquare = null;
  state.legalTargets = new Set();
  state.lastMove = null;
  switchTab("practice");
  renderAll();

  if (!learnerPlaysAt(opening.side, 0)) {
    playScriptedOpponentMove();
  }
}

async function playScriptedOpponentMove() {
  const drill = state.activeDrill;
  const found = getLineById(drill?.openingLineId);
  const entry = found?.line.moves[drill.plyIndex];
  if (!entry) {
    finishOpeningDrill();
    return;
  }
  state.thinking = true;
  renderGameMeta();
  await wait(400);
  // The player may have exited the drill during the pause — playing the
  // scripted reply now would inject a phantom move into the restored game.
  if (state.activeDrill !== drill) {
    state.thinking = false;
    return;
  }
  let played = null;
  try {
    played = state.game.move(entry.san);
  } catch {
    played = null; // chess.js throws on illegal SAN (diverged position)
  }
  state.thinking = false;
  if (played) {
    state.lastMove = { from: played.from, to: played.to };
    playSoundForMove(played, state.game);
    drill.plyIndex += 1;
    if (entry.why) {
      state.drillMessage = `${entry.san}: ${entry.why}`;
    }
  }
  if (drill.plyIndex >= found.line.moves.length) {
    finishOpeningDrill();
    return;
  }
  renderAll();
}

async function handleOpeningDrillMove(move) {
  const drill = state.activeDrill;
  const found = getLineById(drill?.openingLineId);
  if (!found?.line) {
    // Stale/renamed line id: don't crash mid-drill — end it cleanly.
    state.drillMessage = "This opening line is no longer available.";
    state.activeDrill = null;
    restorePausedGameOrFreshBoard();
    restartClocksForRestoredGame();
    renderAll();
    return;
  }
  const expected = found.line.moves[drill.plyIndex];

  if (!expected || move.san !== expected.san) {
    state.game.undo();
    drill.mistakes += 1;
    state.drillMessage = expected
      ? `Not ${move.san} here — the line plays ${expected.san}. ${expected.why || ""}`.trim()
      : "The line is complete.";
    renderAll();
    return;
  }

  state.lastMove = { from: move.from, to: move.to };
  drill.plyIndex += 1;
  state.drillMessage = expected.why ? `${expected.san} — ${expected.why}` : `${expected.san} is right.`;
  renderAll();

  if (drill.plyIndex >= found.line.moves.length) {
    finishOpeningDrill();
    return;
  }
  await playScriptedOpponentMove();
}

function finishOpeningDrill() {
  const drill = state.activeDrill;
  if (!drill) return;
  const progress = getRepertoireLineProgress(drill.openingLineId);
  const perfect = drill.mistakes === 0;
  const grade = perfect ? GRADE_SOLVED : drill.mistakes <= 2 ? GRADE_HARD : GRADE_MISSED;
  progress.srs = applyGrade(ensureSrs(progress).srs, grade);
  progress.reps += 1;
  if (perfect) progress.perfect += 1;
  saveRepertoire();
  syncRepertoireProgress(drill.openingLineId, drill.openingId, progress);
  if (perfect) celebrate("puzzle");

  state.drillMessage = perfect
    ? `Line complete with no mistakes — ${nextDueLabel(progress)} for the next rep.`
    : `Line complete with ${drill.mistakes} correction${drill.mistakes === 1 ? "" : "s"}. It will come back sooner so it sticks.`;

  recordPracticeHistory({
    title: drill.title,
    category: "opening_principle",
    skillId: "opening-development",
    labMode: "opening",
    expectedMoves: [],
  }, perfect ? "solved" : "missed", state.game.fen());

  const finishedMessage = state.drillMessage;
  state.activeDrill = null;
  restorePausedGameOrFreshBoard();
  restartClocksForRestoredGame();
  renderAll();
  state.drillMessage = finishedMessage;
  if (state.currentTab === "practice") renderPracticePanel();
}

function toggleMyOpening(openingId) {
  const list = state.repertoire.myOpenings;
  state.repertoire.myOpenings = list.includes(openingId)
    ? list.filter((id) => id !== openingId)
    : [...list, openingId].slice(0, 4);
  saveRepertoire();
  renderPracticePanel();
}

// ─────────── Checkmate ladder ───────────

function isMateDrill() {
  return Boolean(state.activeDrill?.matePositionId);
}

function startMateDrill(positionId) {
  const position = getMatePositionById(positionId);
  if (!position) return;
  cancelDeepAnalysis();
  teardownBoardInteractions();
  if (!state.activeDrill) {
    state.pausedGameId = savePausedGameForDrill();
  }
  state.clocks = null;
  renderClocks();
  state.activeDrill = {
    id: `mate:${position.id}`,
    matePositionId: position.id,
    rung: position.rung,
    title: position.label,
    type: "Checkmate ladder",
    objective: position.hint,
    playerColor: position.fen.split(" ")[1] || "w",
    expected: position.solution,
    stepIndex: 0,
    hintShown: false,
    solved: false,
    category: "missed_mate",
    source: "mate",
  };
  state.drillMessage = position.hint;
  state.game = new Chess(position.fen);
  state.moves = [];
  state.selectedSquare = null;
  state.legalTargets = new Set();
  state.lastMove = null;
  switchTab("practice");
  renderAll();
}

async function handleMateDrillMove(move) {
  const drill = state.activeDrill;
  const expected = drill.expected[drill.stepIndex];
  const playedUci = `${move.from}${move.to}${move.promotion || ""}`;
  // When the script specifies a promotion piece it must match exactly;
  // otherwise compare the from/to squares.
  const matchesScript = expected.length === 5
    ? playedUci === expected
    : playedUci.slice(0, 4) === expected;

  // Any move that delivers checkmate solves the drill — several positions
  // have more than one valid mate, and a learner who finds a real checkmate
  // must never be told they're wrong.
  if (!matchesScript && state.game.isCheckmate()) {
    drill.solved = true;
    state.lastMove = { from: move.from, to: move.to };
    state.drillMessage = "Checkmate — a different mate than the featured one, and just as good.";
    playGameSound("drillSolved");
    celebrate("puzzle");
    state.mateLadder = recordMateAttempt(state.mateLadder, drill.matePositionId, drill.rung, true);
    saveJson(STORAGE_KEYS.mateLadder, state.mateLadder);
    markDailyItemComplete("mate");
    renderAll();
    return;
  }

  if (!matchesScript) {
    state.game.undo();
    drill.hintShown = true;
    state.drillMessage = `Not quite. ${drill.objective}`;
    playGameSound("drillMissed");
    // One failed attempt per drill session — not one per wrong keystroke.
    if (!drill.missRecorded) {
      drill.missRecorded = true;
      state.mateLadder = recordMateAttempt(state.mateLadder, drill.matePositionId, drill.rung, false);
      saveJson(STORAGE_KEYS.mateLadder, state.mateLadder);
    }
    renderAll();
    return;
  }

  state.lastMove = { from: move.from, to: move.to };
  drill.stepIndex += 1;
  playGameSound("drillSolved");

  if (drill.stepIndex >= drill.expected.length) {
    drill.solved = true;
    const position = getMatePositionById(drill.matePositionId);
    state.drillMessage = position?.explanation || "Mate delivered.";
    celebrate("puzzle");
    state.mateLadder = recordMateAttempt(state.mateLadder, drill.matePositionId, drill.rung, true);
    saveJson(STORAGE_KEYS.mateLadder, state.mateLadder);
    markDailyItemComplete("mate");
    renderAll();
    return;
  }

  // Multi-move mates: the solution script includes the defender's replies —
  // play the next one automatically so the player only ever moves their side.
  state.drillMessage = "Good — keep going.";
  renderAll();
  await wait(350);
  // The player may have exited during the pause — never play the scripted
  // defender move into whatever board owns the game now.
  if (state.activeDrill !== drill) return;
  const scriptedReply = drill.expected[drill.stepIndex];
  let reply = null;
  try {
    reply = state.game.move(moveFromUci(scriptedReply));
  } catch {
    reply = null; // chess.js throws on illegal moves
  }
  if (reply) {
    state.lastMove = { from: reply.from, to: reply.to };
    drill.stepIndex += 1;
    playGameSound("move");
  }
  state.drillMessage = "Good — keep going. Find the next move.";
  renderAll();
}

// ─────────── Daily plan + streaks ───────────

function todayLocalKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function ensureTodayDaily() {
  const today = todayLocalKey();
  if (state.daily.date !== today) {
    state.daily = { ...state.daily, date: today, todayCompleted: {} };
    saveJson(STORAGE_KEYS.daily, state.daily);
  }
  return state.daily;
}

// Local-date "yesterday" via calendar arithmetic — subtracting 24h of wall
// time breaks on DST-change days (a 25-hour day makes "24 hours ago" still
// today, silently resetting a legitimate streak).
function yesterdayLocalKey(now = new Date()) {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return todayLocalKey(yesterday);
}

function markDailyItemComplete(itemKey) {
  const daily = ensureTodayDaily();
  if (daily.todayCompleted?.[itemKey]) return;
  daily.todayCompleted = { ...daily.todayCompleted, [itemKey]: new Date().toISOString() };

  const today = daily.date;
  if (daily.lastCompletedDate !== today) {
    // Streak: extends if last completion was yesterday, otherwise resets to 1.
    const extended = daily.lastCompletedDate === yesterdayLocalKey();
    daily.streak = extended ? (daily.streak || 0) + 1 : 1;
    daily.lastCompletedDate = today;
    if (extended && daily.streak >= 2) {
      showToast(`🔥 ${daily.streak}-day streak — nice consistency!`, { tone: "success" });
    }
  }
  state.daily = daily;
  saveJson(STORAGE_KEYS.daily, state.daily);
}

// The streak as the player should see it TODAY: a streak whose last
// completion is older than yesterday is already broken — showing the stale
// number until the next completion silently "resets" it was misleading.
function currentStreakForDisplay() {
  const daily = ensureTodayDaily();
  const last = daily.lastCompletedDate;
  if (!last) return 0;
  if (last === daily.date || last === yesterdayLocalKey()) return daily.streak || 0;
  return 0;
}

function getDailyItems() {
  const daily = ensureTodayDaily();
  const done = daily.todayCompleted || {};
  const dueCount = selectDue(state.practiceQueue.map((item) => ensureSrs(item))).length;
  const mateRung = ACTIVE_MATE_POSITIONS.find((p) => isRungUnlocked(p.rung, state.mateLadder) && !state.mateLadder.solved?.includes(p.id));
  return [
    {
      key: "drill",
      label: dueCount > 0 ? `Solve a due drill (${dueCount} waiting)` : "No drills due — try a foundation puzzle",
      done: Boolean(done.drill),
    },
    {
      key: "mate",
      label: mateRung ? `Practice mate: ${mateRung.label}` : "All ladder rungs complete!",
      done: Boolean(done.mate),
    },
    {
      key: "play",
      label: "Play one game",
      done: Boolean(done.play),
    },
    {
      key: "review",
      label: "Review your last game with the coach",
      done: Boolean(done.review),
    },
  ];
}

// ─────────── Game clocks ───────────

const TIME_CONTROLS = {
  unlimited: null,
  "5+0": { baseMs: 5 * 60 * 1000, incrementMs: 0 },
  "10+0": { baseMs: 10 * 60 * 1000, incrementMs: 0 },
  "15+10": { baseMs: 15 * 60 * 1000, incrementMs: 10 * 1000 },
};

function getActiveTimeControl() {
  // Beginners play unclocked no matter what the time-control setting says.
  if (state.settings.beginnerMode === true) return null;
  return TIME_CONTROLS[state.settings.timeControl] || null;
}

function initClocksForNewGame() {
  stopClockTicker();
  const tc = getActiveTimeControl();
  if (!tc || state.activeDrill) {
    state.clocks = null;
    renderClocks();
    return;
  }
  state.clocks = {
    white: tc.baseMs,
    black: tc.baseMs,
    incrementMs: tc.incrementMs,
    side: state.game.turn(),
    lastTick: Date.now(),
    intervalId: null,
    flagged: null,
  };
  // The ticker starts with the FIRST move (see recordMove) — reading the
  // coach's pre-game card must not cost game time.
  renderClocks();
}

function startClockTicker() {
  if (!state.clocks || state.clocks.intervalId) return;
  state.clocks.lastTick = Date.now();
  state.clocks.intervalId = window.setInterval(tickClock, 250);
}

function stopClockTicker() {
  if (state.clocks?.intervalId) {
    window.clearInterval(state.clocks.intervalId);
    state.clocks.intervalId = null;
  }
}

function tickClock() {
  const clocks = state.clocks;
  if (!clocks || clocks.flagged) return;
  // Drills borrow the board and a finished game has no time pressure — an
  // orphaned or leftover interval must never drain (and eventually flag) a
  // clock the player can't see running. Rethink pauses the game too, and so
  // does the sign-in gate (a session expiring mid-game must not flag the
  // player while they type their password). In all of these cases lastTick
  // must keep advancing, otherwise the entire pause is lump-charged to the
  // side to move the moment ticking resumes.
  if (state.rethink.active || state.activeDrill || state.game.isGameOver()
    || document.querySelector("#authGate") || tabDeactivated) {
    clocks.lastTick = Date.now();
    return;
  }
  const now = Date.now();
  const elapsed = now - clocks.lastTick;
  clocks.lastTick = now;
  const side = clocks.side;
  clocks[side === "w" ? "white" : "black"] -= elapsed;
  if (clocks[side === "w" ? "white" : "black"] <= 0) {
    clocks[side === "w" ? "white" : "black"] = 0;
    clocks.flagged = side;
    stopClockTicker();
    onClockFlagged(side);
  }
  renderClocks();
}

// Called by recordMove: gives the mover the increment and switches sides.
function onMoveClockUpdate(record) {
  const clocks = state.clocks;
  if (!clocks || clocks.flagged) return;
  const moverKey = record.color === "w" ? "white" : "black";
  // Record time spent on the move for coach context. Before the ticker has
  // started (the game's very first move) no time is charged — the clock
  // armed at game start but pre-move reading time is free.
  const now = Date.now();
  const elapsed = clocks.intervalId ? now - clocks.lastTick : 0;
  clocks[moverKey] = Math.max(0, clocks[moverKey] - elapsed);
  record.timeSpentMs = elapsed;
  if (clocks.incrementMs) clocks[moverKey] += clocks.incrementMs;
  clocks.side = record.color === "w" ? "b" : "w";
  clocks.lastTick = now;
  renderClocks();
}

async function onClockFlagged(side) {
  // A flag is a real game result: run the same end-of-game pipeline as a
  // checkmate so calibration, skill, sync, and deep analysis all count it.
  // The ticker can race the chess ending (mate delivered as the clock hits
  // zero finalizes via finalizeIfGameOver first) — never complete twice.
  const existing = state.localGames.find((game) => game.id === state.currentGameId);
  if (existing?.result && existing.result !== "in_progress") return;
  const winner = side === "w" ? "b" : "w";
  const label = `${colorName(winner)} wins on time`;
  state.game.header?.("Result", "*");
  await completeGameWithResult(label);
  renderAll();
}

function formatClockMs(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = String(totalSeconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function renderClocks() {
  if (!els.playerClock || !els.opponentClock) return;
  const clocks = state.clocks;
  if (!clocks) {
    els.playerClock.hidden = true;
    els.opponentClock.hidden = true;
    return;
  }
  els.playerClock.hidden = false;
  els.opponentClock.hidden = false;
  const playerColor = state.settings.playerColor;
  const playerMs = playerColor === "w" ? clocks.white : clocks.black;
  const opponentMs = playerColor === "w" ? clocks.black : clocks.white;
  els.playerClock.textContent = formatClockMs(playerMs);
  els.opponentClock.textContent = formatClockMs(opponentMs);
  els.playerClock.classList.toggle("running", clocks.side === playerColor && !clocks.flagged);
  els.opponentClock.classList.toggle("running", clocks.side !== playerColor && !clocks.flagged);
  els.playerClock.classList.toggle("low", playerMs < 30_000);
  els.opponentClock.classList.toggle("low", opponentMs < 30_000);
}

function renderDailyPlanCard() {
  if (!isCalibrationComplete()) return "";
  const items = getDailyItems();
  ensureTodayDaily();
  const streak = currentStreakForDisplay();
  const completedToday = items.filter((item) => item.done).length;
  return `
    <article class="mini-card daily-plan-card">
      <span class="label">Today · streak ${streak} 🔥</span>
      <strong>Daily plan · ${completedToday}/${items.length}</strong>
      <ul class="daily-list">
        ${items.map((item) => `<li class="daily-item ${item.done ? "done" : ""}">${item.done ? "✓" : "○"} ${escapeHtml(item.label)}</li>`).join("")}
      </ul>
    </article>
  `;
}

// ─────────── Today panel ───────────
//
// The landing surface: answers "what should I do right now?" instead of six
// equal tabs. Composes cards that already exist elsewhere.

function todayGreeting() {
  const hour = new Date().getHours();
  const part = hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = getDisplayName();
  // The default display name is literally "You" — "Good morning, You" reads
  // like a bug. Greet by name only when they've picked one.
  return name === DEFAULT_SETTINGS.displayName ? part : `${part}, ${name}`;
}

// Finished games in the window [from, to) — used for the weekly recap.
function finishedGamesBetween(fromMs, toMs) {
  return getCompletedGames().filter((game) => {
    const at = new Date(game.updatedAt || game.startedAt || 0).getTime();
    return at >= fromMs && at < toMs;
  });
}

function renderWeeklyRecapCard() {
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  const thisWeek = finishedGamesBetween(now - week, now + 1);
  if (thisWeek.length < 2) return "";

  let wins = 0;
  let draws = 0;
  let losses = 0;
  const acpls = [];
  for (const game of thisWeek) {
    const score = getPlayerResultScore(game.result, game.playerColor);
    if (score === 1) wins += 1;
    else if (score === 0.5) draws += 1;
    else losses += 1;
    const acpl = computeGameAcpl(game.moves);
    if (acpl !== null) acpls.push(acpl);
  }
  const avgAcpl = acpls.length ? acpls.reduce((sum, value) => sum + value, 0) / acpls.length : null;

  const priorGames = finishedGamesBetween(now - 2 * week, now - week);
  const priorAcpls = priorGames.map((game) => computeGameAcpl(game.moves)).filter((value) => value !== null);
  const priorAvg = priorAcpls.length ? priorAcpls.reduce((sum, value) => sum + value, 0) / priorAcpls.length : null;

  let accuracyLine = "";
  if (avgAcpl !== null && priorAvg !== null) {
    const delta = priorAvg - avgAcpl; // positive = losing less per move = better
    if (Math.abs(delta) >= 5) {
      accuracyLine = delta > 0
        ? `Your accuracy improved — about ${(delta / 100).toFixed(1)} pawns less given away per move than last week.`
        : `A little rustier than last week — about ${(Math.abs(delta) / 100).toFixed(1)} pawns more given away per move.`;
    } else {
      accuracyLine = "Accuracy held steady vs last week.";
    }
  }

  const topWeakness = Object.values(state.profile)
    .sort((a, b) => b.count * b.severity - a.count * a.severity)[0];

  return `
    <article class="mini-card weekly-recap-card">
      <span class="label">This week</span>
      <strong>${thisWeek.length} ${thisWeek.length === 1 ? "game" : "games"} · ${wins}W ${draws}D ${losses}L</strong>
      ${accuracyLine ? `<p>${escapeHtml(accuracyLine)}</p>` : ""}
      ${topWeakness ? `<p>Biggest leak: <strong>${escapeHtml(topWeakness.label)}</strong> — the Practice tab has drills for it.</p>` : ""}
    </article>
  `;
}

function renderTodayPanel() {
  if (!els.todayPanel) return;

  const header = `
    <article class="mini-card today-hero">
      <img src="./assets/squirrel_chess.svg" alt="" aria-hidden="true" class="today-mascot">
      <div>
        <strong>${escapeHtml(todayGreeting())}</strong>
        <p>${isCalibrationComplete() ? "Here's your plan for today." : "Let's find your level first."}</p>
      </div>
    </article>
  `;

  if (!isCalibrationComplete()) {
    const lesson = getResumeLesson();
    els.todayPanel.innerHTML = `
      <h2>Today</h2>
      <div class="stack">
        ${header}
        <article class="mini-card">
          <span class="label">Start here</span>
          <strong>${state.settings.beginnerMode === true && lesson ? "Continue learning the moves" : "Play your first game"}</strong>
          <p>${state.settings.beginnerMode === true && lesson
            ? "Short interactive lessons — the board shows you everything."
            : "One casual game sets your starting level. No hints, no pressure — just play."}</p>
          <div class="button-row">
            ${state.settings.beginnerMode === true && lesson
              ? `<button class="primary-action" id="todayLessonButton" type="button">Continue: ${escapeHtml(lesson.title)}</button>`
              : ""}
            <button ${state.settings.beginnerMode === true && lesson ? "" : `class="primary-action"`} id="todayPlayButton" type="button">Go to the board</button>
          </div>
        </article>
      </div>
    `;
    bindTodayPanel();
    return;
  }

  const lesson = !allLessonsComplete(state.learn.completed) ? getResumeLesson() : null;
  const liveGame = hasLiveGameInProgress();
  // The review card would load an old game onto the board — never offer it
  // while a live game is in progress.
  const lastFinished = liveGame ? null : (getCompletedGames()[0] || null);

  els.todayPanel.innerHTML = `
    <h2>Today</h2>
    <div class="stack">
      ${header}
      ${renderDailyPlanCard()}
      <article class="mini-card">
        <span class="label">Play</span>
        <strong>${liveGame ? "You have a game in progress" : "Ready for a game?"}</strong>
        <p>${liveGame ? "Pick up right where you left off." : "The opponent adapts to your level, and the coach watches with you."}</p>
        <button class="primary-action" id="todayPlayButton" type="button">${liveGame ? "Continue playing" : "Go to the board"}</button>
      </article>
      ${lesson ? `
        <article class="mini-card">
          <span class="label">Learn</span>
          <strong>${escapeHtml(lesson.title)}</strong>
          <p>${escapeHtml(lesson.summary || "Pick up where you left off.")}</p>
          <button id="todayLessonButton" type="button">Continue lesson</button>
        </article>
      ` : ""}
      ${lastFinished ? `
        <article class="mini-card">
          <span class="label">Review</span>
          <strong>${escapeHtml(lastFinished.result)}</strong>
          <p>Walk through your latest game's key moments with the coach.</p>
          <button id="todayReviewButton" type="button" data-game-id="${escapeAttr(lastFinished.id)}">Review it</button>
        </article>
      ` : ""}
      ${renderWeeklyRecapCard()}
    </div>
  `;
  bindTodayPanel();
}

function bindTodayPanel() {
  document.querySelector("#todayPlayButton")?.addEventListener("click", () => switchTab("play"));
  document.querySelector("#todayLessonButton")?.addEventListener("click", () => {
    const lesson = getResumeLesson();
    if (lesson) startLesson(lesson.id);
    else switchTab("learn");
  });
  document.querySelector("#todayReviewButton")?.addEventListener("click", (event) => {
    const gameId = event.currentTarget.dataset.gameId;
    if (gameId && gameId !== state.currentGameId) loadGameForReview(gameId);
    switchTab("review");
  });
}

async function handleDrillMove(move, beforeFen) {
  if (isLessonDrill()) {
    await handleLessonMove(move);
    return;
  }
  if (isOpeningDrill()) {
    await handleOpeningDrillMove(move);
    return;
  }
  if (isMateDrill()) {
    await handleMateDrillMove(move);
    return;
  }
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
      skillId: getSkillForCategory(state.activeDrill.category)?.id || "",
      labMode: state.activeDrill.source || "",
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
    // chess.js THROWS on illegal moves; an uncaught throw here would leave
    // state.thinking stuck true forever (board locked, New game disabled).
    let reply = null;
    try {
      reply = state.game.move(moveFromUci(target.reply));
    } catch {
      reply = null;
    }
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
  // Multi-move puzzles (imported packs) script the full line: player move
  // first, then alternating defender replies the trainer plays itself.
  const line = Array.isArray(puzzle.solutionLine) && puzzle.solutionLine.length > 1
    ? puzzle.solutionLine
    : null;
  const lineIndex = puzzle.lineIndex || 0;
  const solved = line
    ? uciMovesMatch(playedUci, line[lineIndex])
    : (puzzle.expectedMoves || []).includes(playedUci);
  trainer.attempts += 1;

  if (!solved) {
    state.game.undo();
    trainer.status = "missed";
    trainer.hadMiss = true;
    trainer.scoreDelta = -3;
    playGameSound("drillMissed");
    if (!trainer.hintIndex && puzzle.hintSteps?.length) {
      trainer.hintIndex = 1;
    }
    const hint = getCurrentPracticeHint();
    const missText = isFamilyMode()
      ? "Oops — let's look again."
      : (puzzle.missText || "Not yet.");
    trainer.feedback = `${missText}${hint ? ` ${hint}` : ""}`;
    state.drillMessage = trainer.feedback;
    recordPracticeHistory(puzzle, "missed", beforeFen, playedUci);
    // One SRS grade per puzzle session: the FIRST result wins. Grading every
    // wrong try was applying a full lapse (−0.2 ease) per keystroke.
    if (puzzle.queueItemId && !puzzle.srsGraded) {
      puzzle.srsGraded = true;
      rescheduleQueueItem(puzzle.queueItemId, GRADE_MISSED);
    }
    // Render immediately — waiting on the network kept the undone wrong move
    // visible on screen until the sync round-trip returned.
    renderAll();
    await syncPracticeAttempt(getPracticeAttemptPayload(puzzle, beforeFen), "missed", playedUci);
    maybeSendDrillFeedback(puzzle, beforeFen, playedUci);
    return;
  }

  state.lastMove = { from: move.from, to: move.to };

  if (line && lineIndex + 1 < line.length) {
    // Correct so far — play the scripted defender reply and point the hints
    // at the next move in the sequence.
    puzzle.lineIndex = lineIndex + 1;
    trainer.status = "trying";
    trainer.feedback = "Good — keep going.";
    state.drillMessage = trainer.feedback;
    playGameSound("drillSolved");
    renderAll();

    await wait(350);
    // Exiting mid-pause must not inject the scripted reply into whatever
    // board owns the game now.
    if (state.activeDrill !== puzzle) return;
    let reply = null;
    try {
      reply = state.game.move(moveFromUci(line[puzzle.lineIndex]));
    } catch {
      reply = null; // chess.js throws on illegal moves
    }
    if (reply) {
      state.lastMove = { from: reply.from, to: reply.to };
      puzzle.lineIndex += 1;
      playGameSound("move");
    }
    const nextExpected = line[puzzle.lineIndex] || "";
    if (nextExpected) {
      puzzle.targetSquares = [nextExpected.slice(2, 4)];
      puzzle.hintSquares = [nextExpected.slice(0, 2)];
    }
    state.drillMessage = "Good — find the next move.";
    trainer.feedback = state.drillMessage;
    renderAll();
    return;
  }

  trainer.status = "solved";
  trainer.lastMoveUci = playedUci;
  trainer.scoreDelta = !trainer.hadMiss && !trainer.hintIndex ? 10 : 6;
  trainer.feedback = puzzle.successText || "Correct.";
  playGameSound("drillSolved");
  celebrate("puzzle");
  state.drillMessage = trainer.feedback;
  recordPracticeHistory(puzzle, "solved", beforeFen, playedUci);
  // The daily "drill" item counts ANY solved practice puzzle — the label
  // explicitly offers foundation puzzles when nothing from the queue is due.
  markDailyItemComplete("drill");

  if (puzzle.queueItemId && !puzzle.srsGraded) {
    puzzle.srsGraded = true;
    rescheduleQueueItem(puzzle.queueItemId, GRADE_SOLVED);
  }

  renderAll();
  await syncPracticeAttempt(getPracticeAttemptPayload(puzzle, beforeFen), "solved", playedUci);
}

// UCI comparison for scripted lines. A move with a promotion piece must match
// it exactly — the old "loose" comparison stripped the 5th char from both
// sides, grading an underpromotion (e7e8n) as the expected queen (e7e8q).
function uciMovesMatch(played, expected) {
  const a = String(played || "").toLowerCase();
  const b = String(expected || "").toLowerCase();
  if (!a || !b) return false;
  if (a.length === 5 || b.length === 5) return a === b;
  return a.slice(0, 4) === b.slice(0, 4);
}

// One coach nudge per missed practice puzzle: the drill_feedback event
// contrasts the player's attempt with the motif without assigning new work.
// The reply lands in the coach chat and replaces the canned miss text.
function maybeSendDrillFeedback(puzzle, beforeFen, playedUci) {
  if (puzzle.coachFeedbackSent) return;
  if (!isCoachAvailable() || !isCalibrationComplete()) return;
  if (!coachModeAllows("drill")) return;
  puzzle.coachFeedbackSent = true;

  const expectedUci = Array.isArray(puzzle.solutionLine) && puzzle.solutionLine.length
    ? puzzle.solutionLine[puzzle.lineIndex || 0]
    : (puzzle.expectedMoves || [])[0];

  const moment = {
    ply: null,
    san: uciToSan(beforeFen, playedUci) || playedUci,
    quality: "missed",
    cpl: null,
    bestMoveSan: expectedUci ? uciToSan(beforeFen, expectedUci) : "",
    principalVariation: [],
    fenBefore: beforeFen,
    tags: [puzzle.term || puzzle.category].filter(Boolean),
  };

  requestCoachChat("drill_feedback", moment)
    .then((data) => {
      if (!data?.message) return;
      if (state.activeDrill !== puzzle || state.practiceTrainer.status !== "missed") return;
      state.drillMessage = data.message;
      state.practiceTrainer.feedback = data.message;
      if (state.currentTab === "practice") renderPracticePanel();
    })
    .catch((error) => console.warn("Drill feedback failed", error));
}

function rescheduleQueueItem(id, grade) {
  const item = state.practiceQueue.find((entry) => entry.id === id);
  if (!item) return;
  item.srs = applyGrade(ensureSrs(item).srs, grade);
  item.lastResult = grade === GRADE_SOLVED ? "solved" : "missed";
  item.attemptedAt = new Date().toISOString();
  if (grade === GRADE_SOLVED) markDailyItemComplete("drill");
  saveJson(STORAGE_KEYS.practice, state.practiceQueue);
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
    skillId: puzzle.skillId || getSkillForPractice(puzzle)?.id || "",
    labMode: puzzle.labMode || "",
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
    skillId: getSkillForCategory(completedDrill.category)?.id || "",
    labMode: completedDrill.source || "",
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
    // Contiguous prefix only: counting scattered index matches let a game
    // that merely shared 1.e4 e5 claim a 5-move opening's name.
    let matchLength = 0;
    while (matchLength < opening.moves.length && sans[matchLength] === opening.moves[matchLength]) {
      matchLength += 1;
    }
    if (matchLength > 0 && (!best || matchLength > best.matchLength)) {
      best = { ...opening, matchLength };
    }
  }

  // Name the opening only when the game played the book line's defining
  // moves — either the whole listed line, or at least four plies of it.
  if (best && best.matchLength >= Math.min(4, best.moves.length)) {
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
  if (state.clocks?.flagged) return `${colorName(opposite(state.clocks.flagged))} wins on time`;
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
  await completeGameWithResult(getResultLabel());
}

// The full end-of-game pipeline, shared by chess endings (finalizeIfGameOver)
// and clock flags (onClockFlagged) so a timed-out game counts for
// calibration, skill, sync, the daily plan, and deep analysis like any other.
async function completeGameWithResult(result) {
  if (state.activeDrill) return;
  stopClockTicker();
  markDailyItemComplete("play");
  const wasCalibrating = !isCalibrationComplete();
  saveCurrentGame(result);
  recordCompletedGameForCalibration(result);
  updateSkillFromGameResult(result);
  const playerColor = state.settings.playerColor;
  const playerWon = result.includes(`${colorName(playerColor)} wins`);
  // Checkmate already played its win/loss sting on the mating move itself
  // (playSoundForMove) — don't stack a second fanfare on top.
  if (!state.game.isCheckmate()) {
    if (playerWon) playGameSound("gameWin");
    else if (result.startsWith("Draw")) playGameSound("gameDraw");
    else if (result.includes("wins")) playGameSound("gameLoss");
  }
  if (playerWon) celebrate("win");
  await syncGameEnd(result);

  if (wasCalibrating && isCalibrationComplete()) {
    celebrate("milestone");
    pushChatMessage("assistant", `Nice — first game done. I've set your starting level around ${state.calibration.estimatedScore || "your play"}. From here I'll chat with you during games and everything adapts to how you play. Ready when you are.`);
    if (state.currentTab === "play") renderCoachPanel();
  } else if (isCalibrationComplete() && coachModeAllows("postgame")) {
    const moments = selectKeyMoments(state.moves);
    pushChatMessage("assistant", moments.length
      ? `That's ${result}. Want to walk through the ${moments.length === 1 ? "key moment" : `${moments.length} key moments`} together? Hit "Start guided review".`
      : `That's ${result}. A pretty clean game from you — no single moment decided it.`);
    // Review is post-game: take the player there — but never yank someone
    // who is mid-sentence in the chat or already reading another tab.
    const chatInput = document.querySelector("#coachChatInput");
    const typing = chatInput && document.activeElement === chatInput && chatInput.value.trim();
    if (!typing && state.currentTab === "play") {
      switchTab("review");
    }
  }

  // Re-grade the finished game at deep depth on the now-idle engine.
  runDeepGameAnalysis().catch((error) => console.warn("Deep analysis pass failed", error));
}

function saveCurrentGame(result = "in_progress") {
  // Never demote a finished game back to "in_progress". Drill/practice
  // pauses and post-flag renders call this with the default result, and a
  // finished game must keep its recorded outcome — calibration, skill
  // tracking, and history all depend on it.
  //
  // Preserve ONLY a previously *stored* final result. Deriving the live
  // label here would stamp the outcome at recordMove time (the mating move
  // itself), which pre-empts finalizeIfGameOver's "already finalized" check
  // and silently skips the entire end-of-game pipeline.
  if (result === "in_progress") {
    const existing = state.localGames.find((item) => item.id === state.currentGameId);
    if (existing?.result && existing.result !== "in_progress") {
      result = existing.result;
    }
  }
  const opening = detectOpening();
  const gameRecord = {
    id: state.currentGameId,
    startedAt: state.startedAt,
    updatedAt: new Date().toISOString(),
    // Rethinks are per-game; persisting the count stops "reload for two
    // fresh rethinks".
    rethinkRemaining: state.rethink?.remaining ?? RETHINKS_PER_GAME,
    playerColor: state.settings.playerColor,
    engineLevel: getCurrentBotDepth(),
    result,
    openingName: opening.name,
    openingKey: state.moves.slice(0, 8).map((move) => normalizeSan(move.san)).join(" "),
    fen: state.game.fen(),
    pgn: state.game.pgn(),
    moves: state.moves,
    clocks: state.clocks
      ? {
          white: state.clocks.white,
          black: state.clocks.black,
          incrementMs: state.clocks.incrementMs,
          flagged: state.clocks.flagged,
          // Wall-clock timestamp so a reload can charge the time that passed
          // while the tab was closed — clocks used to silently refund all
          // think time since the last move ("reload to reset my clock").
          savedAt: Date.now(),
        }
      : null,
  };

  const others = state.localGames.filter((item) => item.id !== state.currentGameId);
  // Zero-move games never enter history: they'd pollute the game picker and
  // eat into the 30-game cap every time a drill/lesson/new-game touches a
  // fresh board. The active-game slot still updates so boot restores state.
  if (state.moves.length) {
    state.localGames = [gameRecord, ...others].slice(0, 30);
    saveJson(STORAGE_KEYS.games, state.localGames);
  }
  saveJson(STORAGE_KEYS.activeGame, gameRecord);
}

// Save the live game so a drill/lesson can offer to restore it on exit.
// Returns the paused game's id, or null when the board held nothing worth
// coming back to (no moves yet).
function savePausedGameForDrill() {
  if (!state.moves.length) return null;
  saveCurrentGame();
  return state.currentGameId;
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
    // Grades that were still in flight when the tab closed will never
    // resolve — an eternal "Analyzing" badge reads as broken. The deep
    // post-game pass re-grades them once the game ends.
    for (const move of state.moves) {
      if (move.analysisStatus === "pending") move.analysisStatus = "unavailable";
    }
    state.lastMove = state.moves.length
      ? {
          from: state.moves[state.moves.length - 1].from,
          to: state.moves[state.moves.length - 1].to,
        }
      : null;

    if (active.playerColor) {
      state.settings.playerColor = active.playerColor;
    }
    if (Number.isFinite(active.rethinkRemaining)) {
      state.rethink.remaining = Math.max(0, Math.min(RETHINKS_PER_GAME, active.rethinkRemaining));
    }

    // Restore live clocks (they resume from the last saved move). Any ticker
    // still running belongs to the outgoing clocks object — clear it first or
    // its interval id is lost and the orphan can never be stopped.
    stopClockTicker();
    if (active.clocks && Number.isFinite(active.clocks.white) && Number.isFinite(active.clocks.black)) {
      let white = Math.max(0, active.clocks.white);
      let black = Math.max(0, active.clocks.black);
      let flagged = active.clocks.flagged || null;
      const sideToMove = restored.turn();
      // Charge the wall time that passed while the app was closed to the
      // side to move — a reload must not refund think time.
      if (!flagged && Number.isFinite(active.clocks.savedAt)) {
        const elapsed = Math.max(0, Date.now() - active.clocks.savedAt);
        if (sideToMove === "w") white -= elapsed;
        else black -= elapsed;
        if ((sideToMove === "w" ? white : black) <= 0) {
          if (sideToMove === "w") white = 0;
          else black = 0;
          flagged = sideToMove;
        }
      }
      state.clocks = {
        white: Math.max(0, white),
        black: Math.max(0, black),
        incrementMs: active.clocks.incrementMs || 0,
        side: sideToMove,
        lastTick: Date.now(),
        intervalId: null,
        flagged,
      };
    } else {
      state.clocks = null;
    }

    return true;
  } catch (error) {
    console.warn("Could not restore active game", error);
    localStorage.removeItem(STORAGE_KEYS.activeGame);
    return false;
  }
}

// ─────────── Account / authentication ───────────
//
// Identity lives in Supabase Auth (email + password). The browser only ever
// holds the session token; every data operation goes through the Node server,
// which verifies the token and stamps user_id server-side.

let authGateResolve = null;
let resendTimerId = null;
let userInitiatedSignOut = false;
let sessionExpiryGateActive = false;

// Session expiry (revoked token, failed refresh, server 401s): re-show the
// sign-in gate over the app instead of silently failing forever or hard
// reloading mid-game. Local play keeps working underneath.
async function handleSessionExpired() {
  if (sessionExpiryGateActive || userInitiatedSignOut) return;
  if (!state.server.authRequired || !state.auth.client) return;

  // The client may just be holding a stale access token — try one refresh
  // before interrupting the player.
  if (isSignedIn()) {
    try {
      const { data, error } = await state.auth.client.auth.refreshSession();
      if (!error && data?.session) {
        state.auth.session = data.session;
        state.auth.user = data.session.user || null;
        return;
      }
    } catch {
      // fall through to the gate
    }
    state.auth.session = null;
    state.auth.user = null;
  }
  if (sessionExpiryGateActive) return;
  sessionExpiryGateActive = true;

  const previousUserId = String(state.auth.user?.id || localStorageUserHint() || "");
  state.auth.recovery = false;
  state.auth.screen = "sign_in";
  state.auth.notice = "You've been signed out, so cloud sync and the coach are paused. Sign in again to continue — your progress is saved on this device.";
  // The session-expiry gate is dismissible: local play genuinely continues
  // without a session (the copy says so), so never hard-block the board.
  state.auth.allowDismiss = true;
  await ensureSignedIn();
  state.auth.allowDismiss = false;
  sessionExpiryGateActive = false;

  const newUserId = String(state.auth.user?.id || "");
  if (previousUserId && newUserId && previousUserId !== newUserId) {
    // A different account signed in: reload so storage is re-namespaced.
    window.location.reload();
    return;
  }
  state.sync.health = "";
  verifyCloudSync({ render: false });
  checkOpenAIHealth({ render: false });
}

// Which user's storage namespace is active right now (set at boot).
let activeStorageUserId = "";
function localStorageUserHint() {
  return activeStorageUserId;
}

// The static veil in index.html covers the app shell until we know whether to
// show the sign-in gate or the app, so neither ever flashes.
function dismissBootVeil() {
  const veil = document.querySelector("#bootVeil");
  if (!veil) return;
  veil.classList.add("hidden");
  window.setTimeout(() => veil.remove(), 300);
}

async function initAuthClient() {
  const config = state.server.supabaseAuth;
  if (!config?.url || !config?.publishableKey) {
    state.auth.error = "Sign-in isn't available right now. Try again shortly.";
    return false;
  }

  try {
    const createClient = await loadSupabaseCreateClient();
    state.auth.client = createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch (error) {
    console.warn("Auth client could not load", error);
    state.auth.error = "Sign-in couldn't load. Check your connection and try again.";
    return false;
  }

  state.auth.client.auth.onAuthStateChange((event, session) => {
    state.auth.session = session || null;
    state.auth.user = session?.user || null;
    if (event === "PASSWORD_RECOVERY") {
      state.auth.recovery = true;
      state.auth.screen = "recovery";
      renderAuthGate();
    } else if (event === "SIGNED_OUT") {
      if (userInitiatedSignOut) {
        window.location.reload();
        return;
      }
      // A failed token refresh mid-game must NOT hard-reload the page (that
      // loses the chat draft and any streaming reply with zero explanation).
      // Show the sign-in gate over the app instead.
      handleSessionExpired();
    } else if (event === "SIGNED_IN" && authGateResolve && isSignedIn() && !state.auth.recovery) {
      // Covers sessions that arrive outside the form flow, e.g. returning
      // from an email confirmation link with tokens in the URL hash.
      finishAuthGate();
    }
  });

  const { data } = await state.auth.client.auth.getSession();
  state.auth.session = data?.session || null;
  state.auth.user = data?.session?.user || null;
  return true;
}

// Blocks the app behind the sign-in overlay until a session exists.
function ensureSignedIn() {
  if (isSignedIn() && !state.auth.recovery) {
    finishAuthGate();
    return Promise.resolve();
  }
  renderAuthGate();
  return new Promise((resolve) => {
    authGateResolve = resolve;
  });
}

function finishAuthGate() {
  if (resendTimerId) {
    window.clearInterval(resendTimerId);
    resendTimerId = null;
  }
  document.querySelector("#authGate")?.remove();
  document.querySelector(".shell")?.removeAttribute("inert");
  if (authGateResolve) {
    const resolve = authGateResolve;
    authGateResolve = null;
    resolve();
  }
}

const AUTH_SCREENS = {
  sign_in: {
    title: "Welcome back",
    sub: "Sign in to continue your training.",
    submit: "Sign in",
  },
  sign_up: {
    title: "Create your account",
    sub: "Your games, coach memory, and skill profile follow your account.",
    submit: "Create account",
  },
  confirm_sent: {
    title: "Confirm your email",
    sub: "We sent a confirmation link to:",
  },
  reset: {
    title: "Reset your password",
    sub: "Enter your email and we'll send you a reset link.",
    submit: "Send reset link",
  },
  reset_sent: {
    title: "Check your email",
    sub: "We sent a password reset link to:",
  },
  recovery: {
    title: "Set a new password",
    sub: "Choose a strong password for your account.",
    submit: "Save new password",
  },
};

function switchAuthScreen(screen) {
  state.auth.screen = screen;
  state.auth.error = "";
  state.auth.notice = "";
  // Leaving a "sent" screen orphans the cooldown poller (it looks for a
  // button that no longer exists) — stop it.
  if (resendTimerId) {
    window.clearInterval(resendTimerId);
    resendTimerId = null;
  }
  renderAuthGate();
}

function passwordFieldHtml({ label, autocomplete, withMeter }) {
  const { draft, showPassword } = state.auth;
  const meter = withMeter ? passwordMeterHtml(scorePassword(draft.password, { email: draft.email })) : "";
  return `
    <label class="field pw-field">
      <span>${escapeHtml(label)}</span>
      <input id="authPasswordInput" type="${showPassword ? "text" : "password"}" autocomplete="${autocomplete}"
        value="${escapeAttr(draft.password)}" placeholder="At least ${MIN_PASSWORD_LENGTH} characters">
      <button type="button" class="pw-toggle" id="pwToggleButton">${showPassword ? "Hide" : "Show"}</button>
    </label>
    ${meter}
  `;
}

function passwordMeterHtml(result) {
  const hasInput = state.auth.draft.password.length > 0;
  const segments = hasInput ? Math.max(1, result.score) : 0;
  const segsHtml = [0, 1, 2, 3]
    .map((index) => `<span class="pw-meter-seg${index < segments ? " on" : ""}"></span>`)
    .join("");
  return `
    <div class="pw-meter ${result.label}" id="pwMeter">
      <div class="pw-meter-row">
        <div class="pw-meter-track">${segsHtml}</div>
        <span class="pw-meter-label">${hasInput ? escapeHtml(result.label) : ""}</span>
      </div>
      <p class="pw-meter-hint">${escapeHtml(result.hint)}</p>
    </div>
  `;
}

// Re-scores the meter in place on each keystroke — no form rebuild, so typed
// values and focus are never disturbed.
function updatePasswordMeterUI() {
  const meter = document.querySelector("#pwMeter");
  if (!meter) return;
  const result = scorePassword(state.auth.draft.password, { email: state.auth.draft.email });
  const hasInput = state.auth.draft.password.length > 0;
  const segments = hasInput ? Math.max(1, result.score) : 0;

  meter.className = `pw-meter ${result.label}`;
  meter.querySelectorAll(".pw-meter-seg").forEach((seg, index) => {
    seg.classList.toggle("on", index < segments);
  });
  meter.querySelector(".pw-meter-label").textContent = hasInput ? result.label : "";
  meter.querySelector(".pw-meter-hint").textContent = result.hint;
}

function renderAuthGate() {
  let gate = document.querySelector("#authGate");
  if (!gate) {
    gate = document.createElement("div");
    gate.id = "authGate";
    gate.className = "auth-gate";
    gate.setAttribute("role", "dialog");
    gate.setAttribute("aria-modal", "true");
    gate.setAttribute("aria-label", "Sign in");
    document.body.append(gate);
  }

  const { screen, draft, busy, error, notice, pendingEmail } = state.auth;
  const copy = AUTH_SCREENS[screen] || AUTH_SCREENS.sign_in;
  const isSentScreen = screen === "confirm_sent" || screen === "reset_sent";

  let formHtml = "";
  if (screen === "sign_in") {
    formHtml = `
      <label class="field">
        <span>Email</span>
        <input id="authEmailInput" type="email" autocomplete="email" value="${escapeAttr(draft.email)}" placeholder="you@example.com">
      </label>
      ${passwordFieldHtml({ label: "Password", autocomplete: "current-password", withMeter: false })}
    `;
  } else if (screen === "sign_up") {
    formHtml = `
      <label class="field">
        <span>Name</span>
        <input id="authNameInput" type="text" autocomplete="name" maxlength="32" value="${escapeAttr(draft.name)}" placeholder="What should the coach call you?">
      </label>
      <label class="field">
        <span>Email</span>
        <input id="authEmailInput" type="email" autocomplete="email" value="${escapeAttr(draft.email)}" placeholder="you@example.com">
      </label>
      ${passwordFieldHtml({ label: "Password", autocomplete: "new-password", withMeter: true })}
    `;
  } else if (screen === "reset") {
    formHtml = `
      <label class="field">
        <span>Email</span>
        <input id="authEmailInput" type="email" autocomplete="email" value="${escapeAttr(draft.email)}" placeholder="you@example.com">
      </label>
    `;
  } else if (screen === "recovery") {
    formHtml = passwordFieldHtml({ label: "New password", autocomplete: "new-password", withMeter: true });
  }

  const sentHtml = isSentScreen ? `
    <div class="auth-sent">
      <span class="auth-sent-email">${escapeHtml(pendingEmail)}</span>
      <p class="auth-sub">${screen === "confirm_sent"
        ? "Click the link in the email to activate your account, then come back and sign in."
        : "Click the link in the email to choose a new password."}</p>
      <button type="button" class="auth-resend" id="authResendButton">Resend email</button>
    </div>
  ` : "";

  const linksHtml = {
    sign_in: `
      <button type="button" data-auth-screen="sign_up"${busy ? " disabled" : ""}>Create account</button>
      <button type="button" data-auth-screen="reset"${busy ? " disabled" : ""}>Forgot password?</button>
    `,
    sign_up: `<button type="button" data-auth-screen="sign_in"${busy ? " disabled" : ""}>Have an account? Sign in</button>`,
    confirm_sent: `<button type="button" data-auth-screen="sign_in">Back to sign in</button>`,
    reset: `<button type="button" data-auth-screen="sign_in"${busy ? " disabled" : ""}>Back to sign in</button>`,
    reset_sent: `<button type="button" data-auth-screen="sign_in">Back to sign in</button>`,
    // The recovery screen used to be an inescapable modal — a stale reset
    // link left users stuck until a manual reload.
    recovery: `<button type="button" id="authCancelRecoveryButton"${busy ? " disabled" : ""}>Back to sign in</button>`,
  }[screen] || "";

  const dismissHtml = state.auth.allowDismiss
    ? `<div class="auth-links"><button type="button" id="authDismissButton">Keep playing without syncing</button></div>`
    : "";

  gate.innerHTML = `
    <div class="auth-card">
      <div class="auth-brand">
        <img src="./assets/squirrel_chess.svg" alt="" aria-hidden="true">
        <strong>Personal Chess Teacher</strong>
      </div>
      <h2>${escapeHtml(copy.title)}</h2>
      <p class="auth-sub">${escapeHtml(copy.sub)}</p>
      ${isSentScreen ? sentHtml : `
        <form id="authForm" novalidate>
          ${formHtml}
          <p class="auth-error" id="authError">${escapeHtml(error)}</p>
          <p class="auth-notice" id="authNotice">${escapeHtml(notice)}</p>
          <button type="submit" class="auth-submit" id="authSubmitButton"${busy ? " disabled" : ""}>${busy ? "Working..." : escapeHtml(copy.submit)}</button>
        </form>
      `}
      ${isSentScreen ? `
        <p class="auth-error" id="authError">${escapeHtml(error)}</p>
        <p class="auth-notice" id="authNotice">${escapeHtml(notice)}</p>
      ` : ""}
      <div class="auth-links">${linksHtml}</div>
      ${dismissHtml}
    </div>
  `;

  // Assistive tech and Tab must not reach the app underneath the modal.
  document.querySelector(".shell")?.setAttribute("inert", "");

  bindAuthGate(gate);
  dismissBootVeil();
}

function bindAuthGate(gate) {
  gate.querySelector("#authForm")?.addEventListener("submit", handleAuthSubmit);
  gate.querySelector("#authResendButton")?.addEventListener("click", handleResendEmail);
  gate.querySelector("#authDismissButton")?.addEventListener("click", () => {
    // Resolve the gate without a session: local play continues, cloud sync
    // and the coach stay paused until the user signs back in.
    finishAuthGate();
  });
  gate.querySelector("#authCancelRecoveryButton")?.addEventListener("click", () => {
    state.auth.recovery = false;
    switchAuthScreen("sign_in");
  });

  for (const button of gate.querySelectorAll("[data-auth-screen]")) {
    button.addEventListener("click", () => switchAuthScreen(button.dataset.authScreen));
  }

  // Keep the draft in sync so re-renders (busy, errors, screen switches)
  // never lose what the user typed.
  gate.querySelector("#authNameInput")?.addEventListener("input", (event) => {
    state.auth.draft.name = event.target.value;
  });
  gate.querySelector("#authEmailInput")?.addEventListener("input", (event) => {
    state.auth.draft.email = event.target.value;
    updatePasswordMeterUI();
  });
  gate.querySelector("#authPasswordInput")?.addEventListener("input", (event) => {
    state.auth.draft.password = event.target.value;
    updatePasswordMeterUI();
  });

  gate.querySelector("#pwToggleButton")?.addEventListener("click", () => {
    state.auth.showPassword = !state.auth.showPassword;
    const input = gate.querySelector("#authPasswordInput");
    const toggle = gate.querySelector("#pwToggleButton");
    if (input && toggle) {
      input.type = state.auth.showPassword ? "text" : "password";
      toggle.textContent = state.auth.showPassword ? "Hide" : "Show";
      input.focus();
    }
  });

  updateResendButton();

  const inputs = [...gate.querySelectorAll("input")];
  const firstEmpty = inputs.find((input) => !input.value) || inputs[0];
  firstEmpty?.focus();
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Translates GoTrue errors into human copy. Returns { message, screen? } —
// screen requests a redirect (e.g. unconfirmed email -> confirm_sent).
function friendlyAuthError(error) {
  const message = String(error?.message || "");
  const code = String(error?.code || "");

  if (code === "email_not_confirmed" || /email not confirmed/i.test(message)) {
    return { message: "", screen: "confirm_sent", notice: "Confirm your email to finish signing in." };
  }
  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
    return { message: "That email and password don't match. Try again, or reset your password." };
  }
  if (code === "user_already_exists" || /already registered/i.test(message)) {
    return { message: "That email already has an account. Sign in instead." };
  }
  if (code === "signup_disabled" || /signups? not allowed/i.test(message)) {
    return { message: "Sign-ups are currently invite-only. Ask for an invite, then try again." };
  }
  if (code === "weak_password" || /weak.?password/i.test(code + message)) {
    return { message: `That password is too weak. Use at least ${MIN_PASSWORD_LENGTH} characters and avoid common passwords.` };
  }
  if (code === "over_email_send_rate_limit" || /rate limit/i.test(message)) {
    return { message: "Too many emails sent recently. Wait a minute and try again." };
  }
  if (/failed to fetch|network/i.test(message)) {
    return { message: "Could not reach the sign-in service. Check your connection." };
  }
  return { message: message || "Something went wrong. Try again." };
}

function validateAuthForm(screen) {
  const { draft } = state.auth;
  if (screen === "sign_up" && !draft.name.trim()) {
    return "Enter your name so the coach knows what to call you.";
  }
  if ((screen === "sign_in" || screen === "sign_up" || screen === "reset") && !EMAIL_PATTERN.test(draft.email.trim())) {
    return "Enter a valid email address.";
  }
  if (screen === "sign_in" && !draft.password) {
    return "Enter your password.";
  }
  if (screen === "sign_up" || screen === "recovery") {
    const result = scorePassword(draft.password, { email: draft.email });
    if (!result.acceptable) {
      return result.hint || `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
  }
  return "";
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (state.auth.busy || !state.auth.client) return;

  const screen = state.auth.screen;
  const email = state.auth.draft.email.trim();
  const password = state.auth.draft.password;
  const name = normalizeDisplayName(state.auth.draft.name);

  const validationError = validateAuthForm(screen);
  if (validationError) {
    state.auth.error = validationError;
    state.auth.notice = "";
    renderAuthGate();
    return;
  }

  state.auth.busy = true;
  state.auth.error = "";
  state.auth.notice = "";
  renderAuthGate();

  try {
    const auth = state.auth.client.auth;
    if (screen === "sign_in") {
      const { error } = await auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else if (screen === "sign_up") {
      const { data, error } = await auth.signUp({
        email,
        password,
        options: {
          data: { display_name: name },
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) throw error;
      if (!data.session) {
        // Email confirmation required: move to the sent screen. The signup
        // email just went out, so start the resend cooldown now.
        state.auth.pendingEmail = email;
        state.auth.resendKind = "signup";
        state.auth.screen = "confirm_sent";
        startResendCooldown();
      }
    } else if (screen === "reset") {
      const { error } = await auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      if (error) throw error;
      state.auth.pendingEmail = email;
      state.auth.resendKind = "reset";
      state.auth.screen = "reset_sent";
      startResendCooldown();
    } else if (screen === "recovery") {
      const { error } = await auth.updateUser({ password });
      if (error) throw error;
      state.auth.recovery = false;
    }
  } catch (error) {
    const friendly = friendlyAuthError(error);
    state.auth.error = friendly.message;
    if (friendly.notice) state.auth.notice = friendly.notice;
    if (friendly.screen) {
      state.auth.pendingEmail = email;
      state.auth.resendKind = "signup";
      state.auth.screen = friendly.screen;
    }
  }
  state.auth.busy = false;

  const { data } = await state.auth.client.auth.getSession();
  state.auth.session = data?.session || null;
  state.auth.user = data?.session?.user || null;

  if (isSignedIn() && !state.auth.recovery) {
    finishAuthGate();
  } else {
    renderAuthGate();
  }
}

// Resend from the confirm/reset sent screens, throttled to once a minute.
let resendInFlight = false;

async function handleResendEmail() {
  const { pendingEmail, resendKind, client } = state.auth;
  if (!client || !pendingEmail || Date.now() < state.auth.resendAvailableAt) return;
  // The cooldown only starts on SUCCESS — without an in-flight guard a
  // double-click sent two emails.
  if (resendInFlight) return;
  resendInFlight = true;

  state.auth.error = "";
  state.auth.notice = "";
  try {
    if (resendKind === "reset") {
      const { error } = await client.auth.resetPasswordForEmail(pendingEmail, { redirectTo: window.location.origin });
      if (error) throw error;
    } else {
      const { error } = await client.auth.resend({
        type: "signup",
        email: pendingEmail,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
    }
    state.auth.notice = "Email sent.";
    startResendCooldown();
  } catch (error) {
    state.auth.error = friendlyAuthError(error).message;
  } finally {
    resendInFlight = false;
  }
  renderAuthGate();
}

function startResendCooldown() {
  state.auth.resendAvailableAt = Date.now() + 60_000;
  if (resendTimerId) window.clearInterval(resendTimerId);
  resendTimerId = window.setInterval(() => {
    if (Date.now() >= state.auth.resendAvailableAt) {
      window.clearInterval(resendTimerId);
      resendTimerId = null;
    }
    updateResendButton();
  }, 500);
}

function updateResendButton() {
  const button = document.querySelector("#authResendButton");
  if (!button) return;
  const remaining = Math.ceil((state.auth.resendAvailableAt - Date.now()) / 1000);
  if (remaining > 0) {
    button.disabled = true;
    button.textContent = `Resend email (${remaining}s)`;
  } else {
    button.disabled = false;
    button.textContent = "Resend email";
  }
}

async function signOut() {
  userInitiatedSignOut = true;
  try {
    await state.auth.client?.auth.signOut();
  } catch (error) {
    console.warn("Sign out failed", error);
  }
  window.location.reload();
}

async function exportAccountData() {
  if (!canCloudSync() || state.account.busy) return;
  state.account = { busy: true, status: "Preparing export...", error: "" };
  renderSettingsPanel();

  try {
    const data = await api.accountExport();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "chess-teacher-export.json";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    state.account = { busy: false, status: "Export downloaded.", error: "" };
    showToast("Export downloaded.", { tone: "success" });
  } catch (error) {
    state.account = { busy: false, status: "", error: friendlyServiceMessage(error, "Export didn't go through. Try again in a moment.") };
  }
  renderSettingsPanel();
}

// ─────────── Cloud sync (through the server API) ───────────

async function syncGameStart() {
  const opening = detectOpening();
  return await apiSyncOp({
    op: "upsert",
    table: "games",
    rows: [{
      id: state.currentGameId,
      started_at: state.startedAt,
      player_color: state.settings.playerColor,
      engine_level: getCurrentBotDepth(),
      result: "in_progress",
      opening_name: opening.name,
      opening_key: "",
      pgn: "",
      status: "in_progress",
    }],
  });
}

// The game row is created lazily on the first real move (moves reference
// games). Zero-move boards never reach the cloud — locally they're filtered
// out of history for the same reason.
//
// The latch stores the in-flight promise so a fast engine reply waits for
// the SAME games upsert instead of racing past it into an FK violation, and
// it only sticks on success — a signed-out or failed start re-attempts on
// the next move (the upsert is idempotent, so a duplicate is harmless).
let gameStartSync = { gameId: null, promise: null };

async function ensureGameStartSynced() {
  if (gameStartSync.gameId === state.currentGameId && gameStartSync.promise) {
    return gameStartSync.promise;
  }
  const gameId = state.currentGameId;
  const promise = (async () => {
    const ok = await syncGameStart();
    if (!ok && gameStartSync.gameId === gameId) {
      gameStartSync = { gameId: null, promise: null };
    }
    return ok;
  })();
  gameStartSync = { gameId, promise };
  return promise;
}

async function verifyCloudSync(options = {}) {
  if (!state.server.syncConfigured) {
    state.sync.reachable = false;
    state.sync.health = "Cloud sync is not set up on this server. Your history stays on this device.";
    if (options.render !== false) renderAll();
    return false;
  }

  if (!isSignedIn()) {
    state.sync.reachable = false;
    state.sync.health = "Sign in to sync your training history.";
    if (options.render !== false) renderAll();
    return false;
  }

  state.sync.health = "Testing cloud sync...";
  if (options.render !== false) renderAll();

  // A read-only ping exercises the whole path (session token, server
  // validation, database reachability) WITHOUT writing anything. The previous
  // approach — upserting the current game — clobbered finished cloud games
  // with "in progress" on every boot and every "Check services" click.
  let reachable = false;
  try {
    await api.syncOp({ op: "ping" });
    reachable = true;
  } catch (error) {
    console.warn("Cloud sync ping failed", error);
    if (error instanceof ApiError && error.status === 401) {
      state.sync.health = "Your session has expired. Sign in again to keep syncing.";
    }
  }
  state.sync.reachable = reachable;
  if (reachable) {
    state.sync.health = "Cloud sync is online and writable.";
    // The connection works again — replay anything that failed while offline.
    flushSyncOutbox();
  } else if (state.sync.health === "Testing cloud sync...") {
    state.sync.health = "Cloud sync isn't responding right now. Try again in a moment.";
  }
  if (options.render !== false) renderAll();
  return reachable;
}

async function syncGameEnd(result) {
  const opening = detectOpening();
  const savedGame = state.localGames.find((game) => game.id === state.currentGameId);
  // Upsert (not update): if the game-start sync never landed (offline start),
  // a bare update would match zero cloud rows and the finished game would
  // stay missing/"in progress" in the cloud forever.
  await apiSyncOp({
    op: "upsert",
    table: "games",
    rows: [{
      id: state.currentGameId,
      started_at: state.startedAt,
      ended_at: new Date().toISOString(),
      player_color: state.settings.playerColor,
      result,
      engine_level: savedGame?.engineLevel || getCurrentBotDepth(),
      opening_name: opening.name,
      opening_key: state.moves.slice(0, 8).map((move) => normalizeSan(move.san)).join(" "),
      pgn: state.game.pgn(),
      status: "complete",
    }],
  });
}

async function syncMove(record) {
  await ensureGameStartSynced();
  await apiSyncOp({
    op: "insert",
    table: "moves",
    rows: [{
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
    }],
  });
}

async function syncMoveAnalysis(record) {
  await apiSyncOp({
    op: "update",
    table: "moves",
    id: record.id,
    patch: {
      classification: record.classification,
      tags: record.tags,
      note: record.note,
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
      quality_key: record.qualityKey || null,
      quality_label: record.qualityLabel || null,
      quality_reason: record.qualityReason || null,
    },
  });
}

async function syncWeakness(tag, record, aggregate) {
  await apiSyncOp({
    op: "insert",
    table: "weakness_events",
    rows: [{
      // The record's own game id — this sync is deferred behind the move
      // insert, and the player may have started a NEW game by the time it
      // resolves. state.currentGameId here would cross-reference games.
      game_id: record.gameId,
      move_id: record.id,
      category: tag.category,
      label: tag.label,
      severity: tag.severity,
      fen: record.beforeFen,
      note: tag.note,
    }],
  });

  await apiSyncOp({
    op: "upsert",
    table: "weaknesses",
    rows: [{
      category: tag.category,
      label: tag.label,
      count: aggregate.count,
      severity: aggregate.severity,
      last_seen: aggregate.lastSeen,
      examples: aggregate.examples,
      updated_at: new Date().toISOString(),
    }],
  });
}

// Aggregate-only weakness update — used when engine verification retracts a
// false-positive tag (no new weakness event happened).
async function syncWeaknessAggregate(category, aggregate) {
  if (!aggregate) return;
  await apiSyncOp({
    op: "upsert",
    table: "weaknesses",
    rows: [{
      category,
      label: aggregate.label || category,
      count: aggregate.count || 0,
      severity: aggregate.severity || 1,
      last_seen: aggregate.lastSeen || new Date().toISOString(),
      examples: aggregate.examples || [],
      updated_at: new Date().toISOString(),
    }],
  });
}

async function syncPosition(record, item) {
  await apiSyncOp({
    op: "insert",
    table: "positions",
    rows: [{
      // Deferred behind the move insert — must be the record's game, not
      // whatever game owns the board when this finally resolves.
      game_id: record.gameId,
      move_id: record.id,
      fen: item.fen,
      phase: getPhase(item.fen),
      category: item.category,
      tags: record.tags,
      prompt: item.prompt,
      best_candidates: item.candidates,
    }],
  });
}

async function syncPracticeAttempt(item, result, chosenMove = null) {
  await apiSyncOp({
    op: "insert",
    table: "practice_attempts",
    rows: [{
      source_key: item.sourceKey,
      fen: item.fen,
      chosen_move: chosenMove,
      expected_moves: item.candidates,
      result,
    }],
  });
}

async function syncReasoningTrace(trace) {
  if (!trace) return;
  await apiSyncOp({
    op: "insert",
    table: "reasoning_traces",
    rows: [{
      game_id: trace.gameId,
      ply: trace.ply,
      fen: trace.fen,
      san: trace.san,
      question: trace.question,
      answer: trace.answer,
      coach_takeaway: trace.takeaway || null,
    }],
  });
}

async function syncRepertoireProgress(lineId, openingId, progress) {
  if (!progress?.srs) return;
  await apiSyncOp({
    op: "upsert",
    table: "repertoire_progress",
    rows: [{
      line_id: lineId,
      opening_id: openingId,
      ease: progress.srs.ease,
      interval_days: progress.srs.intervalDays,
      due_at: progress.srs.dueAt,
      reps: progress.reps,
      lapses: progress.srs.lapses,
      updated_at: new Date().toISOString(),
    }],
  });
}

async function syncSkillRatings(skill) {
  if (!skill?.dims) return;
  const rows = SKILL_DIMENSIONS
    .filter((dim) => skill.dims[dim]?.rating !== null)
    .map((dim) => ({
      dimension: dim,
      rating: skill.dims[dim].rating,
      perf: skill.dims[dim].perf,
      samples: skill.dims[dim].samples,
      confidence: skill.dims[dim].confidence,
      updated_at: new Date().toISOString(),
    }));
  if (!rows.length) return;
  await apiSyncOp({ op: "upsert", table: "skill_ratings", rows });
}

// Sends one sync operation to the server. Quietly no-ops when cloud sync is
// unavailable (server unconfigured or signed out) so play never blocks.
//
// Failed operations are queued in a persistent outbox and replayed in order
// once the connection recovers — a network blip must never permanently lose
// moves or leave a finished game marked "in progress" in the cloud.
const SYNC_OUTBOX_LIMIT = 400;
const SYNC_OUTBOX_MAX_ATTEMPTS = 12;
const SYNC_OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let syncOutboxFlushing = false;
let syncOutboxTimer = null;

function loadSyncOutbox() {
  const entries = loadJson(STORAGE_KEYS.syncOutbox, []);
  return Array.isArray(entries) ? entries : [];
}

function saveSyncOutbox(entries) {
  return saveJson(STORAGE_KEYS.syncOutbox, entries.slice(0, SYNC_OUTBOX_LIMIT));
}

function enqueueSyncOp(payload) {
  const entries = loadSyncOutbox();
  entries.push({ payload, attempts: 0, queuedAt: Date.now() });
  saveSyncOutbox(entries);
  scheduleSyncOutboxFlush();
}

function scheduleSyncOutboxFlush(delayMs = 15_000) {
  if (syncOutboxTimer) return;
  syncOutboxTimer = window.setTimeout(() => {
    syncOutboxTimer = null;
    flushSyncOutbox();
  }, delayMs);
}

// Errors that a retry can plausibly fix: network failures (status 0), server
// hiccups (5xx), and rate limits (429). 4xx validation failures are permanent.
function isRetriableSyncError(error) {
  if (!(error instanceof ApiError)) return true;
  return error.status === 0 || error.status === 429 || error.status >= 500;
}

// Two entries are the same op if they were queued at the same instant with
// the same payload — used to make sure concurrent enqueues/erases can never
// make the flush loop remove the wrong entry.
function sameOutboxEntry(a, b) {
  return Boolean(a && b) && a.queuedAt === b.queuedAt && JSON.stringify(a.payload) === JSON.stringify(b.payload);
}

async function flushSyncOutbox() {
  if (tabDeactivated || syncOutboxFlushing || !canCloudSync()) return;
  // Never flush a namespace that doesn't belong to the signed-in user: a
  // different account signing in through the session-expiry gate must not
  // replay the previous user's queue under its own token.
  if (state.server.authRequired && (state.auth.user?.id || "") !== activeStorageUserId) return;
  syncOutboxFlushing = true;
  let flushedAny = false;
  try {
    // Re-read storage on every iteration. Ops enqueued while we flush (or an
    // "erase history" clearing the key mid-flight) must never be clobbered
    // by re-persisting a stale in-memory copy of the queue.
    //
    // Every removal/attempt-bump must actually PERSIST: with a full
    // localStorage the next iteration would reload the identical head and
    // spin forever (synchronously for expired entries — a frozen tab; one
    // duplicate network send per iteration otherwise). The iteration cap is
    // a belt-and-braces backstop.
    for (let iterations = 0; iterations <= SYNC_OUTBOX_LIMIT + 4; iterations += 1) {
      const entries = loadSyncOutbox();
      if (!entries.length) break;
      const entry = entries[0];
      const expired = entry.attempts >= SYNC_OUTBOX_MAX_ATTEMPTS
        || (entry.queuedAt && Date.now() - entry.queuedAt > SYNC_OUTBOX_MAX_AGE_MS);
      if (expired) {
        entries.shift();
        if (!saveSyncOutbox(entries)) return;
        continue;
      }
      try {
        await api.syncOp(entry.payload);
        flushedAny = true;
        const latest = loadSyncOutbox();
        if (sameOutboxEntry(latest[0], entry)) {
          latest.shift();
          if (!saveSyncOutbox(latest)) return;
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          // Session expired: the queue is fine, the token isn't. Keep every
          // entry (signing back in fixes it) and prompt for re-auth.
          state.sync.reachable = false;
          state.sync.health = "Your session has expired. Sign in again to keep syncing.";
          renderGameMeta();
          handleSessionExpired();
          return;
        }
        if (isRetriableSyncError(error)) {
          // Stop at the first retriable failure to preserve op order
          // (a move insert must land before its analysis update).
          const latest = loadSyncOutbox();
          if (sameOutboxEntry(latest[0], entry)) {
            latest[0].attempts = (latest[0].attempts || 0) + 1;
            saveSyncOutbox(latest);
          }
          scheduleSyncOutboxFlush(60_000);
          return;
        }
        // Permanent rejection: drop it so it can't wedge the queue.
        console.warn("Dropping unsyncable operation", entry.payload?.op, entry.payload?.table, error.message);
        const latest = loadSyncOutbox();
        if (sameOutboxEntry(latest[0], entry)) {
          latest.shift();
          if (!saveSyncOutbox(latest)) return;
        }
      }
    }
    if (flushedAny) {
      state.sync.reachable = true;
      state.sync.health = "Cloud sync is online and writable.";
      renderGameMeta();
      showToast("Cloud sync caught up.", { tone: "success" });
    }
  } finally {
    syncOutboxFlushing = false;
  }
}

async function apiSyncOp(payload) {
  if (tabDeactivated || !canCloudSync()) return false;

  // While older operations are still queued, new ones must line up behind
  // them — moves reference games, analysis updates reference moves.
  if (loadSyncOutbox().length) {
    enqueueSyncOp(payload);
    flushSyncOutbox();
    return false;
  }

  try {
    await api.syncOp(payload);
    state.sync.reachable = true;
    renderGameMeta();
    return true;
  } catch (error) {
    console.warn("Cloud sync failed", error);
    if (error instanceof ApiError && error.status === 401) {
      state.sync.reachable = false;
      state.sync.health = "Your session has expired. Sign in again to keep syncing.";
      handleSessionExpired();
    } else if (isRetriableSyncError(error)) {
      // The cloud copy is now behind — the UI must stop claiming "Connected"
      // while writes fail. The op replays from the outbox automatically.
      state.sync.reachable = false;
      state.sync.health = "Cloud sync is catching up. Your progress is saved on this device and will sync automatically.";
      enqueueSyncOp(payload);
    } else {
      // Permanent rejection (validation/constraint): the service IS
      // reachable and nothing will retry — don't promise otherwise.
      console.warn("Cloud sync permanently rejected an operation", payload?.op, payload?.table);
    }
    renderGameMeta();
    return false;
  }
}

async function testSupabaseConnection() {
  await saveSettingsFromPanel();

  await verifyCloudSync();
}

function getPreferredColor() {
  return state.settings.preferredColor || state.settings.playerColor || "w";
}

async function saveSettingsFromPanel() {
  const displayNameInput = document.querySelector("#displayNameInput");
  const playerColorInput = document.querySelector("#playerColorInput");
  const coachModeInput = document.querySelector("#coachModeInput");
  if (displayNameInput) state.settings.displayName = normalizeDisplayName(displayNameInput.value);
  if (coachModeInput) state.settings.coachMode = coachModeInput.value;
  const previousTimeControl = state.settings.timeControl;
  state.settings.timeControl = document.querySelector("#timeControlInput")?.value || "unlimited";
  state.settings.soundEnabled = document.querySelector("#soundEnabledInput")?.checked !== false;
  state.settings.showBestArrow = document.querySelector("#showBestArrowInput")?.checked !== false;
  state.settings.showEvalBar = document.querySelector("#showEvalBarInput")?.checked !== false;

  if (playerColorInput) {
    state.settings.preferredColor = playerColorInput.value;
    // Mid-game color swaps used to dead-end the game (board flips, bot never
    // moves). Apply instantly only on a fresh board; otherwise the choice
    // takes effect on the next game.
    if (!state.moves.length && !state.activeDrill && !state.game.isGameOver()) {
      state.settings.playerColor = playerColorInput.value;
    } else if (playerColorInput.value !== state.settings.playerColor) {
      showToast("Color saved — applies to your next game.");
    }
  }

  // Time control: apply immediately on a fresh board (it used to silently do
  // nothing until "New game"); a running game keeps its clock.
  if (state.settings.timeControl !== previousTimeControl) {
    if (!state.moves.length && !state.activeDrill && !state.game.isGameOver()) {
      initClocksForNewGame();
    } else {
      showToast("Time control saved — applies to your next game.");
    }
  }

  saveJson(STORAGE_KEYS.settings, state.settings);
  renderAll();

  // Fresh board flipped to Black: the bot now owns the first move.
  if (!state.moves.length && !state.activeDrill && !state.game.isGameOver()
    && state.game.turn() !== state.settings.playerColor) {
    maybeEngineMove();
  }
  return true;
}

function clearHistoryStorage() {
  localStorage.removeItem(STORAGE_KEYS.profile);
  localStorage.removeItem(STORAGE_KEYS.practice);
  localStorage.removeItem(STORAGE_KEYS.practiceHistory);
  localStorage.removeItem(STORAGE_KEYS.games);
  localStorage.removeItem(STORAGE_KEYS.activeGame);
  localStorage.removeItem(STORAGE_KEYS.calibration);
  localStorage.removeItem(STORAGE_KEYS.coachChat);
  localStorage.removeItem(STORAGE_KEYS.coachMemory);
  localStorage.removeItem(STORAGE_KEYS.learn);
  // Skill/repertoire/mate-ladder/daily are history too. Leaving them behind
  // used to silently re-upload "deleted" cloud rows on the next move.
  localStorage.removeItem(STORAGE_KEYS.skill);
  localStorage.removeItem(STORAGE_KEYS.repertoire);
  localStorage.removeItem(STORAGE_KEYS.mateLadder);
  localStorage.removeItem(STORAGE_KEYS.daily);
  localStorage.removeItem(STORAGE_KEYS.syncOutbox);
}

function resetHistoryState() {
  teardownBoardInteractions();
  state.clocks = null;
  state.profile = {};
  state.practiceQueue = [];
  state.practiceHistory = [];
  state.localGames = [];
  state.calibration = structuredClone(DEFAULT_CALIBRATION);
  state.skill = null;
  state.repertoire = { myOpenings: [], lines: {} };
  state.mateLadder = { solved: [], attempts: {}, rungSolved: {} };
  state.daily = { streak: 0, lastCompletedDate: null, todayCompleted: {} };
  state.learn = structuredClone(DEFAULT_LEARN);
  state.lessonFlash = null;
  state.pausedGameId = null;
  state.coachChat = { gameId: null, messages: [] };
  state.coachMemory = { notes: [], traces: [] };
  state.pendingCoachQuestion = null;
  state.game = new Chess();
  state.currentGameId = crypto.randomUUID();
  state.startedAt = new Date().toISOString();
  state.moves = [];
  state.selectedSquare = null;
  state.selectedSkillId = null;
  state.legalTargets = new Set();
  state.lastMove = null;
  state.reviewPly = null;
  state.thinking = false;
  state.activeDrill = null;
  state.drillMessage = "";
  state.coachError = "";
  state.coachRetry = null;
  resetProactiveState();
  resetRethinkState();
  resetPracticeTrainerState();
  state.practiceTrainer.status = "idle";
}

function resetLocalHistoryForErase() {
  clearHistoryStorage();
  resetHistoryState();
}

function confirmHistoryErase(message) {
  return showConfirmDialog(message, { title: "Erase history", confirmLabel: "Erase", danger: true });
}

async function eraseLocalHistory() {
  if (!await confirmHistoryErase("Erase local history from this browser? This clears games, calibration, coach memory, profile, lesson progress, and practice history. Settings stay saved.")) {
    return;
  }

  state.historyErase = {
    busy: true,
    status: "Erasing local history...",
    error: "",
  };
  renderAll();

  resetLocalHistoryForErase();
  state.historyErase = {
    busy: false,
    status: "Local history erased. Calibration is reset.",
    error: "",
  };
  renderAll();
}

async function eraseRemoteHistory() {
  if (!canCloudSync() && !state.featureFlags.remoteHistoryEraseEnabled) return;
  if (!await confirmHistoryErase("Erase local and cloud history? This permanently deletes your cloud games, moves, calibration, profile, and practice history for this account. Settings stay saved.")) {
    return;
  }

  state.historyErase = {
    busy: true,
    status: "Erasing cloud history...",
    error: "",
  };
  renderAll();

  try {
    if (!canCloudSync()) {
      throw new Error(state.sync.health || "Sign in before erasing cloud history.");
    }

    await deleteSupabaseHistory();
    resetLocalHistoryForErase();
    state.sync.reachable = true;
    state.historyErase = {
      busy: false,
      status: "Local and cloud history erased. Calibration is reset.",
      error: "",
    };
  } catch (error) {
    state.historyErase = {
      busy: false,
      status: "",
      error: friendlyServiceMessage(error, "History erase didn't go through. Try again in a moment."),
    };
    state.sync.health = `Cloud history erase failed: ${state.historyErase.error}`;
  }

  renderAll();
}

// Deletes every cloud row belonging to the signed-in account (games, moves,
// positions, weaknesses, weakness_events, practice_attempts, and the rest)
// through the server, which scopes the wipe to the verified user.
async function deleteSupabaseHistory() {
  await api.accountDelete();
}

// Resigning ends the game through the normal end-of-game pipeline, so it
// counts for calibration, skill, history, and review like any other loss.
async function resignGame() {
  if (state.activeDrill || !state.moves.length || state.game.isGameOver() || state.clocks?.flagged) return;
  const confirmed = await showConfirmDialog(
    "It counts as a loss and moves to your history for review.",
    { title: "Resign this game?", confirmLabel: "Resign", danger: true },
  );
  if (!confirmed) return;
  // The dialog is async — the game may have ended (flag, engine mate) while
  // it was open.
  if (state.activeDrill || state.game.isGameOver() || state.clocks?.flagged) return;
  stopClockTicker();
  const winner = opposite(state.settings.playerColor);
  await completeGameWithResult(`${colorName(winner)} wins by resignation`);
  renderAll();
}

async function newGame() {
  // A live game is wiped by this — ask first. (It stays in history as
  // unfinished thanks to the per-move incremental saves.)
  const inProgress = state.moves.length > 0 && !state.game.isGameOver() && !state.activeDrill && !state.clocks?.flagged;
  if (inProgress) {
    const confirmed = await showConfirmDialog(
      "Your current game is saved to history as unfinished.",
      { title: "Start a new game?", confirmLabel: "New game" },
    );
    if (!confirmed) return;
  }
  cancelDeepAnalysis();
  teardownBoardInteractions();
  // A review/resume of an old game may have flipped the working color —
  // new games always start from the user's saved preference.
  state.settings.playerColor = getPreferredColor();
  state.game = new Chess();
  state.selectedSquare = null;
  state.legalTargets = new Set();
  state.lastMove = null;
  state.moves = [];
  state.reviewPly = null;
  state.guidedReview = null;
  state.currentGameId = crypto.randomUUID();
  state.startedAt = new Date().toISOString();
  state.thinking = false;
  // Starting a game from inside a lesson is an explicit exit: don't re-open
  // the lesson on the next reload.
  if (isLessonDrill()) {
    state.learn.active = false;
    saveLearnState();
  }
  state.activeDrill = null;
  state.drillMessage = "";
  state.lessonFlash = null;
  state.pausedGameId = null;
  // The chat transcript is intentionally NOT reset — getCurrentChatMessages()
  // inserts a "New game" divider when it sees the new game id.
  state.pendingCoachQuestion = null;
  state.coachError = "";
  state.coachRetry = null;
  resetProactiveState();
  resetRethinkState();
  resetPracticeTrainerState();
  state.practiceTrainer.status = "idle";
  saveCurrentGame();
  initClocksForNewGame();
  renderAll();

  if (state.settings.playerColor === "b") {
    maybeEngineMove();
  }
}

function switchTab(tab, options = {}) {
  state.currentTab = tab;
  // Mobile CSS hides the board stage on board-less tabs via this attribute,
  // and Android's back button walks the tab history before leaving the app.
  document.body.dataset.activeTab = tab;
  if (!options.fromHistory && window.history.state?.tab !== tab) {
    // Only touch devices get a history entry per tab (the Android back-button
    // pattern). On desktop, Back should leave the site, not replay every tab
    // ever visited.
    if (window.matchMedia?.("(pointer: coarse)")?.matches) {
      window.history.pushState({ tab }, "", "");
    } else {
      window.history.replaceState({ tab }, "", "");
    }
  }
  const boardChanged = tab === "practice" && ensurePracticeTrainer();
  if (tab === "play") clearCoachUnread();
  els.tabs.forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("active", active);
    // Screen readers hear which section is open without relying on a CSS class.
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  els.panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tab));
  updateCtxHead(tab);
  if (tab === "practice" || tab === "learn" || boardChanged) {
    renderBoard();
    renderGameMeta();
  }
  renderCurrentPanel();
  // Arrows depend on the current tab (played+best in Review, only-on-mistake
  // in play) so tab switches must repaint them.
  paintBoardArrows();
  // On mobile, tab switches show/hide the board stage — re-scatter the arcade
  // emojis so none placed while the board was hidden now sit on top of it.
  refreshArcadeEmojiPlacement();
  // Back/forward navigation restores a previously-visited tab — don't yank
  // its reading position back to the top.
  if (!options.fromHistory) {
    document.querySelector(".ctx-body")?.scrollTo({ top: 0 });
  }
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

let engineRecoveryAttempts = 0;
const ENGINE_RECOVERY_MAX_ATTEMPTS = 2;

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
      state.engineFallback = false;
      renderGameMeta();
      // A finished game restored from a previous session may still be graded
      // at shallow depth — deepen it now that the engine is idle.
      if (state.game.isGameOver() && !state.activeDrill) {
        runDeepGameAnalysis().catch((error) => console.warn("Deep analysis pass failed", error));
      }
      return;
    } catch (error) {
      console.warn(`Stockfish ${source.label} engine failed`, error);
      engine.destroy();
    }
  }

  // Both engine sources failed: the app plays on with a much weaker heuristic
  // bot. Make that visible (seat label + Services card) instead of letting the
  // opponent silently get worse.
  state.engine = null;
  state.engineFallback = true;
  renderGameMeta();
}

// A worker that crashes AFTER boot used to leave the app silently degraded
// forever: bestMove() returned null without throwing, so the weak heuristic
// bot played on with no signal and no recovery. Detect the dead engine, show
// the fallback state, and try to boot a fresh worker a couple of times.
function handleEngineCrashIfNeeded() {
  const engine = state.engine;
  if (!engine || engine.ready || !engine.crashed) return;
  engine.destroy();
  state.engine = null;
  state.engineFallback = true;
  renderGameMeta();
  if (engineRecoveryAttempts < ENGINE_RECOVERY_MAX_ATTEMPTS) {
    engineRecoveryAttempts += 1;
    console.warn(`Chess engine crashed — attempting recovery (${engineRecoveryAttempts}/${ENGINE_RECOVERY_MAX_ATTEMPTS})`);
    initEngine().catch((error) => console.warn("Engine recovery failed", error));
  }
}

function bindEvents() {
  els.newGameButton.addEventListener("click", newGame);
  els.resignButton?.addEventListener("click", resignGame);
  els.opponentSeatName?.addEventListener("click", startOpponentRename);
  els.tabs.forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  // Back button (Android especially) steps back through visited tabs.
  window.addEventListener("popstate", (event) => {
    const tab = event.state?.tab;
    if (tab && tab !== state.currentTab) {
      switchTab(tab, { fromHistory: true });
    }
  });

  // Leaving the page mid-stream: abort the coach request so the server can
  // cancel its upstream OpenAI call instead of generating into the void.
  window.addEventListener("pagehide", () => activeCoachAbort?.abort());

  // Arrow-key scrubbing through a finished game on the main board.
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement
      && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
      return;
    }
    if (document.querySelector("#authGate") || document.querySelector(".app-dialog-overlay")) return;
    if (!isCurrentGameFinished() || state.activeDrill || state.variationReplay || !state.moves.length) return;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      stepTimeline(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      stepTimeline(1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setTimelinePly(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setTimelinePly(state.moves.length);
    } else if (event.key === "Escape" && isTimelineActive()) {
      event.preventDefault();
      setTimelinePly(state.moves.length);
    }
  });

  // One clear offline signal instead of a different cryptic failure per
  // feature. Reconnecting flushes the sync outbox and re-checks services.
  const updateOfflineBanner = () => {
    const banner = document.querySelector("#offlineBanner");
    if (banner) banner.hidden = navigator.onLine !== false;
  };
  window.addEventListener("offline", () => {
    updateOfflineBanner();
    state.sync.reachable = false;
    state.sync.health = "You're offline. Progress is saved on this device and syncs when you're back.";
    renderGameMeta();
  });
  window.addEventListener("online", () => {
    updateOfflineBanner();
    flushSyncOutbox();
    verifyRequiredServices();
  });
  updateOfflineBanner();

  boardDrag = attachDragHandlers(els.board, {
    canDragFrom: (square) => {
      if (!canInteractWithBoard()) return false;
      const piece = state.game.get(square);
      return Boolean(piece && piece.color === getActivePlayerColor());
    },
    onDragStart: (square) => {
      // renderBoard() is suppressed mid-drag, so paint highlights on the live DOM.
      state.selectedSquare = square;
      state.legalTargets = new Set(state.game.moves({ square, verbose: true }).map((move) => move.to));
      const selectedPiece = state.game.get(square);
      for (const button of els.board.querySelectorAll("[data-square]")) {
        const sq = button.dataset.square;
        button.classList.toggle("selected", sq === square);
        const isTarget = state.legalTargets.has(sq);
        const occupant = isTarget ? state.game.get(sq) : null;
        button.classList.toggle("target", isTarget);
        button.classList.toggle("target-capture", Boolean(isTarget && occupant && selectedPiece && occupant.color !== selectedPiece.color));
      }
    },
    onDrop: async (from, to) => {
      const moved = await attemptPlayerMove(from, to, { animate: false });
      if (!moved || state.pendingBoardRender) renderBoard();
    },
    onDragCancel: () => {
      clearSelection();
      if (state.pendingBoardRender) renderBoard();
    },
  });
}

// Device-level (never namespaced) keys: the last-known server config and the
// last signed-in user. Both exist so an OFFLINE boot still knows the server
// requires auth and which user's storage namespace to open — without them a
// signed-in user reloading offline was silently dropped into the empty
// legacy namespace and their history "vanished".
const SERVER_CONFIG_CACHE_KEY = "chess_teacher_server_config_v1";
const LAST_USER_CACHE_KEY = "chess_teacher_last_user_v1";

// Loads /api/health before anything renders so the client knows whether the
// server requires sign-in and where Supabase Auth lives.
async function fetchServerConfig() {
  try {
    const data = await api.health();
    applyServerConfig(data);
    state.openAI.configured = Boolean(data.openaiConfigured);
    state.openAI.model = data.model || "";
    saveJson(SERVER_CONFIG_CACHE_KEY, {
      authRequired: state.server.authRequired,
      syncConfigured: state.server.syncConfigured,
      supabaseAuth: state.server.supabaseAuth,
      pieceSets: state.server.pieceSets,
      openaiConfigured: state.openAI.configured,
    });
  } catch (error) {
    console.warn("Could not load server config; falling back to the cached one", error);
    const cached = loadJson(SERVER_CONFIG_CACHE_KEY, null);
    if (cached) {
      state.server.loaded = true;
      state.server.fromCache = true;
      state.server.authRequired = Boolean(cached.authRequired);
      state.server.syncConfigured = Boolean(cached.syncConfigured);
      state.server.supabaseAuth = cached.supabaseAuth || null;
      if (Array.isArray(cached.pieceSets) && cached.pieceSets.length) {
        state.server.pieceSets = cached.pieceSets;
      }
      state.openAI.configured = Boolean(cached.openaiConfigured);
    } else {
      state.server.loaded = false;
    }
  }
}

// ─────────── First-run tour ───────────
//
// Three anchored tooltips on the very first visit: the board, the coach, and
// the Today plan. Skipped for anyone who already has games.

const TOUR_STEPS = [
  {
    target: ".board-host",
    title: "Your board",
    body: "Play right here — tap or drag pieces. The opponent adapts to your level as you play.",
  },
  {
    target: ".ctx-body",
    title: "Your coach",
    body: "The coach watches every game, speaks up at important moments, and answers anything you ask.",
  },
  {
    target: '[data-tab="today"]',
    title: "Today",
    body: "Your daily plan lives here — a lesson, a puzzle, a game. A few minutes a day adds up fast.",
  },
];

function maybeStartTour() {
  if (loadJson(STORAGE_KEYS.tour, false)) return;
  if (state.localGames.length || tabDeactivated) return;
  if (document.querySelector("#authGate")) return;
  showTourStep(0);
}

function finishTour() {
  saveJson(STORAGE_KEYS.tour, true);
  document.querySelector("#tourOverlay")?.remove();
}

function showTourStep(index) {
  const step = TOUR_STEPS[index];
  const target = step ? document.querySelector(step.target) : null;
  if (!step || !target) {
    finishTour();
    return;
  }

  let overlay = document.querySelector("#tourOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "tourOverlay";
    overlay.className = "tour-overlay";
    document.body.append(overlay);
    // Non-modal: Escape or any interaction outside the popover ends the tour
    // (never trap a user who just wants to click around).
    document.addEventListener("keydown", function onKey(event) {
      if (!document.querySelector("#tourOverlay")) {
        document.removeEventListener("keydown", onKey);
        return;
      }
      if (event.key === "Escape") finishTour();
    });
    document.addEventListener("pointerdown", function onPointer(event) {
      const current = document.querySelector("#tourOverlay");
      if (!current) {
        document.removeEventListener("pointerdown", onPointer);
        return;
      }
      if (!current.contains(event.target)) finishTour();
    }, true);
  }

  const isLast = index === TOUR_STEPS.length - 1;
  overlay.innerHTML = `
    <div class="tour-pop" role="dialog" aria-label="${escapeAttr(step.title)}">
      <strong>${escapeHtml(step.title)}</strong>
      <p>${escapeHtml(step.body)}</p>
      <div class="button-row">
        <button type="button" class="tour-skip">Skip</button>
        <button type="button" class="tour-next primary-action">${isLast ? "Let's go" : "Next"}</button>
      </div>
      <span class="tour-count">${index + 1} / ${TOUR_STEPS.length}</span>
    </div>
  `;

  // Position near the target, clamped to the viewport.
  const pop = overlay.querySelector(".tour-pop");
  const rect = target.getBoundingClientRect();
  const popWidth = 280;
  const left = Math.max(12, Math.min(window.innerWidth - popWidth - 12, rect.left + rect.width / 2 - popWidth / 2));
  const below = rect.bottom + 12;
  const top = below + 170 < window.innerHeight ? below : Math.max(12, rect.top - 182);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;

  overlay.querySelector(".tour-skip").addEventListener("click", finishTour);
  overlay.querySelector(".tour-next").addEventListener("click", () => {
    if (isLast) finishTour();
    else showTourStep(index + 1);
  });
  overlay.querySelector(".tour-next").focus();
}

async function boot() {
  await fetchServerConfig();

  if (state.server.authRequired) {
    const authReady = await initAuthClient();
    if (authReady) {
      // Booting from a cached config (server unreachable): the gate is
      // dismissible when we know whose device this is — offline users must
      // be able to reach their local data without a working auth service.
      const cachedLastUser = loadJson(LAST_USER_CACHE_KEY, "");
      if (state.server.fromCache && cachedLastUser) {
        state.auth.allowDismiss = true;
      }
      await ensureSignedIn();
      state.auth.allowDismiss = false;
      activeStorageUserId = state.auth.user?.id
        || (state.server.fromCache ? cachedLastUser : "")
        || "";
      applyStorageNamespace(activeStorageUserId);
      if (state.auth.user?.id) saveJson(LAST_USER_CACHE_KEY, activeStorageUserId);
    } else {
      // Auth module unreachable (offline: supabase-js loads from a CDN).
      // Open the LAST signed-in user's namespace so their history is still
      // there — the legacy namespace would show a blank fresh profile.
      const lastUser = loadJson(LAST_USER_CACHE_KEY, "");
      if (lastUser) {
        activeStorageUserId = lastUser;
        applyStorageNamespace(lastUser);
        state.sync.health = "You're offline — playing from this device. Sync resumes when you're back.";
      } else {
        state.sync.health = state.auth.error || "Sign-in is unavailable right now.";
      }
    }
  }

  hydrateStateFromStorage();
  const railFoot = document.querySelector(".rail-foot");
  if (railFoot) {
    railFoot.innerHTML = `v ${APP_VERSION}<br>plays locally &middot; syncs with your account`;
  }
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
  // Users who never saved settings have no explicit color preference yet —
  // capture the current one BEFORE restoreActiveGame can mutate playerColor
  // (resuming a Black game must not silently become the new-game default).
  if (!state.settings.preferredColor) {
    state.settings.preferredColor = state.settings.playerColor || "w";
  }
  // coachMode was a dead setting before v0.7 — stored values were never a
  // deliberate choice. Reset once to the live default ("hints").
  if (!state.settings.coachModeV2) {
    state.settings.coachMode = "hints";
    state.settings.coachModeV2 = true;
    saveJson(STORAGE_KEYS.settings, state.settings);
  }
  applyAppTheme(state.settings.appTheme);
  // A fresh profile on the default look gets the matching board palette too.
  // Never touches a hand-picked board (boardThemeAuto flips off on pick).
  if (state.settings.boardThemeAuto !== false && state.settings.boardTheme === "slate") {
    const suggested = APP_THEME_BOARD_SUGGESTIONS[normalizeAppThemeKey(state.settings.appTheme)];
    if (suggested && suggested !== state.settings.boardTheme) {
      state.settings.boardTheme = suggested;
    }
  }
  applyBoardTheme(state.settings.boardTheme);
  seedDisplayNameFromAccount();
  normalizeCalibrationState();
  migrateLegacyPlacement();
  if (isCalibrationComplete()) ensureSkillState();
  state.startedAt = new Date().toISOString();
  restoreActiveGame();
  maybeResumeLessonOnBoot();
  bindEvents();
  initTabLock();
  // Calibrated users land on Today (what should I do now?); new users land
  // on Play, where the first-run and calibration guidance lives; a live
  // game in progress goes straight back to the board. A lesson auto-resume
  // may already have chosen the Learn tab — leave it alone.
  if (state.currentTab === "play" && !state.activeDrill && isCalibrationComplete() && !hasLiveGameInProgress()) {
    state.currentTab = "today";
  }
  switchTab(state.currentTab, { fromHistory: true });
  window.history.replaceState({ tab: state.currentTab }, "", "");
  renderAll();
  dismissBootVeil();
  maybeStartTour();
  verifyRequiredServices();
  const engineBoot = initEngine();
  // Clocks: resume a restored live clock, or start fresh ones for a new game.
  if (state.clocks?.flagged && !state.activeDrill) {
    // The clock ran out while the app was closed (restore charged the
    // elapsed wall time). Finalize it like a live flag so the result counts.
    const stored = state.localGames.find((game) => game.id === state.currentGameId);
    if (!stored?.result || stored.result === "in_progress") {
      completeGameWithResult(`${colorName(opposite(state.clocks.flagged))} wins on time`)
        .catch((error) => console.warn("Could not finalize the timed-out game", error));
    }
    renderClocks();
  } else if (state.clocks && !state.clocks.flagged && !state.game.isGameOver()) {
    startClockTicker();
    renderClocks();
  } else if (!state.game.isGameOver() && !state.moves.length) {
    initClocksForNewGame();
  } else {
    renderClocks();
  }

  if (!state.game.isGameOver() && state.game.turn() !== state.settings.playerColor) {
    // Bot to move at boot (reload mid-game, or a fresh game as Black): give
    // Stockfish a moment to finish booting first, otherwise the weak
    // heuristic fallback silently plays the move at the wrong strength.
    Promise.race([engineBoot, wait(4000)])
      .catch(() => {})
      .then(() => maybeEngineMove());
  }
}

// First sign-in on a device: use the name given at signup as the display name
// until the player customizes it in Settings.
function seedDisplayNameFromAccount() {
  if (!isSignedIn()) return;
  const rawName = String(state.auth.user?.user_metadata?.display_name || "").trim();
  if (!rawName) return;
  const current = state.settings.displayName;
  if (!current || current === DEFAULT_SETTINGS.displayName) {
    state.settings.displayName = normalizeDisplayName(rawName);
    saveJson(STORAGE_KEYS.settings, state.settings);
  }
}

boot().catch((error) => {
  console.error("Boot failed", error);
  // A mid-boot failure used to dismiss the veil onto a dead blank shell.
  // Show what happened and offer a retry instead.
  const veil = document.querySelector("#bootVeil");
  const inner = veil?.querySelector(".boot-veil-inner");
  if (inner) {
    inner.innerHTML = `
      <img src="./assets/squirrel_chess.svg" alt="">
      <strong>Personal Chess Teacher</strong>
      <p class="boot-error">Something went wrong while starting up. Check your connection and try again.</p>
      <button id="bootRetryButton" class="primary-action" type="button">Try again</button>
    `;
    inner.querySelector("#bootRetryButton")?.addEventListener("click", () => window.location.reload());
    veil.removeAttribute("aria-label");
  } else {
    dismissBootVeil();
  }
});

// Offline shell for the installed PWA (see sw.js). Registration failures are
// non-fatal — the app works identically without it, just not offline.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  });
}
