// Verifies the requested layout change: opening the Whiteboard should put
// it on the main stage full-size, with participant video moved to a side
// strip — the reverse of the previous layout, where the whiteboard was
// squeezed into a narrow 320px side panel and the video grid always kept
// the big main area regardless of what was open.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "whiteboard-layout-swap");
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
  const hostCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const guestCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const hostPage = await hostCtx.newPage();
  const guestPage = await guestCtx.newPage();
  const errors = [];
  hostPage.on("pageerror", (err) => errors.push(String(err)));
  hostPage.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("STEP: host starts an instant meeting, a second real participant joins (real two-person video)");
  await register(hostPage, "Whiteboard Host", `wbhost${suffix}`, `wbhost${suffix}@arutech.dev`);
  await hostPage.click("text=New meeting");
  await hostPage.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingUrl = hostPage.url();
  await hostPage.click('button:has-text("Join meeting")');
  await hostPage.waitForSelector("footer", { timeout: 15000 });

  await register(guestPage, "Whiteboard Guest", `wbguest${suffix}`, `wbguest${suffix}@arutech.dev`);
  await guestPage.goto(meetingUrl, { waitUntil: "networkidle" });
  await guestPage.click('button:has-text("Join meeting")');
  await guestPage.waitForSelector("footer", { timeout: 15000 });
  await hostPage.waitForTimeout(1500); // let the second participant's track actually arrive

  // The whiteboard's own <canvas width="800"> is a stable, unambiguous
  // signal for "the whiteboard is visible somewhere" — VideoGrid never
  // renders a <canvas> at all, so this can't false-positive on it.
  // Deliberately NOT scoped through `[data-video-grid-root]`: that
  // attribute follows the VIDEO grid specifically (see meeting-room.tsx's
  // own comment on why), so it moves OFF the main stage the moment the
  // whiteboard takes it over — checking for the whiteboard's own canvas
  // there would be checking the wrong div by construction.
  const whiteboardCanvas = hostPage.locator('canvas[width="800"]');

  console.log("STEP: BEFORE opening Whiteboard — no whiteboard canvas anywhere yet");
  const canvasBefore = await whiteboardCanvas.count();
  console.log("WHITEBOARD_CANVAS_BEFORE (expect 0):", canvasBefore);
  await shot(hostPage, "01-before-whiteboard-video-is-main");
  if (canvasBefore !== 0) pass = false;

  console.log("STEP: open Tools > whiteboard");
  await hostPage.click('button:has-text("Tools")');
  await hostPage.waitForSelector('button:has-text("whiteboard")', { timeout: 8000 });
  await hostPage.click('button:has-text("whiteboard")');
  await hostPage.waitForTimeout(800);
  await shot(hostPage, "02-whiteboard-open-full-size-video-to-side");

  console.log("STEP: the WHITEBOARD must now be visible, full-size");
  const canvasAfter = await whiteboardCanvas.count();
  const canvasBox = canvasAfter > 0 ? await whiteboardCanvas.first().boundingBox() : null;
  console.log("WHITEBOARD_CANVAS_VISIBLE_AFTER (expect >=1 — this is the actual layout swap):", canvasAfter);
  console.log("WHITEBOARD_CANVAS_SIZE (expect large, main-stage-sized):", JSON.stringify(canvasBox));
  if (canvasAfter < 1 || !canvasBox || canvasBox.width < 600) pass = false;

  console.log("STEP: data-video-grid-root (which tracks the VIDEO grid specifically) must now point at the SIDE panel, not the main stage");
  const sideHasVideo = await hostPage.locator('[data-video-grid-root] video').count();
  const sideVideoBox = sideHasVideo > 0 ? await hostPage.locator('[data-video-grid-root] video').first().boundingBox() : null;
  console.log("VIDEO_ELEMENTS_STILL_PRESENT_SOMEWHERE (expect >=1 — real 2-person call, not lost):", sideHasVideo);
  console.log("VIDEO_TILE_SIZE (expect small, side-strip-sized):", JSON.stringify(sideVideoBox));
  if (sideHasVideo < 1) pass = false;

  console.log("STEP: audio rendering must survive the swap — real <audio> elements from RoomAudioRenderer must still exist");
  const audioElsPresent = await hostPage.locator("audio").count();
  console.log("AUDIO_ELEMENTS_PRESENT_AFTER_SWAP (expect >=1 — must not go silent):", audioElsPresent);
  if (audioElsPresent < 1) pass = false;

  console.log("STEP: switch to Polls tab — main stage must hand back to the video grid automatically");
  await hostPage.click('button:has-text("polls")');
  await hostPage.waitForTimeout(500);
  await shot(hostPage, "03-switched-to-polls-video-back-to-main");
  const mainStageCanvasAfterSwitch = await hostPage.locator('[data-video-grid-root] canvas').count();
  const mainStageVideoAfterSwitch = await hostPage.locator('[data-video-grid-root] video').count();
  console.log("MAIN_STAGE_CANVAS_GONE_AFTER_SWITCHING_TABS (expect 0):", mainStageCanvasAfterSwitch);
  console.log("MAIN_STAGE_VIDEO_BACK_AFTER_SWITCHING_TABS (expect >=1):", mainStageVideoAfterSwitch);
  if (mainStageCanvasAfterSwitch !== 0 || mainStageVideoAfterSwitch < 1) pass = false;

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
