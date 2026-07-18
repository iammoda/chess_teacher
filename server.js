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

const ROOT = __dirname;

loadEnvFile();

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 5173);
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.1";
const MAX_BODY_BYTES = 1_000_000;
const COACH_TIMEOUT_MS = 30_000;
const OPENAI_HEALTH_TIMEOUT_MS = 8_000;
const COACH_RATE_LIMIT = { windowMs: 60_000, max: 30 };
const coachRequestLog = new Map();
const PUBLIC_FILES = new Set([
  "index.html",
  "app.js",
  "styles.css",
  "assets/squirrel.svg",
  "assets/squirrel_chess.svg",
  "lib/board-drag.mjs",
  "lib/coach-client.mjs",
  "lib/classify.mjs",
  "lib/repertoire.mjs",
  "lib/review-model.mjs",
  "lib/skill-rating.mjs",
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
      const payload = {
        openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
        model: OPENAI_MODEL,
        remoteHistoryEraseEnabled: isFeatureEnabled("ENABLE_REMOTE_HISTORY_ERASE"),
      };

      if (url.searchParams.get("check") === "1") {
        Object.assign(payload, await checkOpenAIStatus());
      }

      sendJson(res, 200, payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/coach/chat") {
      await handleCoachChatRequest(req, res);
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

function isRateLimited(ip) {
  const now = Date.now();
  const cutoff = now - COACH_RATE_LIMIT.windowMs;
  const recent = (coachRequestLog.get(ip) || []).filter((time) => time > cutoff);
  if (recent.length >= COACH_RATE_LIMIT.max) {
    coachRequestLog.set(ip, recent);
    return true;
  }
  recent.push(now);
  coachRequestLog.set(ip, recent);
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

  const ip = req.socket.remoteAddress || "unknown";
  if (isRateLimited(ip)) {
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
};
