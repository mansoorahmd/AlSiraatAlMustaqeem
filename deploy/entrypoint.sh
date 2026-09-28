#!/bin/sh
# The research server container's commands. `serve` (the default) applies any pending
# migrations, then starts the server. The others are the maintainer's one-off jobs:
#   docker compose run --rm server corpus-migrate        # load /corpus/quran.db into Postgres
#   docker compose run --rm server bootstrap you@example.org "Your Name"
#   docker compose run --rm server set-password you@example.org
#   docker compose run --rm server set-plan you@example.org pro
#   docker compose run --rm server access show
set -e
run() { exec node --import tsx "$@"; }
# quran.db is a WAL-mode SQLite file, which SQLite can't open from the read-only /corpus mount,
# so the loader works on a private copy in the container's own temp space.
corpus_copy() {
  src="${QF_QURAN_DB:-/corpus/quran.db}"
  [ -f "$src" ] || { echo "no corpus at $src — copy quran.db into deploy/corpus/ first (DEPLOY.md step 4)" >&2; exit 1; }
  cp "$src" /tmp/quran.db && export QF_QURAN_DB=/tmp/quran.db
}

cmd="${1:-serve}"; [ $# -gt 0 ] && shift
case "$cmd" in
  serve)
    node --import tsx src/deploy-check-cli.ts
    node --import tsx src/migrate-cli.ts
    run src/server.ts ;;
  migrate)        run src/migrate-cli.ts "$@" ;;
  corpus-migrate) corpus_copy; run src/corpus-migrate-cli.ts "$@" ;;
  corpus-parity)  corpus_copy; run src/corpus-parity-cli.ts "$@" ;;
  bootstrap)      run src/bootstrap-cli.ts "$@" ;;
  set-password)   run src/set-password-cli.ts "$@" ;;
  set-plan)       run src/set-plan-cli.ts "$@" ;;
  access)         run src/access-cli.ts "$@" ;;
  smoke)          run src/smoke-cli.ts "$@" ;;
  *) echo "unknown command: $cmd (serve | migrate | corpus-migrate | corpus-parity | bootstrap | set-password | set-plan | access | smoke)" >&2; exit 2 ;;
esac
