// Verifies Custom branding end-to-end: an org owner sets a real logo/brand
// color/join-page message through the real settings UI, it persists across
// reload, a plain MEMBER never sees the settings UI and is refused (403) at
// the API too, and — the actual payoff — a genuinely unauthenticated guest
// opening an org-scoped meeting's join screen sees the real logo/message and
// the PreJoin "Join meeting" button rendered in the org's actual brand color
// (computed style, not just a stored hex nobody reads), while an unbranded
// personal meeting renders with the app's default accent untouched.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const BASE = "http://localhost:3000";
const API = "http://localhost:4000/api/v1";
const shotDir = path.join(__dirname, "screenshots", "org-branding");
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

// Tiny real 1x1 PNG, inline — avoids depending on outbound network access
// for something as incidental as "does an <img> render".
const LOGO_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const BRAND_COLOR = "#e85d2c";
const BRAND_COLOR_RGB = "rgb(232, 93, 44)"; // #e85d2c
const DEFAULT_ACCENT_RGB = "rgb(59, 111, 224)"; // globals.css --lk-accent-bg: #3b6fe0
const JOIN_MESSAGE = "Welcome — please join a minute early so we can get started on time.";

(async () => {
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
  const ctxA = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const ctxB = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const ctxGuest = await browser.newContext({ viewport: { width: 1400, height: 1000 } }); // no auth at all
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const pageGuest = await ctxGuest.newPage();
  const errors = { A: [], B: [], Guest: [] };
  for (const [label, page] of [["A", pageA], ["B", pageB], ["Guest", pageGuest]]) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors[label].push(msg.text());
    });
    page.on("pageerror", (err) => errors[label].push(String(err)));
  }

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: A registers and creates a real org");
  await register(pageA, "Brand Owner", `brandA${suffix}`, `brandA${suffix}@arutech.dev`);
  await pageA.goto(`${BASE}/organizations`, { waitUntil: "networkidle" });
  await pageA.click('button:has-text("New organization")');
  await pageA.fill('input[placeholder="Acme Inc."]', `Custom Theme Co ${suffix}`);
  await pageA.click('button:has-text("Create")');
  await pageA.waitForURL("**/organizations/*", { timeout: 15000 });
  const orgId = new URL(pageA.url()).pathname.split("/").pop();
  console.log("orgId:", orgId);

  console.log("STEP: A (owner) sets real branding through the real settings UI");
  await pageA.getByRole("heading", { name: "Branding", exact: true }).waitFor({ timeout: 10000 });
  await shot(pageA, "a-branding-section-default");
  await pageA.fill('input[placeholder="https://example.com/logo.png"]', LOGO_DATA_URI);
  // Two inputs read/write brandColor (the native color picker + the hex text
  // field) — fill the text one, which is what a real hex value is entered
  // through in practice.
  await pageA.fill('input[placeholder="#3B6FE0"]', BRAND_COLOR);
  await pageA.fill('textarea[placeholder^="Welcome"]', JOIN_MESSAGE);
  await pageA.click('button:has-text("Save branding")');
  await pageA.waitForSelector("text=Saved.", { timeout: 10000 });
  await shot(pageA, "a-branding-saved");

  console.log("STEP: branding survives a reload — genuinely persisted, not just local state");
  await pageA.reload({ waitUntil: "networkidle" });
  const logoValAfterReload = await pageA.inputValue('input[placeholder="https://example.com/logo.png"]');
  const colorValAfterReload = await pageA.inputValue('input[placeholder="#3B6FE0"]');
  const msgValAfterReload = await pageA.inputValue('textarea[placeholder^="Welcome"]');
  console.log("LOGO_PERSISTED (should be true):", logoValAfterReload === LOGO_DATA_URI);
  console.log("COLOR_PERSISTED (should be true):", colorValAfterReload.toLowerCase() === BRAND_COLOR);
  console.log("MESSAGE_PERSISTED (should be true):", msgValAfterReload === JOIN_MESSAGE);
  if (logoValAfterReload !== LOGO_DATA_URI) throw new Error("logoUrl did not persist across reload");
  if (colorValAfterReload.toLowerCase() !== BRAND_COLOR) throw new Error("brandColor did not persist across reload");
  if (msgValAfterReload !== JOIN_MESSAGE) throw new Error("joinPageMessage did not persist across reload");

  console.log("STEP: B registers, is added to the org as a plain MEMBER, and never sees the settings UI");
  const bEmail = `brandB${suffix}@arutech.dev`;
  await register(pageB, "Brand Member", `brandB${suffix}`, bEmail);
  const bUserId = await pageB.evaluate(() => JSON.parse(localStorage.getItem("arutech-auth")).state.user.id);
  const aToken = await pageA.evaluate(() => JSON.parse(localStorage.getItem("arutech-auth")).state.accessToken);
  const bToken = await pageB.evaluate(() => JSON.parse(localStorage.getItem("arutech-auth")).state.accessToken);
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

  await pageB.goto(`${BASE}/organizations/${orgId}`, { waitUntil: "networkidle" });
  const brandingHeadingForB = await pageB.getByRole("heading", { name: "Branding", exact: true }).count();
  console.log("B_SEES_BRANDING_SECTION (should be 0 — member, not owner/admin):", brandingHeadingForB);
  if (brandingHeadingForB !== 0) throw new Error("A plain MEMBER should not see the Branding settings section");

  const bPatchStatus = await pageB.evaluate(
    async ({ token, orgId }) => {
      const res = await fetch(`http://localhost:4000/api/v1/organizations/${orgId}/branding`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ brandColor: "#000000" }),
      });
      return res.status;
    },
    { token: bToken, orgId },
  );
  console.log("B_DIRECT_PATCH_BRANDING_STATUS (should be 403):", bPatchStatus);
  if (bPatchStatus !== 403) throw new Error(`Expected 403 for a MEMBER PATCHing branding, got ${bPatchStatus}`);

  console.log("STEP: A creates a real org-scoped meeting (no click-through org picker yet — same accepted gap as Stage 28/29, direct API call)");
  const orgMeetingCode = await pageA.evaluate(
    async ({ token, orgId }) => {
      const res = await fetch("http://localhost:4000/api/v1/meetings", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Branded meeting", type: "INSTANT", timezone: "UTC", orgId }),
      });
      const body = await res.json();
      return body.code;
    },
    { token: aToken, orgId },
  );
  console.log("orgMeetingCode:", orgMeetingCode);

  console.log("=== A genuinely unauthenticated guest opens the branded meeting's join screen ===");
  await pageGuest.goto(`${BASE}/meeting/${orgMeetingCode}`, { waitUntil: "networkidle" });
  await pageGuest.waitForSelector("button.lk-join-button", { timeout: 15000 });
  const guestSeesLogo = await pageGuest.locator(`img[src="${LOGO_DATA_URI}"]`).count();
  const guestSeesMessage = await pageGuest.locator(`text=${JOIN_MESSAGE}`).count();
  const joinButtonColor = await pageGuest.locator("button.lk-join-button").evaluate((el) => getComputedStyle(el).backgroundColor);
  console.log("GUEST_SEES_LOGO (should be 1):", guestSeesLogo);
  console.log("GUEST_SEES_MESSAGE (should be 1):", guestSeesMessage);
  console.log("GUEST_JOIN_BUTTON_COLOR (should be", BRAND_COLOR_RGB, "):", joinButtonColor);
  await shot(pageGuest, "guest-sees-branded-join-screen");
  if (guestSeesLogo !== 1) throw new Error("Guest should see the org's real logo on a branded meeting's join screen");
  if (guestSeesMessage !== 1) throw new Error("Guest should see the org's real join-page message");
  if (joinButtonColor !== BRAND_COLOR_RGB) {
    throw new Error(`Join button should render in the org's brand color ${BRAND_COLOR_RGB}, got ${joinButtonColor}`);
  }

  console.log("=== Negative case: A's own unbranded personal instant meeting, real UI, default accent untouched ===");
  await pageA.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await pageA.click('text=New meeting');
  await pageA.waitForURL("**/meeting/**", { timeout: 15000 });
  await pageA.waitForSelector("button.lk-join-button", { timeout: 15000 });
  const unbrandedLogoCount = await pageA.locator("img[alt$=logo]").count();
  const unbrandedButtonColor = await pageA.locator("button.lk-join-button").evaluate((el) => getComputedStyle(el).backgroundColor);
  console.log("UNBRANDED_LOGO_COUNT (should be 0):", unbrandedLogoCount);
  console.log("UNBRANDED_JOIN_BUTTON_COLOR (should be", DEFAULT_ACCENT_RGB, "):", unbrandedButtonColor);
  await shot(pageA, "a-unbranded-personal-meeting-default-accent");
  if (unbrandedLogoCount !== 0) throw new Error("A personal (non-org) meeting should show no org logo");
  if (unbrandedButtonColor !== DEFAULT_ACCENT_RGB) {
    throw new Error(`Unbranded meeting's join button should stay the app default ${DEFAULT_ACCENT_RGB}, got ${unbrandedButtonColor}`);
  }

  console.log("CONSOLE_ERRORS_A_START");
  for (const e of errors.A) console.log("  A:", e);
  console.log("CONSOLE_ERRORS_A_END", `(${errors.A.length} total)`);
  console.log("CONSOLE_ERRORS_B_START");
  for (const e of errors.B) console.log("  B:", e);
  console.log("CONSOLE_ERRORS_B_END", `(${errors.B.length} total)`);
  console.log("CONSOLE_ERRORS_GUEST_START");
  for (const e of errors.Guest) console.log("  Guest:", e);
  console.log("CONSOLE_ERRORS_GUEST_END", `(${errors.Guest.length} total)`);

  await browser.close();
  console.log("DONE");
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
