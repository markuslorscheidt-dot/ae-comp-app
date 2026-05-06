#!/usr/bin/env bash
set -euo pipefail

DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
BOOTSTRAP_FILE="${BOOTSTRAP_FILE:-supabase/bootstrap-local.sql}"
LOG_FILE="${LOG_FILE:-/tmp/local-schema-apply.log}"
MAX_PASSES="${MAX_PASSES:-6}"

if [[ ! -f "${BOOTSTRAP_FILE}" ]]; then
  echo "Fehler: Bootstrap-Datei nicht gefunden: ${BOOTSTRAP_FILE}" >&2
  exit 1
fi

if [[ ! -x "/opt/homebrew/opt/libpq/bin/psql" ]]; then
  echo "Fehler: psql nicht gefunden unter /opt/homebrew/opt/libpq/bin/psql" >&2
  echo "Bitte zuerst: brew install libpq" >&2
  exit 1
fi

echo "Reset lokale Supabase DB..."
npx supabase db reset --local --no-seed --yes >/tmp/local-db-reset.log 2>&1 || {
  cat /tmp/local-db-reset.log
  exit 1
}

echo "Wende Bootstrap an: ${BOOTSTRAP_FILE}"
/opt/homebrew/opt/libpq/bin/psql "${DB_URL}" -v ON_ERROR_STOP=1 -f "${BOOTSTRAP_FILE}" >/tmp/local-bootstrap.log 2>&1 || {
  cat /tmp/local-bootstrap.log
  exit 1
}

python3 - <<'PY'
import glob
import os
import subprocess
import sys

db_url = os.environ.get("DB_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
log_file = os.environ.get("LOG_FILE", "/tmp/local-schema-apply.log")
max_passes = int(os.environ.get("MAX_PASSES", "6"))
psql_bin = "/opt/homebrew/opt/libpq/bin/psql"

sql_files = sorted(glob.glob("supabase-*.sql")) + sorted(glob.glob("supabase-migrations/*.sql"))
if not sql_files:
  print("Keine SQL-Dateien gefunden.")
  sys.exit(1)

with open(log_file, "w", encoding="utf-8") as log:
  log.write("=== Local schema apply log ===\n")

previous_fail_set = None
for pass_idx in range(1, max_passes + 1):
  print(f"\nPass {pass_idx}/{max_passes}")
  failures = []
  success = 0
  for sql_file in sql_files:
    with open(log_file, "a", encoding="utf-8") as log:
      log.write(f"\n==> PASS {pass_idx}: {sql_file}\n")
      proc = subprocess.run(
        [psql_bin, db_url, "-v", "ON_ERROR_STOP=1", "-f", sql_file],
        stdout=log,
        stderr=log,
      )
    if proc.returncode == 0:
      success += 1
      print(f"OK   {sql_file}")
    else:
      failures.append(sql_file)
      print(f"FAIL {sql_file}")

  print(f"Ergebnis Pass {pass_idx}: success={success}, fail={len(failures)}")
  if not failures:
    print("\nSchema-Setup erfolgreich abgeschlossen.")
    print(f"Detail-Log: {log_file}")
    sys.exit(0)

  fail_set = tuple(failures)
  if previous_fail_set == fail_set:
    print("\nKeine weitere Konvergenz erreicht (gleiche Restfehler wie im vorherigen Pass).")
    print("Verbleibende Dateien:")
    for item in failures:
      print(f" - {item}")
    print(f"\nDetail-Log: {log_file}")
    sys.exit(2)
  previous_fail_set = fail_set

print("\nMaximale Anzahl Pässe erreicht.")
print(f"Detail-Log: {log_file}")
sys.exit(2)
PY
