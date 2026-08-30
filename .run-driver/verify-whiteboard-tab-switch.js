// Verifies the actual bug: WhiteboardCanvas used to only mount while the
// Whiteboard sub-tab itself was visible, so switching to any other Tools
// sub-tab (or closing the panel) unmounted it — local edits since the last
// explicit Save vanished from view, and a subsequent Save with even one new
// item would overwrite the real page for everyone. Two real participants:
// A draws, switches sub-tabs and panels away and back, confirms the drawing
// is still there (not reset), confirms B saw it sync live throughout, then
// Saves and reloads to confirm what actually persisted is correct.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "whiteboard-tab-switch");
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

async function drag(page, canvasSel, from, to) {
  const box = await page.locator(canvasSel).boundingBox();
  const fx = box.x + (from.x / 800) * box.width;
  const fy = box.y + (from.y / 480) * box.height;
  const tx = box.x + (to.x / 800) * box.width;
  const ty = box.y + (to.y / 480) * box.height;
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.mouse.move(tx, ty, { steps: 8 });
  await page.mouse.up();
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const ctxA = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const ctxB = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const errors = { A: [], B: [] };
  for (const [label, page] of [["A", pageA], ["B", pageB]]) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors[label].push(msg.text());
    });
    page.on("pageerror", (err) => errors[label].push(String(err)));
  }

  const suffix = Date.now().toString().slice(-6);
  const CANVAS = "canvas";

  console.log("STEP: register A and B, A creates meeting, B joins");
  await register(pageA, "WB Tab A", `wbtaba${suffix}`, `wbtaba${suffix}@arutech.dev`);
  await register(pageB, "WB Tab B", `wbtabb${suffix}`, `wbtabb${suffix}@arutech.dev`);
  await pageA.click("text=New meeting");
  await pageA.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingCode = new URL(pageA.url()).pathname.split("/").pop();
  await pageA.click('button:has-text("Join meeting")');
  await pageA.waitForSelector("footer", { timeout: 15000 });

  await pageB.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await pageB.click('button:has-text("Join meeting")', { timeout: 15000 });
  await pageB.waitForTimeout(1500);
  const admitBtn = pageA.locator('button:has-text("Admit")');
  try {
    await admitBtn.first().waitFor({ timeout: 8000 });
    await admitBtn.first().click();
  } catch {
    console.log("No Admit button — B may not have needed admission");
  }
  await pageB.waitForSelector("footer", { timeout: 15000 });
  await pageA.waitForTimeout(1000);

  console.log("STEP: A opens Tools (defaults to Whiteboard tab), draws a rectangle");
  await pageA.click('button:has-text("Tools")');
  await pageA.waitForSelector(CANVAS, { timeout: 10000 });
  await pageA.click('button:has-text("Rect")');
  await drag(pageA, CANVAS, { x: 100, y: 80 }, { x: 300, y: 220 });
  await pageA.waitForTimeout(600);
  await shot(pageA, "01-a-drew-rectangle");

  console.log("STEP: B opens Tools too, confirms they see the rectangle live");
  await pageB.click('button:has-text("Tools")');
  await pageB.waitForSelector(CANVAS, { timeout: 10000 });
  await pageB.waitForTimeout(800);
  const bSeesRectBefore = await pageB.locator(CANVAS).screenshot();
  await shot(pageB, "02-b-sees-rectangle-live");

  console.log("STEP: A switches to Polls sub-tab, then Quiz, then back to Whiteboard — was previously wiped");
  await pageA.click('button:has-text("Polls")');
  await pageA.waitForTimeout(400);
  await pageA.click('button:has-text("Quiz")');
  await pageA.waitForTimeout(400);
  await pageA.click('button:has-text("Whiteboard")');
  await pageA.waitForTimeout(600);
  await shot(pageA, "03-a-back-on-whiteboard-after-subtab-switch");

  console.log("STEP: A now closes the whole Tools panel (switches to Chat), then reopens Tools -> Whiteboard");
  await pageA.click('button:has-text("Chat")');
  await pageA.waitForTimeout(600);
  await pageA.click('button:has-text("Tools")');
  await pageA.waitForTimeout(300);
  const wbTabAgain = pageA.locator('button:has-text("Whiteboard")');
  if (await wbTabAgain.count()) await wbTabAgain.click();
  await pageA.waitForTimeout(600);
  await shot(pageA, "04-a-back-on-whiteboard-after-full-panel-switch");

  console.log("STEP: A draws a second shape (ellipse) now that we're back");
  await pageA.click('button:has-text("Ellipse")');
  await drag(pageA, CANVAS, { x: 400, y: 100 }, { x: 550, y: 220 });
  await pageA.waitForTimeout(600);
  await shot(pageA, "05-a-drew-ellipse-too");

  console.log("STEP: does B still see BOTH shapes (proves items were never wiped/reset for A)?");
  await pageB.waitForTimeout(1000);
  await shot(pageB, "06-b-should-see-both-shapes");

  console.log("STEP: A clicks Save, then reloads — is what persisted the FULL page (rect + ellipse), not just the ellipse?");
  await pageA.click('button:has-text("Save")');
  await pageA.waitForTimeout(1000);
  await pageA.reload({ waitUntil: "networkidle" });
  await pageA.click('button:has-text("Join meeting")', { timeout: 15000 });
  await pageA.waitForSelector("footer", { timeout: 15000 });
  await pageA.click('button:has-text("Tools")');
  await pageA.waitForSelector(CANVAS, { timeout: 10000 });
  await pageA.waitForTimeout(1000);
  await shot(pageA, "07-a-after-reload-both-shapes-should-be-saved");

  console.log("CONSOLE_ERRORS_START");
  for (const label of ["A", "B"]) {
    for (const e of errors[label]) console.log(`  ${label}:`, e);
  }
  const totalErrors = errors.A.length + errors.B.length;
  console.log("CONSOLE_ERRORS_END", `(${totalErrors} total)`);

  await browser.close();
  console.log("DONE — visually inspect screenshots 03/04/05/06/07 for the actual proof");
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
