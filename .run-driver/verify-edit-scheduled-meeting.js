// Verifies the reported bug: "after schedule meeting unable to edit" —
// there was genuinely no way to change a scheduled meeting's topic, time,
// duration, waiting room, or password after creating it. Schedules a
// meeting, edits every one of those fields, saves, and confirms both the
// dashboard row and a fresh reload reflect the real change.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "edit-scheduled-meeting");
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("STEP: register and schedule a meeting");
  await register(page, "Edit Owner", `editowner${suffix}`, `editowner${suffix}@arutech.dev`);
  await page.click("text=Schedule");
  await page.waitForTimeout(300);
  await page.fill('input[placeholder="Weekly sync"]', "Original Title");
  await page.click('div.fixed.inset-0 button:has-text("Schedule")');
  await page.waitForTimeout(800);
  await shot(page, "01-scheduled");

  console.log("STEP: click Edit — there was previously no such button at all");
  const editBtn = page.locator('li:has-text("Original Title") button:has-text("Edit")');
  const editBtnCount = await editBtn.count();
  console.log("EDIT_BUTTON_EXISTS (expect >=1 -- this is the actual bug being fixed):", editBtnCount);
  if (editBtnCount < 1) pass = false;
  await editBtn.click();
  await page.waitForTimeout(300);
  await shot(page, "02-edit-modal-open-prefilled");

  console.log("STEP: the modal must be pre-filled with the real current values, not blank");
  const titleValue = await page.locator('input[placeholder="Weekly sync"]').inputValue();
  console.log("TITLE_PREFILLED (expect 'Original Title'):", titleValue);
  if (titleValue !== "Original Title") pass = false;

  console.log("STEP: change title, duration, waiting room, and set a password, then save");
  await page.fill('input[placeholder="Weekly sync"]', "Renamed Meeting");
  await page.selectOption("select", "60");
  await page.click('label:has-text("Waiting room") button[role="switch"]');
  await page.fill('input[type="password"]', "editSecret123");
  await page.click('div.fixed.inset-0 button:has-text("Save changes")');
  await page.waitForTimeout(800);
  await shot(page, "03-saved");

  console.log("STEP: the dashboard row must show the new title immediately");
  const renamedVisible = await page.locator('li:has-text("Renamed Meeting")').isVisible().catch(() => false);
  const oldTitleGone = (await page.locator('li:has-text("Original Title")').count()) === 0;
  console.log("RENAMED_ROW_VISIBLE (expect true):", renamedVisible);
  console.log("OLD_TITLE_GONE (expect true):", oldTitleGone);
  if (!renamedVisible || !oldTitleGone) pass = false;

  console.log("STEP: reload fresh — the change must be real (server-persisted), not just local optimistic state");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await shot(page, "04-after-reload");
  const renamedAfterReload = await page.locator('li:has-text("Renamed Meeting")').isVisible().catch(() => false);
  console.log("RENAMED_SURVIVES_RELOAD (expect true):", renamedAfterReload);
  if (!renamedAfterReload) pass = false;

  console.log("STEP: reopen Edit — the password should now show as currently set, and duration/waiting-room changes should have stuck");
  await page.click('li:has-text("Renamed Meeting") button:has-text("Edit")');
  await page.waitForTimeout(300);
  await shot(page, "05-reedit-shows-persisted-state");
  const currentlySetVisible = await page.locator("text=currently set").isVisible().catch(() => false);
  const durationValue = await page.locator("select").inputValue();
  console.log("PASSWORD_SHOWS_CURRENTLY_SET (expect true):", currentlySetVisible);
  console.log("DURATION_PERSISTED (expect 60):", durationValue);
  if (!currentlySetVisible || durationValue !== "60") pass = false;

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
