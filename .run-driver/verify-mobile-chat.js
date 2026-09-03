// Verifies the Team Chat two-pane layout collapses to a single pane on
// mobile (was a broken near-empty sliver squeezed beside a fixed 288px
// list) with a working back button, and that visiting /chat with existing
// conversations shows the LIST first rather than auto-jumping into one.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "mobile-chat");
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
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const ctxA = await browser.newContext({ viewport: { width: 375, height: 667 } });
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

  console.log("STEP: register both users");
  await register(a, "Mobile Chat A", `mchata${suffix}`, `mchata${suffix}@arutech.dev`);
  await register(b, "Mobile Chat B", `mchatb${suffix}`, `mchatb${suffix}@arutech.dev`);

  console.log("STEP: create a real DM room directly via the API (skips the contacts-via-shared-meeting dependency, which needs a real LiveKit webhook this local setup doesn't reliably fire) — same POST /chat-rooms the New Chat modal itself calls");
  const [aAuth, bAuth] = await Promise.all(
    [a, b].map((p) =>
      p.evaluate(() => JSON.parse(localStorage.getItem("arutech-auth") || "{}").state),
    ),
  );
  const room = await a.evaluate(
    async ({ token, otherUserId }) => {
      const res = await fetch("http://localhost:4000/api/v1/chat-rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: "DIRECT", memberUserIds: [otherUserId] }),
      });
      return res.json();
    },
    { token: aAuth.accessToken, otherUserId: bAuth.user.id },
  );
  console.log("CREATED_ROOM_ID:", room.id);

  console.log("STEP: A (mobile) opens that DM directly via a deep link — a real 'go to this conversation' intent, should open straight into it");
  await a.goto(`http://localhost:3000/chat?room=${room.id}`, { waitUntil: "networkidle" });
  await a.waitForTimeout(600);

  console.log("STEP: deep link should show the conversation directly, not the list — message pane visible, back button present");
  await shot(a, "01-dm-just-created-shows-conversation");
  const composerVisible = await a.locator('textarea, input[placeholder*="essage" i]').first().isVisible().catch(() => false);
  console.log("MESSAGE_COMPOSER_VISIBLE (expect true):", composerVisible);
  if (!composerVisible) pass = false;
  const backBtn = a.locator('button[aria-label="Back to conversations"]');
  const backBtnVisible = await backBtn.isVisible().catch(() => false);
  console.log("BACK_BUTTON_VISIBLE (expect true):", backBtnVisible);
  if (!backBtnVisible) pass = false;

  console.log("STEP: tap Back — should show the list, hide the conversation");
  await backBtn.click();
  await a.waitForTimeout(300);
  await shot(a, "02-tapped-back-shows-list");
  const listHeaderVisible = await a.getByRole("heading", { name: "Team Chat" }).isVisible();
  const composerStillVisible = await a
    .locator('textarea, input[placeholder*="essage" i]')
    .first()
    .isVisible()
    .catch(() => false);
  console.log("LIST_HEADER_VISIBLE_AFTER_BACK (expect true):", listHeaderVisible);
  console.log("COMPOSER_HIDDEN_AFTER_BACK (expect false):", composerStillVisible);
  if (!listHeaderVisible || composerStillVisible) pass = false;

  console.log("STEP: reload /chat fresh (no ?room= override this time, but a room now exists) — must show the LIST first, not auto-jump into the DM");
  await a.goto("http://localhost:3000/chat", { waitUntil: "networkidle" });
  await a.waitForTimeout(600);
  await shot(a, "03-reload-shows-list-not-auto-opened-dm");
  const listVisibleOnLoad = await a.getByRole("heading", { name: "Team Chat" }).isVisible();
  const composerVisibleOnLoad = await a
    .locator('textarea, input[placeholder*="essage" i]')
    .first()
    .isVisible()
    .catch(() => false);
  console.log("LIST_VISIBLE_ON_FRESH_LOAD (expect true):", listVisibleOnLoad);
  console.log("COMPOSER_VISIBLE_ON_FRESH_LOAD (expect false -- shouldn't auto-jump into a DM on mobile):", composerVisibleOnLoad);
  if (!listVisibleOnLoad || composerVisibleOnLoad) pass = false;

  console.log("STEP: tapping the conversation in the list opens it (single pane again)");
  await a.click("text=Mobile Chat B");
  await a.waitForTimeout(400);
  await shot(a, "04-tapped-conversation-opens-it");
  const composerAfterTap = await a
    .locator('textarea, input[placeholder*="essage" i]')
    .first()
    .isVisible()
    .catch(() => false);
  console.log("COMPOSER_VISIBLE_AFTER_TAPPING_ROOM (expect true):", composerAfterTap);
  if (!composerAfterTap) pass = false;

  console.log("STEP: no console/page errors happened during any of this");
  console.log("CONSOLE_ERRORS:", JSON.stringify(errors));
  if (errors.length > 0) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
