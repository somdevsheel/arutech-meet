// Verifies the actual bug: the Team Chat forward picker's label fallback was
// `room.name || (room.type === "DIRECT" ? "Direct message" : "Group chat")`.
// DIRECT rooms are never named (room.name is always null for a DM), so every
// single DM in the list rendered the literal, identical string
// "Direct message" — completely indistinguishable from each other the
// moment you had more than one DM to choose between, unlike the sidebar
// list and the meeting-chat forward picker, both of which already correctly
// resolve to the *other* member's real display name.
//
// This script gives A three real DMs with different people (B, C, D),
// forwards a message out of the B room, and confirms the picker's other two
// entries (B's own room is excluded, same as before) show their actual
// distinct names, not two identical "Direct message" rows.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "forward-picker-dm-names");
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

// Registers a user via the API directly (no browser needed) and returns the
// same { user, accessToken } shape login() would — avoids a second
// throttled /auth/login call per user (5/60s — this driver's earlier UI
// registrations already eat into that same per-IP budget).
async function apiRegister(displayName, username, email) {
  const res = await fetch("http://localhost:4000/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName, username, email, password: "Password123!" }),
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
  const a = await ctxA.newPage();
  const errors = [];
  a.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  a.on("pageerror", (err) => errors.push(String(err)));

  const suffix = Date.now().toString().slice(-6);

  console.log(
    "STEP: register A via the real UI (needs a real browser session), B/C/D via the API directly",
  );
  await register(a, "Fwd A", `fwda${suffix}`, `fwda${suffix}@arutech.dev`);
  const authA = await login(`fwda${suffix}@arutech.dev`);
  // B, C, D never need a browser at all in this script — only A does the
  // actual UI interaction — so registering them via the API directly avoids
  // three extra throttled /auth/login calls (5/60s per IP) on top of A's.
  const authB = await apiRegister("Fwd Bravo", `fwdb${suffix}`, `fwdb${suffix}@arutech.dev`);
  const authC = await apiRegister("Fwd Charlie", `fwdc${suffix}`, `fwdc${suffix}@arutech.dev`);
  const authD = await apiRegister("Fwd Delta", `fwdd${suffix}`, `fwdd${suffix}@arutech.dev`);

  console.log("STEP: A starts three separate DMs — one each with B, C, D");
  for (const other of [authB, authC, authD]) {
    await fetch("http://localhost:4000/api/v1/chat-rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authA.accessToken}` },
      body: JSON.stringify({ type: "DIRECT", memberUserIds: [other.user.id] }),
    });
  }

  console.log(
    "STEP: A opens /chat, sends a message into the B room (so there's something to forward)",
  );
  await a.goto("http://localhost:3000/chat", { waitUntil: "networkidle" });
  await a.waitForSelector("text=Team Chat", { timeout: 15000 });
  await a.waitForTimeout(1000);
  await shot(a, "00-a-room-list-before-click");
  await a.locator("text=Fwd Bravo").first().click({ timeout: 10000 });
  await a.waitForTimeout(500);
  await a.fill('input[placeholder="Type a message…"]', "Message to forward");
  await a.click('button:has-text("Send")');
  await a.waitForTimeout(1000);
  await shot(a, "01-a-sent-message-to-b");

  console.log("STEP: A hovers the message and clicks Forward");
  // "Message to forward" also appears in the sidebar's last-message preview
  // for the B room, so scope to the message pane specifically (the last
  // match, which is the actual message bubble, not the sidebar preview).
  const messageBlock = a.locator("text=Message to forward").last().locator("..");
  await messageBlock.hover();
  await a.waitForTimeout(300);
  // `has-text` is a case-insensitive SUBSTRING match, so the sidebar's own
  // "Message to forward" preview text also matches "Forward" — exact match
  // needed to hit the real Forward button and not the sidebar room button.
  const forwardBtns = a.getByRole("button", { name: "Forward", exact: true });
  const forwardBtnCount = await forwardBtns.count();
  console.log("FORWARD_BUTTON_COUNT_AFTER_HOVER (expect 1):", forwardBtnCount);
  await shot(a, "01b-a-after-hover");
  await forwardBtns.first().click();
  await a.waitForTimeout(500);
  await shot(a, "02-a-forward-picker-open");

  console.log(
    "STEP: does the forward picker show two DISTINCT, real names for the two remaining DMs (B's own room is excluded — can't forward a message to the room it's already in), not identical 'Direct message' rows?",
  );
  // Scope to the picker panel itself (two levels up from the "Forward to"
  // label) so these counts can't accidentally match the sidebar's own
  // same-named room buttons sitting right next to it in the DOM.
  const picker = a.locator("text=Forward to").locator("../..");
  const pickerText = await picker.innerText();
  console.log("PICKER_TEXT:\n" + pickerText);

  const seesBravo = await picker.locator('button:has-text("Fwd Bravo")').count();
  const seesCharlie = await picker.locator('button:has-text("Fwd Charlie")').count();
  const seesDelta = await picker.locator('button:has-text("Fwd Delta")').count();
  const seesGenericDirectMessage = await picker
    .locator('button:has-text("Direct message")')
    .count();

  console.log(
    "SEES_FWD_BRAVO_LABEL (expect 0 — B's own room is excluded, can't forward a message back into the room it's already in):",
    seesBravo,
  );
  console.log("SEES_FWD_CHARLIE_LABEL (expect >=1, real distinct name):", seesCharlie);
  console.log("SEES_FWD_DELTA_LABEL (expect >=1, real distinct name):", seesDelta);
  console.log(
    "SEES_GENERIC_DIRECT_MESSAGE_LABEL (expect 0 — this was the bug: both remaining DM rows said this identical string):",
    seesGenericDirectMessage,
  );

  console.log("CONSOLE_ERRORS_START");
  for (const e of errors) console.log(" ", e);
  console.log("CONSOLE_ERRORS_END", `(${errors.length} total)`);

  const pass =
    seesBravo === 0 && seesCharlie >= 1 && seesDelta >= 1 && seesGenericDirectMessage === 0;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
