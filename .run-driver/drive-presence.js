// Verifies real-time Presence (online/away/busy/DND) end-to-end: a Redis-
// backed status derived from actually-open sockets (not the recency
// timestamp v1), pushed live into any open Team Chat room a user belongs to,
// and separately available via polling for Contacts (which has no
// persisted per-user channel to push into — see docs/roadmap.md). Explicit
// status changes, a full online->offline transition on real disconnect, and
// the poll-based Contacts path are all covered with real people, not mocks.
const { chromium } = require("playwright-core");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const BASE = "http://localhost:3000";
const shotDir = path.join(__dirname, "screenshots", "presence");
fs.mkdirSync(shotDir, { recursive: true });
let shotN = 0;
async function shot(page, label) {
  shotN += 1;
  const file = path.join(shotDir, `${String(shotN).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log("SCREENSHOT:", file);
}

async function register(page, name, username, email) {
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  const inputs = page.locator("input");
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill(username);
  await inputs.nth(2).fill(email);
  await inputs.nth(3).fill("Password123!");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 15000 });
}

async function authOf(page) {
  return page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("arutech-auth"));
    return { userId: s.state.user.id, token: s.state.accessToken };
  });
}

/** Opens the account menu and picks a presence status — exercises the real
 * PRESENCE_SET_STATUS UI path (AppShell), not a raw socket emit. */
async function setStatusViaUi(page, label) {
  await page.locator('span[aria-label^="Your status:"]').click();
  await page.locator(`[aria-label="Set your status"] button:has-text("${label}")`).click();
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const ctxA = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const ctxB = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const ctxC = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const pageC = await ctxC.newPage();
  const errors = { A: [], B: [], C: [] };
  for (const [label, page] of [["A", pageA], ["B", pageB], ["C", pageC]]) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors[label].push(msg.text());
    });
    page.on("pageerror", (err) => errors[label].push(String(err)));
  }

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register A, B, C");
  await register(pageA, "Presence A", `presA${suffix}`, `presA${suffix}@arutech.dev`);
  await register(pageB, "Presence B", `presB${suffix}`, `presB${suffix}@arutech.dev`);
  await register(pageC, "Presence C", `presC${suffix}`, `presC${suffix}@arutech.dev`);
  const a = await authOf(pageA);
  const b = await authOf(pageB);

  console.log("=== Team Chat: real-time push ===");
  // DIRECT, not GROUP — presence is displayed for the room's "other member"
  // (sidebar dot + header status text), the same scope `isOnline`/
  // `formatLastSeen` already had before this stage; a GROUP room's header
  // only ever showed a member *count*, never per-member status, and that
  // remains a deliberate v1 scope trim (see docs/roadmap.md).
  const roomId = await pageA.evaluate(
    async ({ token, otherUserId }) => {
      const res = await fetch("http://localhost:4000/api/v1/chat-rooms", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "DIRECT", memberUserIds: [otherUserId] }),
      });
      return (await res.json()).id;
    },
    { token: a.token, otherUserId: b.userId },
  );
  console.log("roomId:", roomId);

  await pageA.goto(`${BASE}/chat?room=${roomId}`, { waitUntil: "networkidle" });
  await shot(pageA, "a-room-open-before-b-connects");

  console.log("STEP: B is already connected from registering above — A should already see B ONLINE (green dot) live, no reload");
  await pageA.waitForSelector('p:has-text("Online")', { timeout: 10000 });
  console.log("A_SEES_B_ONLINE_LIVE: true");
  await shot(pageA, "a-sees-b-online-live");

  console.log("STEP: B sets status to Busy via the real account-menu UI — A should see it live");
  await setStatusViaUi(pageB, "Busy");
  await pageA.waitForSelector('p:has-text("Busy")', { timeout: 10000 });
  console.log("A_SEES_B_BUSY_LIVE: true");
  await shot(pageA, "a-sees-b-busy-live");

  console.log("STEP: B sets status to Do Not Disturb — A should see that live too");
  await setStatusViaUi(pageB, "Do Not Disturb");
  await pageA.waitForSelector('p:has-text("Do Not Disturb")', { timeout: 10000 });
  console.log("A_SEES_B_DND_LIVE: true");

  console.log("STEP: B fully disconnects (browser context closed) — A should see B go offline live, falling back to 'Last seen'");
  // Closing a browser context severs the WebSocket abruptly (no clean close
  // frame), so the server only notices via Socket.IO's own ping/pong
  // timeout (default pingInterval 25s + pingTimeout 20s) — a real ~45s
  // worst case, not a bug in the presence code itself. Timeout sized
  // accordingly rather than tuned to make a flaky test pass.
  await ctxB.close();
  await pageA.waitForSelector('p:has-text("Last seen")', { timeout: 60000 });
  console.log("A_SEES_B_OFFLINE_LIVE: true");
  await shot(pageA, "a-sees-b-offline-live");

  console.log("=== Contacts: polling path ===");
  console.log("STEP: A and C join a real instant meeting together (real UI click-through PreJoin, fake media devices)");
  const meetingCode = await pageA.evaluate(
    async ({ token }) => {
      const res = await fetch("http://localhost:4000/api/v1/meetings", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Presence contacts meeting",
          type: "INSTANT",
          // Off, so C (not the host) is admitted immediately rather than
          // landing in the waiting room — this test only needs a real
          // co-participation record for ContactsService, not to exercise
          // the waiting room itself (already covered elsewhere).
          settings: { waitingRoomEnabled: false },
        }),
      });
      return (await res.json()).code;
    },
    { token: a.token },
  );
  console.log("meetingCode:", meetingCode);

  for (const [label, page] of [["A", pageA], ["C", pageC]]) {
    await page.goto(`${BASE}/meeting/${meetingCode}`, { waitUntil: "networkidle" });
    await page.waitForSelector("button.lk-join-button", { timeout: 15000 });
    await page.click("button.lk-join-button");
    await page.waitForSelector('button:has-text("Leave")', { timeout: 20000 });
    console.log(`${label}_JOINED_MEETING: true`);
  }

  console.log("STEP: simulating the LiveKit participant_joined webhook (not configured in this sandboxed LiveKit --dev instance — a documented, accepted environment gap, same as Stage 26/31) by marking both real ADMITTED participant rows JOINED directly");
  execSync(
    `docker exec arutech-migrate-scratch psql -U arutech -d arutech_meet -c "UPDATE meeting_participants SET status='JOINED', joined_at=now() WHERE meeting_id=(SELECT id FROM meetings WHERE code='${meetingCode}') AND status='ADMITTED';"`,
    { stdio: "inherit" },
  );

  await pageA.goto(`${BASE}/contacts`, { waitUntil: "networkidle" });
  await pageA.waitForSelector("text=Presence C", { timeout: 10000 });
  await shot(pageA, "a-contacts-list-with-c");

  console.log("STEP: A's Contacts page polls GET /presence — C should show as Online shortly after load, no page reload needed for the initial fetch");
  await pageA.locator("li", { hasText: "Presence C" }).locator("text=Online").waitFor({ timeout: 15000 });
  console.log("A_SEES_C_ONLINE_ON_CONTACTS: true");
  await shot(pageA, "a-sees-c-online-on-contacts");

  console.log("STEP: C sets status to Away via the real UI; A's Contacts page should pick it up on its next poll (~20s), still without a reload");
  // The meeting room page has its own full-screen UI, no AppShell/account
  // menu — navigate back to a normal page first (the socket/presence itself
  // stays connected across this navigation, same tab, same page session).
  await pageC.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await setStatusViaUi(pageC, "Away");
  await pageA.locator("li", { hasText: "Presence C" }).locator("text=Away").waitFor({ timeout: 30000 });
  console.log("A_SEES_C_AWAY_VIA_POLL: true");
  await shot(pageA, "a-sees-c-away-via-poll");

  console.log("CONSOLE_ERRORS_A_START");
  for (const e of errors.A) console.log("  A:", e);
  console.log("CONSOLE_ERRORS_A_END", `(${errors.A.length} total)`);
  console.log("CONSOLE_ERRORS_B_START");
  for (const e of errors.B) console.log("  B:", e);
  console.log("CONSOLE_ERRORS_B_END", `(${errors.B.length} total)`);
  console.log("CONSOLE_ERRORS_C_START");
  for (const e of errors.C) console.log("  C:", e);
  console.log("CONSOLE_ERRORS_C_END", `(${errors.C.length} total)`);

  await browser.close();
  console.log("DONE");
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
