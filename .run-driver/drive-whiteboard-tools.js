// Verifies the expanded whiteboard toolbar end-to-end with two real
// participants: select/move, shape tools (rectangle/ellipse/line), text,
// undo/redo, custom color, adjustable width, delete-via-selection, and that
// every operation still syncs to a second real participant in real time
// (not just renders locally) — the whole point of rewriting this on a
// generic upsert-by-id wire format rather than hardcoding "stroke" handling.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "whiteboard-tools");
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
  await register(pageA, "Whiteboard A", `wba${suffix}`, `wba${suffix}@arutech.dev`);
  await register(pageB, "Whiteboard B", `wbb${suffix}`, `wbb${suffix}@arutech.dev`);
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

  console.log("STEP: both open Tools -> Whiteboard tab");
  await pageA.click('button:has-text("Tools")');
  await pageA.waitForTimeout(500);
  await pageB.click('button:has-text("Tools")');
  await pageB.waitForTimeout(500);
  await pageA.waitForSelector(CANVAS, { timeout: 10000 });
  await pageB.waitForSelector(CANVAS, { timeout: 10000 });
  await shot(pageA, "01-a-whiteboard-open");

  console.log("STEP: A draws a rectangle");
  await pageA.click('button:has-text("Rect")');
  await drag(pageA, CANVAS, { x: 100, y: 80 }, { x: 300, y: 220 });
  await pageA.waitForTimeout(600);
  await shot(pageA, "02-a-rectangle-drawn");

  console.log("STEP: A draws an ellipse");
  await pageA.click('button:has-text("Ellipse")');
  await drag(pageA, CANVAS, { x: 350, y: 80 }, { x: 500, y: 200 });
  await pageA.waitForTimeout(600);

  console.log("STEP: A draws a line");
  await pageA.click('button:has-text("Line")');
  await drag(pageA, CANVAS, { x: 100, y: 300 }, { x: 500, y: 350 });
  await pageA.waitForTimeout(600);

  console.log("STEP: A picks a custom color, then adds text");
  await pageA.locator('input[type="color"]').fill("#ff00ff");
  await pageA.click('button:has-text("Text")');
  const canvasBoxA = await pageA.locator(CANVAS).boundingBox();
  await pageA.mouse.click(canvasBoxA.x + (600 / 800) * canvasBoxA.width, canvasBoxA.y + (100 / 480) * canvasBoxA.height);
  await pageA.waitForTimeout(300);
  const textOverlayCount = await pageA.locator('[data-testid="whiteboard-text-input"]').count();
  console.log("TEXT_OVERLAY_STILL_OPEN_BEFORE_TYPING (expect 1 — this is the bug that got fixed):", textOverlayCount);
  if (textOverlayCount === 0) throw new Error("Text input closed itself before typing could happen");
  await pageA.keyboard.type("Hello whiteboard");
  await pageA.keyboard.press("Enter");
  await pageA.waitForTimeout(600);
  const overlayClosedAfterCommit =
    (await pageA.locator('[data-testid="whiteboard-text-input"]').count()) === 0;
  console.log("TEXT_OVERLAY_CLOSED_AFTER_ENTER (expect true):", overlayClosedAfterCommit);
  // Text is drawn as canvas pixels, not a DOM node — the screenshot below is
  // the real proof it landed, this just confirms the input closed correctly.
  await shot(pageA, "03-a-shapes-and-text");

  console.log("STEP: adjust width slider, draw a thick pen stroke");
  await pageA.click('button:has-text("Pen")');
  const widthSlider = pageA.locator('input[type="range"]');
  await widthSlider.fill("15");
  await drag(pageA, CANVAS, { x: 600, y: 300 }, { x: 700, y: 400 });
  await pageA.waitForTimeout(600);

  console.log("STEP: wait for sync, confirm B sees everything A drew");
  await pageB.waitForTimeout(1500);
  await shot(pageB, "04-b-sees-everything");

  console.log("STEP: A switches to Select, moves the rectangle");
  await pageA.click('button:has-text("Select")');
  await drag(pageA, CANVAS, { x: 200, y: 150 }, { x: 220, y: 400 });
  await pageA.waitForTimeout(300);
  await shot(pageA, "05-a-rectangle-selected-and-moved");

  console.log("STEP: A undoes the move (rectangle should snap back)");
  await pageA.click('button:has-text("Undo")');
  await pageA.waitForTimeout(400);
  await shot(pageA, "06-a-after-undo-move");

  console.log("STEP: A redoes the move");
  await pageA.click('button:has-text("Redo")');
  await pageA.waitForTimeout(400);
  await shot(pageA, "07-a-after-redo-move");

  console.log("STEP: A selects the rectangle again and deletes it via the Delete button");
  await pageA.mouse.click(canvasBoxA.x + (220 / 800) * canvasBoxA.width, canvasBoxA.y + (400 / 480) * canvasBoxA.height);
  await pageA.waitForTimeout(200);
  const deleteBtn = pageA.locator('button:has-text("Delete")');
  const deleteBtnVisible = await deleteBtn.count();
  console.log("DELETE_BUTTON_VISIBLE_AFTER_SELECT (expect >=1):", deleteBtnVisible);
  if (deleteBtnVisible > 0) {
    await deleteBtn.click();
  }
  await pageA.waitForTimeout(600);
  await shot(pageA, "08-a-after-delete-rectangle");

  console.log("STEP: confirm B also lost the rectangle (real sync of delete, not just local)");
  await pageB.waitForTimeout(1200);
  await shot(pageB, "09-b-after-a-deleted-rectangle");

  console.log("STEP: A saves the page, reload A and confirm items persisted");
  await pageA.click('button:has-text("Save")');
  await pageA.waitForTimeout(1000);
  await pageA.reload({ waitUntil: "networkidle" });
  await pageA.click('button:has-text("Join meeting")', { timeout: 15000 });
  await pageA.waitForSelector("footer", { timeout: 15000 });
  await pageA.click('button:has-text("Tools")');
  await pageA.waitForSelector(CANVAS, { timeout: 10000 });
  await pageA.waitForTimeout(1000);
  await shot(pageA, "10-a-after-reload-persisted");

  console.log("CONSOLE_ERRORS_START");
  for (const label of ["A", "B"]) {
    for (const e of errors[label]) console.log(`  ${label}:`, e);
  }
  const totalErrors = errors.A.length + errors.B.length;
  console.log("CONSOLE_ERRORS_END", `(${totalErrors} total)`);

  await browser.close();
  console.log("DONE");
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
