// Server-side Supabase access. Two responsibilities:
//   1. Verify user access tokens against Supabase Auth (with a small TTL cache
//      so chatty sync traffic doesn't ping the auth server per request).
//   2. Talk to PostgREST with the service role key. The browser never touches
//      the database; every row the server writes gets user_id stamped by the
//      caller (see server.js), and RLS denies every other role.
//
// Zero dependencies: plain fetch + node:crypto, injectable for tests.

const crypto = require("crypto");

const AUTH_TIMEOUT_MS = 8_000;
const REST_TIMEOUT_MS = 10_000;
const TOKEN_CACHE_TTL_MS = 5 * 60_000;
const TOKEN_CACHE_MAX = 2_000;

class SupabaseRequestError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "SupabaseRequestError";
    this.status = status || 0;
  }
}

function createSupabaseAdmin(options) {
  const url = String(options.url || "").replace(/\/+$/, "");
  const serviceKey = options.serviceKey || "";
  const publishableKey = options.publishableKey || "";
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;

  if (!url || !serviceKey) {
    throw new Error("createSupabaseAdmin requires url and serviceKey.");
  }

  // token hash -> { value: { userId, email }, until }
  const tokenCache = new Map();

  function pruneTokenCache() {
    if (tokenCache.size <= TOKEN_CACHE_MAX) return;
    const cutoff = now();
    for (const [key, entry] of tokenCache) {
      if (entry.until <= cutoff) tokenCache.delete(key);
    }
    while (tokenCache.size > TOKEN_CACHE_MAX) {
      const oldest = tokenCache.keys().next().value;
      tokenCache.delete(oldest);
    }
  }

  async function fetchWithTimeout(target, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(target, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  // Returns { userId, email } for a valid token, null for an invalid/expired
  // token, and throws SupabaseRequestError when the auth service is unreachable.
  async function verifyToken(token) {
    if (!token || typeof token !== "string") return null;

    const cacheKey = crypto.createHash("sha256").update(token).digest("hex");
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.until > now()) return cached.value;
    tokenCache.delete(cacheKey);

    let response;
    try {
      response = await fetchWithTimeout(`${url}/auth/v1/user`, {
        headers: {
          "apikey": publishableKey || serviceKey,
          "Authorization": `Bearer ${token}`,
        },
      }, AUTH_TIMEOUT_MS);
    } catch (error) {
      throw new SupabaseRequestError(
        error.name === "AbortError" ? "Auth check timed out." : "Auth service unreachable.",
        0,
      );
    }

    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) {
      throw new SupabaseRequestError(`Auth service returned HTTP ${response.status}.`, response.status);
    }

    const data = await response.json().catch(() => null);
    if (!data || !data.id) return null;

    const value = { userId: data.id, email: data.email || "" };
    tokenCache.set(cacheKey, { value, until: now() + TOKEN_CACHE_TTL_MS });
    pruneTokenCache();
    return value;
  }

  async function restRequest(method, pathAndQuery, { body, prefer } = {}) {
    const headers = {
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (prefer) headers["Prefer"] = prefer;

    let response;
    try {
      response = await fetchWithTimeout(`${url}/rest/v1/${pathAndQuery}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }, REST_TIMEOUT_MS);
    } catch (error) {
      throw new SupabaseRequestError(
        error.name === "AbortError" ? "Database request timed out." : "Database unreachable.",
        0,
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new SupabaseRequestError(
        `Database returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : "."}`,
        response.status,
      );
    }
    return response;
  }

  async function insert(table, rows) {
    await restRequest("POST", encodeURIComponent(table), {
      body: rows,
      prefer: "return=minimal",
    });
  }

  async function upsert(table, rows, onConflictColumns) {
    const conflict = encodeURIComponent((onConflictColumns || []).join(","));
    await restRequest("POST", `${encodeURIComponent(table)}?on_conflict=${conflict}`, {
      body: rows,
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  }

  async function update(table, { id, userId, patch }) {
    const query = `${encodeURIComponent(table)}?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`;
    // return=representation so a PATCH matching zero rows (row never synced,
    // or belongs to another user) is a detectable failure instead of a silent
    // no-op that reports success to the client.
    const response = await restRequest("PATCH", query, {
      body: patch,
      prefer: "return=representation",
    });
    const updated = await response.json().catch(() => null);
    if (Array.isArray(updated) && updated.length === 0) {
      throw new SupabaseRequestError("Update matched no rows.", 404);
    }
  }

  async function deleteForUser(table, userId) {
    await restRequest("DELETE", `${encodeURIComponent(table)}?user_id=eq.${encodeURIComponent(userId)}`);
  }

  async function selectForUser(table, userId, { limit = 10_000, offset = 0 } = {}) {
    const query = `${encodeURIComponent(table)}?select=*&user_id=eq.${encodeURIComponent(userId)}&limit=${limit}&offset=${offset}&order=id.asc`;
    const response = await restRequest("GET", query);
    return await response.json();
  }

  // Fetches every row for a user, paginating so large accounts (a GDPR-style
  // export must be complete) are never silently truncated.
  async function selectAllForUser(table, userId, { pageSize = 1_000, maxRows = 200_000 } = {}) {
    const all = [];
    for (let offset = 0; offset < maxRows; offset += pageSize) {
      const page = await selectForUser(table, userId, { limit: pageSize, offset });
      all.push(...page);
      if (!Array.isArray(page) || page.length < pageSize) break;
    }
    return all;
  }

  // Calls a Postgres function through PostgREST (service-role only).
  async function rpc(name, args) {
    const response = await restRequest("POST", `rpc/${encodeURIComponent(name)}`, { body: args || {} });
    return await response.json().catch(() => null);
  }

  // Cheap reachability probe used by /api/health?check=1.
  async function ping() {
    await restRequest("GET", "games?select=id&limit=1");
    return true;
  }

  return {
    verifyToken,
    insert,
    upsert,
    update,
    deleteForUser,
    selectForUser,
    selectAllForUser,
    rpc,
    ping,
    _tokenCacheSize: () => tokenCache.size,
  };
}

module.exports = { createSupabaseAdmin, SupabaseRequestError };
