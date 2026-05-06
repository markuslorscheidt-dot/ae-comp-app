#!/usr/bin/env bash
set -euo pipefail

LABEL="com.aecomp.local-imports.15min"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
RUNNER_PATH="${HOME}/Library/Application Support/ae-comp-app/local-imports-runner.sh"

if [[ -f "${PLIST_PATH}" ]]; then
  echo "Plist vorhanden: ${PLIST_PATH}"
else
  echo "Plist fehlt: ${PLIST_PATH}"
fi

if [[ -f "${RUNNER_PATH}" ]]; then
  echo "Runner vorhanden: ${RUNNER_PATH}"
else
  echo "Runner fehlt: ${RUNNER_PATH}"
fi

if launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
  echo "Status: aktiv"
else
  echo "Status: nicht aktiv"
fi
