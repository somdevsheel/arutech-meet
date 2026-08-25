// Verifies the "End meeting" host control: the host (and only the host) sees
// a distinct "End meeting" button next to "Leave", it requires a second
// confirming click before it fires, and ending the meeting broadcasts a live
// MEETING_ENDED event so every other participant sees "This meeting has
// ended." immediately (not just via LiveKit going dark).
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const BASE = "http://localhost:3100";
const shotDir = path.join(__dirname, "screenshots", "end-meeting");
fs.mkdirSync(shotDir, { recursive: true });
let shotN = 0;
async function shot(page, label) {
  shotN += 1;
  const file = path.join(shotDir, `${String(shotN).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log("SCREENSHOT:", file);
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
  await register(pageA, "End A Host", `endA${suffix}`, `endA${suffix}@arutech.dev`);
  await register(pageB, "End B Guest", `endB${suffix}`, `endB${suffix}@arutech.dev`);

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

  console.log("=== Only the host sees an End meeting button ===");
  await shot(pageA, "a-host-toolbar");
  await shot(pageB, "b-participant-toolbar");
  const aSeesEnd = await pageA.locator('button:has-text("End meeting")').count();
  const bSeesEnd = await pageB.locator('button:has-text("End meeting")').count();
  console.log("A_SEES_END_MEETING (should be 1):", aSeesEnd, "B_SEES_END_MEETING (should be 0):", bSeesEnd);
  if (aSeesEnd !== 1) throw new Error("Host should see exactly one End meeting button");
  if (bSeesEnd !== 0) throw new Error("Non-host participant should NOT see an End meeting button");

  console.log("=== First click arms it (does not end the meeting yet) ===");
  await pageA.click('button:has-text("End meeting")');
  await pageA.waitForSelector('button:has-text("Click again to end for everyone")', { timeout: 5000 });
  await shot(pageA, "a-armed-confirm-state");
  const bStillInMeeting = await pageB.locator("footer").count();
  console.log("B_STILL_IN_MEETING_AFTER_FIRST_CLICK (should be 1):", bStillInMeeting);
  if (bStillInMeeting !== 1) throw new Error("First click should only arm the button, not end the meeting");

  console.log("=== Second click actually ends it for everyone ===");
  await pageA.click('button:has-text("Click again to end for everyone")');
  await pageA.waitForURL("**/dashboard", { timeout: 15000 });
  console.log("A_NAVIGATED_TO_DASHBOARD:", pageA.url());

  console.log("STEP: B should see the live MEETING_ENDED screen without doing anything");
  await pageB.waitForSelector("text=This meeting has ended.", { timeout: 15000 });
  await shot(pageB, "b-sees-meeting-ended-live");
  const bSeesEndedScreen = await pageB.locator("text=This meeting has ended.").count();
  console.log("B_SEES_ENDED_SCREEN_LIVE (should be >=1):", bSeesEndedScreen);
  if (bSeesEndedScreen === 0) throw new Error("B never saw the live 'meeting has ended' screen");

  console.log("STEP: confirm the meeting is genuinely ENDED server-side, not just a UI illusion");
  const bToken = await pageB.evaluate(() => JSON.parse(localStorage.getItem("arutech-auth")).state.accessToken);
  const status = await pageB.evaluate(
    async ({ token, code }) => {
      const res = await fetch(`http://localhost:4000/api/v1/meetings/${code}`);
      return res.json();
    },
    { token: bToken, code: meetingCode },
  );
  console.log("MEETING_STATUS_VIA_REST (should be ENDED):", status.status);
  if (status.status !== "ENDED") throw new Error(`Expected meeting status ENDED, got ${status.status}`);

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
