const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots");
fs.mkdirSync(shotDir, { recursive: true });
let shotN = 0;
async function shot(page, label) {
  shotN += 1;
  const file = path.join(shotDir, `${String(shotN).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log("SCREENSHOT:", file);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: [
      "--no-sandbox",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  console.log("STEP: home page");
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
  await shot(page, "home");

  console.log("STEP: register a fresh user");
  await page.goto("http://localhost:3000/register", { waitUntil: "networkidle" });
  const suffix = Date.now().toString().slice(-6);
  const inputs = page.locator("input");
  await inputs.nth(0).fill("Demo User"); // display name
  await inputs.nth(1).fill(`demo${suffix}`); // username
  await inputs.nth(2).fill(`demo${suffix}@arutech.dev`); // email
  await inputs.nth(3).fill("Password123!"); // password
  await shot(page, "register-filled");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 15000 });
  await page.waitForSelector("text=Welcome", { timeout: 15000 });
  await shot(page, "dashboard");

  console.log("STEP: create an instant meeting");
  await page.click('button:has-text("New meeting")');
  await page.waitForURL("**/meeting/**", { timeout: 15000 });
  await page.waitForTimeout(2000); // let the PreJoin device-preview component mount
  await shot(page, "prejoin-lobby");

  console.log("STEP: join the meeting");
  const joinButton = page.locator('button:has-text("Join meeting")');
  if (await joinButton.count()) {
    await joinButton.first().click();
    await page.waitForTimeout(4000); // LiveKit connect + local track publish
    await shot(page, "meeting-room");
  } else {
    console.log("Join button not found on lobby — screenshotting current state instead");
    await shot(page, "prejoin-lobby-2");
  }

  console.log("CONSOLE_ERRORS_START");
  for (const e of errors) console.log("  -", e);
  console.log("CONSOLE_ERRORS_END", `(${errors.length} total)`);

  await browser.close();
  console.log("DONE");
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
