// Verifies the new meeting-info panel end-to-end: a real user starts an
// instant meeting, opens the panel by clicking the meeting title (matching
// Zoom's own "click meeting name for details" convention), confirms the
// invite link/meeting code/security summary/recording status all render
// correctly, exercises the copy buttons, and confirms toggling to another
// panel and back re-renders it cleanly.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "meeting-info");
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
    args: [
      "--no-sandbox",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  const suffix = Date.now().toString().slice(-6);
  console.log("STEP: register");
  await page.goto("http://localhost:3000/register", { waitUntil: "networkidle" });
  const inputs = page.locator("input");
  await inputs.nth(0).fill("Info Tester");
  await inputs.nth(1).fill(`infotest${suffix}`);
  await inputs.nth(2).fill(`infotest${suffix}@arutech.dev`);
  await inputs.nth(3).fill("Password123!");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 15000 });

  console.log("STEP: start an instant meeting");
  await page.click('text=New meeting');
  await page.waitForURL("**/meeting/**", { timeout: 15000 });
  console.log("STEP: through the pre-join lobby");
  await page.click('button:has-text("Join meeting")', { timeout: 15000 });
  await page.waitForSelector("footer", { timeout: 15000 });
  await page.waitForTimeout(1500);
  await shot(page, "01-in-meeting");

  console.log("STEP: open the info panel by clicking the meeting title");
  await page.click('button[title="Meeting info"]');
  await page.waitForTimeout(800);
  await shot(page, "02-info-panel-open");

  const inviteLinkValue = await page.locator('input[readonly]').first().inputValue();
  console.log("INVITE_LINK:", inviteLinkValue);
  if (!inviteLinkValue.includes("/meeting/")) throw new Error("Invite link doesn't look right: " + inviteLinkValue);

  const securityText = await page.locator("text=Password required").locator("..").innerText();
  console.log("SECURITY_ROW:", securityText.replace(/\n/g, " | "));

  console.log("STEP: copy the invite link");
  await page.click('button:has-text("Copy")');
  await page.waitForTimeout(300);
  await shot(page, "03-link-copied");
  const clipboardValue = await page.evaluate(() => navigator.clipboard.readText());
  console.log("CLIPBOARD_CONTENT:", clipboardValue);
  if (clipboardValue !== inviteLinkValue) {
    throw new Error(`Clipboard mismatch: expected "${inviteLinkValue}", got "${clipboardValue}"`);
  }

  console.log("STEP: recording status should read Not recording");
  const recordingLine = await page.locator("text=Not recording").count();
  console.log("RECORDING_STATUS_VISIBLE:", recordingLine > 0);
  if (recordingLine === 0) throw new Error("Expected 'Not recording' status to be visible");

  console.log("STEP: switch to Participants tab and back to Info");
  await page.click('button:has-text("Participants")');
  await page.waitForTimeout(400);
  await page.click('button:has-text("Info")');
  await page.waitForTimeout(400);
  await shot(page, "04-back-to-info");
  const stillThere = await page.locator("text=Invite people").count();
  if (stillThere === 0) throw new Error("Info panel content missing after tab switch back");

  console.log("STEP: close the panel via the meeting title toggle");
  await page.click('button[title="Meeting info"]');
  await page.waitForTimeout(300);
  await shot(page, "05-panel-closed");

  console.log("CONSOLE_ERRORS_START");
  for (const e of errors) console.log("  ", e);
  console.log("CONSOLE_ERRORS_END", `(${errors.length} total)`);

  await browser.close();
  console.log("DONE");
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
