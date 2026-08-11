import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import type { Request, Response } from "express";
import { tap } from "rxjs";
import { MetricsService } from "./metrics.service";

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() !== "http") return next.handle();

    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();
    const start = process.hrtime.bigint();

    // Use the matched route pattern ("/meetings/:id"), not the raw URL, so a
    // metric label doesn't explode into one series per unique meeting ID.
    const route = request.route?.path ? `${request.baseUrl}${request.route.path}` : request.path;

    return next.handle().pipe(
      tap({
        next: () => this.record(request.method, route, response.statusCode, start),
        error: () =>
          this.record(request.method, route, response.statusCode || 500, start),
      }),
    );
  }

  private record(method: string, route: string, status: number, start: bigint) {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    const labels = { method, route, status: String(status) };
    this.metrics.httpRequestsTotal.inc(labels);
    this.metrics.httpRequestDurationSeconds.observe(labels, durationSeconds);
  }
}
