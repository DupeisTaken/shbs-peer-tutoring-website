import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7 reads CLI config from here (the package.json `prisma` block is no longer supported) and
// no longer auto-loads `.env`, so we load it for migrate/generate/seed/studio.
export default defineConfig({
  schema: "prisma/schema.prisma",
  // Required for migrate/studio/introspection now that the URL isn't in the schema.
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
