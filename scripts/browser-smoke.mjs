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

  // Board themes, piece sets, and personas: switching must take effect live.
  await page.locator('[data-tab="settings"]').click();
  await page.locator('[data-board-theme-key="walnut"]').click();
  const themeApplied = await page.evaluate(() => document.documentElement.dataset.boardTheme);
  if (themeApplied !== "walnut") {
    throw new Error(`Board theme switch failed: got "${themeApplied}"`);
  }
  const darkSquareColor = await page.evaluate(() => {
    const dark = document.querySelector("#board .square.dark, #board .square:nth-child(2)");
    return getComputedStyle(dark).backgroundColor;
  });
  if (darkSquareColor !== "rgb(181, 136, 99)") {
    throw new Error(`Walnut dark square should be rgb(181, 136, 99), got ${darkSquareColor}`);
  }

  await page.locator('[data-piece-set-key="fantasy"]').click();
  await page.waitForTimeout(300);
  const spriteSrc = await page.locator("#board img.piece").first().getAttribute("src");
  if (!spriteSrc.includes("/vendor/pieces/fantasy/")) {
    throw new Error(`Piece set switch failed: sprite src ${spriteSrc}`);
  }

  const personaCount = await page.locator("[data-persona-key]").count();
  if (personaCount < 5) {
    throw new Error(`Expected 5 persona options, found ${personaCount}`);
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

// ── Mobile / tablet smoke across engines ──
// Chromium stands in for Android; WebKit is iOS Safari's actual engine.
// WebKit is skipped with a warning when the binary isn't installed, so
// `npm test` stays runnable on fresh clones (`npx playwright install webkit`).
const mobileServer = createServer();
await new Promise((resolve, reject) => {
  mobileServer.once("error", reject);
  mobileServer.listen(0, "127.0.0.1", resolve);
});
const mobileBaseUrl = `http://127.0.0.1:${mobileServer.address().port}`;
const { devices, webkit } = await import("playwright");

async function checkMobileLayout(engineBrowser, engineName, profileName, device) {
  const label = `${engineName}/${profileName}`;
  const context = await engineBrowser.newContext({ ...device });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(mobileBaseUrl, { waitUntil: "domcontentloaded" });
  // Geometry assertions need the stylesheet applied, not just the DOM —
  // WebKit can render unstyled squares before styles.css finishes loading.
  await page.waitForLoadState("load");
  await page.locator("#board .square").first().waitFor({ timeout: 10000 });

  const viewport = page.viewportSize();
  const isMobileLayout = viewport.width <= 900;

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) throw new Error(`${label}: horizontal overflow of ${overflow}px`);

  const board = await page.locator(".board-host").boundingBox();
  if (!board || board.width > viewport.width) {
    throw new Error(`${label}: board missing or wider than the viewport`);
  }

  if (isMobileLayout) {
    const rail = await page.evaluate(() => {
      const el = document.querySelector(".rail");
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return { position: style.position, bottomGap: window.innerHeight - rect.bottom };
    });
    if (rail.position !== "fixed" || rail.bottomGap > 1) {
      throw new Error(`${label}: bottom tab bar not pinned (${JSON.stringify(rail)})`);
    }

    const navBox = await page.locator('[data-tab="settings"]').boundingBox();
    if (!navBox || navBox.height < 40) {
      throw new Error(`${label}: nav touch target too small (${navBox?.height}px)`);
    }

    // Tap-to-move with real touch events.
    await page.tap('[data-square="e2"]');
    await page.tap('[data-square="e4"]');
    await page.waitForFunction(
      () => Boolean(document.querySelector('[data-square="e4"] img.piece')),
      null,
      { timeout: 5000 },
    );

    // Settings: the board stage frees the screen, inputs never trigger iOS zoom.
    await page.tap('[data-tab="settings"]');
    await page.waitForFunction(
      () => getComputedStyle(document.querySelector(".stage")).display === "none",
      null,
      { timeout: 3000 },
    );
    const inputFont = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.querySelector("#displayNameInput")).fontSize));
    if (inputFont < 16) throw new Error(`${label}: ${inputFont}px inputs cause focus zoom`);

    // Back button walks tab history instead of leaving the app.
    await page.goBack();
    await page.waitForFunction(() => document.body.dataset.activeTab === "coach", null, { timeout: 3000 });
  } else {
    const railPosition = await page.evaluate(() => getComputedStyle(document.querySelector(".rail")).position);
    if (railPosition === "fixed") {
      throw new Error(`${label}: side rail unexpectedly became a bottom bar at ${viewport.width}px`);
    }
  }

  if (errors.length) throw new Error(`${label}: page errors: ${errors.join("; ")}`);
  await context.close();
  console.log(`  mobile ok: ${label} (${viewport.width}x${viewport.height})`);
}

const mobileChromium = await chromium.launch({ headless: true });
try {
  await checkMobileLayout(mobileChromium, "chromium", "Pixel 7", devices["Pixel 7"]);
  await checkMobileLayout(mobileChromium, "chromium", "touch laptop", {
    viewport: { width: 1280, height: 800 },
    hasTouch: true,
  });

  let webkitBrowser = null;
  try {
    webkitBrowser = await webkit.launch({ headless: true });
  } catch {
    console.warn("  (webkit not installed — skipping iOS-engine checks; run `npx playwright install webkit`)");
  }

  if (webkitBrowser) {
    try {
      await checkMobileLayout(webkitBrowser, "webkit", "iPhone 14", devices["iPhone 14"]);
      await checkMobileLayout(webkitBrowser, "webkit", "iPhone SE", devices["iPhone SE"]);
      await checkMobileLayout(webkitBrowser, "webkit", "iPad portrait", devices["iPad Pro 11"]);
      await checkMobileLayout(webkitBrowser, "webkit", "iPad landscape", devices["iPad Pro 11 landscape"]);
    } finally {
      await webkitBrowser.close();
    }
  }

  console.log("Mobile smoke passed.");
} finally {
  await mobileChromium.close();
  await new Promise((resolve) => mobileServer.close(resolve));
}
