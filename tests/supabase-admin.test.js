const test = require("node:test");
const assert = require("node:assert/strict");
const { createSupabaseAdmin, SupabaseRequestError } = require("../lib/supabase-admin");

const USER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls.length);
  };
  return { impl, calls };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeAdmin(handler, overrides = {}) {
  const { impl, calls } = fakeFetch(handler);
  const admin = createSupabaseAdmin({
    url: "https://project.supabase.co/",
    serviceKey: "sb_secret_test",
    publishableKey: "sb_publishable_test",
    fetchImpl: impl,
    ...overrides,
  });
  return { admin, calls };
}

test("verifyToken returns the user and caches by token", async () => {
  const { admin, calls } = makeAdmin(() => jsonResponse(200, { id: USER_ID, email: "p@q.r" }));

  const first = await admin.verifyToken("token-1");
  const second = await admin.verifyToken("token-1");

  assert.deepEqual(first, { userId: USER_ID, email: "p@q.r" });
  assert.deepEqual(second, first);
  assert.equal(calls.length, 1, "second lookup should be served from cache");
  assert.equal(calls[0].url, "https://project.supabase.co/auth/v1/user");
  assert.equal(calls[0].init.headers["Authorization"], "Bearer token-1");
  assert.equal(calls[0].init.headers["apikey"], "sb_publishable_test");
});

test("verifyToken cache expires", async () => {
  let currentTime = 1_000;
  const { admin, calls } = makeAdmin(
    () => jsonResponse(200, { id: USER_ID, email: "" }),
    { now: () => currentTime },
  );

  await admin.verifyToken("token-1");
  currentTime += 6 * 60_000; // past the 5 minute TTL
  await admin.verifyToken("token-1");

  assert.equal(calls.length, 2);
});

test("verifyToken returns null for rejected tokens and missing tokens", async () => {
  const { admin } = makeAdmin(() => jsonResponse(401, { message: "invalid" }));
  assert.equal(await admin.verifyToken("bad-token"), null);
  assert.equal(await admin.verifyToken(""), null);
  assert.equal(await admin.verifyToken(null), null);
});

test("verifyToken throws when the auth service errors or is unreachable", async () => {
  const { admin: erroring } = makeAdmin(() => jsonResponse(500, {}));
  await assert.rejects(() => erroring.verifyToken("t"), SupabaseRequestError);

  const { admin: offline } = makeAdmin(() => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(() => offline.verifyToken("t"), /unreachable/);
});

test("insert posts sanitized rows with the service key", async () => {
  const { admin, calls } = makeAdmin(() => new Response(null, { status: 201 }));
  await admin.insert("moves", [{ san: "e4" }]);

  assert.equal(calls[0].url, "https://project.supabase.co/rest/v1/moves");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["apikey"], "sb_secret_test");
  assert.equal(calls[0].init.headers["Authorization"], "Bearer sb_secret_test");
  assert.equal(calls[0].init.headers["Prefer"], "return=minimal");
  assert.deepEqual(JSON.parse(calls[0].init.body), [{ san: "e4" }]);
});

test("upsert sends merge-duplicates with the conflict target", async () => {
  const { admin, calls } = makeAdmin(() => new Response(null, { status: 201 }));
  await admin.upsert("weaknesses", [{ category: "x" }], ["user_id", "category"]);

  assert.equal(calls[0].url, "https://project.supabase.co/rest/v1/weaknesses?on_conflict=user_id%2Ccategory");
  assert.equal(calls[0].init.headers["Prefer"], "resolution=merge-duplicates,return=minimal");
});

test("update patches by id and user_id", async () => {
  const { admin, calls } = makeAdmin(() => new Response(null, { status: 204 }));
  await admin.update("moves", { id: "row-1", userId: USER_ID, patch: { note: "n" } });

  assert.equal(calls[0].url, `https://project.supabase.co/rest/v1/moves?id=eq.row-1&user_id=eq.${USER_ID}`);
  assert.equal(calls[0].init.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].init.body), { note: "n" });
});

test("deleteForUser and selectForUser scope to the user", async () => {
  const { admin, calls } = makeAdmin((url) => {
    if (url.includes("select=")) return jsonResponse(200, [{ id: "g1" }]);
    return new Response(null, { status: 204 });
  });

  await admin.deleteForUser("games", USER_ID);
  const rows = await admin.selectForUser("games", USER_ID, { limit: 5 });

  assert.equal(calls[0].url, `https://project.supabase.co/rest/v1/games?user_id=eq.${USER_ID}`);
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal(calls[1].url, `https://project.supabase.co/rest/v1/games?select=*&user_id=eq.${USER_ID}&limit=5`);
  assert.deepEqual(rows, [{ id: "g1" }]);
});

test("rest errors surface status and detail", async () => {
  const { admin } = makeAdmin(() => new Response("duplicate key", { status: 409 }));
  await assert.rejects(
    () => admin.insert("moves", [{ san: "e4" }]),
    (error) => error instanceof SupabaseRequestError && error.status === 409 && /duplicate key/.test(error.message),
  );
});

test("ping probes the games table", async () => {
  const { admin, calls } = makeAdmin(() => jsonResponse(200, []));
  await admin.ping();
  assert.equal(calls[0].url, "https://project.supabase.co/rest/v1/games?select=id&limit=1");
});
