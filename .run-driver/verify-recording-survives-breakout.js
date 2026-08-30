// Verifies the actual bug: joining a breakout room used to force-remount
// <LiveKitRoom>, which took LocalRecordingProvider down with it — a
// recording in progress silently stopped and force-downloaded a partial
// file with no warning. LocalRecordingProvider now wraps LiveKitRoom from
// the outside and captures its own independent mic stream, so it should
// survive the room switch entirely: still "recording" (Stop button, timer
// still counting) once inside the breakout room, and only produce a
// download when the user actually clicks Stop.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "recording-survives-breakout");
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
      // Real local recording needs a real mic capture path exercised twice
      // now (LiveKit's own + our independent getUserMedia) — fake device
      // flags above already cover both, no extra permission prompt to grant.
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register host, create meeting");
  await register(page, "Rec Breakout Host", `recbo${suffix}`, `recbo${suffix}@arutech.dev`);
  await page.click("text=New meeting");
  await page.waitForURL("**/meeting/**", { timeout: 15000 });
  await page.click('button:has-text("Join meeting")');
  await page.waitForSelector("footer", { timeout: 15000 });
  await page.waitForTimeout(1000);

  console.log("STEP: start local recording");
  await page.click('button:has-text("Record")');
  await page.waitForTimeout(400);
  await page.click('button:has-text("Start local recording")');
  await page.waitForTimeout(500);
  const activeAfterStart = await page.locator("text=Stop & save local recording").count();
  console.log("ACTIVE_AFTER_START (expect >=1):", activeAfterStart);
  if (activeAfterStart === 0) throw new Error("Local recording never entered the recording state");
  await shot(page, "01-recording-started-in-main-room");

  console.log("STEP: let it run a couple seconds, note elapsed time before switching to breakout");
  await page.waitForTimeout(2500);
  const timeBefore = await page.locator('button:has-text("Stop & save local recording")').innerText();
  console.log("TIME_BEFORE_BREAKOUT:", timeBefore.trim());

  console.log("STEP: create a breakout room (auto-assign) and join it — this used to kill the recording");
  await page.click('button:has-text("Tools")');
  await page.waitForTimeout(300);
  const breakoutTab = page.locator('button:has-text("Breakout")');
  if (await breakoutTab.count()) await breakoutTab.click();
  await page.waitForTimeout(300);
  await page.fill('input[type="number"]', "1");
  await page.click('button:has-text("Create & auto-assign")');
  await page.waitForTimeout(1500);
  // Host isn't auto-assigned (moderators are excluded), so join any room directly.
  const joinRoomBtn = page.locator('button:has-text("Join")').last();
  await joinRoomBtn.click();
  await page.waitForTimeout(2500);
  await shot(page, "02-joined-breakout-room");

  const inBreakoutPill = await page.locator("text=Breakout:").count();
  console.log("CONFIRMED_IN_BREAKOUT_ROOM (expect >=1):", inBreakoutPill);

  console.log("STEP: is the recording still active? (the actual fix under test — used to be silently stopped here)");
  await page.click('button:has-text("Record")');
  await page.waitForTimeout(500);
  const stillRecording = await page.locator("text=Stop & save local recording").count();
  console.log("STILL_RECORDING_AFTER_BREAKOUT_JOIN (expect >=1 — this is the bug check):", stillRecording);
  if (stillRecording === 0) {
    throw new Error("BUG STILL PRESENT: recording stopped after joining a breakout room");
  }
  const timeAfter = await page.locator('button:has-text("Stop & save local recording")').innerText();
  console.log("TIME_AFTER_BREAKOUT:", timeAfter.trim());

  function parseSeconds(label) {
    const m = label.match(/(\d{2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }
  const secBefore = parseSeconds(timeBefore);
  const secAfter = parseSeconds(timeAfter);
  console.log("ELAPSED_BEFORE:", secBefore, "ELAPSED_AFTER:", secAfter, "(expect after > before — never reset)");
  if (secBefore === null || secAfter === null || secAfter <= secBefore) {
    throw new Error(`Elapsed timer did not keep counting across the breakout join (before=${secBefore}, after=${secAfter})`);
  }
  await shot(page, "03-still-recording-inside-breakout-room");

  console.log("STEP: stop it — still produces a real, non-trivial download from inside the breakout room");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    page.click('button:has-text("Stop & save local recording")'),
  ]);
  const savePath = path.join(shotDir, download.suggestedFilename());
  await download.saveAs(savePath);
  const size = fs.statSync(savePath).size;
  console.log("DOWNLOAD_FILENAME:", download.suggestedFilename(), "SIZE_BYTES:", size);
  if (size < 1000) throw new Error(`Downloaded recording is suspiciously small (${size} bytes)`);

  console.log("CONSOLE_ERRORS_START");
  for (const e of errors) console.log(" ", e);
  console.log("CONSOLE_ERRORS_END", `(${errors.length} total)`);

  await browser.close();
  console.log("DONE");
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
