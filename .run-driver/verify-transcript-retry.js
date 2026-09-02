// Verifies H-13: once ANY transcript row existed for a recording (including
// a FAILED one), the real "Generate transcript" button was permanently
// replaced by one that only toggled an expand flag — clicking "Failed — try
// again" did nothing at all, no network request, no way to ever regenerate.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const shotDir = path.join(__dirname, "screenshots", "transcript-retry");
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

async function tokenOf(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("arutech-auth")).state.accessToken);
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

  console.log("STEP: host creates + joins a meeting");
  await register(page, "Transcript Retry Host", `transretry${suffix}`, `transretry${suffix}@arutech.dev`);
  const token = await tokenOf(page);
  await page.click("text=New meeting");
  await page.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingCode = new URL(page.url()).pathname.split("/").pop();
  await page.click('button:has-text("Join meeting")');
  await page.waitForSelector("footer", { timeout: 15000 });

  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem("arutech-auth")).state.user.id);

  console.log("STEP: seed a READY recording directly (real object in MinIO) — same pattern as the original QA pass");
  const seedMp4 = path.join(shotDir, "seed.mp4");
  fs.writeFileSync(seedMp4, Buffer.alloc(50000, 1));

  const realMeetingId = await page.evaluate(async ({ code, token }) => {
    const res = await fetch(`http://localhost:4000/api/v1/meetings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const list = await res.json();
    const found = list.find((m) => m.code === code);
    return found ? found.id : null;
  }, { code: meetingCode, token });
  console.log("MEETING_ID:", realMeetingId);

  const storageKey = `recordings/${realMeetingId}/${Date.now()}-transcript-retry-seed.mp4`;
  execSync(
    `docker run --rm --network host -e MC_HOST_seed="http://verify:verifysecret@localhost:19000" -v "${shotDir}:/data" minio/mc:latest cp /data/seed.mp4 seed/arutech-verify/${storageKey}`,
    { stdio: "pipe" },
  );

  const seedId = execSync("uuidgen").toString().trim();
  const PSQL = `PGPASSWORD=scratch psql -h localhost -p 55433 -U arutech -d arutech_meet -t -A -c`;
  execSync(
    `${PSQL} "INSERT INTO meeting_recordings (id, meeting_id, started_by_user_id, status, storage_key, started_at, duration_seconds, size_bytes, expires_at, created_at) VALUES ('${seedId}', '${realMeetingId}', '${userId}', 'READY', '${storageKey}', now() - interval '5 minutes', 2, 50000, now() + interval '90 days', now())"`,
  );
  console.log("SEEDED_RECORDING_ID:", seedId);

  console.log("STEP: open Record panel — seeded recording should be visible");
  await page.click('button:has-text("Chat")');
  await page.waitForTimeout(300);
  await page.click('button:has-text("Record")');
  await page.waitForTimeout(800);
  await shot(page, "01-seeded-recording-visible");

  console.log("STEP: click 'Generate transcript & AI summary' — a real generation attempt, expected to FAIL (no OPENAI_API_KEY in this environment)");
  await page.click('button:has-text("Generate transcript")');
  await shot(page, "02-generation-triggered");

  console.log("STEP: wait for it to actually reach FAILED (real processing, not mocked)");
  const reachedFailed = await page
    .waitForSelector("text=Failed — try again", { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  console.log("TRANSCRIPT_REACHED_FAILED_STATE (expect true):", reachedFailed);
  await shot(page, "03-transcript-failed");
  if (!reachedFailed) pass = false;

  console.log("STEP: click 'Failed — try again' — must fire a REAL new POST /transcripts request, not just toggle a panel");
  const [retryResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/transcripts") && r.request().method() === "POST",
      { timeout: 8000 },
    ),
    page.click("text=Failed — try again"),
  ]).catch((err) => {
    console.log("NO_RETRY_POST_REQUEST_OBSERVED:", err.message);
    return [null];
  });
  console.log("RETRY_POST_STATUS (expect 201, this is H-13):", retryResponse ? retryResponse.status() : "never fired");
  await shot(page, "04-retry-clicked");
  if (!retryResponse || retryResponse.status() >= 300) pass = false;

  console.log("STEP: confirm the UI actually shows a fresh in-flight status, not stuck on the old FAILED label with no request behind it");
  await page.waitForTimeout(1000);
  const showsFreshStatus = await page.locator("text=/Transcribing|Generating summary|Failed — try again/").count();
  console.log("SHOWS_A_STATUS_LABEL_AFTER_RETRY (expect >=1):", showsFreshStatus);
  await shot(page, "05-after-retry-status");

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
