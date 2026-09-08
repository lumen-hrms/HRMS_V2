#!/usr/bin/env bash
#
# One entry point for local dev.
#
# DATABASE: the team shares ONE Postgres (Supabase) — set the three
# *_DATABASE_URL vars in apps/api/.env from the team vault. Schema is owned
# centrally: the migration owner runs `dev.sh migrate`; everyone else just
# pulls + `prisma generate`. Local Docker Postgres is used ONLY by the e2e
# suite ("dev.sh test", via apps/api/.env.test).
#
# AUTH: real Firebase everywhere — no local emulator. Needs a Firebase
# service-account JSON + web API key in apps/api/.env and the web config in
# apps/web/.env (see the .env.example files).
#
# Usage:
#   ./scripts/dev.sh          # MinIO up, deps, generate client, run API+web
#   ./scripts/dev.sh up       # same as above
#   ./scripts/dev.sh migrate  # apply pending migrations to the shared DB (owner only)
#   ./scripts/dev.sh test     # local Docker Postgres + unit+e2e+lint+build
#   ./scripts/dev.sh seed     # seed the shared DB (owner only — creates demo tenants)
#   ./scripts/dev.sh down     # stop local Docker services (data volume is kept)

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

ACTION="${1:-up}"

check_docker() {
  if ! docker info >/dev/null 2>&1; then
    echo "Docker isn't accessible from this shell."
    echo "If you were just added to the docker group, log out/in (or run: newgrp docker) and try again."
    echo "Otherwise make sure Docker is installed and running."
    exit 1
  fi
}

ensure_env() {
  if [ ! -f apps/api/.env ]; then
    echo "Creating apps/api/.env from apps/api/.env.example — FILL IN the FIREBASE_* values."
    cp apps/api/.env.example apps/api/.env
  fi
  if [ ! -f apps/web/.env ]; then
    echo "Creating apps/web/.env from apps/web/.env.example — FILL IN the VITE_FIREBASE_* values."
    cp apps/web/.env.example apps/web/.env
  fi
}

# Verify the Firebase config that actually breaks things if absent — the
# backend service account (token verification + user management), the web
# API key (hosted password-reset email), and the web app config (without
# which the SPA renders a blank page). Prints exactly what's missing.
check_firebase_config() {
  local missing=()
  grep -qE '^[[:space:]]*FIREBASE_SERVICE_ACCOUNT_JSON=[^[:space:]#]' apps/api/.env 2>/dev/null \
    || missing+=("apps/api/.env : FIREBASE_SERVICE_ACCOUNT_JSON  (service-account JSON on one line)")
  grep -qE '^[[:space:]]*FIREBASE_WEB_API_KEY="?[^"#[:space:]]' apps/api/.env 2>/dev/null \
    || missing+=("apps/api/.env : FIREBASE_WEB_API_KEY  (Project settings > General > Web API Key)")
  grep -qE '^[[:space:]]*VITE_FIREBASE_API_KEY="[^"]' apps/web/.env 2>/dev/null \
    || missing+=("apps/web/.env : VITE_FIREBASE_API_KEY")
  grep -qE '^[[:space:]]*VITE_FIREBASE_AUTH_DOMAIN="[^"]' apps/web/.env 2>/dev/null \
    || missing+=("apps/web/.env : VITE_FIREBASE_AUTH_DOMAIN  (<project-id>.firebaseapp.com)")
  [ ${#missing[@]} -eq 0 ] && return 0
  echo ""
  echo "Firebase config is incomplete:"
  printf '  missing  %s\n' "${missing[@]}"
  echo ""
  echo "Get these from the Firebase console: Project settings > General (web app"
  echo "config + Web API Key) and Project settings > Service accounts"
  echo "(Generate new private key)."
  exit 1
}

wait_for_postgres() {
  echo "Waiting for Postgres to be ready..."
  for _ in $(seq 1 30); do
    if docker compose exec -T postgres pg_isready -U hrms_superuser -d hrms >/dev/null 2>&1; then
      echo "Postgres is ready."
      return 0
    fi
    sleep 1
  done
  echo "Postgres didn't become ready in time. Check: docker compose logs postgres"
  exit 1
}

# DATABASE_URL for the LOCAL Docker Postgres (docker-compose.yml defaults —
# not secret). Used by the "test" path so `prisma migrate deploy` targets
# the local DB, not the shared Supabase one in apps/api/.env.
LOCAL_DB_URL="postgresql://hrms_superuser:hrms_superuser_pw@localhost:5432/hrms?schema=public"

case "$ACTION" in
  up)
    check_docker
    ensure_env
    check_firebase_config
    # Only MinIO locally now — the database is the shared Supabase one.
    docker compose up -d minio
    npm run install:all
    npm run prisma:generate
    # Informational only — never blocks `up`.
    ( cd apps/api && npx prisma migrate status ) || \
      echo "NOTE: shared DB may have pending migrations — the migration owner runs './scripts/dev.sh migrate'."
    echo ""
    echo "Starting API (http://localhost:3000/api) and web (http://localhost:5173)."
    echo "Ctrl+C stops both."
    trap 'kill 0' EXIT
    npm run dev:api &
    npm run dev:web &
    wait
    ;;

  migrate)
    # Migration owner only: apply pending migrations to the SHARED database
    # (apps/api/.env DATABASE_URL -> Supabase session pooler).
    ensure_env
    echo "Applying pending migrations to the shared database…"
    npm run prisma:generate
    npm run prisma:migrate
    ;;

  test)
    check_docker
    ensure_env
    check_firebase_config
    # e2e runs against LOCAL Docker Postgres (apps/api/.env.test), never the
    # shared DB — the suite creates and drops tenants.
    docker compose up -d
    wait_for_postgres
    npm run install:all
    npm run prisma:generate
    DATABASE_URL="$LOCAL_DB_URL" npm run prisma:migrate
    echo ""
    echo "==> Backend unit tests"
    npm run test:api
    echo ""
    echo "==> Backend e2e tests (tenant isolation + auth + identity & access,"
    echo "    against local Postgres + real Firebase)"
    npm run test:api:e2e
    echo ""
    echo "==> Lint + build (api + web)"
    npm run lint
    npm run build
    echo ""
    echo "All checks passed."
    ;;

  seed)
    # Owner only: seeds the SHARED database + creates the demo tenants'
    # Firebase users in the shared project.
    ensure_env
    check_firebase_config
    read -r -p "Seed the SHARED database (creates demo tenants + Firebase users)? [y/N] " ans
    [ "$ans" = "y" ] || [ "$ans" = "Y" ] || { echo "Aborted."; exit 0; }
    npm run prisma:seed
    ;;

  down)
    # No -v: the hrms_pg_data / hrms_minio_data volumes are kept so local
    # test data survives a stop/start. `docker compose down -v` (manual) is
    # the only thing that wipes them.
    docker compose down
    ;;

  *)
    echo "Usage: $0 [up|migrate|test|seed|down]"
    exit 1
    ;;
esac
