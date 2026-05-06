#!/usr/bin/env bash
set -euo pipefail

LABEL="com.aecomp.local-imports.15min"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
RUNNER_PATH="${HOME}/Library/Application Support/ae-comp-app/local-imports-runner.sh"

if [[ -f "${PLIST_PATH}" ]]; then
  launchctl unload "${PLIST_PATH}" >/dev/null 2>&1 || true
  rm -f "${PLIST_PATH}"
  echo "Entfernt: ${PLIST_PATH}"
else
  echo "Kein LaunchAgent gefunden: ${PLIST_PATH}"
fi

if [[ -f "${RUNNER_PATH}" ]]; then
  rm -f "${RUNNER_PATH}"
  echo "Entfernt: ${RUNNER_PATH}"
fi

echo "Scheduler deaktiviert: ${LABEL}"
