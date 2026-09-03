// Verifies the reported bug: "unable to invite or add people in
// organisations when create team" — a team lead had no way to add a
// specific org member to a newly-created team, only self-serve Join. A
// registers, creates an org, invites B (real org invite flow, already
// tested elsewhere), B accepts, A creates a team, then A adds B to the team
// directly — B should end up a team member with zero action of their own.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "team-add-member");
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

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errors = [];
  a.on("pageerror", (err) => errors.push(String(err)));
  a.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  const suffix = Date.now().toString().slice(-6);
  let pass = true;
  const bEmail = `teamb${suffix}@arutech.dev`;

  console.log("STEP: register A and B, A creates an org and invites B, B accepts");
  await register(a, "Team A", `teama${suffix}`, `teama${suffix}@arutech.dev`);
  await register(b, "Team B", `teamb${suffix}`, bEmail);

  await a.goto("http://localhost:3000/organizations", { waitUntil: "networkidle" });
  await a.click('button:has-text("New organization")');
  await a.waitForTimeout(300);
  await a.fill('input[placeholder="Acme Inc."]', "Squad Org");
  await a.click('div.fixed.inset-0 button:has-text("Create")');
  await a.waitForTimeout(800);
  await a.fill('input[placeholder="teammate@example.com"]', bEmail);
  await a.click('button:has-text("Send invite")');
  await a.waitForTimeout(800);
  const orgUrl = a.url();
  const orgId = orgUrl.split("/organizations/")[1];
  console.log("ORG_ID:", orgId);

  // B accepts via the real API (deterministic — no need to click through
  // an email link in this driver) using the invite token from the DB isn't
  // available to us here, so instead B just visits the org's invite
  // acceptance the same way a real user would: via the token emailed to
  // them. Simpler and just as real for this test: B independently joins
  // the org isn't possible without the token, so fetch it from the API
  // owner-side listing (A can see pending invites).
  const inviteToken = await a.evaluate(async (oid) => {
    const auth = JSON.parse(localStorage.getItem("arutech-auth") || "{}").state;
    const res = await fetch(`http://localhost:4000/api/v1/organizations/${oid}/invites`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    const invites = await res.json();
    return invites[0]?.token;
  }, orgId);
  console.log("INVITE_TOKEN_FOUND:", Boolean(inviteToken));
  await b.goto(`http://localhost:3000/organizations/invites/${inviteToken}`, { waitUntil: "networkidle" });
  await b.waitForTimeout(500);
  await b.click('button:has-text("Accept")').catch(() => {});
  await b.waitForTimeout(800);

  console.log("STEP: A creates a team in the org");
  await a.goto(orgUrl, { waitUntil: "networkidle" });
  await a.click('button:has-text("New team")');
  await a.waitForTimeout(300);
  await a.fill('input[placeholder="e.g. Engineering"]', "Ops Team");
  await a.click('input[placeholder="e.g. Engineering"] ~ button:has-text("Create")');
  await a.waitForURL("**/teams/**", { timeout: 10000 });
  await a.waitForTimeout(500);
  await shot(a, "01-team-created-1-member");

  console.log("STEP: click + Add next to Members — this button didn't exist at all before the fix");
  const addBtn = a.locator('button:has-text("+ Add")');
  const addBtnExists = await addBtn.count();
  console.log("ADD_BUTTON_EXISTS (expect >=1 -- this is the actual bug being fixed):", addBtnExists);
  if (addBtnExists < 1) pass = false;
  await addBtn.click();
  await a.waitForTimeout(500);
  await shot(a, "02-add-member-picker-open");

  console.log("STEP: B (the real org member just invited) should be listed as addable");
  const bRowVisible = await a.locator("text=Team B").first().isVisible().catch(() => false);
  console.log("B_LISTED_AS_ADDABLE (expect true):", bRowVisible);
  if (!bRowVisible) pass = false;

  console.log("STEP: click Add — B should become a real team member");
  await a.click('div:has-text("Team B") >> button:has-text("Add")');
  await a.waitForTimeout(800);
  await shot(a, "03-b-added-2-members");
  const memberCountText = await a.locator("text=/\\d+ members/").first().textContent();
  console.log("MEMBER_COUNT_AFTER_ADD:", memberCountText);
  if (!memberCountText?.includes("2")) pass = false;

  console.log("STEP: B (separate browser/account, zero action) should now see the team's chat without ever clicking Join");
  await b.goto("http://localhost:3000/teams", { waitUntil: "networkidle" }).catch(() => {});
  // Team detail URL known from A's session
  const teamUrl = a.url();
  await b.goto(teamUrl, { waitUntil: "networkidle" });
  await b.waitForTimeout(600);
  await shot(b, "04-b-already-a-member-no-join-needed");
  const joinButtonForB = await b.locator('button:has-text("Join team")').count();
  const leaveButtonForB = await b.locator('button:has-text("Leave team")').count();
  console.log("B_SEES_JOIN_BUTTON (expect 0 -- already a member):", joinButtonForB);
  console.log("B_SEES_LEAVE_BUTTON (expect >=1 -- confirms real membership):", leaveButtonForB);
  if (joinButtonForB !== 0 || leaveButtonForB < 1) pass = false;

  console.log("STEP: no console/page errors for A");
  console.log("CONSOLE_ERRORS:", JSON.stringify(errors));
  if (errors.length > 0) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
