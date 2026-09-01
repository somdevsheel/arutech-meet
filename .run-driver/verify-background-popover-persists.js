// Verifies the actual bug: useVirtualBackground() was called INSIDE
// VirtualBackgroundPanel, which only exists in the DOM while the Background
// popover is open — so `mode`/`imagePath`/the processor ref all reset to
// their initial values every time the popover unmounted. The popover looked
// like it had silently reverted to "None" on reopen, even though the real
// background-blur/image effect was still genuinely running on the video
// track the entire time (LiveKit's setProcessor() call is independent of
// this popover's React lifecycle) — a real, visible "the UI is lying to
// you" bug, not just a cosmetic one.
//
// The fix lifts the useVirtualBackground() call up to MeetingToolbar, which
// stays mounted for the life of the LiveKit connection, and threads its
// return value down as props. This script applies Blur, closes the
// popover, reopens it, and confirms Blur is still shown as the selected
// mode — not reset to None.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "background-popover-persists");
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
    args: [
      "--no-sandbox",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--use-gl=swiftshader",
      "--enable-webgl",
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register host, start an instant meeting, join with camera on");
  await register(page, "Bg Host", `bghost${suffix}`, `bghost${suffix}@arutech.dev`);
  await page.click("text=New meeting");
  await page.waitForURL("**/meeting/**", { timeout: 15000 });
  await page.click('button:has-text("Join meeting")');
  await page.waitForSelector("footer", { timeout: 15000 });
  await page.waitForTimeout(1500);

  console.log("STEP: open the Background popover, apply Blur");
  await page.click('button:has-text("Background")');
  await page.waitForTimeout(500);
  const blurBtn = page.locator('button:has-text("Blur")');
  await blurBtn.waitFor({ timeout: 10000 });
  await blurBtn.click();
  await page.waitForTimeout(2000); // segmenter model load + first frame
  await shot(page, "01-blur-applied");
  const blurSelectedFirstOpen = await page
    .locator('button:has-text("Blur")')
    .evaluate((el) => el.className.includes("border-brand-500"));
  console.log("BLUR_SELECTED_ON_FIRST_APPLY (expect true):", blurSelectedFirstOpen);

  console.log("STEP: close the popover");
  await page.click('button[aria-label], button:has-text("✕")');
  await page.waitForTimeout(300);
  const panelGoneAfterClose = await page.locator('button:has-text("Blur")').count();
  console.log("PANEL_UNMOUNTED_AFTER_CLOSE (expect 0 — confirms the popover really did unmount):", panelGoneAfterClose);
  await shot(page, "02-popover-closed");

  console.log("STEP: reopen the popover — is Blur still shown as the active mode? (the real bug under test)");
  await page.click('button:has-text("Background")');
  await page.waitForTimeout(500);
  await shot(page, "03-popover-reopened");
  const blurBtnReopened = page.locator('button:has-text("Blur")');
  await blurBtnReopened.waitFor({ timeout: 5000 });
  const blurSelectedOnReopen = await blurBtnReopened.evaluate((el) =>
    el.className.includes("border-brand-500"),
  );
  const noneBtnReopened = page.locator('button:has-text("None")');
  const noneSelectedOnReopen = await noneBtnReopened.evaluate((el) =>
    el.className.includes("border-brand-500"),
  );
  console.log(
    "BLUR_STILL_SELECTED_ON_REOPEN (expect true — was false/reset-to-None before the fix):",
    blurSelectedOnReopen,
  );
  console.log("NONE_WRONGLY_SELECTED_ON_REOPEN (expect false):", noneSelectedOnReopen);

  console.log("CONSOLE_ERRORS_START");
  for (const e of errors) console.log(" ", e);
  console.log("CONSOLE_ERRORS_END", `(${errors.length} total)`);

  const pass =
    blurSelectedFirstOpen &&
    panelGoneAfterClose === 0 &&
    blurSelectedOnReopen &&
    !noneSelectedOnReopen;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
