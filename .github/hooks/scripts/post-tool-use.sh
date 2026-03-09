#!/bin/bash
# post-tool-use.sh — Hook postToolUse do Copilot
# Executado APÓS cada uso de ferramenta (sucesso ou falha).
# Input JSON (stdin): {timestamp, cwd, toolName, toolArgs, toolResult:{resultType, textResultForLlm}}
# Output: ignorado pelo Copilot.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"

mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"

INPUT="$(cat 2> /dev/null || true)"

TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // 0' 2> /dev/null || echo 0)"
TOOL_NAME="$(echo "$INPUT" | jq -r '.toolName // ""' 2> /dev/null || echo '')"
RESULT_TYPE="$(echo "$INPUT" | jq -r '.toolResult.resultType // "unknown"' 2> /dev/null || echo 'unknown')"

# Obtém session_id do contexto persistido
SESSION_ID=""
CTX_FILE="$STATE_DIR/session-context.json"
if [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
fi

# Append em audit.jsonl (sem logar textResultForLlm — pode ser grande e sensível)
jq -cn \
    --arg event "postToolUse" \
    --arg sid "$SESSION_ID" \
    --arg ts "$TIMESTAMP" \
    --arg tool "$TOOL_NAME" \
    --arg result "$RESULT_TYPE" \
    '{
        event:       $event,
        session_id:  $sid,
        timestamp:   $ts,
        toolName:    $tool,
        resultType:  $result
    }' >> "$LOG_DIR/audit.jsonl"

# Em caso de falha: registra em errors.jsonl e incrementa contador no contexto
if [ "$RESULT_TYPE" = "failure" ]; then
    RESULT_TEXT="$(echo "$INPUT" | jq -r '.toolResult.textResultForLlm // ""' 2> /dev/null | head -c 500 || echo '')"

    jq -cn \
        --arg event "toolFailure" \
        --arg sid "$SESSION_ID" \
        --arg ts "$TIMESTAMP" \
        --arg tool "$TOOL_NAME" \
        --arg text "$RESULT_TEXT" \
        '{
            event:      $event,
            session_id: $sid,
            timestamp:  $ts,
            toolName:   $tool,
            resultText: $text
        }' >> "$LOG_DIR/errors.jsonl"

    # Incrementa failure_count no contexto da sessão
    if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
        jq '.failure_count = (.failure_count // 0) + 1' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    fi
fi

# ── Métricas de tempo por ferramenta ────────────────────────────────────────
# Calcula duração entre preToolUse (last_tool_ts) e este postToolUse.
# Grava em tool-metrics.jsonl para análise histórica de performance.
if [ -f "$CTX_FILE" ]; then
    LAST_TOOL_TS="$(jq -r '.last_tool_ts // "0"' "$CTX_FILE" 2> /dev/null || echo '0')"
    if [ "$LAST_TOOL_TS" != "0" ] && [ "$TIMESTAMP" != "0" ]; then
        DURATION_MS=$((TIMESTAMP - LAST_TOOL_TS))
        # Sanity: ignora durações negativas ou absurdas (>10min provavelmente é gap entre sessões)
        if [ "$DURATION_MS" -gt 0 ] && [ "$DURATION_MS" -lt 600000 ]; then
            jq -cn \
                --arg sid "$SESSION_ID" \
                --arg ts "$TIMESTAMP" \
                --arg tool "$TOOL_NAME" \
                --argjson dur "$DURATION_MS" \
                --arg result "$RESULT_TYPE" \
                '{
                    session_id:  $sid,
                    timestamp:   $ts,
                    toolName:    $tool,
                    duration_ms: $dur,
                    resultType:  $result
                }' >> "$LOG_DIR/tool-metrics.jsonl"
        fi
    fi
fi

# Registra ferramentas de quality gate (lint, typecheck, test) no contexto
if [ "$TOOL_NAME" = "bash" ]; then
    TOOL_ARGS_RAW="$(echo "$INPUT" | jq -r '.toolArgs // ""' 2> /dev/null || echo '')"
    COMMAND="$(echo "$TOOL_ARGS_RAW" | jq -r '.command // ""' 2> /dev/null || echo '')"

    for GATE_PATTERN in "npm run lint" "npm run typecheck" "npm run test" "npm run format"; do
        if echo "$COMMAND" | grep -qF "$GATE_PATTERN"; then
            if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
                GATE_KEY="$(echo "$GATE_PATTERN" | sed 's/npm run //' | sed 's/:/_/g')"
                jq --arg key "gate_${GATE_KEY}" --arg ts "$TIMESTAMP" --arg result "$RESULT_TYPE" \
                    '.quality_gates[$key] = {timestamp: $ts, result: $result}' \
                    "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
            fi
            break
        fi
    done
fi

exit 0
