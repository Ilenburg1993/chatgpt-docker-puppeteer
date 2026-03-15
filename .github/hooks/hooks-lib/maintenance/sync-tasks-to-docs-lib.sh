#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail

SCRIPT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_ROOT_DIR="$(cd "${SCRIPT_LIB_DIR}/../.." && pwd)"
HOOK_SCRIPT_PATH="${HOOKS_ROOT_DIR}/scripts/sync-tasks-to-docs.sh"

run_sync_tasks_to_docs_script() {
    bash "${HOOK_SCRIPT_PATH}" "$@"
}
