/**
 * Sentry error tracking bootstrap. Opt-in via SENTRY_DSN — a missing DSN means
 * `Sentry.captureException` calls elsewhere (see AllExceptionsFilter) become
 * silent no-ops rather than the app crashing or needing conditional checks at
 * every call site. Not exercised against a real Sentry project in this
 * environment (no DSN configured here) — see docs/deployment.md §Observability.
 */
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    profilesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    // Never send request bodies/headers by default — they can contain the same
    // secrets docs/security.md tells us to keep out of logs (passwords, tokens).
    sendDefaultPii: false,
  });
  // eslint-disable-next-line no-console
  console.log("[sentry] error tracking enabled");
}

export { Sentry };
