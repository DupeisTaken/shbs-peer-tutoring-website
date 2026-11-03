import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, expect, it, vi } from "vitest";
// The caller receives real seeded session identities below. HTTP cookie lookup
// is outside this database integration test; all procedure middleware still runs.
vi.mock("~/server/auth", () => ({ auth: async () => null }));
import { db } from "~/server/db";
import { assertIsolatedTestDatabase } from "./database-guard";
import { assertDemoDatabase } from "../../prisma/demo-support";

const environment = { ...process.env, SHBS_DEMO_SEED: "1" };
assertIsolatedTestDatabase(environment.DATABASE_URL);
assertDemoDatabase(environment.DATABASE_URL ?? "", environment);
const execute = promisify(execFile);

async function runFixtureScript(file: string) {
  // Use the documented seed entry point, including server-only resolution. The
  // child inherits the guarded test database, never the checkout's preview URL.
  return execute(process.execPath, [
    "node_modules/tsx/dist/cli.mjs", "--conditions=react-server", file,
  ], {
    cwd: process.cwd(), env: environment, timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024,
  });
}

afterAll(async () => {
  vi.unstubAllEnvs();
  await db.$disconnect();
});

it("creates a repeatable demo from an empty migrated database and replays its assignment workflows", async () => {
  vi.stubEnv("SHBS_DEMO_SEED", "1");
  // CI supplies the complete migration chain on an isolated PostgreSQL service.
  // Empty its disposable fixture rows so the first seed cannot rely on another
  // test's catalogue, accounts, policy or prior example data.
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname='public' AND tablename <> '_prisma_migrations'
  `;
  await db.$executeRawUnsafe("TRUNCATE " + tables.map(({ tablename }) =>
    '"' + tablename.replaceAll('"', '""') + '"',
  ).join(",") + " CASCADE");
  await runFixtureScript("prisma/seed.ts");
  await runFixtureScript("prisma/seed.ts");
  const coverage = await runFixtureScript("prisma/verify-demo.ts");
  expect(coverage.stdout).toContain("Demo verified:");
  // Run the real router caller under the same Vite/Next import resolution as
  // the rest of the integration suite, rather than pretending it is a Node CLI.
  const { verifyDemoPairingWorkflows } = await import("../../prisma/verify-demo-pairings");
  await verifyDemoPairingWorkflows(db);
  const academics = await runFixtureScript("prisma/verify-demo-academics.ts");
  expect(academics.stdout).toContain("Academic enrichment verified:");
  const scenarios = await runFixtureScript("prisma/verify-demo-scenarios.ts");
  expect(scenarios.stdout).toContain("Scenario enrichment verified:");
}, 180_000);
