const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable, Writable } = require("node:stream");
const { handleRequest, resolvePublicFile, __setSupabaseFetchForTests } = require("../server");

// Requiring server.js loads the developer's real .env, which may configure
// Supabase. Tests need a deterministic unconfigured baseline; withSupabase()
// opts individual tests back in with fake values.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_PUBLISHABLE_KEY;

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

test("piece sets are discovered, served, and reported by health", async () => {
  const health = await requestPath("/api/health");
  const data = JSON.parse(health.body.toString("utf8"));
  assert.ok(Array.isArray(data.pieceSets));
  assert.ok(data.pieceSets.includes("merida"), "merida discovered");
  assert.ok(data.pieceSets.includes("fantasy"), "fantasy discovered");

  const sprite = await requestPath("/vendor/pieces/fantasy/wK.svg");
  assert.equal(sprite.status, 200);
  assert.match(sprite.headers["Content-Type"] || "", /image\/svg\+xml/);

  // Only the 12 canonical sprites are served — licenses stay repo-only.
  const license = await requestPath("/vendor/pieces/fantasy/LICENSE.md");
  assert.equal(license.status, 404);
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

// ─────────── Auth + sync endpoints ───────────

const TEST_USER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TEST_GAME_ID = "6f9619ff-8b86-d011-b42d-00c04fc964ff";

function request(path, { method = "GET", headers = {}, payload } = {}) {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? null : JSON.stringify(payload);
    const req = new Readable({
      read() {
        if (body !== null) this.push(body);
        this.push(null);
      },
    });
    req.method = method;
    req.url = path;
    req.headers = { host: "localhost", ...headers };
    req.socket = { remoteAddress: `test-${Math.random()}` };

    const chunks = [];
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    res.writeHead = (status, resHeaders) => {
      res.statusCode = status;
      res.headers = resHeaders || {};
      return res;
    };
    res.on("finish", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let parsed = null;
      try { parsed = raw ? JSON.parse(raw) : null; } catch { /* non-JSON body */ }
      resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw });
    });
    res.on("error", reject);

    Promise.resolve(handleRequest(req, res)).catch(reject);
  });
}

// Runs `run` with Supabase env configured and a fake Supabase backend.
// `routes` maps URL substrings to handler(url, init) → Response.
async function withSupabase(routes, run) {
  const previous = {
    url: process.env.SUPABASE_URL,
    service: process.env.SUPABASE_SERVICE_ROLE_KEY,
    publishable: process.env.SUPABASE_PUBLISHABLE_KEY,
  };
  process.env.SUPABASE_URL = "https://unit-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_unit_test";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_unit_test";

  const calls = [];
  __setSupabaseFetchForTests(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [needle, handler] of Object.entries(routes)) {
      if (String(url).includes(needle)) return handler(String(url), init);
    }
    throw new Error(`Unexpected Supabase request in test: ${url}`);
  });

  try {
    return await run(calls);
  } finally {
    __setSupabaseFetchForTests(null);
    for (const [key, envName] of [["url", "SUPABASE_URL"], ["service", "SUPABASE_SERVICE_ROLE_KEY"], ["publishable", "SUPABASE_PUBLISHABLE_KEY"]]) {
      if (previous[key] === undefined) delete process.env[envName];
      else process.env[envName] = previous[key];
    }
  }
}

function authOk() {
  return new Response(JSON.stringify({ id: TEST_USER_ID, email: "test@example.com" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("health reports auth requirements from supabase configuration", async () => {
  const unconfigured = await request("/api/health");
  assert.equal(unconfigured.body.authRequired, false);
  assert.equal(unconfigured.body.supabaseAuth, null);

  await withSupabase({}, async () => {
    const response = await request("/api/health");
    assert.equal(response.body.authRequired, true);
    assert.equal(response.body.syncConfigured, true);
    assert.equal(response.body.supabaseAuth.url, "https://unit-test.supabase.co");
    assert.equal(response.body.supabaseAuth.publishableKey, "sb_publishable_unit_test");
  });
});

test("sync endpoint reports unconfigured without supabase env", async () => {
  const response = await request("/api/sync", { method: "POST", payload: { op: "insert", table: "moves", rows: [{ san: "e4" }] } });
  assert.equal(response.status, 503);
  assert.match(response.body.error, /not configured/i);
});

test("sync endpoint requires a bearer token and a valid session", async () => {
  await withSupabase({
    "/auth/v1/user": () => new Response(JSON.stringify({ message: "invalid" }), { status: 401 }),
  }, async (calls) => {
    const missing = await request("/api/sync", { method: "POST", payload: {} });
    assert.equal(missing.status, 401);
    assert.match(missing.body.error, /sign in/i);
    assert.equal(calls.length, 0, "no auth call should happen without a token");

    const invalid = await request("/api/sync", {
      method: "POST",
      headers: { authorization: "Bearer expired-token" },
      payload: {},
    });
    assert.equal(invalid.status, 401);
    assert.match(invalid.body.error, /expired/i);
  });
});

test("sync insert stamps the verified user id onto every row", async () => {
  await withSupabase({
    "/auth/v1/user": authOk,
    "/rest/v1/moves": () => new Response(null, { status: 201 }),
  }, async (calls) => {
    const response = await request("/api/sync", {
      method: "POST",
      headers: { authorization: "Bearer good-token" },
      payload: {
        op: "insert",
        table: "moves",
        rows: [{ id: TEST_GAME_ID, san: "e4", user_id: "spoofed-user" }],
      },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true });

    const insert = calls.find((call) => call.url.includes("/rest/v1/moves"));
    const rows = JSON.parse(insert.init.body);
    assert.equal(rows[0].user_id, TEST_USER_ID, "server must stamp the verified user id");
    assert.equal(rows[0].san, "e4");
  });
});

test("sync upsert on a primary key falls back to a user-scoped update on conflict", async () => {
  await withSupabase({
    "/auth/v1/user": authOk,
    "/rest/v1/games": (url, init) => {
      if (init.method === "POST") return new Response("duplicate key", { status: 409 });
      return new Response(null, { status: 204 });
    },
  }, async (calls) => {
    const response = await request("/api/sync", {
      method: "POST",
      headers: { authorization: "Bearer good-token" },
      payload: {
        op: "upsert",
        table: "games",
        rows: [{ id: TEST_GAME_ID, status: "in_progress", player_color: "w" }],
      },
    });

    assert.equal(response.status, 200);
    const patch = calls.find((call) => call.init.method === "PATCH");
    assert.ok(patch, "conflict should trigger a PATCH");
    assert.match(patch.url, new RegExp(`id=eq\\.${TEST_GAME_ID}`));
    assert.match(patch.url, new RegExp(`user_id=eq\\.${TEST_USER_ID}`));
    const body = JSON.parse(patch.init.body);
    assert.equal(body.id, undefined, "patch must not reassign the row id");
    assert.equal(body.user_id, undefined, "patch must not reassign ownership");
  });
});

test("sync rejects invalid payloads for signed-in users", async () => {
  await withSupabase({ "/auth/v1/user": authOk }, async () => {
    const response = await request("/api/sync", {
      method: "POST",
      headers: { authorization: "Bearer good-token" },
      payload: { op: "delete", table: "games", rows: [{}] },
    });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /not allowed/);
  });
});

test("coach chat requires sign-in when supabase auth is configured", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  try {
    await withSupabase({}, async () => {
      const response = await request("/api/coach/chat", {
        method: "POST",
        payload: { event: "user_message", messages: [], game: { fen: "x" } },
      });
      assert.equal(response.status, 401);
    });
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("account delete clears every table for the signed-in user only", async () => {
  const deletedTables = [];
  await withSupabase({
    "/auth/v1/user": authOk,
    "/rest/v1/": (url, init) => {
      if (init.method === "DELETE") {
        deletedTables.push(url.match(/rest\/v1\/([a-z_]+)\?/)[1]);
        assert.match(url, new RegExp(`user_id=eq\\.${TEST_USER_ID}`));
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected method ${init.method}`);
    },
  }, async () => {
    const response = await request("/api/account/data", {
      method: "DELETE",
      headers: { authorization: "Bearer good-token" },
    });
    assert.equal(response.status, 200);
    assert.ok(deletedTables.includes("games"));
    assert.ok(deletedTables.includes("moves"));
    assert.ok(deletedTables.includes("coach_memory"));
    assert.ok(deletedTables.indexOf("moves") < deletedTables.indexOf("games"), "children before parents");
  });
});

test("account export returns the user's rows grouped by table", async () => {
  await withSupabase({
    "/auth/v1/user": authOk,
    "/rest/v1/": (url) => {
      const table = url.match(/rest\/v1\/([a-z_]+)\?/)[1];
      const rows = table === "games" ? [{ id: TEST_GAME_ID, user_id: TEST_USER_ID }] : [];
      return new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  }, async () => {
    const response = await request("/api/account/export", {
      headers: { authorization: "Bearer good-token" },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers["Content-Disposition"] || "", /attachment/);
    assert.equal(response.body.userId, TEST_USER_ID);
    assert.deepEqual(response.body.tables.games, [{ id: TEST_GAME_ID, user_id: TEST_USER_ID }]);
    assert.deepEqual(response.body.tables.moves, []);
  });
});
