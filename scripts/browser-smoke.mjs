import { createRequire } from "node:module";

process.env.OPENAI_API_KEY = "smoke-disabled";

const require = createRequire(import.meta.url);
const { createServer } = require("../server.js");

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright is required for browser smoke tests. Run `npm install` first.");
  process.exit(1);
}

const server = createServer();

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".service-gate-card").waitFor({ timeout: 7000 });

  const title = await page.title();
  if (title !== "Personal Chess Teacher") {
    throw new Error(`Unexpected page title: ${title}`);
  }

  const gateText = await page.locator(".service-gate-card").innerText();
  if (!gateText.includes("Supabase and OpenAI must be online")) {
    throw new Error("Required-services gate did not render.");
  }

  const appResponse = await page.request.get(`${baseUrl}/app.js`);
  const appText = await appResponse.text();
  if (appText.includes("cdn.jsdelivr.net/npm/chess.js")) {
    throw new Error("app.js still imports chess.js from the CDN.");
  }

  for (const path of ["/vendor/chess/chess.js", "/lib/classify.mjs", "/lib/stockfish-engine.mjs"]) {
    const response = await page.request.get(`${baseUrl}${path}`);
    if (response.status() !== 200) {
      throw new Error(`${path} returned ${response.status()}`);
    }
  }

  for (const path of ["/.env", "/README.md", "/server.js", "/lib/coach-helpers.js", "/supabase/schema.sql"]) {
    const response = await page.request.get(`${baseUrl}${path}`);
    if (response.status() !== 404) {
      throw new Error(`${path} should be denied, got ${response.status()}`);
    }
  }

  if (pageErrors.length) {
    throw new Error(`Browser page errors: ${pageErrors.join("; ")}`);
  }

  console.log("Browser smoke passed.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
