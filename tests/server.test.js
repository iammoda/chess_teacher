const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable, Writable } = require("node:stream");
const { handleRequest, resolvePublicFile } = require("../server");

function requestPath(path) {
  return new Promise((resolve, reject) => {
    const req = new Readable({
      read() {
        this.push(null);
      },
    });
    req.method = "GET";
    req.url = path;
    req.headers = { host: "localhost" };

    const chunks = [];
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    res.statusCode = 200;
    res.headers = {};
    res.writeHead = (status, headers) => {
      res.statusCode = status;
      res.headers = headers || {};
      return res;
    };
    res.on("finish", () => {
      resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      });
    });
    res.on("error", reject);

    Promise.resolve(handleRequest(req, res)).catch(reject);
  });
}

test("resolvePublicFile allows only browser assets", () => {
  assert.match(resolvePublicFile("/"), /index\.html$/);
  assert.match(resolvePublicFile("/app.js"), /app\.js$/);
  assert.match(resolvePublicFile("/assets/squirrel_chess.svg"), /squirrel_chess\.svg$/);
  assert.match(resolvePublicFile("/lib/classify.mjs"), /classify\.mjs$/);
  assert.match(resolvePublicFile("/lib/skill-model.mjs"), /skill-model\.mjs$/);
  assert.match(resolvePublicFile("/lib/stockfish-engine.mjs"), /stockfish-engine\.mjs$/);
  assert.match(resolvePublicFile("/vendor/chess/chess.js"), /chess\.js$/);
  assert.match(resolvePublicFile("/lib/board-drag.mjs"), /board-drag\.mjs$/);
  for (const piece of ["wP", "wN", "wB", "wR", "wQ", "wK", "bP", "bN", "bB", "bR", "bQ", "bK"]) {
    assert.match(resolvePublicFile(`/vendor/pieces/merida/${piece}.svg`), new RegExp(`${piece}\\.svg$`));
  }
  assert.equal(resolvePublicFile("/vendor/pieces/LICENSE.md"), "");
  assert.equal(resolvePublicFile("/.env"), "");
  assert.equal(resolvePublicFile("/README.md"), "");
  assert.equal(resolvePublicFile("/server.js"), "");
  assert.equal(resolvePublicFile("/lib/coach-chat.js"), "");
  assert.equal(resolvePublicFile("/supabase/schema.sql"), "");
  assert.equal(resolvePublicFile("/../.env"), "");
});

test("static server serves required public assets", async () => {
  const html = await requestPath("/");
  assert.equal(html.status, 200);
  assert.match(html.headers["Content-Type"] || "", /text\/html/);

  const app = await requestPath("/app.js");
  assert.equal(app.status, 200);
  assert.match(app.headers["Content-Type"] || "", /text\/javascript/);

  const skillModel = await requestPath("/lib/skill-model.mjs");
  assert.equal(skillModel.status, 200);
  assert.match(skillModel.headers["Content-Type"] || "", /text\/javascript/);

  const icon = await requestPath("/assets/squirrel_chess.svg");
  assert.equal(icon.status, 200);
  assert.match(icon.headers["Content-Type"] || "", /image\/svg\+xml/);

  const wasm = await requestPath("/vendor/stockfish/stockfish-nnue-16-single.wasm");
  assert.equal(wasm.status, 200);
  assert.match(wasm.headers["Content-Type"] || "", /application\/wasm/);

  const pieceSprite = await requestPath("/vendor/pieces/merida/wK.svg");
  assert.equal(pieceSprite.status, 200);
  assert.match(pieceSprite.headers["Content-Type"] || "", /image\/svg\+xml/);

  const chess = await requestPath("/vendor/chess/chess.js");
  assert.equal(chess.status, 200);
  assert.match(chess.headers["Content-Type"] || "", /text\/javascript/);
});

test("static server denies sensitive repo files", async () => {
  for (const path of ["/.env", "/README.md", "/server.js", "/lib/coach-chat.js", "/supabase/schema.sql"]) {
    const response = await requestPath(path);
    assert.equal(response.status, 404, path);
  }
});

function postJson(path, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = new Readable({
      read() {
        this.push(body);
        this.push(null);
      },
    });
    req.method = "POST";
    req.url = path;
    req.headers = { host: "localhost" };
    req.socket = { remoteAddress: `test-${Math.random()}` };

    const chunks = [];
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    res.writeHead = (status, headers) => {
      res.statusCode = status;
      res.headers = headers || {};
      return res;
    };
    res.on("finish", () => {
      resolve({
        status: res.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      });
    });
    res.on("error", reject);

    Promise.resolve(handleRequest(req, res)).catch(reject);
  });
}

test("coach chat endpoint reports unconfigured without an API key", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const response = await postJson("/api/coach/chat", { event: "user_message", messages: [], game: { fen: "x" } });
    assert.equal(response.status, 200);
    assert.equal(response.body.configured, false);
    assert.match(response.body.message, /offline/i);
  } finally {
    if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
  }
});

test("coach chat endpoint rejects malformed payloads", async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  try {
    const badEvent = await postJson("/api/coach/chat", { event: "lecture", messages: [], game: { fen: "x" } });
    assert.equal(badEvent.status, 400);
    assert.match(badEvent.body.error, /event must be one of/);

    const noGame = await postJson("/api/coach/chat", { event: "user_message", messages: [] });
    assert.equal(noGame.status, 400);
    assert.match(noGame.body.error, /game position/);
  } finally {
    if (previous === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previous;
    }
  }
});

test("old one-shot coach endpoint is gone", async () => {
  const response = await postJson("/api/coach", { context: "position", currentPosition: { fen: "x" } });
  // POST to a non-endpoint path falls through to the method guard.
  assert.equal(response.status, 405);
});

test("health reports remote history erase disabled by default", async () => {
  const previous = process.env.ENABLE_REMOTE_HISTORY_ERASE;
  delete process.env.ENABLE_REMOTE_HISTORY_ERASE;
  try {
    const response = await requestPath("/api/health");
    assert.equal(response.status, 200);
    const data = JSON.parse(response.body.toString("utf8"));
    assert.equal(data.remoteHistoryEraseEnabled, false);
  } finally {
    if (previous === undefined) {
      delete process.env.ENABLE_REMOTE_HISTORY_ERASE;
    } else {
      process.env.ENABLE_REMOTE_HISTORY_ERASE = previous;
    }
  }
});

test("health exposes remote history erase when feature flag is enabled", async () => {
  const previous = process.env.ENABLE_REMOTE_HISTORY_ERASE;
  process.env.ENABLE_REMOTE_HISTORY_ERASE = "true";
  try {
    const response = await requestPath("/api/health");
    assert.equal(response.status, 200);
    const data = JSON.parse(response.body.toString("utf8"));
    assert.equal(data.remoteHistoryEraseEnabled, true);
  } finally {
    if (previous === undefined) {
      delete process.env.ENABLE_REMOTE_HISTORY_ERASE;
    } else {
      process.env.ENABLE_REMOTE_HISTORY_ERASE = previous;
    }
  }
});
