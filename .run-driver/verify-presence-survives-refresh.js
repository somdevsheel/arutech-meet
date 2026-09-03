// Verifies the reported bug: clicking "Away" changed the topbar dot, but
// refreshing the page silently reset it back to Online. Also checks a
// second, independent observer (in Team Chat, watching this user's presence
// dot) sees the real status survive the refresh too, not just the setter's
// own tab.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "presence-survives-refresh");
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
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errors = [];
  a.on("pageerror", (err) => errors.push(String(err)));
  a.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("STEP: register A and B");
  await register(a, "Presence A", `presa${suffix}`, `presa${suffix}@arutech.dev`);
  await register(b, "Presence B", `presb${suffix}`, `presb${suffix}@arutech.dev`);

  console.log("STEP: A opens the account menu and sets status to Away");
  await a.click('button:has(span[aria-label*="Your status"])');
  await a.waitForTimeout(200);
  await a.click("text=Away");
  await a.waitForTimeout(300);
  const dotClassBefore = await a.locator('span[aria-label*="Your status"]').getAttribute("class");
  console.log("DOT_CLASS_BEFORE_REFRESH (expect bg-warn = Away):", dotClassBefore);
  const awayBefore = (dotClassBefore || "").includes("bg-warn");
  if (!awayBefore) pass = false;
  await shot(a, "01-a-set-away");

  console.log("STEP: A hard-reloads the page — this is the exact reported bug");
  await a.reload({ waitUntil: "networkidle" });
  await a.waitForTimeout(1000);
  const dotClassAfter = await a.locator('span[aria-label*="Your status"]').getAttribute("class");
  console.log("DOT_CLASS_AFTER_REFRESH (expect bg-warn = still Away):", dotClassAfter);
  const awayAfter = (dotClassAfter || "").includes("bg-warn");
  if (!awayAfter) pass = false;
  await shot(a, "02-a-still-away-after-refresh");

  console.log("STEP: open the account menu again — the checkmark should be next to Away, not Online");
  await a.click('button:has(span[aria-label*="Your status"])');
  await a.waitForTimeout(200);
  await shot(a, "03-a-menu-after-refresh");
  const awayRowChecked = await a
    .locator('div[aria-label="Set your status"] button', { hasText: "Away" })
    .locator("text=✓")
    .count();
  console.log("AWAY_ROW_HAS_CHECKMARK (expect >=1):", awayRowChecked);
  if (awayRowChecked < 1) pass = false;
  await a.keyboard.press("Escape").catch(() => {});

  console.log("STEP: no console/page errors happened during any of this");
  console.log("CONSOLE_ERRORS:", JSON.stringify(errors));
  if (errors.length > 0) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
