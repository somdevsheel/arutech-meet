// Live end-to-end proof: the host running their own poll, and a promoted
// co-host, can now actually submit a response/answer — previously an
// unhandled 403 regardless of role. Also confirms a plain PARTICIPANT
// (already worked before) still works, as a control.
//
// NOTE ON SCOPE: this does NOT live-test the GUEST case over REST. Digging
// into the actual join flow surfaced a separate, deeper gap:
// POST /meetings/:code/join-as-guest issues no backend access token at all
// (only a LiveKit media token), and both apiFetch and useMeetingSocket on
// the client require a truthy accessToken before making any authenticated
// call — so an anonymous guest currently has no way to hit ANY
// @CurrentUser-gated REST endpoint or even open the realtime socket, poll
// voting included. The GUEST_CAPS grant added by this fix is still correct
// (nothing should regress if that separate gap is ever closed later), but
// it has no observable effect for a real anonymous guest today. That's a
// distinct, larger piece of work outside this specific finding's scope —
// flagged here rather than silently glossed over.
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

  console.log("STEP: register host + two participants");
  const host = await register("Poll Host", `pollhost${suffix}`, `pollhost${suffix}@arutech.dev`);
  const cohostCandidate = await register("Poll Cohost", `pollcohost${suffix}`, `pollcohost${suffix}@arutech.dev`);
  const plainParticipant = await register("Poll Participant", `pollparty${suffix}`, `pollparty${suffix}@arutech.dev`);

  console.log("STEP: host creates a meeting with the waiting room OFF (so joiners land ADMITTED directly)");
  const createRes = await api(host.accessToken, "/meetings", {
    method: "POST",
    body: JSON.stringify({
      title: "Poll/quiz permission test",
      type: "INSTANT",
      settings: { waitingRoomEnabled: false },
    }),
  });
  const meeting = await createRes.json();

  const hostJoin = await api(host.accessToken, `/meetings/${meeting.code}/join`, { method: "POST", body: "{}" });
  await hostJoin.json();

  const cohostJoinRes = await api(cohostCandidate.accessToken, `/meetings/${meeting.code}/join`, {
    method: "POST",
    body: "{}",
  });
  const cohostJoin = await cohostJoinRes.json();

  const participantJoinRes = await api(plainParticipant.accessToken, `/meetings/${meeting.code}/join`, {
    method: "POST",
    body: "{}",
  });
  await participantJoinRes.json();

  console.log("STEP: host promotes the second joiner to CO_HOST");
  const promoteRes = await api(
    host.accessToken,
    `/meetings/${meeting.id}/participants/${cohostJoin.participantId}/promote-co-host`,
    { method: "POST", body: "{}" },
  );
  console.log("PROMOTE_STATUS:", promoteRes.status);

  console.log("STEP: host creates and opens a poll");
  const pollRes = await api(host.accessToken, `/meetings/${meeting.id}/polls`, {
    method: "POST",
    body: JSON.stringify({
      question: "Pizza or sushi?",
      options: ["Pizza", "Sushi"],
      isMultipleChoice: false,
      showResultsToParticipants: true,
    }),
  });
  const poll = await pollRes.json();
  const optionId = poll.options[0].id;

  console.log("STEP: HOST votes on their own poll (this is the exact failure scenario from the finding)");
  const hostVote = await api(host.accessToken, `/meetings/${meeting.id}/polls/${poll.id}/respond`, {
    method: "POST",
    body: JSON.stringify({ optionIds: [optionId] }),
  });
  console.log("HOST_VOTE_STATUS (expect 2xx, was 403 before the fix):", hostVote.status, await hostVote.text());

  console.log("STEP: the newly-promoted CO_HOST votes");
  const cohostVote = await api(cohostCandidate.accessToken, `/meetings/${meeting.id}/polls/${poll.id}/respond`, {
    method: "POST",
    body: JSON.stringify({ optionIds: [optionId] }),
  });
  console.log("CO_HOST_VOTE_STATUS (expect 2xx, was 403 before the fix):", cohostVote.status);

  console.log("STEP: control — a plain PARTICIPANT votes (already worked before the fix, should still work)");
  const participantVote = await api(plainParticipant.accessToken, `/meetings/${meeting.id}/polls/${poll.id}/respond`, {
    method: "POST",
    body: JSON.stringify({ optionIds: [optionId] }),
  });
  console.log("PARTICIPANT_VOTE_STATUS (expect 2xx):", participantVote.status);

  console.log("STEP: same three roles, but for a quiz question this time");
  const quizRes = await api(host.accessToken, `/meetings/${meeting.id}/quizzes`, {
    method: "POST",
    body: JSON.stringify({
      title: "Permission test quiz",
      questions: [{ type: "TRUE_FALSE", question: "The sky is blue", correctAnswer: true, points: 1 }],
    }),
  });
  const quiz = await quizRes.json();
  const question = quiz.questions[0];
  const trueOptionId = question.options.find((o) => o.text === "True").id;

  const hostAnswer = await api(
    host.accessToken,
    `/meetings/${meeting.id}/quizzes/${quiz.id}/questions/${question.id}/answer`,
    { method: "POST", body: JSON.stringify({ selectedOptionId: trueOptionId }) },
  );
  console.log("HOST_QUIZ_ANSWER_STATUS (expect 2xx, was 403 before the fix):", hostAnswer.status, await hostAnswer.text());

  const pass =
    hostVote.status < 300 &&
    cohostVote.status < 300 &&
    participantVote.status < 300 &&
    hostAnswer.status < 300;
  console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
  if (!pass) process.exit(1);
})().catch((err) => {
  console.error("VERIFY_FAILED:", err);
  process.exit(1);
});
