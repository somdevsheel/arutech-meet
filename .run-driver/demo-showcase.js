// Creates a durable demo account the user can log into themselves afterward,
// plus a second throwaway participant, and captures a handful of screenshots
// showing the platform actually running (not just launching).
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "demo");
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

  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  console.log("STEP: register durable demo account");
  await pageA.goto("http://localhost:3000/register", { waitUntil: "networkidle" });
  const inputs = pageA.locator("input");
  await inputs.nth(0).fill("Demo User");
  await inputs.nth(1).fill("demo");
  await inputs.nth(2).fill("demo@arutech.dev");
  await inputs.nth(3).fill("DemoPass123!");
  await pageA.click('button[type="submit"]');
  await pageA.waitForURL("**/dashboard", { timeout: 15000 });
  await shot(pageA, "dashboard");

  console.log("STEP: create instant meeting");
  await pageA.click('button:has-text("New meeting")');
  await pageA.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingCode = new URL(pageA.url()).pathname.split("/").pop();
  console.log("MEETING_CODE:", meetingCode);
  await pageA.waitForTimeout(1500);
  await shot(pageA, "prejoin");
  await pageA.click('button:has-text("Join meeting")');
  await pageA.waitForTimeout(3500);

  console.log("STEP: second participant joins");
  await pageB.goto("http://localhost:3000/register", { waitUntil: "networkidle" });
  const inputsB = pageB.locator("input");
  const suffix = Date.now().toString().slice(-5);
  await inputsB.nth(0).fill("Priya Sharma");
  await inputsB.nth(1).fill(`priya${suffix}`);
  await inputsB.nth(2).fill(`priya${suffix}@arutech.dev`);
  await inputsB.nth(3).fill("Password123!");
  await pageB.click('button[type="submit"]');
  await pageB.waitForURL("**/dashboard", { timeout: 15000 });
  await pageB.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await pageB.waitForTimeout(1500);
  const joinBtnB = pageB.locator('button:has-text("Join meeting")');
  if (await joinBtnB.count()) await joinBtnB.first().click();
  await pageB.waitForTimeout(2500);

  const admitBtn = pageA.locator('button:has-text("Admit")');
  try {
    await admitBtn.first().waitFor({ timeout: 8000 });
    await admitBtn.first().click();
  } catch {}
  await pageB.waitForTimeout(4000);

  console.log("STEP: reactions + chat + participants");
  const reactBtn = pageA.locator('button:has-text("React")');
  await reactBtn.first().click();
  await pageA.waitForTimeout(200);
  await pageA.locator("button", { hasText: "🎉" }).first().click();
  await pageA.waitForTimeout(400);
  await shot(pageA, "meeting-room-two-participants-reaction");

  const chatBtn = pageA.locator('button:has-text("Chat")');
  await chatBtn.first().click();
  await pageA.waitForTimeout(300);
  await pageA.locator('input[placeholder="Type message here…"]').fill("Welcome to Arutech Meet 👋");
  await pageA.locator('button[aria-label="Send message"]').click();
  await pageA.waitForTimeout(500);
  await shot(pageA, "meeting-room-chat");

  const speakerBtn = pageA.locator('button:has-text("Speaker")');
  await speakerBtn.first().click();
  await pageA.waitForTimeout(800);
  await shot(pageA, "meeting-room-speaker-view");

  await browser.close();
  console.log("DONE");
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
