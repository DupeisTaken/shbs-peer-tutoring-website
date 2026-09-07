#!/usr/bin/env bash
# CI acceptance gate: exercise the shipped image against an empty, disposable PostgreSQL DB.
set -euo pipefail
image="${1:?Pass the built image tag}"
: "${DATABASE_URL:?Set DATABASE_URL to an empty test database}"
case "$DATABASE_URL" in */shbs_boot_test) ;; *) echo 'Use the isolated shbs_boot_test database.' >&2; exit 1;; esac
name="shbs-smoke-${RANDOM}-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --detach --rm --network host --name "$name" \
  -e DATABASE_URL -e AUTH_SECRET -e AUTH_TRUST_HOST=true \
  -e AUTH_URL=http://127.0.0.1:3100 -e PORT=3100 "$image" >/dev/null
ready=false
for attempt in $(seq 1 60); do
  if curl --fail --silent http://127.0.0.1:3100/api/trpc/health > /tmp/shbs-health-$$.json; then ready=true; break; fi
  sleep 2
done
if [ "$ready" != true ]; then docker logs "$name"; exit 1; fi
node -e 'const fs=require("fs"); const r=JSON.parse(fs.readFileSync(process.argv[1]));if(r.result?.data?.json?.ok!==true)process.exit(1)' "/tmp/shbs-health-$$.json"
rm -f "/tmp/shbs-health-$$.json"
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
echo 'Image boot, migrations, clean bootstrap, repeat bootstrap and sign-in route passed.'
