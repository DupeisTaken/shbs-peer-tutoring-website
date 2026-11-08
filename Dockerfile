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

# Keep build-generated Prisma configuration caches as well as the complete
# production graph. Pruning from deps loses files created during generation.
FROM build AS runtime-deps
RUN npm prune --omit=dev --ignore-scripts

# Merge traced-only packages with production winners before creating final image
# layers. Deleting overlaid files in the runner would retain their lower-layer bytes.
FROM build AS runtime-files
COPY --from=runtime-deps /app/node_modules /runtime-production/node_modules
RUN node scripts/assemble-runtime.mjs .next/standalone /runtime-production/node_modules /runtime-output
# Complete the operator graph before its single app-layer copy. A later runner
# COPY would store a duplicate layer when Next already traced this source.
COPY --from=build /app/src/server/program/continuation-opening.ts /runtime-output/app/src/server/program/continuation-opening.ts
# Explicit DB-only recovery descendants. Domain modules require the caller's
# transaction; the import guard rejects web runtime and environment dependencies.
COPY --from=build /app/messages/en.json /runtime-output/app/messages/en.json
COPY --from=build /app/messages/zh.json /runtime-output/app/messages/zh.json
COPY --from=build /app/src/i18n/config.ts /runtime-output/app/src/i18n/config.ts
COPY --from=build /app/src/lib/academics.ts /runtime-output/app/src/lib/academics.ts
COPY --from=build /app/src/lib/approval-policy.ts /runtime-output/app/src/lib/approval-policy.ts
COPY --from=build /app/src/lib/course-catalogue.ts /runtime-output/app/src/lib/course-catalogue.ts
COPY --from=build /app/src/lib/csv.ts /runtime-output/app/src/lib/csv.ts
COPY --from=build /app/src/lib/discipline.ts /runtime-output/app/src/lib/discipline.ts
COPY --from=build /app/src/lib/historical-academics.ts /runtime-output/app/src/lib/historical-academics.ts
COPY --from=build /app/src/lib/name-field-policy.ts /runtime-output/app/src/lib/name-field-policy.ts
COPY --from=build /app/src/lib/notification-categories.ts /runtime-output/app/src/lib/notification-categories.ts
COPY --from=build /app/src/lib/notification-details.ts /runtime-output/app/src/lib/notification-details.ts
COPY --from=build /app/src/lib/notification-events.ts /runtime-output/app/src/lib/notification-events.ts
COPY --from=build /app/src/lib/notification-facts.ts /runtime-output/app/src/lib/notification-facts.ts
COPY --from=build /app/src/lib/pairing-group-eligibility.ts /runtime-output/app/src/lib/pairing-group-eligibility.ts
COPY --from=build /app/src/lib/pairing-groups.ts /runtime-output/app/src/lib/pairing-groups.ts
COPY --from=build /app/src/lib/period.ts /runtime-output/app/src/lib/period.ts
COPY --from=build /app/src/lib/person-name.ts /runtime-output/app/src/lib/person-name.ts
COPY --from=build /app/src/lib/planned-scheduling.ts /runtime-output/app/src/lib/planned-scheduling.ts
COPY --from=build /app/src/lib/profile-policy.ts /runtime-output/app/src/lib/profile-policy.ts
COPY --from=build /app/src/lib/program-calendar.ts /runtime-output/app/src/lib/program-calendar.ts
COPY --from=build /app/src/lib/program-time.ts /runtime-output/app/src/lib/program-time.ts
COPY --from=build /app/src/lib/record-transfer.ts /runtime-output/app/src/lib/record-transfer.ts
COPY --from=build /app/src/lib/school-calendar.ts /runtime-output/app/src/lib/school-calendar.ts
COPY --from=build /app/src/lib/service-hours.ts /runtime-output/app/src/lib/service-hours.ts
COPY --from=build /app/src/lib/session-identity.ts /runtime-output/app/src/lib/session-identity.ts
COPY --from=build /app/src/lib/session-planning.ts /runtime-output/app/src/lib/session-planning.ts
COPY --from=build /app/src/lib/signup-fields.ts /runtime-output/app/src/lib/signup-fields.ts
COPY --from=build /app/src/lib/student-signup.ts /runtime-output/app/src/lib/student-signup.ts
COPY --from=build /app/src/lib/tutee-history.ts /runtime-output/app/src/lib/tutee-history.ts
COPY --from=build /app/src/lib/username.ts /runtime-output/app/src/lib/username.ts
COPY --from=build /app/src/server/academics.ts /runtime-output/app/src/server/academics.ts
COPY --from=build /app/src/server/account-profile-lock.ts /runtime-output/app/src/server/account-profile-lock.ts
COPY --from=build /app/src/server/attendance-schedule-lock.ts /runtime-output/app/src/server/attendance-schedule-lock.ts
COPY --from=build /app/src/server/audit/evidence.ts /runtime-output/app/src/server/audit/evidence.ts
COPY --from=build /app/src/server/audit/record.ts /runtime-output/app/src/server/audit/record.ts
COPY --from=build /app/src/server/auth/session-version.ts /runtime-output/app/src/server/auth/session-version.ts
COPY --from=build /app/src/server/auth/username-core.ts /runtime-output/app/src/server/auth/username-core.ts
COPY --from=build /app/src/server/concurrency.ts /runtime-output/app/src/server/concurrency.ts
COPY --from=build /app/src/server/corrections/attendance.ts /runtime-output/app/src/server/corrections/attendance.ts
COPY --from=build /app/src/server/corrections/card.ts /runtime-output/app/src/server/corrections/card.ts
COPY --from=build /app/src/server/crew/flags.ts /runtime-output/app/src/server/crew/flags.ts
COPY --from=build /app/src/server/discipline/removal.ts /runtime-output/app/src/server/discipline/removal.ts
COPY --from=build /app/src/server/historical-academic-snapshot.ts /runtime-output/app/src/server/historical-academic-snapshot.ts
COPY --from=build /app/src/server/history-row-ownership.ts /runtime-output/app/src/server/history-row-ownership.ts
COPY --from=build /app/src/server/notifications/core.ts /runtime-output/app/src/server/notifications/core.ts
COPY --from=build /app/src/server/participant-execution.ts /runtime-output/app/src/server/participant-execution.ts
COPY --from=build /app/src/server/participant-source-restrictions.ts /runtime-output/app/src/server/participant-source-restrictions.ts
COPY --from=build /app/src/server/period.ts /runtime-output/app/src/server/period.ts
COPY --from=build /app/src/server/policy-acceptance.ts /runtime-output/app/src/server/policy-acceptance.ts
COPY --from=build /app/src/server/program/features.ts /runtime-output/app/src/server/program/features.ts
COPY --from=build /app/src/server/program/name-fields.ts /runtime-output/app/src/server/program/name-fields.ts
COPY --from=build /app/src/server/program/profile-policy.ts /runtime-output/app/src/server/program/profile-policy.ts
COPY --from=build /app/src/server/program/signup-fields.ts /runtime-output/app/src/server/program/signup-fields.ts
COPY --from=build /app/src/server/program/time-zone-reader.ts /runtime-output/app/src/server/program/time-zone-reader.ts
COPY --from=build /app/src/server/qualifications.ts /runtime-output/app/src/server/qualifications.ts
COPY --from=build /app/src/server/recovery/adapters/assignment-eligibility.ts /runtime-output/app/src/server/recovery/adapters/assignment-eligibility.ts
COPY --from=build /app/src/server/recovery/adapters/attendance.ts /runtime-output/app/src/server/recovery/adapters/attendance.ts
COPY --from=build /app/src/server/recovery/adapters/card.ts /runtime-output/app/src/server/recovery/adapters/card.ts
COPY --from=build /app/src/server/recovery/adapters/correction-state.ts /runtime-output/app/src/server/recovery/adapters/correction-state.ts
COPY --from=build /app/src/server/recovery/adapters/participant.ts /runtime-output/app/src/server/recovery/adapters/participant.ts
COPY --from=build /app/src/server/recovery/adapters/program-refresh.ts /runtime-output/app/src/server/recovery/adapters/program-refresh.ts
COPY --from=build /app/src/server/recovery/adapters/shared.ts /runtime-output/app/src/server/recovery/adapters/shared.ts
COPY --from=build /app/src/server/recovery/adapters/student-workflow.ts /runtime-output/app/src/server/recovery/adapters/student-workflow.ts
COPY --from=build /app/src/server/recovery/admission-root-policy.ts /runtime-output/app/src/server/recovery/admission-root-policy.ts
COPY --from=build /app/src/server/recovery/checkpoint-contract.ts /runtime-output/app/src/server/recovery/checkpoint-contract.ts
COPY --from=build /app/src/server/recovery/checkpoint.ts /runtime-output/app/src/server/recovery/checkpoint.ts
COPY --from=build /app/src/server/recovery/delivery-effects.ts /runtime-output/app/src/server/recovery/delivery-effects.ts
COPY --from=build /app/src/server/recovery/operator-cutover.ts /runtime-output/app/src/server/recovery/operator-cutover.ts
COPY --from=build /app/src/server/recovery/operator-identity.ts /runtime-output/app/src/server/recovery/operator-identity.ts
COPY --from=build /app/src/server/recovery/operator-maintenance.ts /runtime-output/app/src/server/recovery/operator-maintenance.ts
COPY --from=build /app/src/server/recovery/operator-marker.ts /runtime-output/app/src/server/recovery/operator-marker.ts
COPY --from=build /app/src/server/recovery/operator-next.ts /runtime-output/app/src/server/recovery/operator-next.ts
COPY --from=build /app/src/server/recovery/operator-reconcile.ts /runtime-output/app/src/server/recovery/operator-reconcile.ts
COPY --from=build /app/src/server/recovery/operator-schema.ts /runtime-output/app/src/server/recovery/operator-schema.ts
COPY --from=build /app/src/server/recovery/receipt.ts /runtime-output/app/src/server/recovery/receipt.ts
COPY --from=build /app/src/server/recovery/workflow-draft.ts /runtime-output/app/src/server/recovery/workflow-draft.ts
COPY --from=build /app/src/server/request-review.ts /runtime-output/app/src/server/request-review.ts
COPY --from=build /app/src/server/room-bookings.ts /runtime-output/app/src/server/room-bookings.ts
COPY --from=build /app/src/server/school-departure.ts /runtime-output/app/src/server/school-departure.ts
COPY --from=build /app/src/server/session-planning-notice-copy.ts /runtime-output/app/src/server/session-planning-notice-copy.ts
COPY --from=build /app/src/server/session-planning/conflict-reads.ts /runtime-output/app/src/server/session-planning/conflict-reads.ts
COPY --from=build /app/src/server/session-planning/index.ts /runtime-output/app/src/server/session-planning/index.ts
COPY --from=build /app/src/server/session-planning/maintenance.ts /runtime-output/app/src/server/session-planning/maintenance.ts
COPY --from=build /app/src/server/session-planning/notice-inserts.ts /runtime-output/app/src/server/session-planning/notice-inserts.ts
COPY --from=build /app/src/server/session-planning/notification-recipients.ts /runtime-output/app/src/server/session-planning/notification-recipients.ts
COPY --from=build /app/src/server/session-planning/participants.ts /runtime-output/app/src/server/session-planning/participants.ts
COPY --from=build /app/src/server/session-planning/publication-continuations.ts /runtime-output/app/src/server/session-planning/publication-continuations.ts
COPY --from=build /app/src/server/session-planning/publication-notices.ts /runtime-output/app/src/server/session-planning/publication-notices.ts
COPY --from=build /app/src/server/session-planning/publication-validation.ts /runtime-output/app/src/server/session-planning/publication-validation.ts
COPY --from=build /app/src/server/session-planning/room-occupancy.ts /runtime-output/app/src/server/session-planning/room-occupancy.ts
COPY --from=build /app/src/server/session-planning/source-locks.ts /runtime-output/app/src/server/session-planning/source-locks.ts
COPY --from=build /app/src/server/student-ownership.ts /runtime-output/app/src/server/student-ownership.ts
COPY --from=build /app/src/server/student-request-execution.ts /runtime-output/app/src/server/student-request-execution.ts
COPY --from=build /app/src/server/student-request-state.ts /runtime-output/app/src/server/student-request-state.ts
COPY --from=build /app/src/server/student-signup-answers.ts /runtime-output/app/src/server/student-signup-answers.ts
COPY --from=build /app/src/server/student-signup-state.ts /runtime-output/app/src/server/student-signup-state.ts
COPY --from=build /app/src/server/student-signup-validation.ts /runtime-output/app/src/server/student-signup-validation.ts
COPY --from=build /app/src/server/tutor-scheduling.ts /runtime-output/app/src/server/tutor-scheduling.ts

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
