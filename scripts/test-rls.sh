#!/usr/bin/env bash
# Run the RLS tests against a throwaway Postgres built from the migrations.
#
# There is no Supabase project involved and none is needed: supabase/tests/
# stubs the few auth objects the migrations reference. What is being tested is
# the policies, so everything runs as `anon` or `authenticated` -- never as the
# table owner, who bypasses RLS entirely and would make every test pass.
#
# Usage:  npm run test:rls          (or bash scripts/test-rls.sh)
set -euo pipefail

CONTAINER=seqbaby-rls-test
IMAGE=postgres:15

cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "docker is not running -- these tests need it to build a scratch database" >&2
  exit 1
fi

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "starting $IMAGE ..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=test "$IMAGE" >/dev/null
for _ in $(seq 1 60); do docker exec "$CONTAINER" pg_isready -q && break; sleep 0.5; done

run() { docker exec -i "$CONTAINER" psql -U postgres -q -v ON_ERROR_STOP=1 -f "/tmp/$1"; }
copy() { docker cp "$1" "$CONTAINER:/tmp/$(basename "$1")" >/dev/null; }

copy supabase/tests/00_local_auth_stub.sql
run 00_local_auth_stub.sql

echo "applying migrations ..."
for f in supabase/migrations/*.sql; do
  copy "$f"
  run "$(basename "$f")"
done

copy supabase/tests/99_local_grants.sql
run 99_local_grants.sql

echo "running tests ..."
copy supabase/tests/rls_test.sql

# The GUC is the guard inside rls_test.sql: without it the script refuses to
# run, so it cannot be aimed at a real database by accident.
#
# Run once, capture everything, then decide. Piping psql straight into a filter
# would hand the pipeline's exit status to the filter and every failure would
# look like a pass.
out=$(mktemp)
set +e
docker exec -i -e PGOPTIONS="-c seqbaby.test_db=yes" "$CONTAINER" \
  psql -U postgres -q -v ON_ERROR_STOP=1 -f /tmp/rls_test.sql >"$out" 2>&1
status=$?
set -e

sed -e 's/^psql:[^ ]*: //' -e 's/^NOTICE:  //' "$out"

if [ "$status" -ne 0 ]; then
  echo ""
  echo "RLS TESTS FAILED" >&2
  rm -f "$out"
  exit 1
fi
rm -f "$out"
