const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const ROOT = __dirname;

loadEnvFile();

const PORT = Number(process.env.PORT || 5173);
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.1";
const MAX_BODY_BYTES = 1_000_000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".sql": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
        model: OPENAI_MODEL,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/coach") {
      await handleCoachRequest(req, res);
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
});

server.listen(PORT, () => {
  console.log(`Chess teacher running at http://localhost:${PORT}`);
  console.log(process.env.OPENAI_API_KEY ? `OpenAI coach enabled with ${OPENAI_MODEL}` : "OpenAI coach disabled: set OPENAI_API_KEY in .env or the shell.");
});

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
  const cleanPath = decodeURIComponent(pathname.split("?")[0]);
  const relativePath = cleanPath === "/" ? "index.html" : cleanPath.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, relativePath);

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

async function handleCoachRequest(req, res) {
  if (!process.env.OPENAI_API_KEY) {
    sendJson(res, 200, {
      configured: false,
      summary: "OpenAI is not connected yet.",
      plan: "Create a local .env file with OPENAI_API_KEY, then restart the Node server.",
      candidate_explanations: [],
      weakness_focus: "The app is currently using only local heuristics.",
      practice_recommendations: ["Keep playing games so the local profile can collect mistakes."],
    });
    return;
  }

  const payload = await readJsonBody(req);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: buildCoachPrompt(payload),
      max_output_tokens: 900,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    sendJson(res, response.status, {
      configured: true,
      error: data.error?.message || "OpenAI request failed",
    });
    return;
  }

  const text = extractOutputText(data);
  sendJson(res, 200, normalizeCoachResponse(text));
}

function buildCoachPrompt(payload) {
  return `You are a personal chess teacher for one user.

Your job is to tailor coaching to how this user plays, not give generic chess advice.
Use the provided current position, recent moves, candidate moves, tagged mistakes, profile, practice history, and selected lesson/drill.

Rules:
- Do not invent illegal moves. Candidate moves are provided by the app; prefer explaining those.
- If the user repeatedly makes a mistake, explicitly connect today's advice to that pattern.
- Teach the plan: what the player should look for, why it matters, and what to practice next.
- Keep language direct and concrete.
- Return only valid JSON with this exact shape:
{
  "configured": true,
  "summary": "1-2 sentence personalized read of the current moment",
  "plan": "2-4 sentence plan tailored to this user's games",
  "candidate_explanations": [{"move":"SAN or UCI","reason":"why this move should be considered"}],
  "weakness_focus": "one recurring weakness or strength to focus on",
  "practice_recommendations": ["specific drill or lesson", "specific drill or lesson"]
}

Context:
${JSON.stringify(payload, null, 2)}`;
}

function extractOutputText(data) {
  if (data.output_text) return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function normalizeCoachResponse(text) {
  try {
    const parsed = JSON.parse(stripJsonFence(text));
    return {
      configured: true,
      summary: String(parsed.summary || "No summary returned."),
      plan: String(parsed.plan || ""),
      candidate_explanations: Array.isArray(parsed.candidate_explanations) ? parsed.candidate_explanations.slice(0, 5) : [],
      weakness_focus: String(parsed.weakness_focus || ""),
      practice_recommendations: Array.isArray(parsed.practice_recommendations) ? parsed.practice_recommendations.slice(0, 4) : [],
    };
  } catch {
    return {
      configured: true,
      summary: text || "OpenAI returned an empty response.",
      plan: "",
      candidate_explanations: [],
      weakness_focus: "",
      practice_recommendations: [],
    };
  }
}

function stripJsonFence(text) {
  return String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
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
