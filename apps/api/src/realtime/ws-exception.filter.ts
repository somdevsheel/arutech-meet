import { ArgumentsHost, Catch, ExceptionFilter, Logger } from "@nestjs/common";
import type { Socket } from "socket.io";
import { ZodError } from "zod";
import { WS_EVENTS } from "@arutech/types";
import { formatZodIssues } from "../common/lib/format-zod-issues";

/** Converts thrown errors in gateway message handlers into a client-safe `error` event
 * instead of crashing the socket connection or leaking internals. */
@Catch()
export class WsExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("WsExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<Socket>();

    if (exception instanceof ZodError) {
      // M-3: same raw-field-name issue as the REST paths — see format-zod-issues.ts.
      client.emit(WS_EVENTS.ERROR, { message: formatZodIssues(exception.issues) });
      return;
    }

    const message = exception instanceof Error ? exception.message : "Unexpected error";
    this.logger.warn(`WS handler error: ${message}`);
    client.emit(WS_EVENTS.ERROR, { message: "Something went wrong" });
  }
}
