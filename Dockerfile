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
# Env is validated at runtime, not build time.
ENV SKIP_ENV_VALIDATION=1
RUN npx prisma generate
RUN npm run build

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
COPY --from=build --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=build --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

COPY --chown=nextjs:nodejs entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
