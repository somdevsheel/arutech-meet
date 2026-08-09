import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { randomUUID } from "crypto";
import type { Request, Response } from "express";
import { Observable } from "rxjs";

/** Stamps every request with a request ID, propagated into logs and error responses. */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request & { id?: string }>();
    const response = httpContext.getResponse<Response>();

    const requestId = (request.headers["x-request-id"] as string) || randomUUID();
    request.id = requestId;
    response.setHeader("x-request-id", requestId);

    return next.handle();
  }
}
