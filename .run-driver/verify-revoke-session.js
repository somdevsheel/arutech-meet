// Verifies L-1: Settings' Active Sessions list was purely read-only — no
// way to sign out any device but the one you're currently using.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const API = "http://localhost:4000/api/v1";
const shotDir = path.join(__dirname, "screenshots", "revoke-session");
fs.mkdirSync(shotDir, { recursive: true });
let shotN = 0;
async function shot(page, label) {
  shotN += 1;
  const file = path.join(shotDir, `${String(shotN).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file });
  console.log("SCREENSHOT:", file);
}

async function registerViaApi(name, username, email, password) {
  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, displayName: name, username }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function loginViaApi(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  return res.json();
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
  const email = `revokeqa${suffix}@arutech.dev`;
  const password = "Password123";
  let pass = true;

  console.log("STEP: register (device A's session), then a real second login (device B's session)");
  const deviceA = await registerViaApi("Revoke QA", `revokeqa${suffix}`, email, password);
  const deviceB = await loginViaApi(email, password);
  console.log("Two real, distinct sessions now exist for the same account.");

  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageA = await loginAs(ctxA, deviceA);
  await pageA.goto("http://localhost:3000/settings", { waitUntil: "networkidle" });
  await pageA.waitForTimeout(500);

  console.log("STEP: device A's Settings must list 2 sessions — itself marked 'This device', the other with a Sign out button");
  // Scope strictly to the Active sessions <section> — the page also has an
  // unrelated full-account "Sign out" button lower down, which a page-wide
  // `button:has-text("Sign out")` locator would otherwise also match.
  const sessionsSection = pageA.locator("section", { has: pageA.locator("h2", { hasText: "Active sessions" }) });
  await sessionsSection.scrollIntoViewIfNeeded();
  await shot(pageA, "01-two-sessions-listed");
  const thisDeviceBadges = await sessionsSection.locator("text=This device").count();
  const signOutButtons = await sessionsSection.locator('button:has-text("Sign out")').count();
  console.log("THIS_DEVICE_BADGE_COUNT (expect 1):", thisDeviceBadges);
  console.log("SIGN_OUT_BUTTON_COUNT (expect 1 — not on your own row):", signOutButtons);
  if (thisDeviceBadges !== 1 || signOutButtons !== 1) pass = false;

  console.log("STEP: click Sign out on the OTHER device's row");
  await sessionsSection.locator('button:has-text("Sign out")').click();
  await pageA.waitForTimeout(800);
  const rowsAfter = await sessionsSection.locator("ul > li").count();
  console.log("SESSION_ROW_REMOVED_FROM_UI (rows after, expect 1):", rowsAfter);
  await shot(pageA, "02-other-session-removed-from-list");

  console.log("STEP: the REAL backend session must actually be revoked — device B's refresh token must now be rejected");
  const refreshResp = await fetch(`${API}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: deviceB.refreshToken }),
  });
  const refreshBody = await refreshResp.json().catch(() => null);
  console.log("DEVICE_B_REFRESH_STATUS (expect 401):", refreshResp.status, JSON.stringify(refreshBody?.error?.message));
  if (refreshResp.status !== 401) pass = false;

  console.log("STEP: device A's OWN session must still work fine (only the other one was revoked)");
  const refreshA = await fetch(`${API}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: deviceA.refreshToken }),
  });
  console.log("DEVICE_A_REFRESH_STATUS (expect 200 — unaffected):", refreshA.status);
  if (refreshA.status !== 200) pass = false;

  console.log("STEP: trying to sign out your OWN current session through this control must be refused server-side");
  const meSessions = await pageA.evaluate(async () => {
    const s = JSON.parse(localStorage.getItem("arutech-auth"));
    const res = await fetch("http://localhost:4000/api/v1/users/me/sessions", {
      headers: { Authorization: `Bearer ${s.state.accessToken}` },
    });
    return res.json();
  });
  const ownSessionId = meSessions.find((s) => s.current)?.id;
  const selfRevokeAttempt = await pageA.evaluate(async (id) => {
    const s = JSON.parse(localStorage.getItem("arutech-auth"));
    const res = await fetch(`http://localhost:4000/api/v1/users/me/sessions/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${s.state.accessToken}` },
    });
    return res.status;
  }, ownSessionId);
  console.log("SELF_REVOKE_REFUSED (expect 400):", selfRevokeAttempt);
  if (selfRevokeAttempt !== 400) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
