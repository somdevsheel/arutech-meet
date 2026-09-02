// Verifies CS-4: photo and voice messages couldn't be forwarded, with no
// visible reason given. The restriction itself is real and intentional
// (ChatService.forwardMessage requires a text body — an attachment's
// download permissions are scoped to its original room) and the button
// was correctly hidden rather than erroring, but nothing explained WHY the
// option was simply missing for these messages and no others.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const API = "http://localhost:4000/api/v1";
const shotDir = path.join(__dirname, "screenshots", "attachment-forward-explanation");
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
  const scratchDir = "/tmp/claude-1000/-home-somdevsheel-Project-Indium-by-Arutech/5949e38b-db83-4095-9aa1-19d673a40439/scratchpad";
  const photoPath = path.join(scratchDir, "cs4-test-photo.png");
  let pass = true;

  console.log("STEP: set up a real user with a real GROUP room to post an attachment in");
  const me = await registerViaApi("CS4 QA", `cs4qa${suffix}`, `cs4qa${suffix}@arutech.dev`);
  const other = await registerViaApi("CS4 Other", `cs4other${suffix}`, `cs4other${suffix}@arutech.dev`);
  const room = await api(me.accessToken, "/chat-rooms", {
    method: "POST",
    body: JSON.stringify({ type: "GROUP", name: `CS-4 QA Room ${suffix}`, memberUserIds: [other.user.id] }),
  });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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
  }, me);
  await page.goto(`http://localhost:3000/chat?room=${room.id}`, { waitUntil: "networkidle" });

  console.log("STEP: send a real TEXT message first — its Forward control must be a real, working button");
  await page.fill('input[placeholder="Type a message…"]', "A real text message");
  await page.click('button:has-text("Send")');
  await page.waitForSelector("text=A real text message", { timeout: 8000 });
  await page.hover("text=A real text message");
  const textForwardButton = page.locator(".group", { has: page.locator("text=A real text message") }).locator("button:has-text('Forward')");
  const textForwardIsButton = await textForwardButton.count();
  console.log("TEXT_MESSAGE_HAS_REAL_FORWARD_BUTTON (expect >=1 — no regression):", textForwardIsButton);
  if (textForwardIsButton < 1) pass = false;

  console.log("STEP: send a real PHOTO attachment — its Forward control must now explain why it's unavailable, not be missing outright");
  await page.setInputFiles('input[type="file"]', photoPath);
  await page.waitForTimeout(1500); // real upload round-trip
  const attachmentMessage = page.locator(".group").filter({ hasNot: page.locator("text=A real text message") }).last();
  await attachmentMessage.hover();
  await shot(page, "01-photo-message-hovered");

  const disabledForwardSpan = attachmentMessage.locator("span:has-text('Forward')");
  const disabledCount = await disabledForwardSpan.count();
  console.log("PHOTO_MESSAGE_SHOWS_DISABLED_FORWARD_WITH_EXPLANATION (expect >=1 — this is the actual CS-4 fix):", disabledCount);
  if (disabledCount < 1) pass = false;

  const tooltipText = disabledCount > 0 ? await disabledForwardSpan.first().getAttribute("title") : null;
  console.log("TOOLTIP_TEXT:", tooltipText);
  const explainsWhy = !!tooltipText && /photo|voice|text/i.test(tooltipText);
  console.log("TOOLTIP_ACTUALLY_EXPLAINS_WHY (expect true):", explainsWhy);
  if (!explainsWhy) pass = false;

  const stillNoRealButton = await attachmentMessage.locator("button:has-text('Forward')").count();
  console.log("PHOTO_MESSAGE_HAS_NO_REAL_CLICKABLE_FORWARD_BUTTON (expect 0 — the restriction itself is unchanged):", stillNoRealButton);
  if (stillNoRealButton !== 0) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
