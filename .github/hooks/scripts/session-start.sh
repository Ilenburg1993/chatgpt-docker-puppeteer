#!/usr/bin/env bash
# session-start.sh — Wrapper para o SessionStart hook
# Thin wrapper: toda lógica está em lib/session-start-lib.sh
set -euo pipefail
INPUT=$(cat)
source "$(cd "$(dirname "$0")/../lib" && pwd)/session-start-lib.sh"
main "$INPUT"
