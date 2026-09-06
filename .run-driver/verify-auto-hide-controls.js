// Verifies the feature request: "all icon should be hide automatically when
// move mouse need to popup all icons" — the meeting toolbar should
// auto-hide after a few seconds of no activity, and reappear on mouse
// movement, without disrupting anything else (popovers, existing controls).
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "auto-hide-controls");
fs.mkdirSync(shotDir, { recursive: true });
let shotN = 0;
async function shot(page, label) {
  shotN += 1;
  const file = path.join(shotDir, `${String(shotN).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file });
  console.log("SCREENSHOT:", file);
}

async function toolbarOpacity(page) {
  return page.evaluate(() => {
    const footer = document.querySelector("footer");
    if (!footer) return null;
    const wrapper = footer.parentElement;
    return window.getComputedStyle(wrapper).opacity;
  });
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

  console.log("STEP: register + join an instant meeting");
  await page.goto("http://localhost:3000/register", { waitUntil: "networkidle" });
  const inputs = page.locator("input");
  await inputs.nth(0).fill("Autohide Test");
  await inputs.nth(1).fill(`autohide${suffix}`);
  await inputs.nth(2).fill(`autohide${suffix}@arutech.dev`);
  await inputs.nth(3).fill("Password123!");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 15000 });
  await page.click("text=New meeting");
  await page.waitForURL("**/meeting/**", { timeout: 15000 });
  await page.click('button:has-text("Join meeting")');
  await page.waitForSelector("footer", { timeout: 15000 });

  console.log("STEP: toolbar starts visible right after joining");
  await page.waitForTimeout(500);
  const initialOpacity = await toolbarOpacity(page);
  console.log("INITIAL_OPACITY (expect 1):", initialOpacity);
  if (initialOpacity !== "1") pass = false;
  await shot(page, "01-visible-on-join");

  console.log("STEP: no mouse movement for >4s — toolbar should auto-hide");
  await page.waitForTimeout(4800);
  const hiddenOpacity = await toolbarOpacity(page);
  console.log("OPACITY_AFTER_IDLE (expect 0):", hiddenOpacity);
  if (hiddenOpacity !== "0") pass = false;
  await shot(page, "02-hidden-after-idle");

  console.log("STEP: it should not intercept clicks while hidden (pointer-events: none)");
  const pointerEvents = await page.evaluate(() => {
    const footer = document.querySelector("footer");
    return window.getComputedStyle(footer.parentElement).pointerEvents;
  });
  console.log("POINTER_EVENTS_WHILE_HIDDEN (expect none):", pointerEvents);
  if (pointerEvents !== "none") pass = false;

  console.log("STEP: moving the mouse brings it back");
  await page.mouse.move(640, 450);
  await page.mouse.move(650, 460);
  await page.waitForTimeout(500);
  const revealedOpacity = await toolbarOpacity(page);
  console.log("OPACITY_AFTER_MOUSE_MOVE (expect 1):", revealedOpacity);
  if (revealedOpacity !== "1") pass = false;
  await shot(page, "03-revealed-on-mouse-move");

  console.log("STEP: hovering the toolbar itself should keep it visible past the normal idle delay");
  const muteButton = page.getByText("Mute", { exact: true });
  await muteButton.hover();
  await page.waitForTimeout(5500); // longer than the 4s hide delay
  const stillVisibleWhileHovered = await toolbarOpacity(page);
  console.log("OPACITY_WHILE_HOVERING_TOOLBAR_PAST_DELAY (expect 1 -- must not hide while the pointer is on it):", stillVisibleWhileHovered);
  if (stillVisibleWhileHovered !== "1") pass = false;
  await shot(page, "04-stays-visible-while-hovered");

  console.log("STEP: a real click still works normally (mute) — the hide/show mechanism doesn't break normal interaction");
  await muteButton.click();
  await page.waitForTimeout(500);
  const unmuteVisible = await page.getByText("Unmute", { exact: true }).isVisible().catch(() => false);
  console.log("MUTE_BUTTON_STILL_WORKS (expect true):", unmuteVisible);
  if (!unmuteVisible) pass = false;

  console.log("STEP: opening the camera-device popover, then going idle — the popover itself must not get clipped/broken");
  await page.mouse.move(400, 300); // reset idle timer, ensure toolbar visible
  await page.waitForTimeout(200);
  await page.click('button[aria-label="Choose camera"]');
  await page.waitForTimeout(4800); // longer than the idle delay, while hovering the popover area
  const popoverStillOpen = await page.locator("text=fake_device_0").isVisible().catch(() => false);
  console.log("CAMERA_POPOVER_STAYS_OPEN_AND_VISIBLE_WHILE_HOVERED (expect true):", popoverStillOpen);
  if (!popoverStillOpen) pass = false;
  await shot(page, "05-popover-survives-idle-while-hovered");

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
