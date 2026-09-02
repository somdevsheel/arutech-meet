// Verifies CS-3: forwarding a chat message gave no success confirmation —
// the forward picker just closed silently. The message DID land correctly
// in the destination room; there was just nothing telling the user it
// worked. Real fix: a brief "Forwarded" confirmation on the message itself.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const API = "http://localhost:4000/api/v1";
const shotDir = path.join(__dirname, "screenshots", "forward-confirmation");
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

  console.log("STEP: set up a real user with two real rooms to forward between");
  const me = await registerViaApi("Forward QA", `forwardqa${suffix}`, `forwardqa${suffix}@arutech.dev`);
  const other = await registerViaApi("Forward Other", `forwardother${suffix}`, `forwardother${suffix}@arutech.dev`);
  const source = await api(me.accessToken, "/chat-rooms", {
    method: "POST",
    body: JSON.stringify({ type: "GROUP", name: `CS-3 Source ${suffix}`, memberUserIds: [other.user.id] }),
  });
  const destination = await api(me.accessToken, "/chat-rooms", {
    method: "POST",
    body: JSON.stringify({ type: "GROUP", name: `CS-3 Destination ${suffix}`, memberUserIds: [other.user.id] }),
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await loginAs(ctx, me);
  await page.goto(`http://localhost:3000/chat?room=${source.id}`, { waitUntil: "networkidle" });

  console.log("STEP: send a real message in the source room, then forward it");
  await page.fill('input[placeholder="Type a message…"]', "Please forward me");
  await page.click('button:has-text("Send")');
  await page.waitForSelector("text=Please forward me", { timeout: 8000 });
  await page.hover("text=Please forward me");
  // Scoped to `.group` (the one message row) specifically — a plain
  // `button:has-text("Forward")` also matches the SIDEBAR's room-list
  // button, whose text is the room title + latest-message preview
  // ("...Please forward me"), which itself contains the substring
  // "forward" and is not inside `.group` at all.
  await page.locator('.group button:has-text("Forward")').first().click({ force: true });
  await page.waitForSelector("text=Forward to", { timeout: 8000 });
  await shot(page, "01-forward-picker-open");

  console.log("STEP: pick the destination room — a real, visible confirmation must appear on the message");
  // Scoped to the picker's own fixed wrapper class (ForwardPicker renders
  // `absolute bottom-full ...`) — the sidebar ALSO has a
  // "CS-3 Destination ..." room-list button with the same text, and the
  // picker briefly overlaps the message bubble visually.
  await page.waitForSelector(".absolute.bottom-full button", { timeout: 8000 });
  await page
    .locator(".absolute.bottom-full")
    .locator(`button:has-text("CS-3 Destination ${suffix}")`)
    .click({ force: true });
  // Exact match, not substring — a plain `text=Forwarded` also matches the
  // action row's concatenated "ForwardEditDelete" textContent (the three
  // button labels back to back with no separator, which happens to contain
  // "forwarded" as a case-insensitive substring: "forward"+"Ed"). The real
  // confirmation is its own element whose ENTIRE text is exactly "Forwarded".
  const confirmation = page.getByText("Forwarded", { exact: true });
  await confirmation.waitFor({ timeout: 5000 });
  await shot(page, "02-forwarded-confirmation-shown");
  const confirmationShown = await confirmation.count();
  console.log("CONFIRMATION_SHOWN_RIGHT_AFTER_FORWARDING (expect >=1 — this is the actual CS-3 fix):", confirmationShown);
  if (confirmationShown < 1) pass = false;

  console.log("STEP: the confirmation must actually disappear again after its window (not linger forever)");
  await page.waitForTimeout(2500);
  const confirmationGone = await confirmation.count();
  await shot(page, "03-confirmation-gone-after-window");
  console.log("CONFIRMATION_GONE_AFTER_WINDOW (expect 0):", confirmationGone);
  if (confirmationGone !== 0) pass = false;

  console.log("STEP: confirm the message genuinely DID land in the destination room (real functional check, not just UI)");
  await page.goto(`http://localhost:3000/chat?room=${destination.id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const landedInDestination = await page.locator("text=Please forward me").count();
  console.log("MESSAGE_ACTUALLY_LANDED_IN_DESTINATION (expect >=1):", landedInDestination);
  await shot(page, "04-message-really-in-destination-room");
  if (landedInDestination < 1) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
