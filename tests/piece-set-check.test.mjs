import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PIECE_SPRITES,
  validateSpriteContent,
  validatePieceSet,
  buildPreviewHtml,
} from "../scripts/check-piece-set.mjs";

const GOOD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#222"/></svg>`;

function fullSet(content = GOOD_SVG) {
  return Object.fromEntries(PIECE_SPRITES.map((name) => [name, content]));
}

test("a clean 12-sprite set validates", () => {
  const result = validatePieceSet(fullSet());
  assert.equal(result.ok, true);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.missing, []);
});

test("missing sprites are reported by name", () => {
  const files = fullSet();
  delete files["bQ.svg"];
  const result = validatePieceSet(files);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["bQ.svg"]);
});

test("unsafe or malformed sprites are rejected", () => {
  const cases = [
    ["empty", "", /empty/],
    ["not svg", "<html></html>", /not an SVG/],
    ["no viewbox", `<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`, /viewBox/],
    ["non-square", `<svg viewBox="0 0 100 60"><rect/></svg>`, /square/],
    ["script", `<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>`, /script/],
    ["raster", `<svg viewBox="0 0 10 10"><image href="a.png"/></svg>`, /raster/],
    ["text", `<svg viewBox="0 0 10 10"><text>K</text></svg>`, /convert lettering/],
    ["external", `<svg viewBox="0 0 10 10"><use href="https://evil.example/x.svg"/></svg>`, /external URL/],
    ["handler", `<svg viewBox="0 0 10 10"><rect onload="x()"/></svg>`, /event handlers/],
  ];
  for (const [label, content, pattern] of cases) {
    const problems = validateSpriteContent("wK.svg", content);
    assert.ok(problems.some((p) => pattern.test(p)), `${label}: ${problems.join("; ")}`);
  }
});

test("oversized sprites are flagged", () => {
  const big = `<svg viewBox="0 0 10 10">${"<!-- pad -->".repeat(3000)}</svg>`;
  const problems = validateSpriteContent("wK.svg", big);
  assert.ok(problems.some((p) => /larger than/.test(p)));
});

test("both vendored sets pass their own validator", () => {
  for (const set of ["merida", "fantasy"]) {
    const files = Object.fromEntries(PIECE_SPRITES.map((name) => [
      name,
      readFileSync(new URL(`../vendor/pieces/${set}/${name}`, import.meta.url), "utf8"),
    ]));
    const result = validatePieceSet(files);
    assert.equal(result.ok, true, `${set}: ${result.problems.join("; ")}`);
  }
});

test("the preview sheet renders every sprite on every theme", () => {
  const html = buildPreviewHtml("test-set");
  for (const name of PIECE_SPRITES) {
    assert.ok(html.includes(`./${name}`), name);
  }
  for (const theme of ["slate", "walnut", "nebula", "candy"]) {
    assert.ok(html.includes(`<h2>${theme}</h2>`), theme);
  }
});
