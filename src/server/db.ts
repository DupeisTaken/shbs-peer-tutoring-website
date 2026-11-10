import { PrismaPg } from "@prisma/adapter-pg";

import { env } from "~/env";
import { PrismaClient } from "../../generated/prisma";
import { scopedDatabase } from "./db-scope";
import { utcDatabaseUrl } from "./database-url";
import { schedulingPgOptions } from "./database-options";
import { assertIsolatedTestDatabase } from "./database-test-safety";

// Validate the adapter's actual target before imports can issue queries or register
// teardown. Vitest stays guarded even when a test simulates another NODE_ENV.
const isDatabaseTest =
  process.env.NODE_ENV === "test" || process.env.VITEST === "true";
if (isDatabaseTest) assertIsolatedTestDatabase(env.DATABASE_URL);

// Prisma 7 connects through a driver adapter (the connection URL is no longer in the schema).
const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaPg(
      {
        // Docker builds skip env validation and import server routes without secrets.
        // Leave the pool unconfigured until runtime; importing never needs a connection.
        // Normal runtime env validation still requires a valid DATABASE_URL.
        connectionString: env.DATABASE_URL
          ? utcDatabaseUrl(env.DATABASE_URL)
          : undefined,
      },
      schedulingPgOptions,
    ),
    log:
      env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
  prismaDatabaseUrl: string | undefined;
};

// Test harnesses injecting an instrumented client must bind its original URL.
// Rechecking the new environment alone cannot validate an old client's target.
const cachedDb =
  !isDatabaseTest || globalForPrisma.prismaDatabaseUrl === env.DATABASE_URL
    ? globalForPrisma.prisma
    : undefined;
const baseDb = cachedDb ?? createPrismaClient();
export const db = scopedDatabase(baseDb);

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = baseDb;
  // Reusing a development pool must not relabel it after an environment change.
  if (!cachedDb) globalForPrisma.prismaDatabaseUrl = env.DATABASE_URL;
}
