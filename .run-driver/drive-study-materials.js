// Verifies the AI classroom assistant's review/publish/visibility flow
// through the real UI with a real teacher and a real student, in a real
// browser, against a real class already set up via curl in this session
// (data pre-seeded past the OpenAI-key-dependent generation boundary, which
// was independently confirmed for real via curl to return an honest 503 —
// see docs/roadmap.md Stage 21's write-up). This driver logs the teacher and
// student in via their already-issued tokens (localStorage seeding) rather
// than registering fresh, since they need to be the exact same users the
// class/material were created for.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "study-materials");
fs.mkdirSync(shotDir, { recursive: true });
let shotN = 0;
async function shot(page, label) {
  shotN += 1;
  const file = path.join(shotDir, `${String(shotN).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log("SCREENSHOT:", file);
}

const [, , classId, teacherToken, teacherId, studentToken, studentId] = process.argv;
if (!classId || !teacherToken || !studentToken) {
  console.error("Usage: node drive-study-materials.js <classId> <teacherToken> <teacherId> <studentToken> <studentId>");
  process.exit(1);
}

async function loginViaToken(page, token, userId) {
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await page.evaluate(
    ({ token, userId }) => {
      // Fetch the real /auth/me-equivalent user object so localStorage matches
      // exactly what a real login would have stored — not fabricated fields.
      return fetch("http://localhost:4000/api/v1/users/" + userId, {
        headers: { Authorization: "Bearer " + token },
      })
        .then((r) => r.json())
        .then((user) => {
          localStorage.setItem(
            "arutech-auth",
            JSON.stringify({ state: { accessToken: token, refreshToken: null, user }, version: 0 }),
          );
        });
    },
    { token, userId },
  );
  await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const ctxT = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const ctxS = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const pageT = await ctxT.newPage();
  const pageS = await ctxS.newPage();
  const errors = { T: [], S: [] };
  for (const [label, page] of [["T", pageT], ["S", pageS]]) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors[label].push(msg.text());
    });
    page.on("pageerror", (err) => errors[label].push(String(err)));
  }

  console.log("STEP: log both real users in via their real issued tokens");
  await loginViaToken(pageT, teacherToken, teacherId);
  await loginViaToken(pageS, studentToken, studentId);

  console.log("STEP: student opens the class page BEFORE publish — should NOT see the draft material at all");
  await pageS.goto(`http://localhost:3000/classes/${classId}`, { waitUntil: "networkidle" });
  await shot(pageS, "01-s-before-publish");
  const studentSeesDraftTitle = await pageS.locator("text=Cell Biology Basics").count();
  console.log("STUDENT_SEES_DRAFT_BEFORE_PUBLISH (should be 0):", studentSeesDraftTitle);
  if (studentSeesDraftTitle !== 0) throw new Error("Student can see an unpublished draft study material");
  const studentSeesEmptyState = await pageS.locator("text=No study materials yet.").count();
  console.log("STUDENT_SEES_EMPTY_STATE (should be >=1):", studentSeesEmptyState);

  console.log("STEP: teacher opens the class page and sees the DRAFT material");
  await pageT.goto(`http://localhost:3000/classes/${classId}`, { waitUntil: "networkidle" });
  await shot(pageT, "02-t-sees-draft");
  const teacherSeesDraft = await pageT.locator("text=Cell Biology Basics").count();
  console.log("TEACHER_SEES_DRAFT (should be >=1):", teacherSeesDraft);
  if (teacherSeesDraft === 0) throw new Error("Teacher can't see their own draft study material");
  const draftLabel = await pageT.locator("text=Draft — not visible to students").count();
  console.log("TEACHER_SEES_DRAFT_LABEL (should be >=1):", draftLabel);

  console.log("STEP: teacher expands it and reviews all four tabs");
  await pageT.click('button:has-text("View")');
  await pageT.waitForTimeout(500);
  await shot(pageT, "03-t-notes-tab");
  const lectureNotesVisible = await pageT.locator("text=Every cell has a membrane").count();
  console.log("LECTURE_NOTES_RENDERED (should be >=1):", lectureNotesVisible);

  await pageT.click('button:has-text("Flashcards")');
  await pageT.waitForTimeout(300);
  await shot(pageT, "04-t-flashcards-tab");
  const flashcardVisible = await pageT.locator("text=powerhouse of the cell").count();
  console.log("FLASHCARD_CONTENT_RENDERED (should be >=1):", flashcardVisible);

  await pageT.click('button:has-text("Practice")');
  await pageT.waitForTimeout(300);
  await shot(pageT, "05-t-practice-tab");
  const correctOptionMarked = await pageT.locator("text=✓ The powerhouse of the cell").count();
  console.log("PRACTICE_QUESTION_CORRECT_OPTION_MARKED (should be >=1):", correctOptionMarked);
  if (correctOptionMarked === 0) throw new Error("Correct practice-question option not visibly marked for the teacher");

  console.log("STEP: teacher publishes it");
  await pageT.click('button:has-text("Publish to students")');
  await pageT.waitForTimeout(1000);
  await shot(pageT, "06-t-after-publish");
  const publishedLabel = await pageT.locator("text=Published").count();
  console.log("TEACHER_SEES_PUBLISHED_LABEL (should be >=1):", publishedLabel);
  const publishButtonGone = await pageT.locator('button:has-text("Publish to students")').count();
  console.log("PUBLISH_BUTTON_GONE_AFTER_PUBLISH (should be 0):", publishButtonGone);

  console.log("STEP: student reloads and NOW sees it, published, with real content");
  await pageS.reload({ waitUntil: "networkidle" });
  await shot(pageS, "07-s-after-publish-sees-it");
  const studentSeesPublished = await pageS.locator("text=Cell Biology Basics").count();
  console.log("STUDENT_SEES_PUBLISHED_MATERIAL (should be >=1):", studentSeesPublished);
  if (studentSeesPublished === 0) throw new Error("Student still can't see the material after it was published");

  await pageS.click('button:has-text("View")');
  await pageS.waitForTimeout(500);
  await shot(pageS, "08-s-views-content");
  const studentSeesNotes = await pageS.locator("text=Every cell has a membrane").count();
  console.log("STUDENT_SEES_REAL_LECTURE_NOTES (should be >=1):", studentSeesNotes);
  if (studentSeesNotes === 0) throw new Error("Student can't see the actual lecture-notes content");
  const studentSeesNoPublishButton = await pageS.locator('button:has-text("Publish to students")').count();
  console.log("STUDENT_HAS_NO_PUBLISH_CONTROL (should be 0):", studentSeesNoPublishButton);
  if (studentSeesNoPublishButton !== 0) throw new Error("Student (non-teacher) can see the Publish control");

  console.log("STEP: student got a real notification about the new study material");
  const notifBadge = await pageS.locator('[aria-label*="notification" i], .notification-badge, [class*="notif"]').count();
  console.log("NOTIFICATION_UI_PRESENT (informational):", notifBadge);

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
