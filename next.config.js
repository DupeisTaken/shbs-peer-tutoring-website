/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();
// Sibling worktrees may share a dependency junction. An explicit local root lets
// Turbopack resolve that junction without copying the full dependency tree.
const workspaceRoot = process.env.SHBS_WORKSPACE_ROOT ?? import.meta.dirname;

/** @type {import("next").NextConfig} */
const config = {
  // Caddy owns the public security policy; omit framework identification at source too.
  poweredByHeader: false,
  // Publish short links; the descriptive routes are the canonical destinations.
  // Next preserves invitation codes, mailbox tokens and other query parameters.
  redirects() {
    return [
      {
        source: "/register",
        destination: "/register-account",
        permanent: true,
      },
      { source: "/tutee", destination: "/tutee-signup", permanent: true },
      { source: "/tutor", destination: "/tutor-signup", permanent: true },
      { source: "/viewer", destination: "/viewer-signup", permanent: true },
      { source: "/crew", destination: "/crew-signup", permanent: true },
      {
        source: "/tutee/account",
        destination: "/tutee-signup/account",
        permanent: true,
      },
      { source: "/signup", destination: "/tutee-signup", permanent: true },
      {
        source: "/signup/account",
        destination: "/tutee-signup/account",
        permanent: true,
      },
    ];
  },
  // Self-contained server build for the Docker runtime image (.next/standalone).
  output: "standalone",
  // Pin the output file-tracing root to this project (good hygiene for standalone output and
  // to keep the tracer from wandering above the project directory).
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
  // Local validation can use one worker on machines that are also running the app.
  experimental: {
    ...(process.env.SHBS_BUILD_CPUS === "1" ? { cpus: 1 } : {}),
    // Read-only cache bypass for a local compiler recovery; leaves existing cache files intact.
    ...(process.env.SHBS_DISABLE_BUILD_CACHE === "1"
      ? { turbopackFileSystemCacheForBuild: false }
      : {}),
  },
};

export default withNextIntl(config);
