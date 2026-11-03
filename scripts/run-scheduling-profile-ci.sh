#!/bin/sh
# Only the dedicated hosted job invokes this inside its disposable Node container.
set -eu
case "${PROFILE_REVISION:-}" in base|head) ;; *) exit 2 ;; esac
case "${PROFILE_SCENARIO:-}" in cold|warm|sunday|negotiation|allocation|catalog|contention|contention-bulk-first|contention-acceptance-first|backlog) ;; *) exit 2 ;; esac
case "${PROFILE_MODE:-}" in latency|diagnostic) ;; *) exit 2 ;; esac
case "${PROFILE_PARTITION_INDEX:-}" in ''|*[!0-9]*) exit 2 ;; esac
case "${PROFILE_PARTITION_COUNT:-}" in ''|*[!0-9]*) exit 2 ;; esac
case "$PROFILE_SCENARIO" in backlog|contention-bulk-first|contention-acceptance-first) test "$PROFILE_MODE" = diagnostic ;; esac
test -d /evidence
case "${PROFILE_DEADLINE:-}" in ''|*[!0-9]*) exit 2 ;; esac
trap 'status=$?; if [ "$status" -ne 0 ]; then printf "{\"status\":\"FAIL\",\"exitCode\":%s,\"reason\":\"Owned CI command failed; inspect the retained command log.\"}\n" "$status" > "/evidence/$PROFILE_REVISION-command-exit.json"; fi' EXIT
budget_failure() {
  printf '{"status":"TIMEOUT","reason":"Shared job budget exhausted; partial samples are not passing evidence."}\n' > "/evidence/$PROFILE_REVISION-budget.json"
  exit 124
}
remaining_seconds() {
  remaining=$((PROFILE_DEADLINE - $(date +%s) - 15))
  [ "$remaining" -gt 0 ] || budget_failure
  printf '%s\n' "$remaining"
}
bounded() {
  maximum="$1"
  shift
  remaining=$(remaining_seconds) || exit 124
  [ "$maximum" -le "$remaining" ] || maximum="$remaining"
  timeout "$maximum" "$@"
}
profile_budget_ms() {
  remaining=$(remaining_seconds) || exit 124
  [ "$remaining" -le "$1" ] || remaining="$1"
  [ "$remaining" -ge 30 ] || budget_failure
  printf '%s\n' "$((remaining * 1000))"
}
bounded 30 apk add --no-cache git openssl libc6-compat
bounded 90 npm ci
bounded 30 node --import tsx --test --test-concurrency=1 scripts/scheduling-profile/*.test.ts
bounded 30 npm run db:migrate

if [ "$PROFILE_REVISION" = base ]; then
  native_control=$(node -p 'JSON.parse(require("fs").readFileSync("/evidence/comparison-inputs.json", "utf8")).requiresNativeSchemaControl')
  if [ "$native_control" = true ] && [ "$PROFILE_SCENARIO" = cold ] && [ "$PROFILE_MODE" = latency ]; then
    # Preserve an original-schema control before adding the metadata triggers.
    # This result is separately labelled, never passed to exact shared-schema parity.
    native_budget=$(profile_budget_ms 90) || exit 124
    bounded 90 node --import tsx --import ./scripts/scheduling-profile/register-server-runtime.mjs scripts/profile-scheduling-requests.ts \
      --scenario cold --samples 20 --anchor "$PROFILE_ANCHOR" --transport http \
      --capture-schema native-original \
      --partition-index "$PROFILE_PARTITION_INDEX" --partition-count "$PROFILE_PARTITION_COUNT" \
      --mode latency --timeout-ms "$native_budget" --output /evidence/base-native-latency.json
  fi
  set -- /work /overlay /evidence/applied-overlay.json apply
  if [ -n "${PROFILE_SCHEMA_MANIFEST:-}" ]; then
    set -- "$@" "/overlay/$PROFILE_SCHEMA_MANIFEST"
  fi
  node scripts/scheduling-profile/comparison-inputs.mjs "$@"
  bounded 30 npx prisma generate
  bounded 30 npm run db:migrate
fi
bounded 30 npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
bounded 30 node --import tsx --test scripts/scheduling-profile/metrics.integration.ts
case "$PROFILE_SCENARIO" in
  contention-bulk-first|contention-acceptance-first)
    bounded 30 node --import tsx --test scripts/scheduling-profile/controlled-contention.integration.ts ;;
esac

measurement_budget=$(profile_budget_ms 150) || exit 124
set -- --scenario "$PROFILE_SCENARIO" --samples "$PROFILE_SAMPLES" \
  --anchor "$PROFILE_ANCHOR" --transport http --mode "$PROFILE_MODE" --capture-schema shared \
  --timeout-ms "$measurement_budget" --output "/evidence/$PROFILE_REVISION-$PROFILE_MODE.json"
if [ "$PROFILE_MODE" = latency ]; then
  set -- "$@" --partition-index "$PROFILE_PARTITION_INDEX" --partition-count "$PROFILE_PARTITION_COUNT"
fi
if [ "$PROFILE_SCENARIO" = contention ]; then
  set -- "$@" --contention-references /overlay/outputs/contention-references
fi
if [ "$PROFILE_REVISION" = head ]; then
  set -- "$@" --compare "/evidence/base-$PROFILE_MODE.json"
fi
bounded 150 node --import tsx --import ./scripts/scheduling-profile/register-server-runtime.mjs scripts/profile-scheduling-requests.ts "$@"
