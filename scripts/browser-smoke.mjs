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
  await page.locator("#board .square").first().waitFor({ timeout: 7000 });

  const title = await page.title();
  if (title !== "Personal Chess Teacher") {
    throw new Error(`Unexpected page title: ${title}`);
  }

  const squareCount = await page.locator("#board .square").count();
  if (squareCount !== 64) {
    throw new Error(`Expected 64 board squares, found ${squareCount}.`);
  }

  const pieceCount = await page.locator("#board img.piece").count();
  if (pieceCount < 2) {
    throw new Error(`Expected SVG piece images on the board, found ${pieceCount}.`);
  }

  const appResponse = await page.request.get(`${baseUrl}/app.js`);
  const appText = await appResponse.text();
  if (appText.includes("cdn.jsdelivr.net/npm/chess.js")) {
    throw new Error("app.js still imports chess.js from the CDN.");
  }

  for (const path of ["/assets/squirrel_chess.svg", "/vendor/chess/chess.js", "/vendor/pieces/merida/wK.svg", "/vendor/pieces/merida/bQ.svg", "/lib/board-drag.mjs", "/lib/classify.mjs", "/lib/skill-model.mjs", "/lib/stockfish-engine.mjs"]) {
    const response = await page.request.get(`${baseUrl}${path}`);
    if (response.status() !== 200) {
      throw new Error(`${path} returned ${response.status()}`);
    }
  }

  for (const path of ["/.env", "/README.md", "/server.js", "/lib/coach-chat.js", "/supabase/schema.sql"]) {
    const response = await page.request.get(`${baseUrl}${path}`);
    if (response.status() !== 404) {
      throw new Error(`${path} should be denied, got ${response.status()}`);
    }
  }

  if (pageErrors.length) {
    throw new Error(`Browser page errors: ${pageErrors.join("; ")}`);
  }

  // ── Auth-mode smoke: with Supabase configured, the app must gate behind
  // sign-in. supabase-js is stubbed so this works offline and deterministically.
  process.env.SUPABASE_URL = "https://smoke-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_smoke_test_only";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_smoke_test_only";

  try {
    const authPage = await browser.newPage();
    const authPageErrors = [];
    authPage.on("pageerror", (error) => authPageErrors.push(error.message));

    await authPage.route("https://esm.sh/@supabase/supabase-js*", (route) => route.fulfill({
      contentType: "text/javascript",
      body: `export function createClient() {
        return { auth: {
          onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
          async getSession() { return { data: { session: null } }; },
          async signInWithPassword() { return { error: new Error("Invalid login credentials") }; },
          async signUp() { return { data: {}, error: null }; },
          async resetPasswordForEmail() { return { error: null }; },
          async updateUser() { return { error: null }; },
          async signOut() { return { error: null }; },
        } };
      }`,
    }));

    await authPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await authPage.locator("#authGate .auth-card").waitFor({ timeout: 7000 });

    const heading = await authPage.locator("#authGate h2").textContent();
    if (!/welcome back/i.test(heading || "")) {
      throw new Error(`Unexpected auth gate heading: ${heading}`);
    }

    // Mode switching: sign in -> create account -> back.
    await authPage.locator('[data-auth-mode="sign_up"]').click();
    await authPage.locator("#authGate h2", { hasText: "Create your account" }).waitFor({ timeout: 3000 });
    await authPage.locator('[data-auth-mode="sign_in"]').click();

    // A rejected sign-in surfaces the error without dismissing the gate.
    await authPage.locator("#authEmailInput").fill("smoke@example.com");
    await authPage.locator("#authPasswordInput").fill("wrong-password");
    await authPage.locator(".auth-submit").click();
    await authPage.locator(".auth-error", { hasText: "Invalid login credentials" }).waitFor({ timeout: 3000 });

    const gateCount = await authPage.locator("#authGate").count();
    if (gateCount !== 1) {
      throw new Error("Auth gate should stay up after a failed sign-in.");
    }

    if (authPageErrors.length) {
      throw new Error(`Auth-mode page errors: ${authPageErrors.join("; ")}`);
    }
    await authPage.close();
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
  }

  console.log("Browser smoke passed.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
