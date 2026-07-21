// Imports a curated slice of the Lichess puzzle database (CC0, ~5M puzzles)
// into vendor/puzzles/lichess-pack.json for the Practice tab.
//
// Usage:
//   node scripts/import-lichess-puzzles.mjs --download          # stream from database.lichess.org
//   node scripts/import-lichess-puzzles.mjs path/to/puzzles.csv[.zst]
//
// Zero dependencies: Node's built-in zstd stream handles the .zst archive and
// the vendored chess.js verifies every puzzle before it is written. Selection
// is deterministic (popularity-ranked per rating-band/motif bucket), so
// re-running the import yields the same pack.
//
// CSV columns: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,
//              Themes,GameUrl,OpeningTags
// Lichess semantics: FEN is the position BEFORE the opponent's setup move;
// Moves[0] is that setup move, and the player answers from Moves[1] onward.
// The pack stores the position AFTER the setup move with the player to move.

import { createWriteStream, mkdirSync, openSync, readSync, closeSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get } from "node:https";
import { zstdDecompressSync } from "node:zlib";
import { Chess } from "../vendor/chess/chess.js";

const DATABASE_URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst";
const OUTPUT_PATH = new URL("../vendor/puzzles/lichess-pack.json", import.meta.url);

// Lichess theme -> the app's weakness/motif category vocabulary.
// Order matters: the first matching theme decides the puzzle's category.
const THEME_CATEGORIES = [
  ["mateIn1", "missed_mate"],
  ["mateIn2", "missed_mate"],
  ["backRankMate", "missed_mate"],
  ["fork", "missed_fork"],
  ["pin", "missed_pin"],
  ["skewer", "missed_skewer"],
  ["discoveredAttack", "discovered_attack"],
  ["hangingPiece", "hanging_piece"],
];

// Difficulty bands aligned with the app's 400-1800 training score range.
const RATING_BANDS = [
  { band: 1, min: 600, max: 899 },
  { band: 2, min: 900, max: 1199 },
  { band: 3, min: 1200, max: 1499 },
  { band: 4, min: 1500, max: 1799 },
];

const PUZZLES_PER_BUCKET = 6;
const MIN_POPULARITY = 85;
const MIN_PLAYS = 1000;
const MAX_RATING_DEVIATION = 90;
const MAX_SOLUTION_PLIES = 6; // setup + up to 5 solution plies

function bandFor(rating) {
  return RATING_BANDS.find(({ min, max }) => rating >= min && rating <= max)?.band || null;
}

function categoryFor(themes) {
  for (const [theme, category] of THEME_CATEGORIES) {
    if (themes.includes(theme)) return category;
  }
  return null;
}

// Applies the setup move and validates the full solution line with chess.js.
// Returns the normalized puzzle or null.
function buildPuzzle(row) {
  const [id, fen, movesField, ratingField, deviationField, popularityField, playsField, themesField, gameUrl] = row;
  const rating = Number(ratingField);
  const deviation = Number(deviationField);
  const popularity = Number(popularityField);
  const plays = Number(playsField);
  const moves = movesField.split(" ").filter(Boolean);
  const themes = themesField.split(" ").filter(Boolean);

  if (!Number.isFinite(rating) || deviation > MAX_RATING_DEVIATION) return null;
  if (popularity < MIN_POPULARITY || plays < MIN_PLAYS) return null;
  if (moves.length < 2 || moves.length > MAX_SOLUTION_PLIES || moves.length % 2 !== 0) return null;

  const band = bandFor(rating);
  if (!band) return null;

  const category = categoryFor(themes);
  if (!category) return null;

  let game;
  try {
    game = new Chess(fen);
  } catch {
    return null;
  }

  const [setupUci, ...solutionLine] = moves;
  for (const [index, uci] of moves.entries()) {
    const move = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    if (!move) return null;
    if (index === 0) {
      row.startFen = game.fen();
    }
  }

  const startFen = row.startFen;
  return {
    id: `lichess-${id}`,
    lichessId: id,
    category,
    themes: themes.filter((theme) => !["short", "long", "oneMove", "advantage", "crushing", "equality"].includes(theme)).slice(0, 5),
    rating,
    band,
    popularity,
    playerColor: startFen.split(" ")[1],
    fen: startFen,
    setupUci,
    solutionLine,
    gameUrl: gameUrl || "",
  };
}

// Downloads the archive to a temp file (resumable across runs) and returns its path.
async function ensureArchive() {
  const arg = process.argv[2];
  if (arg && arg !== "--download") {
    console.log(`Reading ${arg} ...`);
    return arg;
  }

  const target = join(tmpdir(), "lichess_db_puzzle.csv.zst");
  const expectedSize = await new Promise((resolve, reject) => {
    const req = get(DATABASE_URL, { method: "HEAD" }, (res) => {
      res.resume();
      resolve(Number(res.headers["content-length"]) || 0);
    });
    req.on("error", reject);
  });

  if (existsSync(target) && statSync(target).size === expectedSize && expectedSize > 0) {
    console.log(`Using cached archive at ${target}`);
    return target;
  }

  console.log(`Downloading ${DATABASE_URL} (${Math.round(expectedSize / 1e6)} MB) ...`);
  await new Promise((resolve, reject) => {
    get(DATABASE_URL, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }
      const out = createWriteStream(target);
      let received = 0;
      let lastLogged = 0;
      res.on("data", (chunk) => {
        received += chunk.length;
        if (received - lastLogged >= 50_000_000) {
          lastLogged = received;
          console.log(`  downloaded ${Math.round(received / 1e6)} / ${Math.round(expectedSize / 1e6)} MB...`);
        }
      });
      res.pipe(out);
      out.on("finish", resolve);
      out.on("error", reject);
      res.on("error", reject);
    }).on("error", reject);
  });
  return target;
}

// The archive is zstd's *seekable* format: thousands of independent frames
// (Node's streaming decoder stops after the first) plus skippable frames for
// the seek table. Walk the file frame by frame: parse each frame header for
// its compressed size, decompress it synchronously, and hand complete CSV
// lines to the callback.
const ZSTD_MAGIC = 0xfd2fb528;
const SKIPPABLE_MIN = 0x184d2a50;
const SKIPPABLE_MAX = 0x184d2a5f;

function forEachCsvLine(path, onLine) {
  const fd = openSync(path, "r");
  const fileSize = statSync(path).size;
  let offset = 0;
  let carry = "";
  let frames = 0;

  const readAt = (position, length) => {
    const buffer = Buffer.alloc(length);
    const bytes = readSync(fd, buffer, 0, length, position);
    return buffer.subarray(0, bytes);
  };

  while (offset < fileSize - 4) {
    const magic = readAt(offset, 4).readUInt32LE(0);

    if (magic >= SKIPPABLE_MIN && magic <= SKIPPABLE_MAX) {
      const size = readAt(offset + 4, 4).readUInt32LE(0);
      offset += 8 + size;
      continue;
    }
    if (magic !== ZSTD_MAGIC) {
      throw new Error(`Unknown frame magic 0x${magic.toString(16)} at offset ${offset}`);
    }

    let decompressed;
    try {
      const frameSize = zstdFrameCompressedSize(readAt, offset, fileSize);
      decompressed = zstdDecompressSync(readAt(offset, frameSize));
      offset += frameSize;
    } catch (error) {
      // A truncated final frame (partial download / test slice): stop cleanly
      // with everything read so far.
      console.log(`  (stopping at truncated frame near offset ${offset}: ${error.message})`);
      break;
    }
    frames += 1;

    const text = carry + decompressed.toString("utf8");
    const lines = text.split("\n");
    carry = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  }
  if (carry) onLine(carry);
  closeSync(fd);
  return frames;
}

// Computes a zstd frame's total compressed size by walking its block headers.
// Frame: magic(4) + frame_header(2-14) + blocks + optional checksum(4).
function zstdFrameCompressedSize(readAt, frameStart, fileSize) {
  const descriptor = readAt(frameStart + 4, 1)[0];
  const dictIdFlag = descriptor & 0b11;
  const contentChecksum = (descriptor >> 2) & 1;
  const singleSegment = (descriptor >> 5) & 1;
  const fcsFlag = (descriptor >> 6) & 0b11;

  const dictIdSize = [0, 1, 2, 4][dictIdFlag];
  let fcsSize = [singleSegment ? 1 : 0, 2, 4, 8][fcsFlag];
  const windowDescriptorSize = singleSegment ? 0 : 1;

  let cursor = frameStart + 4 + 1 + windowDescriptorSize + dictIdSize + fcsSize;

  // Walk blocks: header(3) = last_block(1) | block_type(2) | block_size(21).
  for (;;) {
    if (cursor + 3 > fileSize) throw new Error("Truncated zstd frame");
    const header = readAt(cursor, 3);
    const bits = header[0] | (header[1] << 8) | (header[2] << 16);
    const lastBlock = bits & 1;
    const blockType = (bits >> 1) & 0b11;
    const blockSize = bits >> 3;
    cursor += 3 + (blockType === 1 ? 1 : blockSize); // RLE blocks store 1 byte
    if (lastBlock) break;
  }
  if (contentChecksum) cursor += 4;
  return cursor - frameStart;
}

const buckets = new Map(); // `${band}:${category}` -> puzzle[] (kept sorted by popularity)

function bucketKey(puzzle) {
  return `${puzzle.band}:${puzzle.category}`;
}

function considerPuzzle(puzzle) {
  const key = bucketKey(puzzle);
  const bucket = buckets.get(key) || [];
  bucket.push(puzzle);
  // Deterministic rank: popularity desc, plays via rating asc tiebreak, id.
  bucket.sort((a, b) => b.popularity - a.popularity || a.rating - b.rating || a.lichessId.localeCompare(b.lichessId));
  buckets.set(key, bucket.slice(0, PUZZLES_PER_BUCKET));
}

const archivePath = await ensureArchive();

let scanned = 0;
let candidates = 0;
let header = true;

const isCsv = archivePath.endsWith(".csv");
const handleLine = (line) => {
  if (header) {
    header = false;
    return;
  }
  if (!line) return;
  scanned += 1;
  if (scanned % 500_000 === 0) console.log(`  scanned ${scanned.toLocaleString()} rows...`);

  // The puzzle CSV has no quoted fields; plain split is safe.
  const row = line.split(",");
  if (row.length < 9) return;

  const puzzle = buildPuzzle(row);
  if (!puzzle) return;
  candidates += 1;
  considerPuzzle(puzzle);
};

if (isCsv) {
  const { createReadStream } = await import("node:fs");
  const { createInterface } = await import("node:readline");
  await new Promise((resolve, reject) => {
    const lines = createInterface({ input: createReadStream(archivePath), crlfDelay: Infinity });
    lines.on("line", handleLine);
    lines.on("close", resolve);
    lines.on("error", reject);
  });
} else {
  const frames = forEachCsvLine(archivePath, handleLine);
  console.log(`  decompressed ${frames.toLocaleString()} zstd frames`);
}

const puzzles = [...buckets.values()].flat()
  .sort((a, b) => a.band - b.band || a.category.localeCompare(b.category) || b.popularity - a.popularity);

if (!puzzles.length) {
  console.error("No puzzles matched the filters — nothing written.");
  process.exit(1);
}

mkdirSync(new URL("../vendor/puzzles/", import.meta.url), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify({
  source: "Lichess puzzle database (CC0) — https://database.lichess.org",
  license: "CC0-1.0",
  generatedAt: new Date().toISOString(),
  filters: {
    minPopularity: MIN_POPULARITY,
    minPlays: MIN_PLAYS,
    maxRatingDeviation: MAX_RATING_DEVIATION,
    perBucket: PUZZLES_PER_BUCKET,
  },
  puzzles,
}, null, 2)}\n`);

console.log(`Scanned ${scanned.toLocaleString()} rows, ${candidates.toLocaleString()} candidates.`);
console.log(`Wrote ${puzzles.length} puzzles to ${OUTPUT_PATH.pathname}`);
for (const { band } of RATING_BANDS) {
  const count = puzzles.filter((p) => p.band === band).length;
  console.log(`  band ${band}: ${count}`);
}
