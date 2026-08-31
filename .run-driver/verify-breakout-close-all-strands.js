// Verifies the actual bug: BREAKOUT_ROOMS_CLOSED used to only ever be caught
// by BreakoutPanel itself, which only exists in the DOM while the Breakout
// sub-tab of Tools is the currently-open panel. A participant who joined a
// breakout room and then switched away — e.g. to Chat, the single most
// likely thing to do once actually in a breakout room talking to people —
// unmounted the only listener that called onReturnToMain(), so a host
// clicking "Close all rooms" never brought them back: they were stuck in a
// dead LiveKit room with no way out except manually leaving and rejoining
// the whole meeting from scratch.
//
// The fix moves that state + those listeners into a BreakoutProvider mounted
// once at the MeetingRoom level (same pattern as WhiteboardProvider and
// LocalRecordingProvider), so BREAKOUT_ROOMS_CLOSED is caught regardless of
// which panel tab is open. This script proves exactly that: p1 joins a
// breakout room, switches to the Chat tab (Breakout tab no longer mounted),
// host closes all rooms, and p1 must still land back in the main room.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "breakout-close-all-strands");
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
  const ctxHost = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const ctxP1 = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const host = await ctxHost.newPage();
  const p1 = await ctxP1.newPage();
  const errors = { host: [], p1: [] };
  for (const [label, page] of [["host", host], ["p1", p1]]) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors[label].push(msg.text());
    });
    page.on("pageerror", (err) => errors[label].push(String(err)));
  }

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register host + participant, host creates a meeting with the waiting room OFF");
  await register(host, "CloseAll Host", `cahost${suffix}`, `cahost${suffix}@arutech.dev`);
  await register(p1, "CloseAll P1", `cap1${suffix}`, `cap1${suffix}@arutech.dev`);

  const loginRes = await fetch("http://localhost:4000/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `cahost${suffix}@arutech.dev`, password: "Password123!" }),
  });
  const { accessToken } = await loginRes.json();
  const meetingRes = await fetch("http://localhost:4000/api/v1/meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      title: "Close-all strand test",
      type: "INSTANT",
      settings: { waitingRoomEnabled: false },
    }),
  });
  const meeting = await meetingRes.json();
  const meetingCode = meeting.code;

  await host.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await host.click('button:has-text("Join meeting")');
  await host.waitForSelector("footer", { timeout: 15000 });

  console.log("STEP: p1 joins (admitted immediately, no waiting room)");
  await p1.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await p1.click('button:has-text("Join meeting")', { timeout: 15000 });
  await p1.waitForSelector("footer", { timeout: 15000 });
  await host.waitForTimeout(1000);

  console.log("STEP: host opens Tools -> Breakout, creates 1 room with auto-assign (so p1 is assigned)");
  await host.click('button:has-text("Tools")');
  await host.waitForTimeout(300);
  await host.locator('button:has-text("Breakout")').click();
  await host.waitForTimeout(300);
  await host.fill('input[type="number"]', "1");
  await host.click('button:has-text("Create & auto-assign")');
  await host.waitForTimeout(2000);
  await shot(host, "01-host-created-room");

  console.log("STEP: p1 sees the assignment and joins the breakout room");
  await p1.click('button:has-text("Tools")');
  await p1.waitForTimeout(300);
  await p1.locator('button:has-text("Breakout")').click();
  await p1.waitForTimeout(500);
  await p1.click('button:has-text("Join breakout room")');
  await p1.waitForTimeout(2500);
  // The `<LiveKitRoom key={conn.label ?? "main"}>` swap this triggers
  // force-remounts everything under it, including ClassroomPanel's own
  // internal tab state — so the Tools panel falls back to its first tab
  // (Whiteboard) right after joining, and the "Return to main room" button
  // (rendered only while the Breakout sub-tab is open) isn't the right
  // signal for "did the join actually happen". The header pill is: it's
  // outside LiveKitRoom entirely and reflects `conn.label` directly.
  const inBreakout = await p1.locator("text=/^Breakout:/").count();
  console.log("P1_JOINED_BREAKOUT_ROOM (expect >=1):", inBreakout);
  await shot(p1, "02-p1-in-breakout-room");

  console.log(
    "STEP: p1 switches AWAY from the Breakout tab to Chat — this is the exact scenario the bug depended on: BreakoutPanel (and its old listeners) unmount entirely",
  );
  await p1.click('button:has-text("Chat")');
  await p1.waitForTimeout(500);
  const breakoutPanelStillInDom = await p1.locator('button:has-text("Return to main room")').count();
  console.log(
    "P1_BREAKOUT_PANEL_UNMOUNTED (expect 0 — proves this run is actually exercising the bug's precondition):",
    breakoutPanelStillInDom,
  );
  await shot(p1, "03-p1-switched-to-chat-tab");

  console.log("STEP: host closes all breakout rooms while p1 is on the Chat tab, not the Breakout tab");
  await host.click('button:has-text("Tools")');
  await host.waitForTimeout(300);
  await host.locator('button:has-text("Breakout")').click();
  await host.waitForTimeout(300);
  await shot(host, "04-host-before-close-all");
  await host.click('button:has-text("Close all rooms")');
  await host.waitForTimeout(2500);
  await shot(host, "05-host-after-close-all");

  console.log("STEP: is p1 actually back in the main room? (the real bug under test)");
  // A LiveKitRoom remount (main room) still renders footer/header chrome
  // that a dead breakout-room LiveKitRoom also renders, so the real signal
  // is the header pill: it shows "Breakout: <room>" only while conn.label
  // is set, and disappears the instant returnToMain() actually fires.
  const stillShowsBreakoutPill = await p1.locator("text=/^Breakout:/").count();
  console.log(
    "P1_STILL_SHOWS_BREAKOUT_PILL (expect 0 — was stuck showing this forever before the fix):",
    stillShowsBreakoutPill,
  );
  await p1.waitForTimeout(500);
  await shot(p1, "06-p1-after-host-closed-all-still-on-chat-tab");

  const backInMainRoom = stillShowsBreakoutPill === 0;
  console.log("P1_BACK_IN_MAIN_ROOM:", backInMainRoom);

  console.log("CONSOLE_ERRORS_START");
  for (const label of ["host", "p1"]) {
    for (const e of errors[label]) console.log(`  ${label}:`, e);
  }
  const totalErrors = errors.host.length + errors.p1.length;
  console.log("CONSOLE_ERRORS_END", `(${totalErrors} total)`);

  const pass = inBreakout >= 1 && breakoutPanelStillInDom === 0 && backInMainRoom;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
