import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as esm from "../lib/personas.mjs";

const require = createRequire(import.meta.url);
const cjs = require("../lib/personas.cjs");

// The persona catalog exists twice: personas.mjs for the browser and
// personas.cjs for server runtimes without require(esm) (e.g. Vercel).
// Any drift means the Settings UI and the actual LLM prompts disagree.

test("the browser and server persona catalogs are identical", () => {
  assert.deepEqual(cjs.COACH_PERSONAS, esm.COACH_PERSONAS,
    "lib/personas.cjs and lib/personas.mjs have drifted — edit both together");
  assert.deepEqual(cjs.PERSONA_KEYS, esm.PERSONA_KEYS);
});

test("both catalogs expose the same helper behavior", () => {
  for (const key of [...esm.PERSONA_KEYS, "nonsense", undefined]) {
    assert.deepEqual(cjs.getPersona(key), esm.getPersona(key), String(key));
    assert.equal(cjs.normalizePersonaKey(key), esm.normalizePersonaKey(key), String(key));
  }
});
