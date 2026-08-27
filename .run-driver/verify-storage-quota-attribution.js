// Live end-to-end proof: assignment attachments and chat-room attachments
// now attribute usage to the org they belong to (FileAsset.orgId), which is
// the actual root cause of the quota bypass — OrganizationsService.assertStorageOk
// aggregates over exactly that column, so it silently saw 0 bytes from these
// two paths no matter how much was uploaded through them. Verified by
// querying the real dev DB directly (not mocks) after real uploads.
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

async function api(token, path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

(async () => {
  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register a user and create a real org");
  const user = await register("Quota Test User", `quotauser${suffix}`, `quotauser${suffix}@arutech.dev`);
  const org = await api(user.accessToken, "/organizations", {
    method: "POST",
    body: JSON.stringify({ name: `Quota Test Org ${suffix}` }),
  });
  console.log("ORG_ID:", org.id);

  console.log("STEP: create an org-linked class, presign an assignment attachment");
  const klass = await api(user.accessToken, "/classes", {
    method: "POST",
    body: JSON.stringify({ title: "Quota test class", orgId: org.id }),
  });
  const assignmentUpload = await api(user.accessToken, `/classes/${klass.id}/assignments/presign`, {
    method: "POST",
    body: JSON.stringify({ fileName: "notes.pdf", mimeType: "application/pdf", sizeBytes: 12345 }),
  });
  console.log("ASSIGNMENT_FILE_ID:", assignmentUpload.fileId);

  console.log("STEP: create an org-linked team, presign a chat-room attachment");
  const team = await api(user.accessToken, `/organizations/${org.id}/teams`, {
    method: "POST",
    body: JSON.stringify({ name: `Quota test team ${suffix}` }),
  });
  const teamRoomId = sql(`SELECT id FROM chat_rooms WHERE team_id = '${team.id}'`);
  console.log("TEAM_CHAT_ROOM_ID:", teamRoomId);
  const chatUpload = await api(user.accessToken, `/chat-rooms/${teamRoomId}/files/presign`, {
    method: "POST",
    body: JSON.stringify({ fileName: "voice.webm", mimeType: "audio/webm", sizeBytes: 6789 }),
  });
  console.log("CHAT_FILE_ID:", chatUpload.fileId);

  console.log("STEP: create a PERSONAL (non-org) class too, as a control — its file should have orgId NULL");
  const personalKlass = await api(user.accessToken, "/classes", {
    method: "POST",
    body: JSON.stringify({ title: "Personal class (no org)" }),
  });
  const personalUpload = await api(user.accessToken, `/classes/${personalKlass.id}/assignments/presign`, {
    method: "POST",
    body: JSON.stringify({ fileName: "notes2.pdf", mimeType: "application/pdf", sizeBytes: 111 }),
  });

  console.log("STEP: query the real DB directly — do these FileAsset rows actually carry org_id now?");
  const assignmentOrgId = sql(`SELECT org_id FROM files WHERE id = '${assignmentUpload.fileId}'`);
  const chatOrgId = sql(`SELECT org_id FROM files WHERE id = '${chatUpload.fileId}'`);
  const personalOrgId = sql(`SELECT org_id FROM files WHERE id = '${personalUpload.fileId}'`);
  console.log("ASSIGNMENT_FILE_ORG_ID (expect:", org.id, "):", assignmentOrgId);
  console.log("CHAT_FILE_ORG_ID (expect:", org.id, "):", chatOrgId);
  console.log("PERSONAL_CLASS_FILE_ORG_ID (expect: empty/NULL):", JSON.stringify(personalOrgId));

  console.log("STEP: does the org's real storage aggregate now actually see this usage? (the whole point)");
  const totalUsage = sql(
    `SELECT COALESCE(SUM(size_bytes), 0) FROM files WHERE org_id = '${org.id}' AND deleted_at IS NULL`,
  );
  console.log("ORG_TOTAL_USAGE_BYTES (expect >= 12345 + 6789 = 19134):", totalUsage);

  const pass =
    assignmentOrgId === org.id &&
    chatOrgId === org.id &&
    personalOrgId === "" &&
    Number(totalUsage) >= 19134;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("VERIFY_FAILED:", err);
  process.exit(1);
});
