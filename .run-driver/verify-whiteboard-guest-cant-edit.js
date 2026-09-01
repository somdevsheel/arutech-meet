// Verifies the actual bug: ClassroomPanel rendered <WhiteboardCanvas
// canEdit={true} /> unconditionally, regardless of the caller's real
// whiteboard.edit capability. whiteboard.edit is granted to
// OWNER/HOST/CO_HOST/TEACHER/STUDENT/PARTICIPANT — only GUEST lacks it — so
// hardcoding true drew every GUEST a fully interactive-looking toolbar (Pen,
// Select, colors, Save) that would 403 on every single draw/save call
// against the server (WhiteboardService.requireCapability /
// RealtimeGateway's WHITEBOARD_DRAW handler both already enforce this
// server-side), with zero client-side indication anything was wrong.
//
// The fix computes `can(role, "whiteboard.edit")` once in meeting-room.tsx
// and threads it down as ClassroomPanel's new `canEditWhiteboard` prop. This
// script proves three real roles behave correctly in one real meeting: HOST
// (owner) can edit, a second registered user who just joins as PARTICIPANT
// can edit (this is the case a naive `isModerator` fix would have gotten
// wrong — whiteboard.edit is broader than moderator-only), and a genuine
// unauthenticated GUEST (via the real join-as-guest flow, no account at
// all) cannot.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "whiteboard-guest-cant-edit");
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

async function openWhiteboardTab(page) {
  await page.click('button:has-text("Tools")');
  await page.waitForTimeout(300);
  // Scoped to the classroom sub-tab bar specifically (exact, lowercase
  // "whiteboard") — a plain `button:has-text("Whiteboard")` also matches the
  // header's "Meeting info" button whenever the meeting title itself
  // contains the word "Whiteboard", as this test's meeting title does.
  const wbTab = page.getByRole("button", { name: "whiteboard", exact: true });
  if (await wbTab.count()) await wbTab.click();
  await page.waitForTimeout(500);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const ctxHost = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const ctxP1 = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const ctxGuest = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const host = await ctxHost.newPage();
  const p1 = await ctxP1.newPage();
  const guest = await ctxGuest.newPage();
  const errors = { host: [], p1: [], guest: [] };
  for (const [label, page] of [["host", host], ["p1", p1], ["guest", guest]]) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors[label].push(msg.text());
    });
    page.on("pageerror", (err) => errors[label].push(String(err)));
  }

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register host + a second registered user, host creates a meeting with the waiting room OFF");
  await register(host, "WB Host", `wbhost${suffix}`, `wbhost${suffix}@arutech.dev`);
  await register(p1, "WB P1", `wbp1${suffix}`, `wbp1${suffix}@arutech.dev`);

  const loginRes = await fetch("http://localhost:4000/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `wbhost${suffix}@arutech.dev`, password: "Password123!" }),
  });
  const { accessToken } = await loginRes.json();
  const meetingRes = await fetch("http://localhost:4000/api/v1/meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      title: "Whiteboard permission test",
      type: "INSTANT",
      settings: { waitingRoomEnabled: false },
    }),
  });
  const meeting = await meetingRes.json();
  const meetingCode = meeting.code;

  await host.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await host.click('button:has-text("Join meeting")');
  await host.waitForSelector("footer", { timeout: 15000 });

  console.log("STEP: p1 (registered, no special role -> PARTICIPANT) joins the same meeting");
  await p1.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await p1.click('button:has-text("Join meeting")', { timeout: 15000 });
  await p1.waitForSelector("footer", { timeout: 15000 });

  console.log("STEP: guest (NO account at all — real join-as-guest flow) joins the same meeting");
  await guest.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  const nameInput = guest.locator('input[type="text"]').first();
  await nameInput.fill(`WB Guest ${suffix}`);
  await guest.click('button:has-text("Join meeting")', { timeout: 15000 });
  await guest.waitForSelector("footer", { timeout: 15000 });
  await host.waitForTimeout(1000);

  console.log("STEP: all three open Tools -> Whiteboard");
  await openWhiteboardTab(host);
  await openWhiteboardTab(p1);
  await openWhiteboardTab(guest);
  await shot(host, "01-host-whiteboard");
  await shot(p1, "02-p1-whiteboard");
  await shot(guest, "03-guest-whiteboard");

  const hostPenCount = await host.locator('button:has-text("Pen")').count();
  const p1PenCount = await p1.locator('button:has-text("Pen")').count();
  const guestPenCount = await guest.locator('button:has-text("Pen")').count();
  const hostSaveCount = await host.locator('button:has-text("Save")').count();
  const p1SaveCount = await p1.locator('button:has-text("Save")').count();
  const guestSaveCount = await guest.locator('button:has-text("Save")').count();

  console.log("HOST_SEES_PEN_TOOL (expect >=1):", hostPenCount, " HOST_SEES_SAVE (expect >=1):", hostSaveCount);
  console.log(
    "P1_SEES_PEN_TOOL (expect >=1 — PARTICIPANT has whiteboard.edit, a naive isModerator-only fix would wrongly hide this):",
    p1PenCount,
    " P1_SEES_SAVE (expect >=1):",
    p1SaveCount,
  );
  console.log(
    "GUEST_SEES_PEN_TOOL (expect 0 — was 1 before the fix, a fully interactive toolbar that 403s on every stroke):",
    guestPenCount,
    " GUEST_SEES_SAVE (expect 0):",
    guestSaveCount,
  );

  console.log("STEP: does the guest's canvas area still render (read-only), just without edit controls?");
  const guestCanvasVisible = await guest.locator("canvas, svg").count();
  console.log("GUEST_CANVAS_STILL_PRESENT (read-only view, expect >=1):", guestCanvasVisible);

  console.log("CONSOLE_ERRORS_START");
  for (const label of ["host", "p1", "guest"]) {
    for (const e of errors[label]) console.log(`  ${label}:`, e);
  }
  const totalErrors = errors.host.length + errors.p1.length + errors.guest.length;
  console.log("CONSOLE_ERRORS_END", `(${totalErrors} total)`);

  const pass =
    hostPenCount >= 1 &&
    hostSaveCount >= 1 &&
    p1PenCount >= 1 &&
    p1SaveCount >= 1 &&
    guestPenCount === 0 &&
    guestSaveCount === 0;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
