#!/usr/bin/env bash
# post-tool-use.sh — Wrapper para o PostToolUse hook
# Invocado pelo VS Code após cada ferramenta completar com sucesso.
# Toda a lógica está em lib/post-tool-use-lib.sh.
set -euo pipefail
HOOK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib/common.sh
source "$HOOK_DIR/lib/common.sh"
# shellcheck source=../lib/post-tool-use-lib.sh
source "$HOOK_DIR/lib/post-tool-use-lib.sh"
INPUT="$(cat)"
main "$INPUT"
