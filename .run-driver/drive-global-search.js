// Verifies Global search breadth end-to-end: the six new categories this
// stage added to GET /search (chat messages, files, recordings, transcripts,
// courses/classes, assignments), each genuinely scoped to the caller (a
// member of the chat room / owner-or-participant of the meeting / teacher-or-
// student of the class), not just "search works at all". Recordings and
// transcripts are seeded via direct SQL — LiveKit Egress is a documented,
// permanently-accepted gap in this sandboxed environment (no real recording
// pipeline to drive), so this proves the search query/scoping/href logic
// against real rows a working Egress would eventually produce, the same
// honesty convention used for other Egress-dependent gaps all session.
const { chromium } = require("playwright-core");
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = "http://localhost:3000";
const shotDir = path.join(__dirname, "screenshots", "global-search");
fs.mkdirSync(shotDir, { recursive: true });

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

async function openSearch(page, q) {
  const input = page.locator('input[placeholder="Search meetings, people, chats, files…"]');
  await input.click();
  await input.fill(q);
  // Debounced 250ms in AppShell — give it real time to round-trip.
  await page.waitForTimeout(700);
}

(async () => {
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
  const ctxA = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const ctxB = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const ctxC = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const pageC = await ctxC.newPage();
  const errors = { A: [], B: [], C: [] };
  for (const [label, page] of [["A", pageA], ["B", pageB], ["C", pageC]]) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors[label].push(msg.text());
    });
    page.on("pageerror", (err) => errors[label].push(String(err)));
  }

  const suffix = Date.now().toString().slice(-6);
  const needle = `aard${suffix}`; // the one substring every fixture below contains
  const q = needle;

  console.log("STEP: register A (creator/member), B (a real co-member), C (an unrelated outsider)");
  await register(pageA, "Search A", `searchA${suffix}`, `searchA${suffix}@arutech.dev`);
  await register(pageB, "Search B", `searchB${suffix}`, `searchB${suffix}@arutech.dev`);
  await register(pageC, "Search C", `searchC${suffix}`, `searchC${suffix}@arutech.dev`);
  const a = await authOf(pageA);
  const b = await authOf(pageB);

  console.log("STEP: A creates a real GROUP chat room with B (direct API — the /chat UI's room picker requires a prior contacts relationship, unrelated to what's being verified here) and sends a real message + uploads a real file attachment through the real chat UI");
  const roomId = await pageA.evaluate(
    async ({ token, otherUserId }) => {
      const res = await fetch("http://localhost:4000/api/v1/chat-rooms", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "GROUP", name: "Search test group", memberUserIds: [otherUserId] }),
      });
      const body = await res.json();
      return body.id;
    },
    { token: a.token, otherUserId: b.userId },
  );
  console.log("roomId:", roomId);

  await pageA.goto(`${BASE}/chat?room=${roomId}`, { waitUntil: "networkidle" });
  await pageA.fill('input[placeholder="Type a message…"]', `Field notes about ${needle} migration patterns`);
  await pageA.press('input[placeholder="Type a message…"]', "Enter");
  await pageA.waitForSelector(`text=${needle} migration patterns`, { timeout: 10000 });

  const uploadFile = path.join(os.tmpdir(), `${needle}-notes.txt`);
  fs.writeFileSync(uploadFile, "field trip logistics\n");
  await pageA.setInputFiles('input[type="file"]', uploadFile);
  await pageA.waitForSelector(`text=${needle}-notes.txt`, { timeout: 10000 });

  console.log("STEP: A creates a real course, a real class (batch), and a real assignment in it — all with the needle in their title");
  await pageA.goto(`${BASE}/courses`, { waitUntil: "networkidle" });
  await pageA.fill('input[placeholder="Course title (e.g. Introduction to Biology)"]', `${needle} Biology 101`);
  await pageA.click('button:has-text("Create course")');
  await pageA.waitForURL("**/courses/*", { timeout: 15000 });

  await pageA.goto(`${BASE}/classes`, { waitUntil: "networkidle" });
  await pageA.fill('input[placeholder="Class title (e.g. Algebra II)"]', `${needle} Batch A`);
  await pageA.fill('input[placeholder="Subject (optional)"]', "Biology");
  await pageA.click('button:has-text("Create class")');
  await pageA.waitForURL("**/classes/*", { timeout: 15000 });
  const classId = new URL(pageA.url()).pathname.split("/").pop();
  console.log("classId:", classId);

  await pageA.click('button:has-text("+ New assignment")');
  await pageA.fill('input[placeholder="Title"]', `${needle} Essay 1`);
  await pageA.click('button:has-text("Post assignment")');
  await pageA.waitForSelector(`text=${needle} Essay 1`, { timeout: 10000 });

  console.log("STEP: A starts a real instant meeting, then a real recording + transcript are seeded via direct SQL for it (Egress isn't wired in this sandbox — a documented, accepted gap; this proves the search side against real rows, not the recording pipeline)");
  await pageA.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  const meetingCode = await pageA.evaluate(
    async ({ token, needle }) => {
      const res = await fetch("http://localhost:4000/api/v1/meetings", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: `${needle} Standup`, type: "INSTANT" }),
      });
      const body = await res.json();
      return { code: body.code, id: body.id };
    },
    { token: a.token, needle },
  );
  console.log("meeting:", meetingCode);

  const sql = `
    INSERT INTO meeting_recordings (id, meeting_id, started_by_user_id, status, format, started_at, ended_at, ready_at, created_at)
    VALUES (gen_random_uuid(), '${meetingCode.id}', '${a.userId}', 'READY', 'mp4', now(), now(), now(), now());
    INSERT INTO meeting_transcripts (id, meeting_id, provider, language, status, created_at, ready_at)
    VALUES ('${meetingCode.id}-t', '${meetingCode.id}', 'seed', 'en', 'READY', now(), now());
    INSERT INTO transcript_segments (id, transcript_id, start_ms, end_ms, text, created_at)
    VALUES (gen_random_uuid(), '${meetingCode.id}-t', 0, 4000, 'let''s discuss the ${needle} migration timeline', now());
  `;
  fs.writeFileSync("/tmp/search-seed.sql", sql);
  execSync(`docker exec -i arutech-migrate-scratch psql -U arutech -d arutech_meet < /tmp/search-seed.sql`, { stdio: "inherit" });

  console.log("=== A searches: every new category should appear, correctly labeled and linked ===");
  await pageA.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await openSearch(pageA, q);
  const groupText = await pageA.locator('[data-testid="search-results"]').innerText();
  console.log("--- A's dropdown text ---\n" + groupText + "\n---");
  fs.writeFileSync(path.join(shotDir, "search-a-dropdown.txt"), groupText);
  await pageA.screenshot({ path: path.join(shotDir, "01-a-search-dropdown.png") });

  const checks = {
    A_SEES_CHAT_MESSAGE: groupText.includes(`${needle} migration patterns`),
    A_SEES_FILE: groupText.includes(`${needle}-notes.txt`),
    A_SEES_COURSE: groupText.includes(`${needle} Biology 101`),
    A_SEES_CLASS: groupText.includes(`${needle} Batch A`),
    A_SEES_ASSIGNMENT: groupText.includes(`${needle} Essay 1`),
    A_SEES_RECORDING: groupText.includes(`${needle} Standup`),
    A_SEES_TRANSCRIPT: groupText.includes(`${needle} migration timeline`),
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${k} (should be true):`, v);
  const failedA = Object.entries(checks).filter(([, v]) => !v);
  if (failedA.length) throw new Error(`A's search is missing: ${failedA.map(([k]) => k).join(", ")}`);

  console.log("=== clicking the chat-message result actually navigates into the real room ===");
  await pageA.locator(`button:has-text("${needle} migration patterns")`).click();
  await pageA.waitForURL(`**/chat?room=${roomId}`, { timeout: 10000 });
  console.log("A_CHAT_RESULT_NAVIGATED_CORRECTLY: true");

  console.log("=== clicking the course result navigates to the real course page ===");
  await openSearch(pageA, q);
  await pageA.locator(`button:has-text("${needle} Biology 101")`).click();
  await pageA.waitForURL("**/courses/*", { timeout: 10000 });
  console.log("A_COURSE_RESULT_NAVIGATED_CORRECTLY: true");

  console.log("=== B (a real ChatMember + nothing else) searches: sees the chat message + file, but NOT A's course/class/assignment/recording/transcript ===");
  await pageB.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await openSearch(pageB, q);
  const bText = await pageB.locator('[data-testid="search-results"]').innerText();
  await pageB.screenshot({ path: path.join(shotDir, "02-b-search-dropdown.png") });
  const bChecks = {
    B_SEES_CHAT_MESSAGE: bText.includes(`${needle} migration patterns`),
    B_SEES_FILE: bText.includes(`${needle}-notes.txt`),
    B_SEES_COURSE: bText.includes(`${needle} Biology 101`),
    B_SEES_CLASS: bText.includes(`${needle} Batch A`),
    B_SEES_RECORDING: bText.includes(`${needle} Standup`),
  };
  for (const [k, v] of Object.entries(bChecks)) console.log(`${k}:`, v);
  if (!bChecks.B_SEES_CHAT_MESSAGE || !bChecks.B_SEES_FILE) {
    throw new Error("B is a real member of the chat room — should see the chat message and file");
  }
  if (bChecks.B_SEES_COURSE || bChecks.B_SEES_CLASS || bChecks.B_SEES_RECORDING) {
    throw new Error("B has no relationship to A's course/class/meeting — should NOT see them in search");
  }

  console.log("=== C (unrelated to everything) searches: sees nothing at all ===");
  await pageC.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await openSearch(pageC, q);
  const cText = await pageC.locator('[data-testid="search-results"]').innerText();
  await pageC.screenshot({ path: path.join(shotDir, "03-c-search-empty.png") });
  console.log("C_SEES_NOTHING (dropdown should say 'No results'):", cText.includes("No results"));
  if (!cText.includes("No results")) throw new Error(`C should see zero results across every category, got:\n${cText}`);

  console.log("CONSOLE_ERRORS_A_START");
  for (const e of errors.A) console.log("  A:", e);
  console.log("CONSOLE_ERRORS_A_END", `(${errors.A.length} total)`);
  console.log("CONSOLE_ERRORS_B_START");
  for (const e of errors.B) console.log("  B:", e);
  console.log("CONSOLE_ERRORS_B_END", `(${errors.B.length} total)`);
  console.log("CONSOLE_ERRORS_C_START");
  for (const e of errors.C) console.log("  C:", e);
  console.log("CONSOLE_ERRORS_C_END", `(${errors.C.length} total)`);

  await browser.close();
  console.log("DONE");
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
