// Verifies M-8: group photos could be set and removed correctly (the PATCH
// round-tripped photoUrl to the DB fine) but were never actually shown
// anywhere — every room avatar (sidebar list, open-conversation header, and
// the settings modal that sets it) rendered initials unconditionally,
// regardless of photoUrl. Same underlying bug pattern M-2 found and fixed
// for the user-profile avatar; this is the group/DM-room side of it.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const API = "http://localhost:4000/api/v1";
const shotDir = path.join(__dirname, "screenshots", "group-photo-shown");
fs.mkdirSync(shotDir, { recursive: true });
let shotN = 0;
async function shot(page, label) {
  shotN += 1;
  const file = path.join(shotDir, `${String(shotN).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file });
  console.log("SCREENSHOT:", file);
}

async function registerViaApi(name, username, email) {
  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Password123", displayName: name, username }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function api(token, path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...opts.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${opts.method ?? "GET"} ${path} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function loginAs(ctx, auth) {
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/login");
  await page.evaluate((authState) => {
    localStorage.setItem(
      "arutech-auth",
      JSON.stringify({
        state: { user: authState.user, accessToken: authState.accessToken, refreshToken: authState.refreshToken },
        version: 0,
      }),
    );
  }, auth);
  return page;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const suffix = Date.now().toString().slice(-6);
  const photoUrl = "https://placehold.co/128x128/2c7a7b/ffffff.png?text=GRP";
  let pass = true;

  console.log("STEP: set up two real users and a real GROUP chat room via the real API");
  const admin = await registerViaApi("Group Admin", `groupadmin${suffix}`, `groupadmin${suffix}@arutech.dev`);
  const member = await registerViaApi("Group Member", `groupmember${suffix}`, `groupmember${suffix}@arutech.dev`);
  const room = await api(admin.accessToken, "/chat-rooms", {
    method: "POST",
    body: JSON.stringify({ type: "GROUP", name: `M-8 QA Group ${suffix}`, memberUserIds: [member.user.id] }),
  });
  console.log("Room created:", room.id);

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await loginAs(ctx, admin);
  await page.goto("http://localhost:3000/chat", { waitUntil: "networkidle" });

  console.log("STEP: BEFORE setting a photo — sidebar + header both show initials, no <img>");
  await page.click(`text=${`M-8 QA Group ${suffix}`}`);
  await page.waitForTimeout(500);
  const imgsBefore = await page.locator("header img, aside img, main img").count();
  console.log("IMG_COUNT_BEFORE (expect 0 — initials only):", imgsBefore);
  await shot(page, "01-before-photo-initials-only");
  if (imgsBefore !== 0) pass = false;

  console.log("STEP: open Group settings ('Manage'), set a photo URL, save");
  await page.click('button:has-text("Manage")');
  await page.waitForSelector("text=Group settings", { timeout: 8000 });
  await page.fill('input[placeholder="https://…"]', photoUrl);
  await shot(page, "02-modal-shows-live-preview");
  const modalPreviewImg = await page.locator('[role="dialog"] img, .fixed img').count();
  console.log("MODAL_SHOWS_LIVE_PREVIEW (expect >=1 — before even saving):", modalPreviewImg);
  if (modalPreviewImg < 1) pass = false;
  await page.click('button:has-text("Save")');
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape").catch(() => {});
  await page.click('button:has-text("Close")').catch(() => {});

  console.log("STEP: AFTER saving — sidebar list and conversation header both now show the real image");
  await page.waitForTimeout(500);
  const imgsAfter = await page.locator(`img[src="${photoUrl}"]`).count();
  console.log("IMG_COUNT_WITH_MATCHING_SRC_AFTER (expect >=2 — sidebar row + header):", imgsAfter);
  await shot(page, "03-after-photo-shown-sidebar-and-header");
  if (imgsAfter < 2) pass = false;

  console.log("STEP: the OTHER member (not who set it) also sees the real photo — real broadcast, not just local state");
  const memberPage = await loginAs(await browser.newContext({ viewport: { width: 1280, height: 900 } }), member);
  await memberPage.goto("http://localhost:3000/chat", { waitUntil: "networkidle" });
  await memberPage.waitForTimeout(500);
  const memberSeesPhoto = await memberPage.locator(`img[src="${photoUrl}"]`).count();
  console.log("OTHER_MEMBER_SEES_PHOTO (expect >=1):", memberSeesPhoto);
  await shot(memberPage, "04-other-member-sees-photo-too");
  if (memberSeesPhoto < 1) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
