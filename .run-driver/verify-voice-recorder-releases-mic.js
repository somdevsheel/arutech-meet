// Verifies the actual bug: useVoiceRecorder only ever released the
// microphone (stream.getTracks().forEach(t => t.stop())) inside stop() and
// cancel() — both purely reactive to an explicit user click. Nothing ran if
// the component using this hook unmounted while a recording was still in
// progress (navigating away, closing the panel), so the real
// getUserMedia() audio track just kept running forever: the browser's
// mic-active indicator stayed on indefinitely with no way to turn it off
// short of reloading the whole page.
//
// This script instruments the real MediaStreamTrack the browser hands back
// from a genuine getUserMedia({audio:true}) call (no mocking of the app's
// own code — just observing the standard Web API from the test harness),
// starts a real recording through the actual "Record a voice message"
// button, then navigates away WITHOUT ever clicking Stop or Cancel — the
// exact scenario named in the finding — and checks the track's real
// `readyState`. A track's readyState transitions from "live" to "ended"
// if and only if something actually called .stop() on it; there is no
// other way to observe this except watching the real browser API, which is
// exactly what this does.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "voice-recorder-mic-release");
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
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  const suffix = Date.now().toString().slice(-6);

  console.log(
    "STEP: register a user + a second contact, create a real DM room so Team Chat has something selected",
  );
  await register(page, "Mic Test User", `mictest${suffix}`, `mictest${suffix}@arutech.dev`);
  const authRes = await fetch("http://localhost:4000/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `mictest${suffix}@arutech.dev`, password: "Password123!" }),
  });
  const auth = await authRes.json();
  const other = await fetch("http://localhost:4000/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      displayName: "Mic Test Other",
      username: `mictestother${suffix}`,
      email: `mictestother${suffix}@arutech.dev`,
      password: "Password123!",
    }),
  }).then((r) => r.json());
  await fetch("http://localhost:4000/api/v1/chat-rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.accessToken}` },
    body: JSON.stringify({ type: "DIRECT", memberUserIds: [other.user.id] }),
  });

  console.log(
    "STEP: instrument the REAL getUserMedia so we can observe the REAL MediaStreamTrack's readyState later — not mocking anything about the app itself, just watching the standard Web API",
  );
  await page.goto("http://localhost:3000/chat", { waitUntil: "networkidle" });
  await page.waitForSelector("text=Team Chat", { timeout: 15000 });
  await page.evaluate(() => {
    window.__capturedAudioTracks = [];
    const origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await origGUM(constraints);
      if (constraints && constraints.audio) {
        stream.getAudioTracks().forEach((t) => window.__capturedAudioTracks.push(t));
      }
      return stream;
    };
  });

  console.log("STEP: start a real voice recording via the actual UI button");
  await page.waitForTimeout(500);
  await page.click('button[title="Record a voice message"]');
  await page.waitForTimeout(1500);
  await shot(page, "01-recording-in-progress");

  const trackCountAfterStart = await page.evaluate(() => window.__capturedAudioTracks.length);
  const readyStateAfterStart = await page.evaluate(
    () => window.__capturedAudioTracks[0]?.readyState,
  );
  console.log("REAL_MIC_TRACK_CAPTURED (expect 1):", trackCountAfterStart);
  console.log("MIC_TRACK_READYSTATE_WHILE_RECORDING (expect 'live'):", readyStateAfterStart);

  console.log(
    "STEP: navigate AWAY without ever clicking Stop or Cancel — the exact scenario named in the finding (closing the panel / navigating away mid-recording)",
  );
  await page.locator('a[href="/dashboard"]').first().click();
  await page.waitForTimeout(1000);
  await shot(page, "02-navigated-away-still-recording-when-we-left");

  const readyStateAfterNavigate = await page.evaluate(
    () => window.__capturedAudioTracks[0]?.readyState,
  );
  console.log(
    "MIC_TRACK_READYSTATE_AFTER_NAVIGATING_AWAY (expect 'ended' — was 'live' forever before the fix):",
    readyStateAfterNavigate,
  );

  console.log("CONSOLE_ERRORS_START");
  for (const e of errors) console.log(" ", e);
  console.log("CONSOLE_ERRORS_END", `(${errors.length} total)`);

  const pass =
    trackCountAfterStart === 1 &&
    readyStateAfterStart === "live" &&
    readyStateAfterNavigate === "ended";
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
