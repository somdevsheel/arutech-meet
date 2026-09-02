// Verifies L-3: publishing an invalid poll or quiz question was a complete
// no-op — clicking Publish with an empty question or only one option gave
// no error text, no disabled state, nothing telling the user their click
// even registered. Same gap in both Polls and Quiz.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "poll-quiz-feedback");
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("STEP: register + create + join an instant meeting (host = moderator = canCreate)");
  await register(page, "PollQuiz QA", `pollquizqa${suffix}`, `pollquizqa${suffix}@arutech.dev`);
  await page.click("text=New meeting");
  await page.waitForURL("**/meeting/**", { timeout: 15000 });
  await page.click('button:has-text("Join meeting")');
  await page.waitForSelector("footer", { timeout: 15000 });
  await page.click('button:has-text("Tools")');
  await page.waitForSelector('button:has-text("polls")', { timeout: 8000 });

  console.log("=== POLLS ===");
  await page.click('button:has-text("polls")');
  await page.waitForSelector('button:has-text("Publish poll")', { timeout: 8000 });

  console.log("STEP: click Publish with an EMPTY question — must show a real error, not silently no-op");
  await page.click('button:has-text("Publish poll")');
  await page.waitForTimeout(300);
  await shot(page, "01-poll-empty-question-error");
  const pollEmptyError = await page.locator("text=/enter a question/i").count();
  console.log("POLL_EMPTY_QUESTION_ERROR (expect >=1):", pollEmptyError);
  if (pollEmptyError < 1) pass = false;

  console.log("STEP: fill question but only ONE option — must show a different real error");
  await page.fill('input[placeholder="Question"]', "Favorite color?");
  await page.fill('input[placeholder="Option 1"]', "Blue");
  await page.click('button:has-text("Publish poll")');
  await page.waitForTimeout(300);
  await shot(page, "02-poll-one-option-error");
  const pollOneOptionError = await page.locator("text=/at least 2 options/i").count();
  console.log("POLL_ONE_OPTION_ERROR (expect >=1):", pollOneOptionError);
  if (pollOneOptionError < 1) pass = false;

  console.log("STEP: fill a real second option — publishing must actually work now (no regression)");
  await page.fill('input[placeholder="Option 2"]', "Red");
  await page.click('button:has-text("Publish poll")');
  await page.waitForSelector("text=Favorite color?", { timeout: 8000 });
  await shot(page, "03-poll-published-successfully");
  console.log("POLL_PUBLISHED_SUCCESSFULLY: true");

  console.log("=== QUIZ ===");
  await page.click('button:has-text("quiz")');
  await page.waitForSelector('button:has-text("Publish question")', { timeout: 8000 });

  console.log("STEP: click Publish with an EMPTY question — must show a real error");
  await page.click('button:has-text("Publish question")');
  await page.waitForTimeout(300);
  await shot(page, "04-quiz-empty-question-error");
  const quizEmptyError = await page.locator("text=/enter a question/i").count();
  console.log("QUIZ_EMPTY_QUESTION_ERROR (expect >=1):", quizEmptyError);
  if (quizEmptyError < 1) pass = false;

  console.log("STEP: fill question but only ONE multiple-choice option — must show a real error");
  await page.fill('input[placeholder="Question"]', "2 + 2 = ?");
  const quizOptionInputs = page.locator('input[placeholder^="Option "]');
  await quizOptionInputs.nth(0).fill("4");
  await page.click('button:has-text("Publish question")');
  await page.waitForTimeout(300);
  await shot(page, "05-quiz-one-option-error");
  const quizOneOptionError = await page.locator("text=/at least 2 options/i").count();
  console.log("QUIZ_ONE_OPTION_ERROR (expect >=1):", quizOneOptionError);
  if (quizOneOptionError < 1) pass = false;

  console.log("STEP: fill a real second option — publishing must actually work now (no regression)");
  await quizOptionInputs.nth(1).fill("5");
  await page.click('button:has-text("Publish question")');
  await page.waitForSelector("text=2 + 2 = ?", { timeout: 8000 });
  await shot(page, "06-quiz-published-successfully");
  console.log("QUIZ_PUBLISHED_SUCCESSFULLY: true");

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
