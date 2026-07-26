#!/usr/bin/env bash
# One-shot Railway deploy for the vasooli app.
# Prereqs:
#   1) railway login        (interactive, one browser click) OR export RAILWAY_API_TOKEN=<account token>
#   2) export SARVAM_API_KEY=<key>   (never committed)
# Run from the repo root:  bash scripts/railway-deploy.sh
set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-vasooli}"
WEB_SERVICE="web"

echo "==> whoami"; railway whoami

echo "==> create project '$PROJECT_NAME'"
railway init -n "$PROJECT_NAME"

echo "==> add Postgres (service name: Postgres)"
railway add --database postgres

echo "==> create web service"
railway add --service "$WEB_SERVICE"

echo "==> set env vars on '$WEB_SERVICE'"
# Single quotes so the local shell does NOT expand the Railway reference ${{Postgres.DATABASE_URL}}.
railway variables --service "$WEB_SERVICE" --skip-deploys \
  --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
  --set "SARVAM_API_KEY=${SARVAM_API_KEY:?export SARVAM_API_KEY first}" \
  --set "VOICE_MOCK_MODE=${VOICE_MOCK_MODE:-1}" \
  --set "PAYMENT_MOCK_MODE=${PAYMENT_MOCK_MODE:-1}"

echo "==> deploy current directory to '$WEB_SERVICE'"
railway up --service "$WEB_SERVICE" --detach

echo "==> generate public domain"
railway domain --service "$WEB_SERVICE" || true
APP_URL="$(railway domain --service "$WEB_SERVICE" --json 2>/dev/null | grep -o 'https://[^"]*' | head -1 || true)"
if [ -n "${APP_URL:-}" ]; then
  echo "    app: $APP_URL"
  railway variables --service "$WEB_SERVICE" --skip-deploys --set "APP_BASE_URL=$APP_URL"
fi

echo "==> push schema + seed (uses Postgres PUBLIC url, reachable from here)"
PUBLIC_DB="$(railway variables --service Postgres --kv 2>/dev/null | sed -n 's/^DATABASE_PUBLIC_URL=//p')"
if [ -n "${PUBLIC_DB:-}" ]; then
  DATABASE_URL="$PUBLIC_DB" npm run db:push
  DATABASE_URL="$PUBLIC_DB" npm run db:seed
else
  echo "    ! Could not read DATABASE_PUBLIC_URL — run db:push/db:seed manually against the public URL."
fi

echo "==> done. Dashboard: railway open"
