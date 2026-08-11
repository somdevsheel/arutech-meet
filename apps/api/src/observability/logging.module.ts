import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import type { Env } from "@arutech/config";

/**
 * Structured (JSON) logging via pino, replacing Nest's default text logger — see
 * docs/deployment.md §Observability. Every request gets a `req.id` correlated
 * with the `x-request-id` header our RequestIdInterceptor already sets
 * (apps/api/src/common/interceptors/request-id.interceptor.ts), so a single ID
 * ties together the access log line, any error log lines, and the response
 * header a client/support ticket would reference.
 *
 * `redact` is not optional decoration — per docs/security.md and spec §47,
 * passwords/tokens/secrets must never reach a log line, structured or not.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: ["ENV"],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          genReqId: (req: { headers: Record<string, unknown> }) =>
            (req.headers["x-request-id"] as string) ?? undefined,
          redact: {
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              'req.headers["set-cookie"]',
              "res.headers['set-cookie']",
              "req.body.password",
              "req.body.refreshToken",
              "req.body.accessToken",
              "req.body.token",
            ],
            censor: "[REDACTED]",
          },
          transport:
            env.NODE_ENV === "development"
              ? { target: "pino-pretty", options: { colorize: true, singleLine: true } }
              : undefined,
          autoLogging: {
            ignore: (req: { url?: string }) => req.url === "/health" || req.url === "/metrics",
          },
        },
      }),
    }),
  ],
  exports: [LoggerModule],
})
export class ObservabilityLoggingModule {}
