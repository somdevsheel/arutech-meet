// Verifies the actual bug: the attendance "Export CSV" button used a plain
// `fetch(...).then(r => r.blob())` with no `r.ok` check at all — a 401/403
// error response's JSON body is just as valid a sequence of bytes to a
// Blob as a real CSV would be, so it got happily saved to disk as
// "attendance.csv" with zero visible indication anything had gone wrong.
// The file the user ends up with literally contains
// {"error":{"code":"UNAUTHORIZED","message":"..."}} instead of attendance
// data.
//
// A real, legitimate class member (not a synthetic/forced-error stranger)
// loads the attendance page normally — that mount-time fetch succeeds fine
// — then a route interception makes only the export.csv request itself
// come back 401, simulating the exact everyday case named in the finding:
// an access token that expired between opening the page and clicking
// Export. This isolates the export-specific fix precisely, without
// incidental noise from an unrelated page-load failure.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "export-csv-error-not-downloaded");
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

async function login(email) {
  const res = await fetch("http://localhost:4000/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Password123!" }),
  });
  return res.json();
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 950 },
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  let downloadHappened = false;
  page.on("download", () => {
    downloadHappened = true;
  });

  const suffix = Date.now().toString().slice(-6);

  console.log(
    "STEP: register a real teacher, create a real class + session they're genuinely a member of",
  );
  await register(page, "CSV Teacher", `csvteach${suffix}`, `csvteach${suffix}@arutech.dev`);
  const authTeacher = await login(`csvteach${suffix}@arutech.dev`);
  const klass = await fetch("http://localhost:4000/api/v1/classes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authTeacher.accessToken}`,
    },
    body: JSON.stringify({ title: "CSV Export Test Class" }),
  }).then((r) => r.json());
  const session = await fetch(`http://localhost:4000/api/v1/classes/${klass.id}/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authTeacher.accessToken}`,
    },
    body: JSON.stringify({ title: "Session 1" }),
  }).then((r) => r.json());

  console.log(
    "STEP: intercept ONLY the export.csv request and make it come back 401 — simulates a token that expired between page load and clicking Export, the exact case named in the finding",
  );
  await page.route("**/attendance/export.csv", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "UNAUTHORIZED", message: "Access token expired" },
      }),
    }),
  );

  console.log(
    "STEP: the same real teacher loads the attendance page normally — mount fetch succeeds fine, this is a legitimate member",
  );
  await page.goto(`http://localhost:3000/classes/${klass.id}/sessions/${session.id}/attendance`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector("text=Attendance", { timeout: 15000 });
  const noExportErrorYet = await page.locator("text=/expired|unauthorized/i").count();
  console.log(
    "NO_ERROR_SHOWN_BEFORE_CLICKING_EXPORT (expect 0 — page loaded clean):",
    noExportErrorYet,
  );
  await shot(page, "01-page-loaded-clean");

  console.log("STEP: click Export CSV — this specific request is the one that 401s");
  await page.click("text=Export CSV");
  await page.waitForTimeout(1000);
  await shot(page, "02-after-clicking-export");

  console.log("STEP: was a file actually downloaded? (the real bug under test)");
  console.log(
    "DOWNLOAD_HAPPENED (expect false — was true/silently-saved-the-error-body before the fix):",
    downloadHappened,
  );

  console.log("STEP: does the page show the real error instead?");
  const errorVisible = await page.locator("text=/expired/i").count();
  console.log("VISIBLE_ERROR_MESSAGE_SHOWN (expect >=1):", errorVisible);

  console.log("CONSOLE_ERRORS_START");
  for (const e of errors) console.log(" ", e);
  console.log("CONSOLE_ERRORS_END", `(${errors.length} total)`);

  const pass = noExportErrorYet === 0 && !downloadHappened && errorVisible >= 1;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
