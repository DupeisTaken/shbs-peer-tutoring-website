import "dotenv/config";
import { defineConfig } from "prisma/config";
import { utcDatabaseUrl } from "./src/server/database-url";

// Prisma 7 reads CLI config from here (the package.json `prisma` block is no longer supported) and
// no longer auto-loads `.env`, so we load it for migrate/generate/seed/studio.
export default defineConfig({
  schema: "prisma/schema.prisma",
  // Required for migrate/studio/introspection now that the URL isn't in the schema.
  datasource: {
    // Migration defaults/backfills must agree with the application's UTC writes.
    url: process.env.DATABASE_URL
      ? utcDatabaseUrl(process.env.DATABASE_URL)
      : undefined,
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
