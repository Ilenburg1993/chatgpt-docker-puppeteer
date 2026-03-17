#!/bin/bash
# smoke-core.sh — checks estruturais do domínio core dos hooks.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh" "${1:-}"

section "[core] Dependências"
for cmd in jq sponge date sha256sum wc; do
    require_cmd "$cmd"
done

section "[core] Scripts críticos"
for s in session-start.sh log-prompt.sh pre-tool-use.sh post-tool-use.sh agent-stop.sh session-end.sh; do
    require_file "$SCRIPTS_DIR/$s" "$s"
    require_executable "$SCRIPTS_DIR/$s" "$s"
done

section "[core] Contexto mínimo"
if [ ! -f "$CTX_FILE" ]; then
    fail "session-context.json não encontrado"
else
    require_grep '"session"' "$CTX_FILE" "session-context contém bloco session" "session-context sem bloco session"
    require_grep '"current_turn"' "$CTX_FILE" "session-context contém bloco current_turn" "session-context sem bloco current_turn"
    require_grep '"current_section"' "$CTX_FILE" "session-context contém bloco current_section" "session-context sem bloco current_section"
fi

section "[core] Protocolo"
HOOKS_INSTR="$HOOK_DIR/../../.github/instructions/hooks-protocol.instructions.md"
require_file "$HOOKS_INSTR" "hooks-protocol.instructions.md"
require_grep 'applyTo.*\*\*/\*' "$HOOKS_INSTR" "hooks-protocol com applyTo global" "hooks-protocol sem applyTo global"

summary_and_exit
