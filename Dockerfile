# syntax=docker/dockerfile:1

############################
# 1. Install dependencies
############################
FROM node:22-alpine AS deps
WORKDIR /app
# openssl + libc6-compat are needed by Prisma's engines on Alpine.
RUN apk add --no-cache libc6-compat openssl
# .npmrc carries legacy-peer-deps=true (next-auth v5 ⇄ nodemailer optional-peer clash), so
# `npm ci` needs it to resolve. Schema is needed because `postinstall` runs `prisma generate`.
COPY package.json package-lock.json .npmrc ./
# The development-only Next lint override is a local package required by npm ci.
COPY tools/next-lint-glob ./tools/next-lint-glob
COPY prisma ./prisma
RUN npm ci

# Production dependencies do not depend on the application build. Preserve the
# complete graph for startup migrations and operator CLIs, including their engines.
FROM deps AS runtime-deps
RUN npm prune --omit=dev --ignore-scripts

############################
# 2. Build
############################
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Env is validated at runtime, not build time. Branding is read by the running server.
# Never pass production secrets or branding as build arguments.
ENV SKIP_ENV_VALIDATION=1
RUN npx prisma generate
RUN npm run build

# Merge traced-only packages with production winners before creating final image
# layers. Deleting overlaid files in the runner would retain their lower-layer bytes.
FROM build AS runtime-files
COPY --from=runtime-deps /app/node_modules /runtime-production/node_modules
RUN node scripts/assemble-runtime.mjs .next/standalone /runtime-production/node_modules /runtime-output

############################
# 3. Runtime (slim, non-root)
############################
FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as an unprivileged user.
RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001 -G nodejs

# Dependencies precede changing app files so retained releases can share their
# snapshot chain. The assembler guarantees these two outputs do not overlap.
COPY --from=runtime-files --chown=nextjs:nodejs /runtime-output/dependencies/node_modules ./node_modules
COPY --from=runtime-files --chown=nextjs:nodejs /runtime-output/app ./
# Next.js static assets are not included in standalone output.
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Prisma generated client + schema/migrations, and the CLI + engines so the
# entrypoint can run `prisma migrate deploy` at startup.
COPY --from=build --chown=nextjs:nodejs /app/generated ./generated
COPY --from=build --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=build --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=nextjs:nodejs /app/package.json /app/tsconfig.json ./
COPY --from=build --chown=nextjs:nodejs /app/scripts/create-admin.ts ./scripts/create-admin.ts
COPY --from=build --chown=nextjs:nodejs /app/scripts/reconcile-person-sources.ts ./scripts/reconcile-person-sources.ts
# Shared UTC startup policy is also imported by the migration CLI and bootstrap script.
COPY --from=build --chown=nextjs:nodejs /app/src/server/database-url.ts ./src/server/database-url.ts
COPY --from=build --chown=nextjs:nodejs /app/src/server/auth/password.ts ./src/server/auth/password.ts
COPY --from=build --chown=nextjs:nodejs /app/src/server/program/bootstrap.ts ./src/server/program/bootstrap.ts
# Operator CLIs run outside Next's bundle. Keep their complete source dependency
# graph explicit; deployment tests traverse imports to catch missing descendants.
COPY --from=build --chown=nextjs:nodejs \
    /app/src/server/person-source-initialization.ts \
    /app/src/server/person-identity.ts \
    /app/src/server/person-reconciliation.ts \
    /app/src/server/account-history.ts \
    /app/src/server/transactions.ts \
    /app/src/server/db-scope.ts ./src/server/
COPY --from=build --chown=nextjs:nodejs \
    /app/src/server/auth/username-namespace.ts \
    /app/src/server/auth/username-snapshot.ts ./src/server/auth/

COPY --chown=nextjs:nodejs entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
