// Verifies the actual bug: deny() used to publish only to the meeting room,
// which a still-WAITING participant's socket was never in — the denied
// person's screen just spun on "Waiting for the host..." forever. Also
// verifies a denied participant can't undo it by simply reloading (join()
// used to unconditionally reset status back to WAITING on reconnect).
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "waiting-room-deny");
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
  const ctxHost = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const ctxGuest = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const host = await ctxHost.newPage();
  const guest = await ctxGuest.newPage();
  const errors = [];
  guest.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  guest.on("pageerror", (err) => errors.push(String(err)));

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register host, create a meeting with the waiting room ON (default)");
  await register(host, "Deny UI Host", `denyuihost${suffix}`, `denyuihost${suffix}@arutech.dev`);
  await host.click("text=New meeting");
  await host.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingCode = new URL(host.url()).pathname.split("/").pop();
  await host.click('button:has-text("Join meeting")');
  await host.waitForSelector("footer", { timeout: 15000 });

  console.log("STEP: register a second user, join the meeting -> lands in the waiting room");
  await register(guest, "Deny UI Guest", `denyuiguest${suffix}`, `denyuiguest${suffix}@arutech.dev`);
  await guest.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await guest.click('button:has-text("Join meeting")', { timeout: 15000 });
  await guest.waitForSelector("text=Waiting for the host", { timeout: 15000 });
  await shot(guest, "01-guest-waiting");

  console.log("STEP: host denies the waiting participant");
  // Give the guest's socket a real moment to finish connecting and join its
  // personal user:{id} room before the deny fires — the room-scoped
  // broadcast this fix relies on isn't queued/replayed for a socket that
  // hasn't joined yet, so this isn't just test flakiness padding.
  await guest.waitForTimeout(2500);
  await host.waitForTimeout(1000);
  await shot(host, "01b-host-before-deny-click");
  const denyBtn = host.locator('button:has-text("Deny")');
  const denyCount = await denyBtn.count();
  console.log("DENY_BUTTON_COUNT_ON_HOST_PAGE:", denyCount);
  const [denyResponse] = await Promise.all([
    host.waitForResponse((r) => r.url().includes("/deny") && r.request().method() === "POST", { timeout: 8000 }).catch((e) => {
      console.log("NO_DENY_RESPONSE_OBSERVED:", e.message);
      return null;
    }),
    denyBtn.first().click(),
  ]);
  console.log("DENY_REST_CALL_STATUS:", denyResponse ? denyResponse.status() : "never fired");

  console.log("STEP: does the guest's screen actually update live? (the real bug under test)");
  const deniedMessage = await guest
    .waitForSelector("text=didn't let you into this meeting", { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  console.log("GUEST_SAW_DENIAL_LIVE (expect true, was stuck spinning forever before the fix):", deniedMessage);
  await shot(guest, "02-guest-sees-denial");
  if (!deniedMessage) throw new Error("BUG STILL PRESENT: guest never received the deny signal");

  console.log("STEP: guest reloads and tries to join again — must be refused, not silently re-admitted to WAITING");
  await guest.reload({ waitUntil: "networkidle" });
  const joinBtnAfterReload = guest.locator('button:has-text("Join meeting")');
  await joinBtnAfterReload.waitFor({ timeout: 10000 });
  await joinBtnAfterReload.click();
  await guest.waitForTimeout(1500);
  await shot(guest, "03-guest-after-reload-rejoin-attempt");

  const backInWaitingRoom = await guest.locator("text=Waiting for the host").count();
  const gotAnError = await guest.locator("text=/denied entry|removed from/i").count();
  console.log("GUEST_BACK_IN_WAITING_ROOM_AFTER_RELOAD (expect 0 — this is the reload-resurrection bug):", backInWaitingRoom);
  console.log("GUEST_GOT_A_REAL_REFUSAL_ERROR (expect >=1):", gotAnError);

  console.log("CONSOLE_ERRORS_START");
  for (const e of errors) console.log(" ", e);
  console.log("CONSOLE_ERRORS_END", `(${errors.length} total)`);

  const pass = deniedMessage && backInWaitingRoom === 0 && gotAnError >= 1;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
