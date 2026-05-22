const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable, Writable } = require("node:stream");
const { handleRequest, resolvePublicFile } = require("../server");

function requestPath(path) {
  return new Promise((resolve, reject) => {
    const req = new Readable({
      read() {
        this.push(null);
      },
    });
    req.method = "GET";
    req.url = path;
    req.headers = { host: "localhost" };

    const chunks = [];
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    res.statusCode = 200;
    res.headers = {};
    res.writeHead = (status, headers) => {
      res.statusCode = status;
      res.headers = headers || {};
      return res;
    };
    res.on("finish", () => {
      resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      });
    });
    res.on("error", reject);

    Promise.resolve(handleRequest(req, res)).catch(reject);
  });
}

test("resolvePublicFile allows only browser assets", () => {
  assert.match(resolvePublicFile("/"), /index\.html$/);
  assert.match(resolvePublicFile("/app.js"), /app\.js$/);
  assert.match(resolvePublicFile("/lib/classify.mjs"), /classify\.mjs$/);
  assert.match(resolvePublicFile("/lib/stockfish-engine.mjs"), /stockfish-engine\.mjs$/);
  assert.match(resolvePublicFile("/vendor/chess/chess.js"), /chess\.js$/);
  assert.equal(resolvePublicFile("/.env"), "");
  assert.equal(resolvePublicFile("/README.md"), "");
  assert.equal(resolvePublicFile("/server.js"), "");
  assert.equal(resolvePublicFile("/lib/coach-helpers.js"), "");
  assert.equal(resolvePublicFile("/supabase/schema.sql"), "");
  assert.equal(resolvePublicFile("/../.env"), "");
});

test("static server serves required public assets", async () => {
  const html = await requestPath("/");
  assert.equal(html.status, 200);
  assert.match(html.headers["Content-Type"] || "", /text\/html/);

  const app = await requestPath("/app.js");
  assert.equal(app.status, 200);
  assert.match(app.headers["Content-Type"] || "", /text\/javascript/);

  const wasm = await requestPath("/vendor/stockfish/stockfish-nnue-16-single.wasm");
  assert.equal(wasm.status, 200);
  assert.match(wasm.headers["Content-Type"] || "", /application\/wasm/);

  const chess = await requestPath("/vendor/chess/chess.js");
  assert.equal(chess.status, 200);
  assert.match(chess.headers["Content-Type"] || "", /text\/javascript/);
});

test("static server denies sensitive repo files", async () => {
  for (const path of ["/.env", "/README.md", "/server.js", "/lib/coach-helpers.js", "/supabase/schema.sql"]) {
    const response = await requestPath(path);
    assert.equal(response.status, 404, path);
  }
});
