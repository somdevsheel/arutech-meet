// Live end-to-end proof against the real running API: register with a
// mixed-case email, then log in with a differently-cased version of the
// exact same address — previously a permanent lockout (case-sensitive
// unique index, no normalization at all). Also confirms re-registering
// with a different casing of an already-taken email is correctly rejected
// as a duplicate now, instead of silently creating a second account.
const BASE = "http://localhost:4000/api/v1";

async function post(path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

(async () => {
  const suffix = Date.now().toString().slice(-6);
  const username = `caseuser${suffix}`;
  const mixedCaseEmail = `CaseTest${suffix}@Arutech.DEV`;
  const lowerCaseEmail = mixedCaseEmail.toLowerCase();

  console.log("STEP: register with a deliberately mixed-case email:", mixedCaseEmail);
  const reg = await post("/auth/register", {
    email: mixedCaseEmail,
    password: "Password123",
    displayName: "Case Test",
    username,
  });
  console.log("REGISTER_STATUS:", reg.status, "STORED_EMAIL (expect lowercase):", reg.body?.user?.email);

  console.log("STEP: log in with a DIFFERENT casing of the exact same address");
  const loginDifferentCase = await post("/auth/login", { email: lowerCaseEmail, password: "Password123" });
  console.log(
    "LOGIN_WITH_LOWERCASE_STATUS (expect 200, was a permanent 401 before the fix):",
    loginDifferentCase.status,
  );

  console.log("STEP: log in with YET ANOTHER casing (all-caps) of the same address");
  const loginAllCaps = await post("/auth/login", { email: mixedCaseEmail.toUpperCase(), password: "Password123" });
  console.log("LOGIN_WITH_UPPERCASE_STATUS (expect 200):", loginAllCaps.status);

  console.log("STEP: re-registering with a different casing of the same email is correctly rejected as a duplicate");
  const dupe = await post("/auth/register", {
    email: mixedCaseEmail.toUpperCase(),
    password: "Password123",
    displayName: "Case Test Dupe",
    username: `${username}dupe`,
  });
  console.log(
    "DUPLICATE_DIFFERENT_CASE_REGISTER_STATUS (expect 409, was previously allowed -> two accounts):",
    dupe.status,
  );

  const pass =
    reg.status === 201 &&
    reg.body?.user?.email === lowerCaseEmail &&
    loginDifferentCase.status === 200 &&
    loginAllCaps.status === 200 &&
    dupe.status === 409;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("VERIFY_FAILED:", err);
  process.exit(1);
});
