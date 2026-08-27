// Direct verification of the z.coerce.boolean() fix in packages/config/src/env.ts.
// This package has no existing test suite (no jest wired at all), so this
// exercises the real, built validateEnv() function directly rather than
// inventing a whole new test framework for a single-file fix.
const { validateEnv } = require("../packages/config/dist/env.js");

const BASE = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  JWT_SECRET: "x".repeat(32),
  JWT_REFRESH_SECRET: "y".repeat(32),
  COOKIE_SECRET: "z".repeat(16),
  API_URL: "http://localhost:4000",
  WEB_URL: "http://localhost:3000",
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "bucket",
  S3_ACCESS_KEY: "key",
  S3_SECRET_KEY: "secret",
  LIVEKIT_URL: "ws://localhost:7880",
  LIVEKIT_HTTP_URL: "http://localhost:7880",
  LIVEKIT_API_KEY: "key",
  LIVEKIT_API_SECRET: "secret",
};

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log("PASS:", label);
  } catch (err) {
    failures += 1;
    console.log("FAIL:", label, "-", err.message);
  }
}

check('S3_FORCE_PATH_STYLE="false" now actually parses to false (the exact bug)', () => {
  const env = validateEnv({ ...BASE, S3_FORCE_PATH_STYLE: "false" });
  if (env.S3_FORCE_PATH_STYLE !== false) throw new Error(`got ${env.S3_FORCE_PATH_STYLE}`);
});

check('S3_FORCE_PATH_STYLE="true" parses to true', () => {
  const env = validateEnv({ ...BASE, S3_FORCE_PATH_STYLE: "true" });
  if (env.S3_FORCE_PATH_STYLE !== true) throw new Error(`got ${env.S3_FORCE_PATH_STYLE}`);
});

check("S3_FORCE_PATH_STYLE omitted defaults to true (unchanged default)", () => {
  const rest = { ...BASE };
  const env = validateEnv(rest);
  if (env.S3_FORCE_PATH_STYLE !== true) throw new Error(`got ${env.S3_FORCE_PATH_STYLE}`);
});

check('SMTP_SECURE="false" (used in .env, .env.development, .env.test, .env.example) parses to false', () => {
  const env = validateEnv({ ...BASE, SMTP_SECURE: "false" });
  if (env.SMTP_SECURE !== false) throw new Error(`got ${env.SMTP_SECURE}`);
});

check('SMTP_SECURE="true" (used in .env.lightsail, .env.production.example) parses to true', () => {
  const env = validateEnv({ ...BASE, SMTP_SECURE: "true" });
  if (env.SMTP_SECURE !== true) throw new Error(`got ${env.SMTP_SECURE}`);
});

check("SMTP_SECURE omitted defaults to false (unchanged default)", () => {
  const env = validateEnv({ ...BASE });
  if (env.SMTP_SECURE !== false) throw new Error(`got ${env.SMTP_SECURE}`);
});

check("a garbage boolean value now fails validation at boot instead of silently becoming true", () => {
  let threw = false;
  try {
    validateEnv({ ...BASE, SMTP_SECURE: "yes" });
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("expected validateEnv to throw for SMTP_SECURE=yes, it didn't");
});

check("an accidentally-blank value also fails validation rather than picking a default silently", () => {
  let threw = false;
  try {
    validateEnv({ ...BASE, S3_FORCE_PATH_STYLE: "" });
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("expected validateEnv to throw for S3_FORCE_PATH_STYLE=\"\", it didn't");
});

console.log(failures === 0 ? "RESULT: PASS" : `RESULT: FAIL (${failures} failing)`);
if (failures > 0) process.exit(1);
