// Verifies Moderation end-to-end: report-participant (a real admin review
// queue, distinct from the audit log), block-participant (reuses Priority
// 3's BlockedUser — an immediate removal AND a real block that gates the
// blocker's future meetings, not just this one), and domain restrictions
// (an allow-list on MeetingSettings, checked at join time).
const { chromium } = require("playwright-core");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const BASE = "http://localhost:3000";
const shotDir = path.join(__dirname, "screenshots", "moderation");
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

async function joinMeeting(page, code) {
  await page.goto(`${BASE}/meeting/${code}`, { waitUntil: "networkidle" });
  await page.waitForSelector("button.lk-join-button", { timeout: 15000 });
  await page.click("button.lk-join-button");
  await page.waitForSelector('button:has-text("Leave")', { timeout: 20000 });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const ctxA = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const ctxB = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const ctxC = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const ctxD = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const ctxE = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const ctxAdmin = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const [pageA, pageB, pageC, pageD, pageE, pageAdmin] = await Promise.all(
    [ctxA, ctxB, ctxC, ctxD, ctxE, ctxAdmin].map((c) => c.newPage()),
  );
  const errors = { A: [], B: [], C: [], D: [], E: [] };
  for (const [label, page] of [["A", pageA], ["B", pageB], ["C", pageC], ["D", pageD], ["E", pageE]]) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors[label].push(msg.text());
    });
    page.on("pageerror", (err) => errors[label].push(String(err)));
  }

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register A (host), B (reporter), C (block target), D (matching-domain), E (non-matching-domain), and an admin");
  await register(pageA, "Mod A", `modA${suffix}`, `modA${suffix}@arutech.dev`);
  await register(pageB, "Mod B", `modB${suffix}`, `modB${suffix}@arutech.dev`);
  await register(pageC, "Mod C", `modC${suffix}`, `modC${suffix}@arutech.dev`);
  await register(pageD, "Mod D", `modD${suffix}`, `modD${suffix}@restrict.dev`);
  await register(pageE, "Mod E", `modE${suffix}`, `modE${suffix}@arutech.dev`);
  await register(pageAdmin, "Mod Admin", `modAdmin${suffix}`, `modAdmin${suffix}@arutech.dev`);
  const a = await authOf(pageA);
  const c = await authOf(pageC);
  const admin = await authOf(pageAdmin);

  execSync(`docker exec arutech-migrate-scratch psql -U arutech -d arutech_meet -c "UPDATE users SET system_role='ADMIN' WHERE id='${admin.userId}';"`, { stdio: "inherit" });
  // Client-side role staleness (documented all session): a promoted admin's
  // JWT/store still says USER until a fresh login.
  await pageAdmin.evaluate(() => localStorage.clear());
  await pageAdmin.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await pageAdmin.fill('input[type="email"]', `modAdmin${suffix}@arutech.dev`);
  await pageAdmin.fill('input[type="password"]', "Password123!");
  await pageAdmin.click('button[type="submit"]');
  await pageAdmin.waitForURL("**/dashboard", { timeout: 15000 });

  console.log("=== Report + Block: a real meeting, real people, waiting room off so this test isn't about admission ===");
  const meeting1Code = await pageA.evaluate(
    async ({ token }) => {
      const res = await fetch("http://localhost:4000/api/v1/meetings", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Moderation test 1", type: "INSTANT", settings: { waitingRoomEnabled: false } }),
      });
      return (await res.json()).code;
    },
    { token: a.token },
  );
  console.log("meeting1Code:", meeting1Code);

  await joinMeeting(pageA, meeting1Code);
  await joinMeeting(pageB, meeting1Code);
  await joinMeeting(pageC, meeting1Code);
  await pageA.waitForTimeout(1500); // let PARTICIPANT_JOINED broadcasts settle on A's roster

  console.log("STEP: B opens the real Participants panel and reports A for Harassment");
  await pageB.click('button:has-text("Participants")');
  await pageB.locator('[aria-label="Participant row: Mod A"]').locator('button[title="Report"]').click();
  await pageB.waitForSelector('text=Report Mod A', { timeout: 10000 });
  await pageB.selectOption("select", "HARASSMENT");
  await pageB.fill("textarea", "Kept talking over everyone and wouldn't stop.");
  await pageB.click('button:has-text("Submit report")');
  await pageB.waitForSelector("text=Report submitted", { timeout: 10000 });
  console.log("B_REPORTED_A: true");
  await shot(pageB, "b-reported-a");

  console.log("=== Admin reviews the real report queue ===");
  await pageAdmin.goto(`${BASE}/admin/reports`, { waitUntil: "networkidle" });
  await pageAdmin.waitForSelector("text=Harassment", { timeout: 10000 });
  const queueText = await pageAdmin.locator("body").innerText();
  const checks = {
    ADMIN_SEES_REPORTER_B: queueText.includes("Mod B"),
    ADMIN_SEES_REPORTED_A: queueText.includes("Mod A"),
    ADMIN_SEES_DETAILS: queueText.includes("Kept talking over everyone"),
    ADMIN_SEES_MEETING: queueText.includes(meeting1Code),
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${k} (should be true):`, v);
  if (Object.values(checks).some((v) => !v)) throw new Error(`Admin queue missing expected content:\n${queueText}`);
  await shot(pageAdmin, "admin-open-report-queue");

  await pageAdmin.fill('input[placeholder="Resolution note (optional)"]', "Spoke with Mod A, warning issued.");
  await pageAdmin.click('button:has-text("Resolve")');
  await pageAdmin.waitForSelector("text=No reports open", { timeout: 10000 });
  console.log("ADMIN_RESOLVED_REPORT: true");

  await pageAdmin.selectOption('select', "RESOLVED");
  await pageAdmin.waitForSelector("text=Spoke with Mod A, warning issued.", { timeout: 10000 });
  console.log("RESOLVED_REPORT_SHOWS_NOTE: true");
  await shot(pageAdmin, "admin-resolved-report");

  console.log("STEP: A (moderator) blocks C via the real Participants panel — real removal, not just a UI state flip");
  await pageA.click('button:has-text("Participants")');
  await pageA.locator('[aria-label="Participant row: Mod C"]').locator('button[title^="Block"]').click();
  await pageC.waitForSelector("text=The host removed you from this meeting.", { timeout: 15000 });
  console.log("C_WAS_REMOVED_LIVE: true");
  await shot(pageC, "c-removed-after-block");

  console.log("STEP: the block persists beyond this one meeting — C is refused joining A's NEXT meeting entirely");
  const meeting2Code = await pageA.evaluate(
    async ({ token }) => {
      const res = await fetch("http://localhost:4000/api/v1/meetings", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Moderation test 2", type: "INSTANT", settings: { waitingRoomEnabled: false } }),
      });
      return (await res.json()).code;
    },
    { token: a.token },
  );
  const cJoinStatus = await pageC.evaluate(
    async ({ token, code }) => {
      const res = await fetch(`http://localhost:4000/api/v1/meetings/${code}/join`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      return res.status;
    },
    { token: c.token, code: meeting2Code },
  );
  console.log("C_BLOCKED_FROM_NEW_MEETING_STATUS (should be 403):", cJoinStatus);
  if (cJoinStatus !== 403) throw new Error(`Expected 403 for a blocked user joining a new meeting by the same owner, got ${cJoinStatus}`);

  console.log("=== Domain restriction: real personal-room settings UI ===");
  await pageA.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await pageA.click('button[aria-label="Personal room settings"]');
  await pageA.fill('input[placeholder="e.g. acme.com"]', "restrict.dev");
  await pageA.click('button:has-text("Save")');
  await pageA.waitForTimeout(500);
  await pageA.reload({ waitUntil: "networkidle" });
  await pageA.click('button[aria-label="Personal room settings"]');
  const persistedDomains = await pageA.inputValue('input[placeholder="e.g. acme.com"]');
  console.log("DOMAIN_RESTRICTION_PERSISTED (should be 'restrict.dev'):", persistedDomains);
  if (persistedDomains !== "restrict.dev") throw new Error(`Domain restriction did not persist, got "${persistedDomains}"`);
  const personalRoomCode = await pageA.evaluate(() => window.location.pathname); // no-op sanity, code fetched below
  await pageA.click('button:has-text("Cancel")');
  const roomLinkText = await pageA.locator("text=/Code: /").innerText();
  const roomCode = roomLinkText.replace("Code: ", "").split(" ")[0];
  console.log("personalRoomCode:", roomCode, personalRoomCode);

  console.log("STEP: D (matching @restrict.dev email) joins the real personal room successfully");
  await joinMeeting(pageD, roomCode);
  console.log("D_JOINED_RESTRICTED_ROOM: true");
  await shot(pageD, "d-joined-restricted-room");

  console.log("STEP: E (non-matching email) is refused with a real, visible error at the real lobby — never reaches in-meeting");
  await pageE.goto(`${BASE}/meeting/${roomCode}`, { waitUntil: "networkidle" });
  await pageE.waitForSelector("button.lk-join-button", { timeout: 15000 });
  await pageE.click("button.lk-join-button");
  await pageE.waitForSelector("text=restricted to specific email domains", { timeout: 10000 });
  const eReachedMeeting = await pageE.locator('button:has-text("Leave")').count();
  console.log("E_REFUSED_WITH_VISIBLE_ERROR: true");
  console.log("E_NEVER_REACHED_MEETING (should be 0):", eReachedMeeting);
  if (eReachedMeeting !== 0) throw new Error("E should never have reached the in-meeting state");
  await shot(pageE, "e-refused-domain-restriction");

  console.log("STEP: a guest (no account at all) is refused outright once any domain restriction is set");
  const guestStatus = await pageE.evaluate(
    async ({ code }) => {
      const res = await fetch(`http://localhost:4000/api/v1/meetings/${code}/join-as-guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestName: "Random Guest" }),
      });
      return res.status;
    },
    { code: roomCode },
  );
  console.log("GUEST_REFUSED_STATUS (should be 403):", guestStatus);
  if (guestStatus !== 403) throw new Error(`Expected 403 for a guest joining a domain-restricted meeting, got ${guestStatus}`);

  for (const [label, list] of Object.entries(errors)) {
    console.log(`CONSOLE_ERRORS_${label}_START`);
    for (const e of list) console.log(`  ${label}:`, e);
    console.log(`CONSOLE_ERRORS_${label}_END`, `(${list.length} total)`);
  }

  await browser.close();
  console.log("DONE");
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
