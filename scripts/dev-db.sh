#!/usr/bin/env bash
# PMK-NEXUS local database helper (decision D-018). LOCAL ONLY.
#
#   scripts/dev-db.sh start    start the local stack, apply PI-CORE + NEXUS migrations, seed test accounts
#   scripts/dev-db.sh migrate  apply only the migrations/seed that are new (after you add a NEXUS migration)
#   scripts/dev-db.sh status   show the API URL and publishable key for .env.local
#   scripts/dev-db.sh psql     open a SQL prompt on the local NEXUS database
#   scripts/dev-db.sh stop     stop the stack (data is kept)
#   scripts/dev-db.sh reset    DELETE the local NEXUS database and rebuild it from scratch (asks first; --yes skips)
#
# Safety: talks only to the project "pmk-nexus" (containers supabase_*_pmk-nexus, ports 5543x).
# Never touches PI-CORE's stack, never links to a hosted project, never needs a service key.
# Details: docs/ops/local-setup.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# PI-CORE repo is only READ (its migration files). Override if it lives somewhere else.
PICORE_REPO="${PICORE_REPO:-$ROOT/../pi-core-v2}"
SUPABASE_CLI_VERSION="2.122.0"   # same as PI-CORE, so both stacks use the same images
DB_CONTAINER="supabase_db_pmk-nexus"
REST_CONTAINER="supabase_rest_pmk-nexus"

die() { echo "ERROR: $*" >&2; exit 1; }

supa() { pnpm dlx "supabase@${SUPABASE_CLI_VERSION}" --workdir "$ROOT" "$@"; }

# Refuse to run if config.toml is not the NEXUS one (a wrong file would act on another stack).
check_config() {
  grep -q '^project_id = "pmk-nexus"' "$ROOT/supabase/config.toml" \
    || die "supabase/config.toml is not the PMK-NEXUS config (project_id must be pmk-nexus)."
  command -v docker >/dev/null || die "Docker is not installed or not on PATH."
  docker info >/dev/null 2>&1 || die "Docker is not running. Open Docker and try again."
}

# SQL always goes into the NEXUS database container by name, so it cannot hit PI-CORE's database.
psql_local() {
  docker exec -i -e PGOPTIONS="${PGOPTIONS_LOCAL:-}" "$DB_CONTAINER" \
    psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@"
}

status_var() { supa status -o env 2>/dev/null | sed -n "s/^$1=\"\(.*\)\"$/\1/p"; }

apply_file() { # apply_file <label> <file>: one transaction per file, remembered in local_dev.applied_files
  local name="$1/$(basename "$2")"
  if [ "$(psql_local -tA -c "select count(*) from local_dev.applied_files where name = '$name'")" != "0" ]; then
    return 1
  fi
  echo "  applying $name"
  psql_local -1 -f - -c "insert into local_dev.applied_files (name) values ('$name')" < "$2"
  return 0
}

apply_dir() { # apply_dir <label> <dir>: *.sql in file-name order; prints "changed" if something was applied
  local f changed=0
  [ -d "$2" ] || die "Folder not found: $2 (set PICORE_REPO to your PI-CORE clone)"
  for f in $(ls "$2"/*.sql | sort); do
    if apply_file "$1" "$f"; then changed=1; fi
  done
  return $((1 - changed))
}

migrate() {
  local changed=0
  psql_local -c "set client_min_messages = warning;
                 create schema if not exists local_dev;
                 create table if not exists local_dev.applied_files (name text primary key, applied_at timestamptz not null default now());"
  echo "PI-CORE migrations (read from $PICORE_REPO/supabase/migrations):"
  apply_dir picore "$PICORE_REPO/supabase/migrations" && changed=1 || true
  echo "NEXUS migrations:"
  apply_dir nexus "$ROOT/supabase/migrations" && changed=1 || true
  echo "Local test accounts:"
  PGOPTIONS_LOCAL="-c nexus.allow_local_seed=yes" psql_local -1 -f - < "$ROOT/supabase/local/seed_test_accounts.sql" >/dev/null
  echo "  done (see docs/ops/local-setup.md for the list)"
  # PostgREST could not load the `nexus` schema before the migrations ran; make it look again.
  if [ "$changed" = "1" ]; then
    docker restart "$REST_CONTAINER" >/dev/null
  fi
  wait_api
}

wait_api() {
  local api key i code
  api="$(status_var API_URL)"; key="$(status_var PUBLISHABLE_KEY)"
  for i in $(seq 1 40); do
    code="$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $key" -H "Accept-Profile: nexus" "$api/rest/v1/" || true)"
    if [ "$code" = "200" ] && [ "$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $key" "$api/auth/v1/health" || true)" = "200" ]; then
      echo "API is ready."; return 0
    fi
    sleep 2
  done
  die "API did not become ready in 80 seconds. Check: docker logs $REST_CONTAINER"
}

show_status() {
  echo "NEXUS local stack (project pmk-nexus)"
  echo "  API URL       : $(status_var API_URL)"
  echo "  Publishable key: $(status_var PUBLISHABLE_KEY)"
  echo "  Mail catcher  : $(status_var MAILPIT_URL)"
  echo "  Database      : docker exec -it $DB_CONTAINER psql -U postgres   (or: scripts/dev-db.sh psql)"
  echo "Put the API URL and the publishable key into .env.local. Test accounts: docs/ops/local-setup.md"
}

start_stack() {
  # --ignore-health-check: PostgREST reports "unhealthy" until the nexus schema exists, which is only
  # after the migrations below. We wait for the API ourselves in wait_api.
  # Output goes to a log file: with --ignore-health-check the CLI prints a status JSON that contains
  # the local service key, and we never want that on screen or in a CI log.
  local log
  log="$(mktemp)"
  # The log may hold the local service key: delete it even if the script is interrupted (review L1).
  trap 'rm -f "$log"' EXIT INT TERM
  echo "Starting containers (first run downloads images and can take several minutes)..."
  if ! supa start --ignore-health-check >"$log" 2>&1; then
    echo "supabase start failed. Last lines of its log:" >&2
    grep -v -e '"SERVICE_ROLE_KEY"' -e '"SECRET_KEY"' "$log" | tail -15 >&2
    rm -f "$log"; exit 1
  fi
  rm -f "$log"
  local i
  for i in $(seq 1 30); do
    docker exec "$DB_CONTAINER" pg_isready -U postgres -q && break
    sleep 2
  done
  migrate
  show_status
}

cmd="${1:-}"
case "$cmd" in
  start)   check_config; start_stack ;;
  migrate) check_config; migrate ;;
  status)  check_config; show_status ;;
  psql)    check_config; docker exec -it "$DB_CONTAINER" psql -U postgres -d postgres ;;
  stop)    check_config; supa stop ;;
  reset)
    check_config
    if [ "${2:-}" != "--yes" ]; then
      echo "This DELETES the local NEXUS database (project pmk-nexus only) and rebuilds it."
      echo "PI-CORE's stack and the hosted project are not touched."
      read -r -p "Type yes to continue: " answer
      [ "$answer" = "yes" ] || die "Cancelled."
    fi
    supa stop --no-backup
    start_stack
    ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
