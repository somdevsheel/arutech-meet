// Live end-to-end proof of the actual race condition, not just the unit
// mock: fires many genuinely concurrent join requests from the same user
// against the real running API + real Postgres, and confirms the DB ends
// up with exactly one MeetingParticipant row for that (meeting, user) pair
// — the unique constraint + atomic upsert should make duplicates
// impossible regardless of how badly the requests overlap.
const { execSync } = require("child_process");
const BASE = "http://localhost:4000/api/v1";

function sql(query) {
  return execSync(
    `PGPASSWORD=scratch psql -h localhost -p 55433 -U arutech -d arutech_meet -t -c "${query}"`,
    { encoding: "utf8" },
  ).trim();
}

async function register(name, username, email) {
  const res = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: name, username, email, password: "Password123!" }),
  });
  if (!res.ok) throw new Error(`register ${username} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

(async () => {
  const suffix = Date.now().toString().slice(-6);
  const CONCURRENCY = 25;

  console.log("STEP: register a host and a joiner");
  const host = await register("Race Host", `racehost${suffix}`, `racehost${suffix}@arutech.dev`);
  const joiner = await register("Race Joiner", `racejoiner${suffix}`, `racejoiner${suffix}@arutech.dev`);

  console.log("STEP: host creates a meeting (waiting room off, so status stays simple)");
  const createRes = await fetch(`${BASE}/meetings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${host.accessToken}` },
    body: JSON.stringify({ title: "Join race test", type: "INSTANT", settings: { waitingRoomEnabled: false } }),
  });
  const meeting = await createRes.json();
  console.log("MEETING_ID:", meeting.id);

  console.log(`STEP: fire ${CONCURRENCY} genuinely concurrent join requests from the same joiner`);
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, () =>
      fetch(`${BASE}/meetings/${meeting.code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${joiner.accessToken}` },
        body: "{}",
      }),
    ),
  );
  const statuses = results.map((r) => r.status);
  const successCount = statuses.filter((s) => s < 300).length;
  console.log("JOIN_RESPONSE_STATUSES:", statuses.join(","));
  console.log("SUCCESSFUL_JOINS (expect all", CONCURRENCY, "to succeed — upsert never rejects, it just converges):", successCount);

  console.log("STEP: query the real DB directly — how many MeetingParticipant rows exist for this pair?");
  const rowCount = sql(
    `SELECT COUNT(*) FROM meeting_participants WHERE meeting_id = '${meeting.id}' AND user_id = (SELECT id FROM users WHERE email = 'racejoiner${suffix}@arutech.dev')`,
  );
  console.log("MEETING_PARTICIPANT_ROW_COUNT (expect exactly 1, this is the actual fix under test):", rowCount);

  const pass = successCount === CONCURRENCY && rowCount === "1";
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("VERIFY_FAILED:", err);
  process.exit(1);
});
