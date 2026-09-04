// Verifies the fix for the production bug report "screen share option is
// not working after approved". Root cause: server logs showed real
// request/approve cycles succeeding (200s) for a participant on Android
// Chrome mobile, repeated 3x across 2 meetings — but getDisplayMedia()
// doesn't exist on mobile browsers at all, so the approved Share screen
// button could never actually work, and the failure was completely silent
// (no catch anywhere, button just quietly re-enabled). This driver:
// (1) simulates a browser with no getDisplayMedia (mobile) via an
// addInitScript patch BEFORE the page loads, and confirms the participant
// sees an honest "Not supported here" instead of a Request button that can
// only ever dead-end; (2) simulates a desktop browser where
// getDisplayMedia() rejects (permission denied / cancelled) and confirms a
// real, visible error message appears instead of the button just silently
// resetting with zero feedback.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "screen-share-mobile-unsupported");
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
  // No getDisplayMedia at all -- simulates real mobile Chrome/Safari.
  const ctxMobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctxMobile.addInitScript(() => {
    // Mobile browsers simply don't expose this API. getDisplayMedia lives on
    // MediaDevices.prototype, not as an own property, so `delete` on the
    // instance is a no-op (it still resolves via the prototype chain) --
    // shadow it with an own `undefined` property instead, exactly matching
    // what `typeof navigator.mediaDevices?.getDisplayMedia === "function"`
    // sees on a real unsupported browser.
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      value: undefined,
      configurable: true,
    });
  });
  const host = await ctxHost.newPage();
  const mobile = await ctxMobile.newPage();
  const errors = { host: [], mobile: [] };
  for (const [label, p] of [["host", host], ["mobile", mobile]]) {
    p.on("pageerror", (err) => errors[label].push(String(err)));
  }
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("STEP: register host and a participant on a simulated mobile browser (no getDisplayMedia)");
  await register(host, "Mobile Host", `mobilehost${suffix}`, `mobilehost${suffix}@arutech.dev`);
  await register(mobile, "Mobile Part", `mobilepart${suffix}`, `mobilepart${suffix}@arutech.dev`);
  await host.click("text=New meeting");
  await host.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingUrl = host.url();
  await host.click('button:has-text("Join meeting")');
  await host.waitForSelector("footer", { timeout: 15000 });
  await mobile.goto(meetingUrl, { waitUntil: "networkidle" });
  await mobile.click('button:has-text("Join meeting")');
  await mobile.waitForSelector("footer", { timeout: 15000 });
  await host.waitForTimeout(1000);

  console.log("STEP: mobile participant should see an honest 'Not supported here', NOT a Request button that can only dead-end");
  const notSupported = mobile.locator('footer >> text=Not supported here');
  const requestBtn = mobile.locator('footer button:has-text("Request to share screen")');
  const notSupportedVisible = await notSupported.isVisible().catch(() => false);
  const requestBtnVisible = await requestBtn.isVisible().catch(() => false);
  console.log("MOBILE_SHOWS_NOT_SUPPORTED (expect true):", notSupportedVisible);
  console.log("MOBILE_SHOWS_REQUEST_BUTTON (expect false -- this is the actual bug: a futile request/approve dance):", requestBtnVisible);
  if (!notSupportedVisible || requestBtnVisible) pass = false;
  await shot(mobile, "01-mobile-not-supported-instead-of-request");

  console.log("STEP: host is on a real desktop browser -- unaffected, still gets the direct Share screen button");
  const hostShareBtn = host.getByText("Share screen", { exact: true });
  const hostHasShareBtn = await hostShareBtn.isVisible().catch(() => false);
  console.log("HOST_STILL_HAS_REAL_SHARE_BUTTON (expect true -- desktop unaffected):", hostHasShareBtn);
  if (!hostHasShareBtn) pass = false;

  console.log("STEP: on the host's own desktop button, simulate getDisplayMedia rejecting (e.g. user cancels the OS picker)");
  await host.evaluate(() => {
    const md = navigator.mediaDevices;
    const orig = md.getDisplayMedia.bind(md);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (md /** @type any */).getDisplayMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    // stash so we don't need it again
    (window /** @type any */).__origGetDisplayMedia = orig;
  });
  await hostShareBtn.click();
  await host.waitForTimeout(800);
  const errorVisible = await host.locator("text=Screen share was cancelled or blocked.").isVisible().catch(() => false);
  console.log("HOST_SEES_REAL_ERROR_MESSAGE (expect true -- previously this failed completely silently):", errorVisible);
  if (!errorVisible) pass = false;
  await shot(host, "02-host-sees-error-instead-of-silent-failure");

  console.log("STEP: no unexpected page errors");
  console.log("HOST_PAGE_ERRORS:", JSON.stringify(errors.host));
  console.log("MOBILE_PAGE_ERRORS:", JSON.stringify(errors.mobile));
  if (errors.host.length > 0 || errors.mobile.length > 0) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
