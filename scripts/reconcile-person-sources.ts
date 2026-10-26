/** Read-only directory/ownership comparison. Never backfill or merge records here. */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma";
import { utcDatabaseUrl } from "../src/server/database-url";
import {
  readPersonReconciliationSnapshot,
  reconcilePersonSources,
} from "../src/server/person-reconciliation";

if (process.argv.length > 2)
  throw new Error("This command takes no arguments and never repairs data.");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: utcDatabaseUrl(connectionString) }),
});
try {
  const report = await db.$transaction(async (tx) => {
    // PostgreSQL enforces the contract even if a later helper accidentally adds
    // a write. RepeatableRead prevents mixed before/after ownership projections.
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return reconcilePersonSources(await readPersonReconciliationSnapshot(tx));
  }, { isolationLevel: "RepeatableRead", timeout: 60_000 });
  console.info(JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2));
  process.exitCode = report.findings.length ? 2 : 0;
} finally {
  await db.$disconnect();
}
