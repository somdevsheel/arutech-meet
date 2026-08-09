import { ConflictException, UnauthorizedException } from "@nestjs/common";
import * as argon2 from "argon2";
import { AuthService } from "./auth.service";
import { sha256Hex } from "../common/lib/hash";
import type { PrismaService } from "../prisma/prisma.service";
import type { TokenService } from "../common/lib/tokens";
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
      user: { findFirst: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
      session: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
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

describe("AuthService", () => {
  describe("register", () => {
    it("throws ConflictException when the email or username is already taken", async () => {
      const prisma = makePrismaMock();
      (prisma.client.user.findFirst as jest.Mock).mockResolvedValue({ id: "existing" });
      const service = new AuthService(prisma, makeTokensMock(), makeEnv());

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
      const service = new AuthService(prisma, makeTokensMock(), makeEnv());

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
      const service = new AuthService(prisma, makeTokensMock(), makeEnv());

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
      const service = new AuthService(prisma, tokens, makeEnv());

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
      const service = new AuthService(prisma, tokens, makeEnv());

      await expect(service.refresh("token")).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
