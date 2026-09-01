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
 * A guest's identity for exactly one meeting — nothing else. `sub` is the
 * guest's own MeetingParticipant.id (guests have no User row to reference),
 * and `kind: "guest"` is a hard discriminator so this can never be mistaken
 * for a real AccessTokenPayload even if the shapes ever partially overlap.
 * Deliberately a SEPARATE sign/verify pair from access tokens, not an
 * AccessTokenPayload with fabricated email/systemRole/sessionId fields —
 * that would let a guest token silently pass as a genuine low-privilege
 * user anywhere an AccessTokenPayload is accepted. This type is only ever
 * meant to authenticate the realtime socket and the small set of REST
 * endpoints a guest legitimately needs inside their one meeting (see
 * JwtAuthGuard and PermissionService.getParticipant).
 */
export interface GuestTokenPayload {
  sub: string;
  meetingId: string;
  kind: "guest";
}

/** Narrows the union `verifyAnyToken` returns. A plain inline
 * `"kind" in payload && payload.kind === "guest"` ternary does NOT narrow
 * reliably here — TS can't carry a compound `&&` condition through both
 * branches of a ternary — so every call site uses this named type guard
 * instead of re-deriving the check itself. */
export function isGuestTokenPayload(
  payload: AccessTokenPayload | GuestTokenPayload,
): payload is GuestTokenPayload {
  return "kind" in payload && payload.kind === "guest";
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

  /** Access tokens and guest tokens are signed with the same secret (there's
   * no reason to manage two secrets for this), so a bare `jwt.verify` cannot
   * tell them apart by signature alone — only the payload shape does. This
   * rejects anything carrying the guest discriminator, so a guest token can
   * never be handed to code that only ever asked for a real access token. */
  verifyAccessToken(token: string): AccessTokenPayload {
    const decoded = jwt.verify(token, this.env.JWT_SECRET) as AccessTokenPayload & {
      kind?: string;
    };
    if (decoded.kind === "guest") throw new Error("Not an access token");
    return decoded;
  }

  /** Meeting-length lifetime (matches how long a guest plausibly stays), not
   * the short access-token expiry — a guest has no refresh flow to renew it
   * with, and re-minting one is as simple as calling join-as-guest again,
   * which every reload already does. */
  signGuestToken(payload: GuestTokenPayload): string {
    return jwt.sign(payload, this.env.JWT_SECRET, { expiresIn: "24h" });
  }

  /** Throws if the token doesn't verify OR verifies but isn't actually a
   * guest token (e.g. someone hands this a real access token) — callers
   * must never treat a payload from here as anything but guest-scoped. */
  verifyGuestToken(token: string): GuestTokenPayload {
    const decoded = jwt.verify(token, this.env.JWT_SECRET) as GuestTokenPayload;
    if (decoded.kind !== "guest") throw new Error("Not a guest token");
    return decoded;
  }

  /** For call sites that must accept EITHER a real caller or a meeting guest
   * (the WS gateway's connection handshake, and JwtAuthGuard) — verifies
   * once against the shared secret and returns whichever shape it actually
   * is, discriminated by `"kind" in decoded`. Never guess the type from
   * context; always check the discriminator on the result. */
  verifyAnyToken(token: string): AccessTokenPayload | GuestTokenPayload {
    return jwt.verify(token, this.env.JWT_SECRET) as AccessTokenPayload | GuestTokenPayload;
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
