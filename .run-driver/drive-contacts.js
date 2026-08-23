// Verifies Contacts' new block/favorite/group features end-to-end through
// the real UI with two real registered users who've actually shared a real
// meeting (so they show up as derived contacts of each other).
const { chromium } = require("playwright-core");
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "contacts");
fs.mkdirSync(shotDir, { recursive: true });
let shotN = 0;
async function shot(page, label) {
  shotN += 1;
  const file = path.join(shotDir, `${String(shotN).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
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

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
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

  console.log("STEP: register A and B, get them into a real meeting together (so they become contacts)");
  await register(pageA, "Contact A", `conta${suffix}`, `conta${suffix}@arutech.dev`);
  await register(pageB, "Contact B", `contb${suffix}`, `contb${suffix}@arutech.dev`);

  await pageA.click("text=New meeting");
  await pageA.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingCode = new URL(pageA.url()).pathname.split("/").pop();
  await pageA.click('button:has-text("Join meeting")');
  await pageA.waitForSelector("footer", { timeout: 15000 });

  await pageB.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await pageB.click('button:has-text("Join meeting")', { timeout: 15000 });
  await pageB.waitForTimeout(2000);
  const admitBtn = pageA.locator('button:has-text("Admit")');
  try {
    await admitBtn.first().waitFor({ timeout: 8000 });
    await admitBtn.first().click();
  } catch {
    console.log("No Admit button — B may not have needed admission");
  }
  await pageB.waitForSelector("footer", { timeout: 15000 });
  await pageA.waitForTimeout(1000);

  console.log("STEP: patch MeetingParticipant.status to JOINED — this dev stack's LiveKit has no webhook delivery to the API (a pre-existing gap, see .run-driver/drive-calls.js's own comment); both users genuinely joined via real WebRTC, confirmed above by reaching the in-meeting UI");
  const aToken0 = await pageA.evaluate(() => JSON.parse(localStorage.getItem("arutech-auth")).state.accessToken);
  const meetingId = await pageA.evaluate(
    async ({ token, code }) => {
      const res = await fetch("http://localhost:4000/api/v1/meetings", { headers: { Authorization: `Bearer ${token}` } });
      const meetings = await res.json();
      return meetings.find((m) => m.code === code)?.id ?? null;
    },
    { token: aToken0, code: meetingCode },
  );
  if (!meetingId) throw new Error("Could not resolve meetingId for the meeting code");
  execFileSync(
    "pnpm",
    ["--filter", "@arutech/database", "exec", "tsx", "/tmp/claude-1000/-home-somdevsheel-Project-Indium-by-Arutech/5949e38b-db83-4095-9aa1-19d673a40439/scratchpad/mark-participants-joined.ts", meetingId],
    { cwd: path.join(__dirname, ".."), env: { ...process.env, DATABASE_URL: "postgresql://arutech:scratch@localhost:55433/arutech_meet?schema=public" }, stdio: "inherit" },
  );

  await pageA.click('button:has-text("Leave")');
  await pageB.click('button:has-text("Leave")');
  await pageA.waitForTimeout(500);

  console.log("STEP: both open Contacts and see each other listed");
  await pageA.goto("http://localhost:3000/contacts", { waitUntil: "networkidle" });
  await shot(pageA, "01-a-sees-b");
  const aSeesB = await pageA.locator("text=Contact B").count();
  console.log("A_SEES_B_AS_CONTACT (should be >=1):", aSeesB);
  if (aSeesB === 0) throw new Error("A doesn't see B as a derived contact after sharing a meeting");

  console.log("STEP: A favorites B");
  await pageA.click('button[aria-label="Favorite Contact B"]');
  await pageA.waitForTimeout(400);
  await shot(pageA, "02-a-favorited-b");
  const starFilled = await pageA.locator('button[aria-label="Unfavorite Contact B"]').count();
  console.log("B_NOW_SHOWS_FILLED_STAR (should be >=1):", starFilled);
  if (starFilled === 0) throw new Error("Favorite toggle didn't flip to the unfavorite state");

  console.log("STEP: A creates a group and adds B to it");
  await pageA.click('button:has-text("Groups")');
  await pageA.fill('input[placeholder="New group name"]', "Study Buddies");
  await pageA.click('button:has-text("Create")');
  await pageA.waitForTimeout(600);
  await shot(pageA, "03-a-created-group");
  await pageA.click('button:has-text("+ Group")');
  await pageA.waitForTimeout(300);
  await pageA.click('button:has-text("Study Buddies")');
  await pageA.waitForTimeout(600);
  await shot(pageA, "04-a-added-b-to-group");
  const groupChipOnContactRow = await pageA.locator("text=Study Buddies").count();
  console.log("GROUP_CHIP_VISIBLE_SOMEWHERE (should be >=2 — group panel + contact row):", groupChipOnContactRow);
  if (groupChipOnContactRow < 2) throw new Error("Group membership didn't reflect on both the group panel and the contact row");

  console.log("STEP: A blocks B — B should immediately disappear from A's contact list");
  await pageA.click('button[aria-label="Block Contact B"]');
  await pageA.waitForTimeout(600);
  await pageA.click('button:has-text("Groups")'); // close the groups panel — it legitimately still shows "Contact B" as a group member, a separate concern from contact-list visibility
  await pageA.waitForTimeout(300);
  await shot(pageA, "05-a-blocked-b");
  const emptyStateVisible = await pageA.locator("text=No contacts yet").count();
  console.log("CONTACTS_LIST_NOW_EMPTY_AFTER_BLOCK (should be >=1):", emptyStateVisible);
  if (emptyStateVisible === 0) throw new Error("B is still visible in A's contacts list after blocking");

  await pageA.click('button:has-text("Blocked")');
  await pageA.waitForTimeout(300);
  await shot(pageA, "06-a-blocked-list");
  const bInBlockedList = await pageA.locator("text=Contact B").count();
  console.log("B_IN_BLOCKED_LIST (should be >=1):", bInBlockedList);
  if (bInBlockedList === 0) throw new Error("B doesn't show up in A's blocked-users list");

  console.log("STEP: block is symmetric — B (who never blocked anyone) can no longer DM A either");
  const bToken = await pageB.evaluate(() => JSON.parse(localStorage.getItem("arutech-auth")).state.accessToken);
  const aId = await pageA.evaluate(() => JSON.parse(localStorage.getItem("arutech-auth")).state.user.id);
  const dmAttemptStatus = await pageB.evaluate(
    async ({ token, aId }) => {
      const res = await fetch("http://localhost:4000/api/v1/chat-rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: "DIRECT", memberUserIds: [aId] }),
      });
      return res.status;
    },
    { token: bToken, aId },
  );
  console.log("B_DM_ATTEMPT_TO_A_STATUS (should be 403):", dmAttemptStatus);
  if (dmAttemptStatus !== 403) throw new Error(`Expected B's DM attempt to A to be blocked with 403, got ${dmAttemptStatus}`);

  console.log("STEP: A unblocks B — B reappears in A's contacts");
  await pageA.click('button:has-text("Unblock")');
  await pageA.waitForTimeout(600);
  await shot(pageA, "07-a-unblocked-b");
  await pageA.click('button:has-text("Blocked")'); // close the panel back
  const bBackInContacts = await pageA.locator("text=Contact B").count();
  console.log("B_BACK_IN_CONTACTS_AFTER_UNBLOCK (should be >=1):", bBackInContacts);
  if (bBackInContacts === 0) throw new Error("B never reappeared in A's contacts after unblocking");

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
