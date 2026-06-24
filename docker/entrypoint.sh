#!/bin/bash
set -e

# ── Config ──────────────────────────────────────────────────────────
PG_USER="${POSTGRES_USER:-okm}"
PG_PASS="${POSTGRES_PASSWORD:-okm}"
PG_DB="${POSTGRES_DB:-knowledge}"
SERVER_PORT="${SERVER_PORT:-8765}"

# ── 1. Start PostgreSQL via the official entrypoint (background) ───
# The official entrypoint handles initdb, user creation, db creation, etc.
echo "[entrypoint] Starting PostgreSQL via docker-entrypoint.sh..."
docker-entrypoint.sh postgres &

# ── 2. Wait for PostgreSQL to be ready ─────────────────────────────
echo "[entrypoint] Waiting for PostgreSQL to be ready..."
RETRIES=30
until pg_isready -U "$PG_USER" -d "$PG_DB" > /dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ $RETRIES -le 0 ]; then
    echo "[entrypoint] ERROR: PostgreSQL did not become ready in time"
    exit 1
  fi
  sleep 1
done
echo "[entrypoint] PostgreSQL is ready."

# ── 3. Apply schema (idempotent — uses IF NOT EXISTS) ─────────────
echo "[entrypoint] Applying schema..."
psql -U "$PG_USER" -d "$PG_DB" -f /app/schema.sql > /dev/null
echo "[entrypoint] Schema applied."

# ── 4. Seed default dataset if empty (idempotent) ─────────────────
DATASET_COUNT=$(psql -U "$PG_USER" -d "$PG_DB" -tAc "SELECT COUNT(*) FROM datasets")
if [ "$DATASET_COUNT" = "0" ]; then
  echo "[entrypoint] Seeding default dataset..."
  psql -U "$PG_USER" -d "$PG_DB" -c \
    "INSERT INTO datasets (dataset_id, version_key, root_path, schema_version, status, is_active, created_at)
     VALUES ('main', 'MAIN', '/app/data', 'v2', 'active', 1, NOW()::text)" > /dev/null
  echo "[entrypoint] Default dataset 'main' created."
else
  echo "[entrypoint] Dataset already exists ($DATASET_COUNT row(s))."
fi

# ── 5. Start Node.js viewer server ────────────────────────────────
echo "[entrypoint] Starting viewer server on port $SERVER_PORT..."
export DATABASE_URL="postgresql://${PG_USER}:${PG_PASS}@localhost:5432/${PG_DB}"

cd /app
exec node packages/server/dist/index.js --host 0.0.0.0 --port "$SERVER_PORT" --db "$DATABASE_URL"
