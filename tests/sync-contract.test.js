const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SYNC_TABLES,
  ACCOUNT_DATA_TABLES,
  MAX_ROWS_PER_REQUEST,
  validateSyncPayload,
  isValidUuid,
} = require("../lib/sync-contract");

const GAME_ID = "6f9619ff-8b86-d011-b42d-00c04fc964ff";

test("rejects unknown tables and disallowed operations", () => {
  assert.match(validateSyncPayload({ op: "insert", table: "users", rows: [{}] }).error, /Unknown sync table/);
  assert.match(validateSyncPayload({ op: "delete", table: "games", rows: [{}] }).error, /not allowed/);
  assert.match(validateSyncPayload({ op: "insert", table: "games", rows: [{}] }).error, /not allowed/);
  assert.match(validateSyncPayload(null).error, /must be an object/);
});

test("insert strips unknown columns and never accepts user_id from the client", () => {
  const result = validateSyncPayload({
    op: "insert",
    table: "moves",
    rows: [{
      id: GAME_ID,
      san: "e4",
      user_id: "11111111-1111-1111-1111-111111111111",
      is_admin: true,
    }],
  });

  assert.equal(result.error, undefined);
  assert.deepEqual(result.rows, [{ id: GAME_ID, san: "e4" }]);
});

test("upsert reports the table's conflict target", () => {
  const weakness = validateSyncPayload({
    op: "upsert",
    table: "weaknesses",
    rows: [{ category: "hanging_piece", label: "Hanging pieces", count: 3 }],
  });
  assert.deepEqual(weakness.conflict, ["user_id", "category"]);

  const game = validateSyncPayload({
    op: "upsert",
    table: "games",
    rows: [{ id: GAME_ID, player_color: "w" }],
  });
  assert.deepEqual(game.conflict, ["id"]);
});

test("update requires a uuid id and strips id from the patch", () => {
  const badId = validateSyncPayload({ op: "update", table: "moves", id: "1; drop table moves", patch: { note: "x" } });
  assert.match(badId.error, /valid row id/);

  const result = validateSyncPayload({
    op: "update",
    table: "moves",
    id: GAME_ID,
    patch: { id: "22222222-2222-2222-2222-222222222222", note: "hmm", user_id: "x" },
  });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.patch, { note: "hmm" });

  const emptyPatch = validateSyncPayload({ op: "update", table: "moves", id: GAME_ID, patch: { bogus: 1 } });
  assert.match(emptyPatch.error, /no recognized columns/);
});

test("row count and string length limits hold", () => {
  const tooMany = validateSyncPayload({
    op: "insert",
    table: "coach_memory",
    rows: Array.from({ length: MAX_ROWS_PER_REQUEST + 1 }, () => ({ note: "n" })),
  });
  assert.match(tooMany.error, /limited to/);

  const tooLong = validateSyncPayload({
    op: "insert",
    table: "coach_memory",
    rows: [{ note: "x".repeat(50_000) }],
  });
  assert.match(tooLong.error, /too long/);

  const empty = validateSyncPayload({ op: "insert", table: "coach_memory", rows: [] });
  assert.match(empty.error, /non-empty array/);
});

test("jsonb columns pass structured values through", () => {
  const result = validateSyncPayload({
    op: "insert",
    table: "positions",
    rows: [{ game_id: GAME_ID, fen: "8/8", phase: "endgame", category: "tactic", tags: [{ label: "fork" }], best_candidates: ["Nf7"] }],
  });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.rows[0].tags, [{ label: "fork" }]);
});

test("every synced table appears in the account data list", () => {
  for (const table of Object.keys(SYNC_TABLES)) {
    assert.ok(ACCOUNT_DATA_TABLES.includes(table), `${table} missing from ACCOUNT_DATA_TABLES`);
  }
});

test("isValidUuid accepts uuids and rejects noise", () => {
  assert.ok(isValidUuid(GAME_ID));
  assert.ok(!isValidUuid("not-a-uuid"));
  assert.ok(!isValidUuid(123));
});

// ─────────── jsonb size caps (bug-fix pass) ───────────

test("oversized jsonb values are rejected, not passed through to Postgres", () => {
  const result = validateSyncPayload({
    table: "weaknesses",
    op: "upsert",
    rows: [{
      category: "hanging_piece",
      label: "Hanging pieces",
      count: 3,
      severity: 2,
      examples: [{ note: "A".repeat(60_000) }],
    }],
  });
  assert.match(result.error, /too large/);
});

test("strings hidden inside arrays cannot dodge the size cap", () => {
  const result = validateSyncPayload({
    table: "moves",
    op: "insert",
    rows: [{
      id: "6f9619ff-8b86-d011-b42d-00c04fc964ff",
      game_id: "6f9619ff-8b86-d011-b42d-00c04fc964aa",
      ply: 1,
      san: "e4",
      principal_variation: Array.from({ length: 60 }, () => "x".repeat(1000)),
    }],
  });
  assert.match(result.error, /too large/);
});

test("normal-sized structured values still pass", () => {
  const result = validateSyncPayload({
    table: "weaknesses",
    op: "upsert",
    rows: [{
      category: "hanging_piece",
      label: "Hanging pieces",
      count: 3,
      severity: 2,
      examples: [{ fen: "8/8/8/8/8/8/8/8 w - - 0 1", san: "Qxb2" }],
    }],
  });
  assert.equal(result.error, undefined);
  assert.equal(result.rows.length, 1);
});

test("ping is a valid, argument-free sync op", () => {
  assert.deepEqual(validateSyncPayload({ op: "ping" }), { op: "ping" });
  // Ping ignores stray fields — nothing else is honored.
  assert.deepEqual(validateSyncPayload({ op: "ping", table: "games", rows: [{}] }), { op: "ping" });
});
