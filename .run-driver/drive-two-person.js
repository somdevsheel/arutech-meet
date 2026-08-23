// Two-context verification driver for the video-grid / reactions / raise-hand /
// participants-panel changes: registers two real users in two independent
// browser contexts (separate cookies/sessions, like two different devices),
// gets both into the SAME meeting (host + waiting-room admit), and exercises
// the new controls with a REAL second participant present.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "two-person");
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

  const ctxA = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const errors = { A: [], B: [] };
  for (const [label, page] of [["A", pageA], ["B", pageB]]) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors[label].push(msg.text());
    });
    page.on("pageerror", (err) => errors[label].push(String(err)));
  }

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register host (A)");
  await register(pageA, "Host User", `hosta${suffix}`, `hosta${suffix}@arutech.dev`);
  await shot(pageA, "a-dashboard");

  console.log("STEP: A creates an instant meeting");
  await pageA.click('button:has-text("New meeting")');
  await pageA.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingCode = new URL(pageA.url()).pathname.split("/").pop();
  console.log("MEETING_CODE:", meetingCode);
  await pageA.waitForTimeout(2000);
  await shot(pageA, "a-prejoin");
  await pageA.click('button:has-text("Join meeting")');
  await pageA.waitForTimeout(4000);
  await shot(pageA, "a-meeting-room-alone");

  console.log("STEP: register participant (B)");
  await register(pageB, "Guest User", `guestb${suffix}`, `guestb${suffix}@arutech.dev`);

  console.log("STEP: B navigates directly to A's meeting code");
  await pageB.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await pageB.waitForTimeout(2000);
  await shot(pageB, "b-prejoin");
  const joinBtnB = pageB.locator('button:has-text("Join meeting")');
  if (await joinBtnB.count()) {
    await joinBtnB.first().click();
  }
  await pageB.waitForTimeout(3000);
  await shot(pageB, "b-waiting-room");

  console.log("STEP: A admits B from the waiting room panel");
  const admitBtn = pageA.locator('button:has-text("Admit")');
  try {
    await admitBtn.first().waitFor({ timeout: 10000 });
    await admitBtn.first().click();
    console.log("Clicked Admit");
  } catch {
    console.log("No Admit button found within timeout — B may not require admission, or waiting-room UI differs");
  }

  await pageB.waitForTimeout(5000);
  await shot(pageB, "b-meeting-room-admitted");
  await pageA.waitForTimeout(2000);
  await shot(pageA, "a-meeting-room-with-b");

  console.log("STEP: A raises hand + sends a reaction");
  const raiseHandBtn = pageA.locator('button:has-text("Raise hand")');
  if (await raiseHandBtn.count()) {
    await raiseHandBtn.first().click();
    await pageA.waitForTimeout(500);
  }
  const reactBtn = pageA.locator('button:has-text("React")');
  if (await reactBtn.count()) {
    await reactBtn.first().click();
    await pageA.waitForTimeout(300);
    const emojiBtn = pageA.locator("button", { hasText: "👏" });
    if (await emojiBtn.count()) await emojiBtn.first().click();
  }
  await pageA.waitForTimeout(500);
  await shot(pageA, "a-hand-raised-reaction-sent");

  console.log("STEP: B sees the reaction + A's raised hand in participants panel");
  await pageB.waitForTimeout(500);
  await shot(pageB, "b-sees-reaction");
  const participantsBtnB = pageB.locator('button:has-text("Participants")');
  if (await participantsBtnB.count()) {
    await participantsBtnB.first().click();
    await pageB.waitForTimeout(500);
    await shot(pageB, "b-participants-panel");
  }

  console.log("STEP: A switches video grid to Speaker view, then pins B");
  const speakerBtn = pageA.locator('button:has-text("Speaker")');
  if (await speakerBtn.count()) {
    await speakerBtn.first().click();
    await pageA.waitForTimeout(1000);
    await shot(pageA, "a-speaker-view");
  }
  await pageA.hover('[data-video-tile]');
  const pinBtn = pageA.locator('[data-video-tile] button[title="Pin"]');
  if (await pinBtn.count()) {
    await pinBtn.first().click();
    await pageA.waitForTimeout(500);
    await shot(pageA, "a-pinned-tile");
  }

  console.log("STEP: A toggles gallery view + hide-non-video");
  const galleryBtn = pageA.locator('button:has-text("Gallery")');
  if (await galleryBtn.count()) {
    await galleryBtn.first().click();
    await pageA.waitForTimeout(500);
    await shot(pageA, "a-gallery-view");
  }

  console.log("CONSOLE_ERRORS_A_START");
  for (const e of errors.A) console.log("  A:", e);
  console.log("CONSOLE_ERRORS_A_END", `(${errors.A.length} total)`);
  console.log("CONSOLE_ERRORS_B_START");
  for (const e of errors.B) console.log("  B:", e);
  console.log("CONSOLE_ERRORS_B_END", `(${errors.B.length} total)`);

  await browser.close();
  console.log("DONE");
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
