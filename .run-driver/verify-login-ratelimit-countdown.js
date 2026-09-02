// Verifies L-5: login rate-limiting had no visible countdown or retry
// timing — beyond H-10's friendly message text, nothing indicated WHEN the
// limiter would lift, so a user just had to guess when to try again.
// NestJS's ThrottlerGuard already sends a real `Retry-After` header (in
// whole seconds) on every 429; this proves the login page now reads it and
// shows a real, live-ticking countdown instead.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "login-ratelimit-countdown");
fs.mkdirSync(shotDir, { recursive: true });
let shotN = 0;
async function shot(page, label) {
  shotN += 1;
  const file = path.join(shotDir, `${String(shotN).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file });
  console.log("SCREENSHOT:", file);
}

async function register(page, name, username, email) {
  await page.goto("http://localhost:3000/register", { waitUntil: "networkidle" });
  const inputs = page.locator("input");
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill(username);
  await inputs.nth(2).fill(email);
  await inputs.nth(3).fill("Password123!");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 15000 });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const suffix = Date.now().toString().slice(-6);
  const email = `ratelimitqa${suffix}@arutech.dev`;
  let pass = true;

  console.log("STEP: register a real account (so we have a real email to hammer with wrong passwords)");
  await register(page, "RateLimit QA", `ratelimitqa${suffix}`, email);
  await page.evaluate(() => localStorage.clear());

  console.log("STEP: trip the real rate limiter with 6 real wrong-password attempts through the actual login form");
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  for (let i = 0; i < 6; i++) {
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', "DefinitelyWrongPassword1");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(400);
  }
  await shot(page, "01-rate-limited-with-countdown");

  console.log("STEP: a real, specific countdown must be shown — not just the generic H-10 message");
  const countdownText = await page.locator("text=/try again in \\d+s/i").first().textContent().catch(() => null);
  console.log("COUNTDOWN_TEXT_SHOWN:", countdownText);
  if (!countdownText) pass = false;

  const initialSeconds = countdownText ? parseInt(countdownText.match(/(\d+)s/)[1], 10) : null;
  console.log("INITIAL_COUNTDOWN_SECONDS (expect a real number, ~60):", initialSeconds);
  if (!initialSeconds || initialSeconds < 1 || initialSeconds > 60) pass = false;

  console.log("STEP: the submit button must be disabled and itself show the countdown");
  const buttonDisabled = await page.locator('button[type="submit"]').isDisabled();
  const buttonText = await page.locator('button[type="submit"]').textContent();
  console.log("SUBMIT_BUTTON_DISABLED (expect true):", buttonDisabled);
  console.log("SUBMIT_BUTTON_TEXT:", buttonText);
  if (!buttonDisabled || !/try again in \d+s/i.test(buttonText)) pass = false;

  console.log("STEP: the countdown must actually tick DOWN over real time, not just be a static number");
  await page.waitForTimeout(3000);
  const laterText = await page.locator("text=/try again in \\d+s/i").first().textContent();
  const laterSeconds = parseInt(laterText.match(/(\d+)s/)[1], 10);
  console.log(`COUNTDOWN_AFTER_3S: ${laterSeconds} (expect less than initial ${initialSeconds})`);
  await shot(page, "02-countdown-ticked-down");
  if (laterSeconds >= initialSeconds) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
