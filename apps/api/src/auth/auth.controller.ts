import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { AuthService } from "./auth.service";
import { Public } from "../common/decorators/public.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import type { AuthenticatedUser } from "../common/types/authenticated-user";
import {
  loginSchema,
  refreshSchema,
  registerSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  type LoginDto,
  type RefreshDto,
  type RegisterDto,
  type RequestPasswordResetDto,
  type ResetPasswordDto,
} from "@arutech/validation";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post("register")
  register(@Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, AuthService.extractRequestMeta(req));
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("login")
  @HttpCode(HttpStatus.OK)
  login(@Body(new ZodValidationPipe(loginSchema)) dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, AuthService.extractRequestMeta(req));
  }

  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  refresh(@Body(new ZodValidationPipe(refreshSchema)) dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  // Missing @Public() here defeated the comment directly below it: the
  // global JwtAuthGuard (registered as APP_GUARD) rejected the request with
  // 401 before this handler ever ran whenever the access token had already
  // expired — precisely the case this endpoint exists to handle. The real
  // authentication for this route was always logoutBySessionToken's own
  // refresh-token verification, never the access token; @Public() here just
  // stops JwtAuthGuard from redundantly (and wrongly) gatekeeping ahead of
  // it, matching how `refresh` above authenticates the exact same way.
  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body(new ZodValidationPipe(refreshSchema)) dto: RefreshDto) {
    // Logout is authenticated by possession of a valid (still-active) refresh
    // token rather than the access token, so a client can log out even if its
    // access token already expired.
    const payload = dto.refreshToken;
    await this.authService.logoutBySessionToken(payload);
  }

  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  // M-1: throttled the same as login — this is the other endpoint an
  // unauthenticated caller can hammer to either brute-force something or
  // spam someone's inbox with reset emails. Always 200s with the same body
  // regardless of whether the email matches an account (see
  // AuthService.requestPasswordReset's own comment on why).
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("request-password-reset")
  @HttpCode(HttpStatus.OK)
  async requestPasswordReset(
    @Body(new ZodValidationPipe(requestPasswordResetSchema)) dto: RequestPasswordResetDto,
  ) {
    await this.authService.requestPasswordReset(dto.email);
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("reset-password")
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body(new ZodValidationPipe(resetPasswordSchema)) dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.password);
    return { ok: true };
  }
}
