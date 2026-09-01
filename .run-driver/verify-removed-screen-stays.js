// Verifies H-3: the "You were removed" screen used to flash for ~150ms and
// then auto-navigate away ~200-350ms later on its own — a delayed
// LiveKit-disconnect echo overriding the deliberate "stays until you click
// Back to dashboard" screen. Measures how long the removed screen actually
// stays on screen with no click at all.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "removed-screen-stays");
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
  const ctxHost = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const ctxPart = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const host = await ctxHost.newPage();
  const part = await ctxPart.newPage();
  part.on("console", (msg) => console.log("PART_CONSOLE:", msg.text()));

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: host creates + joins a meeting");
  await register(host, "Remove Host", `removehost${suffix}`, `removehost${suffix}@arutech.dev`);
  await host.click("text=New meeting");
  await host.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingCode = new URL(host.url()).pathname.split("/").pop();
  await host.click('button:has-text("Join meeting")');
  await host.waitForSelector("footer", { timeout: 15000 });

  console.log("STEP: participant joins");
  await register(part, "Removable Part", `removablepart${suffix}`, `removablepart${suffix}@arutech.dev`);
  await part.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await part.click('button:has-text("Join meeting")', { timeout: 15000 });
  const sawWaiting = await part
    .waitForSelector("text=Waiting for the host", { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (sawWaiting) {
    await host.waitForTimeout(1500);
    await host.click('button[aria-label="Participants"], button:has-text("Participants")').catch(() => {});
    const admitBtn = host.locator('button:has-text("Admit")');
    await admitBtn.first().waitFor({ timeout: 8000 });
    await admitBtn.first().click();
  }
  await part.waitForSelector("footer", { timeout: 15000 });
  await host.waitForTimeout(1500);

  console.log("STEP: host removes the participant");
  await host.click('button:has-text("Participants")');
  await host.waitForTimeout(500);
  const removeBtn = host.locator('button[title="Remove"]');
  await removeBtn.first().waitFor({ timeout: 8000 });
  const clickTime = Date.now();
  await removeBtn.first().click();

  const removedScreenAppeared = await part
    .waitForSelector("text=/removed you from this meeting/i", { timeout: 8000 })
    .then(() => Date.now())
    .catch(() => null);
  const msToRemovedScreen = removedScreenAppeared ? removedScreenAppeared - clickTime : null;
  console.log("MS_TO_REMOVED_SCREEN:", msToRemovedScreen);
  await shot(part, "01-part-sees-removed-screen");

  // The actual regression test: wait a full 2s with NO click on the removed
  // screen's own button, then check it's STILL showing — before the fix
  // this would already have silently auto-navigated to the dashboard well
  // within this window.
  await part.waitForTimeout(2000);
  const stillOnRemovedScreen = await part.locator("text=/removed you from this meeting/i").count();
  const currentUrl = part.url();
  console.log("STILL_ON_REMOVED_SCREEN_AFTER_2S_NO_CLICK (expect >=1):", stillOnRemovedScreen);
  console.log("URL_AFTER_2S_NO_CLICK (expect still /meeting/..., NOT auto-navigated):", currentUrl);
  await shot(part, "02-part-still-on-removed-screen-2s-later");

  console.log("STEP: NOW click the screen's own button — that's the only thing that should navigate");
  await part.click('button:has-text("Back to dashboard")');
  await part.waitForURL("**/dashboard", { timeout: 8000 }).catch(() => {});
  console.log("URL_AFTER_EXPLICIT_CLICK:", part.url());
  await shot(part, "03-part-after-explicit-click");

  const pass =
    msToRemovedScreen !== null &&
    stillOnRemovedScreen >= 1 &&
    currentUrl.includes("/meeting/") &&
    part.url().includes("/dashboard");
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
