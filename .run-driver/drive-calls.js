// Verifies real 1:1 calling end-to-end: A calls B (video), B sees a real
// incoming-call modal, accepts, both land in a real live two-way call — then
// a second call with A canceling before B answers, and a third where B
// declines. Triggers calls via `window.__callStore` (a dev-only test hook,
// see lib/call-store.ts) rather than clicking through Contacts, since
// Contacts derivation depends on LiveKit webhook delivery this isolated
// verification stack doesn't have wired — the Calls feature itself has no
// such dependency, so this tests it in isolation, for real, through the
// actual REST endpoints and actual WS events.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "calls");
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

async function getSelf(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("arutech-auth");
    const parsed = JSON.parse(raw);
    return parsed.state.user;
  });
}

async function startCall(page, callee, type) {
  await page.evaluate(
    ({ callee, type }) => window.__callStore.getState().startCall(callee, type),
    { callee, type },
  );
}

(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const errors = { A: [], B: [] };
  for (const [label, page] of [["A", pageA], ["B", pageB]]) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors[label].push(msg.text());
    });
    page.on("pageerror", (err) => errors[label].push(String(err)));
  }

  const suffix = Date.now().toString().slice(-6);
  console.log("STEP: register A and B");
  await register(pageA, "Aria Caller", `aria${suffix}`, `aria${suffix}@arutech.dev`);
  await register(pageB, "Bo Callee", `bo${suffix}`, `bo${suffix}@arutech.dev`);
  const userA = await getSelf(pageA);
  const userB = await getSelf(pageB);
  console.log("A:", userA.id, " B:", userB.id);

  console.log("STEP: A video-calls B");
  await startCall(pageA, { id: userB.id, displayName: userB.displayName, avatarUrl: null }, "VIDEO");
  await pageA.waitForTimeout(1200);
  await shot(pageA, "a-outgoing-call");

  console.log("STEP: B sees incoming call");
  await pageB.waitForTimeout(1500);
  await shot(pageB, "b-incoming-call");

  console.log("STEP: B accepts");
  await pageB.click('button[aria-label="Accept"]');
  await pageB.waitForTimeout(3500);
  await shot(pageB, "b-active-call");
  await pageA.waitForTimeout(1000);
  await shot(pageA, "a-active-call-after-accept");

  console.log("STEP: A ends the call");
  await pageA.click('button:has-text("Leave")');
  await pageA.waitForTimeout(1500);
  await shot(pageA, "a-after-end");
  await pageB.waitForTimeout(1000);
  await shot(pageB, "b-after-remote-end");

  console.log("STEP: A voice-calls B again, then cancels before B answers");
  await startCall(pageA, { id: userB.id, displayName: userB.displayName, avatarUrl: null }, "AUDIO");
  await pageA.waitForTimeout(800);
  await shot(pageA, "a-second-outgoing-call");
  await pageA.click('button[aria-label="Cancel call"]');
  await pageA.waitForTimeout(1200);
  await pageB.waitForTimeout(500);
  await shot(pageB, "b-sees-canceled-no-longer-ringing");

  console.log("STEP: A calls again, B declines this time");
  await startCall(pageA, { id: userB.id, displayName: userB.displayName, avatarUrl: null }, "VIDEO");
  await pageB.waitForTimeout(1500);
  await pageB.click('button[aria-label="Decline"]');
  await pageA.waitForTimeout(1200);
  await shot(pageA, "a-sees-declined");

  console.log("STEP: A checks call history");
  await pageA.goto("http://localhost:3000/contacts", { waitUntil: "networkidle" });
  await pageA.waitForTimeout(1000);
  await shot(pageA, "a-call-history");

  console.log("CONSOLE_ERRORS_A_START");
  for (const e of errors.A) console.log("  A:", e);
  console.log("CONSOLE_ERRORS_A_END", `(${errors.A.length} total)`);
  console.log("CONSOLE_ERRORS_B_START");
  for (const e of errors.B) console.log("  B:", e);
  console.log("CONSOLE_ERRORS_B_END", `(${errors.B.length} total)`);

  await browser.close();
  console.log("DONE");
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
