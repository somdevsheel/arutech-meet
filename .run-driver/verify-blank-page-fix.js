// Verifies H-8: protected pages rendered fully blank for 1.8-5.5s before
// anything appeared (a bare `return null` while the persisted auth session
// was still hydrating). Checks: (1) the raw SSR'd HTML already contains a
// spinner, not nothing; (2) a real logged-in hard-navigation actually shows
// content afterward with no regression.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "blank-page-fix");
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const page = await ctx.newPage();
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("STEP: register (establishes a real persisted session in localStorage)");
  await register(page, "Blank Page Fixer", `blankfix${suffix}`, `blankfix${suffix}@arutech.dev`);

  console.log("STEP: hard-reload /dashboard (the exact repro — a fresh full page load, not a client nav) and screenshot IMMEDIATELY on first paint");
  const navPromise = page.goto("http://localhost:3000/dashboard", { waitUntil: "commit" });
  await navPromise;
  // Screenshot at the earliest possible moment after commit — this is
  // exactly the window that used to be pure black.
  await shot(page, "01-immediately-after-commit");
  const spinnerVisibleEarly = await page.locator(".animate-spin").count();
  console.log("SPINNER_VISIBLE_IMMEDIATELY_AFTER_COMMIT (expect >=1 — was blank before the fix):", spinnerVisibleEarly);
  if (spinnerVisibleEarly < 1) pass = false;

  console.log("STEP: wait for real hydration to finish, confirm the actual dashboard renders with no regression");
  await page.waitForSelector("text=New meeting", { timeout: 10000 });
  await shot(page, "02-fully-hydrated-dashboard");
  const dashboardRendered = await page.locator("text=New meeting").count();
  console.log("DASHBOARD_RENDERED_AFTER_HYDRATION (expect >=1):", dashboardRendered);
  if (dashboardRendered < 1) pass = false;

  console.log("STEP: same check on /admin (logged-in non-admin -> should show spinner then redirect, never blank)");
  await page.goto("http://localhost:3000/admin", { waitUntil: "commit" });
  await shot(page, "03-admin-immediately-after-commit");
  const adminSpinnerVisible = await page.locator(".animate-spin").count();
  console.log("ADMIN_SPINNER_VISIBLE_IMMEDIATELY (expect >=1):", adminSpinnerVisible);
  if (adminSpinnerVisible < 1) pass = false;
  await page.waitForURL("**/dashboard", { timeout: 8000 }).catch(() => {});
  console.log("NON_ADMIN_REDIRECTED_TO (expect .../dashboard):", page.url());

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
