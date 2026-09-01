// Verifies the actual bug: TeamChatPanel's initial history fetch (GET
// .../chat-rooms/:id/messages, which the API returns newest-first per
// ChatService.roomHistory's `orderBy: { createdAt: "desc" }`) was set into
// state directly with no `.reverse()` — every sibling chat surface (meeting
// chat-panel.tsx, Team Chat's own chat/page.tsx) reverses this exact same
// response before rendering. A team's chat rendered upside down: newest
// message on top, oldest at the bottom — the opposite of every other chat
// UI in this app and of the universal chat convention.
//
// This script sends several real, distinctly-ordered messages into a real
// Team's chat room, then reloads the page fresh (forcing a brand new
// mount and a fresh history fetch, not just the live socket append path,
// which was never the bug) and asserts the DOM order top-to-bottom is
// chronological — oldest first, newest last.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "team-chat-order");
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
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  const suffix = Date.now().toString().slice(-6);

  console.log(
    "STEP: register a user, create a real org + a real Team (real TEAM-type ChatRoom underneath)",
  );
  await register(page, "Team Order User", `teamorder${suffix}`, `teamorder${suffix}@arutech.dev`);
  const authRes = await fetch("http://localhost:4000/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `teamorder${suffix}@arutech.dev`, password: "Password123!" }),
  });
  const auth = await authRes.json();
  const org = await fetch("http://localhost:4000/api/v1/organizations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.accessToken}` },
    body: JSON.stringify({ name: `Order Test Org ${suffix}` }),
  }).then((r) => r.json());
  const team = await fetch(`http://localhost:4000/api/v1/organizations/${org.id}/teams`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.accessToken}` },
    body: JSON.stringify({ name: `Order Test Team ${suffix}` }),
  }).then((r) => r.json());
  console.log("TEAM_CREATED (expect a real id):", Boolean(team.id));

  console.log("STEP: send 3 distinctly-numbered real messages via the actual UI, in order 1, 2, 3");
  await page.goto(`http://localhost:3000/teams/${team.id}`, { waitUntil: "networkidle" });
  await page.waitForSelector('input[placeholder="Type a message…"]', { timeout: 15000 });
  for (let i = 1; i <= 3; i++) {
    await page.fill('input[placeholder="Type a message…"]', `Order message ${i} of 3`);
    await page.click('button:has-text("Send")');
    await page.waitForTimeout(400);
  }
  await shot(page, "01-sent-three-messages-live");

  console.log(
    "STEP: reload the page fresh — this forces a brand new mount and the actual history-fetch code path under test, not just the live-append path (which was never the bug)",
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector('input[placeholder="Type a message…"]', { timeout: 15000 });
  await page.waitForTimeout(1000);
  await shot(page, "02-after-reload-fresh-history-fetch");

  console.log("STEP: read the actual DOM order of the three messages top-to-bottom");
  const messageTexts = await page.locator("text=/Order message \\d of 3/").allInnerTexts();
  console.log("DOM_ORDER_TOP_TO_BOTTOM:", messageTexts);

  const expectedChronological = [
    "Order message 1 of 3",
    "Order message 2 of 3",
    "Order message 3 of 3",
  ];
  const isChronological = JSON.stringify(messageTexts) === JSON.stringify(expectedChronological);
  console.log(
    "RENDERS_OLDEST_FIRST_NEWEST_LAST (expect true — was reversed/newest-first before the fix):",
    isChronological,
  );

  console.log("CONSOLE_ERRORS_START");
  for (const e of errors) console.log(" ", e);
  console.log("CONSOLE_ERRORS_END", `(${errors.length} total)`);

  const pass = Boolean(team.id) && messageTexts.length === 3 && isChronological;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
