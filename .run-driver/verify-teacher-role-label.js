// Verifies CS-2: a teacher running their OWN class session was labeled
// "HOST" instead of "TEACHER" — the class-session TEACHER/STUDENT role
// lookup was gated on `!isOwner`, so the teacher who actually started the
// session (the single most common case, since createSession makes them the
// meeting's owner) never reached it. Purely a label mismatch — HOST and
// TEACHER are both full moderators, nothing behaved differently.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const API = "http://localhost:4000/api/v1";
const shotDir = path.join(__dirname, "screenshots", "teacher-role-label");
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
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("STEP: a real teacher creates their own class + class session (they become the meeting's owner)");
  const teacher = await registerViaApi("CS2 UI Teacher", `cs2uiteacher${suffix}`, `cs2uiteacher${suffix}@arutech.dev`);
  const klass = await api(teacher.accessToken, "/classes", { method: "POST", body: JSON.stringify({ title: `CS-2 QA Class ${suffix}` }) });
  const session = await api(teacher.accessToken, `/classes/${klass.id}/sessions`, { method: "POST", body: JSON.stringify({}) });

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await loginAs(ctx, teacher);

  console.log("STEP: the teacher joins their OWN class session and opens the Participants panel");
  await page.goto(`http://localhost:3000/meeting/${session.meeting.code}`, { waitUntil: "networkidle" });
  await page.click('button:has-text("Join meeting")');
  await page.waitForSelector("footer", { timeout: 15000 });
  await page.click('button:has-text("Participants")');
  await page.waitForSelector(`text=CS2 UI Teacher`, { timeout: 8000 });
  await shot(page, "01-teacher-labeled-in-own-class-session");

  const row = await page.locator('[aria-label^="Participant row: CS2 UI Teacher"]').textContent();
  console.log("PARTICIPANT_ROW_TEXT:", row);
  const labeledTeacher = /TEACHER/.test(row);
  const labeledHost = /\bHOST\b/.test(row);
  console.log("LABELED_TEACHER (expect true — this is the actual CS-2 fix):", labeledTeacher);
  console.log("LABELED_HOST (expect false):", labeledHost);
  if (!labeledTeacher || labeledHost) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
