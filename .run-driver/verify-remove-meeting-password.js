// Verifies the reported bug: the Personal room settings modal showed
// "Meeting password (currently set)" with no way to actually remove it —
// only a text field to type a NEW password, no clear/disable control.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "remove-meeting-password");
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
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("STEP: register and land on dashboard");
  await register(page, "PW Remove QA", `pwrmqa${suffix}`, `pwrmqa${suffix}@arutech.dev`);

  console.log("STEP: open Personal room settings and set a password");
  await page.click('button[aria-label="Personal room settings"]');
  await page.waitForSelector("text=Personal room settings");
  await page.fill('input[type="password"]', "secret1234");
  await shot(page, "01-typed-new-password");
  await page.click('button:has-text("Save")');
  await page.waitForTimeout(700);

  console.log("STEP: reopen the modal — it should now say the password is currently set, and offer a way to remove it");
  await page.click('button[aria-label="Personal room settings"]');
  await page.waitForSelector("text=Personal room settings");
  const currentlySet = await page.locator("text=currently set").count();
  console.log("SHOWS_CURRENTLY_SET (expect >=1):", currentlySet);
  if (currentlySet < 1) pass = false;
  const removeBtn = page.locator('button:has-text("Remove password")');
  const removeBtnCount = await removeBtn.count();
  console.log("HAS_REMOVE_PASSWORD_BUTTON (expect >=1 -- this is the actual bug being fixed):", removeBtnCount);
  if (removeBtnCount < 1) pass = false;
  await shot(page, "02-password-set-with-remove-button");

  console.log("STEP: click Remove password — UI should show the pending-removal state, input disabled");
  await removeBtn.click();
  await page.waitForTimeout(200);
  const willBeRemoved = await page.locator("text=will be removed").count();
  console.log("SHOWS_WILL_BE_REMOVED (expect >=1):", willBeRemoved);
  if (willBeRemoved < 1) pass = false;
  const inputDisabled = await page.locator('input[type="password"]').isDisabled();
  console.log("PASSWORD_INPUT_DISABLED (expect true):", inputDisabled);
  if (!inputDisabled) pass = false;
  await shot(page, "03-marked-for-removal");

  console.log("STEP: save — password should now actually be removed");
  await page.click('button:has-text("Save")');
  await page.waitForTimeout(700);

  console.log("STEP: reopen the modal once more — no 'currently set', no Remove button, plain no-password copy");
  await page.click('button[aria-label="Personal room settings"]');
  await page.waitForSelector("text=Personal room settings");
  const currentlySetAfter = await page.locator("text=currently set").count();
  const removeBtnAfter = await page.locator('button:has-text("Remove password")').count();
  const noPasswordCopy = await page.locator("text=Leave blank for no password").count();
  console.log("SHOWS_CURRENTLY_SET_AFTER_REMOVAL (expect 0):", currentlySetAfter);
  console.log("HAS_REMOVE_BUTTON_AFTER_REMOVAL (expect 0):", removeBtnAfter);
  console.log("SHOWS_NO_PASSWORD_COPY (expect >=1):", noPasswordCopy);
  if (currentlySetAfter !== 0 || removeBtnAfter !== 0 || noPasswordCopy < 1) pass = false;
  await shot(page, "04-password-actually-removed");

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
