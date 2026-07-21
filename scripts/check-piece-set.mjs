// Validates a chess piece-set folder before it ships, and generates a
// preview sheet so the art can be judged in seconds.
//
// Usage:
//   node scripts/check-piece-set.mjs vendor/pieces/my-set
//
// Checks per file: canonical name, parseable standalone SVG, square viewBox,
// no scripts / external refs / rasters / text elements, sane size. On success
// writes preview.html into the folder: every piece in both colors on every
// board theme at board size and capture-tray size.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const PIECE_SPRITES = ["wP", "wN", "wB", "wR", "wQ", "wK", "bP", "bN", "bB", "bR", "bQ", "bK"]
  .map((piece) => `${piece}.svg`);

export const MAX_SPRITE_BYTES = 30_000;

// Mirrors the palettes in styles.css so the preview matches the app.
const BOARD_THEMES = [
  { key: "slate", light: "#dee3e6", dark: "#8ca2ad" },
  { key: "walnut", light: "#f0d9b5", dark: "#b58863" },
  { key: "green", light: "#eeeed2", dark: "#769656" },
  { key: "ocean", light: "#e6eef5", dark: "#88a8c3" },
  { key: "rosewood", light: "#f0e0dd", dark: "#ab7168" },
  { key: "candy", light: "#fdf1f7", dark: "#eda3c9" },
  { key: "nebula", light: "#6b7a99", dark: "#3d4a66" },
  { key: "middle-realm", light: "#e8e0c0", dark: "#7d8a5c" },
];

// Returns an array of problem strings (empty = valid).
export function validateSpriteContent(name, content) {
  const problems = [];
  const text = String(content || "");

  if (!text.trim()) {
    problems.push(`${name}: file is empty`);
    return problems;
  }
  if (Buffer.byteLength(text, "utf8") > MAX_SPRITE_BYTES) {
    problems.push(`${name}: larger than ${Math.round(MAX_SPRITE_BYTES / 1000)}KB — simplify the artwork`);
  }
  if (!/<svg[\s>]/i.test(text)) {
    problems.push(`${name}: not an SVG document`);
    return problems;
  }

  const viewBoxMatch = text.match(/viewBox\s*=\s*["']\s*([\d.+-]+)[\s,]+([\d.+-]+)[\s,]+([\d.+-]+)[\s,]+([\d.+-]+)\s*["']/i);
  if (!viewBoxMatch) {
    problems.push(`${name}: missing a viewBox attribute`);
  } else {
    const width = Number(viewBoxMatch[3]);
    const height = Number(viewBoxMatch[4]);
    if (!(width > 0 && height > 0)) {
      problems.push(`${name}: viewBox has non-positive dimensions`);
    } else if (Math.abs(width - height) > width * 0.02) {
      problems.push(`${name}: viewBox must be square (got ${width}x${height}) so pieces align on squares`);
    }
  }

  if (/<script[\s>]/i.test(text)) problems.push(`${name}: contains a <script> element`);
  if (/<image[\s>]/i.test(text)) problems.push(`${name}: contains an embedded raster <image>`);
  if (/<text[\s>]/i.test(text)) problems.push(`${name}: contains <text> — convert lettering to paths`);
  if (/(?:href|xlink:href)\s*=\s*["']\s*(?:https?:)?\/\//i.test(text)) {
    problems.push(`${name}: references an external URL — sprites must be self-contained`);
  }
  if (/on[a-z]+\s*=\s*["']/i.test(text)) problems.push(`${name}: contains inline event handlers`);

  return problems;
}

// files: Map/object of filename -> content. Returns { ok, problems, missing }.
export function validatePieceSet(files) {
  const lookup = files instanceof Map ? Object.fromEntries(files) : (files || {});
  const missing = PIECE_SPRITES.filter((name) => !(name in lookup));
  const problems = [];
  for (const name of PIECE_SPRITES) {
    if (!(name in lookup)) continue;
    problems.push(...validateSpriteContent(name, lookup[name]));
  }
  return { ok: !missing.length && !problems.length, problems, missing };
}

export function buildPreviewHtml(setName) {
  const pieceCells = (size) => PIECE_SPRITES.map((file, index) => `
    <div class="cell" style="width:${size}px;height:${size}px">
      <img src="./${file}" alt="${file}" style="width:100%;height:100%" data-square="${index % 2 ? "dark" : "light"}">
    </div>
  `).join("");

  const themeRows = BOARD_THEMES.map((theme) => `
    <section>
      <h2>${theme.key}</h2>
      <div class="row" style="--light:${theme.light};--dark:${theme.dark}">${pieceCells(80)}</div>
      <div class="row small" style="--light:${theme.light};--dark:${theme.dark}">${pieceCells(20)}</div>
    </section>
  `).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Piece set preview — ${setName}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 24px; background: #f6f8fa; }
  h1 { font-size: 20px; } h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; color: #667; }
  .row { display: flex; margin-bottom: 4px; }
  .cell { display: grid; place-items: center; }
  .cell:nth-child(odd) { background: var(--light); }
  .cell:nth-child(even) { background: var(--dark); }
  .small .cell { outline: none; }
  section { margin-bottom: 20px; }
  p { color: #556; max-width: 640px; }
</style>
</head>
<body>
<h1>Piece set preview — ${setName}</h1>
<p>Every piece on alternating light/dark squares for each board theme, at board size (80px) and capture-tray size (20px). Check: silhouettes read at 20px, white pieces survive light squares, black pieces survive dark squares (especially Nebula).</p>
${themeRows}
</body>
</html>
`;
}

// ─────────── CLI ───────────

const isMain = process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname;

if (isMain) {
  const folder = process.argv[2];
  if (!folder) {
    console.error("Usage: node scripts/check-piece-set.mjs <folder-with-12-svgs>");
    process.exit(1);
  }

  const files = {};
  for (const name of PIECE_SPRITES) {
    const filePath = join(folder, name);
    if (existsSync(filePath)) files[name] = readFileSync(filePath, "utf8");
  }

  const { ok, problems, missing } = validatePieceSet(files);
  for (const name of missing) console.error(`MISSING  ${name}`);
  for (const problem of problems) console.error(`PROBLEM  ${problem}`);

  if (!ok) {
    console.error(`\n${missing.length + problems.length} issue(s). Fix and re-run.`);
    process.exit(1);
  }

  const setName = folder.replace(/\/+$/, "").split("/").pop();
  const previewPath = join(folder, "preview.html");
  writeFileSync(previewPath, buildPreviewHtml(setName));
  console.log(`All 12 sprites valid.`);
  console.log(`Preview written to ${previewPath} — open it in a browser.`);
  console.log(`Ship it: move the folder to vendor/pieces/${setName}/ and restart the server.`);
}
