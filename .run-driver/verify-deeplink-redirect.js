// Verifies M-9: every protected page's auth guard bounced a signed-out
// visitor to a bare /login, discarding whatever page (and query string —
// e.g. a chat-room deep link) they were actually trying to reach. LoginPage
// already knew how to redirect back to ?redirect=... after signing in;
// nothing ever populated it.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const API = "http://localhost:4000/api/v1";
const shotDir = path.join(__dirname, "screenshots", "deeplink-redirect");
fs.mkdirSync(shotDir, { recursive: true });
let shotN = 0;
async function shot(page, label) {
  shotN += 1;
  const file = path.join(shotDir, `${String(shotN).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file });
  console.log("SCREENSHOT:", file);
}

async function registerViaApi(name, username, email) {
  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Password123", displayName: name, username }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function api(token, path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...opts.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${opts.method ?? "GET"} ${path} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("STEP: set up a real user and a real GROUP chat room to deep-link to");
  const user = await registerViaApi("Deeplink User", `deeplinkuser${suffix}`, `deeplinkuser${suffix}@arutech.dev`);
  const other = await registerViaApi("Deeplink Other", `deeplinkother${suffix}`, `deeplinkother${suffix}@arutech.dev`);
  const room = await api(user.accessToken, "/chat-rooms", {
    method: "POST",
    body: JSON.stringify({ type: "GROUP", name: `M-9 QA Room ${suffix}`, memberUserIds: [other.user.id] }),
  });
  const deepLink = `/chat?room=${room.id}`;

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  console.log("STEP: SIGNED OUT, open the deep link directly");
  await page.goto(`http://localhost:3000${deepLink}`, { waitUntil: "networkidle" });
  await page.waitForURL("**/login**", { timeout: 8000 });
  const loginUrl = new URL(page.url());
  const redirectParam = loginUrl.searchParams.get("redirect");
  console.log("BOUNCED_TO_LOGIN_WITH_REDIRECT (expect the deep link):", redirectParam);
  await shot(page, "01-bounced-to-login-with-redirect-param");
  if (redirectParam !== deepLink) pass = false;

  console.log("STEP: the 'Create one' link on THIS login page must also carry the redirect through");
  const createOneHref = await page.locator('a:has-text("Create one")').getAttribute("href");
  console.log("CREATE_ONE_HREF_CARRIES_REDIRECT:", createOneHref);
  if (!createOneHref || !createOneHref.includes(encodeURIComponent(deepLink))) pass = false;

  console.log("STEP: sign in as the real owner of that room — must land back on the exact deep link, not /dashboard");
  await page.fill('input[type="email"]', `deeplinkuser${suffix}@arutech.dev`);
  await page.fill('input[type="password"]', "Password123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/chat?room=**", { timeout: 15000 });
  await page.waitForTimeout(800);
  console.log("LANDED_ON_URL:", page.url());
  await shot(page, "02-landed-back-on-deep-linked-room");
  const roomSelectedInUi = await page.locator("text=M-9 QA Room").count();
  console.log("DEEP_LINKED_ROOM_ACTUALLY_OPEN (expect >=1):", roomSelectedInUi);
  if (!page.url().includes(`/chat?room=${room.id}`) || roomSelectedInUi < 1) pass = false;

  console.log("STEP: a plain protected page with no query string (e.g. /settings) round-trips too");
  await page.evaluate(() => localStorage.clear());
  await page.goto("http://localhost:3000/settings", { waitUntil: "networkidle" });
  await page.waitForURL("**/login**", { timeout: 8000 });
  const settingsRedirect = new URL(page.url()).searchParams.get("redirect");
  console.log("SETTINGS_REDIRECT_PARAM (expect /settings):", settingsRedirect);
  if (settingsRedirect !== "/settings") pass = false;
  await page.fill('input[type="email"]', `deeplinkuser${suffix}@arutech.dev`);
  await page.fill('input[type="password"]', "Password123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/settings", { timeout: 15000 });
  console.log("LANDED_ON_SETTINGS (expect true):", page.url().endsWith("/settings"));
  await shot(page, "03-landed-back-on-plain-settings-page");
  if (!page.url().endsWith("/settings")) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
