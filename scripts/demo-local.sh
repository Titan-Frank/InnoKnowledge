#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DB_NAME="${DEMO_DB_NAME:-okm_demo}"
DEMO_DATABASE_URL="postgresql://okm:okm@127.0.0.1:5432/${DEMO_DB_NAME}"
DEMO_HOST="${DEMO_HOST:-127.0.0.1}"
DEMO_PORT="${DEMO_PORT:-8765}"
MODE="${1:-serve}"

if [[ ! "$DEMO_DB_NAME" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "DEMO_DB_NAME may contain only letters, numbers, and underscores." >&2
  exit 1
fi

if [[ "$MODE" != "serve" && "$MODE" != "seed-only" ]]; then
  echo "Usage: scripts/demo-local.sh [serve|seed-only]" >&2
  exit 1
fi

cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker with the Compose plugin is required for the local demo." >&2
  exit 1
fi

echo "Starting the repository PostgreSQL service..."
docker compose up -d postgres

ready=0
for _ in {1..30}; do
  if docker compose exec -T postgres pg_isready -U okm -d knowledge >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done

if [[ "$ready" -ne 1 ]]; then
  echo "PostgreSQL did not become ready within 60 seconds." >&2
  exit 1
fi

if ! docker compose exec -T postgres psql -U okm -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '${DEMO_DB_NAME}'" | tr -d '[:space:]' | grep -qx '1'; then
  echo "Creating isolated demo database ${DEMO_DB_NAME}..."
  docker compose exec -T postgres createdb -U okm "$DEMO_DB_NAME"
fi

echo "Applying world-v1.2 schema to ${DEMO_DB_NAME}..."
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U okm -d "$DEMO_DB_NAME" \
  < schemas/pg/knowledge_store.sql

echo "Loading the repository-safe synthetic graph..."
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U okm -d "$DEMO_DB_NAME" \
  < examples/demo-data/seed-demo.sql

echo "Demo dataset loaded into ${DEMO_DATABASE_URL}."

if [[ "$MODE" == "seed-only" ]]; then
  exit 0
fi

echo "Building and opening the viewer at http://${DEMO_HOST}:${DEMO_PORT}/viewer/"
npm run build
npm run start -w packages/server -- \
  --host "$DEMO_HOST" \
  --port "$DEMO_PORT" \
  --db "$DEMO_DATABASE_URL"
