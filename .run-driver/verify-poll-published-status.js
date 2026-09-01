// Verifies H-5: a freshly published poll couldn't be voted on or closed by
// anyone until someone switched Tools sub-tabs away and back — the
// POLL_PUBLISHED socket payload omitted `status` entirely, and the client
// gates every voting/closing control on status === "OPEN".
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "poll-published-status");
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

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: host + participant join the same meeting");
  await register(host, "Poll Host", `pollhost${suffix}`, `pollhost${suffix}@arutech.dev`);
  await host.click("text=New meeting");
  await host.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingCode = new URL(host.url()).pathname.split("/").pop();
  await host.click('button:has-text("Join meeting")');
  await host.waitForSelector("footer", { timeout: 15000 });

  await register(part, "Poll Voter", `pollvoter${suffix}`, `pollvoter${suffix}@arutech.dev`);
  await part.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await part.click('button:has-text("Join meeting")', { timeout: 15000 });
  await part.waitForSelector("footer", { timeout: 15000 });
  await host.waitForTimeout(1000);

  console.log("STEP: both open Tools -> Polls");
  await host.click('button:has-text("Tools")');
  await host.getByRole("button", { name: "polls", exact: true }).click();
  await part.click('button:has-text("Tools")');
  await part.getByRole("button", { name: "polls", exact: true }).click();
  await host.waitForTimeout(400);

  console.log("STEP: host publishes a real poll");
  await host.fill('input[placeholder="Question"]', "Best time for standup?");
  const optionInputs = host.locator('input[placeholder^="Option "]');
  await optionInputs.nth(0).fill("9am");
  await optionInputs.nth(1).fill("10am");
  await host.click('button:has-text("Publish poll")');

  // No tab switch, no reload — check IMMEDIATELY, which is exactly the bug
  await host.waitForTimeout(500);
  await part.waitForTimeout(500);
  await shot(host, "01-host-immediately-after-publish");
  await shot(part, "02-voter-immediately-after-publish");

  const closeBtnCount = await host.locator('button:has-text("Close")').count();
  console.log("HOST_SEES_CLOSE_BUTTON_IMMEDIATELY (expect >=1 — this is H-5):", closeBtnCount);

  const optionBtn = part.locator('button:has-text("9am")');
  const optionDisabled = await optionBtn.isDisabled();
  console.log("VOTER_OPTION_BUTTON_DISABLED_IMMEDIATELY (expect false — this is H-5):", optionDisabled);

  const pass = closeBtnCount >= 1 && !optionDisabled;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
