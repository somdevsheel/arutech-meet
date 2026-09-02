// Must be the very first imports in the process — see the header comments in
// each file for why (OTel patches modules at require-time; Sentry wants to be
// initialized before anything that might throw).
import "./observability/tracing";
import "./observability/sentry";

import "reflect-metadata";
import "./common/lib/bigint-json";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { RequestIdInterceptor } from "./common/interceptors/request-id.interceptor";
import type { Env } from "@arutech/config";

async function bootstrap() {
  // rawBody: true preserves the raw request buffer (req.rawBody) alongside the
  // parsed JSON body, needed to verify the LiveKit webhook's HMAC signature.
  // bufferLogs: true holds log calls made during module initialization until
  // app.useLogger() below swaps in the structured pino logger, so nothing is
  // lost or printed in Nest's default (non-JSON) format before that happens.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  app.useLogger(app.get(Logger));

  // The default JSON body parser (registered above via rawBody: true) only
  // captures req.rawBody for requests whose Content-Type is exactly
  // "application/json" — but LiveKit sends webhooks as
  // "application/webhook+json" (see its webhook docs), a type the default
  // matcher silently ignores. Every LiveKit webhook was therefore arriving
  // with an empty req.body/req.rawBody and failing signature verification in
  // LiveKitWebhookController with a 400, invisibly: no recording ever
  // progressed past PROCESSING, and presence/attendance events derived from
  // webhooks never landed either. Re-registering the json parser to also
  // match LiveKit's content type (still json underneath) fixes this without
  // touching anything else that depends on the default parser.
  app.useBodyParser("json", { type: ["application/json", "application/webhook+json"] });

  const env = app.get<Env>("ENV");

  app.use(helmet());
  app.use(cookieParser(env.COOKIE_SECRET));
  app.enableCors({
    origin: env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
    credentials: true,
    // L-5: `Retry-After` isn't one of the handful of response headers a
    // cross-origin fetch can read by default (Cache-Control, Content-*,
    // Expires, Last-Modified, Pragma) — ThrottlerGuard has always sent a
    // real one on every 429 (confirmed live: `Retry-After: 60`), but the
    // browser was silently hiding it from `response.headers.get(...)`
    // without this, no matter what the client-side code did with it.
    exposedHeaders: ["Retry-After"],
  });

  // Per-route body/query validation is done via ZodValidationPipe (see
  // common/pipes/zod-validation.pipe.ts) against schemas from @arutech/validation,
  // applied explicitly on each controller method so the schema used is always
  // visible at the call site rather than inferred from decorator metadata.
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor());

  app.setGlobalPrefix("api/v1", { exclude: ["health", "metrics", "docs"] });

  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Arutech Meet API")
    .setDescription(
      "REST API for the Arutech Meet video meeting, classroom, and calling platform.",
    )
    .setVersion("0.1.0")
    .addBearerAuth()
    .addTag("auth")
    .addTag("users")
    .addTag("organizations")
    .addTag("meetings")
    .addTag("meetings/participants")
    .addTag("meetings/chat")
    .addTag("meetings/recordings")
    .addTag("classes")
    .addTag("admin")
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document);

  await app.listen(env.API_PORT);
  app.get(Logger).log(
    { port: env.API_PORT },
    "Arutech Meet API listening (docs at /docs, metrics at /metrics)",
  );
}

bootstrap();
