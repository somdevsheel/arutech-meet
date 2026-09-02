// Verifies M-2: Settings had no way to change your password or avatar —
// the Profile section had a display-name field only, and there was no
// change-password form or endpoint anywhere.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "settings-password-avatar");
fs.mkdirSync(shotDir, { recursive: true });
let shotN = 0;
async function shot(page, label) {
  shotN += 1;
  const file = path.join(shotDir, `${String(shotN).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file });
  console.log("SCREENSHOT:", file);
}

async function register(page, name, username, email, password) {
  await page.goto("http://localhost:3000/register", { waitUntil: "networkidle" });
  const inputs = page.locator("input");
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill(username);
  await inputs.nth(2).fill(email);
  await inputs.nth(3).fill(password);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 15000 });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const suffix = Date.now().toString().slice(-6);
  const email = `settingsqa${suffix}@arutech.dev`;
  const username = `settingsqa${suffix}`;
  const oldPassword = "OldPassword1";
  const newPassword = "BrandNewPassword2";
  const avatarUrl = "https://placehold.co/128x128/6d5ef8/ffffff.png?text=QA";
  let pass = true;

  console.log("STEP: register a real account");
  await register(page, "Settings QA User", username, email, oldPassword);

  console.log("STEP: go to Settings, set an avatar URL, save");
  await page.goto("http://localhost:3000/settings", { waitUntil: "networkidle" });
  await page.fill('input[placeholder="https://…"]', avatarUrl);
  await page.click('button:has-text("Save changes")');
  await page.waitForSelector("text=Saved", { timeout: 8000 });
  // Give the freshly-set avatar a moment to actually load before screenshotting.
  await page.waitForTimeout(1000);
  await shot(page, "01-avatar-set-and-saved");

  console.log("STEP: the topbar avatar must now render the real image, not initials");
  const topbarImg = await page.locator("header img, nav img").first();
  const topbarImgVisible = await topbarImg.isVisible().catch(() => false);
  const topbarImgSrc = topbarImgVisible ? await topbarImg.getAttribute("src") : null;
  console.log("TOPBAR_AVATAR_IMG_VISIBLE (expect true):", topbarImgVisible);
  console.log("TOPBAR_AVATAR_IMG_SRC matches what was saved:", topbarImgSrc === avatarUrl);
  if (!topbarImgVisible || topbarImgSrc !== avatarUrl) pass = false;

  console.log("STEP: reload — avatar must persist (it's real saved profile data, not local state)");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const persistedSrc = await page.locator("header img, nav img").first().getAttribute("src").catch(() => null);
  console.log("AVATAR_PERSISTS_AFTER_RELOAD (expect true):", persistedSrc === avatarUrl);
  if (persistedSrc !== avatarUrl) pass = false;
  await shot(page, "02-avatar-persists-after-reload");

  console.log("STEP: fill out Change password with the WRONG current password — must be rejected");
  await page.fill('input[type="password"] >> nth=0', "TotallyWrongPassword1");
  await page.fill('input[type="password"] >> nth=1', newPassword);
  await page.fill('input[type="password"] >> nth=2', newPassword);
  await page.click('button:has-text("Change password")');
  await page.waitForSelector("text=/current password is incorrect/i", { timeout: 8000 });
  await shot(page, "03-wrong-current-password-rejected");
  console.log("WRONG_CURRENT_PASSWORD_REJECTED: true");

  console.log("STEP: now the REAL current password — must succeed and sign out");
  await page.fill('input[type="password"] >> nth=0', oldPassword);
  await page.fill('input[type="password"] >> nth=1', newPassword);
  await page.fill('input[type="password"] >> nth=2', newPassword);
  await page.click('button:has-text("Change password")');
  await page.waitForSelector("text=Password changed", { timeout: 8000 });
  await shot(page, "04-password-changed-message");
  const loggedOut = await page.waitForURL("**/login", { timeout: 8000 }).then(() => true).catch(() => false);
  console.log("REDIRECTED_TO_LOGIN_AFTER_CHANGE (expect true):", loggedOut);
  if (!loggedOut) pass = false;

  console.log("STEP: log in with the OLD password — must fail (session/password both changed)");
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', oldPassword);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(800);
  const oldRejected = await page.locator("text=/invalid email or password/i").count();
  console.log("OLD_PASSWORD_REJECTED (expect >=1):", oldRejected);
  if (oldRejected < 1) pass = false;

  console.log("STEP: log in with the NEW password — must succeed");
  await page.fill('input[type="password"]', newPassword);
  await page.click('button[type="submit"]');
  const loggedIn = await page.waitForURL("**/dashboard", { timeout: 8000 }).then(() => true).catch(() => false);
  console.log("NEW_PASSWORD_WORKS (expect true):", loggedIn);
  await shot(page, "05-logged-in-with-new-password");
  if (!loggedIn) pass = false;

  console.log("STEP: 'Remove avatar' must clear it back to initials");
  await page.goto("http://localhost:3000/settings", { waitUntil: "networkidle" });
  await page.click('button:has-text("Remove avatar")');
  await page.click('button:has-text("Save changes")');
  await page.waitForSelector("text=Saved", { timeout: 8000 });
  await page.waitForTimeout(500);
  const avatarImgCountAfterRemove = await page.locator("header img, nav img").count();
  console.log("AVATAR_IMG_GONE_AFTER_REMOVE (expect 0):", avatarImgCountAfterRemove);
  await shot(page, "06-avatar-removed-back-to-initials");
  if (avatarImgCountAfterRemove !== 0) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
