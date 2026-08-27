// Live end-to-end proof: POST /auth/logout should work with an expired (or
// simply absent) access token, since its own comment says exactly that —
// the real credential is the refresh token in the body, verified inside
// AuthService.logoutBySessionToken, not the Authorization header.
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

(async () => {
  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register a user (gets a real access + refresh token pair)");
  const user = await register("Logout Test", `logouttest${suffix}`, `logouttest${suffix}@arutech.dev`);

  console.log("STEP: logout with NO Authorization header at all (simulates an already-expired access token)");
  const noAuthLogout = await fetch(`${BASE}/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: user.refreshToken }),
  });
  console.log("LOGOUT_NO_AUTH_HEADER_STATUS (expect 204, was 401 before the fix):", noAuthLogout.status);

  console.log("STEP: confirm the session was actually revoked — the refresh token no longer works");
  const refreshAfterLogout = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: user.refreshToken }),
  });
  console.log("REFRESH_AFTER_LOGOUT_STATUS (expect 4xx — session is really revoked):", refreshAfterLogout.status);

  console.log("STEP: sanity check — logout with a garbage/malformed access token also still works (not just absent)");
  const user2 = await register("Logout Test 2", `logouttest2${suffix}`, `logouttest2${suffix}@arutech.dev`);
  const garbageAuthLogout = await fetch(`${BASE}/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer totally-not-a-real-token" },
    body: JSON.stringify({ refreshToken: user2.refreshToken }),
  });
  console.log("LOGOUT_GARBAGE_AUTH_HEADER_STATUS (expect 204):", garbageAuthLogout.status);

  const pass = noAuthLogout.status === 204 && refreshAfterLogout.status >= 400 && garbageAuthLogout.status === 204;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("VERIFY_FAILED:", err);
  process.exit(1);
});
