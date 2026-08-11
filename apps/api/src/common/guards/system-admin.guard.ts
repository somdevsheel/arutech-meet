import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { AuthenticatedUser } from "../types/authenticated-user";

/**
 * Gates the entire admin API surface (apps/api/src/admin/**). Runs after
 * JwtAuthGuard (global) has already attached `request.user` from a verified
 * access token — this only checks the `systemRole` claim embedded in that token,
 * it does not re-verify the token itself. A non-admin gets a 403, not a 404, so
 * the distinction between "route doesn't exist" and "you can't use it" stays
 * honest (no security-by-obscurity).
 */
@Injectable()
export class SystemAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    if (request.user?.systemRole !== "ADMIN") {
      throw new ForbiddenException("Admin access required");
    }
    return true;
  }
}
