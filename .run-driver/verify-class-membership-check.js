// Live end-to-end proof for the GET /classes/:id auth fix: a user with no
// relationship to a class should no longer be able to read its full roster
// by knowing/guessing the UUID.
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

  console.log("STEP: register a teacher and an unrelated stranger");
  const teacher = await register("Class Owner", `classowner${suffix}`, `classowner${suffix}@arutech.dev`);
  const stranger = await register("Stranger", `stranger${suffix}`, `stranger${suffix}@arutech.dev`);

  console.log("STEP: teacher creates a class");
  const createRes = await api(teacher.accessToken, "/classes", {
    method: "POST",
    body: JSON.stringify({ title: "Roster leak test class" }),
  });
  if (!createRes.ok) throw new Error(`create class failed: ${createRes.status} ${await createRes.text()}`);
  const klass = await createRes.json();
  console.log("CLASS_ID:", klass.id);

  console.log("STEP: teacher reads their own class (should work)");
  const asTeacher = await api(teacher.accessToken, `/classes/${klass.id}`);
  console.log("TEACHER_READ_STATUS (expect 200):", asTeacher.status);

  console.log("STEP: unrelated stranger tries to read the same class by UUID");
  const asStranger = await api(stranger.accessToken, `/classes/${klass.id}`);
  const strangerBody = await asStranger.text();
  console.log("STRANGER_READ_STATUS (expect 403, was 200 before the fix):", asStranger.status);
  console.log("STRANGER_READ_BODY:", strangerBody);

  console.log("STEP: a genuinely nonexistent class id still 404s (not 403)");
  const missing = await api(stranger.accessToken, `/classes/00000000-0000-0000-0000-000000000000`);
  console.log("MISSING_CLASS_STATUS (expect 404):", missing.status);

  console.log("STEP: unauthenticated request (no token at all) is rejected");
  const noAuth = await api(null, `/classes/${klass.id}`);
  console.log("NO_AUTH_STATUS (expect 401):", noAuth.status);

  const pass =
    asTeacher.status === 200 && asStranger.status === 403 && missing.status === 404 && noAuth.status === 401;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("VERIFY_FAILED:", err);
  process.exit(1);
});
