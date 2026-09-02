// Verifies H-10: login's rate limiter showed the raw backend exception name
// "ThrottlerException: Too Many Requests" verbatim, even on a subsequent
// correct-password attempt, with no indication of what happened.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "login-rate-limit-message");
fs.mkdirSync(shotDir, { recursive: true });
let shotN = 0;
async function shot(page, label) {
  shotN += 1;
  const file = path.join(shotDir, `${String(shotN).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file });
  console.log("SCREENSHOT:", file);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newContext().then((c) => c.newPage());
  const suffix = Date.now().toString().slice(-6);
  const email = `loginratelimit${suffix}@arutech.dev`;

  console.log("STEP: register a real account first");
  await page.goto("http://localhost:3000/register", { waitUntil: "networkidle" });
  const inputs = page.locator("input");
  await inputs.nth(0).fill("Login Rate Limit User");
  await inputs.nth(1).fill(`loginratelimit${suffix}`);
  await inputs.nth(2).fill(email);
  await inputs.nth(3).fill("Password123!");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 15000 });
  await page.evaluate(() => localStorage.clear());

  console.log("STEP: 5 wrong-password attempts on the real login page");
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  for (let i = 0; i < 5; i++) {
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', "wrongpassword");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(400);
  }

  console.log("STEP: 6th attempt (rate-limited) — what does the user actually see?");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "wrongpassword");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(600);
  await shot(page, "01-rate-limited-error-shown");

  const pageText = await page.locator("body").innerText();
  const showsRawException = /ThrottlerException/i.test(pageText);
  const showsFriendlyMessage = /too many attempts/i.test(pageText);
  console.log("SHOWS_RAW_EXCEPTION_NAME (expect false — was true before the fix):", showsRawException);
  console.log("SHOWS_FRIENDLY_MESSAGE (expect true):", showsFriendlyMessage);

  const pass = !showsRawException && showsFriendlyMessage;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
