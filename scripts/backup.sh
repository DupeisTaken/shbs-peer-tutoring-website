#!/usr/bin/env bash
# Database backup: private validated daily dumps, upload-aware 14-day rotation.
# Schedule via cron, e.g.:  0 3 * * *  /opt/shbs/scripts/backup.sh >> /var/log/shbs-backup.log 2>&1
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# Load POSTGRES_* from .env
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
umask 077
: "${POSTGRES_DB:?POSTGRES_DB must be configured}"
: "${POSTGRES_USER:?POSTGRES_USER must be configured}"
# The database is also a filename prefix. Never allow it to select another path.
if [[ "$POSTGRES_DB" == */* || "$POSTGRES_DB" == *$'\n'* || "$POSTGRES_DB" == *$'\r'* ]]; then
  echo "[backup] POSTGRES_DB cannot contain path separators or line breaks." >&2
  exit 1
fi
mkdir -p -m 700 -- "$BACKUP_DIR"
BACKUP_DIR="$(cd -- "$BACKUP_DIR" && pwd -P)"

# Keep ownership for the entire dump/upload/rotation lifecycle. A mkdir lock also
# fails closed after SIGKILL or power loss; never guess that a PID/lock is stale.
LOCK_DIR="$BACKUP_DIR/.backup.lock"
if ! mkdir -m 700 -- "$LOCK_DIR"; then
  echo "[backup] Backup lock exists or cannot be created: $LOCK_DIR. Inspect the owner before retrying." >&2
  exit 1
fi
TEMP_FILE=""
RETENTION_LIST="$LOCK_DIR/retention.list"
cleanup() {
  local status=$?
  trap - EXIT
  # These exact paths belong to this invocation. Never sweep other partials.
  if [[ -n "$TEMP_FILE" ]]; then rm -f -- "$TEMP_FILE" || status=1; fi
  rm -f -- "$RETENTION_LIST" || status=1
  rmdir -- "$LOCK_DIR" || status=1
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# Check configured upload tools before spending time on a dump. No rotation is
# permitted until every configured transfer has returned success.
for setting in BACKUP_RCLONE_REMOTE BACKUP_S3_URI BACKUP_SCP_DEST; do
  if [[ -z "${!setting:-}" ]]; then continue; fi
  case "$setting" in
    BACKUP_RCLONE_REMOTE) tool=rclone ;;
    BACKUP_S3_URI) tool=aws ;;
    BACKUP_SCP_DEST) tool=scp ;;
  esac
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "[backup] $setting is set but $tool is not installed." >&2
    exit 1
  fi
done

TEMP_FILE="$(mktemp "$LOCK_DIR/dump.partial.XXXXXXXXXX")"
TS="$(date +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/${POSTGRES_DB}-daily-${TS}-${TEMP_FILE##*.}.sql.gz"

echo "[backup] Dumping ${POSTGRES_DB} into private staging."
docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$TEMP_FILE"
gzip -t -- "$TEMP_FILE"
# CRC integrity alone accepts an empty gzip. Require the plain pg_dump framing,
# consuming the whole stream so pipefail also catches decompression errors.
if ! gzip -cd -- "$TEMP_FILE" | awk '
  /^-- PostgreSQL database dump$/ { header = 1 }
  /^-- PostgreSQL database dump complete$/ { if (header) complete = 1 }
  END { exit !(header && complete) }
'; then
  echo "[backup] Archive is not a complete plain PostgreSQL dump; nothing published." >&2
  exit 1
fi
# Same-filesystem hard-link publication is atomic and refuses an existing name.
# A failed publication cannot overwrite a prior recovery point.
ln -T -- "$TEMP_FILE" "$FILE"
rm -- "$TEMP_FILE"
TEMP_FILE=""
echo "[backup] Published validated local backup: ${FILE}"

if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  echo "[backup] Copying ${FILE} to rclone remote ${BACKUP_RCLONE_REMOTE}"
  rclone copy "$FILE" "$BACKUP_RCLONE_REMOTE"
fi

if [ -n "${BACKUP_S3_URI:-}" ]; then
  echo "[backup] Copying ${FILE} to S3 URI ${BACKUP_S3_URI}"
  aws s3 cp "$FILE" "$BACKUP_S3_URI"
fi

if [ -n "${BACKUP_SCP_DEST:-}" ]; then
  echo "[backup] Copying ${FILE} to SCP destination ${BACKUP_SCP_DEST}"
  scp "$FILE" "$BACKUP_SCP_DEST"
fi

# Only this script's daily namespace is retention-owned. Legacy archives, release
# checkpoints, nested recovery-hold directories and other databases stay intact.
# Preserve find's existing -mtime +14 boundary (15 completed 24-hour periods).
find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.sql.gz' -mtime +14 -print0 > "$RETENTION_LIST"
while IFS= read -r -d '' candidate; do
  name="${candidate##*/}"
  [[ "$name" == "${POSTGRES_DB}-daily-"* ]] || continue
  suffix="${name#"${POSTGRES_DB}-daily-"}"
  [[ "$suffix" =~ ^[0-9]{8}-[0-9]{6}-[A-Za-z0-9]{10}\.sql\.gz$ ]] || continue
  [[ "$candidate" != "$FILE" ]] || continue
  # Any marker, including a directory or dangling symlink, conservatively holds it.
  [[ ! -e "$candidate.hold" && ! -L "$candidate.hold" ]] || continue
  rm -- "$candidate"
done < "$RETENTION_LIST"

echo "[backup] Done. Configured uploads and daily retention completed."
