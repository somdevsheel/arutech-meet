// Verifies the follow-up report (with a screenshot of the actual toolbar):
// "i need here sharing meeting link option here" — the only way to grab
// the invite link from inside a running meeting was clicking the meeting
// title in the header, with no obvious "share" affordance anywhere. Now
// there's a dedicated Invite button right in the toolbar next to
// Participants/Chat.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "toolbar-invite-button");
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("STEP: register + join an instant meeting");
  await page.goto("http://localhost:3000/register", { waitUntil: "networkidle" });
  const inputs = page.locator("input");
  await inputs.nth(0).fill("Invite Btn Test");
  await inputs.nth(1).fill(`invitebtn${suffix}`);
  await inputs.nth(2).fill(`invitebtn${suffix}@arutech.dev`);
  await inputs.nth(3).fill("Password123!");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 15000 });
  await page.click("text=New meeting");
  await page.waitForURL("**/meeting/**", { timeout: 15000 });
  await page.click('button:has-text("Join meeting")');
  await page.waitForSelector("footer", { timeout: 15000 });
  await page.waitForTimeout(1000);

  console.log("STEP: a real 'Invite' button now sits right in the toolbar (didn't exist before)");
  const inviteBtn = page.locator('footer').getByText("Invite", { exact: true });
  const inviteBtnVisible = await inviteBtn.isVisible().catch(() => false);
  console.log("INVITE_BUTTON_IN_TOOLBAR (expect true):", inviteBtnVisible);
  if (!inviteBtnVisible) pass = false;
  await shot(page, "01-toolbar-with-invite-button");

  console.log("STEP: clicking it shows the real link/code inline, no navigation needed");
  await inviteBtn.click();
  await page.waitForTimeout(500);
  await shot(page, "02-invite-popover-open");
  const linkVisible = await page.locator('input[readonly]').first().isVisible().catch(() => false);
  const codeVisible = await page.locator("text=Meeting code:").isVisible().catch(() => false);
  console.log("POPOVER_SHOWS_LINK (expect true):", linkVisible);
  console.log("POPOVER_SHOWS_CODE (expect true):", codeVisible);
  if (!linkVisible || !codeVisible) pass = false;

  console.log("STEP: copy actually puts a real meeting link on the clipboard");
  await page.locator('button:has-text("Copy")').first().click();
  await page.waitForTimeout(300);
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  console.log("CLIPBOARD_HAS_REAL_LINK (expect true):", clipboardText.includes("/meeting/"));
  if (!clipboardText.includes("/meeting/")) pass = false;

  console.log("STEP: closing it and using the rest of the toolbar still works normally");
  await page.locator('footer button[aria-label="Close"]').click();
  await page.waitForTimeout(300);
  await page.getByText("Mute", { exact: true }).click();
  await page.waitForTimeout(300);
  const unmuted = await page.getByText("Unmute", { exact: true }).isVisible().catch(() => false);
  console.log("REST_OF_TOOLBAR_STILL_WORKS (expect true):", unmuted);
  if (!unmuted) pass = false;
  await shot(page, "03-toolbar-still-works-after-closing-invite");

  console.log("STEP: no console/page errors");
  console.log("PAGE_ERRORS:", JSON.stringify(errors));
  if (errors.length > 0) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
