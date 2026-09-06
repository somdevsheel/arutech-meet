import {
  ConflictException,
  Injectable,
  Inject,
  UnauthorizedException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { nanoid } from "nanoid";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { TokenService } from "../common/lib/tokens";
import { sha256Hex } from "../common/lib/hash";
import { parseDurationMs } from "../common/lib/duration";
import { MailService } from "../mail/mail.service";
import type { Env } from "@arutech/config";
import type { LoginDto, RegisterDto } from "@arutech/validation";

/** How long a password-reset link stays valid. Short enough that a leaked/
 * intercepted email is only a narrow window of risk, long enough that
 * someone doesn't have to drop everything the instant they request one. */
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  systemRole: string;
}

function toPublicUser(user: {
  id: string;
  email: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  systemRole: string;
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    username: user.username,
    avatarUrl: user.avatarUrl,
    systemRole: user.systemRole,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    @Inject("ENV") private readonly env: Env,
  ) {}

  async register(dto: RegisterDto, req: { userAgent?: string; ip?: string }) {
    const existing = await this.prisma.client.user.findFirst({
      where: { OR: [{ email: dto.email }, { username: dto.username }] },
    });
    if (existing) {
      throw new ConflictException("Email or username already in use");
    }

    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.client.user.create({
      data: {
        email: dto.email,
        passwordHash,
        displayName: dto.displayName,
        username: dto.username,
        timezone: dto.timezone ?? "UTC",
      },
    });

    // TODO(stage 2 follow-up): send a real verification email via services/notifications
    // (SMTP is configured in env but the email-sending worker is not wired up yet).

    const authTokens = await this.issueTokens(user.id, req);
    return { user: toPublicUser(user), ...authTokens };
  }

  async login(dto: LoginDto, req: { userAgent?: string; ip?: string }) {
    const user = await this.prisma.client.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException("Invalid email or password");
    }
    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) {
      throw new UnauthorizedException("Invalid email or password");
    }
    if (user.status !== "ACTIVE") {
      throw new UnauthorizedException("Account is not active");
    }

    const authTokens = await this.issueTokens(user.id, req);
    return { user: toPublicUser(user), ...authTokens };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload;
    try {
      payload = this.tokens.verifyRefreshToken(refreshToken);
    } catch {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    const session = await this.prisma.client.session.findUnique({
      where: { id: payload.sessionId },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException("Session no longer valid");
    }

    if (session.refreshTokenHash !== sha256Hex(refreshToken)) {
      // Token doesn't match what we last issued for this session — a
      // forged token, or one from a session already ended (revoked/logged
      // out) elsewhere. Revoke the whole session (breach containment)
      // rather than silently rejecting.
      await this.prisma.client.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException("Refresh token reuse detected; session revoked");
    }

    const user = await this.prisma.client.user.findUnique({ where: { id: session.userId } });
    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException("Account is not active");
    }

    // Real bug this fixes: this used to rotate the refresh token on every
    // single call here (via the same helper login() uses to issue the
    // initial pair) — a brand new refreshTokenHash overwriting the old one,
    // with the mismatch check above then treating the old, now-stale token
    // as "reuse detected" and revoking the WHOLE session outright. That's
    // fine for one browser tab at a time, but every tab of the same login
    // shares this exact refresh token (apps/web's auth store persists it to
    // localStorage, shared by every tab on the same origin) — with a
    // 15-minute access token, two tabs open at once will routinely both
    // need to refresh within moments of each other, and whichever request
    // the server processes second used to find the token already rotated
    // out from under it and get the entire session revoked, forcing a
    // fresh login. Reported by a user as needing to log in constantly.
    //
    // The actual fix: stop rotating here. The client already holds this
    // exact refreshToken (they just sent it), so there's nothing to
    // reissue — only a fresh, short-lived access token is minted. Every
    // tab keeps working off the same stable refresh token for the rest of
    // the session's real lifetime (JWT_REFRESH_EXPIRES_IN), with zero risk
    // of one tab's refresh invalidating another's. The tradeoff (a stolen
    // refresh token stays usable until it naturally expires or the session
    // is revoked, rather than being invalidated on its next legitimate
    // use) is the standard one most apps accept for exactly this reason —
    // and "Active Sessions" (UsersService.revokeSession) already gives a
    // user a real way to kill a specific session if one is compromised.
    await this.prisma.client.session.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });
    const accessToken = this.tokens.signAccessToken({
      sub: user.id,
      email: user.email,
      systemRole: user.systemRole as "USER" | "ADMIN",
      sessionId: session.id,
    });
    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(parseDurationMs(this.env.JWT_ACCESS_EXPIRES_IN) / 1000),
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.client.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes the session identified by a (possibly expired) refresh token. Idempotent
   * and intentionally silent on invalid input — logout should never fail loudly. */
  async logoutBySessionToken(refreshToken: string): Promise<void> {
    try {
      const payload = this.tokens.verifyRefreshToken(refreshToken);
      await this.logout(payload.sessionId);
    } catch {
      // Already expired/invalid — nothing to revoke.
    }
  }

  /** Revokes every active session for a user (e.g. "log out of all devices"). */
  async logoutAll(userId: string): Promise<void> {
    await this.prisma.client.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** M-1: requestPasswordResetSchema existed but was never wired to
   * anything. Always resolves the same way regardless of whether the email
   * belongs to a real account — the controller returns an identical "check
   * your email" response either way, since telling a caller "no such
   * account" would let this endpoint enumerate registered emails one probe
   * at a time. */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.client.user.findUnique({ where: { email } });
    if (!user) return;

    const rawToken = nanoid(32);
    await this.prisma.client.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256Hex(rawToken),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      },
    });

    const resetUrl = `${this.env.WEB_URL}/reset-password?token=${rawToken}`;
    // Same reasoning as OrganizationsService's own invite email: a delivery
    // failure shouldn't turn into a 500 for what's fundamentally a
    // best-effort notification — the token row already exists either way,
    // and (unlike an invite) there's no in-app fallback path to fall back
    // to for a signed-out visitor, so this is genuinely the only channel,
    // but failing loudly here would also leak account-existence via timing/
    // error-shape differences that the DB lookup above was just careful to
    // avoid.
    await this.mail.sendPasswordReset({ to: user.email, resetUrl }).catch(() => {});
  }

  /** M-1: the redemption side. A token is single-use (usedAt) and
   * time-boxed (expiresAt) — either makes it invalid, and both failure
   * modes return the same generic message so a client can't distinguish
   * "expired" from "already used" from "never existed" (nothing useful
   * either way, and distinguishing them narrows a guessing attack). */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const resetToken = await this.prisma.client.passwordResetToken.findUnique({
      where: { tokenHash: sha256Hex(token) },
    });
    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      throw new UnauthorizedException("Invalid or expired reset link");
    }

    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.client.$transaction([
      this.prisma.client.user.update({ where: { id: resetToken.userId }, data: { passwordHash } }),
      this.prisma.client.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    // Whoever had the old (leaked/guessed/forgotten) password no longer has
    // a live session either — the same real-world expectation "sign out
    // everywhere" already exists for elsewhere in this app.
    await this.logoutAll(resetToken.userId);
  }

  /** M-2: Settings had no way to change your password at all. Unlike
   * resetPassword above (proves identity via an emailed token, for when
   * you're signed out), this proves identity with the current password —
   * same check login itself makes. Revokes every session afterward
   * (including the caller's own), matching resetPassword's "sign out
   * everywhere" precedent; the client is expected to sign itself out and
   * send the user back to /login immediately on success rather than wait
   * for that to surface as a failed refresh later. */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException("Current password is incorrect");
    }
    const valid = await argon2.verify(user.passwordHash, currentPassword);
    if (!valid) {
      throw new UnauthorizedException("Current password is incorrect");
    }

    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.client.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.logoutAll(userId);
  }

  private async issueTokens(
    userId: string,
    req: { userAgent?: string; ip?: string },
  ): Promise<AuthTokens> {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } });
    const expiresAt = new Date(Date.now() + parseDurationMs(this.env.JWT_REFRESH_EXPIRES_IN));

    const session = await this.prisma.client.session.create({
      data: {
        userId,
        refreshTokenHash: "pending",
        userAgent: req.userAgent,
        ip: req.ip,
        expiresAt,
      },
    });

    return this.issueSessionTokens(session.id, user.id, user.email, user.systemRole);
  }

  /** Signs the token pair for a brand-new session row. Two steps (create the
   * row, then sign tokens referencing its id) because the session's own id
   * has to already exist to go inside the signed payload — `expiresAt` was
   * already set at creation time above, so this only ever needs to fill in
   * the real hash in place of the "pending" placeholder. Called exactly
   * once per login/register, never again for that session afterward — see
   * `refresh()`'s own doc comment for why a refresh no longer calls this
   * (used to, under the name `rotateSession`, back when this was also the
   * refresh path's rotation step). */
  private async issueSessionTokens(
    sessionId: string,
    userId: string,
    email: string,
    systemRole: string,
  ): Promise<AuthTokens> {
    const accessToken = this.tokens.signAccessToken({
      sub: userId,
      email,
      systemRole: systemRole as "USER" | "ADMIN",
      sessionId,
    });
    const refreshToken = this.tokens.signRefreshToken({ sub: userId, sessionId });

    await this.prisma.client.session.update({
      where: { id: sessionId },
      data: {
        refreshTokenHash: sha256Hex(refreshToken),
        lastUsedAt: new Date(),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(parseDurationMs(this.env.JWT_ACCESS_EXPIRES_IN) / 1000),
    };
  }

  static extractRequestMeta(req: Request): { userAgent?: string; ip?: string } {
    return {
      userAgent: req.headers["user-agent"],
      ip: req.ip,
    };
  }
}
