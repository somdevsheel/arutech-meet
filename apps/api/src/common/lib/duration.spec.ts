import { parseDurationMs } from "./duration";

describe("parseDurationMs", () => {
  it("parses seconds/minutes/hours/days", () => {
    expect(parseDurationMs("30s")).toBe(30_000);
    expect(parseDurationMs("15m")).toBe(15 * 60_000);
    expect(parseDurationMs("2h")).toBe(2 * 60 * 60_000);
    expect(parseDurationMs("30d")).toBe(30 * 24 * 60 * 60_000);
  });

  it("throws on an invalid format", () => {
    expect(() => parseDurationMs("abc")).toThrow();
    expect(() => parseDurationMs("15")).toThrow();
    expect(() => parseDurationMs("15x")).toThrow();
  });
});
