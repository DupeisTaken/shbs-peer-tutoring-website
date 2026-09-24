import { defineConfig } from "vitest/config";

export default defineConfig({
  // Keep runner caches local when sibling worktrees share read-only dependencies.
  cacheDir: ".validation/vite",
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // Resolve Auth.js's extensionless Next imports through Vite, as Next's bundler does.
    server: { deps: { inline: ["next-auth"] } },
    environment: "node",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // UI render tests use TSX; unit and integration tests continue to use plain TS.
    include: ["src/**/*.test.{ts,tsx}"],
    // Integration tests touch a real database serially; keep them in one process.
    fileParallelism: false,
  },
});
