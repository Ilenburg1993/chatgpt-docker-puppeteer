#!/usr/bin/env bash
# user-prompt-submit.sh — Wrapper para o UserPromptSubmit hook
# Thin wrapper: toda lógica está em lib/user-prompt-submit-lib.sh
set -euo pipefail
INPUT=$(cat)
source "$(cd "$(dirname "$0")/../lib" && pwd)/user-prompt-submit-lib.sh"
main "$INPUT"
