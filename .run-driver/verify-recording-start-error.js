// Verifies M-5: starting server-side recording gave a long frozen wait (the
// Start Recording button just went disabled with no label change) followed
// by a bare "Internal server error" once LiveKit's egress dispatch timed
// out (no egress worker registered — reproducible any time the egress
// service is down/unreachable, exactly this local environment's real
// state). Real fix: a clear "Starting…" label during the wait, and a real,
// actionable error afterward instead of the generic 500.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "recording-start-error");
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("STEP: register + create + join an instant meeting (real LiveKit room, no egress worker running)");
  await register(page, "Recording QA", `recqaui${suffix}`, `recqaui${suffix}@arutech.dev`);
  await page.click("text=New meeting");
  await page.waitForURL("**/meeting/**", { timeout: 15000 });
  await page.click('button:has-text("Join meeting")');
  await page.waitForSelector("footer", { timeout: 15000 });

  console.log("STEP: open the Record panel and click Start recording");
  await page.click('button:has-text("Record")');
  await page.waitForSelector('button:has-text("Start recording")', { timeout: 8000 });

  const startedAt = Date.now();
  await page.click('button:has-text("Start recording")');

  console.log("STEP: the button must show a real busy label immediately, not just go disabled and look frozen");
  const showsStartingLabel = await page
    .waitForSelector('button:has-text("Starting…")', { timeout: 2000 })
    .then(() => true)
    .catch(() => false);
  console.log("BUTTON_SHOWS_STARTING_LABEL (expect true — this is half of M-5):", showsStartingLabel);
  if (!showsStartingLabel) pass = false;
  await shot(page, "01-starting-label-visible");

  console.log("STEP: wait for the real (~10s) egress dispatch to fail, then check the error shown");
  await page.waitForSelector("text=/couldn't start recording/i", { timeout: 15000 }).catch(() => {});
  const elapsedMs = Date.now() - startedAt;
  await shot(page, "02-clear-error-after-wait");

  const clearErrorVisible = await page.locator("text=/couldn't start recording/i").count();
  const bareInternalErrorVisible = await page.locator("text=/internal server error/i").count();
  console.log(`ELAPSED_MS: ${elapsedMs} (expect a real multi-second wait, confirming this hit the real timeout path)`);
  console.log("SHOWS_CLEAR_ACTIONABLE_ERROR (expect >=1):", clearErrorVisible);
  console.log("SHOWS_BARE_INTERNAL_SERVER_ERROR (expect 0):", bareInternalErrorVisible);
  if (clearErrorVisible < 1 || bareInternalErrorVisible !== 0 || elapsedMs < 3000) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
