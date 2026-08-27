import { can, PARTICIPANT_ROLES, ROLE_CAPABILITIES } from "@arutech/types";

describe("centralized capability matrix (@arutech/types)", () => {
  it("grants meeting.end only to owner/host/co-host/teacher-equivalent roles", () => {
    expect(can("HOST", "meeting.end")).toBe(true);
    expect(can("OWNER", "meeting.end")).toBe(true);
    expect(can("TEACHER", "meeting.end")).toBe(true);
    expect(can("PARTICIPANT", "meeting.end")).toBe(false);
    expect(can("GUEST", "meeting.end")).toBe(false);
    expect(can("STUDENT", "meeting.end")).toBe(false);
  });

  // poll.respond/quiz.answer are deliberately granted to every role
  // (including GUEST): unlike poll.create/quiz.create, they're not an
  // author-only action — anyone actually in the meeting should be able to
  // answer a poll/quiz someone else is running. Everything else stays
  // withheld, preserving "guest has no elevated capability" as the actual
  // intent this test guards, not the literal old array.
  it("grants a guest only chat + the ability to answer polls/quizzes, nothing elevated", () => {
    expect(ROLE_CAPABILITIES.GUEST).toEqual(
      expect.arrayContaining(["chat.send", "poll.respond", "quiz.answer"]),
    );
    expect(ROLE_CAPABILITIES.GUEST).toHaveLength(3);
    for (const capability of [
      "meeting.end",
      "participant.remove",
      "poll.create",
      "quiz.create",
      "recording.start",
      "chat.delete_any_message",
    ] as const) {
      expect(can("GUEST", capability)).toBe(false);
    }
  });

  it("lets every meeting role answer a poll or quiz, including hosts, co-hosts, and guests", () => {
    for (const role of PARTICIPANT_ROLES) {
      expect(can(role, "poll.respond")).toBe(true);
      expect(can(role, "quiz.answer")).toBe(true);
    }
  });

  it("defines a capability set for every participant role", () => {
    for (const role of PARTICIPANT_ROLES) {
      expect(Array.isArray(ROLE_CAPABILITIES[role])).toBe(true);
    }
  });

  it("only hosts/co-hosts/teachers can admit from the waiting room", () => {
    expect(can("CO_HOST", "waiting_room.admit")).toBe(true);
    expect(can("STUDENT", "waiting_room.admit")).toBe(false);
    expect(can("PARTICIPANT", "waiting_room.admit")).toBe(false);
  });

  it("grants captions.manage the same tier as recording.start (host/co-host/teacher, not plain participants)", () => {
    for (const role of ["OWNER", "HOST", "CO_HOST", "TEACHER"] as const) {
      expect(can(role, "captions.manage")).toBe(true);
    }
    for (const role of ["PARTICIPANT", "STUDENT", "GUEST"] as const) {
      expect(can(role, "captions.manage")).toBe(false);
    }
  });
});
