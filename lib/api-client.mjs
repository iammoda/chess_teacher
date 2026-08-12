// Browser-side client for the server API. All cloud traffic flows through
// these helpers so the access token is attached in exactly one place.
// Pure data-shaping + fetch wiring; injectable fetch for unit tests.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status || 0;
  }
}

export function createApiClient({ getToken, fetchImpl } = {}) {
  const doFetch = (...args) => (fetchImpl || fetch)(...args);

  async function authHeaders() {
    const token = typeof getToken === "function" ? await getToken() : null;
    return token ? { "Authorization": `Bearer ${token}` } : {};
  }

  // Drop-in fetch replacement that attaches the session token. Used for the
  // coach chat endpoints, which manage their own request/response shapes.
  async function authedFetch(input, init = {}) {
    const headers = { ...(init.headers || {}), ...(await authHeaders()) };
    return doFetch(input, { ...init, headers });
  }

  async function requestJson(path, { method = "GET", payload, timeoutMs } = {}) {
    const headers = await authHeaders();
    if (payload !== undefined) headers["Content-Type"] = "application/json";

    // A hanging request (not failing — hanging) would stall callers forever;
    // boot awaits health, so it needs a bounded wait.
    let signal;
    if (Number.isFinite(timeoutMs) && typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
      signal = AbortSignal.timeout(timeoutMs);
    }

    const response = await doFetch(path, {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiError(data.error || `Request failed with HTTP ${response.status}.`, response.status);
    }
    return data;
  }

  return {
    authedFetch,
    health: (check = false) => requestJson(`/api/health${check ? "?check=1" : ""}`, { timeoutMs: 12_000 }),
    syncOp: (payload) => requestJson("/api/sync", { method: "POST", payload }),
    accountExport: () => requestJson("/api/account/export"),
    accountDelete: () => requestJson("/api/account/data", { method: "DELETE" }),
  };
}
