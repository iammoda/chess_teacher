import test from "node:test";
import assert from "node:assert/strict";
import { createApiClient, ApiError } from "../lib/api-client.mjs";

function fakeFetch(status, body) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { impl, calls };
}

test("syncOp posts JSON with the bearer token", async () => {
  const { impl, calls } = fakeFetch(200, { ok: true });
  const api = createApiClient({ getToken: () => "session-token", fetchImpl: impl });

  const result = await api.syncOp({ op: "insert", table: "moves", rows: [{ san: "e4" }] });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0].url, "/api/sync");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Authorization"], "Bearer session-token");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), { op: "insert", table: "moves", rows: [{ san: "e4" }] });
});

test("requests omit the auth header when signed out", async () => {
  const { impl, calls } = fakeFetch(200, {});
  const api = createApiClient({ getToken: () => null, fetchImpl: impl });

  await api.health();

  assert.equal(calls[0].url, "/api/health");
  assert.equal(calls[0].init.headers["Authorization"], undefined);
});

test("server errors surface as ApiError with status and message", async () => {
  const { impl } = fakeFetch(401, { error: "Sign in required." });
  const api = createApiClient({ getToken: () => "stale", fetchImpl: impl });

  await assert.rejects(
    () => api.accountDelete(),
    (error) => error instanceof ApiError && error.status === 401 && /sign in/i.test(error.message),
  );
});

test("authedFetch merges caller headers with the token", async () => {
  const { impl, calls } = fakeFetch(200, {});
  const api = createApiClient({ getToken: () => "tok", fetchImpl: impl });

  await api.authedFetch("/api/coach/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  assert.equal(calls[0].init.headers["Authorization"], "Bearer tok");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.equal(calls[0].init.method, "POST");
});

test("health can request the deep check", async () => {
  const { impl, calls } = fakeFetch(200, { openaiConfigured: true });
  const api = createApiClient({ getToken: () => null, fetchImpl: impl });
  await api.health(true);
  assert.equal(calls[0].url, "/api/health?check=1");
});
