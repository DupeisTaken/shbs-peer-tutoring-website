/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

/** @type {import("next").NextConfig} */
const config = {
  // Self-contained server build for the Docker runtime image (.next/standalone).
  output: "standalone",
  // Pin the output file-tracing root to this project (good hygiene for standalone output and
  // to keep the tracer from wandering above the project directory).
  outputFileTracingRoot: import.meta.dirname,
};

export default withNextIntl(config);
