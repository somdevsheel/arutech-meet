// Verifies the follow-up: "like instant meeting need instant webinar
// option" — a one-click "Instant webinar" action on the dashboard, same
// shape as "New meeting", that immediately starts a webinar (attendees
// view-only) with no Schedule modal detour.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "instant-webinar");
fs.mkdirSync(shotDir, { recursive: true });
let shotN = 0;
async function shot(page, label) {
  shotN += 1;
  await page.screenshot({ path: path.join(shotDir, `${String(shotN).padStart(2, "0")}-${label}.png`) });
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

  console.log("STEP: register and land on the dashboard");
  await register(host, "Instant Webinar Host", `iwhost${suffix}`, `iwhost${suffix}@arutech.dev`);
  await host.waitForTimeout(500);
  await shot(host, "01-dashboard-with-instant-webinar-card");

  console.log("STEP: a real 'Instant webinar' card now sits right next to New meeting (didn't exist before)");
  const cardVisible = await host.getByText("Instant webinar", { exact: true }).isVisible().catch(() => false);
  console.log("INSTANT_WEBINAR_CARD_EXISTS (expect true):", cardVisible);
  if (!cardVisible) pass = false;

  console.log("STEP: click it — no Schedule modal detour, straight to a live, no-waiting-room webinar");
  await host.getByText("Instant webinar", { exact: true }).click();
  await host.waitForURL("**/meeting/**", { timeout: 15000 });
  const urlHasShare = host.url().includes("share=1");
  console.log("LANDS_ON_LOBBY_WITH_SHARE_PARAM (expect true):", urlHasShare);
  if (!urlHasShare) pass = false;
  await host.waitForTimeout(500);
  const lobbyNotice = await host.locator("text=This is a webinar").isVisible().catch(() => false);
  console.log("LOBBY_CONFIRMS_WEBINAR_MODE (expect true):", lobbyNotice);
  if (!lobbyNotice) pass = false;
  await shot(host, "02-instant-webinar-lobby");

  await host.click('button:has-text("Join meeting")');
  await host.waitForSelector("footer", { timeout: 15000 });
  await host.waitForTimeout(1000);
  const meetingUrl = host.url().split("?")[0];

  console.log("STEP: no waiting room — same 'instant' semantics as New meeting, a second real account joins straight in");
  await register(attendee, "Instant Webinar Attendee", `iwattendee${suffix}`, `iwattendee${suffix}@arutech.dev`);
  await attendee.goto(meetingUrl, { waitUntil: "networkidle" });
  await attendee.waitForTimeout(500);
  const attendeeLobbyNotice = await attendee.locator("text=This is a webinar").isVisible().catch(() => false);
  console.log("ATTENDEE_ALSO_SEES_WEBINAR_NOTICE (expect true):", attendeeLobbyNotice);
  if (!attendeeLobbyNotice) pass = false;
  await attendee.click('button:has-text("Join meeting")');
  await attendee.waitForSelector("footer", { timeout: 15000 });
  await attendee.waitForTimeout(1500);
  const noWaitingRoom = attendee.url().includes("/meeting/") && !(await attendee.locator("text=Waiting for the host").isVisible().catch(() => false));
  console.log("NO_WAITING_ROOM_JOINED_STRAIGHT_IN (expect true):", noWaitingRoom);
  if (!noWaitingRoom) pass = false;
  await shot(attendee, "03-attendee-joined-instant-webinar-view-only");

  console.log("STEP: attendee is genuinely view-only, exactly like the scheduled-webinar case");
  const muteDisabled = await attendee.getByText("Unmute", { exact: true }).isDisabled();
  console.log("ATTENDEE_MUTE_DISABLED (expect true):", muteDisabled);
  if (!muteDisabled) pass = false;

  console.log("STEP: 'New meeting' (plain instant meeting) still works exactly as before — no regression");
  const host2Page = await browser.newContext({ viewport: { width: 1280, height: 900 } }).then((c) => c.newPage());
  await register(host2Page, "Plain Instant Test", `plaininst${suffix}`, `plaininst${suffix}@arutech.dev`);
  await host2Page.click("text=New meeting");
  await host2Page.waitForURL("**/meeting/**", { timeout: 15000 });
  await host2Page.waitForTimeout(500);
  const plainHasNoWebinarNotice = await host2Page.locator("text=This is a webinar").isVisible().catch(() => false);
  console.log("PLAIN_INSTANT_MEETING_HAS_NO_WEBINAR_NOTICE (expect false -- regression check):", plainHasNoWebinarNotice);
  if (plainHasNoWebinarNotice) pass = false;
  await host2Page.click('button:has-text("Join meeting")');
  await host2Page.waitForSelector("footer", { timeout: 15000 });
  const plainHostMuteEnabled = await host2Page.getByText("Mute", { exact: true }).isEnabled().catch(() => false);
  console.log("PLAIN_INSTANT_MEETING_MUTE_STILL_ENABLED (expect true -- regression check):", plainHostMuteEnabled);
  if (!plainHostMuteEnabled) pass = false;

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
