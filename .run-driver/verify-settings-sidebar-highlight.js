// Verifies CS-1: Settings highlighted "Home" as the active sidebar item —
// mildly misleading about where you actually are, since Settings has no
// sidebar link of its own (it's reached via the topbar gear icon only).
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "settings-sidebar-highlight");
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

// The active sidebar link renders with `bg-brand-tint2` / a highlighted
// class (see SidebarLink) — check via the actual rendered class rather than
// guessing exact hex, by comparing the "Home" link's className before vs
// after. Scoped to the sidebar `<nav aria-label="Main">` specifically — the
// topbar logo is ALSO an `a[href="/dashboard"]` and would otherwise be the
// first match instead of the actual sidebar item.
async function homeLinkClasses(page) {
  return page.locator('nav[aria-label="Main"] a[href="/dashboard"]').first().getAttribute("class");
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
  let pass = true;

  console.log("STEP: register + confirm Home IS highlighted while actually on the dashboard (no regression)");
  await register(page, "Sidebar QA", `sidebarqa${suffix}`, `sidebarqa${suffix}@arutech.dev`);
  await shot(page, "01-home-highlighted-on-dashboard");
  const homeClassesOnDashboard = await homeLinkClasses(page);
  console.log("HOME_LINK_CLASSES_ON_DASHBOARD:", homeClassesOnDashboard);

  console.log("STEP: go to Settings — Home must NO LONGER be highlighted there");
  await page.goto("http://localhost:3000/settings", { waitUntil: "networkidle" });
  await shot(page, "02-home-not-highlighted-on-settings");
  const homeClassesOnSettings = await homeLinkClasses(page);
  console.log("HOME_LINK_CLASSES_ON_SETTINGS:", homeClassesOnSettings);
  console.log("HOME_STILL_WRONGLY_HIGHLIGHTED (expect false — this is the actual CS-1 fix):", homeClassesOnSettings === homeClassesOnDashboard);
  if (homeClassesOnSettings === homeClassesOnDashboard) pass = false;

  // Also confirm no OTHER sidebar item got wrongly highlighted instead.
  const anyHighlighted = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('nav[aria-label="Main"] a'));
    return links.some((a) => a.className.includes("bg-brand-tint2"));
  });
  console.log("ANY_SIDEBAR_ITEM_WRONGLY_HIGHLIGHTED_ON_SETTINGS (expect false):", anyHighlighted);
  if (anyHighlighted) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
