// Verifies the bug report: "when host open whiteboard not visible to
// participant" — opening the whiteboard used to be a purely local UI toggle,
// so a host opening it did nothing on anyone else's screen. Now it should
// broadcast and force every other participant's view to switch too (like
// starting a screen share), and revert them when it's closed.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "whiteboard-auto-visible");
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
  const ctxA = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const errors = [];
  for (const [label, p] of [["A", pageA], ["B", pageB]]) {
    p.on("pageerror", (err) => errors.push(`[${label}] ${String(err)}`));
    p.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[${label}] ${msg.text()}`);
    });
  }
  const suffix = Date.now().toString().slice(-6);
  let pass = true;

  console.log("STEP: A registers, creates and joins an instant meeting (A is the host)");
  await register(pageA, "WB AutoVis Host", `wbautoa${suffix}`, `wbautoa${suffix}@arutech.dev`);
  await pageA.click("text=New meeting");
  await pageA.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingUrl = pageA.url();
  await pageA.click('button:has-text("Join meeting")');
  await pageA.waitForSelector("footer", { timeout: 15000 });

  console.log("STEP: B registers and joins the same meeting");
  await register(pageB, "WB AutoVis Guest", `wbautob${suffix}`, `wbautob${suffix}@arutech.dev`);
  await pageB.goto(meetingUrl, { waitUntil: "networkidle" });
  await pageB.click('button:has-text("Join meeting")');
  await pageB.waitForSelector("footer", { timeout: 15000 });
  await pageA.waitForTimeout(1500); // let presence settle both directions

  console.log("STEP: baseline — neither has any panel open yet");
  await shot(pageA, "01-a-baseline");
  await shot(pageB, "02-b-baseline");

  console.log("STEP: A (host) clicks the dedicated Whiteboard button");
  await pageA.click('footer button:has-text("Whiteboard")');
  await pageA.waitForTimeout(1000);
  const aCanvas = pageA.locator('canvas[width="800"]');
  const aCanvasBox = (await aCanvas.count()) > 0 ? await aCanvas.first().boundingBox() : null;
  console.log("A_WHITEBOARD_CANVAS_SIZE (expect large):", JSON.stringify(aCanvasBox));
  if (!aCanvasBox || aCanvasBox.width < 600) pass = false;
  await shot(pageA, "03-a-opened-whiteboard");

  console.log("STEP: without B touching anything, B's screen should now ALSO show the whiteboard full-size — this is the actual bug being fixed");
  await pageB.waitForTimeout(1500);
  const bCanvas = pageB.locator('canvas[width="800"]');
  const bCanvasCount = await bCanvas.count();
  const bCanvasBox = bCanvasCount > 0 ? await bCanvas.first().boundingBox() : null;
  console.log("B_WHITEBOARD_VISIBLE_WITHOUT_ACTION (expect >=1):", bCanvasCount);
  console.log("B_WHITEBOARD_CANVAS_SIZE (expect large):", JSON.stringify(bCanvasBox));
  if (bCanvasCount < 1 || !bCanvasBox || bCanvasBox.width < 600) pass = false;
  await shot(pageB, "04-b-whiteboard-auto-appeared");

  console.log("STEP: A draws a stroke — B should see it live (existing sync, confirming this isn't just a static empty canvas)");
  if (aCanvasBox) {
    await pageA.mouse.move(aCanvasBox.x + 50, aCanvasBox.y + 50);
    await pageA.mouse.down();
    await pageA.mouse.move(aCanvasBox.x + 200, aCanvasBox.y + 200, { steps: 10 });
    await pageA.mouse.up();
  }
  await pageB.waitForTimeout(800);
  await shot(pageB, "05-b-sees-live-stroke");

  console.log("STEP: A closes the whiteboard (clicks the button again) — B should revert back to the normal video view automatically");
  await pageA.click('footer button:has-text("Whiteboard")');
  await pageA.waitForTimeout(1000);
  await pageB.waitForTimeout(1000);
  const bCanvasAfterClose = await pageB.locator('canvas[width="800"]').count();
  console.log("B_WHITEBOARD_GONE_AFTER_A_CLOSES (expect 0):", bCanvasAfterClose);
  if (bCanvasAfterClose !== 0) pass = false;
  await shot(pageB, "06-b-reverted-after-a-closed");
  await shot(pageA, "07-a-closed-whiteboard");

  console.log("STEP: no console/page errors happened during any of this");
  console.log("CONSOLE_ERRORS:", JSON.stringify(errors));
  if (errors.length > 0) pass = false;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  await browser.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
