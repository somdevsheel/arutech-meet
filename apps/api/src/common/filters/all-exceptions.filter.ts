import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodError } from "zod";
import { Sentry } from "../../observability/sentry";

/**
 * Converts every thrown error into a structured, client-safe JSON error body.
 * Never leaks stack traces or internal messages for unexpected (5xx) errors.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("ExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();
    const requestId = request.id ?? "unknown";

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = "Internal server error";
    let code = "INTERNAL_ERROR";

    if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      code = "VALIDATION_ERROR";
      message = exception.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      code = HttpStatus[status] ?? "ERROR";
      message =
        typeof body === "string"
          ? body
          : ((body as { message?: string | string[] }).message ?? exception.message);
    } else if (exception instanceof Error) {
      // Unexpected (5xx-class) error: log full detail server-side, report it to
      // Sentry (no-op if SENTRY_DSN isn't configured — see observability/sentry.ts),
      // and return only a safe generic message to the client.
      this.logger.error(
        JSON.stringify({ requestId, message: exception.message, stack: exception.stack }),
      );
      Sentry.captureException(exception, { tags: { requestId } });
    }

    response.status(status).json({
      error: {
        code,
        message,
        requestId,
        timestamp: new Date().toISOString(),
        path: request.url,
      },
    });
  }
}
