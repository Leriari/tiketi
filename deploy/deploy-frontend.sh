#!/usr/bin/env bash
# Build the frontend against the deployed API and publish it to Firebase
# Hosting (https://tiketi-6e9fd.web.app). Run on your PC (Git Bash):
#
#   bash deploy/deploy-frontend.sh
#
# First time only: `npx firebase-tools login` (opens a browser).
set -euo pipefail
cd "$(dirname "$0")/.."

api_domain=$(grep -E '^API_DOMAIN=' deploy/.env.production | cut -d= -f2)
if [ -z "$api_domain" ]; then
  echo "API_DOMAIN not found in deploy/.env.production — run make_env.py first." >&2
  exit 1
fi

# Checks the API is up before publishing a site that depends on it.
if ! curl -fsS --max-time 15 "https://$api_domain/" >/dev/null; then
  echo "Warning: https://$api_domain/ isn't answering yet — publishing anyway." >&2
fi

cat > frontend/.env.production.local <<EOF
VITE_USE_MOCK=false
VITE_API_BASE_URL=https://$api_domain/api/v1
EOF

cd frontend
npm ci
npm run build
npx --yes firebase-tools deploy --only hosting --project tiketi-6e9fd
echo "Live at https://tiketi-6e9fd.web.app"
