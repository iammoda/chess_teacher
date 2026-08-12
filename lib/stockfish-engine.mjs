const STOCKFISH_SCRIPT = "stockfish-nnue-16-single.js";
const STOCKFISH_WASM = "stockfish-nnue-16-single.wasm";

export class StockfishEngine {
  constructor({ baseUrl, label }) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    this.scriptUrl = `${this.baseUrl}${STOCKFISH_SCRIPT}`;
    this.wasmUrl = `${this.baseUrl}${STOCKFISH_WASM}`;
    this.label = label;
    this.worker = null;
    this.ready = false;
    this.crashed = false;
    this.pending = null;
    this.queue = Promise.resolve();
    this.bootResolve = null;
    this.bootReject = null;
    // Count of abandoned searches whose eventual bestmove lines must be
    // swallowed (see _beginDrain's safety valve).
    this.staleBestmoves = 0;
    // Set while an abandoned (timed-out) search is still running in the
    // worker: the next evaluation must not start until its bestmove line has
    // been swallowed, or every following result is off by one search.
    this.drainPromise = null;
    this._drainResolve = null;
  }

  async init() {
    if (!window.Worker) {
      throw new Error("Workers unavailable");
    }

    // Root-relative URLs cannot be resolved from inside a blob: worker —
    // Chromium tolerates it, WebKit (iOS Safari) throws a SyntaxError. Always
    // hand the worker fully absolute URLs.
    const absoluteScriptUrl = new URL(this.scriptUrl, window.location.href).href;
    const absoluteWasmUrl = new URL(this.wasmUrl, window.location.href).href;

    const source = `importScripts(${JSON.stringify(absoluteScriptUrl)});`;
    const blob = new Blob([source], { type: "text/javascript" });
    const workerUrl = URL.createObjectURL(blob);
    this.worker = new Worker(`${workerUrl}#${encodeURIComponent(absoluteWasmUrl)}`);
    URL.revokeObjectURL(workerUrl);

    this.worker.onmessage = (event) => this.handleMessage(String(event.data));
    this.worker.onerror = () => {
      this.ready = false;
      this.crashed = true;
      // Never strand an awaiting caller: resolve the in-flight search with a
      // null result (its timeout callback checks this.pending and would no
      // longer fire the resolve).
      const pending = this.pending;
      this.pending = null;
      pending?.resolve({ bestMove: null, scoreCp: null, mate: null, pv: [], source: this.label });
      if (this.bootReject) {
        this.bootReject(new Error("Stockfish worker failed"));
      }
    };

    const bootPromise = new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error("Stockfish readiness timed out"));
      }, 5000);

      this.bootResolve = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      this.bootReject = (error) => {
        window.clearTimeout(timeout);
        reject(error);
      };
    });

    this.post("uci");
    window.setTimeout(() => this.post("isready"), 250);
    try {
      await bootPromise;
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  post(command) {
    if (this.worker) {
      this.worker.postMessage(command);
    }
  }

  handleMessage(line) {
    // Only readyok confirms full initialization — uciok merely acknowledges
    // the protocol and arrives before options/nets are loaded.
    if (line === "readyok") {
      this.ready = true;
      if (this.bootResolve) {
        this.bootResolve();
        this.bootResolve = null;
        this.bootReject = null;
      }
    }

    // A search abandoned past the drain guard eventually emits its bestmove —
    // swallow it or it would be consumed as the NEXT search's result.
    if (line.startsWith("bestmove ") && this.staleBestmoves > 0) {
      this.staleBestmoves -= 1;
      return;
    }

    if (this.pending && line.startsWith("info ")) {
      // Fail-high/fail-low iterations report bound scores, not exact evals —
      // recording them skews centipawn loss and the grades built on it.
      if (/\b(lowerbound|upperbound)\b/.test(line)) return;
      const cpMatch = line.match(/score cp (-?\d+)/);
      const mateMatch = line.match(/score mate (-?\d+)/);
      if (cpMatch) {
        this.pending.lastCp = Number(cpMatch[1]);
        this.pending.lastMate = null;
      }
      if (mateMatch) {
        this.pending.lastMate = Number(mateMatch[1]);
        this.pending.lastCp = null;
      }
      const pvMatch = line.match(/\bpv\s+(.+)$/);
      if (pvMatch) {
        this.pending.lastPv = pvMatch[1].trim().split(/\s+/).slice(0, 8);
      }
    }

    if (this.pending && line.startsWith("bestmove ")) {
      const move = line.split(/\s+/)[1];
      const pending = this.pending;
      this.pending = null;
      pending.resolve({
        bestMove: move && move !== "(none)" ? move : null,
        scoreCp: pending.lastCp,
        mate: pending.lastMate,
        pv: pending.lastPv,
        source: this.label,
      });
      return;
    }

    // A bestmove with no pending owner is the tail of an abandoned
    // (timed-out) search — swallowing it re-syncs the UCI stream so the next
    // evaluation gets its own result, not this one.
    if (!this.pending && line.startsWith("bestmove ") && this._drainResolve) {
      const release = this._drainResolve;
      this._drainResolve = null;
      this.drainPromise = null;
      release();
    }
  }

  // Stockfish's UCI_Elo floor. Below this we fall back to Skill Level, which
  // can play weaker (and more human-blundery) than Elo limiting allows.
  static MIN_UCI_ELO = 1320;

  _applyStrength(elo) {
    if (Number.isFinite(elo)) {
      if (elo >= StockfishEngine.MIN_UCI_ELO) {
        this.post("setoption name Skill Level value 20");
        this.post("setoption name UCI_LimitStrength value true");
        this.post(`setoption name UCI_Elo value ${Math.round(Math.min(elo, 2800))}`);
      } else {
        this.post("setoption name UCI_LimitStrength value false");
        // Below the UCI_Elo floor we approximate with Skill Level. Stockfish
        // skill levels run strong: even mid levels play well above 1600 at
        // normal depth, so the old (elo-500)/82 mapping (skill 10 at "1300")
        // produced sub-1320 opponents far stronger than 1320+ ones. Cap at 6
        // and spread the beginner range across the low levels; the shallow
        // search depth used for these games does the rest of the weakening.
        const skill = Math.max(0, Math.min(6, Math.round((elo - 400) / 150)));
        this.post(`setoption name Skill Level value ${skill}`);
      }
    } else {
      this.post("setoption name UCI_LimitStrength value false");
      this.post("setoption name Skill Level value 20");
    }
  }

  _evaluateRaw(fen, depth, elo, timeoutMs = 4500) {
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        if (this.pending) {
          this.pending = null;
          // The search is still running in the worker. Tell it to stop and
          // hold the queue until its bestmove line arrives, otherwise the
          // next evaluation would consume THIS search's result (off-by-one
          // desync poisoning every following grade).
          this._beginDrain();
          resolve({ bestMove: null, scoreCp: null, mate: null, pv: [], source: this.label });
        }
      }, timeoutMs);

      this.pending = {
        lastCp: null,
        lastMate: null,
        lastPv: [],
        resolve: (result) => {
          window.clearTimeout(timeout);
          resolve(result);
        },
      };

      this._applyStrength(elo);
      this.post(`position fen ${fen}`);
      this.post(`go depth ${depth}`);
    });
  }

  _beginDrain() {
    if (this.drainPromise) return;
    this.drainPromise = new Promise((resolve) => {
      // Safety valve: a wedged worker must not stall the queue forever. But
      // simply releasing the queue would let the abandoned search's eventual
      // bestmove be consumed by the NEXT evaluation (the exact off-by-one
      // desync draining exists to prevent) — mark it stale so handleMessage
      // swallows it whenever it arrives.
      const guard = window.setTimeout(() => {
        if (this._drainResolve) {
          this._drainResolve = null;
          this.drainPromise = null;
          this.staleBestmoves = (this.staleBestmoves || 0) + 1;
          resolve();
        }
      }, 3000);
      this._drainResolve = () => {
        window.clearTimeout(guard);
        resolve();
      };
    });
    this.post("stop");
  }

  async evaluatePosition(fen, depth, options = {}) {
    if (!this.ready) return { bestMove: null, scoreCp: null, mate: null, pv: [], source: this.label };
    const run = this.queue.then(async () => {
      if (this.drainPromise) await this.drainPromise;
      return this._evaluateRaw(fen, depth, options.elo, options.timeoutMs);
    });
    this.queue = run.catch(() => {});
    return run;
  }

  // Aborts the current search: the engine replies with bestmove immediately,
  // resolving the pending evaluation with whatever depth it reached. Lets the
  // deep post-game pass yield the (shared) worker to a new game instantly.
  stop() {
    if (this.worker && this.pending) {
      this.post("stop");
    }
  }

  async bestMove(fen, depth, elo) {
    const result = await this.evaluatePosition(fen, depth, { elo });
    return result.bestMove;
  }

  destroy() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.ready = false;
    // Resolve (never strand) an in-flight search: its timeout callback checks
    // this.pending and would no longer fire once we null it.
    const pending = this.pending;
    this.pending = null;
    pending?.resolve({ bestMove: null, scoreCp: null, mate: null, pv: [], source: this.label });
    const release = this._drainResolve;
    this._drainResolve = null;
    this.drainPromise = null;
    this.staleBestmoves = 0;
    release?.();
  }
}
