// Verifies Courses end-to-end through the real UI: a teacher creates a
// course, creates two batches (classes) under it from the course detail
// page, enrolls a student into one batch, confirms the student sees the
// course (derived membership, not creation) but cannot add a batch to it,
// confirms a second, unrelated teacher cannot attach a class to someone
// else's course by guessing its id, and confirms the class detail page links
// back up to its course.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "courses");
fs.mkdirSync(shotDir, { recursive: true });
let shotN = 0;
async function shot(page, label) {
  shotN += 1;
  const file = path.join(shotDir, `${String(shotN).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
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

async function getSelf(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("arutech-auth")).state.user);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const ctxT = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxS = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxT2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageT = await ctxT.newPage();
  const pageS = await ctxS.newPage();
  const pageT2 = await ctxT2.newPage();
  const errors = { T: [], S: [] };
  for (const [label, page] of [["T", pageT], ["S", pageS]]) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors[label].push(msg.text());
    });
    page.on("pageerror", (err) => errors[label].push(String(err)));
  }

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register teacher, student, and an unrelated second teacher");
  await register(pageT, "Prof Course", `profc${suffix}`, `profc${suffix}@arutech.dev`);
  await register(pageS, "Stu Course", `stuc${suffix}`, `stuc${suffix}@arutech.dev`);
  await register(pageT2, "Rival Prof", `rival${suffix}`, `rival${suffix}@arutech.dev`);
  const student = await getSelf(pageS);

  console.log("STEP: teacher creates a course through the real UI");
  await pageT.goto("http://localhost:3000/courses", { waitUntil: "networkidle" });
  await shot(pageT, "t-courses-empty");
  await pageT.fill('input[placeholder="Course title (e.g. Introduction to Biology)"]', "Intro to Biology");
  await pageT.fill('input[placeholder="Description (optional)"]', "Foundational biology for first-years");
  await pageT.click('button:has-text("Create course")');
  await pageT.waitForURL("**/courses/**", { timeout: 15000 });
  const courseUrl = pageT.url();
  const courseId = new URL(courseUrl).pathname.split("/").pop();
  console.log("COURSE_ID:", courseId);
  await shot(pageT, "t-course-detail-empty");

  console.log("STEP: teacher creates two batches under the course");
  await pageT.click('button:has-text("+ New batch")');
  await pageT.fill('input[placeholder="Batch title (e.g. Morning cohort — Jan 2026)"]', "Morning cohort");
  await pageT.click('button:has-text("Create batch")');
  await pageT.waitForURL("**/classes/**", { timeout: 15000 });
  const firstBatchUrl = pageT.url();
  await shot(pageT, "t-first-batch-class-page");

  await pageT.goto(courseUrl, { waitUntil: "networkidle" });
  await pageT.click('button:has-text("+ New batch")');
  await pageT.fill('input[placeholder="Batch title (e.g. Morning cohort — Jan 2026)"]', "Evening cohort");
  await pageT.click('button:has-text("Create batch")');
  await pageT.waitForURL("**/classes/**", { timeout: 15000 });
  await shot(pageT, "t-second-batch-class-page");

  console.log("STEP: class detail page links back up to its course");
  const backToCourseLink = pageT.locator(`a[href="/courses/${courseId}"]`);
  const backLinkCount = await backToCourseLink.count();
  console.log("CLASS_LINKS_BACK_TO_COURSE (should be >=1):", backLinkCount);
  if (backLinkCount === 0) throw new Error("Class detail page doesn't link back to its course");

  console.log("STEP: course detail page now shows both batches");
  await pageT.goto(courseUrl, { waitUntil: "networkidle" });
  await shot(pageT, "t-course-with-two-batches");
  const batchCountText = await pageT.locator("text=Batches (2)").count();
  console.log("COURSE_SHOWS_TWO_BATCHES (should be >=1):", batchCountText);
  if (batchCountText === 0) throw new Error("Course detail page doesn't show both batches");

  console.log("STEP: teacher enrolls the student into the first batch");
  const firstBatchId = new URL(firstBatchUrl).pathname.split("/").pop();
  const accessToken = await pageT.evaluate(() => JSON.parse(localStorage.getItem("arutech-auth")).state.accessToken);
  await pageT.evaluate(
    async ({ token, classId, studentId }) => {
      await fetch(`http://localhost:4000/api/v1/classes/${classId}/students`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: studentId }),
      });
    },
    { token: accessToken, classId: firstBatchId, studentId: student.id },
  );

  console.log("STEP: student sees the course (derived from batch membership) but has no + New batch button");
  await pageS.goto("http://localhost:3000/courses", { waitUntil: "networkidle" });
  await shot(pageS, "s-courses-list-derived-membership");
  const studentSeesCourse = await pageS.locator(`a[href="/courses/${courseId}"]`).count();
  console.log("STUDENT_SEES_COURSE_VIA_BATCH_MEMBERSHIP (should be >=1):", studentSeesCourse);
  if (studentSeesCourse === 0) throw new Error("Student, enrolled in a batch of the course, doesn't see the course listed");

  await pageS.goto(courseUrl, { waitUntil: "networkidle" });
  await shot(pageS, "s-course-detail-no-new-batch-button");
  const studentNewBatchBtn = await pageS.locator('button:has-text("+ New batch")').count();
  console.log("STUDENT_CANNOT_ADD_BATCH (should be 0):", studentNewBatchBtn);
  if (studentNewBatchBtn !== 0) throw new Error("A student (non-owner) can see the + New batch control");

  console.log("STEP: a stranger with no relationship to the course gets a real 403, not the page");
  const rivalToken = await pageT2.evaluate(() => JSON.parse(localStorage.getItem("arutech-auth")).state.accessToken);
  const rivalRes = await pageT2.evaluate(
    async ({ token, id }) => {
      const res = await fetch(`http://localhost:4000/api/v1/courses/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.status;
    },
    { token: rivalToken, id: courseId },
  );
  console.log("STRANGER_COURSE_ACCESS_STATUS (should be 403):", rivalRes);
  if (rivalRes !== 403) throw new Error(`Expected 403 for a stranger reading the course, got ${rivalRes}`);

  console.log("STEP: a second teacher cannot attach their own new class to this course by guessing its id");
  const attachRes = await pageT2.evaluate(
    async ({ token, courseId }) => {
      const res = await fetch("http://localhost:4000/api/v1/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: "Hijacked batch", courseId }),
      });
      return res.status;
    },
    { token: rivalToken, courseId },
  );
  console.log("RIVAL_ATTACH_CLASS_TO_COURSE_STATUS (should be 403):", attachRes);
  if (attachRes !== 403) throw new Error(`Expected 403 when a non-owner tries to attach a class to this course, got ${attachRes}`);

  console.log("CONSOLE_ERRORS_T_START");
  for (const e of errors.T) console.log("  T:", e);
  console.log("CONSOLE_ERRORS_T_END", `(${errors.T.length} total)`);
  console.log("CONSOLE_ERRORS_S_START");
  for (const e of errors.S) console.log("  S:", e);
  console.log("CONSOLE_ERRORS_S_END", `(${errors.S.length} total)`);

  await browser.close();
  console.log("DONE");
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
