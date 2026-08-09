import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AuthenticatedUser } from "../types/authenticated-user";

/** Injects the authenticated user attached to the request by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
