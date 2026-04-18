#!/usr/bin/env bash
# Local runner — polls GitHub issues on a fixed interval.
# Usage:
#   ./chief-of-staff/run-local.sh                # default 1800s (30 min)
#   INTERVAL=600 ./chief-of-staff/run-local.sh   # custom interval
#   nohup ./chief-of-staff/run-local.sh > chief-of-staff.log 2>&1 &
#
# Requires: bun, gh (authenticated), repo checked out.

set -uo pipefail

INTERVAL="${INTERVAL:-1800}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

log "Starting local runner (interval=${INTERVAL}s, repo=${REPO_ROOT})"

while true; do
  log "Running orchestrator..."
  if bun chief-of-staff/orchestrator.ts; then
    log "Orchestrator run complete."
  else
    log "Orchestrator exited non-zero — continuing loop."
  fi
  log "Sleeping ${INTERVAL}s..."
  sleep "$INTERVAL"
done
