import { createRequire } from "node:module";

process.env.OPENAI_API_KEY = "smoke-disabled";

const require = createRequire(import.meta.url);
const { createServer } = require("../server.js");

// server.js loads the developer's real .env, which may configure Supabase.
// The first smoke scenario needs legacy local mode; the auth scenario sets
// its own fake values below.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_PUBLISHABLE_KEY;

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

  // Legacy mode must dismiss the boot veil once the app renders.
  await page.waitForFunction(() => !document.querySelector("#bootVeil"), null, { timeout: 5000 });

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
          async signInWithPassword() { return { error: { message: "Invalid login credentials", code: "invalid_credentials" } }; },
          async signUp() { return { data: {}, error: null }; },
          async resend() { return { error: null }; },
          async resetPasswordForEmail() { return { error: null }; },
          async updateUser() { return { error: null }; },
          async signOut() { return { error: null }; },
        } };
      }`,
    }));

    await authPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await authPage.locator("#authGate .auth-card").waitFor({ timeout: 7000 });

    // The veil must be gone once the gate is up — no flash of the app shell.
    await authPage.waitForFunction(() => !document.querySelector("#bootVeil"), null, { timeout: 3000 });

    const heading = await authPage.locator("#authGate h2").textContent();
    if (!/welcome back/i.test(heading || "")) {
      throw new Error(`Unexpected auth gate heading: ${heading}`);
    }

    // A rejected sign-in surfaces a friendly error AND keeps what was typed.
    await authPage.locator("#authEmailInput").fill("smoke@example.com");
    await authPage.locator("#authPasswordInput").fill("wrong-password");
    await authPage.locator(".auth-submit").click();
    await authPage.locator("#authError", { hasText: "don't match" }).waitFor({ timeout: 3000 });

    const preservedEmail = await authPage.locator("#authEmailInput").inputValue();
    if (preservedEmail !== "smoke@example.com") {
      throw new Error(`Failed sign-in should preserve the typed email, got "${preservedEmail}".`);
    }

    // Create-account screen: distinct flow with name capture and a strength meter.
    await authPage.locator('[data-auth-screen="sign_up"]').click();
    await authPage.locator("#authGate h2", { hasText: "Create your account" }).waitFor({ timeout: 3000 });
    await authPage.locator("#authNameInput").waitFor({ timeout: 3000 });

    await authPage.locator("#authNameInput").fill("Smokey");
    const carriedEmail = await authPage.locator("#authEmailInput").inputValue();
    if (carriedEmail !== "smoke@example.com") {
      throw new Error("Email should carry across auth screens.");
    }

    // Weak/common password: meter shows weak and client-side validation blocks.
    await authPage.locator("#authPasswordInput").fill("password123");
    await authPage.locator(".pw-meter.weak").waitFor({ timeout: 3000 });
    await authPage.locator(".auth-submit").click();
    await authPage.locator("#authError", { hasText: "common" }).waitFor({ timeout: 3000 });

    // Strong password passes and lands on the confirm-email screen with a
    // cooled-down resend button.
    await authPage.locator("#authPasswordInput").fill("horse battery staple chess");
    await authPage.locator(".pw-meter.strong").waitFor({ timeout: 3000 });
    await authPage.locator(".auth-submit").click();
    await authPage.locator("#authGate h2", { hasText: "Confirm your email" }).waitFor({ timeout: 3000 });
    await authPage.locator(".auth-sent-email", { hasText: "smoke@example.com" }).waitFor({ timeout: 3000 });

    const resendDisabled = await authPage.locator("#authResendButton").isDisabled();
    if (!resendDisabled) {
      throw new Error("Resend should start on cooldown right after signup.");
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
