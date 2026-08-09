import { z } from "zod";

/**
 * Validated process.env shape for backend services (apps/api, services/*).
 * Fail fast on boot rather than surfacing `undefined` deep in the request path.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().min(1),

  REDIS_URL: z.string().min(1),
  REDIS_PREFIX: z.string().default("arutech"),

  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),
  COOKIE_SECRET: z.string().min(16),

  API_PORT: z.coerce.number().int().positive().default(4000),
  API_URL: z.string().url(),
  WEB_URL: z.string().url(),
  CORS_ORIGINS: z.string().default(""),

  S3_ENDPOINT: z.string().min(1),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  S3_PUBLIC_URL: z.string().optional(),

  LIVEKIT_URL: z.string().min(1),
  LIVEKIT_HTTP_URL: z.string().min(1),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),

  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default("Arutech Meet <no-reply@arutech.dev>"),
  SMTP_SECURE: z.coerce.boolean().default(false),

  AI_PROVIDER: z.string().default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  TRANSCRIPTION_PROVIDER: z.string().default("openai"),

  SENTRY_DSN: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
