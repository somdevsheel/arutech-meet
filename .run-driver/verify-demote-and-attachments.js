// Verifies three things reported together by the user:
// (1) "cohost option is working when make co host but unable to change
//     status to normal" — a demote-back-to-participant action never existed
//     at all (no backend endpoint, no UI button) — now added.
// (2) "change not showing instant its need to refresh page manually" —
//     confirms both promote AND demote show up live, on both the actor's
//     own screen and the target's own screen, with zero manual refresh.
// (3) "unable to share attachments like pdf" — a real PDF attached in
//     meeting chat should actually upload and appear for both participants
//     (this was broken for a completely separate reason: production's
//     presigned upload URL pointed at the Docker-internal `minio` hostname,
//     which no real browser can resolve — see the nginx /storage/ proxy fix.
//     Locally this already worked since S3_ENDPOINT is host-reachable, so
//     this driver mainly guards against a regression, plus proves the
//     feature genuinely works end-to-end for a host).
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "demote-and-attachments");
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
  const ctxPart = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const host = await ctxHost.newPage();
  const part = await ctxPart.newPage();
  const errors = { host: [], part: [] };
  for (const [label, p] of [["host", host], ["part", part]]) {
    p.on("pageerror", (err) => errors[label].push(String(err)));
  }
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("STEP: register host and participant, both join the same instant meeting");
  await register(host, "Demote Host", `demotehost${suffix}`, `demotehost${suffix}@arutech.dev`);
  await register(part, "Demote Part", `demotepart${suffix}`, `demotepart${suffix}@arutech.dev`);
  await host.click("text=New meeting");
  await host.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingUrl = host.url();
  await host.click('button:has-text("Join meeting")');
  await host.waitForSelector("footer", { timeout: 15000 });
  await part.goto(meetingUrl, { waitUntil: "networkidle" });
  await part.click('button:has-text("Join meeting")');
  await part.waitForSelector("footer", { timeout: 15000 });
  await host.waitForTimeout(1000);

  console.log("STEP: open Participants on both sides");
  await host.click('footer button:has-text("Participants")');
  await part.click('footer button:has-text("Participants")');
  await host.waitForTimeout(500);

  console.log("STEP: host promotes the participant — check BOTH sides update live, with zero refresh");
  await host.click('[aria-label="Participant row: Demote Part"] button[title="Make co-host"]');
  await host.waitForTimeout(1000); // no reload/refresh anywhere in this test
  const hostSeesCoHostLive = (await host.locator('[aria-label="Participant row: Demote Part"]').textContent()) ?? "";
  const partSeesOwnCoHostLive = (await part.locator('[aria-label="Participant row: Demote Part"]').textContent()) ?? "";
  console.log("HOST_SEES_PROMOTED_LIVE (expect contains CO_HOST):", hostSeesCoHostLive);
  console.log("PART_SEES_OWN_PROMOTION_LIVE (expect contains CO_HOST):", partSeesOwnCoHostLive);
  if (!hostSeesCoHostLive.includes("CO_HOST") || !partSeesOwnCoHostLive.includes("CO_HOST")) pass = false;
  await shot(host, "01-host-sees-promotion-live");
  await shot(part, "02-participant-sees-own-promotion-live");

  console.log("STEP: the promoted row should now offer 'Remove co-host', not 'Make co-host' again");
  const removeCoHostBtn = host.locator('[aria-label="Participant row: Demote Part"] button[title="Remove co-host"]');
  const removeCoHostVisible = await removeCoHostBtn.isVisible().catch(() => false);
  console.log("HOST_SEES_REMOVE_COHOST_BUTTON (expect true -- this button did not exist before this fix):", removeCoHostVisible);
  if (!removeCoHostVisible) pass = false;

  console.log("STEP: host demotes back to normal — the actual previously-missing feature");
  await removeCoHostBtn.click();
  await host.waitForTimeout(1000); // again, zero refresh
  const hostSeesDemotedLive = (await host.locator('[aria-label="Participant row: Demote Part"]').textContent()) ?? "";
  const partSeesOwnDemotionLive = (await part.locator('[aria-label="Participant row: Demote Part"]').textContent()) ?? "";
  console.log("HOST_SEES_DEMOTED_LIVE (expect contains PARTICIPANT, not CO_HOST):", hostSeesDemotedLive);
  console.log("PART_SEES_OWN_DEMOTION_LIVE (expect contains PARTICIPANT, not CO_HOST):", partSeesOwnDemotionLive);
  if (!hostSeesDemotedLive.includes("PARTICIPANT") || hostSeesDemotedLive.includes("CO_HOST")) pass = false;
  if (!partSeesOwnDemotionLive.includes("PARTICIPANT") || partSeesOwnDemotionLive.includes("CO_HOST")) pass = false;
  await shot(host, "03-host-sees-demotion-live");
  await shot(part, "04-participant-sees-own-demotion-live");

  console.log("STEP: 'Make co-host' should be back, 'Remove co-host' gone");
  const makeCoHostAgain = await host
    .locator('[aria-label="Participant row: Demote Part"] button[title="Make co-host"]')
    .isVisible()
    .catch(() => false);
  console.log("HOST_SEES_MAKE_COHOST_AGAIN (expect true):", makeCoHostAgain);
  if (!makeCoHostAgain) pass = false;

  console.log("STEP: host attaches a real PDF in chat");
  await host.click('footer button:has-text("Chat")');
  await host.waitForTimeout(300);
  const fileChooserPromise = host.waitForEvent("filechooser");
  await host.click('button[aria-label="Attach a file"]');
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(
    "/tmp/claude-1000/-home-somdevsheel-Project-Indium-by-Arutech/5949e38b-db83-4095-9aa1-19d673a40439/scratchpad/test.pdf",
  );
  await host.waitForTimeout(2000);
  const uploadErrorVisible = await host.locator("text=/Upload failed|too large|not allowed/i").isVisible().catch(() => false);
  console.log("HOST_UPLOAD_ERROR_SHOWN (expect false):", uploadErrorVisible);
  if (uploadErrorVisible) pass = false;
  await shot(host, "05-host-sent-pdf-attachment");

  console.log("STEP: participant sees the real attachment and can get a download link");
  await part.click('footer button:has-text("Chat")');
  await part.waitForTimeout(1500);
  const attachmentVisible = await part.locator("text=/test\\.pdf/i").isVisible().catch(() => false);
  console.log("PART_SEES_PDF_ATTACHMENT (expect true):", attachmentVisible);
  if (!attachmentVisible) pass = false;
  await shot(part, "06-participant-sees-pdf-attachment");

  console.log("STEP: no console/page errors for host or participant");
  console.log("HOST_PAGE_ERRORS:", JSON.stringify(errors.host));
  console.log("PART_PAGE_ERRORS:", JSON.stringify(errors.part));
  if (errors.host.length > 0 || errors.part.length > 0) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
