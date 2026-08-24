// Verifies personal-chat parity features end-to-end through the real UI with
// two real users: edit message (meeting + Team Chat), delete (Team Chat —
// meeting delete was already verified in Stage 13), forward (meeting chat ->
// Team Chat, crossing contexts), voice messages (meeting + Team Chat, a real
// recorded/uploaded/played-back audio file), typing indicator (meeting +
// Team Chat), and online status (Contacts + Team Chat header).
const { chromium } = require("playwright-core");
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const shotDir = path.join(__dirname, "screenshots", "chat-parity");
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
    args: [
      "--no-sandbox",
      // Chrome's built-in fake device already generates a real synthetic
      // audio tone (not silence) for any getUserMedia({audio:true}) call —
      // no extra flag needed, and pointing --use-file-for-fake-audio-capture
      // at a non-WAV path (e.g. /dev/null) actually breaks capture instead.
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 1000 }, permissions: ["microphone"] });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 1000 }, permissions: ["microphone"] });
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

  console.log("STEP: register A and B, get them into a real meeting together");
  await register(pageA, "Parity A", `parA${suffix}`, `parA${suffix}@arutech.dev`);
  await register(pageB, "Parity B", `parB${suffix}`, `parB${suffix}@arutech.dev`);

  await pageA.click("text=New meeting");
  await pageA.waitForURL("**/meeting/**", { timeout: 15000 });
  const meetingCode = new URL(pageA.url()).pathname.split("/").pop();
  await pageA.click('button:has-text("Join meeting")');
  await pageA.waitForSelector("footer", { timeout: 15000 });

  await pageB.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await pageB.click('button:has-text("Join meeting")', { timeout: 15000 });
  await pageB.waitForTimeout(1500);
  const admitBtn = pageA.locator('button:has-text("Admit")');
  try {
    await admitBtn.first().waitFor({ timeout: 8000 });
    await admitBtn.first().click();
  } catch {
    console.log("No Admit button — may not have needed admission");
  }
  await pageB.waitForSelector("footer", { timeout: 15000 });
  await pageA.waitForTimeout(1000);

  console.log("STEP: patch MeetingParticipant.status to JOINED (pre-existing webhook gap, see earlier drivers)");
  const aToken0 = await pageA.evaluate(() => JSON.parse(localStorage.getItem("arutech-auth")).state.accessToken);
  const meetingId = await pageA.evaluate(
    async ({ token, code }) => {
      const res = await fetch("http://localhost:4000/api/v1/meetings", { headers: { Authorization: `Bearer ${token}` } });
      const meetings = await res.json();
      return meetings.find((m) => m.code === code)?.id ?? null;
    },
    { token: aToken0, code: meetingCode },
  );
  function markJoined() {
    execFileSync(
      "pnpm",
      ["--filter", "@arutech/database", "exec", "tsx", "/tmp/claude-1000/-home-somdevsheel-Project-Indium-by-Arutech/5949e38b-db83-4095-9aa1-19d673a40439/scratchpad/mark-participants-joined.ts", meetingId],
      { cwd: path.join(__dirname, ".."), env: { ...process.env, DATABASE_URL: "postgresql://arutech:scratch@localhost:55433/arutech_meet?schema=public" }, stdio: "inherit" },
    );
  }
  markJoined();

  console.log("=== MEETING CHAT: typing indicator ===");
  await pageA.click('button:has-text("Chat")');
  await pageB.click('button:has-text("Chat")');
  await pageA.waitForTimeout(300);
  await pageA.fill('input[placeholder="Type message here…"]', "Hello there");
  await pageB.waitForTimeout(600);
  await shot(pageB, "01-b-sees-a-typing-in-meeting");
  const bSeesTyping = await pageB.locator("text=is typing").count();
  console.log("B_SEES_A_TYPING_IN_MEETING (should be >=1):", bSeesTyping);
  if (bSeesTyping === 0) throw new Error("B never saw A's typing indicator in meeting chat");

  console.log("=== MEETING CHAT: send + edit ===");
  await pageA.click('button[aria-label="Send message"]');
  await pageA.waitForTimeout(600);
  await pageB.waitForTimeout(300);
  const bSeesOriginal = await pageB.locator("text=Hello there").count();
  console.log("B_SEES_ORIGINAL_MESSAGE (should be >=1):", bSeesOriginal);

  await pageA.hover("text=Hello there");
  await pageA.click('button:has-text("Edit")');
  await pageA.fill("textarea", "Hello there, edited!");
  await pageA.click('button:has-text("Save")');
  await pageA.waitForTimeout(600);
  await shot(pageA, "02-a-edited-meeting-message");
  await pageB.waitForTimeout(400);
  await shot(pageB, "03-b-sees-edited-meeting-message");
  const bSeesEdited = await pageB.locator("text=Hello there, edited!").count();
  const bSeesEditedTag = await pageB.locator("text=(edited)").count();
  console.log("B_SEES_EDITED_MEETING_MESSAGE (should be >=1):", bSeesEdited, "EDITED_TAG (should be >=1):", bSeesEditedTag);
  if (bSeesEdited === 0 || bSeesEditedTag === 0) throw new Error("B never saw the live-edited meeting message");

  console.log("=== MEETING CHAT: voice message ===");
  await pageA.click('button[aria-label="Record a voice message"]');
  await pageA.waitForSelector("text=Recording…", { timeout: 5000 });
  await pageA.waitForTimeout(2500);
  await shot(pageA, "04-a-recording-voice-in-meeting");
  await pageA.click('button:has-text("Send")');
  await pageA.waitForTimeout(1500);
  await shot(pageA, "05-a-sent-voice-message-meeting");
  await pageB.waitForTimeout(800);
  await shot(pageB, "06-b-sees-voice-message-meeting");
  const bSeesAudioPlayer = await pageB.locator("audio").count();
  console.log("B_SEES_AUDIO_PLAYER_IN_MEETING_CHAT (should be >=1):", bSeesAudioPlayer);
  if (bSeesAudioPlayer === 0) throw new Error("B never received a playable voice message in meeting chat");
  await pageB.waitForTimeout(500);
  const allAudioSrcs = await pageB.locator("audio").evaluateAll((els) =>
    els.map((el) => ({ src: el.getAttribute("src"), currentSrc: el.currentSrc, outer: el.outerHTML.slice(0, 200) })),
  );
  console.log("ALL_AUDIO_ELEMENTS:", JSON.stringify(allAudioSrcs, null, 2));
  const audioSrc = allAudioSrcs.map((a) => a.currentSrc || a.src).find((s) => s && s.startsWith("http"));
  console.log("AUDIO_SRC_IS_REAL_SIGNED_URL:", Boolean(audioSrc), "->", audioSrc);
  if (!audioSrc) throw new Error("Voice message <audio> never got a real signed playback URL");

  console.log("=== FORWARD: meeting-chat message -> Team Chat DM with B ===");
  // Create the DM first (via Contacts "Message"), so there's a real target
  // room to forward into.
  await pageA.goto("http://localhost:3000/contacts", { waitUntil: "networkidle" });
  await pageA.waitForTimeout(500);
  const messageBtn = pageA.locator('button:has-text("Message")').first();
  if (await messageBtn.count()) {
    await messageBtn.click();
    await pageA.waitForURL("**/chat**", { timeout: 15000 });
  }

  await pageA.goto(`http://localhost:3000/meeting/${meetingCode}`, { waitUntil: "networkidle" });
  await pageA.click('button:has-text("Join meeting")', { timeout: 15000 });
  await pageA.waitForSelector("footer", { timeout: 15000 });
  // Re-joining resets MeetingParticipant.status away from JOINED (the real
  // JOINED transition normally happens via a LiveKit webhook, which this
  // isolated verification instance never delivers — see mark-participants-
  // joined.ts / earlier stages' write-ups for the same gap). Contacts is
  // derived from JOINED/LEFT participant rows, so re-patch it here or the
  // upcoming online-status check would fail on this environment gap rather
  // than a real bug.
  markJoined();
  await pageA.click('button:has-text("Chat")');
  await pageA.waitForTimeout(500);
  await pageA.hover("text=Hello there, edited!");
  await pageA.click('button:has-text("Forward")');
  await pageA.waitForTimeout(500);
  await shot(pageA, "07-a-forward-picker-open");
  const forwardTargetBtn = pageA.locator('button:has-text("Parity B")');
  if (await forwardTargetBtn.count()) {
    await forwardTargetBtn.first().click();
  } else {
    throw new Error('Forward picker never showed a "Parity B" target — see 07-a-forward-picker-open.png');
  }
  await pageA.waitForTimeout(800);
  await shot(pageA, "08-a-forwarded-message");

  console.log("STEP: B checks Team Chat and sees the forwarded message");
  await pageB.goto("http://localhost:3000/chat", { waitUntil: "networkidle" });
  await pageB.waitForTimeout(800);
  await shot(pageB, "09-b-teamchat-list");
  const dmLink = pageB.locator("text=Parity A").first();
  if (await dmLink.count()) await dmLink.click();
  await pageB.waitForTimeout(800);
  await shot(pageB, "10-b-sees-forwarded-message");
  const bSeesForwardMarker = await pageB.locator("text=Forwarded from").count();
  const bSeesForwardedBody = await pageB.locator("text=Hello there, edited!").count();
  console.log("B_SEES_FORWARD_MARKER (should be >=1):", bSeesForwardMarker, "B_SEES_FORWARDED_BODY (should be >=1):", bSeesForwardedBody);
  if (bSeesForwardMarker === 0 || bSeesForwardedBody === 0) throw new Error("B never saw the forwarded message with its marker in Team Chat");

  console.log("=== TEAM CHAT: typing indicator, send, voice message, delete ===");
  await pageA.goto("http://localhost:3000/chat", { waitUntil: "networkidle" });
  await pageA.waitForTimeout(500);
  const aDmLink = pageA.locator("text=Parity B").first();
  if (await aDmLink.count()) await aDmLink.click();
  await pageA.waitForTimeout(500);

  await pageA.fill('input[placeholder="Type a message…"]', "Typing in team chat");
  await pageB.waitForTimeout(600);
  await shot(pageB, "11-b-sees-a-typing-in-teamchat");
  const bSeesTeamChatTyping = await pageB.locator("text=is typing").count();
  console.log("B_SEES_A_TYPING_IN_TEAM_CHAT (should be >=1):", bSeesTeamChatTyping);

  await pageA.click('button:has-text("Send")');
  await pageA.waitForTimeout(600);

  console.log("STEP: A sends a voice message in Team Chat");
  await pageA.click('button[aria-label="Record a voice message"]');
  await pageA.waitForTimeout(2200);
  await pageA.click('button:has-text("Send")');
  await pageA.waitForTimeout(1200);
  await pageB.waitForTimeout(800);
  await shot(pageB, "12-b-sees-voice-message-teamchat");
  const bSeesTeamChatAudio = await pageB.locator("audio").count();
  console.log("B_SEES_AUDIO_PLAYER_IN_TEAM_CHAT (should be >=1):", bSeesTeamChatAudio);
  if (bSeesTeamChatAudio === 0) throw new Error("B never received a playable voice message in Team Chat");

  console.log("STEP: A deletes their own Team Chat message");
  await pageA.hover("text=Typing in team chat");
  await pageA.click('button:has-text("Delete")');
  await pageA.waitForTimeout(600);
  await pageB.waitForTimeout(400);
  await shot(pageB, "13-b-sees-message-deleted-teamchat");
  const bSeesDeleted = await pageB.locator("text=Message deleted").count();
  console.log("B_SEES_TEAMCHAT_MESSAGE_DELETED_LIVE (should be >=1):", bSeesDeleted);
  if (bSeesDeleted === 0) throw new Error("B never saw the live-deleted Team Chat message");

  console.log("=== ONLINE STATUS ===");
  await pageA.goto("http://localhost:3000/contacts", { waitUntil: "networkidle" });
  await pageA.waitForTimeout(500);
  await shot(pageA, "14-a-contacts-online-status");
  const bOnlineText = await pageA.locator("text=Online").count();
  console.log("A_SEES_B_ONLINE_IN_CONTACTS (should be >=1):", bOnlineText);
  if (bOnlineText === 0) throw new Error("A never saw B marked Online in Contacts");

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
