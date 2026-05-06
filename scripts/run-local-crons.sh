#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env.local"

DEFAULT_BASE_URL="${BASE_URL:-}"
BASE_URL="${DEFAULT_BASE_URL}"
CRON_SECRET_VALUE="${CRON_SECRET:-${1:-}}"

if [[ -z "${CRON_SECRET_VALUE}" && -f "${ENV_FILE}" ]]; then
  while IFS= read -r line; do
    [[ -z "${line}" || "${line}" =~ ^[[:space:]]*# ]] && continue
    if [[ "${line}" =~ ^CRON_SECRET=(.*)$ ]]; then
      CRON_SECRET_VALUE="${BASH_REMATCH[1]}"
      CRON_SECRET_VALUE="${CRON_SECRET_VALUE%\"}"
      CRON_SECRET_VALUE="${CRON_SECRET_VALUE#\"}"
      break
    fi
  done < "${ENV_FILE}"
fi

if [[ -z "${CRON_SECRET_VALUE}" ]]; then
  echo "Fehler: CRON_SECRET fehlt."
  echo "Hinweis: Weder Shell-Variable, Argument noch .env.local enthalten CRON_SECRET."
  echo "Nutzung: CRON_SECRET=dein-secret scripts/run-local-crons.sh"
  echo "   oder: scripts/run-local-crons.sh dein-secret"
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Fehler: curl ist nicht installiert."
  exit 1
fi

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

if [[ -z "${BASE_URL}" ]]; then
  echo "Fehler: Kein lokaler Next.js-Server erreichbar (3000/3001)."
  echo "Bitte zuerst 'npm run dev' starten oder BASE_URL setzen."
  exit 1
fi

ENDPOINTS=(
  "/api/goLive/sync/cron"
  "/api/salespipe/sync/cron"
  "/api/salespipe2/sync/cron"
  "/api/signups/sync/cron"
  "/api/churn/sync/cron"
  "/api/churnDrive/sync/cron"
  "/api/upDownsells/sync/cron"
  "/api/sms/sync/cron"
  "/api/payStripeTerminalInstallation/sync/cron"
  "/api/phorestPayRevenue/sync/cron"
  "/api/lookerLeads/sync/cron"
  "/api/dachClientNumbers/sync/cron"
  "/api/marketingCosts/sync/cron"
  "/api/leads/sync/cron"
)

echo "Starte lokale Cron-Laeufe gegen ${BASE_URL}"
echo

for endpoint in "${ENDPOINTS[@]}"; do
  echo "==> ${endpoint}"
  tmp_response_file="$(mktemp)"
  status_code="$(
    curl -sS -X POST "${BASE_URL}${endpoint}" \
      -H "Authorization: Bearer ${CRON_SECRET_VALUE}" \
      -H "Content-Type: application/json" \
      -o "${tmp_response_file}" \
      -w "%{http_code}"
  )"

  if [[ "${status_code}" == "200" ]]; then
    echo "Status: ${status_code} OK"
  else
    echo "Status: ${status_code} FEHLER"
  fi

  cat "${tmp_response_file}"
  rm -f "${tmp_response_file}"
  echo
done

echo "Fertig."
