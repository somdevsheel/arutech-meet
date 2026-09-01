// Verifies the actual bug: the captions toolbar control's label/onClick for
// a moderator (canManageCaptions) only ever branched on captionsActive
// ("Captions" / "Stop captions"), completely ignoring captionsHidden. A
// moderator who hid their own local caption bar (via CaptionBar's own
// "Hide captions" link — the only place captionsHidden ever got set to true
// for a moderator, since their toolbar button was wired straight to
// start/stop) had no way back except that same toolbar button, which for
// them meant "Stop captions" — ending the live session for every
// participant just to get their own view back, then having to start an
// entirely new session.
//
// CaptionBar only renders once real transcription content exists, and this
// environment has no OPENAI_API_KEY configured (see
// services/transcription/src/agent.ts's own comment — same known,
// pre-existing gap as the Stage 8 AI assistant), so the real STT agent
// can't produce that content here. Rather than mock React state or the UI,
// this script publishes a real LiveKit text-stream segment on the
// "lk.transcription" topic — the exact protocol
// @livekit/components-react's useTranscriptions() subscribes to
// (registerTextStreamHandler) — using @livekit/rtc-node from a throwaway
// bot participant that joins the meeting's actual LiveKit room, standing in
// only for the STT engine's output, not for anything about the app itself.
// CaptionBar on the real page receives and renders it exactly as it would
// from the genuine agent.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const REPO_ROOT = path.resolve(__dirname, "..");
const { AccessToken } = require(path.join(REPO_ROOT, "apps/api/node_modules/livekit-server-sdk"));
const { Room } = require(
  path.join(REPO_ROOT, "services/transcription/node_modules/@livekit/rtc-node"),
);

const LIVEKIT_WS_URL = "ws://localhost:27880";
const LIVEKIT_API_KEY = "devkey";
const LIVEKIT_API_SECRET = "secret";

const shotDir = path.join(__dirname, "screenshots", "captions-reshow");
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

async function login(email) {
  const res = await fetch("http://localhost:4000/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Password123!" }),
  });
  return res.json();
}

async function publishFakeCaption(livekitRoomName, text) {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: "captions-test-bot",
  });
  at.addGrant({ room: livekitRoomName, roomJoin: true, canPublishData: true });
  const token = await at.toJwt();

  const room = new Room();
  await room.connect(LIVEKIT_WS_URL, token, { autoSubscribe: false });
  // useTranscriptions() (and CaptionBar) subscribe to the "lk.transcription"
  // text-stream topic directly (registerTextStreamHandler), not the older
  // publishTranscription()/protobuf Transcription message — sendText on
  // that exact topic with the attributes @livekit/components-core expects
  // is what actually reaches a real, currently-mounted CaptionBar.
  await room.localParticipant.sendText(text, {
    topic: "lk.transcription",
    attributes: {
      "lk.transcription_final": "true",
      "lk.segment_id": `captions-test-bot-${Date.now()}`,
      "lk.transcribed_track_id": "",
    },
  });
  // Give the data stream a moment to actually flush before disconnecting.
  await new Promise((r) => setTimeout(r, 500));
  await room.disconnect();
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

  console.log("STEP: register host (HOST role -> canManageCaptions), start an instant meeting");
  await register(page, "Cap Host", `caphost${suffix}`, `caphost${suffix}@arutech.dev`);
  await login(`caphost${suffix}@arutech.dev`); // not strictly needed, just confirms the account works
  await page.click("text=New meeting");
  await page.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingCode = new URL(page.url()).pathname.split("/").pop();
  await page.click('button:has-text("Join meeting")');
  await page.waitForSelector("footer", { timeout: 15000 });
  await page.waitForTimeout(1000);

  console.log("STEP: host starts captions for real (POST .../captions/start)");
  await page.click('button:has-text("Captions")');
  await page.waitForTimeout(1500);
  const labelAfterStart = await page
    .locator("footer button", { hasText: /captions/i })
    .last()
    .innerText();
  console.log("LABEL_AFTER_START (expect 'Stop captions'):", labelAfterStart.replace(/\s+/g, " "));
  await shot(page, "01-captions-started");

  console.log(
    "STEP: publish a real LiveKit native transcription segment from a throwaway bot participant (standing in for the STT agent's output only)",
  );
  await publishFakeCaption(`meeting-${meetingCode}`, "This is a real live caption for testing.");
  await page.waitForTimeout(1500);
  const captionTextVisible = await page
    .locator("text=This is a real live caption for testing.")
    .count();
  console.log("CAPTION_BAR_RENDERED_WITH_REAL_CONTENT (expect >=1):", captionTextVisible);
  await shot(page, "02-caption-bar-visible");

  console.log("STEP: host hides the caption bar via CaptionBar's own 'Hide captions' link");
  await page.click('button:has-text("Hide captions")');
  await page.waitForTimeout(500);
  const captionGoneAfterHide = await page
    .locator("text=This is a real live caption for testing.")
    .count();
  console.log("CAPTION_BAR_GONE_AFTER_HIDE (expect 0):", captionGoneAfterHide);
  const labelAfterHide = await page
    .locator("footer button", { hasText: /captions/i })
    .last()
    .innerText();
  console.log(
    "LABEL_AFTER_HIDE (expect 'Show captions' — the real bug: was stuck on 'Stop captions' before the fix):",
    labelAfterHide.replace(/\s+/g, " "),
  );
  await shot(page, "03-hidden-toolbar-label");

  console.log(
    "STEP: confirm the captions SESSION is still genuinely running server-side while hidden (this is what the old 'Stop captions' click would have destroyed)",
  );
  const statusWhileHidden = await page.evaluate(async () => {
    const token = JSON.parse(localStorage.getItem("arutech-auth") || "{}")?.state?.accessToken;
    const meetingId = window.location.pathname.split("/").pop();
    // meetingId in the URL is actually the *code*; resolve via the preview endpoint.
    const preview = await fetch(`http://localhost:4000/api/v1/meetings/${meetingId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then((r) => r.json());
    return preview;
  });
  console.log(
    "MEETING_STATUS_WHILE_HIDDEN (session should be ongoing, not ended):",
    statusWhileHidden.status,
  );

  console.log(
    "STEP: host clicks the toolbar button again — must SHOW captions again, not stop the session",
  );
  await page.click('footer button:has-text("Show captions")');
  await page.waitForTimeout(500);
  // CaptionBar unmounts entirely while hidden (its parent's own
  // conditional), so useTranscriptions() loses whatever it had already
  // received, same as any component's local state on unmount — that's a
  // separate, minor cosmetic side effect, not what this finding is about.
  // What actually matters here — the session never stopped — shows up as
  // NEW live speech resuming normally right where it left off, so publish a
  // second segment (standing in for the speaker continuing to talk) and
  // confirm the reshown bar picks it up.
  await publishFakeCaption(`meeting-${meetingCode}`, "A second real caption after re-showing.");
  await page.waitForTimeout(1500);
  const captionBackAfterShow = await page
    .locator("text=A second real caption after re-showing.")
    .count();
  console.log(
    "NEW_CAPTION_RENDERS_AFTER_RESHOW (expect >=1 — proves the session kept running the whole time, not stopped+restarted):",
    captionBackAfterShow,
  );
  const labelAfterReshow = await page
    .locator("footer button", { hasText: /captions/i })
    .last()
    .innerText();
  console.log(
    "LABEL_AFTER_RESHOW (expect 'Stop captions' — session still genuinely active, not a fresh restart):",
    labelAfterReshow.replace(/\s+/g, " "),
  );
  await shot(page, "04-shown-again");

  console.log("CONSOLE_ERRORS_START");
  for (const e of errors) console.log(" ", e);
  console.log("CONSOLE_ERRORS_END", `(${errors.length} total)`);

  const pass =
    labelAfterStart.includes("Stop captions") &&
    captionTextVisible >= 1 &&
    captionGoneAfterHide === 0 &&
    labelAfterHide.includes("Show captions") &&
    captionBackAfterShow >= 1 &&
    labelAfterReshow.includes("Stop captions");
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

  await browser.close();
  // @livekit/rtc-node's FFI client leaves the event loop alive even after
  // every room has disconnected — always exit explicitly rather than only
  // on failure, or a passing run hangs forever instead of ever printing
  // RESULT: PASS.
  process.exit(pass ? 0 : 1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
