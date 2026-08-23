// Verifies local (client-side, MediaRecorder-based) recording end-to-end:
// two real participants in a real meeting (real fake-device WebRTC, real
// mixed audio via LiveKit's RoomAudioRenderer <audio> elements), A starts a
// local recording, both participants' video tiles + both audio streams get
// composited for a few seconds, A stops it, and the browser actually
// triggers a real file download — captured here via Playwright's download
// event, not just a "click succeeded" assumption — with a non-trivial size,
// proving MediaRecorder actually produced real encoded video/audio data
// rather than an empty/corrupt blob.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "local-recording");
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
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const errors = { A: [], B: [] };
  for (const [label, page] of [["A", pageA], ["B", pageB]]) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors[label].push(msg.text());
    });
    page.on("pageerror", (err) => errors[label].push(String(err)));
  }

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register host (A) and participant (B)");
  await register(pageA, "Local Rec A", `localreca${suffix}`, `localreca${suffix}@arutech.dev`);
  await register(pageB, "Local Rec B", `localrecb${suffix}`, `localrecb${suffix}@arutech.dev`);

  console.log("STEP: A creates an instant meeting");
  await pageA.click("text=New meeting");
  await pageA.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingCode = new URL(pageA.url()).pathname.split("/").pop();
  await pageA.click('button:has-text("Join meeting")');
  await pageA.waitForSelector("footer", { timeout: 15000 });

  console.log("STEP: B joins (A admits from the waiting room)");
  await pageB.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await pageB.click('button:has-text("Join meeting")', { timeout: 15000 });
  await pageB.waitForTimeout(2000);
  const admitBtn = pageA.locator('button:has-text("Admit")');
  try {
    await admitBtn.first().waitFor({ timeout: 8000 });
    await admitBtn.first().click();
  } catch {
    console.log("No Admit button appeared — B may not have needed admission");
  }
  await pageB.waitForSelector("footer", { timeout: 15000 });
  await pageA.waitForTimeout(2000);
  await shot(pageA, "01-a-both-in-meeting");

  console.log("STEP: A opens the Record panel and starts a LOCAL recording");
  await pageA.click('button:has-text("Record")');
  await pageA.waitForTimeout(500);
  await shot(pageA, "02-a-record-panel-open");
  await pageA.click('button:has-text("Start local recording")');
  await pageA.waitForTimeout(500);
  await shot(pageA, "03-a-local-recording-active");

  const recordingLabelCount = await pageA.locator("text=Stop & save local recording").count();
  console.log("LOCAL_RECORDING_UI_ACTIVE (should be >=1):", recordingLabelCount);
  if (recordingLabelCount === 0) throw new Error("Local recording control never switched to the recording state");

  console.log("STEP: let it capture a few real frames + audio (both participants visible)");
  await pageA.waitForTimeout(4000);
  await shot(pageA, "04-a-recording-in-progress");

  console.log("STEP: A stops local recording — should trigger a real file download");
  const [download] = await Promise.all([
    pageA.waitForEvent("download", { timeout: 15000 }),
    pageA.click('button:has-text("Stop & save local recording")'),
  ]);
  const suggestedName = download.suggestedFilename();
  console.log("DOWNLOAD_FILENAME:", suggestedName);
  if (!suggestedName.startsWith("local-recording-") || !suggestedName.endsWith(".webm")) {
    throw new Error(`Unexpected download filename: ${suggestedName}`);
  }
  const savePath = path.join(shotDir, suggestedName);
  await download.saveAs(savePath);
  const size = fs.statSync(savePath).size;
  console.log("DOWNLOAD_SIZE_BYTES:", size);
  if (size < 1000) throw new Error(`Downloaded recording is suspiciously small (${size} bytes) — likely empty/corrupt`);

  await pageA.waitForTimeout(500);
  await shot(pageA, "05-a-after-stop");
  const backToIdleCount = await pageA.locator("text=Start local recording").count();
  console.log("BACK_TO_IDLE_STATE (should be >=1):", backToIdleCount);
  if (backToIdleCount === 0) throw new Error("Control never returned to the idle 'Start local recording' state");

  console.log("STEP: confirm this never touched the server-side recording (no MeetingRecording row created)");
  const accessToken = await pageA.evaluate(() => JSON.parse(localStorage.getItem("arutech-auth")).state.accessToken);
  const meetingId = await pageA.evaluate(async ({ token, code }) => {
    const res = await fetch("http://localhost:4000/api/v1/meetings", { headers: { Authorization: `Bearer ${token}` } });
    const meetings = await res.json();
    return meetings.find((m) => m.code === code)?.id ?? null;
  }, { token: accessToken, code: meetingCode });
  const serverRecordings = await pageA.evaluate(async ({ token, meetingId }) => {
    const res = await fetch(`http://localhost:4000/api/v1/meetings/${meetingId}/recordings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.json();
  }, { token: accessToken, meetingId });
  console.log("SERVER_SIDE_RECORDINGS_COUNT (should be 0 — local recording never calls the API):", serverRecordings.length);
  if (serverRecordings.length !== 0) throw new Error("Local recording unexpectedly created a server-side recording row");

  console.log("CONSOLE_ERRORS_START");
  for (const label of ["A", "B"]) {
    for (const e of errors[label]) console.log(`  ${label}:`, e);
  }
  const totalErrors = errors.A.length + errors.B.length;
  console.log("CONSOLE_ERRORS_END", `(${totalErrors} total)`);

  await browser.close();
  console.log("DONE");
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
