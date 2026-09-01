// Verifies the actual bug: AdminUsersService.suspend()/activate() used
// `.catch(() => null)` around the update call, converting EVERY possible
// failure — a genuinely missing user, but just as easily a DB connection
// drop or a constraint violation — into an identical "User not found" 404,
// with the real cause never surfacing anywhere. The fix narrows that catch
// to Prisma's specific P2025 "record not found" error and rethrows
// anything else as a real error.
//
// This script hits the real running API as a real SYSTEM_ADMIN user (role
// granted via a direct DB update + fresh login, since the JWT embeds
// systemRole at issue time) and confirms:
//   1. Suspending a genuinely nonexistent user still correctly 404s with
//      "User not found" — the fix didn't regress the real case it's meant
//      to keep working.
//   2. Suspending a real user still succeeds, actually flips their status,
//      and actually revokes their existing session (a real login that
//      worked a moment ago is rejected afterward) — the whole feature this
//      service exists for, not just the one line that changed.
// (The "a genuine non-404 DB failure propagates instead of becoming a fake
// 404" branch is deliberately NOT exercised here — safely forcing a real
// DB-level failure against this shared dev database isn't something to do
// live; it's covered by admin-users.service.spec.ts's mocked-error tests,
// which exercise this exact same isRecordNotFound()/catch code path.)
const { execSync } = require("child_process");

async function apiFetch(path, options = {}) {
  const res = await fetch(`http://localhost:4000/api/v1${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  return { status: res.status, body };
}

async function register(displayName, username, email) {
  const { body } = await apiFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify({ displayName, username, email, password: "Password123!" }),
  });
  return body;
}

async function login(email) {
  const { body } = await apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "Password123!" }),
  });
  return body;
}

(async () => {
  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register an admin-to-be and a target user via the real API");
  const admin = await register(
    "Admin Tester",
    `admintest${suffix}`,
    `admintest${suffix}@arutech.dev`,
  );
  const target = await register("Target User", `targetu${suffix}`, `targetu${suffix}@arutech.dev`);

  console.log(
    "STEP: grant SYSTEM_ADMIN directly in Postgres (this app has no self-serve promotion path, by design), then log in fresh so the JWT actually carries it",
  );
  execSync(
    `docker exec arutech-migrate-scratch psql -U arutech -d arutech_meet -c "UPDATE users SET system_role = 'ADMIN' WHERE id = '${admin.user.id}'"`,
    { stdio: "pipe" },
  );
  const adminAuth = await login(`admintest${suffix}@arutech.dev`);

  console.log("STEP: target user logs in too, so we have a real session to prove gets revoked");
  const targetAuth = await login(`targetu${suffix}@arutech.dev`);
  const refreshBeforeSuspend = await apiFetch("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken: targetAuth.refreshToken }),
  });
  console.log("TARGET_REFRESH_WORKS_BEFORE_SUSPEND (expect 200):", refreshBeforeSuspend.status);

  console.log(
    "STEP: admin suspends a GENUINELY NONEXISTENT user — must still 404 as 'User not found'",
  );
  const notFoundRes = await apiFetch("/admin/users/00000000-0000-0000-0000-000000000000/suspend", {
    method: "POST",
    headers: { Authorization: `Bearer ${adminAuth.accessToken}` },
  });
  console.log("NOT_FOUND_STATUS (expect 404):", notFoundRes.status);
  console.log("NOT_FOUND_MESSAGE (expect 'User not found'):", notFoundRes.body?.error?.message);

  console.log("STEP: admin suspends the REAL target user — must succeed for real");
  const suspendRes = await apiFetch(`/admin/users/${target.user.id}/suspend`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminAuth.accessToken}` },
  });
  console.log("SUSPEND_STATUS (expect 200):", suspendRes.status);
  console.log("SUSPEND_RESULT_STATUS_FIELD (expect SUSPENDED):", suspendRes.body?.status);

  console.log(
    "STEP: does suspending actually revoke the target's existing session? (the real feature, not just the bug fix — access tokens are stateless JWTs verified by signature alone, so revocation can only ever block getting a NEW one via refresh, exactly as this service's own comment says)",
  );
  const refreshAfterSuspend = await apiFetch("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken: targetAuth.refreshToken }),
  });
  console.log(
    "TARGET_REFRESH_REJECTED_AFTER_SUSPEND (expect 401, was 200 above):",
    refreshAfterSuspend.status,
  );

  console.log("STEP: admin re-activates the target — must succeed for real too");
  const activateRes = await apiFetch(`/admin/users/${target.user.id}/activate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminAuth.accessToken}` },
  });
  console.log("ACTIVATE_STATUS (expect 200):", activateRes.status);
  console.log("ACTIVATE_RESULT_STATUS_FIELD (expect ACTIVE):", activateRes.body?.status);

  const finalPass =
    refreshBeforeSuspend.status === 200 &&
    notFoundRes.status === 404 &&
    notFoundRes.body?.error?.message === "User not found" &&
    (suspendRes.status === 200 || suspendRes.status === 201) &&
    suspendRes.body?.status === "SUSPENDED" &&
    refreshAfterSuspend.status === 401 &&
    (activateRes.status === 200 || activateRes.status === 201) &&
    activateRes.body?.status === "ACTIVE";

  console.log(finalPass ? "RESULT: PASS" : "RESULT: FAIL");
  if (!finalPass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
