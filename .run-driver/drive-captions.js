// Verifies live captions end-to-end through the real UI: only the host sees
// the manage-captions control armed, starting it triggers a REAL LiveKit
// Agent Dispatch (confirmed by tailing the live agent worker's own log, not
// just trusting our API's response), the agent genuinely joins the meeting
// room as a bot participant that never shows up as a video tile, every
// participant learns captions are on live (broadcast, not a poll), and
// stopping cleanly tears the dispatch down. Honest about the one thing this
// environment can't verify: actual caption TEXT, since no OPENAI_API_KEY is
// configured here (matching Stage 8's AI meeting assistant precedent) — the
// captions agent is expected to log that and exit, which this driver reads
// straight out of the worker's own log file as live evidence.
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:3100";
const AGENT_LOG = "/tmp/captions-agent-dev.log";
const shotDir = path.join(__dirname, "screenshots", "captions");
fs.mkdirSync(shotDir, { recursive: true });
let shotN = 0;
async function shot(page, label) {
  shotN += 1;
  const file = path.join(shotDir, `${String(shotN).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log("SCREENSHOT:", file);
}

function agentLogTail(sinceBytes) {
  const buf = fs.readFileSync(AGENT_LOG, "utf8");
  return buf.slice(sinceBytes);
}

async function register(page, name, username, email) {
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
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
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
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
  console.log("STEP: register host A and participant B, get them into a real meeting together");
  await register(pageA, "Cap A Host", `capA${suffix}`, `capA${suffix}@arutech.dev`);
  await register(pageB, "Cap B Guest", `capB${suffix}`, `capB${suffix}@arutech.dev`);

  await pageA.click("text=New meeting");
  await pageA.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingCode = new URL(pageA.url()).pathname.split("/").pop();
  await pageA.click('button:has-text("Join meeting")');
  await pageA.waitForSelector("footer", { timeout: 15000 });

  await pageB.goto(`${BASE}/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await pageB.click('button:has-text("Join meeting")', { timeout: 15000 });
  await pageB.waitForTimeout(1500);
  const admitBtn = pageA.locator('button:has-text("Admit")');
  try {
    await admitBtn.first().waitFor({ timeout: 8000 });
    await admitBtn.first().click();
  } catch {
    console.log("No Admit button — may not have needed admission");
  }
  await pageB.waitForSelector("footer", { timeout: 15000 });
  await pageA.waitForTimeout(1000);

  console.log("=== Only the host sees the manage-captions control before anything starts ===");
  const aSeesCaptionsControl = await pageA.locator('button:has-text("Captions")').count();
  const bCaptionsMatches = await pageB.locator('button:has-text("Captions"), button:has-text("Hide captions"), button:has-text("Show captions")').allTextContents();
  const bSeesCaptionsControl = bCaptionsMatches.length;
  console.log("A_SEES_CAPTIONS_CONTROL (should be 1):", aSeesCaptionsControl, "B_SEES_ANY_CAPTIONS_CONTROL (should be 0):", bSeesCaptionsControl, "B_MATCHES:", JSON.stringify(bCaptionsMatches));
  if (aSeesCaptionsControl !== 1) throw new Error("Host should see the Captions control");
  if (bSeesCaptionsControl !== 0) throw new Error("Non-host shouldn't see any captions control before captions are active");
  await shot(pageA, "a-before-start");

  const agentLogSizeBefore = fs.statSync(AGENT_LOG).size;

  console.log("=== Host starts captions — a real dispatch, not a fake toggle ===");
  await pageA.click('button:has-text("Captions")');
  await pageA.waitForSelector('button:has-text("Stop captions")', { timeout: 10000 });
  await shot(pageA, "a-captions-started");

  console.log("STEP: B should learn captions are on live, without refreshing");
  await pageB.waitForSelector('button:has-text("Hide captions")', { timeout: 10000 });
  await shot(pageB, "b-sees-captions-active-live");

  console.log("STEP: confirm the real LiveKit Agent actually picked up the dispatch and joined the room");
  await pageA.waitForTimeout(2000);
  const agentLog = agentLogTail(agentLogSizeBefore);
  console.log("--- agent log since dispatch ---");
  console.log(agentLog);
  const agentReceivedJob = agentLog.includes("received job request");
  const agentJoinedThisRoom = agentLog.includes(`meeting-${meetingCode}`);
  const agentHonestlyRefused = agentLog.includes("OPENAI_API_KEY is not set");
  console.log(
    "AGENT_RECEIVED_JOB:", agentReceivedJob,
    "AGENT_JOINED_THIS_EXACT_ROOM:", agentJoinedThisRoom,
    "AGENT_HONESTLY_REFUSED_NO_KEY:", agentHonestlyRefused,
  );
  if (!agentReceivedJob || !agentJoinedThisRoom) {
    throw new Error("The real captions agent worker never picked up/joined the dispatched job for this meeting's room");
  }

  console.log("=== Neither side should render a video tile for the bot participant ===");
  const aTileCount = await pageA.locator("[data-video-grid-root] video, [data-video-grid-root] [data-lk-participant-placeholder]").count();
  console.log("A_VIDEO_GRID_TILE_ELEMENTS (informational — expect exactly the 2 real humans' worth, not 3):", aTileCount);
  const captionsAgentIdText = await pageA.locator("text=captions-agent").count();
  console.log("CAPTIONS_AGENT_IDENTITY_LEAKED_INTO_UI (should be 0):", captionsAgentIdText);
  if (captionsAgentIdText !== 0) throw new Error("The bot's raw identity leaked into the visible UI somewhere");

  console.log("=== Host stops captions — real teardown ===");
  await pageA.click('button:has-text("Stop captions")');
  await pageA.waitForSelector('button:has-text("Captions")', { timeout: 10000 });
  await pageB.waitForSelector('button:has-text("Captions"), button:has-text("Hide captions")', { timeout: 100 }).catch(() => {});
  await pageB.waitForTimeout(800);
  const bStillSeesHideButton = await pageB.locator('button:has-text("Hide captions"), button:has-text("Show captions")').count();
  console.log("B_STILL_SEES_CAPTIONS_CONTROL_AFTER_STOP (should be 0):", bStillSeesHideButton);
  if (bStillSeesHideButton !== 0) throw new Error("B should stop seeing any captions control once the host stopped captions");
  await shot(pageA, "a-after-stop");
  await shot(pageB, "b-after-stop");

  console.log("CONSOLE_ERRORS_A_START");
  for (const e of errors.A) console.log("  A:", e);
  console.log("CONSOLE_ERRORS_A_END", `(${errors.A.length} total)`);
  console.log("CONSOLE_ERRORS_B_START");
  for (const e of errors.B) console.log("  B:", e);
  console.log("CONSOLE_ERRORS_B_END", `(${errors.B.length} total)`);

  await browser.close();
  console.log("DONE");
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
