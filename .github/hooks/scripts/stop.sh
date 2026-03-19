#!/usr/bin/env bash
# stop.sh — Wrapper para o Stop hook (fim de cada TURN)
# Invocado pelo VS Code ao final de cada turno do agente.
# Toda a lógica está em lib/stop-lib.sh.
set -euo pipefail
HOOK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib/common.sh
source "$HOOK_DIR/lib/common.sh"
# shellcheck source=../lib/stop-lib.sh
source "$HOOK_DIR/lib/stop-lib.sh"
INPUT="$(cat)"
main "$INPUT"
