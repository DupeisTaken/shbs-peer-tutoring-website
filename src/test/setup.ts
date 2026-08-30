import "dotenv/config";

// Provides env defaults before any module (env.js / db.ts) is imported by tests.
// Real values can be provided by the environment or local .env (e.g. DATABASE_URL in CI).
process.env.SKIP_ENV_VALIDATION ??= "1";
process.env.AUTH_SECRET ??= "test-secret";
process.env.DATABASE_URL ??=
  "postgresql://postgres:password@localhost:5432/shbs-peer-tutoring-website";
