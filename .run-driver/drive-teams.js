// Verifies Teams end-to-end: real team creation (with its own real chat
// room), self-serve join, LIVE real-time chat between two real people on a
// team room (the same ChatService infrastructure Team Chat groups already
// use — zero new chat backend), role promotion/demotion with sole-lead
// protection, "Start a meeting" (the identical client pattern Stage 23
// shipped for Team Chat groups), and real member removal.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const BASE = "http://localhost:3000";
const shotDir = path.join(__dirname, "screenshots", "teams");
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

(async () => {
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
  const ctxA = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const ctxB = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const errors = { A: [], B: [] };
  for (const [label, page] of [["A", pageA], ["B", pageB]]) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors[label].push(msg.text());
    });
    page.on("pageerror", (err) => errors[label].push(String(err)));
  }

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: A registers, creates a real org, and creates a real team");
  await register(pageA, "Team A Lead", `teamA${suffix}`, `teamA${suffix}@arutech.dev`);
  await pageA.goto(`${BASE}/organizations`, { waitUntil: "networkidle" });
  await pageA.click('button:has-text("New organization")');
  await pageA.fill('input[placeholder="Acme Inc."]', `Teams Org ${suffix}`);
  await pageA.click('button:has-text("Create")');
  await pageA.waitForURL("**/organizations/*", { timeout: 15000 });
  const orgId = new URL(pageA.url()).pathname.split("/").pop();
  console.log("orgId:", orgId);

  await pageA.click('button:has-text("+ New team")');
  await pageA.fill('input[placeholder="e.g. Engineering"]', "Engineering");
  await pageA.click('div.mb-3 >> button:has-text("Create")');
  await pageA.waitForURL("**/teams/*", { timeout: 15000 });
  const teamId = new URL(pageA.url()).pathname.split("/").pop();
  console.log("teamId:", teamId);
  await shot(pageA, "a-team-created-as-lead");
  const aSeesOwnLeadBadge = await pageA.locator('ul[aria-label="Team members"] li', { hasText: "Team A Lead" }).locator("text=LEAD").count();
  console.log("A_IS_LEAD_AFTER_CREATE (should be >=1):", aSeesOwnLeadBadge);
  if (aSeesOwnLeadBadge === 0) throw new Error("Team creator should be shown as LEAD");

  console.log("STEP: B registers; A adds B to the ORG directly (org membership already fully verified in Stage 28)");
  const bEmail = `teamB${suffix}@arutech.dev`;
  await register(pageB, "Team B Member", `teamB${suffix}`, bEmail);
  const bUserId = await pageB.evaluate(() => JSON.parse(localStorage.getItem("arutech-auth")).state.user.id);
  const aToken = await pageA.evaluate(() => JSON.parse(localStorage.getItem("arutech-auth")).state.accessToken);
  const addMemberStatus = await pageA.evaluate(
    async ({ token, orgId, userId }) => {
      const res = await fetch(`http://localhost:4000/api/v1/organizations/${orgId}/members`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: "MEMBER" }),
      });
      return res.status;
    },
    { token: aToken, orgId, userId: bUserId },
  );
  console.log("B_ADDED_TO_ORG_STATUS (should be 201):", addMemberStatus);
  if (addMemberStatus !== 201) throw new Error(`Failed to add B to the org, status ${addMemberStatus}`);

  console.log("=== B visits the team before joining — chat locked, sees Join button ===");
  await pageB.goto(`${BASE}/teams/${teamId}`, { waitUntil: "networkidle" });
  await pageB.waitForSelector("text=Join team", { timeout: 10000 });
  const chatLockedForB = await pageB.locator("text=Join this team to see and send messages.").count();
  console.log("CHAT_LOCKED_BEFORE_JOIN_FOR_B (should be 1):", chatLockedForB);
  if (chatLockedForB !== 1) throw new Error("B should not see the chat panel before joining the team");
  await shot(pageB, "b-team-before-joining");

  console.log("=== B joins — a real TeamMember + ChatMember get created ===");
  await pageB.click('button:has-text("Join team")');
  await pageB.waitForSelector('input[placeholder="Type a message…"]', { timeout: 10000 });
  await shot(pageB, "b-joined-team-chat-visible");

  console.log("=== A has the team page open too — real-time chat between two real people ===");
  await pageA.reload({ waitUntil: "networkidle" });
  await pageA.waitForSelector('input[placeholder="Type a message…"]', { timeout: 10000 });
  await pageB.fill('input[placeholder="Type a message…"]', "Hello from B, live in the team room");
  await pageB.press('input[placeholder="Type a message…"]', "Enter");
  await pageA.waitForSelector("text=Hello from B, live in the team room", { timeout: 10000 });
  console.log("A_RECEIVED_BS_MESSAGE_LIVE: true");
  await shot(pageA, "a-sees-bs-message-live");

  console.log("=== A promotes B to LEAD via the real member sidebar ===");
  const bMemberRow = pageA.locator('ul[aria-label="Team members"] li', { hasText: "Team B Member" });
  await bMemberRow.locator('button:has-text("Make lead")').click();
  await pageA.waitForTimeout(600);
  await pageA.reload({ waitUntil: "networkidle" });
  const bIsLeadNow = await pageA.locator('ul[aria-label="Team members"] li', { hasText: "Team B Member" }).locator("text=LEAD").count();
  console.log("B_PROMOTED_TO_LEAD (should be >=1):", bIsLeadNow);
  if (bIsLeadNow === 0) throw new Error("B should be shown as LEAD after promotion");

  console.log("=== A starts a real meeting — identical Stage 23 pattern, no new backend ===");
  await pageA.click('button:has-text("Start a meeting")');
  await pageA.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingCode = new URL(pageA.url()).pathname.split("/").pop();
  console.log("REAL_MEETING_CREATED, code:", meetingCode);
  await shot(pageA, "a-started-real-meeting");

  console.log("STEP: B sees the real join-link message live in the team chat, without doing anything");
  await pageB.waitForSelector(`text=${meetingCode}`, { timeout: 10000 });
  await shot(pageB, "b-sees-real-join-link-live");

  console.log("=== Sole-lead protection ===");
  const bToken = await pageB.evaluate(() => JSON.parse(localStorage.getItem("arutech-auth")).state.accessToken);
  // Demote A (2 leads -> 1) should succeed.
  const demoteAStatus = await pageB.evaluate(
    async ({ token, teamId, userId }) => {
      const res = await fetch(`http://localhost:4000/api/v1/teams/${teamId}/members/${userId}/role`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "MEMBER" }),
      });
      return res.status;
    },
    { token: bToken, teamId, userId: (await pageA.evaluate(() => JSON.parse(localStorage.getItem("arutech-auth")).state.user.id)) },
  );
  console.log("DEMOTE_A_WITH_TWO_LEADS_STATUS (should be 200):", demoteAStatus);
  if (demoteAStatus !== 200) throw new Error(`Expected 200 demoting A while 2 leads existed, got ${demoteAStatus}`);

  // Now B is the only lead — demoting B should fail.
  const demoteSoleLeadStatus = await pageB.evaluate(
    async ({ token, teamId, userId }) => {
      const res = await fetch(`http://localhost:4000/api/v1/teams/${teamId}/members/${userId}/role`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "MEMBER" }),
      });
      return res.status;
    },
    { token: bToken, teamId, userId: bUserId },
  );
  console.log("DEMOTE_SOLE_LEAD_STATUS (should be 403):", demoteSoleLeadStatus);
  if (demoteSoleLeadStatus !== 403) throw new Error(`Expected 403 demoting the sole lead, got ${demoteSoleLeadStatus}`);

  const soleLeadLeaveStatus = await pageB.evaluate(
    async ({ token, teamId }) => {
      const res = await fetch(`http://localhost:4000/api/v1/teams/${teamId}/leave`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.status;
    },
    { token: bToken, teamId },
  );
  console.log("SOLE_LEAD_LEAVE_STATUS (should be 403):", soleLeadLeaveStatus);
  if (soleLeadLeaveStatus !== 403) throw new Error(`Expected 403 for the sole lead leaving, got ${soleLeadLeaveStatus}`);

  console.log("=== B (now sole lead) removes A from the team for real ===");
  await pageB.reload({ waitUntil: "networkidle" });
  console.log("A row count before remove:", await pageB.locator('ul[aria-label="Team members"] li', { hasText: "Team A Lead" }).count());
  console.log("A row HTML:", await pageB.locator('ul[aria-label="Team members"] li', { hasText: "Team A Lead" }).first().innerHTML());
  const removeABtn = pageB.locator('ul[aria-label="Team members"] li', { hasText: "Team A Lead" }).locator('button:has-text("Remove")');
  console.log("Remove button count:", await removeABtn.count());
  const [removeResponse] = await Promise.all([
    pageB.waitForResponse((r) => r.url().includes("/members/") && r.request().method() === "DELETE"),
    removeABtn.click(),
  ]);
  console.log("REMOVE_A_RESPONSE_STATUS:", removeResponse.status(), await removeResponse.text().catch(() => "<no body>"));
  await pageB.waitForTimeout(800);
  const aStillListed = await pageB.locator('ul[aria-label="Team members"] li', { hasText: "Team A Lead" }).count();
  console.log("A_STILL_LISTED_AFTER_REMOVAL (should be 0):", aStillListed);
  if (aStillListed !== 0) throw new Error("A should no longer be listed after being removed");
  await shot(pageB, "b-removed-a-from-team");

  console.log("CONSOLE_ERRORS_A_START");
  for (const e of errors.A) console.log("  A:", e);
  console.log("CONSOLE_ERRORS_A_END", `(${errors.A.length} total)`);
  console.log("CONSOLE_ERRORS_B_START");
  for (const e of errors.B) console.log("  B:", e);
  console.log("CONSOLE_ERRORS_B_END", `(${errors.B.length} total)`);

  await browser.close();
  console.log("DONE");
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
