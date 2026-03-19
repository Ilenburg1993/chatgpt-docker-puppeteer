#!/usr/bin/env bash
# pre-tool-use.sh — Wrapper para o PreToolUse hook
# Thin wrapper: toda lógica está em lib/pre-tool-use-lib.sh
set -euo pipefail
INPUT=$(cat)
source "$(cd "$(dirname "$0")/../lib" && pwd)/pre-tool-use-lib.sh"
main "$INPUT"
