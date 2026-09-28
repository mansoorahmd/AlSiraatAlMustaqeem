#!/bin/sh
# Update the running deployment: pull the latest code, back up the database, rebuild the images
# and restart, then wait until the public address answers. Run on the VPS:
#   /opt/mqrg/deploy/update.sh            # main
#   /opt/mqrg/deploy/update.sh <branch>   # another branch
# The server applies any pending migrations when it starts, so the backup is taken first.
set -eu
cd "$(dirname "$0")/.."
branch="${1:-main}"

git fetch --quiet origin
git checkout --quiet "$branch"
git merge --ff-only --quiet "origin/$branch"
echo "code: $branch @ $(git log --oneline -1)"

cd deploy
domain=$(sed -n 's/^DOMAIN=//p' .env)
[ -n "$domain" ] || { echo "DOMAIN is not set in deploy/.env" >&2; exit 1; }

if [ -n "$(docker compose ps -q db)" ]; then ./backup.sh; fi

docker compose up -d --build

# Caddy sends traffic to the server only after its first health check passes (up to ~30 s).
printf 'waiting for https://%s/health ' "$domain"
i=0
until curl -fs -o /dev/null --max-time 5 "https://$domain/health"; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo; echo "not healthy after 3 minutes — see: docker compose logs --tail 50 server" >&2
    exit 1
  fi
  printf '.'; sleep 3
done
echo " ok"

docker image prune -f > /dev/null
docker compose ps --format '{{.Name}}  {{.Status}}'
