// Verifies H-6: a group's sole admin leaving used to permanently orphan it.
// Checks: (1) the sole admin's Leave click is now refused with a real,
// visible error; (2) promoting someone else first lets them leave normally,
// and the group stays manageable afterward.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const BASE = "http://localhost:3000";
const shotDir = path.join(__dirname, "screenshots", "sole-admin-cant-leave");
fs.mkdirSync(shotDir, { recursive: true });
let shotN = 0;
async function shot(page, label) {
  shotN += 1;
  const file = path.join(shotDir, `${String(shotN).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file });
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

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const ctxA = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("STEP: A creates a group with B (A is sole admin)");
  await register(pageA, "Sole Admin A", `soleadmina${suffix}`, `soleadmina${suffix}@arutech.dev`);
  await register(pageB, "Sole Member B", `solememberb${suffix}`, `solememberb${suffix}@arutech.dev`);
  const a = await authOf(pageA);
  const b = await authOf(pageB);

  const roomRes = await pageA.evaluate(
    async ({ token, bId }) => {
      const res = await fetch("http://localhost:4000/api/v1/chat-rooms", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "GROUP", name: "Sole Admin Test Group", memberUserIds: [bId] }),
      });
      return res.json();
    },
    { token: a.token, bId: b.userId },
  );
  const roomId = roomRes.id;
  console.log("GROUP_CREATED:", roomId);

  await pageA.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
  await pageA.click("text=Sole Admin Test Group");
  await pageA.waitForTimeout(500);

  console.log("STEP: A (sole admin) clicks Leave — must be refused with a real error, not silently swallowed");
  await pageA.click('button:has-text("Leave")');
  await pageA.waitForTimeout(800);
  await shot(pageA, "01-sole-admin-leave-refused");
  const errorVisible = await pageA
    .locator("text=/only admin|promote another/i")
    .count();
  console.log("SOLE_ADMIN_SEES_REFUSAL_MESSAGE (expect >=1):", errorVisible);
  const stillInGroup = await pageA.locator("text=Sole Admin Test Group").count();
  console.log("GROUP_STILL_IN_As_ROOM_LIST (expect >=1 — leave was refused, not silently applied):", stillInGroup);
  if (errorVisible < 1 || stillInGroup < 1) pass = false;

  console.log("STEP: A promotes B to admin, then leaves again — must succeed now");
  await pageA.click('button:has-text("Manage")');
  await pageA.waitForTimeout(300);
  await shot(pageA, "02-manage-modal-before-promote");
  await pageA.click('button:has-text("Make admin")');
  await pageA.waitForTimeout(500);
  await pageA.click('button[aria-label="Close"], button:has-text("✕")').catch(() => {});
  await pageA.waitForTimeout(300);
  await pageA.click('button:has-text("Leave")');
  await pageA.waitForTimeout(800);
  await shot(pageA, "03-a-left-after-promoting-b");

  const aStillInGroup = await pageA.locator("text=Sole Admin Test Group").count();
  console.log("A_LEFT_SUCCESSFULLY_AFTER_PROMOTING_B (expect group gone from A's list, count 0):", aStillInGroup);
  if (aStillInGroup !== 0) pass = false;

  console.log("STEP: group is still manageable — B (now admin) sees admin controls");
  await pageB.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
  await pageB.click("text=Sole Admin Test Group");
  await pageB.waitForTimeout(500);
  await pageB.click('button:has-text("Manage")');
  await pageB.waitForTimeout(300);
  await shot(pageB, "04-b-is-now-admin-manage-modal");
  // B is now the group's only member (A already left), so there's no OTHER
  // member left to show promote/demote/remove buttons for — the real proof
  // the group didn't get orphaned is that B is shown as Admin at all, with
  // the admin-only "+ Add member" control (a plain member never sees it —
  // see "refuses a non-admin member from renaming the group" test coverage).
  const bIsAdmin = await pageB.locator("text=Admin").count();
  const bSeesAddMember = await pageB.locator("text=Add member").count();
  console.log("B_SHOWN_AS_ADMIN (expect >=1):", bIsAdmin);
  console.log("B_SEES_ADD_MEMBER_ADMIN_CONTROL_GROUP_STILL_MANAGEABLE (expect >=1):", bSeesAddMember);
  if (bIsAdmin < 1 || bSeesAddMember < 1) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
