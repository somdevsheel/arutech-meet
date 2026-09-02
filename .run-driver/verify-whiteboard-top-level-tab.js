// Verifies the follow-up request: Whiteboard should be its own top-level
// entry point in the main toolbar, right next to Record — not nested two
// levels deep inside Tools > Whiteboard anymore. Also re-confirms the main-
// stage/side-strip layout swap still works from this new entry point.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "whiteboard-top-level-tab");
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
  await register(page, "WB TopLevel QA", `wbtopqa${suffix}`, `wbtopqa${suffix}@arutech.dev`);
  await page.click("text=New meeting");
  await page.waitForURL("**/meeting/**", { timeout: 15000 });
  await page.click('button:has-text("Join meeting")');
  await page.waitForSelector("footer", { timeout: 15000 });

  console.log("STEP: a dedicated 'Whiteboard' button must exist directly in the bottom toolbar, next to Record");
  const bottomToolbarWhiteboard = page.locator('footer button:has-text("Whiteboard")');
  const bottomBtnCount = await bottomToolbarWhiteboard.count();
  console.log("BOTTOM_TOOLBAR_WHITEBOARD_BUTTON_EXISTS (expect >=1):", bottomBtnCount);
  if (bottomBtnCount < 1) pass = false;
  await shot(page, "01-bottom-toolbar-has-whiteboard-button");

  console.log("STEP: click it directly — must open the whiteboard immediately, no need to go through Tools first");
  await bottomToolbarWhiteboard.click();
  await page.waitForTimeout(800);
  const whiteboardCanvas = page.locator('canvas[width="800"]');
  const canvasCount = await whiteboardCanvas.count();
  const canvasBox = canvasCount > 0 ? await whiteboardCanvas.first().boundingBox() : null;
  console.log("WHITEBOARD_OPENED_DIRECTLY (expect >=1):", canvasCount);
  console.log("WHITEBOARD_MAIN_STAGE_SIZE (expect large):", JSON.stringify(canvasBox));
  await shot(page, "02-whiteboard-opened-from-top-level-button");
  if (canvasCount < 1 || !canvasBox || canvasBox.width < 600) pass = false;

  console.log("STEP: the aside's own top tab row must ALSO show 'Whiteboard' as a peer of Record, Tools, etc.");
  const asideWhiteboardTab = page.locator("aside button", { hasText: "Whiteboard" });
  const asideTabCount = await asideWhiteboardTab.count();
  console.log("ASIDE_TOP_TAB_ROW_HAS_WHITEBOARD (expect >=1):", asideTabCount);
  if (asideTabCount < 1) pass = false;

  console.log("STEP: opening Tools must NOT show a Whiteboard sub-tab anymore — only Polls/Quiz/Breakout");
  await page.click('footer button:has-text("Tools")');
  await page.waitForTimeout(500);
  await shot(page, "03-tools-panel-no-longer-has-whiteboard-subtab");
  const toolsHasPolls = await page.locator("aside button", { hasText: "polls" }).count();
  // Exact, case-sensitive match on purpose: ClassroomPanel's own sub-tabs
  // render their raw lowercase Tab key as text ("whiteboard", "polls", ...,
  // capitalized only via a CSS class), while the NEW top-level panel tab
  // renders the human label "Whiteboard" (capital W) — a substring/
  // case-insensitive match would wrongly catch that correct, unrelated tab
  // too and always report a false failure here regardless of whether the
  // real regression (a leftover sub-tab) exists.
  const toolsHasWhiteboardSubtab = await page.getByText("whiteboard", { exact: true }).count();
  console.log("TOOLS_STILL_HAS_POLLS (expect >=1):", toolsHasPolls);
  console.log("TOOLS_NO_LONGER_HAS_WHITEBOARD_SUBTAB (expect 0):", toolsHasWhiteboardSubtab);
  if (toolsHasPolls < 1 || toolsHasWhiteboardSubtab !== 0) pass = false;

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
