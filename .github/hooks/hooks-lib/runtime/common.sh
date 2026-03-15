#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail

# Canonical domain entrypoint (F7.7): delegate to legacy root implementation.
# Planned final state: move implementation from hooks-lib/common.sh into this file.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_LIB_BYPASS_COMMON_SHIM=1 source "${SCRIPT_DIR}/../common.sh"
