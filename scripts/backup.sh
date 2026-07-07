#!/usr/bin/env bash
# Database backup: pg_dump from the `db` container, gzip, 14-day rotation.
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
mkdir -p "$BACKUP_DIR"

TS="$(date +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/${POSTGRES_DB}-${TS}.sql.gz"

echo "[backup] Dumping ${POSTGRES_DB} -> ${FILE}"
docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$FILE"

# Rotation: keep 14 days of backups.
find "$BACKUP_DIR" -name '*.sql.gz' -type f -mtime +14 -delete

echo "[backup] Done. Current backups:"
ls -lh "$BACKUP_DIR"

if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  if ! command -v rclone >/dev/null 2>&1; then
    echo "[backup] BACKUP_RCLONE_REMOTE is set but rclone is not installed." >&2
    exit 1
  fi
  echo "[backup] Copying ${FILE} to rclone remote ${BACKUP_RCLONE_REMOTE}"
  rclone copy "$FILE" "$BACKUP_RCLONE_REMOTE"
fi

if [ -n "${BACKUP_S3_URI:-}" ]; then
  if ! command -v aws >/dev/null 2>&1; then
    echo "[backup] BACKUP_S3_URI is set but aws CLI is not installed." >&2
    exit 1
  fi
  echo "[backup] Copying ${FILE} to S3 URI ${BACKUP_S3_URI}"
  aws s3 cp "$FILE" "$BACKUP_S3_URI"
fi

if [ -n "${BACKUP_SCP_DEST:-}" ]; then
  if ! command -v scp >/dev/null 2>&1; then
    echo "[backup] BACKUP_SCP_DEST is set but scp is not installed." >&2
    exit 1
  fi
  echo "[backup] Copying ${FILE} to SCP destination ${BACKUP_SCP_DEST}"
  scp "$FILE" "$BACKUP_SCP_DEST"
fi
