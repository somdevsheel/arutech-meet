// Verifies M-4: the Attendance page's initial load and Recompute both had no
// error handling at all — a non-member's 403 (or a non-teacher member's
// teacher-only Recompute) failed silently, leaving a misleading empty table
// ("No attendance data yet — click Recompute") instead of the real error
// Export CSV already showed correctly for the exact same permission check.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const API = "http://localhost:4000/api/v1";
const shotDir = path.join(__dirname, "screenshots", "attendance-errors");
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
  return res.json(); // { user, accessToken, refreshToken }
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

/** Logs a real, previously-registered user into a fresh browser context by
 * writing zustand persist's own on-disk shape directly, rather than driving
 * the login form — this test's point is what three DIFFERENT signed-in users
 * each see on one URL, not the login flow itself (already covered by other
 * drivers). */
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

  console.log("STEP: set up real state via the real API — a teacher, an enrolled student, and an outsider");
  const teacher = await registerViaApi("Attendance Teacher", `attteacher${suffix}`, `attteacher${suffix}@arutech.dev`);
  const student = await registerViaApi("Attendance Student", `attstudent${suffix}`, `attstudent${suffix}@arutech.dev`);
  const outsider = await registerViaApi("Attendance Outsider", `attoutsider${suffix}`, `attoutsider${suffix}@arutech.dev`);

  const klass = await api(teacher.accessToken, "/classes", {
    method: "POST",
    body: JSON.stringify({ title: `M-4 QA Class ${suffix}` }),
  });
  await api(teacher.accessToken, `/classes/${klass.id}/students`, {
    method: "POST",
    body: JSON.stringify({ userId: student.user.id }),
  });
  const session = await api(teacher.accessToken, `/classes/${klass.id}/sessions`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  const attendanceUrl = `http://localhost:3000/classes/${klass.id}/sessions/${session.id}/attendance`;
  console.log("Class/session set up:", klass.id, session.id);

  console.log("STEP: an OUTSIDER (not enrolled at all) opens the attendance page directly");
  const outsiderCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const outsiderPage = await loginAs(outsiderCtx, outsider);
  await outsiderPage.goto(attendanceUrl, { waitUntil: "networkidle" });
  await outsiderPage.waitForTimeout(1000);
  await shot(outsiderPage, "01-outsider-attendance-page");

  const outsiderMisleadingEmptyState = await outsiderPage
    .locator("text=/No attendance data yet/i")
    .count();
  const outsiderRealError = await outsiderPage.locator("text=/not a member of this class/i").count();
  console.log("OUTSIDER_SEES_MISLEADING_EMPTY_STATE (expect 0):", outsiderMisleadingEmptyState);
  console.log("OUTSIDER_SEES_REAL_ERROR 'Not a member of this class' (expect >=1):", outsiderRealError);
  if (outsiderMisleadingEmptyState !== 0 || outsiderRealError < 1) pass = false;

  console.log("STEP: an enrolled STUDENT (member, not a teacher) opens the page — list loads fine...");
  const studentCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const studentPage = await loginAs(studentCtx, student);
  await studentPage.goto(attendanceUrl, { waitUntil: "networkidle" });
  await studentPage.waitForTimeout(500);
  const studentSeesLegitimateEmptyState = await studentPage
    .locator("text=/No attendance data yet/i")
    .count();
  console.log("STUDENT_SEES_LEGITIMATE_EMPTY_TABLE (expect >=1 — real state, not an error):", studentSeesLegitimateEmptyState);
  if (studentSeesLegitimateEmptyState < 1) pass = false;

  console.log("STEP: ...but clicking Recompute (teacher-only) must show the real error, not fail silently");
  await studentPage.click('button:has-text("Recompute")');
  await studentPage.waitForTimeout(1000);
  await shot(studentPage, "02-student-recompute-rejected");
  const studentRecomputeError = await studentPage
    .locator("text=/only a teacher of this class can do that/i")
    .count();
  console.log("STUDENT_SEES_RECOMPUTE_REAL_ERROR (expect >=1):", studentRecomputeError);
  if (studentRecomputeError < 1) pass = false;

  console.log("STEP: the actual TEACHER opens the page and Recompute works normally (no regression)");
  const teacherCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const teacherPage = await loginAs(teacherCtx, teacher);
  await teacherPage.goto(attendanceUrl, { waitUntil: "networkidle" });
  await teacherPage.click('button:has-text("Recompute")');
  await teacherPage.waitForTimeout(1000);
  await shot(teacherPage, "03-teacher-recompute-works");
  const teacherError = await teacherPage.locator("text=/only a teacher|not a member/i").count();
  console.log("TEACHER_SEES_NO_ERROR (expect 0):", teacherError);
  if (teacherError !== 0) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
