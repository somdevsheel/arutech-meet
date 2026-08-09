import jwt from "jsonwebtoken";
import type { Env } from "@arutech/config";
import type { SystemRole } from "@arutech/types";

export interface AccessTokenPayload {
  sub: string;
  email: string;
  systemRole: SystemRole;
  sessionId: string;
}

export interface RefreshTokenPayload {
  sub: string;
  sessionId: string;
}

/**
 * Thin wrapper around jsonwebtoken for access/refresh token sign+verify.
 * Access tokens are short-lived and carry the user's systemRole so most requests
 * avoid a DB round trip; that role snapshot is stale for at most JWT_ACCESS_EXPIRES_IN.
 * Refresh tokens are opaque-ish (just sub+sessionId) — the actual validity check is
 * against the hashed token stored in the `sessions` table (see AuthService), so a
 * refresh token can be revoked server-side even though it is a signed JWT.
 */
export class TokenService {
  constructor(private readonly env: Env) {}

  signAccessToken(payload: AccessTokenPayload): string {
    return jwt.sign(payload, this.env.JWT_SECRET, {
      expiresIn: this.env.JWT_ACCESS_EXPIRES_IN,
    } as jwt.SignOptions);
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    return jwt.verify(token, this.env.JWT_SECRET) as AccessTokenPayload;
  }

  signRefreshToken(payload: RefreshTokenPayload): string {
    return jwt.sign(payload, this.env.JWT_REFRESH_SECRET, {
      expiresIn: this.env.JWT_REFRESH_EXPIRES_IN,
    } as jwt.SignOptions);
  }

  verifyRefreshToken(token: string): RefreshTokenPayload {
    return jwt.verify(token, this.env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
  }
}
