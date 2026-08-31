// Live end-to-end proof, at the socket.io protocol level (no browser needed
// — this is a server-side gateway bug, not a UI one): handleDisconnect used
// to derive the meetingId to notify from `client.rooms`, which socket.io's
// own internal cleanup empties before the 'disconnect' event fires — so an
// ungraceful disconnect (closed tab, lost wifi, no LEAVE_MEETING first)
// never actually broadcast PARTICIPANT_LEFT to anyone. Two real sockets,
// two real users, a real join, then A's socket is torn down directly
// (never emitting LEAVE_MEETING) to simulate exactly that.
const { io } = require("socket.io-client");
const WS_URL = "ws://localhost:4000";
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
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function connectSocket(accessToken) {
  return new Promise((resolve, reject) => {
    const socket = io(WS_URL, { auth: { token: accessToken }, transports: ["websocket"] });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
    setTimeout(() => reject(new Error("socket connect timeout")), 10000);
  });
}

function waitForEvent(socket, event, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

(async () => {
  const suffix = Date.now().toString().slice(-6);

  console.log("STEP: register A and B, A creates a meeting, both join via REST");
  const a = await register("Disconnect A", `disca${suffix}`, `disca${suffix}@arutech.dev`);
  const b = await register("Disconnect B", `discb${suffix}`, `discb${suffix}@arutech.dev`);

  const meeting = await api(a.accessToken, "/meetings", {
    method: "POST",
    body: JSON.stringify({ title: "Disconnect test", type: "INSTANT", settings: { waitingRoomEnabled: false } }),
  });
  await api(a.accessToken, `/meetings/${meeting.code}/join`, { method: "POST", body: "{}" });
  await api(b.accessToken, `/meetings/${meeting.code}/join`, { method: "POST", body: "{}" });

  console.log("STEP: both connect real sockets and JOIN_MEETING over the realtime gateway");
  const socketA = await connectSocket(a.accessToken);
  const socketB = await connectSocket(b.accessToken);
  socketA.emit("meeting:join", { meetingId: meeting.id });
  socketB.emit("meeting:join", { meetingId: meeting.id });
  await new Promise((r) => setTimeout(r, 800));

  console.log("STEP: A's socket is torn down directly — NEVER emits LEAVE_MEETING first (simulates a closed tab)");
  const leftPromise = waitForEvent(socketB, "participant:left", 5000);
  socketA.disconnect();
  const payload = await leftPromise;
  console.log("PARTICIPANT_LEFT_RECEIVED_BY_B (expect a payload, was null before the fix):", JSON.stringify(payload));

  const passUngraceful = payload !== null && payload.userId === a.user.id;
  console.log("UNGRACEFUL_DISCONNECT_NOTIFIED (expect true):", passUngraceful);

  console.log("STEP: control — a GRACEFUL leave (LEAVE_MEETING then disconnect) should notify exactly once, not twice");
  const c = await register("Disconnect C", `discc${suffix}`, `discc${suffix}@arutech.dev`);
  await api(c.accessToken, `/meetings/${meeting.code}/join`, { method: "POST", body: "{}" });
  const socketC = await connectSocket(c.accessToken);
  socketC.emit("meeting:join", { meetingId: meeting.id });
  await new Promise((r) => setTimeout(r, 500));

  let bLeftEvents = 0;
  socketB.on("participant:left", (p) => {
    if (p.userId === c.user.id) bLeftEvents += 1;
  });
  socketC.emit("meeting:leave", { meetingId: meeting.id });
  await new Promise((r) => setTimeout(r, 500));
  socketC.disconnect();
  await new Promise((r) => setTimeout(r, 1500));
  console.log("GRACEFUL_LEAVE_THEN_DISCONNECT_EVENT_COUNT (expect exactly 1, not 2):", bLeftEvents);

  const pass = passUngraceful && bLeftEvents === 1;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

  socketB.close();
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("VERIFY_FAILED:", err);
  process.exit(1);
});
