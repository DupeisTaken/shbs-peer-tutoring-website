import { PrismaPg } from "@prisma/adapter-pg";

import { env } from "~/env";
import { PrismaClient } from "../../generated/prisma";
import { scopedDatabase } from "./db-scope";
import { utcDatabaseUrl } from "./database-url";
import { schedulingPgOptions } from "./database-options";
import { assertIsolatedTestDatabase } from "./database-test-safety";

// Prisma 7 connects through a driver adapter (the connection URL is no longer in the schema).
const createPrismaClient = (connectionString: string | undefined) =>
  new PrismaClient({
    adapter: new PrismaPg(
      {
        // Docker builds skip env validation and import server routes without secrets.
        // Leave the pool unconfigured until runtime; importing never needs a connection.
        // Normal runtime env validation still requires a valid DATABASE_URL.
        connectionString,
      },
      schedulingPgOptions,
    ),
    log:
      env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

/** Under tests, a rejected database URL must never instantiate a driver pool or
 * reach PostgreSQL during setup, import-time queries or afterAll cleanup, while
 * allowing unit tests that import routes/modules without querying DB (or calling
 * $disconnect in teardown) to run without PostgreSQL. */
function createRejectedTestDatabase(guardError: Error): PrismaClient {
  const rejectOperation = () => Promise.reject(guardError);
  const delegateProxy = new Proxy(
    {},
    {
      get(_target, prop) {
        if (
          prop === "then" ||
          typeof prop === "symbol" ||
          prop === "constructor" ||
          prop === "$$typeof"
        ) {
          return undefined;
        }
        return rejectOperation;
      },
    },
  );
  return new Proxy({} as PrismaClient, {
    get(_target, prop) {
      if (prop === "$disconnect") return async () => undefined;
      if (
        prop === "then" ||
        typeof prop === "symbol" ||
        prop === "constructor" ||
        prop === "$$typeof"
      ) {
        return undefined;
      }
      if (prop === "$extends") {
        return () => {
          throw guardError;
        };
      }
      if (typeof prop === "string" && prop.startsWith("$")) {
        return rejectOperation;
      }
      return delegateProxy;
    },
  });
}

// Validate URL syntax eagerly when present (preserves malformed-URL build checks).
const normalizedUrl = env.DATABASE_URL
  ? utcDatabaseUrl(env.DATABASE_URL)
  : undefined;

// Check raw process env so tests mocking ~/env to NODE_ENV="production" stay guarded.
const isTestRuntime =
  Boolean(process.env.VITEST) || process.env.NODE_ENV === "test";

let testDatabaseGuardError: Error | undefined;
if (isTestRuntime) {
  try {
    assertIsolatedTestDatabase(env.DATABASE_URL);
  } catch (error) {
    testDatabaseGuardError =
      error instanceof Error ? error : new Error(String(error));
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
  prismaDatabaseUrl: string | undefined;
};

let resolvedDb: PrismaClient;
if (testDatabaseGuardError) {
  resolvedDb = createRejectedTestDatabase(testDatabaseGuardError);
} else {
  // In test mode, only reuse a cached client when its bound DATABASE_URL matches.
  const cachedDb =
    !isTestRuntime || globalForPrisma.prismaDatabaseUrl === env.DATABASE_URL
      ? globalForPrisma.prisma
      : undefined;
  const baseDb = cachedDb ?? createPrismaClient(normalizedUrl);
  resolvedDb = scopedDatabase(baseDb);

  if (env.NODE_ENV !== "production") {
    globalForPrisma.prisma = baseDb;
    if (!cachedDb) globalForPrisma.prismaDatabaseUrl = env.DATABASE_URL;
  }
}

export const db: PrismaClient = resolvedDb;
