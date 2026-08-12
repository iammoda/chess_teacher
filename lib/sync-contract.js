// The single source of truth for what the browser may sync to the database.
// Every request to POST /api/sync is validated and sanitized here:
//   * only whitelisted tables and operations,
//   * only whitelisted columns (everything else is stripped — notably user_id,
//     which the server stamps itself after verifying the access token),
//   * updates are only addressable by row id (and the server additionally
//     filters on user_id so nobody can patch another user's rows).
//
// Upserts come in two safety flavors:
//   * conflict "id": performed as insert-then-scoped-update by the server so a
//     (theoretically) colliding id can never overwrite another user's row.
//   * per-user conflict keys (user_id, x): safe for PostgREST merge-duplicates
//     because the server stamps user_id into every row.

const MAX_ROWS_PER_REQUEST = 50;
const MAX_STRING_LENGTH = 40_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SYNC_TABLES = {
  games: {
    ops: ["upsert", "update"],
    conflict: ["id"],
    columns: [
      "id", "started_at", "ended_at", "player_color", "engine_level",
      "result", "opening_name", "opening_key", "pgn", "status",
    ],
  },
  moves: {
    ops: ["insert", "update"],
    columns: [
      "id", "game_id", "ply", "role", "color", "san", "uci", "piece", "captured",
      "fen_before", "fen_after", "classification", "tags", "note",
      "analysis_status", "engine_depth", "engine_source",
      "eval_before", "eval_after", "eval_delta", "mate_before", "mate_after",
      "best_move_uci", "best_move_san", "principal_variation",
      "quality_key", "quality_label", "quality_reason",
    ],
  },
  positions: {
    ops: ["insert"],
    columns: ["game_id", "move_id", "fen", "phase", "category", "tags", "prompt", "best_candidates"],
  },
  weaknesses: {
    ops: ["upsert"],
    conflict: ["user_id", "category"],
    columns: ["category", "label", "count", "severity", "last_seen", "examples", "updated_at"],
  },
  weakness_events: {
    ops: ["insert"],
    columns: ["game_id", "move_id", "category", "label", "severity", "fen", "note"],
  },
  practice_attempts: {
    ops: ["insert"],
    columns: ["exercise_id", "source_key", "fen", "chosen_move", "expected_moves", "result"],
  },
  reasoning_traces: {
    ops: ["insert"],
    columns: ["game_id", "ply", "fen", "san", "question", "answer", "coach_takeaway"],
  },
  coach_memory: {
    ops: ["insert"],
    columns: ["note", "source"],
  },
  skill_ratings: {
    ops: ["upsert"],
    conflict: ["user_id", "dimension"],
    columns: ["dimension", "rating", "perf", "samples", "confidence", "updated_at"],
  },
  repertoire_progress: {
    ops: ["upsert"],
    conflict: ["user_id", "line_id"],
    columns: ["line_id", "opening_id", "ease", "interval_days", "due_at", "reps", "lapses", "updated_at"],
  },
};

// FK-safe order for account-wide deletes; also the export order.
const ACCOUNT_DATA_TABLES = [
  "practice_attempts",
  "weakness_events",
  "positions",
  "moves",
  "reasoning_traces",
  "coach_memory",
  "skill_ratings",
  "repertoire_progress",
  "weaknesses",
  "exercises",
  "games",
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function validateValue(value) {
  if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
    return "a text value is too long";
  }
  // jsonb columns accept objects/arrays — measure them serialized, or nested
  // payloads (and strings hidden inside arrays) bypass the string cap and
  // bloat Postgres row by row.
  if (value !== null && typeof value === "object") {
    let serialized;
    try {
      serialized = JSON.stringify(value);
    } catch {
      return "a value could not be serialized";
    }
    if (typeof serialized !== "string" || serialized.length > MAX_STRING_LENGTH) {
      return "a structured value is too large";
    }
  }
  return null;
}

// Keep only whitelisted columns. Returns { row, error }.
function sanitizeRow(rawRow, columns) {
  if (!isPlainObject(rawRow)) return { error: "each row must be an object" };

  const row = {};
  for (const column of columns) {
    if (!(column in rawRow)) continue;
    const value = rawRow[column];
    if (value === undefined) continue;
    const valueError = validateValue(value);
    if (valueError) return { error: valueError };
    row[column] = value;
  }

  if (!Object.keys(row).length) return { error: "row has no recognized columns" };
  return { row };
}

// Validates and sanitizes a sync payload.
// Returns { error } or { op, table, rows, id, patch, conflict }.
function validateSyncPayload(payload) {
  if (!isPlainObject(payload)) return { error: "Sync payload must be an object." };

  // "ping" writes nothing: it exists so the client can verify the full sync
  // path (session token, server validation, database reachability) without
  // mutating any rows.
  if (payload.op === "ping") return { op: "ping" };

  const table = payload.table;
  const config = SYNC_TABLES[table];
  if (!config) return { error: "Unknown sync table." };

  const op = payload.op;
  if (!config.ops.includes(op)) return { error: `Operation ${JSON.stringify(op)} is not allowed for ${table}.` };

  if (op === "insert" || op === "upsert") {
    const rawRows = payload.rows;
    if (!Array.isArray(rawRows) || !rawRows.length) return { error: "rows must be a non-empty array." };
    if (rawRows.length > MAX_ROWS_PER_REQUEST) return { error: `rows is limited to ${MAX_ROWS_PER_REQUEST} entries.` };

    const rows = [];
    for (const rawRow of rawRows) {
      const { row, error } = sanitizeRow(rawRow, config.columns);
      if (error) return { error: `Invalid row for ${table}: ${error}.` };
      rows.push(row);
    }
    return { op, table, rows, conflict: config.conflict || null };
  }

  // update
  if (!isValidUuid(payload.id)) return { error: "update requires a valid row id." };
  const { row, error } = sanitizeRow(payload.patch, config.columns);
  if (error) return { error: `Invalid patch for ${table}: ${error}.` };
  // Never allow an update to reassign the row's identity.
  delete row.id;
  if (!Object.keys(row).length) return { error: `Invalid patch for ${table}: row has no recognized columns.` };
  return { op, table, id: payload.id, patch: row };
}

module.exports = {
  SYNC_TABLES,
  ACCOUNT_DATA_TABLES,
  MAX_ROWS_PER_REQUEST,
  validateSyncPayload,
  isValidUuid,
};
