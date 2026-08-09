import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { TokenService } from "../lib/tokens";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

/**
 * Verifies the `Authorization: Bearer <accessToken>` header and attaches
 * `request.user`. This is the ONLY place access tokens are trusted — every
 * downstream authorization decision (RBAC, meeting permissions) reads from
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
      const payload = this.tokens.verifyAccessToken(token);
      (request as Request & { user: unknown }).user = {
        id: payload.sub,
        email: payload.email,
        systemRole: payload.systemRole,
      };
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired access token");
    }
  }
}
