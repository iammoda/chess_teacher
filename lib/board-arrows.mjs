// SVG arrow overlay geometry for the chess board. Pure functions: callers
// pass flip state; output is SVG markup in an 8x8 viewBox that scales with
// the board. Arrows point from square center to square center, shortened so
// heads don't cover pieces on the destination square.

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

// Center of a square in 8x8 viewBox units, honoring board orientation.
export function squareCenter(square, flipped) {
  const fileIndex = FILES.indexOf(square[0]);
  const rankIndex = Number(square[1]) - 1;
  if (fileIndex < 0 || Number.isNaN(rankIndex)) return null;
  const x = flipped ? 7 - fileIndex : fileIndex;
  const y = flipped ? rankIndex : 7 - rankIndex;
  return { x: x + 0.5, y: y + 0.5 };
}

// One arrow as an SVG <g>. kind: "best" | "played" | "coach" | "replay".
export function arrowSvg({ from, to, flipped, kind = "best" }) {
  const start = squareCenter(from, flipped);
  const end = squareCenter(to, flipped);
  if (!start || !end || (start.x === end.x && start.y === end.y)) return "";

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;

  const tailOffset = 0.32; // start away from the piece on the origin square
  const headLength = 0.34;
  const headWidth = 0.36;
  const shaftWidth = 0.16;
  const tipPullback = 0.18; // stop short of the destination center

  const sx = start.x + ux * tailOffset;
  const sy = start.y + uy * tailOffset;
  const tipX = end.x - ux * tipPullback;
  const tipY = end.y - uy * tipPullback;
  const baseX = tipX - ux * headLength;
  const baseY = tipY - uy * headLength;
  // Perpendicular unit vector for head wings.
  const px = -uy;
  const py = ux;

  const head = [
    `${tipX},${tipY}`,
    `${baseX + px * headWidth / 2},${baseY + py * headWidth / 2}`,
    `${baseX - px * headWidth / 2},${baseY - py * headWidth / 2}`,
  ].join(" ");

  return `
    <g class="board-arrow arrow-${kind}">
      <line x1="${sx}" y1="${sy}" x2="${baseX}" y2="${baseY}" stroke-width="${shaftWidth}" stroke-linecap="round"></line>
      <polygon points="${head}"></polygon>
    </g>
  `;
}

// Full overlay markup for a list of arrows: [{from, to, kind}].
export function arrowsOverlaySvg(arrows, flipped) {
  const body = (arrows || [])
    .filter((arrow) => arrow?.from && arrow?.to)
    .map((arrow) => arrowSvg({ ...arrow, flipped }))
    .join("");
  return body;
}

// Parse a UCI move string into an arrow spec.
export function uciToArrow(uci, kind = "best") {
  if (!uci || uci.length < 4) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), kind };
}
