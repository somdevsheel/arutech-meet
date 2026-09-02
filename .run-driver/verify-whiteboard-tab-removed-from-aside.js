// Verifies the final follow-up: the aside's own top tab row (Info /
// Participants / Chat / Tools / Record) must NOT list "Whiteboard" as one
// of its tabs anymore — Whiteboard should be reachable only via its
// dedicated bottom-toolbar button, not duplicated as a tab up here too.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "whiteboard-tab-removed");
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
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("STEP: register + create + join an instant meeting");
  await register(page, "WB Tab Removed QA", `wbtabrm${suffix}`, `wbtabrm${suffix}@arutech.dev`);
  await page.click("text=New meeting");
  await page.waitForURL("**/meeting/**", { timeout: 15000 });
  await page.click('button:has-text("Join meeting")');
  await page.waitForSelector("footer", { timeout: 15000 });

  console.log("STEP: open Participants panel first — the aside's top tab row should show exactly Info/Participants/Chat/Tools/Record, no Whiteboard");
  await page.click('footer button:has-text("Participants")');
  await page.waitForTimeout(500);
  const asideTabRow = page.locator("aside .flex.gap-1.border-b button");
  const tabLabels = await asideTabRow.allTextContents();
  console.log("ASIDE_TAB_LABELS:", JSON.stringify(tabLabels));
  const hasWhiteboardTab = tabLabels.some((t) => t.trim() === "Whiteboard");
  console.log("ASIDE_HAS_WHITEBOARD_TAB (expect false):", hasWhiteboardTab);
  if (hasWhiteboardTab) pass = false;
  await shot(page, "01-aside-tab-row-no-whiteboard");

  console.log("STEP: the dedicated bottom-toolbar Whiteboard button must still exist and still work");
  const bottomToolbarWhiteboard = page.locator('footer button:has-text("Whiteboard")');
  const bottomBtnCount = await bottomToolbarWhiteboard.count();
  console.log("BOTTOM_TOOLBAR_WHITEBOARD_BUTTON_EXISTS (expect >=1):", bottomBtnCount);
  if (bottomBtnCount < 1) pass = false;
  await bottomToolbarWhiteboard.click();
  await page.waitForTimeout(800);
  const whiteboardCanvas = page.locator('canvas[width="800"]');
  const canvasCount = await whiteboardCanvas.count();
  const canvasBox = canvasCount > 0 ? await whiteboardCanvas.first().boundingBox() : null;
  console.log("WHITEBOARD_OPENED_DIRECTLY (expect >=1):", canvasCount);
  console.log("WHITEBOARD_MAIN_STAGE_SIZE (expect large):", JSON.stringify(canvasBox));
  if (canvasCount < 1 || !canvasBox || canvasBox.width < 600) pass = false;
  await shot(page, "02-whiteboard-still-opens-from-toolbar-button");

  console.log("STEP: while whiteboard is open, the aside tab row still shouldn't show Whiteboard, and none of its tabs should read as active");
  const tabLabels2 = await asideTabRow.allTextContents();
  console.log("ASIDE_TAB_LABELS_WHILE_WHITEBOARD_OPEN:", JSON.stringify(tabLabels2));
  const hasWhiteboardTab2 = tabLabels2.some((t) => t.trim() === "Whiteboard");
  console.log("ASIDE_HAS_WHITEBOARD_TAB_WHILE_OPEN (expect false):", hasWhiteboardTab2);
  if (hasWhiteboardTab2) pass = false;
  await shot(page, "03-aside-tab-row-while-whiteboard-open");

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
