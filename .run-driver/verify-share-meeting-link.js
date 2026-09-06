// Verifies: "i need option to share meeting link in meeting home tab and
// also when we start instant meeting there need to be an option to share
// meeting link and code."
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "share-meeting-link");
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

  console.log("STEP: register + schedule a meeting so there's an upcoming row to share from");
  await page.goto("http://localhost:3000/register", { waitUntil: "networkidle" });
  const inputs = page.locator("input");
  await inputs.nth(0).fill("Share Link Test");
  await inputs.nth(1).fill(`sharelink${suffix}`);
  await inputs.nth(2).fill(`sharelink${suffix}@arutech.dev`);
  await inputs.nth(3).fill("Password123!");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 15000 });

  console.log("STEP: schedule a meeting via the Schedule modal");
  await page.click("text=Schedule");
  await page.waitForTimeout(500);
  const titleInput = page.locator('input[placeholder="Weekly sync"]');
  await titleInput.fill("Planning Sync");
  const dateInput = page.locator('input[type="datetime-local"]').first();
  const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 16);
  await dateInput.fill(future);
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await page.waitForTimeout(1200);
  await shot(page, "01-dashboard-with-upcoming-meeting");

  console.log("STEP: the upcoming meeting row now has a real 'Share' button (didn't exist before this fix)");
  const shareBtn = page.locator('li:has-text("Planning Sync") button:has-text("Share")');
  const shareBtnVisible = await shareBtn.isVisible().catch(() => false);
  console.log("SHARE_BUTTON_EXISTS_ON_HOME_TAB (expect true):", shareBtnVisible);
  if (!shareBtnVisible) pass = false;

  await shareBtn.click();
  await page.waitForTimeout(500);
  await shot(page, "02-share-modal-open");
  const modal = page.locator(".fixed.inset-0").last();
  const linkInputVisible = await modal.locator('input[readonly]').first().isVisible().catch(() => false);
  const codeShown = await modal.locator("text=Meeting code:").isVisible().catch(() => false);
  console.log("SHARE_MODAL_SHOWS_LINK (expect true):", linkInputVisible);
  console.log("SHARE_MODAL_SHOWS_CODE (expect true):", codeShown);
  if (!linkInputVisible || !codeShown) pass = false;

  console.log("STEP: copy actually works (real clipboard, not just a label change)");
  await modal.locator('button:has-text("Copy")').first().click();
  await page.waitForTimeout(300);
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  console.log("CLIPBOARD_HAS_A_REAL_MEETING_LINK (expect true):", clipboardText.includes("/meeting/"));
  if (!clipboardText.includes("/meeting/")) pass = false;
  await modal.locator('button[aria-label="Close"]').click();

  console.log("STEP: starting an instant meeting now lands on a lobby that ALSO shows the share box");
  await page.click("text=New meeting");
  await page.waitForURL("**/meeting/**?share=1", { timeout: 15000 }).catch(async () => {
    // fall back to a plain URL wait in case the query string isn't matched literally
    await page.waitForURL("**/meeting/**", { timeout: 15000 });
  });
  await page.waitForTimeout(1000);
  await shot(page, "03-instant-meeting-lobby-with-share-box");
  const urlHasShareParam = page.url().includes("share=1");
  console.log("INSTANT_MEETING_URL_HAS_SHARE_PARAM (expect true):", urlHasShareParam);
  if (!urlHasShareParam) pass = false;
  const lobbyShareBoxVisible = await page.locator("text=Share this meeting").isVisible().catch(() => false);
  console.log("LOBBY_SHOWS_SHARE_BOX (expect true):", lobbyShareBoxVisible);
  if (!lobbyShareBoxVisible) pass = false;
  const lobbyStillShowsPreJoin = await page.locator('button:has-text("Join meeting")').isVisible().catch(() => false);
  console.log("LOBBY_STILL_SHOWS_JOIN_FORM (expect true -- normal join flow unaffected):", lobbyStillShowsPreJoin);
  if (!lobbyStillShowsPreJoin) pass = false;

  console.log("STEP: joining still works normally after this change");
  await page.click('button:has-text("Join meeting")');
  await page.waitForSelector("footer", { timeout: 15000 });
  const inMeetingNow = await page.locator('button:has-text("Mute")').isVisible().catch(() => false);
  console.log("CAN_STILL_ACTUALLY_JOIN_THE_MEETING (expect true):", inMeetingNow);
  if (!inMeetingNow) pass = false;
  await shot(page, "04-joined-meeting-normally");

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
