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

# Keep the complete production dependency graph, including Prisma's migration CLI. Copying
# just @prisma and prisma omits transitive CLI dependencies and cannot be boot-tested reliably.
FROM build AS runtime-deps
RUN npm prune --omit=dev --ignore-scripts

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

# Next.js standalone server + static assets.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Prisma generated client + schema/migrations, and the CLI + engines so the
# entrypoint can run `prisma migrate deploy` at startup.
COPY --from=build --chown=nextjs:nodejs /app/generated ./generated
COPY --from=build --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=runtime-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=nextjs:nodejs /app/package.json /app/tsconfig.json ./
COPY --from=build --chown=nextjs:nodejs /app/scripts/create-admin.ts ./scripts/create-admin.ts
COPY --from=build --chown=nextjs:nodejs /app/scripts/reconcile-person-sources.ts ./scripts/reconcile-person-sources.ts
COPY --from=build --chown=nextjs:nodejs /app/scripts/recovery.ts ./scripts/recovery.ts
COPY --from=build --chown=nextjs:nodejs /app/src/lib/recovery-evidence.ts ./src/lib/recovery-evidence.ts
# Recovery is a DB-only operator entry point; it never starts the web runtime.
COPY --from=build --chown=nextjs:nodejs \
    /app/src/server/recovery/admission.ts \
    /app/src/server/recovery/independent-changes.ts \
    /app/src/server/recovery/capture.ts \
    /app/src/server/recovery/record-inspector.ts \
    /app/src/server/recovery/record-catalog.ts \
    /app/src/server/recovery/operator-cli.ts \
    /app/src/server/recovery/operator-plan.ts \
    /app/src/server/recovery/operator-site.ts ./src/server/recovery/
# Shared UTC startup policy is also imported by the migration CLI and bootstrap script.
COPY --from=build --chown=nextjs:nodejs /app/src/server/database-url.ts ./src/server/database-url.ts
COPY --from=build --chown=nextjs:nodejs /app/src/server/auth/password.ts ./src/server/auth/password.ts
COPY --from=build --chown=nextjs:nodejs /app/src/server/program/bootstrap.ts ./src/server/program/bootstrap.ts
COPY --from=build --chown=nextjs:nodejs /app/src/server/program/continuation-opening.ts ./src/server/program/continuation-opening.ts
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
