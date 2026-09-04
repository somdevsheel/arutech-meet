// Verifies the reported bug: "co host and participant unable to share
// screen, make it possible but participant screen share need permission" —
// (1) the host can already share directly (baseline, should be unaffected),
// (2) a plain participant now sees a "Request to share screen" button
// instead of a silently-failing "Share screen" one, (3) the host gets a
// real approve/deny prompt, (4) approving flips the participant's button to
// a real, working "Share screen", (5) a promoted co-host can share directly
// with zero request needed.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "screen-share-permission");
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
    args: [
      "--no-sandbox",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--auto-select-desktop-capture-source=Entire screen",
    ],
  });
  const ctxHost = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxPart = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const host = await ctxHost.newPage();
  const part = await ctxPart.newPage();
  const errors = { host: [], part: [] };
  for (const [label, p] of [["host", host], ["part", part]]) {
    p.on("pageerror", (err) => errors[label].push(String(err)));
    p.on("console", (msg) => {
      if (msg.type() === "error") errors[label].push(msg.text());
    });
  }
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("STEP: register host and participant, both join the same instant meeting");
  await register(host, "Screen Host", `screenhost${suffix}`, `screenhost${suffix}@arutech.dev`);
  await register(part, "Screen Part", `screenpart${suffix}`, `screenpart${suffix}@arutech.dev`);
  await host.click("text=New meeting");
  await host.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingUrl = host.url();
  await host.click('button:has-text("Join meeting")');
  await host.waitForSelector("footer", { timeout: 15000 });
  await part.goto(meetingUrl, { waitUntil: "networkidle" });
  await part.click('button:has-text("Join meeting")');
  await part.waitForSelector("footer", { timeout: 15000 });
  await host.waitForTimeout(1200);

  console.log("STEP: baseline — host already has a real Share screen button (unaffected by this change)");
  const hostShareBtn = host.locator('footer button:has-text("Share screen")');
  console.log("HOST_HAS_SHARE_BUTTON (expect >=1):", await hostShareBtn.count());
  if ((await hostShareBtn.count()) < 1) pass = false;

  console.log("STEP: the participant should NOT see a working Share screen button — only a Request one");
  // Exact match matters here: "Request to share screen" contains "Share
  // screen" as a case-insensitive substring, so a plain :has-text("Share
  // screen") would wrongly match both buttons.
  const partShareBtn = part.getByText("Share screen", { exact: true });
  const partRequestBtn = part.locator('footer button:has-text("Request to share screen")');
  console.log("PART_HAS_DIRECT_SHARE_BUTTON (expect 0):", await partShareBtn.count());
  console.log(
    "PART_HAS_REQUEST_BUTTON (expect >=1 -- this is the actual bug: no request affordance existed at all before):",
    await partRequestBtn.count(),
  );
  if ((await partShareBtn.count()) !== 0 || (await partRequestBtn.count()) < 1) pass = false;
  await shot(part, "01-participant-sees-request-button");

  console.log("STEP: participant clicks Request — button should show a pending state");
  await partRequestBtn.click();
  await part.waitForTimeout(500);
  const pendingVisible = await part.locator('footer button:has-text("Requesting")').isVisible().catch(() => false);
  console.log("PART_SHOWS_PENDING (expect true):", pendingVisible);
  if (!pendingVisible) pass = false;
  await shot(part, "02-participant-requesting");

  console.log("STEP: host should see a real approve/deny prompt with the participant's real name");
  await host.waitForTimeout(800);
  const banner = host.locator("text=Screen Part wants to share their screen");
  const bannerVisible = await banner.isVisible().catch(() => false);
  console.log("HOST_SEES_REQUEST_BANNER (expect true):", bannerVisible);
  if (!bannerVisible) pass = false;
  await shot(host, "03-host-sees-approve-deny-banner");

  console.log("STEP: host clicks Approve — participant's button should become a real, working Share screen button");
  await host.click('button:has-text("Approve")');
  await part.waitForTimeout(800);
  const partShareBtnAfterApproval = part.locator('footer button:has-text("Share screen")');
  const approvedVisible = await partShareBtnAfterApproval.isVisible().catch(() => false);
  console.log("PART_HAS_REAL_SHARE_BUTTON_AFTER_APPROVAL (expect true):", approvedVisible);
  if (!approvedVisible) pass = false;
  await shot(part, "04-participant-approved-real-share-button");

  console.log("STEP: participant clicks it — the actual, previously-broken action: does the SFU now really accept the publish?");
  await partShareBtnAfterApproval.click();
  await part.waitForTimeout(2500);
  const nowSharing = await part.locator('footer button:has-text("Stop sharing")').isVisible().catch(() => false);
  console.log("PART_IS_ACTUALLY_SHARING (expect true -- this is the real proof the SFU grant took effect):", nowSharing);
  if (!nowSharing) pass = false;
  await shot(part, "05-participant-actually-sharing");
  await host.waitForTimeout(1000);
  await shot(host, "06-host-sees-participant-sharing");
  await part.click('footer button:has-text("Stop sharing")');
  await part.waitForTimeout(800);

  console.log("STEP: separately — promote a fresh participant to CO_HOST, confirm they get a real Share button with zero request");
  const ctxCoHost = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const coHost = await ctxCoHost.newPage();
  await register(coHost, "Screen CoHost", `screencohost${suffix}`, `screencohost${suffix}@arutech.dev`);
  await coHost.goto(meetingUrl, { waitUntil: "networkidle" });
  await coHost.click('button:has-text("Join meeting")');
  await coHost.waitForSelector("footer", { timeout: 15000 });
  await host.waitForTimeout(800);
  await host.click('footer button:has-text("Participants")');
  await host.waitForTimeout(500);
  // The row div carries a real aria-label ("Participant row: <name>") —
  // unambiguous, unlike a plain :has-text() combinator, which matches every
  // ANCESTOR div whose subtree happens to contain that text too (here, the
  // whole participants-list container — meaning a naive
  // `div:has-text("Screen CoHost") button[title="Make co-host"]` also
  // matches every OTHER participant's promote button, since they're all
  // descendants of that same container).
  await host.click('[aria-label="Participant row: Screen CoHost"] button[title="Make co-host"]');
  await coHost.waitForTimeout(3000);
  await coHost.click('footer button:has-text("Participants")');
  await coHost.waitForTimeout(500);
  const ownRowText = await coHost
    .locator('[aria-label="Participant row: Screen CoHost"]')
    .textContent()
    .catch(() => "N/A");
  console.log("COHOST_OWN_PARTICIPANTS_ROW_TEXT (diagnostic — did the promotion even land?):", ownRowText);
  await coHost.click('footer button:has-text("Participants")');
  await coHost.waitForTimeout(300);
  const coHostShareBtn = coHost.getByText("Share screen", { exact: true });
  const coHostHasDirectShare = await coHostShareBtn.isVisible().catch(() => false);
  const coHostStillHasRequestBtn = await coHost
    .locator('footer button:has-text("Request to share screen")')
    .isVisible()
    .catch(() => false);
  console.log("PROMOTED_COHOST_STILL_SHOWS_REQUEST_BUTTON (expect false):", coHostStillHasRequestBtn);
  if (coHostStillHasRequestBtn) pass = false;
  console.log("PROMOTED_COHOST_HAS_DIRECT_SHARE_BUTTON_NO_REQUEST_NEEDED (expect true):", coHostHasDirectShare);
  if (!coHostHasDirectShare) pass = false;
  await shot(coHost, "07-promoted-cohost-has-direct-share-button");

  console.log("STEP: no console/page errors for host or participant");
  console.log("HOST_CONSOLE_ERRORS:", JSON.stringify(errors.host));
  console.log("PART_CONSOLE_ERRORS:", JSON.stringify(errors.part));
  if (errors.host.length > 0 || errors.part.length > 0) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
