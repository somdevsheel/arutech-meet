// Regression check for the bug just fixed: local recording used to live
// entirely inside <LocalRecordingControl>, which only rendered while the
// Record panel tab was open — switching to any other tab (Chat, etc.)
// unmounted it, and its unmount-cleanup effect silently stopped the
// MediaRecorder. The fix lifts the recorder into LocalRecordingProvider,
// mounted once for the whole meeting outside the panel-switch conditional.
// This proves the fix live: start local recording, switch panels twice,
// confirm it's still recording (and the elapsed timer kept counting, not
// reset), then stop it and confirm a real non-trivial file still downloads.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "local-recording-panel-switch");
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register + create instant meeting");
  await register(page, "Panel Switch Test", `panelswitch${suffix}`, `panelswitch${suffix}@arutech.dev`);
  await page.click("text=New meeting");
  await page.waitForURL("**/meeting/**", { timeout: 15000 });
  await page.click('button:has-text("Join meeting")');
  await page.waitForSelector("footer", { timeout: 15000 });
  await page.waitForTimeout(1500);

  console.log("STEP: open Record panel, start local recording");
  await page.click('button:has-text("Record")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Start local recording")');
  await page.waitForTimeout(500);
  const activeAfterStart = await page.locator("text=Stop & save local recording").count();
  console.log("ACTIVE_AFTER_START (expect >=1):", activeAfterStart);
  if (activeAfterStart === 0) throw new Error("Local recording never entered the recording state");
  await shot(page, "01-recording-started");

  console.log("STEP: let it run a couple seconds, note elapsed time before switching");
  await page.waitForTimeout(2500);
  const timeBeforeSwitch = await page.locator('button:has-text("Stop & save local recording")').innerText();
  console.log("TIME_BEFORE_SWITCH:", timeBeforeSwitch.trim());

  console.log("STEP: switch to Chat panel (this used to unmount + silently stop the recorder)");
  await page.click('button:has-text("Chat")');
  await page.waitForTimeout(2000);
  await shot(page, "02-switched-to-chat");

  console.log("STEP: switch to Participants panel too, for good measure");
  await page.click('button:has-text("Participants")');
  await page.waitForTimeout(1500);
  await shot(page, "03-switched-to-participants");

  console.log("STEP: switch back to Record panel — is it still recording?");
  await page.click('button:has-text("Record")');
  await page.waitForTimeout(500);
  await shot(page, "04-back-to-record-panel");

  const stillRecordingCount = await page.locator("text=Stop & save local recording").count();
  console.log("STILL_RECORDING_AFTER_PANEL_SWITCHES (expect >=1 — this is the actual bug check):", stillRecordingCount);
  if (stillRecordingCount === 0) {
    throw new Error("BUG STILL PRESENT: recording stopped after switching panels away from Record and back");
  }

  const timeAfterSwitch = await page.locator('button:has-text("Stop & save local recording")').innerText();
  console.log("TIME_AFTER_SWITCH:", timeAfterSwitch.trim());

  function parseSeconds(label) {
    const m = label.match(/(\d{2}):(\d{2})/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }
  const secBefore = parseSeconds(timeBeforeSwitch);
  const secAfter = parseSeconds(timeAfterSwitch);
  console.log("ELAPSED_SECONDS_BEFORE:", secBefore, "ELAPSED_SECONDS_AFTER:", secAfter);
  if (secBefore === null || secAfter === null || secAfter <= secBefore) {
    throw new Error(
      `Elapsed timer did not keep counting across panel switches (before=${secBefore}, after=${secAfter}) — recorder was likely restarted, not preserved`,
    );
  }

  console.log("STEP: stop it — should still trigger a real, non-trivial download");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    page.click('button:has-text("Stop & save local recording")'),
  ]);
  const suggestedName = download.suggestedFilename();
  const savePath = path.join(shotDir, suggestedName);
  await download.saveAs(savePath);
  const size = fs.statSync(savePath).size;
  console.log("DOWNLOAD_FILENAME:", suggestedName, "DOWNLOAD_SIZE_BYTES:", size);
  if (size < 1000) throw new Error(`Downloaded recording is suspiciously small (${size} bytes)`);

  await shot(page, "05-after-stop");
  const backToIdle = await page.locator("text=Start local recording").count();
  console.log("BACK_TO_IDLE_AFTER_STOP (expect >=1):", backToIdle);
  if (backToIdle === 0) throw new Error("Control never returned to idle state after explicit stop");

  console.log("CONSOLE_ERRORS_START");
  for (const e of errors) console.log(" ", e);
  console.log("CONSOLE_ERRORS_END", `(${errors.length} total)`);

  await browser.close();
  console.log("DONE");
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
