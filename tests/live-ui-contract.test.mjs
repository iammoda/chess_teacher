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
  assert.match(app, /state\.lastMove\?\.to === square \? "last-to"/);
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

  assert.match(app, /vendor\/pieces\/merida\//);
  assert.match(app, /function pieceSpriteUrl\(color, type\)/);
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

test("play is never gated on remote services", async () => {
  const app = await source("app.js");

  assert.doesNotMatch(app, /areRequiredServicesReady/);
  assert.doesNotMatch(app, /Supabase and OpenAI must be online/);
  assert.match(app, /function isCoachAvailable\(\)/);
  assert.match(app, /renderCoachOfflineBanner/);
});

test("settings exposes local history erase and gates remote erase behind server flag", async () => {
  const app = await source("app.js");
  const envExample = await source(".env.example");

  assert.match(envExample, /ENABLE_REMOTE_HISTORY_ERASE=false/);
  assert.match(app, /remoteHistoryEraseEnabled/);
  assert.match(app, /Erase local history/);
  assert.match(app, /Erase local \+ Supabase history/);
  assert.match(app, /deleteSupabaseHistory/);
  assert.match(app, /practice_attempts/);
  assert.match(app, /weakness_events/);
  assert.match(app, /positions/);
  assert.match(app, /moves/);
  assert.match(app, /weaknesses/);
  assert.match(app, /games/);
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
