import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("live game seats expose turn and capture UI", async () => {
  const html = await source("index.html");

  assert.match(html, /id="opponentSeatPill"/);
  assert.match(html, /id="playerSeatPill"/);
  assert.match(html, /id="opponentCaptureTray"/);
  assert.match(html, /id="playerCaptureTray"/);
});

test("calibration hides personalized skill focus and avoids unexplained coach phrasing", async () => {
  const app = await source("app.js");

  assert.match(app, /function renderSkillFocusCard\(\) \{\n\s+if \(!isCalibrationComplete\(\)\) return "";/);
  assert.doesNotMatch(app, /Candidate to compare/);
  assert.doesNotMatch(app, /Consider forcing moves like/);
  assert.match(app, /A candidate move is a move worth checking before deciding/);
});

test("conversational coach chat, rethink flow, and calibration are wired in", async () => {
  const app = await source("app.js");
  const html = await source("index.html");
  const css = await source("styles.css");

  const coachClient = await source("lib/coach-client.mjs");
  assert.match(app, /coachChatLog/);
  assert.match(app, /coachChatInput/);
  assert.match(coachClient, /\/api\/coach\/chat/);
  assert.match(app, /function maybeOfferRethink/);
  assert.match(app, /function maybeTriggerProactiveCoach/);
  assert.match(app, /chess_teacher_coach_memory_v1/);
  assert.match(app, /function migrateLegacyPlacement/);
  assert.doesNotMatch(app, /onClickTakeBack/);
  assert.doesNotMatch(html, /takeBackButton/);
  assert.doesNotMatch(app, /getPlacementProgress/);

  assert.match(css, /\.coach-chat-log/);
  assert.match(css, /\.rethink-card/);
});

test("board renders arrow overlay, eval bar, eval graph, and variation replay", async () => {
  const app = await source("app.js");
  const html = await source("index.html");
  const css = await source("styles.css");
  const arrows = await source("lib/board-arrows.mjs");

  assert.match(html, /id="boardArrows"/);
  assert.match(html, /id="evalBar"/);
  assert.match(arrows, /export function arrowsOverlaySvg/);
  assert.match(app, /function paintBoardArrows/);
  assert.match(app, /function paintEvalBar/);
  assert.match(app, /function renderEvalGraphCard/);
  assert.match(app, /function startVariationReplay/);
  assert.match(app, /function stepVariationReplay/);
  assert.match(app, /getDisplayGame/);
  assert.match(css, /\.board-arrows/);
  assert.match(css, /\.eval-bar/);
  assert.match(css, /\.eval-graph/);
  assert.match(css, /\.replay-card/);
});

test("sounds and promotion picker are wired in", async () => {
  const app = await source("app.js");
  const css = await source("styles.css");
  const sounds = await source("lib/sounds.mjs");

  assert.match(sounds, /export function playSound/);
  assert.match(sounds, /export function classifyMoveForSound/);
  assert.match(app, /function playGameSound/);
  assert.match(app, /function askForPromotionPiece/);
  assert.match(app, /soundEnabled/);
  assert.match(app, /showBestArrow/);
  assert.match(css, /\.promotion-menu/);
  assert.match(css, /\.promotion-choice/);
});

test("mate ladder, daily plan, and clocks are wired in", async () => {
  const app = await source("app.js");
  const html = await source("index.html");
  const css = await source("styles.css");
  const mates = await source("lib/mates.mjs");

  assert.match(mates, /export const MATE_LADDER/);
  assert.match(mates, /export function isRungUnlocked/);

  assert.match(html, /id="playerClock"/);
  assert.match(html, /id="opponentClock"/);
  assert.match(app, /function startMateDrill/);
  assert.match(app, /function handleMateDrillMove/);
  assert.match(app, /function initClocksForNewGame/);
  assert.match(app, /function tickClock/);
  assert.match(app, /Checkmate Ladder/);
  assert.match(app, /Daily plan/);
  assert.match(app, /markDailyItemComplete/);

  assert.match(css, /\.mate-rung/);
  assert.match(css, /\.daily-list/);
  assert.match(css, /\.clock\.running/);
});

test("practice unifies due drills, opening trainer, and weakness labs", async () => {
  const app = await source("app.js");
  const html = await source("index.html");

  assert.doesNotMatch(html, /data-tab="labs"/);
  assert.doesNotMatch(app, /renderLabsPanel/);
  assert.match(app, /Due Drills/);
  assert.match(app, /My Openings/);
  assert.match(app, /Weakness Labs/);
  assert.match(app, /function startOpeningDrill/);
  assert.match(app, /function handleOpeningDrillMove/);
  assert.match(app, /chess_teacher_repertoire_v1/);
  assert.match(app, /rescheduleQueueItem/);
});

test("board source supports selected, legal, last-move, and smooth movement states", async () => {
  const app = await source("app.js");
  const css = await source("styles.css");

  assert.match(app, /targetCapture \? "target-capture"/);
  assert.match(app, /lastToSquare === square \? "last-to"/);
  assert.match(app, /const MOVE_ANIMATION_MS = 240/);
  assert.match(app, /translate3d\(\$\{dx\}px, \$\{dy\}px, 0\)/);

  assert.match(css, /\.square\.selected::before/);
  assert.match(css, /\.square\.target-capture::before/);
  assert.match(css, /\.square\.last-to::before/);
  assert.match(css, /\.board\.animating \.square:hover \.piece/);
});

test("board renders SVG piece sprites with drag-and-drop support", async () => {
  const app = await source("app.js");
  const css = await source("styles.css");
  const drag = await source("lib/board-drag.mjs");

  assert.match(app, /PIECE_SPRITE_ROOT = "\/vendor\/pieces\/"/);
  assert.match(app, /DEFAULT_PIECE_SET = "merida"/);
  assert.match(app, /function pieceSpriteUrl\(color, type, set = getActivePieceSet\(\)\)/);
  assert.match(app, /attachDragHandlers/);
  assert.match(app, /attemptPlayerMove/);
  assert.doesNotMatch(app, /"♙"/);

  assert.match(drag, /export function attachDragHandlers/);
  assert.match(drag, /elementFromPoint/);

  assert.match(css, /\.drag-ghost/);
  assert.match(css, /\.piece\.drag-source/);
  assert.match(css, /--sq-light: #dee3e6/);
  assert.match(css, /--sq-dark: #8ca2ad/);
});

test("board themes, piece sets, personas, and family mode are wired in", async () => {
  const app = await source("app.js");
  const css = await source("styles.css");
  const server = await source("server.js");
  const personas = await source("lib/personas.mjs");
  const coachChat = await source("lib/coach-chat.js");

  // Board themes: token overrides selected by a data attribute.
  assert.match(app, /function applyBoardTheme/);
  assert.match(app, /dataset\.boardTheme/);
  for (const theme of ["walnut", "green", "ocean", "rosewood", "candy", "nebula", "middle-realm"]) {
    assert.match(css, new RegExp(`\\[data-board-theme="${theme}"\\]`), theme);
  }
  assert.match(app, /renderAppearanceCards/);
  assert.match(css, /\.theme-swatch/);

  // Piece sets: discovered server-side, chosen client-side, previewed live.
  assert.match(server, /function discoverPieceSets/);
  assert.match(server, /pieceSets: PIECE_SETS/);
  assert.match(app, /function getActivePieceSet/);
  assert.match(app, /function preloadPieceSet/);
  assert.match(css, /\.piece-set-option/);

  // Personas: whitelisted voice overlays that never change the method.
  assert.match(personas, /export const COACH_PERSONAS/);
  assert.match(personas, /VOICE ONLY/);
  assert.match(coachChat, /require\("\.\/personas\.mjs"\)/);
  assert.match(coachChat, /changes tone only/);
  assert.match(app, /persona: getActivePersonaKey\(\)/);
  assert.match(app, /renderPersonaCard/);

  // Family mode: gentle persona lock, softened labels, hidden danger zone.
  assert.match(app, /function isFamilyMode/);
  assert.match(app, /FAMILY_QUALITY_LABELS/);
  assert.match(app, /familyModeInput/);
  assert.match(app, /Family mode keeps Sunny as the coach/);
});

test("play is never gated on remote services", async () => {
  const app = await source("app.js");

  assert.doesNotMatch(app, /areRequiredServicesReady/);
  assert.doesNotMatch(app, /Supabase and OpenAI must be online/);
  assert.match(app, /function isCoachAvailable\(\)/);
  assert.match(app, /renderCoachOfflineBanner/);
});

test("settings exposes local history erase and account-scoped remote erase", async () => {
  const app = await source("app.js");
  const envExample = await source(".env.example");

  assert.match(envExample, /ENABLE_REMOTE_HISTORY_ERASE=false/);
  assert.match(envExample, /SUPABASE_URL=/);
  assert.match(envExample, /SUPABASE_SERVICE_ROLE_KEY=/);
  assert.match(app, /remoteHistoryEraseEnabled/);
  assert.match(app, /Erase local history/);
  assert.match(app, /Erase local \+ Supabase history/);
  assert.match(app, /deleteSupabaseHistory/);
  assert.match(app, /accountDelete/);
  assert.match(app, /canCloudSync/);
  assert.match(app, /practice_attempts/);
  assert.match(app, /weakness_events/);
  assert.match(app, /positions/);
  assert.match(app, /moves/);
  assert.match(app, /weaknesses/);
  assert.match(app, /games/);
});

test("auth gate and server-mediated sync are wired in", async () => {
  const app = await source("app.js");
  const html = await source("index.html");
  const css = await source("styles.css");
  const apiClient = await source("lib/api-client.mjs");
  const server = await source("server.js");
  const schema = await source("supabase/schema.sql");

  // Boot veil: no app flash before the gate or the app is ready.
  assert.match(html, /id="bootVeil"/);
  assert.match(html, /rel="modulepreload"[^>]*supabase-js/);
  assert.match(app, /function dismissBootVeil/);
  assert.match(css, /\.boot-veil/);

  // Sign-in overlay and per-user storage.
  assert.match(app, /function renderAuthGate/);
  assert.match(app, /function ensureSignedIn/);
  assert.match(app, /function applyStorageNamespace/);
  assert.match(app, /function hydrateStateFromStorage/);
  assert.match(app, /signInWithPassword/);
  assert.match(css, /\.auth-gate/);
  assert.match(css, /\.auth-card/);

  // Distinct signup flow: name capture, strength meter, confirm/resend screens.
  assert.match(app, /authNameInput/);
  assert.match(app, /display_name: name/);
  assert.match(app, /scorePassword/);
  assert.match(app, /function seedDisplayNameFromAccount/);
  assert.match(app, /confirm_sent/);
  assert.match(app, /function handleResendEmail/);
  assert.match(app, /function friendlyAuthError/);
  assert.match(app, /pwToggleButton/);
  assert.match(css, /\.pw-meter/);
  assert.match(css, /\.auth-resend/);

  // The browser must never talk to the database directly or embed keys.
  assert.match(app, /createApiClient/);
  assert.doesNotMatch(app, /sb_publishable_/);
  assert.doesNotMatch(app, /SUPABASE_PROJECT_REF/);
  assert.doesNotMatch(app, /\.from\(["']games["']\)/);
  assert.match(apiClient, /\/api\/sync/);
  assert.match(apiClient, /\/api\/account\/export/);

  // Server owns auth verification and stamps user ownership.
  assert.match(server, /requireUser/);
  assert.match(server, /user_id: userId/);
  assert.match(server, /\/api\/account\/data/);

  // Schema is locked to the service role with per-user rows.
  assert.match(schema, /enable row level security/);
  assert.match(schema, /user_id uuid references auth\.users/);
});

test("identity settings and squirrel branding are wired into the UI", async () => {
  const html = await source("index.html");
  const app = await source("app.js");
  const css = await source("styles.css");

  assert.match(html, /assets\/squirrel_chess\.svg/);
  assert.match(html, /id="playerSeatName"/);
  assert.match(html, /id="playerAvatar"/);
  assert.match(app, /displayName: "You"/);
  assert.match(app, /displayNameInput/);
  assert.match(app, /Calibration MoBot/);
  assert.match(app, /Adaptive MoBot/);
  assert.match(app, /"MO"/);
  assert.match(css, /--board-size/);
  assert.match(css, /width: var\(--board-size\)/);
  assert.match(css, /height: var\(--board-size\)/);
});

test("every browser module import is on the server's static allowlist", async () => {
  const app = await source("app.js");
  const server = await source("server.js");

  const imports = [...app.matchAll(/from "\.\/((?:lib|vendor)\/[A-Za-z0-9/_-]+\.(?:mjs|js))"/g)]
    .map((match) => match[1]);
  assert.ok(imports.length >= 10, "expected app.js to import browser modules");
  for (const path of imports) {
    assert.ok(server.includes(`"${path}"`), `${path} is imported by app.js but missing from PUBLIC_FILES`);
  }
});

test("deep analysis, rated tactics, and drill feedback are wired in", async () => {
  const app = await source("app.js");
  const css = await source("styles.css");
  const server = await source("server.js");
  const coachChat = await source("lib/coach-chat.js");

  // Post-game deep re-analysis with cancellation and progress UI.
  assert.match(app, /function runDeepGameAnalysis/);
  assert.match(app, /function cancelDeepAnalysis/);
  assert.match(app, /function applyEngineAnalysisToRecord/);
  assert.match(app, /verifyTagsWithEngine/);
  assert.match(app, /function retractWeaknessEvidence/);
  assert.match(app, /renderDeepAnalysisStatus/);
  assert.match(css, /\.deep-analysis-card/);

  // Rated tactics pack: served, loaded, selectable, multi-move capable.
  assert.match(server, /vendor\/puzzles\/lichess-pack\.json/);
  assert.match(app, /function loadPuzzlePack/);
  assert.match(app, /function startRatedPuzzle/);
  assert.match(app, /renderRatedTacticsSection/);
  assert.match(app, /solutionLine/);
  assert.match(app, /Lichess database \(CC0\)/);

  // Coach reacts to missed drills.
  assert.match(app, /function maybeSendDrillFeedback/);
  assert.match(app, /requestCoachChat\("drill_feedback"/);
  assert.match(coachChat, /drill_feedback events/);
});

test("small pill and chip labels share title-case formatting", async () => {
  const html = await source("index.html");
  const app = await source("app.js");
  const css = await source("styles.css");

  assert.match(app, /function toTitleCaseLabel\(value\)/);
  assert.match(app, /function formatCountLabel\(count, singular, plural = `\$\{singular\}s`\)/);
  assert.match(app, /"Your Turn"/);
  assert.doesNotMatch(html, /Your move/);

  assert.match(app, /formatCountLabel\(counts\.focus, "focus board", "focus boards"\)/);
  assert.match(app, /formatCountLabel\(counts\.game_transfer, "from your game", "from your games"\)/);
  assert.match(app, /formatCountLabel\(counts\.game_transfer, "position from your game", "positions from your games"\)/);

  assert.match(app, /toTitleCaseLabel\(detail\)/);
  assert.match(app, /toTitleCaseLabel\(formatTagTerm\(tag\)\)/);
  assert.match(app, /toTitleCaseLabel\(tag\.label\)/);
  assert.match(app, /toTitleCaseLabel\(puzzle\.term\)/);
  assert.match(app, /toTitleCaseLabel\("No captures"\)/);
  assert.doesNotMatch(app, /<span class="tag[^`]*>\$\{escapeHtml\(detail\)\}<\/span>/);
  assert.doesNotMatch(app, /<span class="tag[^`]*>\$\{escapeHtml\(concept\)\}<\/span>/);
  assert.doesNotMatch(app, /<span class="candidate[^`]*>\$\{escapeHtml\(item\)\}<\/span>/);

  assert.match(css, /\.pill,\n\.tag,\n\.candidate,\n\.quality-pill,\n\.nav-badge,/);
  assert.match(css, /min-height: 24px;/);
  assert.match(css, /line-height: 1;/);
  assert.match(css, /text-transform: none;/);
});
