#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.local"
LOCK_DIR="${ROOT_DIR}/.tmp/local-imports-cycle.lock"

BASE_URL="${BASE_URL:-}"
CRON_SECRET_VALUE="${CRON_SECRET:-}"

read_env_value() {
  local key="$1"
  local file_path="$2"
  local value=""

  if [[ -f "${file_path}" ]]; then
    while IFS= read -r line; do
      [[ -z "${line}" || "${line}" =~ ^[[:space:]]*# ]] && continue
      if [[ "${line}" =~ ^${key}=(.*)$ ]]; then
        value="${BASH_REMATCH[1]}"
        value="${value%\"}"
        value="${value#\"}"
        break
      fi
    done < "${file_path}"
  fi

  printf "%s" "${value}"
}

if [[ -z "${CRON_SECRET_VALUE}" ]]; then
  CRON_SECRET_VALUE="$(read_env_value "CRON_SECRET" "${ENV_FILE}")"
fi

timestamp() {
  date +"%Y-%m-%d %H:%M:%S"
}

log() {
  echo "[$(timestamp)] $*"
}

acquire_lock() {
  mkdir -p "${ROOT_DIR}/.tmp"
  if mkdir "${LOCK_DIR}" 2>/dev/null; then
    trap 'rm -rf "${LOCK_DIR}"' EXIT
    return
  fi

  log "WARN Import-Zyklus laeuft bereits. Dieser Lauf wird uebersprungen."
  exit 0
}

put_auto_import_enabled() {
  local endpoint="$1"
  local response_file
  local status_code

  response_file="$(mktemp)"
  status_code="$(
    curl -sS -X PUT "${BASE_URL}${endpoint}" \
      -H "Content-Type: application/json" \
      -d '{"enabled":true}' \
      -o "${response_file}" \
      -w "%{http_code}"
  )"

  if [[ "${status_code}" == "200" ]]; then
    log "Auto-Import aktiviert: ${endpoint}"
  else
    log "WARN Auto-Import konnte nicht aktiviert werden (${endpoint}, HTTP ${status_code})."
    log "Antwort: $(<"${response_file}")"
  fi

  rm -f "${response_file}"
}

post_endpoint() {
  local endpoint="$1"
  local use_cron_auth="${2:-false}"
  local response_file
  local status_code

  response_file="$(mktemp)"

  if [[ "${use_cron_auth}" == "true" ]]; then
    status_code="$(
      curl -sS -X POST "${BASE_URL}${endpoint}" \
        -H "Authorization: Bearer ${CRON_SECRET_VALUE}" \
        -H "Content-Type: application/json" \
        -o "${response_file}" \
        -w "%{http_code}"
    )"
  else
    status_code="$(
      curl -sS -X POST "${BASE_URL}${endpoint}" \
        -H "Content-Type: application/json" \
        -o "${response_file}" \
        -w "%{http_code}"
    )"
  fi

  if [[ "${status_code}" == "200" ]]; then
    log "OK ${endpoint}"
  else
    log "WARN ${endpoint} -> HTTP ${status_code}"
  fi
  log "Antwort ${endpoint}: $(<"${response_file}")"

  rm -f "${response_file}"
}

if ! command -v curl >/dev/null 2>&1; then
  echo "Fehler: curl ist nicht installiert."
  exit 1
fi

acquire_lock

probe_base_url() {
  local candidate="$1"
  curl -sS --max-time 3 "${candidate}" >/dev/null 2>&1
}

if [[ -z "${BASE_URL}" ]]; then
  for candidate in "http://localhost:3000" "http://localhost:3001" "http://127.0.0.1:3000" "http://127.0.0.1:3001"; do
    if probe_base_url "${candidate}"; then
      BASE_URL="${candidate}"
      break
    fi
  done
fi

if [[ -z "${CRON_SECRET_VALUE}" ]]; then
  echo "Fehler: CRON_SECRET fehlt (weder Shell-Variable noch .env.local)."
  exit 1
fi

if [[ -z "${BASE_URL}" ]]; then
  echo "Fehler: Kein lokaler Next.js-Server erreichbar (3000/3001)."
  echo "Bitte zuerst 'npm run dev' starten oder BASE_URL setzen."
  exit 1
fi

log "Starte lokalen Import-Zyklus (15-Minuten-Autopilot)."
log "Base URL: ${BASE_URL}"

# Sicherstellen, dass Auto-Import-Flags auf true stehen.
put_auto_import_enabled "/api/goLive/sync/auto-import"
put_auto_import_enabled "/api/churn/sync/auto-import"
put_auto_import_enabled "/api/churnDrive/sync/auto-import"
put_auto_import_enabled "/api/upDownsells/sync/auto-import"
put_auto_import_enabled "/api/sms/sync/auto-import"
put_auto_import_enabled "/api/payStripeTerminalInstallation/sync/auto-import"
put_auto_import_enabled "/api/phorestPayRevenue/sync/auto-import"
put_auto_import_enabled "/api/lookerLeads/sync/auto-import"
put_auto_import_enabled "/api/dachClientNumbers/sync/auto-import"
put_auto_import_enabled "/api/marketingCosts/sync/auto-import"
put_auto_import_enabled "/api/salespipe/sync/auto-import"
put_auto_import_enabled "/api/leads/sync/auto-import"
put_auto_import_enabled "/api/signups/sync/auto-import"
put_auto_import_enabled "/api/salespipe2/sync/auto-import"

# Klassische Cron-Routen triggern.
"${SCRIPT_DIR}/run-local-crons.sh"

# Ingest-basierte Flows zusätzlich direkt triggern.
post_endpoint "/api/signups/sync" "false"
post_endpoint "/api/churnDrive/sync" "false"

# Salespipe2 hat aktuell nur den Ingest-Weg mit Payload.
post_endpoint "/api/salespipe2/sync/cron" "true"
log "Hinweis: Salespipe2 schreibt echte Daten nur über /api/salespipe2/sync/ingest (mit CSV-Payload)."
log "Hinweis: Leads läuft bevorzugt über /api/leads/sync/ingest (Apps Script)."

# Paymargin braucht Datei-Upload und ist daher nicht rein zeitgesteuert ausführbar.
log "Hinweis: Paymargin CSV Import benötigt weiterhin Datei-Upload (/api/paymargin/import)."
log "Import-Zyklus beendet."
