import { TokenService, isGuestTokenPayload } from "./tokens";
import type { Env } from "@arutech/config";

const env = {
  JWT_SECRET: "a".repeat(32),
  JWT_ACCESS_EXPIRES_IN: "15m",
  JWT_REFRESH_SECRET: "b".repeat(32),
  JWT_REFRESH_EXPIRES_IN: "30d",
} as unknown as Env;

describe("TokenService", () => {
  describe("access tokens", () => {
    it("round-trips sign/verify", () => {
      const service = new TokenService(env);
      const token = service.signAccessToken({
        sub: "user-1",
        email: "a@b.com",
        systemRole: "USER",
        sessionId: "session-1",
      });

      expect(service.verifyAccessToken(token)).toMatchObject({ sub: "user-1", email: "a@b.com" });
    });

    // Access tokens and guest tokens share JWT_SECRET (see the class's own
    // doc comment) — a bare jwt.verify can't tell them apart by signature
    // alone, only this explicit discriminator check can.
    it("refuses to treat a guest token as an access token", () => {
      const service = new TokenService(env);
      const guestToken = service.signGuestToken({ sub: "participant-1", meetingId: "meeting-1", kind: "guest" });

      expect(() => service.verifyAccessToken(guestToken)).toThrow("Not an access token");
    });
  });

  describe("guest tokens", () => {
    it("round-trips sign/verify", () => {
      const service = new TokenService(env);
      const token = service.signGuestToken({ sub: "participant-1", meetingId: "meeting-1", kind: "guest" });

      expect(service.verifyGuestToken(token)).toMatchObject({
        sub: "participant-1",
        meetingId: "meeting-1",
        kind: "guest",
      });
    });

    it("refuses to treat an access token as a guest token", () => {
      const service = new TokenService(env);
      const accessToken = service.signAccessToken({
        sub: "user-1",
        email: "a@b.com",
        systemRole: "USER",
        sessionId: "session-1",
      });

      expect(() => service.verifyGuestToken(accessToken)).toThrow("Not a guest token");
    });
  });

  describe("verifyAnyToken / isGuestTokenPayload", () => {
    it("discriminates a real access token", () => {
      const service = new TokenService(env);
      const token = service.signAccessToken({
        sub: "user-1",
        email: "a@b.com",
        systemRole: "USER",
        sessionId: "session-1",
      });

      const payload = service.verifyAnyToken(token);
      expect(isGuestTokenPayload(payload)).toBe(false);
    });

    it("discriminates a guest token", () => {
      const service = new TokenService(env);
      const token = service.signGuestToken({ sub: "participant-1", meetingId: "meeting-1", kind: "guest" });

      const payload = service.verifyAnyToken(token);
      expect(isGuestTokenPayload(payload)).toBe(true);
      if (isGuestTokenPayload(payload)) {
        expect(payload.meetingId).toBe("meeting-1");
      }
    });
  });
});
