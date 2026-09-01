// Verifies H-2: every authenticated participant's video tile was labeled
// with their raw User.id UUID instead of their real display name.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "video-tile-display-name");
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

  console.log("STEP: A creates + joins a meeting");
  await register(pageA, "Priya Sharma", `priyasharma${suffix}`, `priya${suffix}@arutech.dev`);
  await pageA.click("text=New meeting");
  await pageA.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingCode = new URL(pageA.url()).pathname.split("/").pop();
  await pageA.click('button:has-text("Join meeting")');
  await pageA.waitForSelector("footer", { timeout: 15000 });

  console.log("STEP: B joins the same meeting");
  await register(pageB, "Devon Okafor", `devonokafor${suffix}`, `devon${suffix}@arutech.dev`);
  await pageB.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await pageB.click('button:has-text("Join meeting")', { timeout: 15000 });
  const sawWaiting = await pageB
    .waitForSelector("text=Waiting for the host", { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (sawWaiting) {
    await pageA.waitForTimeout(1500);
    await pageA.click('button[aria-label="Participants"], button:has-text("Participants")').catch(() => {});
    const admitBtn = pageA.locator('button:has-text("Admit")');
    await admitBtn.first().waitFor({ timeout: 8000 });
    await admitBtn.first().click();
  }
  await pageB.waitForSelector("footer", { timeout: 15000 });
  await pageA.waitForTimeout(1500);

  await shot(pageA, "01-a-video-grid");

  const aTileText = await pageA.locator("[data-video-grid-root]").innerText();
  console.log("VIDEO_GRID_TEXT_ON_A:", JSON.stringify(aTileText));

  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const hasUuid = uuidPattern.test(aTileText);
  const hasPriya = aTileText.includes("Priya Sharma");
  const hasDevon = aTileText.includes("Devon Okafor");

  console.log("NO_RAW_UUID_VISIBLE (expect true):", !hasUuid);
  console.log("SEES_A_REAL_NAME (Priya Sharma):", hasPriya);
  console.log("SEES_B_REAL_NAME (Devon Okafor):", hasDevon);

  const pass = !hasUuid && hasPriya && hasDevon;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
