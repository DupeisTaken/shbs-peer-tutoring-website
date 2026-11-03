#!/bin/sh
# Invoked only by the disposable PostgreSQL service and pinned Node container.
set -eu
: "${PROFILE_DEADLINE:?}" "${PROFILE_SCENARIO:?}" "${PROFILE_MODE:?}" "${PROFILE_OUTPUT:?}"
last_phase=initialization
measurement_started=false
record_exit() {
  code=$?
  trap - EXIT
  printf '{"lastPhase":"%s","measurementStarted":%s,"exitCode":%s}\n' "$last_phase" "$measurement_started" "$code" > "$PROFILE_OUTPUT.phase.json" || exit 1
  exit "$code"
}
trap record_exit EXIT
bounded() {
  label=$1
  last_phase=$label
  maximum=$2
  shift 2
  remaining=$((PROFILE_DEADLINE - $(date +%s) - 15))
  [ "$remaining" -gt 0 ] || return 124
  [ "$remaining" -ge "$maximum" ] || maximum=$remaining
  started=$(date +%s)
  if timeout -k 5 "$maximum" "$@"; then code=0; else code=$?; fi
  printf 'phase=%s exit=%s budget=%ss elapsed=%ss\n' "$label" "$code" "$maximum" "$(( $(date +%s)-started ))" >&2
  return "$code"
}
# Retry setup only. No measured operation or failed comparison is retried.
bounded packages-1 30 apk add --no-cache git openssl libc6-compat || bounded packages-2 30 apk add --no-cache git openssl libc6-compat
bounded dependencies 90 npm ci --prefer-offline
bounded generation 30 npx prisma generate
bounded migrations 45 npm run db:migrate
bounded schema-proof 30 npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
measurement_started=true
bounded concurrent-measurement 150 node --import tsx --import ./scripts/scheduling-profile/register-server-runtime.mjs scripts/scheduling-concurrency/run.ts
