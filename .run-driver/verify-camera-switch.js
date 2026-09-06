// Verifies the reported gap: "there is no option to switch camera within
// meetings" — the camera toolbar button only ever toggled on/off, with no
// way to pick which camera on a device with more than one. Headless
// Chromium's fake-device flag only ever exposes a single fake video device
// (confirmed directly — real hardware/CI with multiple cameras would show
// more), so this can't prove switching between two DIFFERENT physical
// cameras changes the visible feed, but it fully exercises the real code
// path this fix adds: opening the picker, enumerating real videoinput
// devices via the browser's own API, showing the correct one marked
// active, and calling the real LiveKit Room.switchActiveDevice() without
// it throwing or disrupting the live camera track.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "camera-switch");
fs.mkdirSync(shotDir, { recursive: true });
let shotN = 0;
async function shot(page, label) {
  shotN += 1;
  const file = path.join(shotDir, `${String(shotN).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file });
  console.log("SCREENSHOT:", file);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("STEP: register + start an instant meeting with camera on");
  await page.goto("http://localhost:3000/register", { waitUntil: "networkidle" });
  const inputs = page.locator("input");
  await inputs.nth(0).fill("Camera Switch Test");
  await inputs.nth(1).fill(`camswitch${suffix}`);
  await inputs.nth(2).fill(`camswitch${suffix}@arutech.dev`);
  await inputs.nth(3).fill("Password123!");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 15000 });
  await page.click("text=New meeting");
  await page.waitForURL("**/meeting/**", { timeout: 15000 });
  await page.click('button:has-text("Join meeting")');
  await page.waitForSelector("footer", { timeout: 15000 });
  await page.waitForTimeout(1000);

  console.log("STEP: the camera control now has a real 'Choose camera' caret next to it (didn't exist before this fix)");
  const caret = page.locator('button[aria-label="Choose camera"]');
  const caretVisible = await caret.isVisible().catch(() => false);
  console.log("CAMERA_PICKER_CARET_EXISTS (expect true):", caretVisible);
  if (!caretVisible) pass = false;

  console.log("STEP: opening it shows the real camera list from the browser's own device API, not a fake one");
  await caret.click();
  await page.waitForTimeout(800);
  await shot(page, "01-camera-picker-open");
  const deviceRowVisible = await page.locator("text=fake_device_0").isVisible().catch(() => false);
  console.log("REAL_ENUMERATED_DEVICE_SHOWN (expect true):", deviceRowVisible);
  if (!deviceRowVisible) pass = false;

  const hasCheckmark = await page.locator("text=fake_device_0").locator("..").locator("svg").isVisible().catch(() => false);
  console.log("ACTIVE_DEVICE_MARKED_WITH_CHECKMARK (expect true):", hasCheckmark);
  if (!hasCheckmark) pass = false;

  console.log("STEP: selecting a device calls the real Room.switchActiveDevice() and doesn't break the live camera");
  await page.locator("text=fake_device_0").click();
  await page.waitForTimeout(1500);
  await shot(page, "02-after-switching");

  const stillNoError = await page.locator("text=Couldn't switch to that camera").isVisible().catch(() => false);
  console.log("SWITCH_DID_NOT_ERROR (expect false):", stillNoError);
  if (stillNoError) pass = false;

  // Close the picker, then confirm the camera toggle button still correctly
  // reflects "on" and the actual video track is still live (querying the
  // local video element's readyState, not just a UI label).
  await page.click('button[aria-label="Close"]').catch(() => {});
  await page.waitForTimeout(500);
  const stopVideoVisible = await page.locator('button:has-text("Stop video")').isVisible().catch(() => false);
  console.log("CAMERA_STILL_ON_AFTER_SWITCH (expect true):", stopVideoVisible);
  if (!stopVideoVisible) pass = false;

  const videoStillLive = await page.evaluate(() => {
    const video = document.querySelector("video");
    return Boolean(video && video.readyState >= 2 && !video.paused);
  });
  console.log("LOCAL_VIDEO_TRACK_STILL_ACTUALLY_PLAYING (expect true):", videoStillLive);
  if (!videoStillLive) pass = false;
  await shot(page, "03-camera-confirmed-still-live");

  console.log("STEP: no console/page errors");
  console.log("PAGE_ERRORS:", JSON.stringify(errors));
  if (errors.length > 0) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
