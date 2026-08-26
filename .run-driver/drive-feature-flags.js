// Verifies feature flags end-to-end: the real admin UI toggles a flag, the
// change is real server-side (not a UI-only illusion — confirmed via direct
// API calls to the actual gated actions returning 403/200 accordingly), and
// the meeting UI hides a disabled feature's tab/button for real participants.
const { chromium } = require("playwright-core");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const BASE = "http://localhost:3000";
const shotDir = path.join(__dirname, "screenshots", "feature-flags");
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

function promoteToAdmin(email) {
  execSync(
    `PGPASSWORD=scratch psql -h localhost -p 55433 -U arutech -d arutech_meet -c "UPDATE users SET system_role = 'ADMIN' WHERE email = '${email}';"`,
    { stdio: "inherit" },
  );
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const ctxAdmin = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const pageAdmin = await ctxAdmin.newPage();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const errors = { admin: [], A: [] };
  for (const [label, page] of [["admin", pageAdmin], ["A", pageA]]) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors[label].push(msg.text());
    });
    page.on("pageerror", (err) => errors[label].push(String(err)));
  }

  const suffix = Date.now().toString().slice(-6);
  console.log("STEP: register an admin candidate and promote via direct DB patch (this environment has no seeded admin)");
  const adminEmail = `ffadmin${suffix}@arutech.dev`;
  await register(pageAdmin, "FF Admin", `ffadmin${suffix}`, adminEmail);
  promoteToAdmin(adminEmail);
  // The just-registered session's cached user (Zustand-persisted, used for
  // AdminLayout's client-side redirect) still has the pre-promotion role —
  // log out and back in for a fresh /auth/login response with systemRole
  // now ADMIN, rather than relying on the stale registered session.
  await pageAdmin.evaluate(() => localStorage.clear());
  await pageAdmin.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await pageAdmin.locator('input[type="email"], input[name="email"]').first().fill(adminEmail);
  await pageAdmin.locator('input[type="password"]').first().fill("Password123!");
  await pageAdmin.click('button[type="submit"]');
  await pageAdmin.waitForURL("**/dashboard", { timeout: 15000 });
  await pageAdmin.goto(`${BASE}/admin/feature-flags`, { waitUntil: "networkidle" });
  await pageAdmin.waitForSelector("text=Feature Flags", { timeout: 15000 });
  await shot(pageAdmin, "admin-flags-page-initial");

  console.log("STEP: register host A + participant B, get them into a real meeting (WHITEBOARD/BREAKOUT_ROOMS/LIVE_CAPTIONS all default-enabled)");
  await register(pageA, "FF Host A", `ffA${suffix}`, `ffA${suffix}@arutech.dev`);
  await register(pageB, "FF Guest B", `ffB${suffix}`, `ffB${suffix}@arutech.dev`);

  await pageA.click("text=New meeting");
  await pageA.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingCode = new URL(pageA.url()).pathname.split("/").pop();
  await pageA.click('button:has-text("Join meeting")');
  await pageA.waitForSelector("footer", { timeout: 15000 });

  const aToken = await pageA.evaluate(() => JSON.parse(localStorage.getItem("arutech-auth")).state.accessToken);
  const meetingId = await pageA.evaluate(
    async ({ token, code }) => {
      const res = await fetch("http://localhost:4000/api/v1/meetings", { headers: { Authorization: `Bearer ${token}` } });
      const meetings = await res.json();
      return meetings.find((m) => m.code === code)?.id ?? null;
    },
    { token: aToken, code: meetingCode },
  );
  console.log("meetingId:", meetingId);

  console.log("=== BEFORE disabling: Whiteboard tab visible, real API call succeeds ===");
  await pageA.click('button:has-text("Chat")'); // ensure panel bar is interactive
  await pageA.click('button:has-text("Tools")');
  await pageA.waitForTimeout(400);
  const whiteboardTabBefore = await pageA.locator('button:has-text("whiteboard")').count();
  console.log("WHITEBOARD_TAB_VISIBLE_BEFORE (should be 1):", whiteboardTabBefore);
  if (whiteboardTabBefore !== 1) throw new Error("Whiteboard tab should be visible before disabling the flag");

  const apiCallBefore = await pageA.evaluate(
    async ({ token, id }) => {
      const res = await fetch(`http://localhost:4000/api/v1/meetings/${id}/whiteboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.status;
    },
    { token: aToken, id: meetingId },
  );
  console.log("WHITEBOARD_API_STATUS_BEFORE (should be 200):", apiCallBefore);
  if (apiCallBefore !== 200) throw new Error(`Expected 200 before disabling, got ${apiCallBefore}`);

  console.log("=== Admin disables WHITEBOARD globally via the real admin UI ===");
  const whiteboardRow = pageAdmin.locator("div.rounded-xl", { has: pageAdmin.locator("text=WHITEBOARD") }).first();
  await whiteboardRow.locator('button:has-text("Enabled globally")').click();
  await pageAdmin.waitForSelector('div.rounded-xl:has-text("WHITEBOARD") >> text=Disabled globally', { timeout: 10000 });
  await shot(pageAdmin, "admin-disabled-whiteboard");

  console.log("=== AFTER disabling: real API call now 403s (server-side enforcement, not just UI) ===");
  const apiCallAfter = await pageA.evaluate(
    async ({ token, id }) => {
      const res = await fetch(`http://localhost:4000/api/v1/meetings/${id}/whiteboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.status;
    },
    { token: aToken, id: meetingId },
  );
  console.log("WHITEBOARD_API_STATUS_AFTER (should be 403):", apiCallAfter);
  if (apiCallAfter !== 403) throw new Error(`Expected 403 after disabling, got ${apiCallAfter}`);

  console.log("STEP: B joins fresh (after the flag was disabled) — should never see the Whiteboard tab at all");
  await pageB.goto(`${BASE}/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await pageB.click('button:has-text("Join meeting")', { timeout: 15000 });
  await pageB.waitForTimeout(1200);
  const admitBtn = pageA.locator('button:has-text("Admit")');
  try {
    await admitBtn.first().waitFor({ timeout: 8000 });
    await admitBtn.first().click();
  } catch {
    console.log("No Admit button — may not have needed admission");
  }
  await pageB.waitForSelector("footer", { timeout: 15000 });
  await pageB.click('button:has-text("Tools")');
  await pageB.waitForTimeout(600);
  await shot(pageB, "b-tools-panel-no-whiteboard-tab");
  const whiteboardTabForB = await pageB.locator('button:has-text("whiteboard")').count();
  console.log("WHITEBOARD_TAB_VISIBLE_FOR_B (should be 0):", whiteboardTabForB);
  if (whiteboardTabForB !== 0) throw new Error("B should never see the Whiteboard tab once the flag is disabled");
  const breakoutTabStillThere = await pageB.locator('button:has-text("breakout")').count();
  console.log("OTHER_TABS_UNAFFECTED (breakout tab, should be 1):", breakoutTabStillThere);
  if (breakoutTabStillThere !== 1) throw new Error("Disabling WHITEBOARD shouldn't hide unrelated tabs");

  console.log("=== Re-enable — real API call works again ===");
  await whiteboardRow.locator('button:has-text("Disabled globally")').click();
  await pageAdmin.waitForSelector('div.rounded-xl:has-text("WHITEBOARD") >> text=Enabled globally', { timeout: 10000 });
  const apiCallReenabled = await pageA.evaluate(
    async ({ token, id }) => {
      const res = await fetch(`http://localhost:4000/api/v1/meetings/${id}/whiteboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.status;
    },
    { token: aToken, id: meetingId },
  );
  console.log("WHITEBOARD_API_STATUS_REENABLED (should be 200):", apiCallReenabled);
  if (apiCallReenabled !== 200) throw new Error(`Expected 200 after re-enabling, got ${apiCallReenabled}`);

  console.log("=== A key never configured at all is enabled by default (no fake off-by-default) ===");
  const uncomputedKeyStatus = await pageA.evaluate(
    async ({ token, id }) => {
      const res = await fetch(`http://localhost:4000/api/v1/meetings/${id}/breakout-rooms`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ names: ["Room 1"], autoAssign: false }),
      });
      return res.status;
    },
    { token: aToken, id: meetingId },
  );
  console.log("BREAKOUT_ROOMS_API_STATUS_NEVER_CONFIGURED (should be 200 or 201):", uncomputedKeyStatus);
  if (uncomputedKeyStatus >= 400) throw new Error(`Expected an unconfigured BREAKOUT_ROOMS flag to default to enabled, got ${uncomputedKeyStatus}`);

  console.log("CONSOLE_ERRORS_ADMIN_START");
  for (const e of errors.admin) console.log("  admin:", e);
  console.log("CONSOLE_ERRORS_ADMIN_END", `(${errors.admin.length} total)`);
  console.log("CONSOLE_ERRORS_A_START");
  for (const e of errors.A) console.log("  A:", e);
  console.log("CONSOLE_ERRORS_A_END", `(${errors.A.length} total)`);

  await browser.close();
  console.log("DONE");
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
