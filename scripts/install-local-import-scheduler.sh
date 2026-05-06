#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env.local"
LABEL="com.aecomp.local-imports.15min"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="${HOME}/Library/Logs"
LOG_PATH="${LOG_DIR}/com.aecomp.local-imports.15min.log"
RUNNER_DIR="${HOME}/Library/Application Support/ae-comp-app"
RUNNER_PATH="${RUNNER_DIR}/local-imports-runner.sh"
SCHEDULE_HOUR="${LOCAL_IMPORT_SCHEDULE_HOUR:-5}"
SCHEDULE_MINUTE="${LOCAL_IMPORT_SCHEDULE_MINUTE:-0}"

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

CRON_SECRET_VALUE="${CRON_SECRET:-}"
if [[ -z "${CRON_SECRET_VALUE}" ]]; then
  CRON_SECRET_VALUE="$(read_env_value "CRON_SECRET" "${ENV_FILE}")"
fi

if [[ -z "${CRON_SECRET_VALUE}" ]]; then
  echo "Fehler: CRON_SECRET konnte nicht ermittelt werden."
  echo "Bitte CRON_SECRET in .env.local setzen oder beim Aufruf exportieren."
  exit 1
fi

mkdir -p "${HOME}/Library/LaunchAgents"
mkdir -p "${LOG_DIR}"
mkdir -p "${RUNNER_DIR}"

cat > "${RUNNER_PATH}" <<EOF
#!/usr/bin/env bash
set -euo pipefail

CRON_SECRET_VALUE="${CRON_SECRET_VALUE}"
BASE_URL="\${BASE_URL:-}"

timestamp() {
  date +"%Y-%m-%d %H:%M:%S"
}

log() {
  echo "[\$(timestamp)] \$*"
}

probe_base_url() {
  local candidate="\$1"
  curl -sS --max-time 3 "\${candidate}" >/dev/null 2>&1
}

if [[ -z "\${BASE_URL}" ]]; then
  for candidate in "http://localhost:3000" "http://localhost:3001" "http://127.0.0.1:3000" "http://127.0.0.1:3001"; do
    if probe_base_url "\${candidate}"; then
      BASE_URL="\${candidate}"
      break
    fi
  done
fi

if [[ -z "\${BASE_URL}" ]]; then
  log "WARN Kein lokaler Next.js-Server erreichbar (3000/3001)."
  exit 0
fi

call_endpoint() {
  local method="\$1"
  local endpoint="\$2"
  local use_auth="\$3"
  local data="\${4:-}"
  local response_file
  local status_code

  response_file="\$(mktemp)"
  if [[ "\${use_auth}" == "true" ]]; then
    if [[ -n "\${data}" ]]; then
      status_code="\$(
        curl -sS -X "\${method}" "\${BASE_URL}\${endpoint}" \
          -H "Authorization: Bearer \${CRON_SECRET_VALUE}" \
          -H "Content-Type: application/json" \
          -d "\${data}" \
          -o "\${response_file}" \
          -w "%{http_code}"
      )"
    else
      status_code="\$(
        curl -sS -X "\${method}" "\${BASE_URL}\${endpoint}" \
          -H "Authorization: Bearer \${CRON_SECRET_VALUE}" \
          -H "Content-Type: application/json" \
          -o "\${response_file}" \
          -w "%{http_code}"
      )"
    fi
  elif [[ -n "\${data}" ]]; then
    status_code="\$(
      curl -sS -X "\${method}" "\${BASE_URL}\${endpoint}" \
        -H "Content-Type: application/json" \
        -d "\${data}" \
        -o "\${response_file}" \
        -w "%{http_code}"
    )"
  else
    status_code="\$(
      curl -sS -X "\${method}" "\${BASE_URL}\${endpoint}" \
        -H "Content-Type: application/json" \
        -o "\${response_file}" \
        -w "%{http_code}"
    )"
  fi

  if [[ "\${status_code}" == "200" ]]; then
    log "OK \${method} \${endpoint}"
  else
    log "WARN \${method} \${endpoint} -> HTTP \${status_code}"
  fi
  log "Antwort \${endpoint}: \$(<"\${response_file}")"
  rm -f "\${response_file}"
}

log "Starte 15-Minuten-Importzyklus (LaunchAgent). Base URL: \${BASE_URL}"

for endpoint in \
  "/api/goLive/sync/auto-import" \
  "/api/churn/sync/auto-import" \
  "/api/churnDrive/sync/auto-import" \
  "/api/upDownsells/sync/auto-import" \
  "/api/sms/sync/auto-import" \
  "/api/payStripeTerminalInstallation/sync/auto-import" \
  "/api/phorestPayRevenue/sync/auto-import" \
  "/api/lookerLeads/sync/auto-import" \
  "/api/dachClientNumbers/sync/auto-import" \
  "/api/marketingCosts/sync/auto-import" \
  "/api/salespipe/sync/auto-import" \
  "/api/leads/sync/auto-import" \
  "/api/signups/sync/auto-import" \
  "/api/salespipe2/sync/auto-import"; do
  call_endpoint "PUT" "\${endpoint}" "false" '{"enabled":true}'
done

for endpoint in \
  "/api/goLive/sync/cron" \
  "/api/salespipe/sync/cron" \
  "/api/salespipe2/sync/cron" \
  "/api/signups/sync/cron" \
  "/api/churn/sync/cron" \
  "/api/churnDrive/sync/cron" \
  "/api/upDownsells/sync/cron" \
  "/api/sms/sync/cron" \
  "/api/payStripeTerminalInstallation/sync/cron" \
  "/api/phorestPayRevenue/sync/cron" \
  "/api/lookerLeads/sync/cron" \
  "/api/dachClientNumbers/sync/cron" \
  "/api/marketingCosts/sync/cron" \
  "/api/leads/sync/cron"; do
  call_endpoint "POST" "\${endpoint}" "true"
done

call_endpoint "POST" "/api/signups/sync" "false"
call_endpoint "POST" "/api/churnDrive/sync" "false"

log "Hinweis: Leads benoetigt fuer echte Daten /api/leads/sync/ingest (Apps Script Payload)."
log "Hinweis: Salespipe2 benoetigt fuer echte Daten weiter /api/salespipe2/sync/ingest mit Payload."
log "Hinweis: Paymargin CSV Import bleibt dateibasiert (/api/paymargin/import)."
log "Importzyklus beendet."
EOF

chmod +x "${RUNNER_PATH}"

cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${RUNNER_PATH}</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${HOME}</string>

  <key>RunAtLoad</key>
  <false/>

  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${SCHEDULE_HOUR}</integer>
    <key>Minute</key>
    <integer>${SCHEDULE_MINUTE}</integer>
  </dict>

  <key>StandardOutPath</key>
  <string>${LOG_PATH}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_PATH}</string>
</dict>
</plist>
EOF

launchctl unload "${PLIST_PATH}" >/dev/null 2>&1 || true
launchctl load "${PLIST_PATH}"
launchctl kickstart -k "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true

echo "Installiert: ${LABEL}"
echo "Plist: ${PLIST_PATH}"
echo "Runner: ${RUNNER_PATH}"
echo "Log: ${LOG_PATH}"
echo "Zeitplan: taeglich um $(printf "%02d:%02d" "${SCHEDULE_HOUR}" "${SCHEDULE_MINUTE}")"
