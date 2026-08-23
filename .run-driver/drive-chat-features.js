// Verifies the new chat features (reply, reactions, file/image attachment,
// private DM, delete) with two real registered users in two real meeting
// sessions. Deliberately registers NEW throwaway accounts, not the "demo"
// account, so it doesn't disturb anything a real user is doing with it.
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "chat-features");
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

  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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

  console.log("STEP: register host (A) and join a fresh meeting");
  await register(pageA, "Alex Chen", `alex${suffix}`, `alex${suffix}@arutech.dev`);
  await pageA.click('button:has-text("New meeting")');
  await pageA.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingCode = new URL(pageA.url()).pathname.split("/").pop();
  await pageA.waitForTimeout(1500);
  await pageA.click('button:has-text("Join meeting")');
  await pageA.waitForTimeout(3000);

  console.log("STEP: register participant (B) and join same meeting");
  await register(pageB, "Bina Rao", `bina${suffix}`, `bina${suffix}@arutech.dev`);
  await pageB.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await pageB.waitForTimeout(1500);
  const joinBtnB = pageB.locator('button:has-text("Join meeting")');
  if (await joinBtnB.count()) await joinBtnB.first().click();
  await pageB.waitForTimeout(2500);
  const admitBtn = pageA.locator('button:has-text("Admit")');
  try {
    await admitBtn.first().waitFor({ timeout: 8000 });
    await admitBtn.first().click();
  } catch {}
  await pageB.waitForTimeout(3000);

  console.log("STEP: A opens chat and sends a message with a link and a mention");
  await pageA.click('button:has-text("Chat")');
  await pageA.waitForTimeout(300);
  await pageB.click('button:has-text("Chat")');
  await pageB.waitForTimeout(300);

  const inputA = pageA.locator('input[placeholder="Type message here…"]');
  await inputA.fill("Hey @bina check https://arutech.dev for docs");
  await pageA.locator('button[aria-label="Send message"]').click();
  await pageA.waitForTimeout(700);
  await shot(pageA, "a-link-and-mention");

  console.log("STEP: B replies to A's message");
  await pageB.waitForTimeout(500);
  const replyBtnB = pageB.locator('button:has-text("Reply")').first();
  await replyBtnB.waitFor({ timeout: 5000 });
  await replyBtnB.click();
  const inputB = pageB.locator('input[placeholder="Type message here…"]');
  await inputB.fill("Got it, thanks!");
  await pageB.locator('button[aria-label="Send message"]').click();
  await pageB.waitForTimeout(700);
  await shot(pageB, "b-reply-rendered");

  console.log("STEP: A reacts to B's reply");
  await pageA.waitForTimeout(500);
  // Scoped to the chat panel specifically — the toolbar also has a "React"
  // button (meeting-wide floating emoji reactions), a different feature.
  const chatPanelA = pageA.locator("aside");
  const reactButtons = chatPanelA.locator('button:has-text("React")');
  await reactButtons.last().click();
  await pageA.waitForTimeout(200);
  await chatPanelA.locator("button", { hasText: "❤️" }).last().click();
  await pageA.waitForTimeout(600);
  await shot(pageA, "a-reacted-to-reply");
  await pageB.waitForTimeout(600);
  await shot(pageB, "b-sees-reaction");

  console.log("STEP: B uploads an image attachment");
  const fileInputB = pageB.locator('input[type="file"]');
  await fileInputB.setInputFiles(
    "/tmp/claude-1000/-home-somdevsheel-Project-Indium-by-Arutech/5949e38b-db83-4095-9aa1-19d673a40439/scratchpad/test-image.png",
  );
  await pageB.waitForTimeout(2000);
  await shot(pageB, "b-uploaded-image");
  await pageA.waitForTimeout(1500);
  await shot(pageA, "a-sees-image-attachment");

  console.log("STEP: A sends a private message to B");
  const recipientSelectA = pageA.locator("select");
  await recipientSelectA.selectOption({ index: 1 }); // index 0 is "Everyone"; B is the only other participant
  await inputA.fill("This is just between us");
  await pageA.locator('button[aria-label="Send message"]').click();
  await pageA.waitForTimeout(700);
  await shot(pageA, "a-sent-private-message");
  await pageB.waitForTimeout(700);
  await shot(pageB, "b-received-private-message");

  console.log("STEP: A deletes their own first message");
  await pageA.locator('button:has-text("Delete")').first().click();
  await pageA.waitForTimeout(700);
  await shot(pageA, "a-after-delete");
  await pageB.waitForTimeout(700);
  await shot(pageB, "b-sees-message-deleted");

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
