// Verifies the actual finding: POST .../breakout-rooms/broadcast was fully
// built and permission-checked server-side (BreakoutRoomsService.
// broadcastMessage, gated on breakout.manage, publishing BREAKOUT_BROADCAST
// over the meeting's real-time channel) but completely unreachable — no
// button anywhere called it, and no client-side listener even existed for
// the resulting event, so even a manual API call would have vanished into
// the void on every client.
//
// The whole point of this feature is reaching someone even while they're
// inside a breakout room — this script proves exactly that: p1 joins a
// breakout room, switches away from the Breakout tab entirely (to Chat, the
// single most likely thing to be doing once actually in a breakout room —
// same scenario fix #16 exercised), the host sends a real announcement from
// the Breakout panel's new "Announce to everyone" form, and p1 sees it as a
// real banner without ever going back to the Breakout tab or the main room.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "breakout-broadcast-reaches-everyone");
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
  for (const [label, page] of [
    ["host", host],
    ["p1", p1],
  ]) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors[label].push(msg.text());
    });
    page.on("pageerror", (err) => errors[label].push(String(err)));
  }

  const suffix = Date.now().toString().slice(-6);

  console.log(
    "STEP: register host + participant, host creates a meeting with the waiting room OFF",
  );
  await register(host, "Bcast Host", `bcasthost${suffix}`, `bcasthost${suffix}@arutech.dev`);
  await register(p1, "Bcast P1", `bcastp1${suffix}`, `bcastp1${suffix}@arutech.dev`);

  const loginRes = await fetch("http://localhost:4000/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `bcasthost${suffix}@arutech.dev`, password: "Password123!" }),
  });
  const { accessToken } = await loginRes.json();
  const meetingRes = await fetch("http://localhost:4000/api/v1/meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      title: "Broadcast test",
      type: "INSTANT",
      settings: { waitingRoomEnabled: false },
    }),
  });
  const meeting = await meetingRes.json();
  const meetingCode = meeting.code;

  await host.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await host.click('button:has-text("Join meeting")');
  await host.waitForSelector("footer", { timeout: 15000 });

  console.log("STEP: p1 joins");
  await p1.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await p1.click('button:has-text("Join meeting")', { timeout: 15000 });
  await p1.waitForSelector("footer", { timeout: 15000 });
  await host.waitForTimeout(1000);

  console.log("STEP: host creates 1 breakout room with auto-assign, p1 joins it");
  await host.click('footer button:has-text("Tools")');
  await host.waitForTimeout(300);
  await host.getByRole("button", { name: "breakout", exact: true }).click();
  await host.waitForTimeout(300);
  await host.fill('input[type="number"]', "1");
  await host.click('button:has-text("Create & auto-assign")');
  await host.waitForTimeout(1500);

  await p1.click('footer button:has-text("Tools")');
  await p1.waitForTimeout(300);
  await p1.getByRole("button", { name: "breakout", exact: true }).click();
  await p1.waitForTimeout(500);
  await p1.click('button:has-text("Join breakout room")');
  await p1.waitForTimeout(2000);
  const p1InBreakout = await p1.locator("text=/^Breakout:/").count();
  console.log("P1_IN_BREAKOUT_ROOM (expect >=1):", p1InBreakout);

  console.log(
    "STEP: p1 switches AWAY from the Breakout tab entirely — to Chat — before the host broadcasts anything",
  );
  await p1.click('footer button:has-text("Chat")');
  await p1.waitForTimeout(500);
  await shot(p1, "01-p1-in-breakout-on-chat-tab");

  console.log(
    "STEP: host sends a real announcement via the new form — Tools/Breakout is already open from creating the room above, no need to reopen it",
  );
  await host.waitForTimeout(300);
  const announceInput = host.locator('textarea[placeholder*="Back in the main room"]');
  const announceFormPresent = await announceInput.count();
  console.log(
    "HOST_SEES_ANNOUNCE_FORM (expect >=1 — this is the previously-missing UI):",
    announceFormPresent,
  );
  const distinctiveMessage = `Real broadcast test ${suffix} — heading back in 2 minutes`;
  await announceInput.fill(distinctiveMessage);
  await shot(host, "02-host-composed-announcement");
  await host.click('button:has-text("Send to everyone")');
  await host.waitForTimeout(1500);
  await shot(host, "03-host-after-sending");

  console.log(
    "STEP: does p1 — still in the breakout room, still on the Chat tab, never touched Breakout — actually see it?",
  );
  const p1SeesBanner = await p1.locator(`text=${distinctiveMessage}`).count();
  console.log(
    "P1_SEES_BROADCAST_BANNER_WHILE_IN_BREAKOUT_ON_CHAT_TAB (expect >=1 — this is the actual finding):",
    p1SeesBanner,
  );
  await shot(p1, "04-p1-sees-banner");

  console.log("CONSOLE_ERRORS_START");
  for (const label of ["host", "p1"]) {
    for (const e of errors[label]) console.log(`  ${label}:`, e);
  }
  const totalErrors = errors.host.length + errors.p1.length;
  console.log("CONSOLE_ERRORS_END", `(${totalErrors} total)`);

  const pass = p1InBreakout >= 1 && announceFormPresent >= 1 && p1SeesBanner >= 1;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
