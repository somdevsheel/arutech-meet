// Verifies M-3: Settings (and validation errors generally) showed raw
// internal field names like "avatarUrl: Invalid url" straight from the API.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "humanized-validation-errors");
fs.mkdirSync(shotDir, { recursive: true });
let shotN = 0;
async function shot(page, label) {
  shotN += 1;
  const file = path.join(shotDir, `${String(shotN).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file });
  console.log("SCREENSHOT:", file);
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
  const email = `zodui${suffix}@arutech.dev`;
  const username = `zodui${suffix}`;
  let pass = true;

  console.log("STEP: register a real account");
  await page.goto("http://localhost:3000/register", { waitUntil: "networkidle" });
  const regInputs = page.locator("input");
  await regInputs.nth(0).fill("Zod UI User");
  await regInputs.nth(1).fill(username);
  await regInputs.nth(2).fill(email);
  await regInputs.nth(3).fill("OldPassword1");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 15000 });

  // Bypass the client-side zod check (which would block the request before
  // it ever reaches the server) by writing an invalid URL directly and
  // submitting via the DOM form, so this actually exercises the server's
  // real error response end to end, not just client-side validation.
  console.log("STEP: Settings — trigger a REAL server-side validation error via an invalid avatar URL");
  await page.goto("http://localhost:3000/settings", { waitUntil: "networkidle" });
  await page.fill('input[placeholder="https://…"]', "not a valid url");
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/users/me") && r.request().method() === "PATCH"),
    page.click('button:has-text("Save changes")'),
  ]);
  const body = await resp.json();
  console.log("SERVER_RESPONSE_STATUS:", resp.status());
  console.log("SERVER_RESPONSE_MESSAGE:", JSON.stringify(body.error?.message));
  await page.waitForTimeout(300);
  await shot(page, "01-settings-avatar-url-error");

  const bannerText = await page.locator("text=/Avatar URL/i").first().textContent().catch(() => null);
  console.log("UI_SHOWS_HUMAN_LABEL 'Avatar URL' (expect true):", !!bannerText);
  if (!bannerText) pass = false;

  const rawFieldNameVisible = await page.locator("text=/avatarUrl/").count();
  console.log("UI_SHOWS_RAW_FIELD_NAME 'avatarUrl' (expect 0):", rawFieldNameVisible);
  if (rawFieldNameVisible !== 0) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
