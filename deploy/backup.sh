#!/bin/sh
# Nightly Postgres backup for the research server: a compressed pg_dump, kept 14 days.
# Install on the VPS (from the repo's deploy/ folder):
#   crontab -e   →   15 3 * * *  cd /opt/mqrg/deploy && ./backup.sh >> backups/backup.log 2>&1
# Restore (into a fresh database):
#   gunzip -c backups/researchgate-<stamp>.sql.gz | docker compose exec -T db psql -U mqrg -d researchgate
# Copy backups/ off the machine too (rsync, rclone, object storage) — a backup on the same disk
# doesn't survive losing the disk.
set -eu
cd "$(dirname "$0")"
mkdir -p backups
stamp=$(date +%Y%m%d-%H%M%S)
docker compose exec -T db pg_dump -U mqrg -d researchgate --no-owner | gzip > "backups/researchgate-$stamp.sql.gz"
find backups -name 'researchgate-*.sql.gz' -mtime +14 -delete
echo "$(date -Is) backup ok: backups/researchgate-$stamp.sql.gz"
