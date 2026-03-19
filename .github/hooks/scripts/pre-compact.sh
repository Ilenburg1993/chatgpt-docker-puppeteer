#!/usr/bin/env bash
# pre-compact.sh — Wrapper para o PreCompact hook
# Thin wrapper: toda lógica está em lib/pre-compact-lib.sh
set -euo pipefail
INPUT=$(cat)
source "$(cd "$(dirname "$0")/../lib" && pwd)/pre-compact-lib.sh"
main "$INPUT"
