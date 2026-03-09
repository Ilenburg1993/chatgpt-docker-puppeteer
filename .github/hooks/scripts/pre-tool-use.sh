#!/bin/bash
# pre-tool-use.sh — Hook preToolUse do Copilot
# Executado ANTES de cada uso de ferramenta pelo agente.
# Input JSON (stdin): {timestamp, hook_event_name, session_id, transcript_path,
#                      tool_name, tool_input, tool_use_id, cwd}
# Schema verificado empiricamente em 2026-03-09 (vide raw-input.jsonl diagnóstico).
# Output: NÃO emite {"permissionDecision":"deny"} — logging-only por decisão de projeto.
#
# SEGURANÇA: credentials são redactados antes de qualquer log.
# O agente tem autonomia total — este hook nunca bloqueia.
#
# Schema v2: atualiza current_turn.*, session_stats.* e last_tool.* separadamente.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
CTX_FILE="$STATE_DIR/session-context.json"

mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"

INPUT="$(cat 2> /dev/null || true)"

# Extrai campos usando o schema real (snake_case, não camelCase)
TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2>/dev/null || echo '')"
CWD="$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null || echo '')"
TOOL_NAME="$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null || echo '')"
TOOL_USE_ID="$(echo "$INPUT" | jq -r '.tool_use_id // ""' 2>/dev/null || echo '')"

# session_id vem diretamente do payload (UUID real do Copilot)
SESSION_ID="$(echo "$INPUT" | jq -r '.session_id // ""' 2>/dev/null || echo '')"

# Serializa tool_input (objeto JSON) para string redactável
TOOL_INPUT_RAW="$(echo "$INPUT" | jq -c '.tool_input // {}' 2>/dev/null || echo '{}')"

# Redacta credentials e tokens antes de qualquer log
# Padrões: GitHub tokens, Bearer tokens, senhas em flags CLI
REDACTED_ARGS="$(echo "$TOOL_INPUT_RAW" \
    | sed -E 's/ghp_[A-Za-z0-9]{20,}/[REDACTED_GHP]/g' \
    | sed -E 's/gho_[A-Za-z0-9]{20,}/[REDACTED_GHO]/g' \
    | sed -E 's/ghu_[A-Za-z0-9]{20,}/[REDACTED_GHU]/g' \
    | sed -E 's/ghs_[A-Za-z0-9]{20,}/[REDACTED_GHS]/g' \
    | sed -E 's/ghr_[A-Za-z0-9]{20,}/[REDACTED_GHR]/g' \
    | sed -E 's/Bearer [A-Za-z0-9_\-\.]+/Bearer [REDACTED]/g' \
    | sed -E 's/--password[=[:space:]][^[:space:]]+/--password=[REDACTED]/g' \
    | sed -E 's/--token[=[:space:]][^[:space:]]+/--token=[REDACTED]/g' \
    | sed -E 's/-p [A-Za-z0-9!@#$%^&*]{6,}/-p [REDACTED]/g')"

# Append em audit.jsonl com toolArgs redactados
jq -cn \
    --arg event "preToolUse" \
    --arg sid "$SESSION_ID" \
    --arg ts "$TIMESTAMP" \
    --arg cwd "$CWD" \
    --arg tool "$TOOL_NAME" \
    --arg tool_use_id "$TOOL_USE_ID" \
    --arg args "$REDACTED_ARGS" \
    '{
        event:       $event,
        session_id:  $sid,
        timestamp:   $ts,
        cwd:         $cwd,
        tool_name:   $tool,
        tool_use_id: $tool_use_id,
        tool_args:   $args
    }' >> "$LOG_DIR/audit.jsonl"

# ── Atualiza contexto — Schema v2 ────────────────────────────────────────────
# Atualiza 3 blocos separados:
#   last_tool.*       → sobrescrito a cada chamada (âmbito: chamada)
#   current_turn.*    → acumula até agentStop (âmbito: turno)
#   session_stats.*   → acumula até sessionEnd (âmbito: sessão)
# Quando vscode_askQuestions: seta current_turn.auth_requested = true
if [ -f "$CTX_FILE" ] && command -v sponge &>/dev/null; then
    if [ "$TOOL_NAME" = "vscode_askQuestions" ]; then
        jq --arg sid "$SESSION_ID" --arg ts "$TIMESTAMP" \
           --arg tool "$TOOL_NAME" --arg id "$TOOL_USE_ID" \
            '.session.id = (if $sid != "" then $sid else .session.id end)
             | .last_tool.name   = $tool
             | .last_tool.ts     = $ts
             | .last_tool.use_id = $id
             | .last_tool.result = null
             | .current_turn.auth_requested    = true
             | .current_turn.auth_requested_at = $ts
             | .current_turn.tools_count   = ((.current_turn.tools_count // 0) + 1)
             | .current_turn.tools_by_name = ((.current_turn.tools_by_name // {}) | .[$tool] = ((. // {})[$tool] // 0) + 1)
             | .session_stats.tools_total   = ((.session_stats.tools_total // 0) + 1)
             | .session_stats.tools_by_name = ((.session_stats.tools_by_name // {}) | .[$tool] = ((. // {})[$tool] // 0) + 1)' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2>/dev/null || true
    else
        jq --arg sid "$SESSION_ID" --arg ts "$TIMESTAMP" \
           --arg tool "$TOOL_NAME" --arg id "$TOOL_USE_ID" \
            '.session.id = (if $sid != "" then $sid else .session.id end)
             | .last_tool.name   = $tool
             | .last_tool.ts     = $ts
             | .last_tool.use_id = $id
             | .last_tool.result = null
             | .current_turn.tools_count   = ((.current_turn.tools_count // 0) + 1)
             | .current_turn.tools_by_name = ((.current_turn.tools_by_name // {}) | .[$tool] = ((. // {})[$tool] // 0) + 1)
             | .session_stats.tools_total   = ((.session_stats.tools_total // 0) + 1)
             | .session_stats.tools_by_name = ((.session_stats.tools_by_name // {}) | .[$tool] = ((. // {})[$tool] // 0) + 1)' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2>/dev/null || true
    fi
fi

# NÃO emite JSON de decision — autonomia total do agente.
# Exit 0 garante que o agente nunca é bloqueado por este hook.
exit 0
