// Verifies M-1: no "Forgot password" flow existed anywhere — no link on
// login, direct routes 404, and the validation schemas that already existed
// were referenced only by a unit test, never wired to a real route.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "forgot-password");
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
  await inputs.nth(3).fill("OldPassword1");
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
  const email = `forgotpw${suffix}@arutech.dev`;
  let pass = true;

  console.log("STEP: register a real account with a known password");
  await register(page, "Forgot PW User", `forgotpw${suffix}`, email);
  await page.evaluate(() => localStorage.clear());

  console.log("STEP: login page now has a real 'Forgot password?' link");
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await shot(page, "01-login-with-forgot-link");
  const forgotLinkCount = await page.locator('a:has-text("Forgot password?")').count();
  console.log("LOGIN_HAS_FORGOT_LINK (expect >=1 — this is M-1):", forgotLinkCount);
  if (forgotLinkCount < 1) pass = false;

  console.log("STEP: click it, submit the real email");
  await page.click('a:has-text("Forgot password?")');
  await page.waitForURL("**/forgot-password", { timeout: 8000 });
  await page.fill('input[type="email"]', email);
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=Check your email", { timeout: 8000 });
  await shot(page, "02-check-your-email");

  console.log("STEP: fetch the real email from the local MailHog inbox and extract the reset link");
  const mailhogMessages = await fetch("http://localhost:8025/api/v2/messages").then((r) => r.json());
  const mine = mailhogMessages.items.find((m) =>
    (m.Content.Headers.To || []).some((to) => to.toLowerCase().includes(email.toLowerCase())),
  );
  console.log("FOUND_REAL_EMAIL_IN_MAILHOG (expect true):", !!mine);
  if (!mine) pass = false;

  let resetUrl = null;
  if (mine) {
    // Decode quoted-printable BEFORE regex-matching a URL out of it — MailHog
    // wraps long lines with a soft "=\r\n" break, which can (and did) land
    // mid-URL. Matching against the raw, still-encoded body and patching the
    // matched substring afterward only fixes breaks *inside* the match; a
    // break can also split the match short (as it did here: the boundary
    // landed between "reset-password?=" and "token=3D...", truncating the
    // extracted token). Decode the whole body first, then match.
    const decoded = mine.Content.Body
      .replace(/=\r\n/g, "")
      .replace(/=\n/g, "")
      .replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    const match = decoded.match(/https?:\/\/[^\s"<]+reset-password\?token=[^\s"<]+/);
    resetUrl = match ? match[0] : null;
    console.log("EMAIL_SUBJECT:", mine.Content.Headers.Subject);
    console.log("EXTRACTED_RESET_URL_FOUND (expect true):", !!resetUrl);
  }
  if (!resetUrl) pass = false;

  console.log("STEP: open the real reset link and set a new password");
  if (resetUrl) {
    await page.goto(resetUrl, { waitUntil: "networkidle" });
    await shot(page, "03-reset-password-page");
    const inputs = page.locator('input[type="password"]');
    await inputs.nth(0).fill("BrandNewPassword1");
    await inputs.nth(1).fill("BrandNewPassword1");
    await page.click('button[type="submit"]');
    await page.waitForSelector("text=Password reset", { timeout: 8000 });
    await shot(page, "04-reset-success");
  }

  console.log("STEP: log in with the OLD password — must fail");
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "OldPassword1");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(800);
  const oldPasswordRejected = await page.locator("text=/invalid email or password/i").count();
  console.log("OLD_PASSWORD_REJECTED (expect >=1):", oldPasswordRejected);
  if (oldPasswordRejected < 1) pass = false;

  console.log("STEP: log in with the NEW password — must succeed");
  await page.fill('input[type="password"]', "BrandNewPassword1");
  await page.click('button[type="submit"]');
  const loggedIn = await page.waitForURL("**/dashboard", { timeout: 8000 }).then(() => true).catch(() => false);
  console.log("NEW_PASSWORD_WORKS (expect true):", loggedIn);
  await shot(page, "05-logged-in-with-new-password");
  if (!loggedIn) pass = false;

  console.log("STEP: the SAME reset link must not work a second time (single-use)");
  await page.goto(resetUrl, { waitUntil: "networkidle" });
  const inputs2 = page.locator('input[type="password"]');
  await inputs2.nth(0).fill("AnotherPassword1");
  await inputs2.nth(1).fill("AnotherPassword1");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(800);
  const reuseRejected = await page.locator("text=/invalid or expired/i").count();
  console.log("REUSED_TOKEN_REJECTED (expect >=1 — single-use enforced):", reuseRejected);
  await shot(page, "06-reused-token-rejected");
  if (reuseRejected < 1) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
