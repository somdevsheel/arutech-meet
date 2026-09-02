// Verifies H-9: at ~400px wide the sidebar was just hidden with no
// alternative affordance — 9 of 10 nav destinations became permanently
// unreachable. Checks: a hamburger button now exists, opens a real drawer
// with every destination, and closes on navigation.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "mobile-nav");
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
  const ctx = await browser.newContext({ viewport: { width: 400, height: 800 } });
  const page = await ctx.newPage();
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("STEP: register + land on dashboard at 400px wide");
  await register(page, "Mobile Nav User", `mobilenav${suffix}`, `mobilenav${suffix}@arutech.dev`);
  await shot(page, "01-dashboard-400px-before-open");

  const sidebarVisible = await page.locator('nav[aria-label="Main"]').first().isVisible().catch(() => false);
  console.log("DESKTOP_SIDEBAR_VISIBLE_AT_400PX (expect false — correctly hidden):", sidebarVisible);

  const hamburgerVisible = await page.locator('button[aria-label="Open navigation menu"]').isVisible();
  console.log("HAMBURGER_BUTTON_VISIBLE (expect true — this is H-9):", hamburgerVisible);
  if (!hamburgerVisible) pass = false;

  console.log("STEP: open the mobile nav drawer");
  await page.click('button[aria-label="Open navigation menu"]');
  await page.waitForTimeout(300);
  await shot(page, "02-drawer-open");

  const destinations = ["Home", "Calendar", "Classes", "Courses", "Team Chat", "Contacts", "Recordings", "Organizations", "Notes", "Apps"];
  let allReachable = true;
  for (const label of destinations) {
    const count = await page.locator(`.fixed.inset-0.z-40 nav[aria-label="Main"] >> text=${label}`).count();
    console.log(`DRAWER_HAS_LINK[${label}] (expect >=1):`, count);
    if (count < 1) allReachable = false;
  }
  if (!allReachable) pass = false;

  console.log("STEP: click a destination — must navigate AND close the drawer");
  await page.click('.fixed.inset-0.z-40 nav[aria-label="Main"] >> text=Contacts');
  await page.waitForURL("**/contacts", { timeout: 8000 });
  await page.waitForTimeout(300);
  await shot(page, "03-navigated-to-contacts-drawer-closed");
  const drawerStillOpen = await page.locator('button[aria-label="Close navigation menu"]').count();
  console.log("DRAWER_CLOSED_AFTER_NAVIGATION (expect drawer count 0):", drawerStillOpen);
  if (drawerStillOpen !== 0) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
