// Verifies virtual background actually processes video pixels (not just UI
// state) — screenshots before/after should visibly differ if real
// segmentation + compositing is happening on the published track.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "virtual-background");
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  const suffix = Date.now().toString().slice(-6);
  console.log("STEP: register and join a meeting");
  await page.goto("http://localhost:3000/register", { waitUntil: "networkidle" });
  const inputs = page.locator("input");
  await inputs.nth(0).fill("Vera Background");
  await inputs.nth(1).fill(`vera${suffix}`);
  await inputs.nth(2).fill(`vera${suffix}@arutech.dev`);
  await inputs.nth(3).fill("Password123!");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 15000 });
  await page.click('button:has-text("New meeting")');
  await page.waitForURL("**/meeting/**", { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.click('button:has-text("Join meeting")');
  await page.waitForTimeout(3000);
  await shot(page, "before-any-effect");

  console.log("STEP: open background panel");
  await page.click('button:has-text("Background")');
  await page.waitForTimeout(400);
  await shot(page, "panel-open");

  console.log("STEP: apply blur");
  await page.click('button:has-text("Blur")');
  await page.waitForTimeout(4000); // model load + first segmented frames
  await shot(page, "blur-applied");

  console.log("STEP: apply Ocean preset image background");
  await page.click('button[title="Ocean"]');
  await page.waitForTimeout(2500);
  await shot(page, "image-background-applied");

  console.log("STEP: back to none");
  await page.click('button:has-text("None")');
  await page.waitForTimeout(1000);
  await shot(page, "back-to-none");

  console.log("CONSOLE_ERRORS_START");
  for (const e of errors) console.log("  -", e);
  console.log("CONSOLE_ERRORS_END", `(${errors.length} total)`);

  await browser.close();
  console.log("DONE");
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
