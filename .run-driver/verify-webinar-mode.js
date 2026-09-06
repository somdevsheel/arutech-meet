// Verifies the feature request: "need to add webinar option also" —
// attendees join view-only (no camera/mic, can watch/chat/raise hand),
// promoting one to co-host is the way to let them speak.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "webinar-mode");
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
  const ctxAttendee = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const host = await ctxHost.newPage();
  const attendee = await ctxAttendee.newPage();
  const errors = { host: [], attendee: [] };
  for (const [label, p] of [["host", host], ["attendee", attendee]]) {
    p.on("pageerror", (err) => errors[label].push(String(err)));
  }
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("STEP: host registers and schedules a real webinar");
  await register(host, "Webinar Host", `webhost${suffix}`, `webhost${suffix}@arutech.dev`);
  await host.click("text=Schedule");
  await host.waitForTimeout(500);
  await host.locator('input[placeholder="Weekly sync"]').fill("Product Launch Webinar");
  const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 16);
  await host.locator('input[type="datetime-local"]').first().fill(future);
  await host.locator('label:has-text("Webinar") button[role="switch"]').click();
  await host.getByRole("button", { name: "Schedule", exact: true }).click();
  await host.waitForTimeout(1200);
  await shot(host, "01-webinar-scheduled");

  console.log("STEP: get the meeting link from the dashboard's Share button");
  const shareBtn = host.locator('li:has-text("Product Launch Webinar") button:has-text("Share")');
  await shareBtn.click();
  await host.waitForTimeout(400);
  const modal = host.locator(".fixed.inset-0").last();
  const meetingLink = await modal.locator('input[readonly]').first().inputValue();
  console.log("MEETING_LINK:", meetingLink);
  await modal.locator('button[aria-label="Close"]').click();

  console.log("STEP: host joins their own webinar");
  await host.goto(meetingLink, { waitUntil: "networkidle" });
  await host.click('button:has-text("Join meeting")');
  await host.waitForSelector("footer", { timeout: 15000 });
  await host.waitForTimeout(1000);
  const hostMuteDisabled = await host.getByText("Mute", { exact: true }).isDisabled().catch(() => null);
  console.log("HOST_MUTE_BUTTON_DISABLED (expect false -- host is always a moderator):", hostMuteDisabled);
  if (hostMuteDisabled) pass = false;

  console.log("STEP: register + join as an attendee, confirm the lobby notice appears first");
  await register(attendee, "Webinar Attendee", `webattendee${suffix}`, `webattendee${suffix}@arutech.dev`);
  await attendee.goto(meetingLink, { waitUntil: "networkidle" });
  await attendee.waitForTimeout(500);
  const lobbyNoticeVisible = await attendee.locator("text=This is a webinar").isVisible().catch(() => false);
  console.log("LOBBY_SHOWS_WEBINAR_NOTICE (expect true):", lobbyNoticeVisible);
  if (!lobbyNoticeVisible) pass = false;
  await shot(attendee, "02-attendee-lobby-notice");

  await attendee.click('button:has-text("Join meeting")');
  await attendee.waitForTimeout(1500);

  console.log("STEP: host admits the waiting attendee (waiting room is on by default for a scheduled meeting)");
  await host.waitForTimeout(500);
  await host.click('button:has-text("Admit")');
  await attendee.waitForSelector("footer", { timeout: 15000 });
  await attendee.waitForTimeout(1500);
  await shot(attendee, "03-attendee-joined-view-only");

  console.log("STEP: attendee's Mute/Camera are genuinely disabled at the HTML level, not just visually");
  // Attendee joins with mic/camera never enabled at all (canPublishAudioVideo:
  // false suppresses the auto-enable-on-connect), so the button reads
  // "Unmute"/"Start video", same label a moderator would see before ever
  // turning theirs on — the real signal here is the `disabled` attribute.
  const muteBtn = attendee.getByText("Unmute", { exact: true });
  const muteDisabled = await muteBtn.isDisabled();
  console.log("ATTENDEE_MUTE_DISABLED (expect true):", muteDisabled);
  if (!muteDisabled) pass = false;
  const cameraBtn = attendee.getByText("Start video", { exact: true });
  const cameraDisabled = await cameraBtn.isDisabled();
  console.log("ATTENDEE_CAMERA_DISABLED (expect true):", cameraDisabled);
  if (!cameraDisabled) pass = false;
  const noCameraCaret = await attendee.locator('button[aria-label="Choose camera"]').count();
  console.log("ATTENDEE_HAS_NO_CAMERA_SWITCH_CARET (expect 0):", noCameraCaret);
  if (noCameraCaret !== 0) pass = false;

  console.log("STEP: attendee can still chat and raise hand — not fully locked out");
  await attendee.click('footer button:has-text("Chat")');
  await attendee.waitForTimeout(300);
  await attendee.fill('input[placeholder="Type message here…"]', "Great presentation!");
  await attendee.click('button[aria-label="Send message"]');
  await attendee.waitForTimeout(500);
  const chatWorks = await attendee.locator("text=Great presentation!").isVisible().catch(() => false);
  console.log("ATTENDEE_CAN_CHAT (expect true):", chatWorks);
  if (!chatWorks) pass = false;

  await attendee.click('footer button:has-text("Raise hand")');
  await attendee.waitForTimeout(500);
  const handRaised = await attendee.locator('footer button:has-text("Lower hand")').isVisible().catch(() => false);
  console.log("ATTENDEE_CAN_RAISE_HAND (expect true):", handRaised);
  if (!handRaised) pass = false;
  await shot(attendee, "04-attendee-can-chat-and-raise-hand");

  console.log("STEP: host promotes the attendee to co-host — they should be able to unmute live, no refresh");
  await host.click('footer button:has-text("Participants")');
  await host.waitForTimeout(500);
  await host.click('[aria-label="Participant row: Webinar Attendee"] button[title="Make co-host"]');
  await attendee.waitForTimeout(1500);
  const attendeeMuteNowEnabled = await attendee.getByText("Unmute", { exact: true }).isEnabled();
  console.log("PROMOTED_ATTENDEE_MUTE_NOW_ENABLED (expect true):", attendeeMuteNowEnabled);
  if (!attendeeMuteNowEnabled) pass = false;
  await shot(attendee, "05-promoted-attendee-can-now-unmute");

  console.log("STEP: promoted attendee can actually unmute/turn on camera for real now");
  await attendee.getByText("Start video", { exact: true }).click();
  await attendee.waitForTimeout(1500);
  const nowSharingVideo = await attendee.locator('footer button:has-text("Stop video")').isVisible().catch(() => false);
  console.log("PROMOTED_ATTENDEE_CAMERA_ACTUALLY_WORKS (expect true):", nowSharingVideo);
  if (!nowSharingVideo) pass = false;
  await shot(attendee, "06-promoted-attendee-camera-actually-on");

  console.log("STEP: no console/page errors");
  console.log("HOST_ERRORS:", JSON.stringify(errors.host));
  console.log("ATTENDEE_ERRORS:", JSON.stringify(errors.attendee));
  if (errors.host.length > 0 || errors.attendee.length > 0) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
