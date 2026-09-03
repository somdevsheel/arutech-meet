// Verifies the reported bug: "unable to invite participant in scheduled
// meeting" — there was genuinely no way to invite a specific person to a
// meeting at all (MeetingInvite existed in the schema, unused). This checks
// the real end-to-end flow: schedule a meeting, invite someone by email,
// confirm the invite shows in the pending list, a real email actually
// arrives (via MailHog), and revoking removes it.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "meeting-invite");
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

async function mailhogMessages() {
  const res = await fetch("http://localhost:8025/api/v2/messages");
  return res.json();
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  const suffix = Date.now().toString().slice(-6);
  let pass = true;
  const inviteeEmail = `invitee${suffix}@arutech.dev`;

  console.log("STEP: register the meeting owner and schedule a meeting");
  await register(page, "Invite Owner", `inviteowner${suffix}`, `inviteowner${suffix}@arutech.dev`);
  await page.click("text=Schedule");
  await page.waitForTimeout(300);
  await page.fill('input[placeholder="Weekly sync"]', "Sprint Planning");
  await page.click('div.fixed.inset-0 button:has-text("Schedule")');
  await page.waitForTimeout(800);
  await shot(page, "01-meeting-scheduled");

  console.log("STEP: click Invite on the newly-scheduled meeting");
  const inviteBtn = page.locator('li:has-text("Sprint Planning") button:has-text("Invite")');
  const inviteBtnCount = await inviteBtn.count();
  console.log("INVITE_BUTTON_EXISTS (expect >=1 -- this is the actual bug being fixed):", inviteBtnCount);
  if (inviteBtnCount < 1) pass = false;
  await inviteBtn.click();
  await page.waitForTimeout(300);
  await shot(page, "02-invite-modal-open");

  console.log("STEP: send a real invite by email");
  await page.fill('input[type="email"]', inviteeEmail);
  await page.click('button:has-text("Send invite")');
  await page.waitForTimeout(800);
  await shot(page, "03-invite-sent-confirmation");
  const confirmationVisible = await page.locator(`text=Invited ${inviteeEmail}`).isVisible().catch(() => false);
  console.log("CONFIRMATION_VISIBLE (expect true):", confirmationVisible);
  if (!confirmationVisible) pass = false;

  console.log("STEP: the pending-invites list should now show this email");
  const pendingRowVisible = await page.locator(`li:has-text("${inviteeEmail}")`).isVisible().catch(() => false);
  console.log("PENDING_INVITE_ROW_VISIBLE (expect true):", pendingRowVisible);
  if (!pendingRowVisible) pass = false;

  console.log("STEP: a real email should have actually been sent (checking MailHog)");
  const mail = await mailhogMessages();
  const found = (mail.items || []).find((m) =>
    (m.To || []).some((t) => `${t.Mailbox}@${t.Domain}`.toLowerCase() === inviteeEmail.toLowerCase()),
  );
  console.log("REAL_EMAIL_ARRIVED (expect truthy):", Boolean(found));
  if (found) {
    console.log("EMAIL_SUBJECT:", found.Content.Headers.Subject?.[0]);
  }
  if (!found) pass = false;

  console.log("STEP: revoke the invite — it should disappear from the pending list");
  await page.click('button:has-text("Revoke")');
  await page.waitForTimeout(500);
  await shot(page, "04-invite-revoked");
  const pendingRowAfterRevoke = await page.locator(`li:has-text("${inviteeEmail}")`).count();
  console.log("PENDING_ROW_AFTER_REVOKE (expect 0):", pendingRowAfterRevoke);
  if (pendingRowAfterRevoke !== 0) pass = false;

  console.log("STEP: no console/page errors happened during any of this");
  console.log("CONSOLE_ERRORS:", JSON.stringify(errors));
  if (errors.length > 0) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
