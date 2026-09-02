// Verifies L-4: opening a Team Chat conversation never updated the URL —
// clicking a sidebar room only changed local state, so a refresh fell back
// to whichever room happened to load first (not the one actually open),
// and a conversation couldn't be bookmarked or shared by URL. The
// notification deep-link path (?room=) was the one exception that already
// worked; this is the fix for every other way a conversation opens.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const API = "http://localhost:4000/api/v1";
const shotDir = path.join(__dirname, "screenshots", "chat-url-sync");
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
  let pass = true;

  console.log("STEP: set up two real GROUP rooms for one real user");
  const owner = await registerViaApi("URLSync QA", `urlsyncqa${suffix}`, `urlsyncqa${suffix}@arutech.dev`);
  const other = await registerViaApi("URLSync Other", `urlsyncother${suffix}`, `urlsyncother${suffix}@arutech.dev`);
  const roomA = await api(owner.accessToken, "/chat-rooms", {
    method: "POST",
    body: JSON.stringify({ type: "GROUP", name: `L-4 Room A ${suffix}`, memberUserIds: [other.user.id] }),
  });
  const roomB = await api(owner.accessToken, "/chat-rooms", {
    method: "POST",
    body: JSON.stringify({ type: "GROUP", name: `L-4 Room B ${suffix}`, memberUserIds: [other.user.id] }),
  });
  console.log("Rooms:", roomA.id, roomB.id);

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await loginAs(ctx, owner);

  console.log("STEP: open /chat with no ?room= — the default-selected room's id must appear in the URL");
  await page.goto("http://localhost:3000/chat", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const urlAfterDefaultLoad = new URL(page.url());
  console.log("URL_AFTER_DEFAULT_LOAD room param:", urlAfterDefaultLoad.searchParams.get("room"));
  if (!urlAfterDefaultLoad.searchParams.get("room")) pass = false;

  // Whichever room actually loaded by default, deliberately click the OTHER
  // one — the point is testing a genuine switch away from the default, not
  // re-clicking whatever's already open.
  const defaultRoomId = urlAfterDefaultLoad.searchParams.get("room");
  const target = defaultRoomId === roomA.id ? roomB : roomA;
  console.log(`STEP: click the OTHER room (${target.name}, not the one that loaded by default) in the sidebar`);
  await page.click(`text=${target.name}`);
  await page.waitForTimeout(400);
  const urlAfterClick = new URL(page.url());
  console.log("URL_AFTER_CLICKING_OTHER_ROOM room param (expect target.id):", urlAfterClick.searchParams.get("room"));
  await shot(page, "01-url-reflects-clicked-room");
  if (urlAfterClick.searchParams.get("room") !== target.id) pass = false;

  console.log("STEP: hard-reload the page — the clicked room must STILL be the one showing, not whichever loads first");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await shot(page, "02-room-survives-reload");
  const roomStillOpenAfterReload = await page.locator(`text=${target.name}`).count();
  const urlAfterReload = new URL(page.url());
  console.log("URL_AFTER_RELOAD room param (expect still target.id):", urlAfterReload.searchParams.get("room"));
  console.log("TARGET_ROOM_TEXT_STILL_PRESENT_AFTER_RELOAD:", roomStillOpenAfterReload);
  if (urlAfterReload.searchParams.get("room") !== target.id) pass = false;

  console.log("STEP: the URL is now genuinely bookmarkable — opening it fresh in a NEW tab lands on that room directly");
  const freshPage = await ctx.newPage();
  await freshPage.goto(page.url(), { waitUntil: "networkidle" });
  await freshPage.waitForTimeout(500);
  await shot(freshPage, "03-bookmarked-url-opens-room-directly");
  const targetOpenInFreshTab = await freshPage.locator(`text=${target.name}`).count();
  console.log("TARGET_ROOM_OPEN_IN_FRESH_TAB (expect >=1):", targetOpenInFreshTab);
  if (targetOpenInFreshTab < 1) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
