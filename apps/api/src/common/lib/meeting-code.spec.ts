import { generateLiveKitRoomName, generateMeetingCode } from "./meeting-code";

describe("generateMeetingCode", () => {
  it("produces a three-segment, dash-separated, lowercase code", () => {
    const code = generateMeetingCode();
    expect(code).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  });

  it("never contains visually-ambiguous characters", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateMeetingCode();
      expect(code).not.toMatch(/[l1o0]/);
    }
  });

  it("generates distinct codes across calls", () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateMeetingCode()));
    expect(codes.size).toBe(100);
  });
});

describe("generateLiveKitRoomName", () => {
  it("prefixes the meeting code", () => {
    expect(generateLiveKitRoomName("abcd-efgh-jkmn")).toBe("meeting-abcd-efgh-jkmn");
  });
});
