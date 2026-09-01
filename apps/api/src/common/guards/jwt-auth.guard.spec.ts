import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { TokenService, type AccessTokenPayload, type GuestTokenPayload } from "../lib/tokens";

function makeContext(authorization: string | undefined): {
  context: ExecutionContext;
  request: { headers: { authorization?: string }; user?: unknown };
} {
  const request: { headers: { authorization?: string }; user?: unknown } = {
    headers: { authorization },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { context, request };
}

function makeReflector(isPublic: boolean): Reflector {
  return { getAllAndOverride: jest.fn().mockReturnValue(isPublic) } as unknown as Reflector;
}

describe("JwtAuthGuard", () => {
  it("lets a @Public() route through with no token at all", () => {
    const tokens = { verifyAnyToken: jest.fn() } as unknown as TokenService;
    const guard = new JwtAuthGuard(tokens, makeReflector(true));
    const { context } = makeContext(undefined);

    expect(guard.canActivate(context)).toBe(true);
    expect(tokens.verifyAnyToken).not.toHaveBeenCalled();
  });

  it("rejects a missing bearer header on a non-public route", () => {
    const tokens = { verifyAnyToken: jest.fn() } as unknown as TokenService;
    const guard = new JwtAuthGuard(tokens, makeReflector(false));
    const { context } = makeContext(undefined);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("rejects an unverifiable token", () => {
    const tokens = {
      verifyAnyToken: jest.fn().mockImplementation(() => {
        throw new Error("bad signature");
      }),
    } as unknown as TokenService;
    const guard = new JwtAuthGuard(tokens, makeReflector(false));
    const { context } = makeContext("Bearer garbage");

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it("attaches a real user's id/email/systemRole from an access token payload", () => {
    const payload: AccessTokenPayload = {
      sub: "user-1",
      email: "a@b.com",
      systemRole: "USER",
      sessionId: "session-1",
    };
    const tokens = { verifyAnyToken: jest.fn().mockReturnValue(payload) } as unknown as TokenService;
    const guard = new JwtAuthGuard(tokens, makeReflector(false));
    const { context, request } = makeContext("Bearer real-token");

    expect(guard.canActivate(context)).toBe(true);
    expect(request.user).toEqual({ id: "user-1", email: "a@b.com", systemRole: "USER" });
  });

  // The security-critical branch: a guest token must never be able to make
  // itself look like — or carry the privileges of — a real user account.
  it("attaches a guest identity (isGuest: true, no real email/systemRole) from a guest token payload", () => {
    const payload: GuestTokenPayload = {
      sub: "guest-participant-1",
      meetingId: "meeting-1",
      kind: "guest",
    };
    const tokens = { verifyAnyToken: jest.fn().mockReturnValue(payload) } as unknown as TokenService;
    const guard = new JwtAuthGuard(tokens, makeReflector(false));
    const { context, request } = makeContext("Bearer guest-token");

    expect(guard.canActivate(context)).toBe(true);
    expect(request.user).toEqual({
      id: "guest-participant-1",
      email: "",
      systemRole: "USER",
      isGuest: true,
    });
  });
});
