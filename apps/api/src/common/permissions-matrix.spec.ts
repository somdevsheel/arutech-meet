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

  it("never grants a guest more than the minimal chat capability", () => {
    expect(ROLE_CAPABILITIES.GUEST).toEqual(["chat.send"]);
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
});
