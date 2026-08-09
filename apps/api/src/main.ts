import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { RequestIdInterceptor } from "./common/interceptors/request-id.interceptor";
import type { Env } from "@arutech/config";

async function bootstrap() {
  // rawBody: true preserves the raw request buffer (req.rawBody) alongside the
  // parsed JSON body, needed to verify the LiveKit webhook's HMAC signature.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  const env = app.get<Env>("ENV");

  app.use(helmet());
  app.use(cookieParser(env.COOKIE_SECRET));
  app.enableCors({
    origin: env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
    credentials: true,
  });

  // Per-route body/query validation is done via ZodValidationPipe (see
  // common/pipes/zod-validation.pipe.ts) against schemas from @arutech/validation,
  // applied explicitly on each controller method so the schema used is always
  // visible at the call site rather than inferred from decorator metadata.
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor());

  app.setGlobalPrefix("api/v1", { exclude: ["health", "docs"] });

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
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document);

  await app.listen(env.API_PORT);
  // eslint-disable-next-line no-console
  console.log(`Arutech Meet API listening on :${env.API_PORT} (docs at /docs)`);
}

bootstrap();
