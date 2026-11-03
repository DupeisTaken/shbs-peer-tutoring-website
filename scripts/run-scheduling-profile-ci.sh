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
last_phase=initialization
first_failed_bootstrap=null
write_phase_status() {
  printf '{"schemaVersion":1,"status":"%s","exitCode":%s,"lastPhase":"%s","firstFailedBootstrapAttempt":%s}\n' \
    "$1" "$2" "$last_phase" "$first_failed_bootstrap" > "/evidence/$PROFILE_REVISION-phase-status.json"
}
command_exit() {
  status="$1"
  trap - EXIT
  terminal=PASS
  [ "$status" -eq 0 ] || terminal=FAIL
  write_phase_status "$terminal" "$status" || status=1
  if [ "$status" -ne 0 ]; then
    printf '{"status":"FAIL","exitCode":%s,"lastPhase":"%s","firstFailedBootstrapAttempt":%s,"reason":"Owned CI command failed; inspect the retained phase telemetry and command log."}\n' \
      "$status" "$last_phase" "$first_failed_bootstrap" > "/evidence/$PROFILE_REVISION-command-exit.json"
  fi
  exit "$status"
}
trap 'command_exit $?' EXIT
budget_failure() {
  printf '{"status":"TIMEOUT","lastPhase":"%s","firstFailedBootstrapAttempt":%s,"reason":"Available phase or shared job budget exhausted; partial samples are not passing evidence."}\n' \
    "$last_phase" "$first_failed_bootstrap" > "/evidence/$PROFILE_REVISION-budget.json"
  exit 124
}
remaining_seconds() {
  remaining=$((PROFILE_DEADLINE - $(date +%s) - 15))
  [ "$remaining" -gt 0 ] || budget_failure
  printf '%s\n' "$remaining"
}
# Static labels and numeric telemetry only: never print command arguments or env.
phase_event() {
  printf '{"phase":"%s","event":"%s","attempt":%s,"startedAtEpochSeconds":%s,"finishedAtEpochSeconds":%s,"elapsedSeconds":%s,"budgetSeconds":%s,"exitCode":%s}\n' \
    "$last_phase" "$1" "$phase_attempt" "$phase_started" "$2" "$(( $2 - phase_started ))" "$phase_budget" "$3" \
    >> "/evidence/$PROFILE_REVISION-phase-events.jsonl"
  printf 'profile-phase phase=%s event=%s attempt=%s elapsedSeconds=%s budgetSeconds=%s exitCode=%s\n' \
    "$last_phase" "$1" "$phase_attempt" "$(( $2 - phase_started ))" "$phase_budget" "$3" >&2
}
begin_phase() {
  last_phase="$1"
  case "$last_phase" in ''|*[!a-z0-9-]*) exit 2 ;; esac
  write_phase_status RUNNING 0
}
phase_attempt_run() {
  phase_budget="$1"
  shift
  phase_started=$(date +%s)
  phase_event start "$phase_started" null
  if timeout "$phase_budget" "$@"; then phase_exit=0; else phase_exit=$?; fi
  phase_finished=$(date +%s)
  phase_event finish "$phase_finished" "$phase_exit"
}
bounded() {
  begin_phase "$1"
  maximum="$2"
  shift 2
  remaining=$(remaining_seconds) || exit 124
  [ "$maximum" -le "$remaining" ] || maximum="$remaining"
  phase_attempt=1
  phase_attempt_run "$maximum" "$@"
  return "$phase_exit"
}
bootstrap_packages() {
  begin_phase bootstrap-packages
  # Only package bootstrap is retryable. Each attempt keeps its original 30s
  # cap; both attempts and their overhead must fit 60s and the existing reserve.
  bootstrap_deadline=$(( $(date +%s) + 60 ))
  phase_attempt=1
  while :; do
    remaining=$(remaining_seconds) || exit 124
    bootstrap_remaining=$((bootstrap_deadline - $(date +%s)))
    [ "$bootstrap_remaining" -gt 0 ] || budget_failure
    phase_limit=30
    [ "$phase_limit" -le "$bootstrap_remaining" ] || phase_limit="$bootstrap_remaining"
    [ "$phase_limit" -le "$remaining" ] || phase_limit="$remaining"
    phase_attempt_run "$phase_limit" apk add --no-cache git openssl libc6-compat
    if [ "$phase_exit" -eq 0 ]; then return 0; fi
    if [ "$first_failed_bootstrap" = null ]; then
      first_failed_bootstrap=$(printf '{"phase":"bootstrap-packages","attempt":%s,"exitCode":%s,"elapsedSeconds":%s,"budgetSeconds":%s}' \
        "$phase_attempt" "$phase_exit" "$((phase_finished - phase_started))" "$phase_budget")
      write_phase_status RUNNING "$phase_exit"
    fi
    [ "$phase_attempt" -lt 2 ] || return "$phase_exit"
    phase_attempt=2
  done
}
profile_budget_ms() {
  remaining=$(remaining_seconds) || exit 124
  [ "$remaining" -le "$1" ] || remaining="$1"
  [ "$remaining" -ge 30 ] || budget_failure
  printf '%s\n' "$((remaining * 1000))"
}
bootstrap_packages
bounded dependency-install 90 npm ci
bounded helper-regressions 30 node --import tsx --test --test-concurrency=1 scripts/scheduling-profile/*.test.ts
bounded initial-migrations 30 npm run db:migrate

if [ "$PROFILE_REVISION" = base ]; then
  begin_phase comparison-inspection
  native_control=$(bounded comparison-inspection 30 node -p 'JSON.parse(require("fs").readFileSync("/evidence/comparison-inputs.json", "utf8")).requiresNativeSchemaControl')
  if [ "$native_control" = true ] && [ "$PROFILE_SCENARIO" = cold ] && [ "$PROFILE_MODE" = latency ]; then
    # Preserve an original-schema control before adding the metadata triggers.
    # This result is separately labelled, never passed to exact shared-schema parity.
    begin_phase native-measurement
    native_budget=$(profile_budget_ms 90) || exit 124
    bounded native-measurement 90 node --import tsx --import ./scripts/scheduling-profile/register-server-runtime.mjs scripts/profile-scheduling-requests.ts \
      --scenario cold --samples 20 --anchor "$PROFILE_ANCHOR" --transport http \
      --capture-schema native-original \
      --partition-index "$PROFILE_PARTITION_INDEX" --partition-count "$PROFILE_PARTITION_COUNT" \
      --mode latency --timeout-ms "$native_budget" --output /evidence/base-native-latency.json
  fi
  set -- /work /overlay /evidence/applied-overlay.json apply
  if [ -n "${PROFILE_SCHEMA_MANIFEST:-}" ]; then
    set -- "$@" "/overlay/$PROFILE_SCHEMA_MANIFEST"
  fi
  bounded comparison-overlay 30 node scripts/scheduling-profile/comparison-inputs.mjs "$@"
  bounded client-generation 30 npx prisma generate
  bounded overlay-migrations 30 npm run db:migrate
fi
bounded schema-agreement 30 npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
bounded metrics-integration 30 node --import tsx --test scripts/scheduling-profile/metrics.integration.ts
case "$PROFILE_SCENARIO" in
  contention-bulk-first|contention-acceptance-first)
    bounded controlled-integration 30 node --import tsx --test scripts/scheduling-profile/controlled-contention.integration.ts ;;
esac

begin_phase shared-measurement
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
bounded shared-measurement 150 node --import tsx --import ./scripts/scheduling-profile/register-server-runtime.mjs scripts/profile-scheduling-requests.ts "$@"
