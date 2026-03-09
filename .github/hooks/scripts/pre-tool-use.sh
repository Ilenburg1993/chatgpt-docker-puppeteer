#!/bin/bash
# pre-tool-use.sh — Hook preToolUse do Copilot
# Executado ANTES de cada uso de ferramenta pelo agente.
# Input JSON (stdin): {timestamp, cwd, toolName, toolArgs}
# Output: NÃO emite {"permissionDecision":"deny"} — logging-only por decisão de projeto.
#
# SEGURANÇA: credentials são redactados antes de qualquer log.
# O agente tem autonomia total — este hook nunca bloqueia.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"

mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"

INPUT="$(cat 2>/dev/null || true)"

TIMESTAMP="$(echo "$INPUT"  | jq -r '.timestamp // 0'       2>/dev/null || echo 0)"
CWD="$(echo "$INPUT"        | jq -r '.cwd // ""'             2>/dev/null || echo '')"
TOOL_NAME="$(echo "$INPUT"  | jq -r '.toolName // ""'        2>/dev/null || echo '')"
TOOL_ARGS_RAW="$(echo "$INPUT" | jq -r '.toolArgs // ""'     2>/dev/null || echo '')"

# Obtém session_id do contexto persistido
SESSION_ID=""
CTX_FILE="$STATE_DIR/session-context.json"
if [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session_id // ""' "$CTX_FILE" 2>/dev/null || echo '')"
fi

# Redacta credentials e tokens antes de qualquer log
# Padrões: GitHub tokens, Bearer tokens, senhas em flags CLI
REDACTED_ARGS="$(echo "$TOOL_ARGS_RAW" | \
    sed -E 's/ghp_[A-Za-z0-9]{20,}/[REDACTED_GHP]/g'    | \
    sed -E 's/gho_[A-Za-z0-9]{20,}/[REDACTED_GHO]/g'    | \
    sed -E 's/ghu_[A-Za-z0-9]{20,}/[REDACTED_GHU]/g'    | \
    sed -E 's/ghs_[A-Za-z0-9]{20,}/[REDACTED_GHS]/g'    | \
    sed -E 's/ghr_[A-Za-z0-9]{20,}/[REDACTED_GHR]/g'    | \
    sed -E 's/Bearer [A-Za-z0-9_\-\.]+/Bearer [REDACTED]/g' | \
    sed -E 's/--password[=[:space:]][^[:space:]]+/--password=[REDACTED]/g' | \
    sed -E 's/--token[=[:space:]][^[:space:]]+/--token=[REDACTED]/g'       | \
    sed -E 's/-p [A-Za-z0-9!@#$%^&*]{6,}/-p [REDACTED]/g')"

# Append em audit.jsonl com toolArgs redactados
jq -cn \
    --arg event "preToolUse" \
    --arg sid "$SESSION_ID" \
    --arg ts "$TIMESTAMP" \
    --arg cwd "$CWD" \
    --arg tool "$TOOL_NAME" \
    --arg args "$REDACTED_ARGS" \
    '{
        event:      $event,
        session_id: $sid,
        timestamp:  $ts,
        cwd:        $cwd,
        toolName:   $tool,
        toolArgs:   $args
    }' >> "$LOG_DIR/audit.jsonl"

# Atualiza último tool no session-context.json (sem bloquear em falha)
if [ -f "$CTX_FILE" ] && command -v sponge &>/dev/null; then
    jq --arg ts "$TIMESTAMP" --arg tool "$TOOL_NAME" \
        '.last_tool_ts = $ts | .last_tool = $tool' \
        "$CTX_FILE" | sponge "$CTX_FILE" 2>/dev/null || true
fi

# NÃO emite JSON de decision — autonomia total do agente.
# Exit 0 garante que o agente nunca é bloqueado por este hook.
exit 0
