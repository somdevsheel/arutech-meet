// Verifies the guest-authentication fix end-to-end through the real browser
// UI (not just the API): a genuine unauthenticated GUEST (no account at all,
// via the real join-as-guest flow) — waits in the waiting room, is admitted
// LIVE (was previously stuck spinning forever — finding C-1/C-2), lands in
// the actual meeting room, and can send/receive chat there (was previously
// impossible at all — no socket connection, then a FK crash once one was
// wired up before senderGuestName existed).
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "guest-realtime-fix");
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
  const ctxHost = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const ctxGuest = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const host = await ctxHost.newPage();
  const guest = await ctxGuest.newPage();
  const guestErrors = [];
  guest.on("console", (msg) => {
    if (msg.type() === "error") guestErrors.push(msg.text());
  });
  guest.on("pageerror", (err) => guestErrors.push(String(err)));

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register host, create a meeting (waiting room ON by default), host joins");
  await register(host, "Guest Fix Host", `guestfixhost${suffix}`, `guestfixhost${suffix}@arutech.dev`);
  await host.click("text=New meeting");
  await host.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingCode = new URL(host.url()).pathname.split("/").pop();
  await host.click('button:has-text("Join meeting")');
  await host.waitForSelector("footer", { timeout: 15000 });
  await shot(host, "01-host-in-meeting");

  console.log("STEP: a genuine GUEST (no account, real join-as-guest flow) joins and waits");
  await guest.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  const nameInput = guest.locator('input[type="text"]').first();
  await nameInput.fill(`Real Guest ${suffix}`);
  await guest.click('button:has-text("Join meeting")', { timeout: 15000 });
  const sawWaiting = await guest
    .waitForSelector("text=Waiting for the host", { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  console.log("GUEST_SAW_WAITING_ROOM:", sawWaiting);
  await shot(guest, "02-guest-waiting");
  if (!sawWaiting) throw new Error("guest never reached the waiting room");

  // Give the guest socket (now authenticated with a guest token — the whole
  // point of this fix) a moment to finish connecting and join its personal
  // room before the host admits.
  await guest.waitForTimeout(2000);

  console.log("STEP: host admits the guest from the Participants panel");
  await host.click('button[aria-label="Participants"], button:has-text("Participants")').catch(() => {});
  const admitBtn = host.locator('button:has-text("Admit")');
  await admitBtn.first().waitFor({ timeout: 8000 });
  await shot(host, "03-host-participants-panel");
  const [admitResponse] = await Promise.all([
    host.waitForResponse((r) => r.url().includes("/admit") && r.request().method() === "POST", { timeout: 8000 }),
    admitBtn.first().click(),
  ]);
  console.log("ADMIT_REST_CALL_STATUS:", admitResponse.status());

  console.log("STEP: does the guest's screen actually update live and enter the meeting room?");
  const guestEnteredMeeting = await guest
    .waitForSelector("footer", { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  console.log("GUEST_ENTERED_MEETING_LIVE (expect true — this is finding C-1):", guestEnteredMeeting);
  await shot(guest, "04-guest-in-meeting");
  if (!guestEnteredMeeting) throw new Error("BUG STILL PRESENT: guest never entered the meeting after admit");

  console.log("STEP: guest opens chat and sends a message — must reach the host live");
  await guest.click('button:has-text("Chat")');
  const guestChatInput = guest.locator('textarea, input[placeholder*="essage" i]').last();
  await guestChatInput.waitFor({ timeout: 8000 });
  await guestChatInput.fill("hello from a real unauthenticated guest");
  await guestChatInput.press("Enter");
  await shot(guest, "05-guest-sent-chat");

  await host.click('button:has-text("Chat")');
  const hostSawGuestMessage = await host
    .waitForSelector("text=hello from a real unauthenticated guest", { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  console.log("HOST_SAW_GUEST_CHAT_MESSAGE_LIVE (expect true):", hostSawGuestMessage);
  await shot(host, "06-host-sees-guest-chat");

  const guestNameRendered = await host.locator(`text=Real Guest ${suffix}`).count();
  console.log("HOST_SEES_GUEST_DISPLAY_NAME_ON_MESSAGE (senderGuestName, not a crash):", guestNameRendered);

  console.log("CONSOLE_ERRORS_ON_GUEST_PAGE_START");
  for (const e of guestErrors) console.log(" ", e);
  console.log("CONSOLE_ERRORS_ON_GUEST_PAGE_END", `(${guestErrors.length} total)`);

  const pass = sawWaiting && guestEnteredMeeting && hostSawGuestMessage;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
