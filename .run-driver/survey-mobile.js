// Survey pass: screenshot key pages at a real mobile viewport (iPhone SE-ish,
// 375x667 — a deliberately narrow, common baseline) to find concrete
// responsiveness problems before fixing anything.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "mobile-survey");
fs.mkdirSync(shotDir, { recursive: true });
let shotN = 0;
async function shot(page, label) {
  shotN += 1;
  const file = path.join(shotDir, `${String(shotN).padStart(2, "0")}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log("SCREENSHOT:", file);
}
async function shotFull(page, label) {
  shotN += 1;
  const file = path.join(shotDir, `${String(shotN).padStart(2, "0")}-${label}-full.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log("SCREENSHOT (full page):", file);
}

async function checkHorizontalOverflow(page) {
  return page.evaluate(() => {
    const docWidth = document.documentElement.scrollWidth;
    const winWidth = window.innerWidth;
    const overflowing = [];
    if (docWidth > winWidth + 2) {
      document.querySelectorAll("body *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right > winWidth + 2 && r.width > 40) {
          overflowing.push({
            tag: el.tagName,
            cls: (el.className || "").toString().slice(0, 80),
            right: Math.round(r.right),
            width: Math.round(r.width),
          });
        }
      });
    }
    return { docWidth, winWidth, overflowCount: overflowing.length, sample: overflowing.slice(0, 5) };
  });
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
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 667 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  });
  const page = await ctx.newPage();
  const suffix = Date.now().toString().slice(-6);

  console.log("=== /login ===");
  await page.goto("http://localhost:3000/login", { waitUntil: "networkidle" });
  await shot(page, "login");
  console.log("OVERFLOW:", JSON.stringify(await checkHorizontalOverflow(page)));

  console.log("=== /register ===");
  await register(page, "Mobile Survey QA", `mobsurv${suffix}`, `mobsurv${suffix}@arutech.dev`);
  console.log("=== /dashboard ===");
  await shot(page, "dashboard");
  console.log("OVERFLOW:", JSON.stringify(await checkHorizontalOverflow(page)));

  console.log("=== dashboard: open Personal room settings modal ===");
  const gearBtn = page.locator('button[aria-label="Personal room settings"]');
  if ((await gearBtn.count()) > 0) {
    await gearBtn.click();
    await page.waitForTimeout(300);
    await shot(page, "dashboard-personal-room-modal");
    console.log("OVERFLOW:", JSON.stringify(await checkHorizontalOverflow(page)));
    await page.keyboard.press("Escape").catch(() => {});
    const closeBtn = page.locator('button:has-text("Cancel")').first();
    if ((await closeBtn.count()) > 0) await closeBtn.click().catch(() => {});
  }

  console.log("=== dashboard: Schedule modal ===");
  const scheduleBtn = page.locator("text=Schedule").first();
  if ((await scheduleBtn.count()) > 0) {
    await scheduleBtn.click();
    await page.waitForTimeout(300);
    await shot(page, "dashboard-schedule-modal");
    console.log("OVERFLOW:", JSON.stringify(await checkHorizontalOverflow(page)));
    await page.keyboard.press("Escape").catch(() => {});
  }

  for (const [route, label] of [
    ["/calendar", "calendar"],
    ["/chat", "chat"],
    ["/contacts", "contacts"],
    ["/classes", "classes"],
    ["/courses", "courses"],
    ["/notes", "notes"],
    ["/recordings", "recordings"],
    ["/organizations", "organizations"],
    ["/settings", "settings"],
    ["/apps", "apps"],
  ]) {
    console.log(`=== ${route} ===`);
    try {
      await page.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle", timeout: 15000 });
      await page.waitForTimeout(300);
      await shot(page, label);
      console.log("OVERFLOW:", JSON.stringify(await checkHorizontalOverflow(page)));
    } catch (e) {
      console.log("FAILED TO LOAD:", route, String(e).slice(0, 200));
    }
  }

  console.log("=== hamburger nav drawer ===");
  await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });
  const hamburger = page.locator('button[aria-label*="menu" i], button[aria-label*="nav" i]').first();
  if ((await hamburger.count()) > 0) {
    await hamburger.click();
    await page.waitForTimeout(300);
    await shot(page, "nav-drawer-open");
  } else {
    console.log("NO HAMBURGER FOUND (checked aria-label containing 'menu'/'nav')");
  }

  console.log("=== meeting room (in-call) ===");
  await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });
  await page.click("text=New meeting");
  await page.waitForURL("**/meeting/**", { timeout: 15000 });
  await shot(page, "meeting-lobby");
  console.log("OVERFLOW:", JSON.stringify(await checkHorizontalOverflow(page)));
  const joinBtn = page.locator('button:has-text("Join meeting")');
  if ((await joinBtn.count()) > 0) {
    await joinBtn.click();
    await page.waitForSelector("footer", { timeout: 15000 });
    await page.waitForTimeout(1000);
    await shot(page, "meeting-room-incall");
    console.log("OVERFLOW:", JSON.stringify(await checkHorizontalOverflow(page)));

    // Try opening Chat panel
    const chatBtn = page.locator('footer button:has-text("Chat")');
    if ((await chatBtn.count()) > 0) {
      await chatBtn.click();
      await page.waitForTimeout(400);
      await shot(page, "meeting-room-chat-panel-open");
      console.log("OVERFLOW:", JSON.stringify(await checkHorizontalOverflow(page)));
    }
  }

  await browser.close();
  console.log("SURVEY DONE");
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
