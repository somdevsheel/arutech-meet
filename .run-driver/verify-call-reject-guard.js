// Live end-to-end proof against the real running API: A calls B, B accepts
// (call is now ONGOING, both JOINED) — a stray reject() call from either
// side while the call is genuinely ongoing must be refused, not silently
// mark a live conversation as DECLINED.
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

  console.log("STEP: register A and B");
  const a = await register("Reject Guard A", `rejguarda${suffix}`, `rejguarda${suffix}@arutech.dev`);
  const b = await register("Reject Guard B", `rejguardb${suffix}`, `rejguardb${suffix}@arutech.dev`);

  console.log("STEP: A calls B");
  const initiateRes = await api(a.accessToken, "/calls", {
    method: "POST",
    body: JSON.stringify({ calleeUserIds: [b.user.id], type: "VIDEO" }),
  });
  const call = await initiateRes.json();
  console.log("CALL_ID:", call.callId);

  console.log("STEP: B accepts — call is now ONGOING, both parties JOINED");
  const acceptRes = await api(b.accessToken, `/calls/${call.callId}/accept`, { method: "POST", body: "{}" });
  console.log("ACCEPT_STATUS:", acceptRes.status);

  console.log("STEP: a stray reject() from B (already joined) while the call is genuinely ongoing");
  const strayRejectFromB = await api(b.accessToken, `/calls/${call.callId}/reject`, { method: "POST", body: "{}" });
  console.log(
    "STRAY_REJECT_FROM_B_STATUS (expect 400, was 200/undefined-corruption before the fix):",
    strayRejectFromB.status,
  );

  console.log("STEP: a stray reject() from A too (the initiator, already JOINED since call creation)");
  const strayRejectFromA = await api(a.accessToken, `/calls/${call.callId}/reject`, { method: "POST", body: "{}" });
  console.log("STRAY_REJECT_FROM_A_STATUS (expect 400):", strayRejectFromA.status);

  console.log("STEP: confirm the call is still genuinely ONGOING in the database's own history view — not corrupted");
  const historyRes = await api(a.accessToken, "/calls/history");
  const history = await historyRes.json();
  const thisCall = history.find((c) => c.callId === call.callId);
  console.log("CALL_STATUS_IN_HISTORY (expect ONGOING, was DECLINED before the fix):", thisCall?.status);

  const pass =
    acceptRes.status < 300 &&
    strayRejectFromB.status === 400 &&
    strayRejectFromA.status === 400 &&
    thisCall?.status === "ONGOING";
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("VERIFY_FAILED:", err);
  process.exit(1);
});
