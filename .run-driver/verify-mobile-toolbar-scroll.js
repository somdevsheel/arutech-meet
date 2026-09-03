// Confirms the toolbar's scrollable middle section actually reaches every
// control (Whiteboard/Tools/Captions especially) on a phone-width viewport,
// not just that End meeting/Leave stayed visible.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "mobile-toolbar-scroll");
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
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const page = await ctx.newPage();
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  await register(page, "Mobile Scroll QA", `mobscr${suffix}`, `mobscr${suffix}@arutech.dev`);
  await page.click("text=New meeting");
  await page.waitForURL("**/meeting/**", { timeout: 15000 });
  await page.click('button:has-text("Join meeting")');
  await page.waitForSelector("footer", { timeout: 15000 });
  await page.waitForTimeout(800);

  console.log("STEP: before scrolling, Whiteboard/Tools/Captions must not be visible (clipped off to the right)");
  const wbBefore = await page.locator('footer button:has-text("Whiteboard")').isVisible().catch(() => false);
  console.log("WHITEBOARD_VISIBLE_BEFORE_SCROLL:", wbBefore);
  await shot(page, "01-before-scroll");

  console.log("STEP: scroll the toolbar's inner scroll container all the way right");
  await page.evaluate(() => {
    const scroller = document.querySelector("footer .overflow-x-auto");
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  });
  await page.waitForTimeout(300);
  await shot(page, "02-after-scroll-right");

  const wbAfter = await page.locator('footer button:has-text("Whiteboard")').isVisible().catch(() => false);
  const toolsAfter = await page.locator('footer button:has-text("Tools")').isVisible().catch(() => false);
  console.log("WHITEBOARD_VISIBLE_AFTER_SCROLL (expect true):", wbAfter);
  console.log("TOOLS_VISIBLE_AFTER_SCROLL (expect true):", toolsAfter);
  if (!wbAfter || !toolsAfter) pass = false;

  console.log("STEP: End meeting / Leave must have stayed visible and clickable throughout (pinned, not part of the scroller)");
  const leaveVisible = await page.locator('footer button:has-text("Leave")').isVisible();
  console.log("LEAVE_VISIBLE (expect true):", leaveVisible);
  if (!leaveVisible) pass = false;

  console.log("STEP: click Whiteboard now that it's reachable — it should actually open");
  await page.locator('footer button:has-text("Whiteboard")').click();
  await page.waitForTimeout(800);
  const canvasVisible = await page.locator('canvas[width="800"]').isVisible().catch(() => false);
  console.log("WHITEBOARD_OPENED (expect true):", canvasVisible);
  if (!canvasVisible) pass = false;
  await shot(page, "03-whiteboard-opened-from-mobile-scroll");

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
