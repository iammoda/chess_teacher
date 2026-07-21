const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const {
  validateChatPayload,
  reasoningEffortForEvent,
  buildChatInput,
  normalizeChatResponse,
  extractOutputText,
} = require("./lib/coach-chat");
const { createSupabaseAdmin, SupabaseRequestError } = require("./lib/supabase-admin");
const { validateSyncPayload, ACCOUNT_DATA_TABLES } = require("./lib/sync-contract");

const ROOT = __dirname;

loadEnvFile();

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 5173);
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.1";
const MAX_BODY_BYTES = 1_000_000;
const COACH_TIMEOUT_MS = 30_000;
const OPENAI_HEALTH_TIMEOUT_MS = 8_000;
// Sliding-window limits per bucket. Keys are the signed-in user id when auth
// is configured, otherwise the caller IP (legacy local mode).
const RATE_LIMITS = {
  coach: { windowMs: 60_000, max: 30 },
  sync: { windowMs: 60_000, max: 240 },
  account: { windowMs: 60_000, max: 10 },
};
const rateLimitLog = new Map();
const PUBLIC_FILES = new Set([
  "index.html",
  "app.js",
  "styles.css",
  "assets/squirrel.svg",
  "assets/squirrel_chess.svg",
  "lib/api-client.mjs",
  "lib/board-arrows.mjs",
  "lib/board-drag.mjs",
  "lib/coach-client.mjs",
  "lib/classify.mjs",
  "lib/mates.mjs",
  "lib/password-strength.mjs",
  "lib/repertoire.mjs",
  "lib/review-model.mjs",
  "lib/skill-rating.mjs",
  "lib/sounds.mjs",
  "lib/srs.mjs",
  "lib/skill-model.mjs",
  "lib/stockfish-engine.mjs",
  "vendor/chess/chess.js",
  "vendor/stockfish/stockfish-nnue-16-single.js",
  "vendor/stockfish/stockfish-nnue-16-single.wasm",
  ...["wP", "wN", "wB", "wR", "wQ", "wK", "bP", "bN", "bB", "bR", "bQ", "bK"]
    .map((piece) => `vendor/pieces/merida/${piece}.svg`),
]);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".sql": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function createServer() {
  return http.createServer(handleRequest);
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      const supabase = getSupabaseConfig();
      const payload = {
        openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
        model: OPENAI_MODEL,
        remoteHistoryEraseEnabled: isFeatureEnabled("ENABLE_REMOTE_HISTORY_ERASE"),
        authRequired: supabase.configured,
        syncConfigured: supabase.configured,
        supabaseAuth: supabase.configured
          ? { url: supabase.url, publishableKey: supabase.publishableKey }
          : null,
      };

      if (url.searchParams.get("check") === "1") {
        Object.assign(payload, await checkOpenAIStatus());
        Object.assign(payload, await checkSupabaseStatus());
      }

      sendJson(res, 200, payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/coach/chat") {
      const wantsStream = url.searchParams.get("stream") === "1";
      if (wantsStream) {
        await handleCoachChatStreamRequest(req, res);
      } else {
        await handleCoachChatRequest(req, res);
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/sync") {
      await handleSyncRequest(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/account/export") {
      await handleAccountExportRequest(req, res);
      return;
    }

    if (req.method === "DELETE" && url.pathname === "/api/account/data") {
      await handleAccountDeleteRequest(req, res);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    serveStatic(url.pathname, req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Internal server error" });
  }
}

function isFeatureEnabled(name) {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] || "").trim().toLowerCase());
}

// ─────────── Supabase auth + data access ───────────

// Read lazily so tests can toggle env between requests.
function getSupabaseConfig() {
  const url = String(process.env.SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || "").trim();
  return { url, serviceKey, publishableKey, configured: Boolean(url && serviceKey) };
}

// Tests can swap the fetch used for Supabase traffic without touching OpenAI paths.
let supabaseFetchOverride = null;
function __setSupabaseFetchForTests(fetchImpl) {
  supabaseFetchOverride = fetchImpl;
  supabaseAdminCache = { key: "", admin: null };
}

// Memoize the admin client per config so the token cache survives across requests.
let supabaseAdminCache = { key: "", admin: null };
function getSupabaseAdmin() {
  const { url, serviceKey, publishableKey, configured } = getSupabaseConfig();
  if (!configured) return null;

  const key = `${url}|${serviceKey}|${publishableKey}`;
  if (supabaseAdminCache.key !== key) {
    supabaseAdminCache = {
      key,
      admin: createSupabaseAdmin({
        url,
        serviceKey,
        publishableKey,
        fetchImpl: (...args) => (supabaseFetchOverride || fetch)(...args),
      }),
    };
  }
  return supabaseAdminCache.admin;
}

function bearerToken(req) {
  const header = String(req.headers?.authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

// Resolves the signed-in user for a request, sending the error response itself
// when authentication fails. Returns { userId } on success, null when a
// response has already been sent. In legacy local mode (Supabase not
// configured) callers that tolerate anonymous access get { userId: null }.
async function requireUser(req, res, { optional = false } = {}) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    if (optional) return { userId: null };
    sendJson(res, 503, { error: "Cloud sync is not configured on the server. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env." });
    return null;
  }

  const token = bearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: "Sign in required." });
    return null;
  }

  let user;
  try {
    user = await admin.verifyToken(token);
  } catch {
    sendJson(res, 503, { error: "Could not reach the authentication service. Try again." });
    return null;
  }

  if (!user) {
    sendJson(res, 401, { error: "Your session has expired. Sign in again." });
    return null;
  }
  return user;
}

async function checkSupabaseStatus() {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return { dataOnline: false, dataError: "Supabase is not configured on the server." };
  }
  try {
    await admin.ping();
    return { dataOnline: true, dataError: "" };
  } catch (error) {
    return { dataOnline: false, dataError: error.message || "Database unreachable." };
  }
}

async function handleSyncRequest(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  if (isRateLimited("sync", user.userId)) {
    sendJson(res, 429, { error: "Too many sync requests in a short window." });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, {
      error: error.message === "Request body too large"
        ? "Sync request was too large."
        : "Sync request was not valid JSON.",
    });
    return;
  }

  const validated = validateSyncPayload(payload);
  if (validated.error) {
    sendJson(res, 400, { error: validated.error });
    return;
  }

  const admin = getSupabaseAdmin();
  try {
    await executeSyncOperation(admin, user.userId, validated);
  } catch (error) {
    if (error instanceof SupabaseRequestError) {
      console.warn(`Sync ${validated.op} ${validated.table} failed: ${error.message}`);
      const clientFault = error.status >= 400 && error.status < 500;
      sendJson(res, clientFault ? 409 : 502, {
        error: clientFault ? "Cloud sync rejected the request." : "Cloud sync failed. Try again.",
      });
      return;
    }
    throw error;
  }

  sendJson(res, 200, { ok: true });
}

async function executeSyncOperation(admin, userId, { op, table, rows, id, patch, conflict }) {
  if (op === "update") {
    await admin.update(table, { id, userId, patch });
    return;
  }

  const stamped = rows.map((row) => ({ ...row, user_id: userId }));

  if (op === "insert") {
    await admin.insert(table, stamped);
    return;
  }

  // Upserts that conflict on a global primary key are executed as
  // insert-then-scoped-update so a colliding id can never overwrite another
  // user's row. Per-user conflict targets are safe for merge-duplicates
  // because user_id is stamped server-side.
  if (conflict && conflict.length === 1 && conflict[0] === "id") {
    for (const row of stamped) {
      try {
        await admin.insert(table, [row]);
      } catch (error) {
        const isConflict = error instanceof SupabaseRequestError && error.status === 409;
        if (!isConflict) throw error;
        const { id: rowId, user_id: _ignored, ...updatePatch } = row;
        await admin.update(table, { id: rowId, userId, patch: updatePatch });
      }
    }
    return;
  }

  await admin.upsert(table, stamped, conflict);
}

async function handleAccountExportRequest(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  if (isRateLimited("account", user.userId)) {
    sendJson(res, 429, { error: "Too many account requests in a short window." });
    return;
  }

  const admin = getSupabaseAdmin();
  const tables = {};
  try {
    for (const table of ACCOUNT_DATA_TABLES) {
      tables[table] = await admin.selectForUser(table, user.userId);
    }
  } catch (error) {
    if (error instanceof SupabaseRequestError) {
      console.warn(`Account export failed: ${error.message}`);
      sendJson(res, 502, { error: "Export failed. Try again." });
      return;
    }
    throw error;
  }

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Disposition": "attachment; filename=\"chess-teacher-export.json\"",
  });
  res.end(JSON.stringify({ exportedAt: new Date().toISOString(), userId: user.userId, tables }));
}

async function handleAccountDeleteRequest(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  if (isRateLimited("account", user.userId)) {
    sendJson(res, 429, { error: "Too many account requests in a short window." });
    return;
  }

  const admin = getSupabaseAdmin();
  try {
    for (const table of ACCOUNT_DATA_TABLES) {
      await admin.deleteForUser(table, user.userId);
    }
  } catch (error) {
    if (error instanceof SupabaseRequestError) {
      console.warn(`Account data delete failed: ${error.message}`);
      sendJson(res, 502, { error: "Delete failed. Try again." });
      return;
    }
    throw error;
  }

  sendJson(res, 200, { ok: true });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`Chess teacher running at http://${HOST}:${PORT}`);
    console.log(process.env.OPENAI_API_KEY ? `OpenAI coach enabled with ${OPENAI_MODEL}` : "OpenAI coach disabled: set OPENAI_API_KEY in .env or the shell.");
  });
}

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function serveStatic(pathname, req, res) {
  const filePath = resolvePublicFile(pathname);

  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  fs.createReadStream(filePath).pipe(res);
}

function resolvePublicFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(pathname || "").split("?")[0]);
  } catch {
    return "";
  }

  const rawRelativePath = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const relativePath = path.posix.normalize(rawRelativePath.replaceAll("\\", "/"));
  const pathParts = relativePath.split("/");

  if (
    relativePath === "." ||
    relativePath.startsWith("../") ||
    relativePath.includes("/../") ||
    pathParts.some((part) => part.startsWith("."))
  ) {
    return "";
  }

  if (!PUBLIC_FILES.has(relativePath)) return "";
  return path.resolve(ROOT, relativePath);
}

function isRateLimited(bucket, key) {
  const config = RATE_LIMITS[bucket];
  const logKey = `${bucket}:${key}`;
  const now = Date.now();
  const cutoff = now - config.windowMs;
  const recent = (rateLimitLog.get(logKey) || []).filter((time) => time > cutoff);
  if (recent.length >= config.max) {
    rateLimitLog.set(logKey, recent);
    return true;
  }
  recent.push(now);
  rateLimitLog.set(logKey, recent);
  return false;
}

async function checkOpenAIStatus() {
  if (!process.env.OPENAI_API_KEY) {
    return {
      openaiOnline: false,
      openaiError: "OPENAI_API_KEY is not set.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(OPENAI_MODEL)}`, {
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        openaiOnline: false,
        openaiError: data.error?.message || `OpenAI returned HTTP ${response.status}.`,
      };
    }

    return {
      openaiOnline: true,
      openaiError: "",
    };
  } catch (error) {
    return {
      openaiOnline: false,
      openaiError: error.name === "AbortError"
        ? "OpenAI health check timed out."
        : "Could not reach OpenAI.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleCoachChatRequest(req, res) {
  // When Supabase auth is configured, the coach costs money — only signed-in
  // users may spend OpenAI tokens. Legacy local mode stays open on loopback.
  const user = await requireUser(req, res, { optional: true });
  if (!user) return;

  if (!process.env.OPENAI_API_KEY) {
    sendJson(res, 200, {
      configured: false,
      message: "The coach is offline. Add OPENAI_API_KEY to .env and restart the server to talk.",
      question: null,
      offer_rethink: false,
      memory_note: null,
    });
    return;
  }

  const limitKey = user.userId || req.socket.remoteAddress || "unknown";
  if (isRateLimited("coach", limitKey)) {
    sendJson(res, 429, {
      configured: true,
      error: "Too many coach requests in a short window. Wait a moment and try again.",
    });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, {
      configured: true,
      error: error.message === "Request body too large"
        ? "Coach request was too large."
        : "Coach request was not valid JSON.",
    });
    return;
  }

  const validationError = validateChatPayload(payload);
  if (validationError) {
    sendJson(res, 400, { configured: true, error: validationError });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COACH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: buildChatInput(payload),
        max_output_tokens: 900,
        reasoning: { effort: reasoningEffortForEvent(payload.event) },
        text: { format: { type: "json_object" } },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    const aborted = error.name === "AbortError";
    sendJson(res, aborted ? 504 : 502, {
      configured: true,
      error: aborted
        ? "The coach took too long to respond. Try again."
        : "Could not reach the coaching service.",
    });
    return;
  }
  clearTimeout(timeout);

  const data = await response.json();
  if (!response.ok) {
    sendJson(res, response.status, {
      configured: true,
      error: data.error?.message || "OpenAI request failed",
    });
    return;
  }

  const text = extractOutputText(data);
  sendJson(res, 200, normalizeChatResponse(text));
}

async function handleCoachChatStreamRequest(req, res) {
  const user = await requireUser(req, res, { optional: true });
  if (!user) return;

  if (!process.env.OPENAI_API_KEY) {
    // Fall back to the non-streaming response shape so the client can render.
    sendJson(res, 200, {
      configured: false,
      message: "The coach is offline. Add OPENAI_API_KEY to .env and restart the server to talk.",
      question: null,
      offer_rethink: false,
      memory_note: null,
    });
    return;
  }

  const limitKey = user.userId || req.socket.remoteAddress || "unknown";
  if (isRateLimited("coach", limitKey)) {
    sendJson(res, 429, { configured: true, error: "Too many coach requests in a short window. Wait a moment and try again." });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, {
      configured: true,
      error: error.message === "Request body too large"
        ? "Coach request was too large."
        : "Coach request was not valid JSON.",
    });
    return;
  }

  const validationError = validateChatPayload(payload);
  if (validationError) {
    sendJson(res, 400, { configured: true, error: validationError });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COACH_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: buildChatInput(payload),
        max_output_tokens: 900,
        reasoning: { effort: reasoningEffortForEvent(payload.event) },
        stream: true,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    sendEvent("error", { message: error.name === "AbortError" ? "Coach timed out." : "Could not reach the coaching service." });
    res.end();
    return;
  }

  if (!upstream.ok || !upstream.body) {
    clearTimeout(timeout);
    const err = await upstream.text().catch(() => "");
    sendEvent("error", { message: err ? `OpenAI ${upstream.status}: ${err.slice(0, 200)}` : `OpenAI ${upstream.status}` });
    res.end();
    return;
  }

  // Forward OpenAI's Responses-API SSE stream, translating deltas into our own
  // "delta" and "done" events. We buffer the full raw text so we can parse the
  // META trailer once the stream ends.
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let fullText = "";

  try {
    for await (const chunk of upstream.body) {
      sseBuffer += decoder.decode(chunk, { stream: true });
      let separator;
      while ((separator = sseBuffer.indexOf("\n\n")) !== -1) {
        const block = sseBuffer.slice(0, separator);
        sseBuffer = sseBuffer.slice(separator + 2);
        const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        const dataStr = dataLine.slice(5).trim();
        if (!dataStr || dataStr === "[DONE]") continue;
        let event;
        try { event = JSON.parse(dataStr); } catch { continue; }
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          fullText += event.delta;
          sendEvent("delta", { text: event.delta });
        } else if (event.type === "response.error" || event.type === "error") {
          sendEvent("error", { message: event.error?.message || "OpenAI stream error." });
        }
      }
    }
  } catch (error) {
    clearTimeout(timeout);
    sendEvent("error", { message: error.name === "AbortError" ? "Coach timed out." : "Coach stream interrupted." });
    res.end();
    return;
  }
  clearTimeout(timeout);

  const finalReply = normalizeChatResponse(fullText);
  sendEvent("done", finalReply);
  res.end();
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

module.exports = {
  createServer,
  handleRequest,
  resolvePublicFile,
  __setSupabaseFetchForTests,
};
