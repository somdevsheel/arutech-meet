import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { TokenService, isGuestTokenPayload } from "../lib/tokens";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

/**
 * Verifies the `Authorization: Bearer <token>` header and attaches
 * `request.user`. This is the ONLY place access tokens (or a meeting guest's
 * token — see TokenService.GuestTokenPayload) are trusted — every downstream
 * authorization decision (RBAC, meeting permissions) reads from
 * `request.user`/database state, never from client-supplied role claims.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }

    const token = authHeader.slice("Bearer ".length);
    try {
      const payload = this.tokens.verifyAnyToken(token);
      // A guest's `id` is their own MeetingParticipant.id, not a User.id —
      // see AuthenticatedUser's own doc comment on why email/systemRole here
      // are meaningless placeholders, never to be trusted. Real authorization
      // for a guest still has to come from PermissionService re-checking
      // their actual participant row and role, exactly like everyone else.
      (request as Request & { user: unknown }).user = isGuestTokenPayload(payload)
        ? { id: payload.sub, email: "", systemRole: "USER", isGuest: true }
        : {
            id: payload.sub,
            email: payload.email,
            systemRole: payload.systemRole,
            sessionId: payload.sessionId,
          };
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired access token");
    }
  }
}
