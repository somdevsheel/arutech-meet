// Verifies all three quiz question types end-to-end through the real UI with
// two real participants in a real meeting: True/False, Short Answer (both
// new), and Multiple Choice (regression check on the pre-existing type).
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "quiz-types");
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
  const ctxT = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxS = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageT = await ctxT.newPage();
  const pageS = await ctxS.newPage();
  const errors = { T: [], S: [] };
  for (const [label, page] of [["T", pageT], ["S", pageS]]) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors[label].push(msg.text());
    });
    page.on("pageerror", (err) => errors[label].push(String(err)));
  }

  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register teacher (T) and student (S)");
  await register(pageT, "Quiz Teacher", `quizt${suffix}`, `quizt${suffix}@arutech.dev`);
  await register(pageS, "Quiz Student", `quizs${suffix}`, `quizs${suffix}@arutech.dev`);

  console.log("STEP: T creates an instant meeting, S joins");
  await pageT.click("text=New meeting");
  await pageT.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingCode = new URL(pageT.url()).pathname.split("/").pop();
  await pageT.click('button:has-text("Join meeting")');
  await pageT.waitForSelector("footer", { timeout: 15000 });

  await pageS.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await pageS.click('button:has-text("Join meeting")', { timeout: 15000 });
  await pageS.waitForTimeout(2000);
  const admitBtn = pageT.locator('button:has-text("Admit")');
  try {
    await admitBtn.first().waitFor({ timeout: 8000 });
    await admitBtn.first().click();
  } catch {
    console.log("No Admit button — S may not have needed admission");
  }
  await pageS.waitForSelector("footer", { timeout: 15000 });
  await pageT.waitForTimeout(1000);

  console.log("STEP: both open Tools > quiz");
  await pageT.click('button:has-text("Tools")');
  await pageT.click("text=quiz");
  await pageS.click('button:has-text("Tools")');
  await pageS.click("text=quiz");
  await pageT.waitForTimeout(500);

  // ---------------------------------------------------------------------
  console.log("=== TRUE_FALSE ===");
  await pageT.click('button:has-text("True / False")');
  await pageT.fill('input[placeholder="Question"]', "The sky is blue");
  await pageT.click('button:has-text("Correct answer: True")');
  await pageT.click('button:has-text("Publish question")');
  await pageT.waitForTimeout(800);
  await shot(pageT, "01-t-truefalse-published");

  await pageS.waitForTimeout(800);
  await shot(pageS, "02-s-truefalse-question");
  const tfOptions = await pageS.locator('button:has-text("True"), button:has-text("False")').allTextContents();
  console.log("STUDENT_SEES_TRUEFALSE_OPTIONS:", tfOptions);
  if (!tfOptions.some((t) => t.trim() === "True") || !tfOptions.some((t) => t.trim() === "False")) {
    throw new Error("Student did not see both True/False options");
  }
  await pageS.click('button:has-text("True")');
  await pageS.waitForTimeout(500);
  await shot(pageS, "03-s-truefalse-answered-correct");
  const tfCorrectText = await pageS.locator("text=Correct!").count();
  console.log("STUDENT_TRUEFALSE_MARKED_CORRECT (should be >=1):", tfCorrectText);
  if (tfCorrectText === 0) throw new Error("Student's correct True/False answer wasn't marked correct");

  await pageT.click('button:has-text("Close & show results")');
  await pageT.waitForTimeout(800);
  await shot(pageT, "04-t-truefalse-closed-leaderboard");
  const tfLeaderboard = await pageT.locator("text=Quiz Student").count();
  console.log("TRUEFALSE_LEADERBOARD_SHOWS_STUDENT (should be >=1):", tfLeaderboard);
  if (tfLeaderboard === 0) throw new Error("Leaderboard doesn't show the student after True/False closed");

  // ---------------------------------------------------------------------
  console.log("=== SHORT_ANSWER ===");
  await pageT.click('button:has-text("Short answer")');
  await pageT.fill('input[placeholder="Question"]', "Capital of France?");
  await pageT.fill('input[placeholder="Correct answer (exact match, case-insensitive)"]', "Paris");
  await pageT.click('button:has-text("Publish question")');
  await pageT.waitForTimeout(800);
  await shot(pageT, "05-t-shortanswer-published");

  await pageS.waitForTimeout(800);
  await shot(pageS, "06-s-shortanswer-question");
  await pageS.fill('input[placeholder="Your answer…"]', "  pARIS  "); // deliberately messy case/whitespace
  await pageS.click('button:has-text("Submit")');
  await pageS.waitForTimeout(500);
  await shot(pageS, "07-s-shortanswer-answered-correct");
  const saCorrectText = await pageS.locator("text=Correct!").count();
  console.log("STUDENT_SHORTANSWER_CASE_INSENSITIVE_MATCH (should be >=1):", saCorrectText);
  if (saCorrectText === 0) throw new Error("Case-insensitive/trimmed short-answer match wasn't graded correct");

  await pageT.click('button:has-text("Close & show results")');
  await pageT.waitForTimeout(800);
  await shot(pageT, "08-t-shortanswer-closed-reveals-answer");
  const revealText = await pageT.locator("text=Correct answer: Paris").count();
  console.log("SHORTANSWER_REVEALS_CORRECT_TEXT_ON_CLOSE (should be >=1):", revealText);
  if (revealText === 0) throw new Error("Closing didn't reveal the correct short-answer text");

  // ---------------------------------------------------------------------
  console.log("=== MULTIPLE_CHOICE (regression) ===");
  await pageT.click('button:has-text("Multiple choice")');
  await pageT.fill('input[placeholder="Question"]', "2 + 2 = ?");
  const mcqOptionInputs = pageT.locator('input[placeholder^="Option "]');
  await mcqOptionInputs.nth(0).fill("3");
  await mcqOptionInputs.nth(1).fill("4");
  await mcqOptionInputs.nth(2).fill("5");
  const radios = pageT.locator('input[type="radio"][name="correct"]');
  await radios.nth(1).check();
  await pageT.click('button:has-text("Publish question")');
  await pageT.waitForTimeout(800);
  await shot(pageT, "09-t-mcq-published");

  await pageS.waitForTimeout(800);
  await pageS.click('button:has-text("4")');
  await pageS.waitForTimeout(500);
  await shot(pageS, "10-s-mcq-answered-correct");
  const mcqCorrectText = await pageS.locator("text=Correct!").count();
  console.log("STUDENT_MCQ_STILL_WORKS (should be >=1):", mcqCorrectText);
  if (mcqCorrectText === 0) throw new Error("Multiple-choice regression: correct answer not marked correct");

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
