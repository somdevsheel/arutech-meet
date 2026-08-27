// Live end-to-end proof: rotating a meeting's password via
// PATCH /meetings/:id/settings should actually take effect — the old
// password should stop working and the new one should start working.
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
  return fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
}

(async () => {
  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register a host and a joiner");
  const host = await register("Password Rotate Host", `pwhost${suffix}`, `pwhost${suffix}@arutech.dev`);
  const joiner = await register("Password Rotate Joiner", `pwjoiner${suffix}`, `pwjoiner${suffix}@arutech.dev`);

  console.log("STEP: host creates a password-protected meeting");
  const createRes = await api(host.accessToken, "/meetings", {
    method: "POST",
    body: JSON.stringify({ title: "Password rotation test", type: "INSTANT", password: "OldPass123" }),
  });
  if (!createRes.ok) throw new Error(`create failed: ${createRes.status} ${await createRes.text()}`);
  const meeting = await createRes.json();
  console.log("MEETING_ID:", meeting.id);

  console.log("STEP: joiner tries the OLD password before rotation (should work)");
  const joinOldBefore = await api(joiner.accessToken, `/meetings/${meeting.code}/join`, {
    method: "POST",
    body: JSON.stringify({ password: "OldPass123" }),
  });
  console.log("JOIN_WITH_OLD_PASSWORD_BEFORE_ROTATION (expect 2xx):", joinOldBefore.status);

  console.log("STEP: host rotates the password via PATCH /meetings/:id/settings");
  const rotateRes = await api(host.accessToken, `/meetings/${meeting.id}/settings`, {
    method: "PATCH",
    body: JSON.stringify({ password: "NewPass456" }),
  });
  if (!rotateRes.ok) throw new Error(`rotate failed: ${rotateRes.status} ${await rotateRes.text()}`);
  console.log("ROTATE_CALL_STATUS:", rotateRes.status);

  console.log("STEP: a fresh joiner tries the OLD password AFTER rotation (this is the fix under test)");
  const joiner2 = await register("Password Rotate Joiner 2", `pwjoiner2${suffix}`, `pwjoiner2${suffix}@arutech.dev`);
  const joinOldAfter = await api(joiner2.accessToken, `/meetings/${meeting.code}/join`, {
    method: "POST",
    body: JSON.stringify({ password: "OldPass123" }),
  });
  const joinOldAfterBody = await joinOldAfter.text();
  console.log("JOIN_WITH_OLD_PASSWORD_AFTER_ROTATION (expect 4xx, was 2xx before the fix):", joinOldAfter.status);
  console.log("BODY:", joinOldAfterBody);

  console.log("STEP: same fresh joiner tries the NEW password (should work)");
  const joinNewAfter = await api(joiner2.accessToken, `/meetings/${meeting.code}/join`, {
    method: "POST",
    body: JSON.stringify({ password: "NewPass456" }),
  });
  console.log("JOIN_WITH_NEW_PASSWORD (expect 2xx):", joinNewAfter.status);

  const pass =
    joinOldBefore.status < 300 &&
    rotateRes.status < 300 &&
    joinOldAfter.status >= 400 &&
    joinNewAfter.status < 300;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("VERIFY_FAILED:", err);
  process.exit(1);
});
