import { PrismaPg } from "@prisma/adapter-pg";

import { env } from "~/env";
import { PrismaClient } from "../../generated/prisma";
import { scopedDatabase } from "./db-scope";

// Prisma 7 connects through a driver adapter (the connection URL is no longer in the schema).
const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
    log:
      env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

const baseDb = globalForPrisma.prisma ?? createPrismaClient();
export const db = scopedDatabase(baseDb);

if (env.NODE_ENV !== "production") globalForPrisma.prisma = baseDb;
