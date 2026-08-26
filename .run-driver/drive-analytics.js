// Verifies Advanced analytics (feature engagement) end-to-end: real usage of
// six features in a real meeting (whiteboard, polls, quizzes, breakout
// rooms, live captions — all driven through the real UI; recording seeded
// via direct SQL, the same documented, accepted Egress-not-wired-in-this-
// sandbox workaround Stage 26/31 already used) shows up as real numbers on
// a real admin dashboard, not fabricated ones.
const { chromium } = require("playwright-core");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const BASE = "http://localhost:3000";
const shotDir = path.join(__dirname, "screenshots", "analytics");
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

async function authOf(page) {
  return page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("arutech-auth"));
    return { userId: s.state.user.id, token: s.state.accessToken };
  });
}

async function joinMeeting(page, code) {
  await page.goto(`${BASE}/meeting/${code}`, { waitUntil: "networkidle" });
  await page.waitForSelector("button.lk-join-button", { timeout: 15000 });
  await page.click("button.lk-join-button");
  await page.waitForSelector('button:has-text("Leave")', { timeout: 20000 });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const ctxA = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const ctxB = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const ctxAdmin = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const [pageA, pageB, pageAdmin] = await Promise.all([ctxA, ctxB, ctxAdmin].map((c) => c.newPage()));
  const errors = { A: [], B: [] };
  for (const [label, page] of [["A", pageA], ["B", pageB]]) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors[label].push(msg.text());
    });
    page.on("pageerror", (err) => errors[label].push(String(err)));
  }

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register A (moderator), B (participant), and an admin");
  await register(pageA, "Ana A", `anaA${suffix}`, `anaA${suffix}@arutech.dev`);
  await register(pageB, "Ana B", `anaB${suffix}`, `anaB${suffix}@arutech.dev`);
  await register(pageAdmin, "Ana Admin", `anaAdmin${suffix}`, `anaAdmin${suffix}@arutech.dev`);
  const a = await authOf(pageA);
  const admin = await authOf(pageAdmin);

  execSync(`docker exec arutech-migrate-scratch psql -U arutech -d arutech_meet -c "UPDATE users SET system_role='ADMIN' WHERE id='${admin.userId}';"`, { stdio: "inherit" });
  await pageAdmin.evaluate(() => localStorage.clear());
  await pageAdmin.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await pageAdmin.fill('input[type="email"]', `anaAdmin${suffix}@arutech.dev`);
  await pageAdmin.fill('input[type="password"]', "Password123!");
  await pageAdmin.click('button[type="submit"]');
  await pageAdmin.waitForURL("**/dashboard", { timeout: 15000 });

  console.log("STEP: a real meeting, both A and B genuinely join (waiting room off — not what's under test)");
  const meetingCode = await pageA.evaluate(
    async ({ token }) => {
      const res = await fetch("http://localhost:4000/api/v1/meetings", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Analytics test meeting", type: "INSTANT", settings: { waitingRoomEnabled: false } }),
      });
      return (await res.json()).code;
    },
    { token: a.token },
  );
  console.log("meetingCode:", meetingCode);
  await joinMeeting(pageA, meetingCode);
  await joinMeeting(pageB, meetingCode);

  console.log("=== Whiteboard: opening the tab is the real trigger (WhiteboardService.getOrCreate) ===");
  await pageA.click('button:has-text("Tools")');
  await pageA.click('button:has-text("whiteboard")');
  await pageA.waitForTimeout(1000); // let the GET (which creates the row) land
  console.log("A_OPENED_WHITEBOARD: true");

  console.log("=== Polls: A publishes a real poll, B actually votes on it ===");
  await pageA.click('button:has-text("polls")');
  await pageA.fill('input[placeholder="Question"]', "Should we ship this feature?");
  await pageA.fill('input[placeholder="Option 1"]', "Yes");
  await pageA.fill('input[placeholder="Option 2"]', "No");
  await pageA.click('button:has-text("Publish poll")');
  await pageA.waitForSelector("text=Should we ship this feature?", { timeout: 10000 });
  console.log("A_PUBLISHED_POLL: true");

  await pageB.click('button:has-text("Tools")');
  await pageB.click('button:has-text("polls")');
  await pageB.waitForSelector("text=Should we ship this feature?", { timeout: 10000 });
  await pageB.click('button:has-text("Yes")');
  await pageB.click('button:has-text("Submit")');
  console.log("B_VOTED_ON_POLL: true");
  await shot(pageA, "a-poll-published");

  console.log("=== Quiz: A publishes a real question, B actually answers it ===");
  await pageA.click('button:has-text("quiz")');
  await pageA.fill('input[placeholder="Question"]', "What is 2 + 2?");
  await pageA.fill('input[placeholder="Option 1"]', "4");
  await pageA.fill('input[placeholder="Option 2"]', "5");
  await pageA.click('button:has-text("Publish question")');
  await pageA.waitForSelector("text=What is 2 + 2?", { timeout: 10000 });
  console.log("A_PUBLISHED_QUIZ: true");

  await pageB.click('button:has-text("quiz")');
  await pageB.waitForSelector("text=What is 2 + 2?", { timeout: 10000 });
  await pageB.click('button:has-text("4")');
  console.log("B_ANSWERED_QUIZ: true");
  await shot(pageA, "a-quiz-published");

  console.log("=== Breakout rooms: A actually creates real rooms + assignments ===");
  await pageA.click('button:has-text("breakout")');
  await pageA.click('button:has-text("Create & auto-assign")');
  await pageA.waitForSelector("text=Rooms already open", { timeout: 10000 });
  console.log("A_CREATED_BREAKOUT_ROOMS: true");
  await shot(pageA, "a-breakout-rooms-created");

  console.log("=== Live captions: A actually starts them — dispatches to the real running transcription-agent worker ===");
  await pageA.click('button:has-text("Captions")');
  await pageA.waitForSelector('button:has-text("Stop captions")', { timeout: 15000 });
  console.log("A_STARTED_CAPTIONS: true");
  await shot(pageA, "a-captions-started");

  console.log("STEP: recording seeded via direct SQL — Egress isn't wired in this sandboxed LiveKit --dev instance, the same documented, accepted gap as Stage 26/31");
  execSync(
    `docker exec arutech-migrate-scratch psql -U arutech -d arutech_meet -c "INSERT INTO meeting_recordings (id, meeting_id, started_by_user_id, status, format, started_at, ready_at, created_at) VALUES (gen_random_uuid(), (SELECT id FROM meetings WHERE code='${meetingCode}'), '${a.userId}', 'READY', 'mp4', now(), now(), now());"`,
    { stdio: "inherit" },
  );

  console.log("=== Admin reviews the real Feature engagement dashboard ===");
  await pageAdmin.goto(`${BASE}/admin/analytics`, { waitUntil: "networkidle" });
  await pageAdmin.waitForSelector("text=Feature engagement", { timeout: 10000 });
  const pageText = await pageAdmin.locator("body").innerText();
  console.log("--- analytics page text ---\n" + pageText + "\n---");
  await shot(pageAdmin, "admin-analytics-dashboard");

  const checks = {
    WHITEBOARD_SHOWS_USAGE: /Whiteboard[\s\S]{0,80}[1-9]\d*%/.test(pageText),
    POLLS_SHOW_USAGE: /Polls[\s\S]{0,200}[1-9]\d* published, [1-9]\d* responses/.test(pageText),
    QUIZZES_SHOW_USAGE: /Quizzes[\s\S]{0,200}[1-9]\d* published, [1-9]\d* answers/.test(pageText),
    BREAKOUT_SHOWS_USAGE: /Breakout rooms[\s\S]{0,200}room(s)? created/.test(pageText),
    RECORDING_SHOWS_USAGE: /Recording[\s\S]{0,80}[1-9]\d*%/.test(pageText),
    CAPTIONS_SHOW_USAGE: /Live captions[\s\S]{0,200}[1-9]\d* starts?/.test(pageText),
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${k} (should be true):`, v);
  if (Object.values(checks).some((v) => !v)) throw new Error(`Analytics dashboard missing expected content:\n${pageText}`);

  console.log("STEP: the day-window selector actually re-fetches with the new window");
  const [analyticsReq] = await Promise.all([
    pageAdmin.waitForResponse((r) => r.url().includes("/admin/analytics") && r.url().includes("days=7")),
    pageAdmin.click('button:has-text("7d")'),
  ]);
  console.log("WINDOW_SWITCH_REFETCHED_STATUS (should be 200):", analyticsReq.status());
  if (analyticsReq.status() !== 200) throw new Error(`Expected 200 refetching analytics for a new window, got ${analyticsReq.status()}`);

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
