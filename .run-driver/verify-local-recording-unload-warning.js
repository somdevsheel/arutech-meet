// Verifies M-6: closing the tab mid-local-recording gave no warning at all
// — the buffered MediaRecorder chunks live only in memory and are never
// written to disk until an explicit Stop click runs `onstop`, so an actual
// tab close (unlike the in-app Leave button, which already correctly saves
// via unmount cleanup) silently lost the whole recording. Fix: a
// `beforeunload` handler while recording is active, surfaced by the browser
// as its own native "leave site?" confirmation.
//
// A real top-level navigation (reload) is what actually exercises
// `beforeunload` — a Next.js client-side route change never does, and
// closing a Page/BrowserContext programmatically via Playwright/CDP does
// NOT reliably trigger it either (a documented automation limitation, not
// something the app controls) — reload is the faithful, reliable trigger.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "local-recording-unload-warning");
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

/** Reloads the page (a real top-level navigation, unlike Next's client-side
 * routing) while watching for a beforeunload dialog, always accepting it so
 * the reload actually completes and the page is left in a clean, known
 * state for whatever comes next. */
async function reloadAndWatchForBeforeUnload(page) {
  let sawBeforeUnload = false;
  const onDialog = async (dialog) => {
    if (dialog.type() === "beforeunload") sawBeforeUnload = true;
    await dialog.accept().catch(() => {});
  };
  page.on("dialog", onDialog);
  await page.reload({ waitUntil: "networkidle" });
  page.off("dialog", onDialog);
  return sawBeforeUnload;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("STEP: register + create + join an instant meeting");
  await register(page, "Local Rec QA", `localrecqa${suffix}`, `localrecqa${suffix}@arutech.dev`);
  await page.click("text=New meeting");
  await page.waitForURL("**/meeting/**", { timeout: 15000 });
  await page.click('button:has-text("Join meeting")');
  await page.waitForSelector("footer", { timeout: 15000 });

  console.log("STEP: CASE 1 — nothing recording yet, reload: expect NO warning");
  await shot(page, "01-joined-not-recording");
  const case1 = await reloadAndWatchForBeforeUnload(page);
  console.log("CASE1_SAW_WARNING (expect false — nothing to lose yet):", case1);
  if (case1) pass = false;

  console.log("STEP: rejoin (the reload above dropped us back to the dashboard), start LOCAL recording");
  await page.click('button:has-text("Join meeting")');
  await page.waitForSelector("footer", { timeout: 15000 });
  await page.click('button:has-text("Record")');
  await page.click('button:has-text("Start local recording")');
  await page.waitForSelector("text=Stop & save local recording", { timeout: 8000 });
  await shot(page, "02-recording-active-before-reload");

  console.log("STEP: CASE 2 — LOCAL recording active, reload: expect a REAL beforeunload warning");
  const case2 = await reloadAndWatchForBeforeUnload(page);
  console.log("CASE2_SAW_WARNING (expect true — this is the actual M-6 fix):", case2);
  if (!case2) pass = false;

  console.log("STEP: rejoin again, start + explicitly STOP the recording this time");
  await page.click('button:has-text("Join meeting")');
  await page.waitForSelector("footer", { timeout: 15000 });
  await page.click('button:has-text("Record")');
  await page.click('button:has-text("Start local recording")');
  await page.waitForSelector("text=Stop & save local recording", { timeout: 8000 });
  await page.click('button:has-text("Stop & save local recording")');
  await page.waitForSelector('button:has-text("Start local recording")', { timeout: 8000 });
  await shot(page, "03-recording-stopped-before-reload");

  console.log("STEP: CASE 3 — recording already stopped, reload: expect NO warning again");
  const case3 = await reloadAndWatchForBeforeUnload(page);
  console.log("CASE3_SAW_WARNING (expect false — nothing left to lose):", case3);
  if (case3) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
