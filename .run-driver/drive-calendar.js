// Verifies the Calendar (Priority 3 item 5) end to end through the real UI:
// month/week/day views over real scheduled meetings and class sessions,
// recurring-meeting projection, cross-view navigation, clicking an event
// into the real meeting join flow, and the honest-503 "Connect calendar"
// buttons.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "calendar");
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

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));

  const suffix = Date.now().toString().slice(-6);
  console.log("STEP: register a real user");
  await register(page, "Cal Test", `cal${suffix}`, `cal${suffix}@arutech.dev`);

  const token = await page.evaluate(() => JSON.parse(localStorage.getItem("arutech-auth")).state.accessToken);

  console.log("STEP: create real fixtures via the real API — a scheduled meeting, a recurring meeting, and a class session, all today");
  const fixtures = await page.evaluate(async (bearer) => {
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` };
    const now = new Date();
    const todayAt = (h) => {
      const d = new Date(now);
      d.setHours(h, 0, 0, 0);
      return d.toISOString();
    };

    const scheduled = await fetch("http://localhost:4000/api/v1/meetings", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "Calendar Test Meeting",
        type: "SCHEDULED",
        scheduledStart: todayAt(14),
        scheduledEnd: todayAt(15),
        timezone: "UTC",
      }),
    }).then((r) => r.json());

    const recurring = await fetch("http://localhost:4000/api/v1/meetings", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "Calendar Recurring Standup",
        type: "RECURRING",
        scheduledStart: todayAt(9),
        timezone: "UTC",
        recurrenceFrequency: "WEEKLY",
        recurrenceUntil: new Date(now.getTime() + 56 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    }).then((r) => r.json());

    const klass = await fetch("http://localhost:4000/api/v1/classes", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Calendar Test Class" }),
    }).then((r) => r.json());

    const session = await fetch(`http://localhost:4000/api/v1/classes/${klass.id}/sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Calendar Test Session", sessionDate: todayAt(11) }),
    }).then((r) => r.json());

    return { scheduled, recurring, klass, session };
  }, token);

  console.log("FIXTURES_OK:", Boolean(fixtures.scheduled?.id && fixtures.recurring?.id && fixtures.session?.id));
  if (!fixtures.scheduled?.id || !fixtures.recurring?.id || !fixtures.session?.id) {
    throw new Error("Fixture creation via the real API failed: " + JSON.stringify(fixtures));
  }

  console.log("=== MONTH VIEW ===");
  await page.goto("http://localhost:3000/calendar", { waitUntil: "networkidle" });
  await page.waitForSelector("text=Calendar Test Meeting", { timeout: 15000 });
  await shot(page, "month-view-with-events");
  // The month cell's day-number button is a direct child of the cell div;
  // event pills live one level deeper inside their own wrapper div — this
  // selector deliberately excludes the day-number button, counting pills only.
  const todayCellPills = await page.locator('[aria-current="date"] > div > button').count();
  console.log("TODAY_CELL_PILL_COUNT (should be 3 — meeting, recurring occurrence, class):", todayCellPills);
  if (todayCellPills < 3) throw new Error("Expected 3 event pills on today's month cell");
  const monthHasMeeting = await page.locator("text=Calendar Test Meeting").count();
  const monthHasRecurring = await page.locator("text=Calendar Recurring Standup").count();
  const monthHasClass = await page.locator("text=Calendar Test Session").count();
  console.log("MONTH_VIEW_HAS_ALL_THREE:", monthHasMeeting > 0, monthHasRecurring > 0, monthHasClass > 0);
  if (!(monthHasMeeting && monthHasRecurring && monthHasClass)) {
    throw new Error("Month view is missing one of the three fixture events");
  }

  console.log("=== NEXT MONTH: today's events should disappear ===");
  await page.click('button[aria-label="Next"]');
  await page.waitForTimeout(600);
  await shot(page, "next-month-no-events");
  const nextMonthHasMeeting = await page.locator("text=Calendar Test Meeting").count();
  console.log("NEXT_MONTH_HAS_TODAYS_MEETING (should be 0):", nextMonthHasMeeting);
  if (nextMonthHasMeeting !== 0) throw new Error("Next month incorrectly shows today's one-off meeting");
  await page.click('button:has-text("Today")');
  await page.waitForTimeout(600);

  console.log("=== DAY VIEW (via clicking today's date number) ===");
  await page.click('[aria-current="date"] > button');
  await page.waitForTimeout(400);
  await shot(page, "day-view");
  const dayViewJoinButtons = await page.locator('button:has-text("Join")').count();
  console.log("DAY_VIEW_JOIN_BUTTONS (should be 3):", dayViewJoinButtons);
  if (dayViewJoinButtons !== 3) throw new Error("Day view should list all 3 of today's events with a Join button each");
  const dayViewShowsClassBadge = await page.locator("text=Calendar Test Class").count();
  const dayViewShowsRecurringTag = await page.locator("text=· recurring").count();
  console.log("DAY_VIEW_CLASS_BADGE:", dayViewShowsClassBadge, "DAY_VIEW_RECURRING_TAG:", dayViewShowsRecurringTag);
  if (dayViewShowsClassBadge === 0 || dayViewShowsRecurringTag === 0) {
    throw new Error("Day view missing the class-name badge or the recurring-occurrence tag");
  }

  console.log("=== WEEK VIEW ===");
  await page.click('button:has-text("Week")');
  await page.waitForTimeout(400);
  await shot(page, "week-view");
  const weekTodayColumnEvents = await page.locator('[aria-current="date"] button').count();
  console.log("WEEK_TODAY_COLUMN_EVENT_COUNT (should be 3):", weekTodayColumnEvents);
  if (weekTodayColumnEvents < 3) throw new Error("Week view's today column is missing events");

  console.log("=== CLICK AN EVENT -> real meeting join flow ===");
  await page.click("text=Calendar Test Meeting");
  await page.waitForURL("**/meeting/**", { timeout: 15000 });
  await page.waitForSelector('button:has-text("Join meeting")', { timeout: 15000 });
  await shot(page, "clicked-into-real-meeting-prejoin");
  console.log("NAVIGATED_TO_REAL_MEETING:", page.url());
  if (!page.url().includes(fixtures.scheduled.code)) {
    throw new Error(`Expected to land on meeting ${fixtures.scheduled.code}, got ${page.url()}`);
  }

  console.log("=== CONNECT GOOGLE/OUTLOOK — real 503, not a fake success ===");
  await page.goto("http://localhost:3000/calendar", { waitUntil: "networkidle" });
  await page.click('button:has-text("Connect Google Calendar")');
  await page.waitForSelector("text=not configured on this server", { timeout: 10000 });
  await shot(page, "connect-google-real-error");
  const connectErrorText = await page.locator("text=not configured on this server").count();
  console.log("CONNECT_SHOWS_REAL_ERROR (should be >=1):", connectErrorText);
  if (connectErrorText === 0) throw new Error("Connect Google Calendar should surface a real 503 error, not silently succeed");

  console.log("CONSOLE_ERRORS_START");
  for (const e of errors) console.log("  ", e);
  console.log("CONSOLE_ERRORS_END", `(${errors.length} total)`);

  await browser.close();
  console.log("DONE");
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
