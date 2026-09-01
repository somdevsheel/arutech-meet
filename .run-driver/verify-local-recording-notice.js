// Verifies the H-1 fix: starting a LOCAL recording (browser-only
// MediaRecorder, never touches the API) now gives every other participant
// live, visible notice — previously the host's screen stayed completely
// clean the whole time someone else was silently capturing them.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "local-recording-notice");
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
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: A creates + joins a meeting (waiting room off so B admits instantly)");
  await register(pageA, "Watcher A", `watchera${suffix}`, `watchera${suffix}@arutech.dev`);
  await pageA.click("text=New meeting");
  await pageA.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingCode = new URL(pageA.url()).pathname.split("/").pop();
  await pageA.click('button:has-text("Join meeting")');
  await pageA.waitForSelector("footer", { timeout: 15000 });

  console.log("STEP: B (the one who will locally record) joins the same meeting");
  await register(pageB, "Recorder B", `recorderb${suffix}`, `recorderb${suffix}@arutech.dev`);
  await pageB.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await pageB.click('button:has-text("Join meeting")', { timeout: 15000 });
  const sawWaiting = await pageB
    .waitForSelector("text=Waiting for the host", { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (sawWaiting) {
    console.log("STEP: waiting room is on by default (H-4) — A admits B");
    await pageA.waitForTimeout(1500);
    await pageA.click('button[aria-label="Participants"], button:has-text("Participants")').catch(() => {});
    const admitBtn = pageA.locator('button:has-text("Admit")');
    await admitBtn.first().waitFor({ timeout: 8000 });
    await admitBtn.first().click();
  }
  await pageB.waitForSelector("footer", { timeout: 15000 });
  await pageA.waitForTimeout(1500);

  console.log("STEP: A confirms nothing looks off yet (no local-recording banner)");
  const bannerBeforeCount = await pageA.locator("text=started a local recording").count();
  await shot(pageA, "01-a-before-b-records");

  console.log("STEP: B opens Record tab and starts a LOCAL recording");
  await pageB.click('button:has-text("Record")');
  await pageB.click('button:has-text("Start local recording")');
  await shot(pageB, "02-b-local-recording-active");

  console.log("STEP: does A actually see live notice? (the real bug under test)");
  const sawBanner = await pageA
    .waitForSelector("text=Recorder B started a local recording", { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  console.log("A_SAW_LOCAL_RECORDING_NOTICE_LIVE (expect true — was silent before the fix):", sawBanner);
  await shot(pageA, "03-a-sees-local-recording-banner");

  await pageB.click('button:has-text("Stop & save local recording")');
  await pageA.waitForTimeout(500);
  await shot(pageA, "04-a-after-b-stops");

  const pass = bannerBeforeCount === 0 && sawBanner;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
