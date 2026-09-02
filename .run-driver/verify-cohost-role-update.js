// Verifies M-7: promoting someone to co-host didn't update their role
// anywhere on screen — MODERATION_ROLE_CHANGE only ever set an internal
// `lastModeration` value nothing read for this event type, never patching
// the `participants` list the Participants panel's role label reads off
// of, and the promoted participant's OWN effective role (used to gate every
// moderator control they'd now be entitled to) was a one-time snapshot from
// their join response that never updated either — so even the newly-
// promoted co-host couldn't actually use their new powers without leaving
// and rejoining.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "cohost-role-update");
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
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const hostPage = await hostCtx.newPage();
  const guestPage = await guestCtx.newPage();
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("STEP: HOST registers and starts an instant meeting");
  await register(hostPage, "Cohost Host", `cohosthost${suffix}`, `cohosthost${suffix}@arutech.dev`);
  await hostPage.click("text=New meeting");
  await hostPage.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingUrl = hostPage.url();
  await hostPage.click('button:has-text("Join meeting")');
  await hostPage.waitForSelector("footer", { timeout: 15000 });

  console.log("STEP: GUEST (a real registered PARTICIPANT, not the owner) joins the same meeting");
  await register(guestPage, "Cohost Target", `cohosttarget${suffix}`, `cohosttarget${suffix}@arutech.dev`);
  await guestPage.goto(meetingUrl, { waitUntil: "networkidle" });
  await guestPage.click('button:has-text("Join meeting")');
  await guestPage.waitForSelector("footer", { timeout: 15000 });

  console.log("STEP: BEFORE promotion — the guest's own Record panel must NOT show moderator-only recording controls");
  await guestPage.click('button:has-text("Record")');
  const beforeModeratorControls = await guestPage.locator("text=MEETING RECORDING").count();
  console.log("GUEST_SEES_MODERATOR_RECORDING_CONTROLS_BEFORE (expect 0):", beforeModeratorControls);
  if (beforeModeratorControls !== 0) pass = false;

  console.log("STEP: BEFORE promotion — the host's Participants panel shows the guest as PARTICIPANT");
  await hostPage.click('button:has-text("Participants")');
  await hostPage.waitForSelector("text=Cohost Target", { timeout: 8000 });
  const roleBefore = await hostPage.locator('[aria-label="Participant row: Cohost Target"]').textContent();
  console.log("HOST_SEES_ROLE_BEFORE:", roleBefore.match(/·\s*(\w+)/)?.[1]);
  await shot(hostPage, "01-host-sees-participant-before-promotion");

  console.log("STEP: HOST clicks 'Make co-host' on the guest");
  await hostPage.locator('[aria-label="Participant row: Cohost Target"] button[title="Make co-host"]').click();

  console.log("STEP: AFTER promotion — the host's own panel must update the label live, no reload");
  await hostPage.waitForFunction(
    () => {
      const row = document.querySelector('[aria-label="Participant row: Cohost Target"]');
      return row && row.textContent.includes("CO_HOST");
    },
    { timeout: 8000 },
  );
  const roleAfter = await hostPage.locator('[aria-label="Participant row: Cohost Target"]').textContent();
  console.log("HOST_SEES_ROLE_AFTER (expect CO_HOST):", roleAfter.match(/·\s*(\w+)/)?.[1]);
  await shot(hostPage, "02-host-sees-cohost-label-live");
  if (!roleAfter.includes("CO_HOST")) pass = false;

  console.log("STEP: AFTER promotion — the GUEST's own Record panel must show moderator recording controls live, no reload");
  await guestPage.waitForSelector("text=MEETING RECORDING", { timeout: 8000 });
  await shot(guestPage, "03-guest-sees-own-moderator-controls-live");
  const afterModeratorControls = await guestPage.locator("text=MEETING RECORDING").count();
  console.log("GUEST_SEES_MODERATOR_RECORDING_CONTROLS_AFTER (expect >=1 — this is the actual M-7 fix):", afterModeratorControls);
  if (afterModeratorControls < 1) pass = false;

  console.log("STEP: AFTER promotion — the GUEST's own Participants panel also shows THEIR row as CO_HOST");
  await guestPage.click('button:has-text("Participants")');
  await guestPage.waitForFunction(
    () => {
      const row = document.querySelector('[aria-label="Participant row: Cohost Target"]');
      return row && row.textContent.includes("CO_HOST");
    },
    { timeout: 8000 },
  );
  const guestSeesOwnRole = await guestPage.locator('[aria-label="Participant row: Cohost Target"]').count();
  console.log("GUEST_SEES_OWN_ROLE_UPDATED (expect >=1):", guestSeesOwnRole);
  await shot(guestPage, "04-guest-sees-own-role-in-panel");

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
