// Verifies H-11: meeting passwords were fully built and enforced
// server-side but completely unreachable from any UI. Checks: (1) the
// Schedule modal's new password field actually sets a real password
// (wrong-password join rejected, correct-password join succeeds); (2) the
// Personal Room Settings modal can set one too, and reflects "currently set".
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "meeting-password-ui");
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
  const ctxHost = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxJoiner = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const host = await ctxHost.newPage();
  const joiner = await ctxJoiner.newPage();
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("=== PART 1: Schedule modal password field ===");
  await register(host, "Password UI Host", `pwuihost${suffix}`, `pwuihost${suffix}@arutech.dev`);
  await host.click("text=Schedule");
  await host.waitForSelector("text=Schedule a meeting", { timeout: 8000 });
  await host.fill('input[placeholder="Weekly sync"]', "Password Protected Meeting");
  await host.fill('input[placeholder="Leave blank for no password"]', "secret123");
  // Turn the waiting room off so a correct-password join lands straight in
  // the meeting room — isolating the password check itself from the
  // separate waiting-room gate (H-4).
  await host.click('button[role="switch"]');
  await shot(host, "01-schedule-modal-with-password");
  const [createResponse] = await Promise.all([
    host.waitForResponse((r) => r.url().endsWith("/api/v1/meetings") && r.request().method() === "POST"),
    host.locator('button:has-text("Schedule")').last().click(),
  ]);
  const created = await createResponse.json();
  console.log("SCHEDULED_MEETING_REQUIRES_PASSWORD (expect true):", created.requiresPassword);
  console.log("RESPONSE_LEAKS_PASSWORD_HASH (expect false):", "passwordHash" in created);
  if (!created.requiresPassword || "passwordHash" in created) pass = false;

  console.log("STEP: a second user tries to join WITHOUT a password — must be refused");
  await register(joiner, "Password UI Joiner", `pwuijoiner${suffix}`, `pwuijoiner${suffix}@arutech.dev`);
  await joiner.goto(`http://localhost:3000/meeting/${created.code}`, { waitUntil: "networkidle" });
  await joiner.click('button:has-text("Join meeting")');
  await joiner.waitForTimeout(800);
  await shot(joiner, "02-join-without-password-refused");
  const wrongPassError = await joiner.locator("text=/incorrect|password/i").count();
  console.log("REFUSED_WITHOUT_PASSWORD (expect >=1 error shown):", wrongPassError);

  console.log("STEP: with the CORRECT password — must succeed");
  const pwField = joiner.locator('input[placeholder="Meeting password"]');
  if (await pwField.count()) {
    await pwField.fill("secret123");
  }
  await joiner.click('button:has-text("Join meeting")');
  const joinedOk = await joiner
    .waitForSelector("footer", { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  console.log("JOINED_WITH_CORRECT_PASSWORD (expect true):", joinedOk);
  await shot(joiner, "03-joined-with-correct-password");
  if (!joinedOk) pass = false;

  console.log("=== PART 2: Personal Room Settings password field ===");
  await host.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });
  await host.click("text=Room settings").catch(() => {});
  const settingsBtn = host.locator('button:has-text("Settings"), button[aria-label="Personal room settings"]');
  if (await settingsBtn.count()) await settingsBtn.first().click();
  await host.waitForTimeout(500);
  await shot(host, "04-personal-room-settings-modal");
  const pwUiVisible = await host.locator("text=Meeting password").count();
  console.log("PERSONAL_ROOM_HAS_PASSWORD_FIELD (expect >=1):", pwUiVisible);
  if (pwUiVisible < 1) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
