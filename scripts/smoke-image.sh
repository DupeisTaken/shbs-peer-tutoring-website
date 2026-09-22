#!/usr/bin/env bash
# CI acceptance gate: exercise the shipped image against an empty, disposable PostgreSQL DB.
set -euo pipefail
image="${1:?Pass the built image tag}"
: "${DATABASE_URL:?Set DATABASE_URL to an empty test database}"
case "$DATABASE_URL" in */shbs_boot_test) ;; *) echo 'Use the isolated shbs_boot_test database.' >&2; exit 1;; esac
name="shbs-smoke-${RANDOM}-$$"
health_file="$(mktemp)"
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -f "$health_file"
}
trap cleanup EXIT
# Synthetic server-only sentinels must never appear in HTML, React payloads or client JS.
export SMTP_PASSWORD='smoke-private-smtp-sentinel'
export EMAIL_FROM='smoke-private-sender@example.test'
export EMAIL_FROM_NAME='Smoke Private Mail Sender'
export TEST_BASE_URL='http://127.0.0.1:3100'
# The first boot has no branding overrides, including no build-time public env values.
unset APP_TITLE TEAM_TITLE ORG_NAME SUPPORT_EMAIL PROGRAM_TERM_LABEL
start_app() {
  docker run --detach --rm --network host --name "$name" \
    -e DATABASE_URL -e AUTH_SECRET -e AUTH_TRUST_HOST=true \
    -e SMTP_PASSWORD -e EMAIL_FROM -e EMAIL_FROM_NAME \
    -e APP_TITLE -e TEAM_TITLE -e ORG_NAME -e SUPPORT_EMAIL -e PROGRAM_TERM_LABEL \
    -e AUTH_URL=http://127.0.0.1:3100 -e PORT=3100 "$image" >/dev/null
  local ready=false
  for attempt in $(seq 1 60); do
    if curl --fail --silent "$TEST_BASE_URL/api/trpc/health" > "$health_file"; then ready=true; break; fi
    sleep 2
  done
  if [ "$ready" != true ]; then docker logs "$name"; exit 1; fi
  node -e 'const fs=require("fs"); const r=JSON.parse(fs.readFileSync(process.argv[1]));if(r.result?.data?.json?.ok!==true)process.exit(1)' "$health_file"
}
start_app
node --test scripts/test-runtime-branding.mjs scripts/test-tab-icon.mjs
# Running twice is deliberate: recovery must preserve the singleton HEAD and initial period.
for attempt in 1 2; do
  docker exec -e BOOTSTRAP_ADMIN_EMAIL=smoke@example.test \
    -e BOOTSTRAP_ADMIN_PASSWORD=DisposableSmokePassword123! \
    -e BOOTSTRAP_SCHOOL_YEAR=26-27 -e BOOTSTRAP_QUARTER=Q1 \
    "$name" node node_modules/tsx/dist/cli.mjs scripts/create-admin.ts
done
docker exec -i "$name" node --input-type=module <<'JS'
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const { rows: [r] } = await c.query(`SELECT
  (SELECT count(*) FROM "User" WHERE role='HEAD') AS heads,
  (SELECT count(*) FROM "Term" WHERE active=true) AS periods,
  (SELECT count(*) FROM "Tutor") AS tutors,
  (SELECT count(*) FROM "Tutee") AS tutees`);
if (r.heads !== '1' || r.periods !== '1' || r.tutors !== '0' || r.tutees !== '0') throw Error('Clean bootstrap invariant failed');
await c.end();
JS
curl --fail --silent http://127.0.0.1:3100/signin >/dev/null
# Persist an overdue unverified assignment, then restart the exact image. Its Node
# instrumentation must resume deadline enforcement without a browser or an API mutation.
docker exec -i "$name" node --input-type=module <<'JS'
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const { rows: [term] } = await c.query('SELECT id FROM "Term" WHERE active=true');
await c.query(`INSERT INTO "Tutor" (id, "englishName") VALUES ('smoke-tutor', 'Smoke Tutor')`);
await c.query(`INSERT INTO "Tutee" (id, "englishName", status, "updatedAt") VALUES ('smoke-tutee', 'Smoke Student', 'ACTIVE', NOW())`);
await c.query(`INSERT INTO "Pairing" (id, "tutorId", "termId", subject, "dayOfWeek", "startMin", "endMin") VALUES ('smoke-pairing', 'smoke-tutor', $1, 'Smoke Subject', 1, 930, 990)`, [term.id]);
await c.query(`INSERT INTO "PairingTutee" ("pairingId", "tuteeId") VALUES ('smoke-pairing', 'smoke-tutee')`);
await c.query(`INSERT INTO "StudentSurvey" (id, email, "intakeTermId", payload, "policyRevision", "policySnapshot", "tokenHash", "expiresAt", "tuteeId", "firstAssignedAt", "verificationDueAt", "submittedAt") VALUES ('smoke-overdue', 'smoke-student@example.test', $1, '{}', 'smoke', '[]', 'smoke-token-hash', NOW() - INTERVAL '1 day', 'smoke-tutee', NOW() - INTERVAL '8 days', NOW() - INTERVAL '1 day', '2026-01-01')`, [term.id]);
await c.end();
JS
# Recreate the exact image with different runtime settings; keep the original database.
# This also proves pending migrations/startup are safe when existing records are present.
docker rm -f "$name" >/dev/null
export APP_TITLE='Runtime Campus Help'
export TEAM_TITLE='Runtime Campus Team'
export ORG_NAME='Runtime School'
export SUPPORT_EMAIL='support@example.test'
export PROGRAM_TERM_LABEL='2026–27'
start_app
node --test scripts/test-runtime-branding.mjs scripts/test-tab-icon.mjs
docker exec -i "$name" node --input-type=module <<'JS'
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
let passed = false;
for (let attempt = 0; attempt < 45; attempt++) {
  const { rows: [r] } = await c.query(`SELECT s.state, s."submittedAt", t.status,
    (SELECT count(*) FROM "User" WHERE role='HEAD' AND email='smoke@example.test') AS heads,
    (SELECT count(*) FROM "Term" WHERE active=true) AS periods,
    (SELECT count(*) FROM "PairingTutee" WHERE "tuteeId"='smoke-tutee') AS memberships
    FROM "StudentSurvey" s JOIN "Tutee" t ON t.id=s."tuteeId" WHERE s.id='smoke-overdue'`);
  if (r.heads === '1' && r.periods === '1' && r.state === 'DISQUALIFIED' && r.status === 'INACTIVE' && r.memberships === '0' && r.submittedAt.toISOString().startsWith('2026-01-01')) { passed = true; break; }
  await new Promise(resolve => setTimeout(resolve, 2000));
}
await c.end();
if (!passed) throw Error('Deadline worker did not resume safely after image restart');
JS
curl --fail --silent http://127.0.0.1:3100/api/trpc/health >/dev/null
echo 'Image boot, runtime branding, metadata, icon, secret exclusion, migrations, repeat bootstrap and record preservation after recreation passed.'
