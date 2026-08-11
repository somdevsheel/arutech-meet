import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { SystemAdminGuard } from "./system-admin.guard";

function makeContext(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe("SystemAdminGuard", () => {
  const guard = new SystemAdminGuard();

  it("rejects a request with no authenticated user", () => {
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });

  it("rejects a regular USER, even a correctly-authenticated one", () => {
    expect(() =>
      guard.canActivate(makeContext({ id: "u1", email: "u@x.com", systemRole: "USER" })),
    ).toThrow(ForbiddenException);
  });

  it("rejects a forged/unexpected systemRole value rather than allowing by default", () => {
    expect(() =>
      guard.canActivate(makeContext({ id: "u1", email: "u@x.com", systemRole: "SUPERADMIN" })),
    ).toThrow(ForbiddenException);
  });

  it("allows a user whose token carries systemRole ADMIN", () => {
    expect(
      guard.canActivate(makeContext({ id: "u1", email: "admin@x.com", systemRole: "ADMIN" })),
    ).toBe(true);
  });
});
