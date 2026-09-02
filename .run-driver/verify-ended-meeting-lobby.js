// Verifies L-2: joining an already-ended meeting used to render the full
// live PreJoin screen (camera/mic/name setup) — only after clicking Join
// did "This meeting has ended" correctly appear, one step later than
// necessary, since the preview fetch already knows the meeting is over.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const API = "http://localhost:4000/api/v1";
const shotDir = path.join(__dirname, "screenshots", "ended-meeting-lobby");
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
  let pass = true;

  console.log("STEP: create a real instant meeting and immediately end it via the real API");
  const host = await registerViaApi("Ended QA Host", `endedhost${suffix}`, `endedhost${suffix}@arutech.dev`);
  const meeting = await api(host.accessToken, "/meetings", {
    method: "POST",
    body: JSON.stringify({ title: `L-2 QA Meeting ${suffix}` }),
  });
  await api(host.accessToken, `/meetings/${meeting.id}/end`, { method: "POST" });
  console.log("Meeting created and ended:", meeting.code);

  const viewer = await registerViaApi("Ended QA Viewer", `endedviewer${suffix}`, `endedviewer${suffix}@arutech.dev`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await loginAs(ctx, viewer);

  console.log("STEP: a fresh visitor opens the ended meeting's link directly");
  await page.goto(`http://localhost:3000/meeting/${meeting.code}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await shot(page, "01-ended-meeting-link-opened");

  const showsEndedImmediately = await page.locator("text=/this meeting has ended/i").count();
  const showsJoinFormWrongly = await page.locator('button:has-text("Join meeting")').count();
  console.log("SHOWS_ENDED_MESSAGE_IMMEDIATELY (expect >=1 — no Join click needed):", showsEndedImmediately);
  console.log("SHOWS_LIVE_JOIN_FORM (expect 0 — this was the actual bug):", showsJoinFormWrongly);
  if (showsEndedImmediately < 1 || showsJoinFormWrongly !== 0) pass = false;

  console.log("STEP: sanity check — a meeting that's still live must still show the normal join form (no regression)");
  const liveMeeting = await api(host.accessToken, "/meetings", {
    method: "POST",
    body: JSON.stringify({ title: `L-2 QA Live Meeting ${suffix}` }),
  });
  await page.goto(`http://localhost:3000/meeting/${liveMeeting.code}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await shot(page, "02-live-meeting-still-shows-join-form");
  const liveShowsJoinForm = await page.locator('button:has-text("Join meeting")').count();
  const liveShowsEndedWrongly = await page.locator("text=/this meeting has ended/i").count();
  console.log("LIVE_MEETING_SHOWS_JOIN_FORM (expect >=1):", liveShowsJoinForm);
  console.log("LIVE_MEETING_WRONGLY_SHOWS_ENDED (expect 0):", liveShowsEndedWrongly);
  if (liveShowsJoinForm < 1 || liveShowsEndedWrongly !== 0) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
