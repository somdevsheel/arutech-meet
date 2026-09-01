// Verifies the actual bug: `unreadChatCount = messages.length - seenChatCount`
// with `seenChatCount` starting at 0, but `messages` doesn't start at 0 —
// useMeetingSocket loads the meeting's full pre-join chat history via REST
// the moment you join an in-progress meeting. Every message ever sent
// before a participant arrived got reported as freshly "unread" the instant
// they joined, with no way to tell real backlog apart from something that
// actually just happened.
//
// This script has the host send several messages BEFORE a second
// participant ever joins (real pre-join history), then has that
// participant join and checks the Chat badge is 0 — not the backlog count —
// while sitting on a different tab. Then the host sends one genuinely new
// live message, and the badge must become exactly 1, proving real live
// unread tracking still works correctly on top of the fix.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "chat-badge-prejoin-history");
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

async function chatBadgeCount(page) {
  const badge = page.locator('footer button:has-text("Chat")').locator("span").last();
  const count = await badge.count();
  if (count === 0) return 0;
  const text = await badge.innerText().catch(() => "");
  const n = parseInt(text, 10);
  return Number.isNaN(n) ? 0 : n;
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
  const errors = [];
  p1.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  p1.on("pageerror", (err) => errors.push(String(err)));

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register host + p1, host creates a meeting with the waiting room OFF");
  await register(host, "Badge Host", `badgehost${suffix}`, `badgehost${suffix}@arutech.dev`);
  await register(p1, "Badge P1", `badgep1${suffix}`, `badgep1${suffix}@arutech.dev`);

  const loginRes = await fetch("http://localhost:4000/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `badgehost${suffix}@arutech.dev`, password: "Password123!" }),
  });
  const { accessToken } = await loginRes.json();
  const meetingRes = await fetch("http://localhost:4000/api/v1/meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      title: "Chat badge test",
      type: "INSTANT",
      settings: { waitingRoomEnabled: false },
    }),
  });
  const meeting = await meetingRes.json();
  const meetingCode = meeting.code;

  await host.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await host.click('button:has-text("Join meeting")');
  await host.waitForSelector("footer", { timeout: 15000 });

  console.log("STEP: host sends 4 messages BEFORE p1 ever joins — this is real pre-join history");
  await host.click('footer button:has-text("Chat")');
  await host.waitForTimeout(500);
  await shot(host, "00-host-chat-panel-state");
  for (let i = 1; i <= 4; i++) {
    await host.fill('input[placeholder="Type message here…"]', `Backlog message ${i}`);
    await host.press('input[placeholder="Type message here…"]', "Enter");
    await host.waitForTimeout(200);
  }
  await host.click('footer button:has-text("Chat")'); // close host's own chat panel again
  await shot(host, "01-host-sent-backlog");

  console.log("STEP: p1 joins the now-in-progress meeting and lands on a DIFFERENT tab (not Chat)");
  await p1.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await p1.click('button:has-text("Join meeting")', { timeout: 15000 });
  await p1.waitForSelector("footer", { timeout: 15000 });
  await p1.click('button:has-text("Participants")');
  await p1.waitForTimeout(1500); // let the history REST fetch resolve
  await shot(p1, "02-p1-joined-on-participants-tab");

  const badgeAfterJoin = await chatBadgeCount(p1);
  console.log(
    "CHAT_BADGE_AFTER_JOINING_WITH_4_BACKLOG_MESSAGES (expect 0 — was 4 before the fix):",
    badgeAfterJoin,
  );

  console.log("STEP: host sends ONE genuinely new live message while p1 is still on Participants");
  await host.click('footer button:has-text("Chat")');
  await host.waitForTimeout(300);
  await host.fill('input[placeholder="Type message here…"]', "A real new live message");
  await host.press('input[placeholder="Type message here…"]', "Enter");
  await p1.waitForTimeout(1000);
  await shot(p1, "03-p1-after-one-live-message");

  const badgeAfterLiveMessage = await chatBadgeCount(p1);
  console.log(
    "CHAT_BADGE_AFTER_ONE_REAL_LIVE_MESSAGE (expect exactly 1 — proves real unread tracking still works):",
    badgeAfterLiveMessage,
  );

  console.log(
    "STEP: p1 opens Chat — badge must clear, and all 5 messages (4 backlog + 1 live) must actually be visible",
  );
  await p1.click('footer button:has-text("Chat")');
  await p1.waitForTimeout(500);
  const backlogVisible = await p1.locator("text=Backlog message 1").count();
  const liveVisible = await p1.locator("text=A real new live message").count();
  await shot(p1, "04-p1-chat-open");
  const badgeAfterOpening = await chatBadgeCount(p1);

  console.log("BACKLOG_MESSAGES_VISIBLE (expect >=1):", backlogVisible);
  console.log("LIVE_MESSAGE_VISIBLE (expect >=1):", liveVisible);
  console.log("BADGE_AFTER_OPENING_CHAT (expect 0):", badgeAfterOpening);

  console.log("CONSOLE_ERRORS_START");
  for (const e of errors) console.log(" ", e);
  console.log("CONSOLE_ERRORS_END", `(${errors.length} total)`);

  const pass =
    badgeAfterJoin === 0 &&
    badgeAfterLiveMessage === 1 &&
    backlogVisible >= 1 &&
    liveVisible >= 1 &&
    badgeAfterOpening === 0;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
