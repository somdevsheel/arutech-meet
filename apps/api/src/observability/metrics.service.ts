import { Injectable, OnModuleInit } from "@nestjs/common";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

/**
 * Prometheus metrics — see docs/deployment.md §Observability. `collectDefaultMetrics`
 * covers the standard Node process metrics (CPU, memory, event loop lag, GC);
 * everything below is domain-specific and updated by the code that actually
 * knows when these numbers change (the metrics service itself never polls).
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();

  readonly httpRequestsTotal = new Counter({
    name: "arutech_http_requests_total",
    help: "Total HTTP requests handled",
    labelNames: ["method", "route", "status"] as const,
    registers: [this.registry],
  });

  readonly httpRequestDurationSeconds = new Histogram({
    name: "arutech_http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status"] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  readonly websocketConnections = new Gauge({
    name: "arutech_websocket_connections",
    help: "Currently connected app-level WebSocket clients (this instance only)",
    registers: [this.registry],
  });

  readonly activeMeetings = new Gauge({
    name: "arutech_active_meetings",
    help: "Meetings currently LIVE (polled periodically — see AdminStatsService.getDashboardStats " +
      "for the on-demand equivalent used by the admin dashboard)",
    registers: [this.registry],
  });

  readonly recordingFailuresTotal = new Counter({
    name: "arutech_recording_failures_total",
    help: "Recordings that ended in FAILED status",
    registers: [this.registry],
  });

  onModuleInit() {
    collectDefaultMetrics({ register: this.registry, prefix: "arutech_process_" });
  }
}
