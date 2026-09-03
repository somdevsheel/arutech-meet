// Verifies the in-app notification side of meeting invites: inviting an
// email that already has an account should notify them in-app (not just by
// email), and clicking that notification should take them straight to the
// meeting.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "meeting-invite-notification");
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
    args: ["--no-sandbox"],
  });
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errors = [];
  b.on("pageerror", (err) => errors.push(String(err)));
  b.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  const suffix = Date.now().toString().slice(-6);
  let pass = true;
  const bEmail = `notifyb${suffix}@arutech.dev`;

  console.log("STEP: register A (inviter) and B (invitee, has a real account already)");
  await register(a, "Notify A", `notifya${suffix}`, `notifya${suffix}@arutech.dev`);
  await register(b, "Notify B", `notifyb${suffix}`, bEmail);

  console.log("STEP: A schedules a meeting and invites B by B's real email");
  await a.click("text=Schedule");
  await a.waitForTimeout(300);
  await a.fill('input[placeholder="Weekly sync"]', "Design Review");
  await a.click('div.fixed.inset-0 button:has-text("Schedule")');
  await a.waitForTimeout(800);
  await a.click('li:has-text("Design Review") button:has-text("Invite")');
  await a.waitForTimeout(300);
  await a.fill('input[type="email"]', bEmail);
  await a.click('button:has-text("Send invite")');
  await a.waitForTimeout(800);

  console.log("STEP: B (separate browser, separate account) should see a real notification bell badge without any action of their own");
  await b.reload({ waitUntil: "networkidle" });
  await b.waitForTimeout(1000);
  await shot(b, "01-b-dashboard-with-notification-badge");
  const bellBadge = await b.locator('button[aria-label="Notifications"] span').first().isVisible().catch(() => false);
  console.log("B_HAS_NOTIFICATION_BADGE (expect true):", bellBadge);
  if (!bellBadge) pass = false;

  console.log("STEP: opening it and clicking the invite notification takes B straight to the meeting");
  await b.click('button[aria-label="Notifications"]');
  await b.waitForTimeout(300);
  await shot(b, "02-b-notification-panel-open");
  const notifText = await b.locator("text=Design Review").first().isVisible().catch(() => false);
  console.log("NOTIFICATION_MENTIONS_MEETING_TITLE (expect true):", notifText);
  if (!notifText) pass = false;
  await b.click('text=Design Review');
  await b.waitForURL("**/meeting/**", { timeout: 10000 }).catch(() => {});
  await shot(b, "03-b-landed-on-meeting-lobby");
  const onMeetingPage = b.url().includes("/meeting/");
  console.log("B_NAVIGATED_TO_MEETING (expect true):", onMeetingPage, b.url());
  if (!onMeetingPage) pass = false;

  console.log("STEP: no console/page errors for B");
  console.log("CONSOLE_ERRORS:", JSON.stringify(errors));
  if (errors.length > 0) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
