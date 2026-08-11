/**
 * OpenTelemetry bootstrap. Must be the FIRST thing required/imported by the
 * process (see main.ts) — instrumentation patches modules (http, express,
 * ioredis) at require-time, so anything imported before this file runs would
 * not be traced.
 *
 * Deliberately opt-in: only starts if OTEL_EXPORTER_OTLP_ENDPOINT is set. Reads
 * process.env directly (not the validated `Env` from @arutech/config) because
 * this must run before the Nest DI container — and therefore before env
 * validation — exists at all.
 *
 * Not exercised against a real OTel collector in this environment (no such
 * service was stood up here) — the wiring follows the OTel Node SDK's
 * documented pattern, but "does a real Jaeger/Tempo/etc. instance receive a
 * trace" has not been verified. See docs/deployment.md §Observability.
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "arutech-meet-api",
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? "0.0.0",
    }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation(), new IORedisInstrumentation()],
  });

  sdk.start();
  // eslint-disable-next-line no-console
  console.log(`[otel] tracing started, exporting to ${endpoint}`);

  const shutdown = () => sdk.shutdown().finally(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
} else {
  // eslint-disable-next-line no-console
  console.log("[otel] OTEL_EXPORTER_OTLP_ENDPOINT not set — tracing disabled");
}
