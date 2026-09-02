import { ConflictException, UnauthorizedException } from "@nestjs/common";
import * as argon2 from "argon2";
import { AuthService } from "./auth.service";
import { sha256Hex } from "../common/lib/hash";
import type { PrismaService } from "../prisma/prisma.service";
import type { TokenService } from "../common/lib/tokens";
import type { MailService } from "../mail/mail.service";
import type { Env } from "@arutech/config";

function makeEnv(): Env {
  return {
    JWT_ACCESS_EXPIRES_IN: "15m",
    JWT_REFRESH_EXPIRES_IN: "30d",
  } as Env;
}

function makePrismaMock() {
  return {
    client: {
      user: { findFirst: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
      session: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
      passwordResetToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    },
  } as unknown as PrismaService;
}

function makeTokensMock() {
  return {
    signAccessToken: jest.fn(() => "access-token"),
    verifyAccessToken: jest.fn(),
    signRefreshToken: jest.fn(() => "refresh-token"),
    verifyRefreshToken: jest.fn(),
  } as unknown as TokenService;
}

function makeMailMock() {
  return {
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
  } as unknown as MailService;
}

describe("AuthService", () => {
  describe("register", () => {
    it("throws ConflictException when the email or username is already taken", async () => {
      const prisma = makePrismaMock();
      (prisma.client.user.findFirst as jest.Mock).mockResolvedValue({ id: "existing" });
      const service = new AuthService(prisma, makeTokensMock(), makeMailMock(), makeEnv());

      await expect(
        service.register(
          { email: "a@b.com", password: "Password123!", displayName: "A", username: "a" },
          {},
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("login", () => {
    it("rejects an unknown email without revealing whether the account exists", async () => {
      const prisma = makePrismaMock();
      (prisma.client.user.findUnique as jest.Mock).mockResolvedValue(null);
      const service = new AuthService(prisma, makeTokensMock(), makeMailMock(), makeEnv());

      await expect(
        service.login({ email: "nobody@arutech.dev", password: "whatever" }, {}),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("rejects an incorrect password", async () => {
      const prisma = makePrismaMock();
      const passwordHash = await argon2.hash("CorrectPassword1");
      (prisma.client.user.findUnique as jest.Mock).mockResolvedValue({
        id: "u1",
        passwordHash,
        status: "ACTIVE",
      });
      const service = new AuthService(prisma, makeTokensMock(), makeMailMock(), makeEnv());

      await expect(
        service.login({ email: "u@arutech.dev", password: "WrongPassword" }, {}),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe("refresh — reuse detection", () => {
    it("revokes the session and rejects when the presented token doesn't match the stored hash", async () => {
      const prisma = makePrismaMock();
      const tokens = makeTokensMock();
      (tokens.verifyRefreshToken as jest.Mock).mockReturnValue({ sub: "u1", sessionId: "s1" });
      (prisma.client.session.findUnique as jest.Mock).mockResolvedValue({
        id: "s1",
        userId: "u1",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        refreshTokenHash: sha256Hex("a-different-token-than-was-presented"),
      });
      const service = new AuthService(prisma, tokens, makeMailMock(), makeEnv());

      await expect(service.refresh("stale-or-forged-refresh-token")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.client.session.update).toHaveBeenCalledWith({
        where: { id: "s1" },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it("rejects a token for an already-revoked session", async () => {
      const prisma = makePrismaMock();
      const tokens = makeTokensMock();
      (tokens.verifyRefreshToken as jest.Mock).mockReturnValue({ sub: "u1", sessionId: "s1" });
      (prisma.client.session.findUnique as jest.Mock).mockResolvedValue({
        id: "s1",
        userId: "u1",
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
        refreshTokenHash: sha256Hex("token"),
      });
      const service = new AuthService(prisma, tokens, makeMailMock(), makeEnv());

      await expect(service.refresh("token")).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  // M-1: requestPasswordResetSchema/resetPasswordSchema existed but nothing
  // ever called them — this is the actual fix, so it gets real coverage.
  describe("requestPasswordReset", () => {
    it("does nothing observable for an email with no account (no enumeration)", async () => {
      const prisma = makePrismaMock();
      (prisma.client.user.findUnique as jest.Mock).mockResolvedValue(null);
      const mail = makeMailMock();
      const service = new AuthService(prisma, makeTokensMock(), mail, makeEnv());

      await service.requestPasswordReset("nobody@arutech.dev");

      expect(prisma.client.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    });

    it("creates a hashed, time-boxed token and emails a reset link for a real account", async () => {
      const prisma = makePrismaMock();
      (prisma.client.user.findUnique as jest.Mock).mockResolvedValue({ id: "u1", email: "u@arutech.dev" });
      const mail = makeMailMock();
      const env = { ...makeEnv(), WEB_URL: "https://app.test" } as ReturnType<typeof makeEnv>;
      const service = new AuthService(prisma, makeTokensMock(), mail, env);

      await service.requestPasswordReset("u@arutech.dev");

      const createArgs = (prisma.client.passwordResetToken.create as jest.Mock).mock.calls[0][0];
      expect(createArgs.data.userId).toBe("u1");
      expect(createArgs.data.tokenHash).toEqual(expect.any(String));
      // The raw token itself must never be what's stored.
      expect(createArgs.data.tokenHash).not.toContain("u1");
      expect(createArgs.data.expiresAt.getTime()).toBeGreaterThan(Date.now());

      expect(mail.sendPasswordReset).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "u@arutech.dev",
          resetUrl: expect.stringContaining("https://app.test/reset-password?token="),
        }),
      );
    });

    it("never throws even if the mail send fails", async () => {
      const prisma = makePrismaMock();
      (prisma.client.user.findUnique as jest.Mock).mockResolvedValue({ id: "u1", email: "u@arutech.dev" });
      const mail = { sendPasswordReset: jest.fn().mockRejectedValue(new Error("SMTP down")) } as unknown as MailService;
      const service = new AuthService(prisma, makeTokensMock(), mail, makeEnv());

      await expect(service.requestPasswordReset("u@arutech.dev")).resolves.toBeUndefined();
    });
  });

  describe("resetPassword", () => {
    it("rejects an unknown token", async () => {
      const prisma = makePrismaMock();
      (prisma.client.passwordResetToken.findUnique as jest.Mock).mockResolvedValue(null);
      const service = new AuthService(prisma, makeTokensMock(), makeMailMock(), makeEnv());

      await expect(service.resetPassword("bogus-token", "NewPassword1")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.client.user.update).not.toHaveBeenCalled();
    });

    it("rejects an already-used token", async () => {
      const prisma = makePrismaMock();
      (prisma.client.passwordResetToken.findUnique as jest.Mock).mockResolvedValue({
        id: "t1",
        userId: "u1",
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });
      const service = new AuthService(prisma, makeTokensMock(), makeMailMock(), makeEnv());

      await expect(service.resetPassword("used-token", "NewPassword1")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("rejects an expired token", async () => {
      const prisma = makePrismaMock();
      (prisma.client.passwordResetToken.findUnique as jest.Mock).mockResolvedValue({
        id: "t1",
        userId: "u1",
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });
      const service = new AuthService(prisma, makeTokensMock(), makeMailMock(), makeEnv());

      await expect(service.resetPassword("expired-token", "NewPassword1")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("updates the password, marks the token used, and revokes every session for a valid token", async () => {
      const prisma = makePrismaMock();
      (prisma.client.passwordResetToken.findUnique as jest.Mock).mockResolvedValue({
        id: "t1",
        userId: "u1",
        usedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });
      const service = new AuthService(prisma, makeTokensMock(), makeMailMock(), makeEnv());

      await service.resetPassword("valid-token", "NewPassword1");

      expect(prisma.client.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "u1" }, data: { passwordHash: expect.any(String) } }),
      );
      expect(prisma.client.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: "t1" },
        data: { usedAt: expect.any(Date) },
      });
      expect(prisma.client.session.updateMany).toHaveBeenCalledWith({
        where: { userId: "u1", revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  // M-2: Settings had no way to change your password — this is the actual
  // fix, so it gets real coverage, mirroring resetPassword's tests above.
  describe("changePassword", () => {
    it("rejects an incorrect current password", async () => {
      const prisma = makePrismaMock();
      const passwordHash = await argon2.hash("CorrectPassword1");
      (prisma.client.user.findUnique as jest.Mock).mockResolvedValue({ id: "u1", passwordHash });
      const service = new AuthService(prisma, makeTokensMock(), makeMailMock(), makeEnv());

      await expect(service.changePassword("u1", "WrongPassword1", "NewPassword1")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.client.user.update).not.toHaveBeenCalled();
    });

    it("rejects an unknown user", async () => {
      const prisma = makePrismaMock();
      (prisma.client.user.findUnique as jest.Mock).mockResolvedValue(null);
      const service = new AuthService(prisma, makeTokensMock(), makeMailMock(), makeEnv());

      await expect(service.changePassword("nobody", "whatever", "NewPassword1")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("updates the password and revokes every session given the correct current password", async () => {
      const prisma = makePrismaMock();
      const passwordHash = await argon2.hash("CorrectPassword1");
      (prisma.client.user.findUnique as jest.Mock).mockResolvedValue({ id: "u1", passwordHash });
      const service = new AuthService(prisma, makeTokensMock(), makeMailMock(), makeEnv());

      await service.changePassword("u1", "CorrectPassword1", "NewPassword1");

      expect(prisma.client.user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: { passwordHash: expect.any(String) },
      });
      expect(prisma.client.session.updateMany).toHaveBeenCalledWith({
        where: { userId: "u1", revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
