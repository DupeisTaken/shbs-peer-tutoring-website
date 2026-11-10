import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import {
  rawMigrationSafetyFiles,
  teardownSafetyCases,
} from "./database-safety-cases";

const directory = process.env.SHBS_TEST_SAFETY_DIRECTORY;
if (!directory)
  throw new Error("Use the database-lifecycle regression runner.");

// Do not merge the main config: mergeConfig concatenates include/setup arrays,
// which can accidentally discover the full suite or recurse into the parent.
export default defineConfig({
  cacheDir: resolve(directory, "vite"),
  resolve: { tsconfigPaths: true },
  test: {
    server: { deps: { inline: ["next-auth"] } },
    environment: "node",
    globals: true,
    setupFiles: [
      "./src/test/setup.ts",
      "./src/test/fixtures/database-safety-setup.ts",
    ],
    sequence: { setupFiles: "list" },
    include: [
      ...teardownSafetyCases.map(([file]) => file),
      ...rawMigrationSafetyFiles,
    ],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
