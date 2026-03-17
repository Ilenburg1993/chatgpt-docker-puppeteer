#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail

# Canonical domain entrypoint (F7.7): delegate to legacy root implementation.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_LIB_BYPASS_SESSION_START_AUX_SHIM=1 source "${SCRIPT_DIR}/../session-start-aux.sh"
