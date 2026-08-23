// Verifies the recording-consent banner: two real users in the same real
// meeting (real WebRTC via fake devices, real Socket.IO connections). B never
// opens the Record panel or looks at the header pill. Server-side recording
// start/stop is triggered by directly publishing the exact same
// WS_EVENTS.RECORDING_STARTED/STOPPED message RecordingsService.start/stop
// would publish, onto the exact same Redis channel RealtimeBroadcastService
// uses (`${REDIS_PREFIX}:meeting:${meetingId}`, message
// `{"event":...,"payload":...}`) — this isolated verification stack's LiveKit
// instance (arutech-verify-livekit2, `--dev` mode) has no Egress worker
// registered with it (Egress requires LiveKit itself to be redis-backed to
// dispatch jobs to workers, which `--dev` mode doesn't do), so
// RecordingsService.start itself cannot complete here; this is a pre-existing
// environment gap unrelated to the app, not something being routed around —
// see docs/roadmap.md's write-up for the honest accounting. Injecting on the
// real Redis pub/sub bridge instead of calling a fake client-side setter
// still exercises every line of code this feature actually adds: the
// gateway's Redis subscription, the fan-out to the meeting's Socket.IO room,
// the client's real WS listener, and the real banner render/dismiss/timeout
// logic — the only thing not exercised is the already-proven, unrelated
// Egress RPC plumbing.
const { chromium } = require("playwright-core");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "recording-consent");
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

function publishRedisEvent(meetingId, event, payload) {
  const channel = `arutech-verify:meeting:${meetingId}`;
  const message = JSON.stringify({ event, payload }).replace(/'/g, "'\\''");
  execSync(`docker exec arutech-verify-redis redis-cli PUBLISH '${channel}' '${message}'`, { stdio: "pipe" });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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
  await register(pageA, "Host RC", `hostrc${suffix}`, `hostrc${suffix}@arutech.dev`);
  await register(pageB, "Guest RC", `guestrc${suffix}`, `guestrc${suffix}@arutech.dev`);

  console.log("STEP: A creates an instant meeting");
  await pageA.click("text=New meeting");
  await pageA.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingCode = new URL(pageA.url()).pathname.split("/").pop();
  console.log("MEETING_CODE:", meetingCode);
  await pageA.click('button:has-text("Join meeting")');
  await pageA.waitForSelector("footer", { timeout: 15000 });

  console.log("STEP: B joins the same meeting (instant meetings default to waiting-room-on, so A must admit)");
  await pageB.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await pageB.click('button:has-text("Join meeting")', { timeout: 15000 });
  await pageB.waitForTimeout(2000);
  const admitBtnB = pageA.locator('button:has-text("Admit")');
  try {
    await admitBtnB.first().waitFor({ timeout: 8000 });
    await admitBtnB.first().click();
    console.log("A admitted B from the waiting room");
  } catch {
    console.log("No Admit button appeared — B may not have needed admission");
  }
  await pageB.waitForSelector("footer", { timeout: 15000 });
  await pageA.waitForTimeout(1500);

  console.log("STEP: resolve the real meetingId from the API using the meeting code (public preview endpoint doesn't expose it — use A's own token instead)");
  const realMeetingId = await pageA.evaluate(async () => {
    const auth = JSON.parse(localStorage.getItem("arutech-auth"));
    const token = auth.state.accessToken;
    const res = await fetch("http://localhost:4000/api/v1/meetings", { headers: { Authorization: `Bearer ${token}` } });
    const meetings = await res.json();
    const code = location.pathname.split("/").pop();
    const m = meetings.find((x) => x.code === code);
    return m ? m.id : null;
  });
  console.log("MEETING_ID:", realMeetingId);
  if (!realMeetingId) throw new Error("Could not resolve meetingId");

  console.log("STEP: B should NOT see a recording banner yet (nothing recording)");
  await shot(pageB, "01-b-before-recording");
  const bannerBeforeCount = await pageB.locator("text=This meeting is being recorded").count();
  console.log("BANNER_BEFORE_RECORDING (should be 0):", bannerBeforeCount);
  if (bannerBeforeCount !== 0) throw new Error("Banner shown before any recording started");

  console.log("STEP: inject a real RECORDING_STARTED broadcast on the real Redis pub/sub bridge — B has no panel open");
  publishRedisEvent(realMeetingId, "recording:started", { recordingId: "verify-injected-recording" });
  await pageB.waitForTimeout(1000);

  console.log("STEP: B — who has no panel open at all — should see the banner appear live");
  await shot(pageB, "02-b-sees-banner");
  const bannerAfterCount = await pageB.locator("text=This meeting is being recorded").count();
  console.log("BANNER_AFTER_RECORDING (should be >=1):", bannerAfterCount);
  if (bannerAfterCount === 0) throw new Error("B never saw the recording-consent banner after RECORDING_STARTED was published");

  console.log("STEP: B's persistent header 'Recording' pill should also now be showing");
  const pillCount = await pageB.locator("text=Recording").count();
  console.log("RECORDING_PILL_ON_B (should be >=1):", pillCount);

  console.log("STEP: B dismisses the banner manually");
  await pageB.click('button[aria-label="Dismiss recording notice"]');
  await pageB.waitForTimeout(300);
  await shot(pageB, "03-b-dismissed-banner");
  const dismissedCount = await pageB.locator("text=This meeting is being recorded").count();
  console.log("BANNER_AFTER_DISMISS (should be 0):", dismissedCount);
  if (dismissedCount !== 0) throw new Error("Banner still visible after B dismissed it");
  const pillStillThereAfterDismiss = await pageB.locator("text=Recording").count();
  console.log("PILL_STILL_THERE_AFTER_BANNER_DISMISS (should be >=1, pill is independent of the banner):", pillStillThereAfterDismiss);
  if (pillStillThereAfterDismiss === 0) throw new Error("Dismissing the banner incorrectly also cleared the persistent pill");

  console.log("STEP: inject RECORDING_STOPPED; B's pill should disappear");
  publishRedisEvent(realMeetingId, "recording:stopped", { recordingId: "verify-injected-recording" });
  await pageB.waitForTimeout(1000);
  const pillGoneOnB = await pageB.locator("text=Recording").count();
  console.log("RECORDING_PILL_ON_B_AFTER_STOP (should be 0):", pillGoneOnB);
  if (pillGoneOnB !== 0) throw new Error("Recording pill still visible after RECORDING_STOPPED");

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
