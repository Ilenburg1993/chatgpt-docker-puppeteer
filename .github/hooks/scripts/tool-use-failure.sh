#!/bin/bash
# tool-use-failure.sh — Hook postToolUseFailure do Copilot
# Executado quando uma ferramenta falha durante execução.
# Substitui o inerte errorOccurred (que nunca disparava no SDK).
# Input JSON (stdin): {timestamp, session_id, tool_name, tool_use_id, error, ...}
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
CTX_FILE="$STATE_DIR/session-context.json"

mkdir -p "$LOG_DIR"
# Carrega biblioteca de funções compartilhadas (heal_v1, increment_mismatch, etc.)
if [ -f "$HOOK_DIR/hooks-lib/common.sh" ]; then
    # shellcheck source=../.github/hooks/hooks-lib/common.sh
    source "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null \
        || echo "[warn] common.sh falhou ao carregar em tool-use-failure.sh" >&2
else
    echo "[warn] common.sh não encontrado (tool-use-failure.sh) — heal_v1/increment_mismatch indisponíveis" >&2
fi
INPUT="$(cat 2> /dev/null || true)"

TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
SESSION_ID="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"
TOOL_NAME="$(echo "$INPUT" | jq -r '.tool_name // ""' 2> /dev/null || echo '')"
TOOL_USE_ID="$(echo "$INPUT" | jq -r '.tool_use_id // ""' 2> /dev/null || echo '')"
ERROR_MSG="$(echo "$INPUT" | jq -r '.error // .message // ""' 2> /dev/null || echo '')"
# UPG-AUDIT-01: resolve per-session paths
if command -v resolve_audit_file > /dev/null 2>&1 && [ -n "${SESSION_ID:-}" ]; then
    _SID_SHORT="${SESSION_ID:0:8}"
    CTX_FILE="$(resolve_ctx_file "$_SID_SHORT")"
    AUDIT_FILE="$(resolve_audit_file "$_SID_SHORT")"
    mkdir -p "$(dirname "$CTX_FILE")" "$(dirname "$AUDIT_FILE")" 2> /dev/null || true
fi

# ── Guard: session_id (executa ANTES de qualquer write de estado) ─────────────
# BUG-S01: guard movido para antes dos writes para evitar contaminar audit.jsonl
# com session_id incorreto em caso de mismatch.
if [ -f "$CTX_FILE" ] && [ ! -s "$CTX_FILE" ]; then
    echo "[guard] session-context.json vazio — guard desabilitado (aguardando auto-recovery)" >&2
fi
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] && [ -n "$SESSION_ID" ]; then
    CTX_ACTIVE_SID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    if [ -n "$CTX_ACTIVE_SID" ] && [ "$SESSION_ID" != "$CTX_ACTIVE_SID" ]; then
        # HEAL v1: se source é manual_recovery ou inline_restart, sincroniza sem bloquear
        CTX_SOURCE="$(jq -r '.session.source // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        if [ "$CTX_SOURCE" = "manual_recovery" ]; then
            # BUG-22 fix: manual_recovery sincroniza SID e continua (não sai)
            if command -v heal_v1 > /dev/null 2>&1; then
                if heal_v1 "$SESSION_ID" "$TIMESTAMP"; then
                    echo "[heal] HEAL v1 aplicado em tool-use-failure.sh" >&2
                fi
            fi
            SESSION_ID="$CTX_ACTIVE_SID"
        elif [ "$CTX_SOURCE" = "inline_restart" ]; then
            # BUG-22 fix: inline_restart adota SID do contexto e continua (não sai)
            SESSION_ID="$CTX_ACTIVE_SID"
            echo "[guard] inline_restart: adotando SID do contexto em tool-use-failure.sh" >&2
        else
            # Log mismatch: inclui info da ferramenta que falhou, sem session_id de payload
            jq -cn \
                --arg event "session_id_mismatch_failure" \
                --arg expected "$CTX_ACTIVE_SID" \
                --arg got "$SESSION_ID" \
                --arg tool "$TOOL_NAME" \
                --arg error "$ERROR_MSG" \
                '{
                    event:     $event,
                    expected:  $expected,
                    got:       $got,
                    tool_name: $tool,
                    error:     $error,
                    source:    "tool-use-failure.sh",
                    message:   "Payload session_id diferente do contexto ativo — state write bloqueado"
                }' >> "$AUDIT_FILE"
            # GAP-03: incrementa contador de mismatches
            if command -v increment_mismatch > /dev/null 2>&1; then
                increment_mismatch
            fi
            exit 0
        fi
    fi
fi

# Loga evento de falha no audit.jsonl (após validação do guard)
jq -cn \
    --arg event "toolUseFailure" \
    --arg sid "$SESSION_ID" \
    --arg ts "$TIMESTAMP" \
    --arg tool "$TOOL_NAME" \
    --arg tool_use_id "$TOOL_USE_ID" \
    --arg error "$ERROR_MSG" \
    '{
        event:       $event,
        session_id:  $sid,
        timestamp:   $ts,
        tool_name:   $tool,
        tool_use_id: $tool_use_id,
        error:       $error
    }' >> "$AUDIT_FILE"

# Loga em errors.jsonl para rastreio separado
jq -cn \
    --arg ts "$TIMESTAMP" \
    --arg tool "$TOOL_NAME" \
    --arg error "$ERROR_MSG" \
    '{ timestamp: $ts, tool: $tool, error: $error }' >> "$LOG_DIR/errors.jsonl"

# Atualiza contadores no session-context.json
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] && command -v sponge &> /dev/null; then
    jq \
        '.current_turn.failures_count = ((.current_turn.failures_count // 0) + 1)
         | .session_stats.failures_detected = ((.session_stats.failures_detected // 0) + 1)
         | .session_stats.errors_total = ((.session_stats.errors_total // 0) + 1)' \
        "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
fi

echo "[tool-failure] Ferramenta '$TOOL_NAME' falhou: $ERROR_MSG" >&2
exit 0
