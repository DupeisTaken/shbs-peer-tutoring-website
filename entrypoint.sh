#!/bin/sh
set -e

echo "[entrypoint] Applying database migrations…"
node node_modules/prisma/build/index.js migrate deploy

echo "[entrypoint] Starting Next.js server…"
exec node server.js
