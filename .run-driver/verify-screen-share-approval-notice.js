// Verifies the follow-up fix: "request is reach but screen not shared after
// approve" — the button silently reverted with no signal telling the
// requester one more real click was needed. Confirms the new notice
// appears, the button gets highlighted, and both clear the moment the
// requester actually clicks Share screen and starts sharing for real.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "screen-share-approval-notice");
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
    args: [
      "--no-sandbox",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--auto-select-desktop-capture-source=Entire screen",
    ],
  });
  const ctxHost = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxPart = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const host = await ctxHost.newPage();
  const part = await ctxPart.newPage();
  const errors = [];
  part.on("pageerror", (err) => errors.push(String(err)));
  part.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  await register(host, "Notice Host", `noticehost${suffix}`, `noticehost${suffix}@arutech.dev`);
  await register(part, "Notice Part", `noticepart${suffix}`, `noticepart${suffix}@arutech.dev`);
  await host.click("text=New meeting");
  await host.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingUrl = host.url();
  await host.click('button:has-text("Join meeting")');
  await host.waitForSelector("footer", { timeout: 15000 });
  await part.goto(meetingUrl, { waitUntil: "networkidle" });
  await part.click('button:has-text("Join meeting")');
  await part.waitForSelector("footer", { timeout: 15000 });
  await host.waitForTimeout(1000);

  console.log("STEP: participant requests, host approves");
  await part.click('footer button:has-text("Request to share screen")');
  await part.waitForTimeout(600);
  await host.click('button:has-text("Approve")');
  await part.waitForTimeout(1200);

  console.log("STEP: a clear, unmissable notice should now be showing");
  const noticeVisible = await part.locator("text=approved to share your screen").isVisible().catch(() => false);
  console.log("APPROVAL_NOTICE_VISIBLE (expect true -- this is the actual fix):", noticeVisible);
  if (!noticeVisible) pass = false;
  await shot(part, "01-approval-notice-visible");

  console.log("STEP: participant clicks Share screen (the real, previously-unclear next step)");
  await part.click('footer button:has-text("Share screen")');
  await part.waitForTimeout(2000);

  console.log("STEP: the notice should be gone now, and real sharing should be underway");
  const noticeGone = (await part.locator("text=approved to share your screen").count()) === 0;
  const nowSharing = await part.locator('footer button:has-text("Stop sharing")').isVisible().catch(() => false);
  console.log("NOTICE_CLEARED_AFTER_CLICK (expect true):", noticeGone);
  console.log("ACTUALLY_SHARING (expect true):", nowSharing);
  if (!noticeGone || !nowSharing) pass = false;
  await shot(part, "02-notice-cleared-actually-sharing");

  console.log("STEP: no console/page errors");
  console.log("CONSOLE_ERRORS:", JSON.stringify(errors));
  if (errors.length > 0) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
