#!/usr/bin/env bash
# Start (or update) the backend on the server. Safe to re-run: pulls the
# latest code, rebuilds, applies database migrations, restarts.
#
#   cd ~/tiketi/deploy && ./up.sh
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env.production ]; then
  echo "Missing deploy/.env.production — make it on your PC with make_env.py and copy it here (see DEPLOY.md)." >&2
  exit 1
fi

git -C .. pull --ff-only || echo "(git pull skipped — continuing with the code that's here)"
mkdir -p backups
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
