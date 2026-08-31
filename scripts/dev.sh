#!/usr/bin/env bash
#
# One entry point for local dev: brings up Postgres+MinIO, installs deps,
# runs migrations/seed, and either starts both dev servers ("up", default)
# or runs the full test suite ("test") — same steps CI runs, just local.
#
# Usage:
#   ./scripts/dev.sh          # start Postgres+MinIO, migrate, seed, run API+web
#   ./scripts/dev.sh up       # same as above
#   ./scripts/dev.sh test     # migrate against a clean DB, run unit+e2e+lint+build
#   ./scripts/dev.sh seed     # (re)run the seed script only
#   ./scripts/dev.sh down     # stop Postgres+MinIO

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
    echo "No apps/api/.env found — copying apps/api/.env.example (local dev defaults, matches docker-compose.yml)."
    cp apps/api/.env.example apps/api/.env
  fi
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

case "$ACTION" in
  up)
    check_docker
    ensure_env
    docker compose up -d
    wait_for_postgres
    npm run install:all
    npm run prisma:generate
    npm run prisma:migrate
    npm run prisma:seed || echo "Seed skipped (likely already seeded — safe to ignore)."
    echo ""
    echo "Starting API (http://localhost:3000/api) and web (http://localhost:5173)."
    echo "Ctrl+C stops both."
    trap 'kill 0' EXIT
    npm run dev:api &
    npm run dev:web &
    wait
    ;;

  test)
    check_docker
    ensure_env
    docker compose up -d
    wait_for_postgres
    npm run install:all
    npm run prisma:generate
    npm run prisma:migrate
    echo ""
    echo "==> Backend unit tests"
    npm run test:api
    echo ""
    echo "==> Backend e2e tests (tenant isolation + auth, against real Postgres)"
    npm run test:api:e2e
    echo ""
    echo "==> Lint + build (api + web)"
    npm run lint
    npm run build
    echo ""
    echo "All checks passed."
    ;;

  seed)
    ensure_env
    npm run prisma:seed
    ;;

  down)
    docker compose down
    ;;

  *)
    echo "Usage: $0 [up|test|seed|down]"
    exit 1
    ;;
esac
