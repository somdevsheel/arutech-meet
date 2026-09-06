// Verifies the actual root cause of "when i close tab and open again website
// why need to login again": the root "/" page never checked auth state at
// all, so a still-logged-in user reopening the site at the bare domain
// (completely normal after closing a tab — most browsers don't restore the
// exact URL you left) saw the same "Sign in / Create account" landing
// screen a logged-out visitor would, looking exactly like they'd been
// logged out even though their session was still fine. Same fix applied to
// /login and /register for consistency.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "home-redirect-when-logged-in");
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("STEP: a genuinely logged-out visitor hitting '/' still sees the normal public landing page (baseline, must not regress)");
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const loggedOutUrl = page.url();
  const seesSignIn = await page.locator("text=Sign in").isVisible().catch(() => false);
  console.log("LOGGED_OUT_STAYS_ON_HOME (expect true):", loggedOutUrl.endsWith("/") || loggedOutUrl.includes("localhost:3000/"));
  console.log("LOGGED_OUT_SEES_SIGN_IN_LINK (expect true):", seesSignIn);
  if (!seesSignIn) pass = false;
  await shot(page, "01-logged-out-sees-normal-landing-page");

  console.log("STEP: register + real login");
  await page.goto("http://localhost:3000/register", { waitUntil: "networkidle" });
  const inputs = page.locator("input");
  await inputs.nth(0).fill("Home Redirect Test");
  await inputs.nth(1).fill(`homeredirect${suffix}`);
  await inputs.nth(2).fill(`homeredirect${suffix}@arutech.dev`);
  await inputs.nth(3).fill("Password123!");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 15000 });

  console.log("STEP: 'close tab, reopen it' simulated as a hard navigation to the bare domain — exactly what a fresh tab/new address-bar visit does");
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await shot(page, "02-reopened-bare-domain-while-logged-in");

  const urlAfterReopen = page.url();
  const bouncedToDashboard = urlAfterReopen.includes("/dashboard");
  console.log("URL_AFTER_REOPENING_HOME_WHILE_LOGGED_IN:", urlAfterReopen);
  console.log("AUTO_REDIRECTED_TO_DASHBOARD_INSTEAD_OF_SHOWING_SIGN_IN (expect true):", bouncedToDashboard);
  if (!bouncedToDashboard) pass = false;

  console.log("STEP: same check on /login directly — an already-logged-in visitor shouldn't be asked to sign in again");
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const urlAfterLoginVisit = page.url();
  console.log("URL_AFTER_VISITING_LOGIN_WHILE_LOGGED_IN:", urlAfterLoginVisit);
  const loginBounced = urlAfterLoginVisit.includes("/dashboard");
  console.log("LOGIN_PAGE_ALSO_REDIRECTS (expect true):", loginBounced);
  if (!loginBounced) pass = false;
  await shot(page, "03-login-page-also-redirects-when-already-authed");

  console.log("STEP: no console/page errors");
  console.log("PAGE_ERRORS:", JSON.stringify(errors));
  if (errors.length > 0) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
