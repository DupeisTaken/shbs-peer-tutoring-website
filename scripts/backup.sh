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

# TODO: copy the backup off-box for real disaster recovery, e.g.:
#   rclone copy "$FILE" remote:shbs-backups/
#   aws s3 cp "$FILE" s3://your-bucket/shbs-backups/
#   scp "$FILE" user@backup-host:/backups/
