// Live end-to-end proof for the permission.service.ts fix: a participant who
// gets denied at the waiting room should lose REST access to that meeting's
// resources (chat history here), not keep it forever because their row
// still exists. Hits the real running API over HTTP — no mocks.
const BASE = "http://localhost:4000/api/v1";

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
  return res;
}

(async () => {
  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register host and a to-be-denied participant");
  const host = await register("Deny Test Host", `denyhost${suffix}`, `denyhost${suffix}@arutech.dev`);
  const guest = await register("Deny Test Guest", `denyguest${suffix}`, `denyguest${suffix}@arutech.dev`);

  console.log("STEP: host creates a meeting with the waiting room ON (default)");
  const createRes = await api(host.accessToken, "/meetings", {
    method: "POST",
    body: JSON.stringify({ title: "Deny access test", type: "INSTANT" }),
  });
  if (!createRes.ok) throw new Error(`create meeting failed: ${createRes.status} ${await createRes.text()}`);
  const meeting = await createRes.json();
  console.log("MEETING_ID:", meeting.id, "SETTINGS:", JSON.stringify(meeting.settings));

  console.log("STEP: host actually joins/admits itself (so it's ADMITTED, not just owner)");
  const hostJoin = await api(host.accessToken, `/meetings/${meeting.code}/join`, { method: "POST", body: "{}" });
  if (!hostJoin.ok) throw new Error(`host join failed: ${hostJoin.status} ${await hostJoin.text()}`);

  console.log("STEP: guest joins -> should land in WAITING (waiting room is on by default)");
  const guestJoin = await api(guest.accessToken, `/meetings/${meeting.code}/join`, { method: "POST", body: "{}" });
  if (!guestJoin.ok) throw new Error(`guest join failed: ${guestJoin.status} ${await guestJoin.text()}`);
  const guestJoinBody = await guestJoin.json();
  const guestParticipantId = guestJoinBody.participantId;
  console.log("GUEST_PARTICIPANT_STATUS_AFTER_JOIN:", guestJoinBody.status, "id:", guestParticipantId);

  console.log("STEP: BEFORE deny — guest should already be blocked from chat history (still WAITING)");
  const beforeDeny = await api(guest.accessToken, `/meetings/${meeting.id}/chat/messages`);
  console.log("CHAT_HISTORY_STATUS_WHILE_WAITING (expect 403):", beforeDeny.status);

  console.log("STEP: host denies the guest");
  const denyRes = await api(
    host.accessToken,
    `/meetings/${meeting.id}/participants/${guestParticipantId}/deny`,
    { method: "POST", body: "{}" },
  );
  if (!denyRes.ok) throw new Error(`deny failed: ${denyRes.status} ${await denyRes.text()}`);
  console.log("DENY_CALL_STATUS:", denyRes.status);

  console.log("STEP: AFTER deny — guest tries chat history again (this is the actual fix under test)");
  const afterDeny = await api(guest.accessToken, `/meetings/${meeting.id}/chat/messages`);
  const afterDenyBody = await afterDeny.text();
  console.log("CHAT_HISTORY_STATUS_AFTER_DENY (expect 403, was 200 before the fix):", afterDeny.status);
  console.log("CHAT_HISTORY_BODY_AFTER_DENY:", afterDenyBody);

  console.log("STEP: also confirm recordings list is blocked the same way");
  const recordingsAfterDeny = await api(guest.accessToken, `/meetings/${meeting.id}/recordings`);
  console.log("RECORDINGS_STATUS_AFTER_DENY (expect 403):", recordingsAfterDeny.status);

  console.log("STEP: sanity check — the still-admitted HOST can still access chat history fine");
  const hostChat = await api(host.accessToken, `/meetings/${meeting.id}/chat/messages`);
  console.log("HOST_CHAT_HISTORY_STATUS (expect 200):", hostChat.status);

  const pass =
    beforeDeny.status === 403 &&
    denyRes.status < 300 &&
    afterDeny.status === 403 &&
    recordingsAfterDeny.status === 403 &&
    hostChat.status === 200;

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("VERIFY_FAILED:", err);
  process.exit(1);
});
