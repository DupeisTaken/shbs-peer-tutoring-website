import { relative, resolve } from "node:path";
import { defineConfig } from "vitest/config";
import {
  rawMigrationSafetyFiles,
  teardownSafetyCases,
} from "./database-safety-cases";
import { DatabaseSafetyReporter } from "./fixtures/database-safety-reporter";

const directory = process.env.SHBS_TEST_SAFETY_DIRECTORY;
if (!directory)
  throw new Error("Use the database-lifecycle regression runner.");
const sourceVariant = process.env.SHBS_TEST_SAFETY_SOURCE_VARIANT;
if (
  sourceVariant &&
  !["without-cleanup-guard", "unexpected-cleanup-error"].includes(sourceVariant)
)
  throw new Error("Unknown isolated source control");

// Do not merge the main config: mergeConfig concatenates include/setup arrays,
// which can accidentally discover the full suite or recurse into the parent.
export default defineConfig({
  cacheDir: resolve(directory, "vite"),
  resolve: { tsconfigPaths: true },
  test: {
    reporters: [
      "default",
      ["json", { outputFile: resolve(directory, "report.json") }],
      new DatabaseSafetyReporter(resolve(directory, "errors.json")),
    ],
    server: { deps: { inline: ["next-auth"] } },
    environment: "node",
    globals: true,
    setupFiles: [
      "./src/test/setup.ts",
      "./src/test/fixtures/database-safety-setup.ts",
    ],
    sequence: { setupFiles: "list" },
    include: sourceVariant
      ? [
          relative(
            process.cwd(),
            resolve(directory, "account-emails.control.test.ts"),
          ).replaceAll("\\", "/"),
        ]
      : [
          ...teardownSafetyCases.map(([file]) => file),
          ...rawMigrationSafetyFiles,
        ],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
