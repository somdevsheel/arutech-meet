// Verifies the actual bug: updateChatRoomSchema's photoUrl was
// `z.string().url().optional()` — allows a real URL or omitting the field
// entirely ("leave it as it is"), but never `null`. There was no way to
// ever express "remove the photo" through the API at all: even if a client
// tried to send `photoUrl: null`, Zod rejected it before ChatService ever
// saw the request. The web form made this worse by converting an emptied
// input into `undefined` (a no-op) rather than attempting `null` at all.
// Once a group photo was set, it was permanently stuck.
//
// This script creates a real group, sets a real photo via a real PATCH,
// confirms it stuck, then actually removes it via the real API (the same
// path the new "Remove photo" button drives) and confirms the room's
// photoUrl is genuinely null afterward — not just "unchanged from some
// other still-set value".
async function apiFetch(fullPath, options = {}) {
  const res = await fetch(`http://localhost:4000/api/v1${fullPath}`, {
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

(async () => {
  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register two real users, one creates a real GROUP room");
  const a = await register("Photo A", `photoa${suffix}`, `photoa${suffix}@arutech.dev`);
  const b = await register("Photo B", `photob${suffix}`, `photob${suffix}@arutech.dev`);
  const roomRes = await apiFetch("/chat-rooms", {
    method: "POST",
    headers: { Authorization: `Bearer ${a.accessToken}` },
    body: JSON.stringify({ type: "GROUP", name: "Photo Test Group", memberUserIds: [b.user.id] }),
  });
  console.log("GROUP_CREATED (expect 201):", roomRes.status);
  const roomId = roomRes.body.id;

  console.log("STEP: admin sets a real photo URL via PATCH — this already worked before the fix");
  const setRes = await apiFetch(`/chat-rooms/${roomId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${a.accessToken}` },
    body: JSON.stringify({ photoUrl: "https://example.com/group-photo.png" }),
  });
  console.log("SET_PHOTO_STATUS (expect 200):", setRes.status);
  console.log("PHOTO_ACTUALLY_SET (expect the real URL):", setRes.body?.photoUrl);

  console.log(
    "STEP: admin now tries to REMOVE the photo by sending photoUrl: null — this is the actual bug under test",
  );
  const clearRes = await apiFetch(`/chat-rooms/${roomId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${a.accessToken}` },
    body: JSON.stringify({ photoUrl: null }),
  });
  console.log(
    "CLEAR_PHOTO_STATUS (expect 200 — before the fix, Zod rejected this as a 400 validation error):",
    clearRes.status,
  );
  console.log(
    "CLEAR_PHOTO_BODY_MESSAGE (if 400, shows the old rejection):",
    clearRes.body?.error?.message,
  );
  console.log(
    "PHOTO_ACTUALLY_NULL_NOW (expect true — was permanently stuck at the URL before the fix):",
    clearRes.body?.photoUrl === null,
  );

  console.log("STEP: confirm the clear genuinely persisted — re-fetch the room fresh");
  const roomsListRes = await apiFetch("/chat-rooms", {
    headers: { Authorization: `Bearer ${a.accessToken}` },
  });
  const refetched = roomsListRes.body.find((r) => r.id === roomId);
  console.log(
    "PHOTO_NULL_ON_FRESH_REFETCH (expect true, not a stale response echo):",
    refetched?.photoUrl === null,
  );

  console.log(
    "STEP: renaming WITHOUT touching photoUrl at all must still leave a real photo untouched (the 'omit = leave as is' half of the fix)",
  );
  await apiFetch(`/chat-rooms/${roomId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${a.accessToken}` },
    body: JSON.stringify({ photoUrl: "https://example.com/second-photo.png" }),
  });
  const renameOnlyRes = await apiFetch(`/chat-rooms/${roomId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${a.accessToken}` },
    body: JSON.stringify({ name: "Renamed Group" }),
  });
  console.log(
    "PHOTO_UNTOUCHED_WHEN_OMITTED (expect the real URL, not null):",
    renameOnlyRes.body?.photoUrl,
  );

  const pass =
    roomRes.status === 201 &&
    setRes.status === 200 &&
    setRes.body?.photoUrl === "https://example.com/group-photo.png" &&
    clearRes.status === 200 &&
    clearRes.body?.photoUrl === null &&
    refetched?.photoUrl === null &&
    renameOnlyRes.body?.photoUrl === "https://example.com/second-photo.png";

  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("DRIVER_FAILED:", err);
  process.exit(1);
});
