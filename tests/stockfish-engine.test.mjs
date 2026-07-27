import { test } from "node:test";
import assert from "node:assert/strict";

// The engine class expects a browser-ish `window`.
globalThis.window = globalThis.window || {
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (...args) => clearTimeout(...args),
};

const { StockfishEngine } = await import("../lib/stockfish-engine.mjs");

function fakeEngine() {
  const engine = new StockfishEngine({ baseUrl: "/vendor/stockfish/", label: "test" });
  engine.ready = true;
  engine.posted = [];
  engine.worker = { postMessage: (command) => engine.posted.push(command), terminate() {} };
  return engine;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("timed-out search is stopped and drained so the next eval gets its own result", async () => {
  const engine = fakeEngine();

  // Search A times out (worker never answers).
  const resultA = await engine.evaluatePosition("fen-a", 12, { timeoutMs: 20 });
  assert.equal(resultA.bestMove, null, "timed-out search resolves with nulls");
  assert.ok(engine.posted.includes("stop"), "timeout posts stop to the worker");
  assert.ok(engine.drainPromise, "queue is held until the abandoned bestmove drains");

  // Search B is requested; it must NOT reach the worker while draining.
  const postedBefore = engine.posted.length;
  const runB = engine.evaluatePosition("fen-b", 12, { timeoutMs: 1000 });
  await wait(10);
  assert.equal(engine.posted.length, postedBefore, "next eval waits for the drain");

  // The abandoned search's bestmove arrives: swallowed, not delivered to B.
  engine.handleMessage("bestmove e2e4");
  await wait(10);
  assert.equal(engine.drainPromise, null, "drain released by the stale bestmove");
  assert.ok(
    engine.posted.includes("position fen fen-b"),
    "search B starts only after the stream re-synced",
  );

  // B's own answer arrives and is attributed to B.
  engine.handleMessage("info depth 12 score cp 42 pv d2d4");
  engine.handleMessage("bestmove d2d4");
  const resultB = await runB;
  assert.equal(resultB.bestMove, "d2d4", "B receives its own bestmove, not the stale one");
  assert.equal(resultB.scoreCp, 42);
});

test("normal searches resolve without engaging the drain", async () => {
  const engine = fakeEngine();
  const run = engine.evaluatePosition("fen-a", 10, { timeoutMs: 1000 });
  await wait(5); // let the queued eval register its pending handler
  engine.handleMessage("info depth 10 score cp -15 pv e7e5");
  engine.handleMessage("bestmove e7e5");
  const result = await run;
  assert.equal(result.bestMove, "e7e5");
  assert.equal(result.scoreCp, -15);
  assert.equal(engine.drainPromise, null);
  assert.ok(!engine.posted.includes("stop"));
});

test("destroy releases a pending drain so queued evals cannot deadlock", async () => {
  const engine = fakeEngine();
  await engine.evaluatePosition("fen-a", 12, { timeoutMs: 20 });
  assert.ok(engine.drainPromise);
  const drained = engine.drainPromise;
  engine.destroy();
  assert.equal(engine.drainPromise, null);
  await drained; // must already be resolved — this would hang otherwise
});
