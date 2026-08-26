// Verifies Organizations end-to-end: create org, real invite-by-email (a
// genuine SMTP send confirmed via MailHog's own API, not just "the endpoint
// returned 200"), a brand-new person following the actual email link through
// register -> accept, real member-management (role change, remove/leave with
// sole-owner protection), and per-org limits actually enforced server-side
// (concurrency + storage), not just stored on the row.
const { chromium } = require("playwright-core");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const BASE = "http://localhost:3000";
const MAILHOG_API = "http://localhost:8095/api/v2/messages";
const shotDir = path.join(__dirname, "screenshots", "organizations");
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

function sql(query) {
  return execSync(`PGPASSWORD=scratch psql -h localhost -p 55433 -U arutech -d arutech_meet -t -c "${query}"`, {
    encoding: "utf8",
  }).trim();
}

(async () => {
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
  const ctxA = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
  const ctxB = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
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
  const bEmail = `orgB${suffix}@arutech.dev`;

  console.log("STEP: A registers and creates a real organization through the real UI");
  await register(pageA, "Org A Owner", `orgA${suffix}`, `orgA${suffix}@arutech.dev`);
  await pageA.goto(`${BASE}/organizations`, { waitUntil: "networkidle" });
  await pageA.click('button:has-text("New organization")');
  await pageA.fill('input[placeholder="Acme Inc."]', `Test Org ${suffix}`);
  await pageA.click('button:has-text("Create")');
  await pageA.waitForURL("**/organizations/*", { timeout: 15000 });
  const orgId = new URL(pageA.url()).pathname.split("/").pop();
  console.log("orgId:", orgId);
  await shot(pageA, "a-org-created");

  console.log("=== A invites B by email — B has no account yet ===");
  await pageA.fill('input[placeholder="teammate@example.com"]', bEmail);
  await pageA.click('button:has-text("Send invite")');
  await pageA.waitForSelector(`text=A real invite email was sent to ${bEmail}`, { timeout: 10000 });
  await shot(pageA, "a-invite-sent");

  console.log("STEP: confirm a genuine SMTP email actually arrived (MailHog), not just a 200 response");
  await new Promise((r) => setTimeout(r, 500));
  // Node's own fetch, not page.evaluate — the web app's CSP (connect-src
  // default 'self') would otherwise block a page-context fetch to MailHog's
  // origin; this only needs to prove the email was really delivered, not
  // that the app's own UI can reach MailHog (it never needs to).
  const mail = await fetch(MAILHOG_API).then((r) => r.json());
  const inviteMail = mail.items.find(
    (m) => m.To?.[0] && `${m.To[0].Mailbox}@${m.To[0].Domain}`.toLowerCase() === bEmail.toLowerCase(),
  );
  console.log("REAL_EMAIL_ARRIVED_IN_MAILHOG:", Boolean(inviteMail));
  if (!inviteMail) throw new Error(`No real email arrived for ${bEmail} — invite email delivery is broken`);
  // Quoted-printable soft line breaks ("=\r\n") can land mid-token — strip
  // them from the whole body before extracting, not after (a match already
  // truncated at the break point has lost the rest of the token for good).
  const decodedBody = inviteMail.Content.Body.replace(/=\r?\n/g, "");
  const bodyMatch = decodedBody.match(/organizations\/invites\/([A-Za-z0-9_-]+)/);
  const acceptToken = bodyMatch ? bodyMatch[1] : null;
  console.log("EXTRACTED_ACCEPT_TOKEN_FROM_REAL_EMAIL:", acceptToken);
  if (!acceptToken) throw new Error("Could not extract a real accept token from the delivered email body");

  console.log("=== B follows the real email link, not logged in yet ===");
  await pageB.goto(`${BASE}/organizations/invites/${acceptToken}`, { waitUntil: "networkidle" });
  await pageB.waitForSelector("text=invited you to join", { timeout: 10000 });
  await shot(pageB, "b-invite-preview-logged-out");
  const signupLink = await pageB.locator('a:has-text("Create an account to accept")').getAttribute("href");
  console.log("SIGNUP_LINK_PREFILLS_EMAIL:", signupLink?.includes(encodeURIComponent(bEmail)));

  console.log("STEP: B registers via the real link (email pre-filled) and lands back on the accept page");
  await pageB.click('a:has-text("Create an account to accept")');
  await pageB.waitForURL("**/register**", { timeout: 10000 });
  const emailValue = await pageB.locator('input[type="email"]').inputValue();
  console.log("REGISTER_EMAIL_PREFILLED_CORRECTLY:", emailValue === bEmail);
  if (emailValue !== bEmail) throw new Error(`Expected register email to be pre-filled with ${bEmail}, got ${emailValue}`);
  await pageB.locator("input").nth(0).fill("Org B Invitee");
  await pageB.locator("input").nth(1).fill(`orgB${suffix}`);
  await pageB.locator('input[type="password"]').fill("Password123!");
  await pageB.click('button[type="submit"]');
  await pageB.waitForURL(`**/organizations/invites/${acceptToken}`, { timeout: 15000 });
  console.log("B_REDIRECTED_BACK_TO_ACCEPT_PAGE_AFTER_REGISTER:", pageB.url().includes(acceptToken));
  await shot(pageB, "b-back-on-accept-page-after-register");

  console.log("=== B accepts — a real membership row gets created ===");
  await pageB.click('button:has-text("Accept as")');
  await pageB.waitForURL(`**/organizations/${orgId}`, { timeout: 15000 });
  await shot(pageB, "b-now-a-real-member");
  const bSeesSelfAsMember = await pageB.locator("text=(you)").count();
  console.log("B_SEES_SELF_IN_MEMBER_LIST (should be 1):", bSeesSelfAsMember);
  if (bSeesSelfAsMember !== 1) throw new Error("B should see themselves in the member list after accepting");

  console.log("=== A sees B as a real member live (refetch, not stale) ===");
  await pageA.reload({ waitUntil: "networkidle" });
  await pageA.waitForSelector("text=Org B Invitee", { timeout: 10000 });
  await shot(pageA, "a-sees-b-as-member");

  console.log("=== A (owner) promotes B to ADMIN via the real role dropdown ===");
  const bRow = pageA.locator("li", { hasText: "Org B Invitee" });
  await bRow.locator("select").selectOption("ADMIN");
  await pageA.waitForTimeout(800);
  await pageA.reload({ waitUntil: "networkidle" });
  const bRoleAfter = await pageA.locator("li", { hasText: "Org B Invitee" }).locator("select").inputValue();
  console.log("B_ROLE_AFTER_PROMOTION (should be ADMIN):", bRoleAfter);
  if (bRoleAfter !== "ADMIN") throw new Error(`Expected B to be promoted to ADMIN, got ${bRoleAfter}`);

  console.log("=== Sole-owner protection: A (the only OWNER) cannot leave ===");
  const aToken = await pageA.evaluate(() => JSON.parse(localStorage.getItem("arutech-auth")).state.accessToken);
  const leaveStatus = await pageA.evaluate(
    async ({ token, id }) => {
      const res = await fetch(`http://localhost:4000/api/v1/organizations/${id}/leave`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.status;
    },
    { token: aToken, id: orgId },
  );
  console.log("SOLE_OWNER_LEAVE_STATUS (should be 403):", leaveStatus);
  if (leaveStatus !== 403) throw new Error(`Expected 403 for sole-owner leave, got ${leaveStatus}`);

  console.log("=== Per-org limits: concurrency, actually enforced server-side ===");
  sql(`UPDATE organizations SET meeting_concurrency_limit = 0 WHERE id = '${orgId}'`);
  const overLimitStatus = await pageA.evaluate(
    async ({ token, id }) => {
      const res = await fetch("http://localhost:4000/api/v1/meetings", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Should be blocked", type: "INSTANT", timezone: "UTC", orgId: id }),
      });
      return res.status;
    },
    { token: aToken, id: orgId },
  );
  console.log("MEETING_CREATE_OVER_CONCURRENCY_LIMIT_STATUS (should be 403):", overLimitStatus);
  if (overLimitStatus !== 403) throw new Error(`Expected 403 over the concurrency limit, got ${overLimitStatus}`);
  sql(`UPDATE organizations SET meeting_concurrency_limit = 5 WHERE id = '${orgId}'`);
  const underLimitStatus = await pageA.evaluate(
    async ({ token, id }) => {
      const res = await fetch("http://localhost:4000/api/v1/meetings", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Should work", type: "INSTANT", timezone: "UTC", orgId: id }),
      });
      return res.status;
    },
    { token: aToken, id: orgId },
  );
  console.log("MEETING_CREATE_UNDER_LIMIT_STATUS (should be 201):", underLimitStatus);
  if (underLimitStatus !== 201) throw new Error(`Expected 201 back under the limit, got ${underLimitStatus}`);

  console.log("=== Per-org limits: storage, actually enforced server-side ===");
  sql(`UPDATE organizations SET storage_limit_bytes = 100 WHERE id = '${orgId}'`);
  // Need a real meeting under this org to presign a chat attachment against.
  const orgMeeting = await pageA.evaluate(
    async ({ token, id }) => {
      const res = await fetch("http://localhost:4000/api/v1/meetings", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Storage test meeting", type: "INSTANT", timezone: "UTC", orgId: id }),
      });
      const body = await res.json();
      return { status: res.status, body };
    },
    { token: aToken, id: orgId },
  );
  console.log("ORG_MEETING_FOR_STORAGE_TEST:", JSON.stringify(orgMeeting));
  const orgMeetingId = orgMeeting.body.id;
  if (!orgMeetingId) throw new Error("Failed to create the org meeting needed for the storage-limit test");
  // Presigning requires a real MeetingParticipant row (chat.send capability
  // check) — creating a meeting alone doesn't make the creator a
  // participant, only actually joining does.
  await pageA.evaluate(
    async ({ token, code }) => {
      await fetch(`http://localhost:4000/api/v1/meetings/${code}/join`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    },
    { token: aToken, code: orgMeeting.body.code },
  );
  const presignOverStatus = await pageA.evaluate(
    async ({ token, meetingId }) => {
      const res = await fetch(`http://localhost:4000/api/v1/meetings/${meetingId}/files/presign`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: "big.png", mimeType: "image/png", sizeBytes: 5000 }),
      });
      return res.status;
    },
    { token: aToken, meetingId: orgMeetingId },
  );
  console.log("PRESIGN_OVER_STORAGE_LIMIT_STATUS (should be 403):", presignOverStatus);
  if (presignOverStatus !== 403) throw new Error(`Expected 403 over the storage limit, got ${presignOverStatus}`);
  sql(`UPDATE organizations SET storage_limit_bytes = 10737418240 WHERE id = '${orgId}'`);
  const presignUnderStatus = await pageA.evaluate(
    async ({ token, meetingId }) => {
      const res = await fetch(`http://localhost:4000/api/v1/meetings/${meetingId}/files/presign`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: "fine.png", mimeType: "image/png", sizeBytes: 5000 }),
      });
      return res.status;
    },
    { token: aToken, meetingId: orgMeetingId },
  );
  console.log("PRESIGN_UNDER_STORAGE_LIMIT_STATUS (should be 201):", presignUnderStatus);
  if (presignUnderStatus !== 201) throw new Error(`Expected 201 back under the storage limit, got ${presignUnderStatus}`);

  console.log("=== A removes B — real member-management, not just role changes ===");
  await pageA.goto(`${BASE}/organizations/${orgId}`, { waitUntil: "networkidle" });
  const removeBtn = pageA.locator("li", { hasText: "Org B Invitee" }).locator('button:has-text("Remove")');
  await removeBtn.click();
  await pageA.waitForTimeout(800);
  const bStillListed = await pageA.locator("text=Org B Invitee").count();
  console.log("B_STILL_LISTED_AFTER_REMOVAL (should be 0):", bStillListed);
  if (bStillListed !== 0) throw new Error("B should no longer be listed after being removed");
  await shot(pageA, "a-removed-b");

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
