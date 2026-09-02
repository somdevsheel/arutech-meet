import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { ZodError } from "zod";
import { Sentry } from "../../observability/sentry";
import { formatZodIssues } from "../lib/format-zod-issues";

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
      // M-3: same raw-field-name issue as ZodValidationPipe (see
      // format-zod-issues.ts) — this branch catches a ZodError thrown
      // directly (e.g. a manual `.parse()` call) rather than via the pipe.
      status = HttpStatus.BAD_REQUEST;
      code = "VALIDATION_ERROR";
      message = formatZodIssues(exception.issues);
    } else if (exception instanceof ThrottlerException) {
      // H-10: ThrottlerException's own default message is the literal string
      // "ThrottlerException: Too Many Requests" — with no override, that's
      // exactly what `body` below resolves to (its getResponse() is a bare
      // string, not `{ message }`), and it went straight to the user
      // verbatim, on every throttled endpoint, with no indication of what
      // happened or how long to wait. This must come before the generic
      // HttpException branch below — ThrottlerException IS one.
      status = HttpStatus.TOO_MANY_REQUESTS;
      code = "RATE_LIMITED";
      message = "Too many attempts. Please wait a minute and try again.";
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
