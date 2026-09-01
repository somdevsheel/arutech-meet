// Verifies H-4: every new meeting had a waiting room on by default with no
// way to turn it off at creation. Checks: (1) "New meeting" (instant) now
// lets a second participant straight in, no waiting room; (2) the Schedule
// modal now has a real, working waiting-room toggle.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "waiting-room-defaults");
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
  const ctxPart = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const host = await ctxHost.newPage();
  const part = await ctxPart.newPage();

  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("=== TEST 1: instant 'New meeting' — no waiting room by default ===");
  await register(host, "Instant Host", `instanthost${suffix}`, `instanthost${suffix}@arutech.dev`);
  await host.click("text=New meeting");
  await host.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingCode1 = new URL(host.url()).pathname.split("/").pop();
  await host.click('button:has-text("Join meeting")');
  await host.waitForSelector("footer", { timeout: 15000 });

  await register(part, "Instant Part", `instantpart${suffix}`, `instantpart${suffix}@arutech.dev`);
  await part.goto(`http://localhost:3000/meeting/${meetingCode1}`, { waitUntil: "networkidle" });
  await part.click('button:has-text("Join meeting")', { timeout: 15000 });
  const partSawFooter = await part
    .waitForSelector("footer", { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  const partSawWaiting = await part.locator("text=Waiting for the host").count();
  console.log("INSTANT_JOINER_STRAIGHT_IN (expect true):", partSawFooter);
  console.log("INSTANT_JOINER_SAW_WAITING_ROOM (expect 0):", partSawWaiting);
  await shot(part, "01-instant-joiner-straight-in");
  if (!partSawFooter || partSawWaiting !== 0) pass = false;

  console.log("=== TEST 2: Schedule modal exposes a real waiting-room toggle ===");
  await host.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });
  await host.click("text=Schedule");
  await host.waitForSelector("text=Schedule a meeting", { timeout: 8000 });
  await shot(host, "02-schedule-modal-with-toggle");
  const toggleVisible = await host.locator('button[role="switch"]').count();
  console.log("SCHEDULE_MODAL_HAS_WAITING_ROOM_TOGGLE (expect >=1):", toggleVisible);
  if (toggleVisible < 1) pass = false;

  // Turn it off and schedule — capture the actual POST /meetings response to
  // confirm the toggle really reaches the server, not just the UI.
  await host.fill('input[placeholder="Weekly sync"]', "Open Scheduled Meeting");
  await host.click('button[role="switch"]');
  await shot(host, "03-toggle-turned-off");
  const [createResponse] = await Promise.all([
    host.waitForResponse((r) => r.url().endsWith("/api/v1/meetings") && r.request().method() === "POST"),
    host.locator('button:has-text("Schedule")').last().click(),
  ]);
  const created = await createResponse.json();
  console.log("SCHEDULED_MEETING_WAITING_ROOM_ENABLED (expect false):", created.settings?.waitingRoomEnabled);
  if (created.settings?.waitingRoomEnabled !== false) pass = false;
  await shot(host, "04-after-scheduling");

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
