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
  type LoginDto,
  type RefreshDto,
  type RegisterDto,
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
}
