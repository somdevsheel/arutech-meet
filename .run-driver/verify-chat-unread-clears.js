// Verifies H-12: Team Chat's unread indicators (the sidebar dot + the
// topbar "Team Chat" nav badge) didn't clear when you actually read a
// conversation — both stayed lit until a full page reload, even though the
// server-side read state was already correct.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "chat-unread-clears");
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

async function login(email) {
  const res = await fetch("http://localhost:4000/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Password123!" }),
  });
  return res.json();
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const ctxA = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const ctxB = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const ctxC = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const c = await ctxC.newPage();
  let pass = true;

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register A, B, and C");
  await register(a, "Unread A", `unreada${suffix}`, `unreada${suffix}@arutech.dev`);
  await register(b, "Unread B", `unreadb${suffix}`, `unreadb${suffix}@arutech.dev`);
  await register(c, "Unread C", `unreadc${suffix}`, `unreadc${suffix}@arutech.dev`);
  const authA = await login(`unreada${suffix}@arutech.dev`);
  const authB = await login(`unreadb${suffix}@arutech.dev`);
  const authC = await login(`unreadc${suffix}@arutech.dev`);

  console.log("STEP: B DMs C first (a room to be pinned to via ?room=, sidestepping the newest-room-first auto-select entirely)");
  const roomBC = await fetch("http://localhost:4000/api/v1/chat-rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${authB.accessToken}` },
    body: JSON.stringify({ type: "DIRECT", memberUserIds: [authC.user.id] }),
  }).then((r) => r.json());

  console.log("STEP: B stays on the dashboard (not viewing chat at all)");
  await b.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });

  console.log("STEP: A DMs B while B is on the dashboard");
  const roomAB = await fetch("http://localhost:4000/api/v1/chat-rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${authA.accessToken}` },
    body: JSON.stringify({ type: "DIRECT", memberUserIds: [authB.user.id] }),
  }).then((r) => r.json());
  await a.goto("http://localhost:3000/chat", { waitUntil: "networkidle" });
  await a.waitForSelector("text=Team Chat", { timeout: 15000 });
  await a.click(`text=Unread B`);
  await a.waitForTimeout(500);
  const msgInput = a.locator('input[placeholder*="essage" i], textarea[placeholder*="essage" i]').first();
  await msgInput.fill("hey B, you have an unread message");
  await msgInput.press("Enter");

  console.log("STEP: B (still on dashboard) sees the nav badge light up live");
  await b.waitForTimeout(1200);
  await shot(b, "01-b-dashboard-badge-lit");
  const badgeLitBefore = await b.locator('a[href="/chat"] >> text=/[1-9]/').count();
  console.log("NAV_BADGE_LIT_BEFORE_READING (expect >=1):", badgeLitBefore);

  console.log("STEP: B opens Team Chat pinned directly to B<->C via ?room=, so the newest-room-first auto-select can never land on A<->B first");
  await b.goto(`http://localhost:3000/chat?room=${roomBC.id}`, { waitUntil: "networkidle" });
  await b.waitForSelector("text=Team Chat", { timeout: 15000 });
  await b.waitForTimeout(400);
  await shot(b, "02-b-chat-list-before-opening-room");
  const sidebarDotBefore = await b.locator('li:has-text("Unread A") .h-2.w-2.bg-brand-500').count();
  console.log("SIDEBAR_DOT_LIT_BEFORE_OPENING (expect >=1):", sidebarDotBefore);
  if (sidebarDotBefore < 1) pass = false;

  await b.click("text=Unread A");
  await b.waitForSelector("text=hey B, you have an unread message", { timeout: 8000 });
  await b.waitForTimeout(800);
  await shot(b, "03-b-read-the-message");

  console.log("STEP: WITHOUT reloading — does the sidebar dot clear live?");
  const sidebarDotAfter = await b.locator('li:has-text("Unread A") .h-2.w-2.bg-brand-500').count();
  console.log("SIDEBAR_DOT_CLEARED_LIVE_NO_RELOAD (expect 0 — this is H-12):", sidebarDotAfter);
  if (sidebarDotAfter !== 0) pass = false;

  console.log("STEP: WITHOUT reloading — does the nav badge clear live?");
  await b.waitForTimeout(500);
  await shot(b, "04-b-nav-badge-after-reading");
  const badgeLitAfter = await b.locator('a[href="/chat"] >> text=/[1-9]/').count();
  console.log("NAV_BADGE_CLEARED_LIVE_NO_RELOAD (expect 0 — this is H-12):", badgeLitAfter);
  if (badgeLitAfter !== 0) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
