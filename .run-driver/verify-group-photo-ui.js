// UI-level companion to verify-group-photo-removable.js — drives the actual
// "Remove photo" button added to GroupSettingsModal, confirming it really
// clears photoUrl through the real form submit path (photoUrl.trim() ||
// null), not just the raw API.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "group-photo-ui");
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
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  const suffix = Date.now().toString().slice(-6);

  console.log(
    "STEP: register admin + a second member, create a real GROUP room via the UI's New chat flow's API equivalent",
  );
  await register(page, "UI Photo Admin", `uiphoto${suffix}`, `uiphoto${suffix}@arutech.dev`);
  const authRes = await fetch("http://localhost:4000/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `uiphoto${suffix}@arutech.dev`, password: "Password123!" }),
  });
  const auth = await authRes.json();
  const member = await fetch("http://localhost:4000/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      displayName: "UI Photo Member",
      username: `uiphotomem${suffix}`,
      email: `uiphotomem${suffix}@arutech.dev`,
      password: "Password123!",
    }),
  }).then((r) => r.json());
  const roomRes = await fetch("http://localhost:4000/api/v1/chat-rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.accessToken}` },
    body: JSON.stringify({
      type: "GROUP",
      name: "UI Photo Test Group",
      memberUserIds: [member.user.id],
    }),
  }).then((r) => r.json());
  await fetch(`http://localhost:4000/api/v1/chat-rooms/${roomRes.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.accessToken}` },
    body: JSON.stringify({ photoUrl: "https://example.com/pre-existing-photo.png" }),
  });

  console.log("STEP: admin opens Team Chat, selects the group, opens Manage settings");
  await page.goto("http://localhost:3000/chat", { waitUntil: "networkidle" });
  await page.click("text=UI Photo Test Group");
  await page.waitForTimeout(500);
  await page.click('button:has-text("Manage")');
  await page.waitForTimeout(500);
  await shot(page, "01-settings-open-with-existing-photo");

  const photoInputBefore = await page.locator('input[placeholder="https://…"]').inputValue();
  console.log(
    "PHOTO_INPUT_SHOWS_EXISTING_URL (expect the pre-existing photo URL):",
    photoInputBefore,
  );
  const removeButtonVisible = await page.locator('button:has-text("Remove photo")').count();
  console.log(
    "REMOVE_PHOTO_BUTTON_PRESENT (expect >=1 — this is the new affordance):",
    removeButtonVisible,
  );

  console.log("STEP: click 'Remove photo' then Save — this is the actual fix's UI path");
  await page.click('button:has-text("Remove photo")');
  await page.waitForTimeout(200);
  const photoInputAfterClear = await page.locator('input[placeholder="https://…"]').inputValue();
  console.log(
    "PHOTO_INPUT_EMPTIED_LOCALLY (expect empty string):",
    JSON.stringify(photoInputAfterClear),
  );
  await shot(page, "02-photo-cleared-locally");
  await page.click('button:has-text("Save")');
  await page.waitForTimeout(1000);
  await shot(page, "03-after-save");

  console.log(
    "STEP: reopen settings fresh (new modal instance) — did the removal genuinely persist server-side?",
  );
  await page.click('button:has-text("Close")');
  await page.waitForTimeout(300);
  await page.click('button:has-text("Manage")');
  await page.waitForTimeout(500);
  const photoInputAfterReopen = await page.locator('input[placeholder="https://…"]').inputValue();
  console.log(
    "PHOTO_STILL_EMPTY_AFTER_REOPEN (expect empty — proves it's a real persisted null, not just local UI state):",
    JSON.stringify(photoInputAfterReopen),
  );
  await shot(page, "04-reopened-settings-confirms-removal");

  console.log("CONSOLE_ERRORS_START");
  for (const e of errors) console.log(" ", e);
  console.log("CONSOLE_ERRORS_END", `(${errors.length} total)`);

  const pass =
    photoInputBefore === "https://example.com/pre-existing-photo.png" &&
    removeButtonVisible >= 1 &&
    photoInputAfterClear === "" &&
    photoInputAfterReopen === "";
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
