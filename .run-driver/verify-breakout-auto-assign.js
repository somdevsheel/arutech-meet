// Verifies the actual bug: a moderator's "Create & auto-assign" used to
// leave every non-moderator participant with no Join affordance at all,
// because BREAKOUT_ROOMS_CREATED's own assignments payload was received
// and discarded client-side. Two real participants, real auto-assign, real
// browser — confirms both now see "You've been assigned to <room>" with a
// working Join button, and that a page reload doesn't lose it.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "breakout-auto-assign");
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
  const ctxA = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const ctxB = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const ctxC = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const host = await ctxA.newPage();
  const p1 = await ctxB.newPage();
  const p2 = await ctxC.newPage();
  const errors = { host: [], p1: [], p2: [] };
  for (const [label, page] of [["host", host], ["p1", p1], ["p2", p2]]) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors[label].push(msg.text());
    });
    page.on("pageerror", (err) => errors[label].push(String(err)));
  }

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register host + 2 participants, host creates a meeting with the waiting room OFF");
  await register(host, "Breakout Host", `bohost${suffix}`, `bohost${suffix}@arutech.dev`);
  await register(p1, "Breakout P1", `bop1${suffix}`, `bop1${suffix}@arutech.dev`);
  await register(p2, "Breakout P2", `bop2${suffix}`, `bop2${suffix}@arutech.dev`);

  // Waiting room off on purpose: with it on, EVERY reload re-triggers
  // "waiting for the host" regardless of prior admission (join()'s
  // requiresWaiting check ignores the existing participant's own status) —
  // a real, separate, pre-existing gap, but not this fix's concern. Off
  // keeps this script's reload step actually testing the breakout-assignment
  // persistence it's meant to, not that unrelated one.
  const createRes = await fetch("http://localhost:4000/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `bohost${suffix}@arutech.dev`, password: "Password123!" }),
  });
  const { accessToken } = await createRes.json();
  const meetingRes = await fetch("http://localhost:4000/api/v1/meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      title: "Room assign test",
      type: "INSTANT",
      settings: { waitingRoomEnabled: false },
    }),
  });
  const meeting = await meetingRes.json();
  const meetingCode = meeting.code;

  await host.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await host.click('button:has-text("Join meeting")');
  await host.waitForSelector("footer", { timeout: 15000 });

  console.log("STEP: p1 and p2 join (admitted immediately, no waiting room)");
  for (const [label, page] of [["p1", p1], ["p2", p2]]) {
    await page.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
    await page.click('button:has-text("Join meeting")', { timeout: 15000 });
    await page.waitForSelector("footer", { timeout: 15000 });
  }
  await host.waitForTimeout(1000);

  console.log("STEP: host opens Tools -> Breakout, creates 2 rooms with auto-assign");
  await host.click('button:has-text("Tools")');
  await host.waitForTimeout(300);
  const breakoutTab = host.locator('button:has-text("Breakout")');
  if (await breakoutTab.count()) await breakoutTab.click();
  await host.waitForTimeout(300);
  await host.fill('input[type="number"]', "2");
  await host.click('button:has-text("Create & auto-assign")');
  await host.waitForTimeout(2000);
  await shot(host, "01-host-created-rooms");

  console.log("STEP: do p1 and p2 now see 'You've been assigned to' with a Join button? (this is the actual fix)");
  for (const [label, page] of [["p1", p1], ["p2", p2]]) {
    await page.click('button:has-text("Tools")');
    await page.waitForTimeout(300);
    const bTab = page.locator('button:has-text("Breakout")');
    if (await bTab.count()) await bTab.click();
    await page.waitForTimeout(500);
    const assignedText = await page.locator("text=You've been assigned to").count();
    const joinBtn = await page.locator('button:has-text("Join breakout room")').count();
    console.log(`${label.toUpperCase()}_SEES_ASSIGNMENT (expect >=1, was 0 before the fix):`, assignedText);
    console.log(`${label.toUpperCase()}_JOIN_BUTTON_PRESENT (expect >=1):`, joinBtn);
    await shot(page, `02-${label}-sees-assignment`);
  }

  console.log("STEP: p1 reloads the page mid-session — does the assignment survive? (also part of this fix)");
  await p1.reload({ waitUntil: "networkidle" });
  await p1.waitForTimeout(1000);
  await shot(p1, "03a-p1-immediately-after-reload");
  const joinBtnAfterReload = p1.locator('button:has-text("Join meeting")');
  if (await joinBtnAfterReload.count()) {
    await joinBtnAfterReload.click({ timeout: 15000 });
  }
  await p1.waitForTimeout(2000);
  await shot(p1, "03b-p1-a-few-seconds-after-clicking-join-again");
  await p1.waitForSelector("footer", { timeout: 20000 });
  await p1.click('button:has-text("Tools")');
  await p1.waitForTimeout(300);
  const bTabAfterReload = p1.locator('button:has-text("Breakout")');
  if (await bTabAfterReload.count()) await bTabAfterReload.click();
  await p1.waitForTimeout(800);
  const assignedAfterReload = await p1.locator("text=You've been assigned to").count();
  console.log("P1_SEES_ASSIGNMENT_AFTER_RELOAD (expect >=1):", assignedAfterReload);
  await shot(p1, "03-p1-after-reload");

  console.log("STEP: p1 actually clicks Join and lands in the breakout room");
  await p1.click('button:has-text("Join breakout room")');
  await p1.waitForTimeout(2000);
  const returnBtn = await p1.locator('button:has-text("Return to main room")').count();
  console.log("P1_JOINED_BREAKOUT_ROOM (Return-to-main button present, expect >=1):", returnBtn);
  await shot(p1, "04-p1-in-breakout-room");

  console.log("CONSOLE_ERRORS_START");
  for (const label of ["host", "p1", "p2"]) {
    for (const e of errors[label]) console.log(`  ${label}:`, e);
  }
  const totalErrors = errors.host.length + errors.p1.length + errors.p2.length;
  console.log("CONSOLE_ERRORS_END", `(${totalErrors} total)`);

  await browser.close();
  console.log("DONE");
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
