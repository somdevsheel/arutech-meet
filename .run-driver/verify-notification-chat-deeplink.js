// Verifies the actual bug: TeamChatPage read `?room=` from the URL only
// once, as its `selectedId` useState initializer. Clicking a CHAT_MESSAGE
// notification while already sitting on /chat calls
// router.push(`/chat?room=${id}`) — a same-route client-side navigation
// that re-renders the already-mounted page instead of remounting it, so
// that initializer never re-ran and the click silently no-op'd: whatever
// room was already open just stayed open, with no visible error or
// feedback that anything happened at all.
//
// This script drives the real thing: B is actively viewing one room
// (B<->C), A sends B a DM in a *different* room (A<->B) while B is looking
// elsewhere, B gets a real live notification, and clicking it must actually
// switch B's open room to A<->B and show A's message — not silently stay on
// B<->C.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "notification-chat-deeplink");
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
  const errorsB = [];
  b.on("console", (msg) => {
    if (msg.type() === "error") errorsB.push(msg.text());
  });
  b.on("pageerror", (err) => errorsB.push(String(err)));

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register A, B, C");
  await register(a, "Deeplink A", `dla${suffix}`, `dla${suffix}@arutech.dev`);
  await register(b, "Deeplink B", `dlb${suffix}`, `dlb${suffix}@arutech.dev`);
  await register(c, "Deeplink C", `dlc${suffix}`, `dlc${suffix}@arutech.dev`);

  const authA = await login(`dla${suffix}@arutech.dev`);
  const authB = await login(`dlb${suffix}@arutech.dev`);
  const authC = await login(`dlc${suffix}@arutech.dev`);

  console.log("STEP: B starts a DM with C first (this is the room B will be actively viewing)");
  const roomBC = await fetch("http://localhost:4000/api/v1/chat-rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${authB.accessToken}` },
    body: JSON.stringify({ type: "DIRECT", memberUserIds: [authC.user.id] }),
  }).then((r) => r.json());
  console.log("STEP: B opens /chat and lands on the B<->C room");
  await b.goto("http://localhost:3000/chat", { waitUntil: "networkidle" });
  await b.waitForSelector("text=Team Chat", { timeout: 15000 });
  await b.waitForTimeout(1000);
  await shot(b, "01-b-on-bc-room");
  const bcTitleVisible = await b.locator("text=Deeplink C").count();
  console.log("B_VIEWING_C_ROOM_INITIALLY (expect >=1):", bcTitleVisible);

  console.log("STEP: A DMs B while B is still looking at the B<->C room");
  const roomAB = await fetch("http://localhost:4000/api/v1/chat-rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${authA.accessToken}` },
    body: JSON.stringify({ type: "DIRECT", memberUserIds: [authB.user.id] }),
  }).then((r) => r.json());

  await a.goto("http://localhost:3000/chat", { waitUntil: "networkidle" });
  await a.waitForSelector("text=Team Chat", { timeout: 15000 });
  await a.locator("text=Deeplink B").first().click();
  await a.waitForTimeout(500);
  const distinctiveMessage = `Hey B, real message from A — ${suffix}`;
  await a.fill('input[placeholder="Type a message…"]', distinctiveMessage);
  await a.click('button:has-text("Send")');
  await a.waitForTimeout(1500);

  console.log("STEP: does B get a live bell notification for it?");
  await b.waitForTimeout(500);
  await shot(b, "02-b-bell-should-show-unread");

  await b.locator('button[aria-label="Notifications"]').click();
  await b.waitForTimeout(500);
  await shot(b, "03-b-notification-dropdown-open");

  console.log("STEP: B clicks the notification for A's message");
  const notifButton = b.locator("text=Deeplink A").first();
  const notifPresent = await notifButton.count();
  console.log("B_SEES_NOTIFICATION_FROM_A (expect >=1):", notifPresent);
  if (notifPresent) await notifButton.click();
  await b.waitForTimeout(1500);
  await shot(b, "04-b-after-clicking-notification");

  console.log("STEP: did B's open room actually switch to A<->B? (the real bug under test)");
  const nowShowsAMessage = await b.locator(`text=${distinctiveMessage}`).count();
  const urlHasRoomParam = b.url().includes(`room=${roomAB.id}`);
  console.log("B_URL_UPDATED_TO_ROOM_A (expect true):", urlHasRoomParam, b.url());
  console.log(
    "B_SEES_A_MESSAGE_IN_OPEN_PANE (expect >=1 — was 0/stuck-on-old-room before the fix):",
    nowShowsAMessage,
  );

  console.log("CONSOLE_ERRORS_START");
  for (const e of errorsB) console.log("  b:", e);
  console.log("CONSOLE_ERRORS_END", `(${errorsB.length} total)`);

  const pass = bcTitleVisible >= 1 && notifPresent >= 1 && urlHasRoomParam && nowShowsAMessage >= 1;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
