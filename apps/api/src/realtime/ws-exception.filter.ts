import { ArgumentsHost, Catch, ExceptionFilter, Logger } from "@nestjs/common";
import type { Socket } from "socket.io";
import { ZodError } from "zod";
import { WS_EVENTS } from "@arutech/types";

/** Converts thrown errors in gateway message handlers into a client-safe `error` event
 * instead of crashing the socket connection or leaking internals. */
@Catch()
export class WsExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("WsExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<Socket>();

    if (exception instanceof ZodError) {
      client.emit(WS_EVENTS.ERROR, {
        message: exception.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
      return;
    }

    const message = exception instanceof Error ? exception.message : "Unexpected error";
    this.logger.warn(`WS handler error: ${message}`);
    client.emit(WS_EVENTS.ERROR, { message: "Something went wrong" });
  }
}
