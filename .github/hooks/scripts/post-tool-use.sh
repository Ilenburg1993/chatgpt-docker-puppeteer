#!/bin/bash
# post-tool-use.sh — Hook postToolUse do Copilot
# Executado APÓS cada uso de ferramenta (sucesso ou falha).
# Input JSON (stdin): {timestamp, hook_event_name, session_id, transcript_path,
#                      tool_name, tool_input, tool_response, tool_use_id, cwd}
# Schema verificado empiricamente em 2026-03-09 (vide raw-post-input.jsonl).
# Output: ignorado pelo Copilot.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"

mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"

INPUT="$(cat 2> /dev/null || true)"

# Extrai campos usando o schema real (snake_case)
TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
TOOL_NAME="$(echo "$INPUT" | jq -r '.tool_name // ""' 2> /dev/null || echo '')"
TOOL_USE_ID="$(echo "$INPUT" | jq -r '.tool_use_id // ""' 2> /dev/null || echo '')"
TOOL_RESPONSE="$(echo "$INPUT" | jq -r '.tool_response // ""' 2> /dev/null || echo '')"

# session_id vem diretamente do payload (UUID real do Copilot)
SESSION_ID="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"

# Determina result_type: sem campo explícito, usa presença de tool_response
# Se tool_response não vazio = success; se vazia = indeterminate
if [ -n "$TOOL_RESPONSE" ]; then
    RESULT_TYPE="success"
else
    RESULT_TYPE="unknown"
fi

CTX_FILE="$STATE_DIR/session-context.json"

# Fallback: se session_id não veio do payload, usa o do contexto
if [ -z "$SESSION_ID" ] && [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
fi

# Append em audit.jsonl (sem logar tool_response completo — pode ser grande)
jq -cn \
    --arg event "postToolUse" \
    --arg sid "$SESSION_ID" \
    --arg ts "$TIMESTAMP" \
    --arg tool "$TOOL_NAME" \
    --arg tool_use_id "$TOOL_USE_ID" \
    --arg result "$RESULT_TYPE" \
    '{
        event:        $event,
        session_id:   $sid,
        timestamp:    $ts,
        tool_name:    $tool,
        tool_use_id:  $tool_use_id,
        result_type:  $result
    }' >> "$LOG_DIR/audit.jsonl"

# Em caso de falha aparente (tool_response vazia = possível erro): registra detalhes
# Nota: sem campo result_type explícito, usamos heurística; ajuste se necessário
if [ "$RESULT_TYPE" = "unknown" ]; then
    # Não é forçosamente um erro — apenas desconhecido; não grava em errors.jsonl
    # para evitar falsos positivos. Se no futuro o schema incluir indicador de
    # falha, adicionar condição aqui.
    if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
        jq '.failure_count_unknown = (.failure_count_unknown // 0) + 1' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    fi
fi

# ── Métricas de tempo por ferramenta ────────────────────────────────────────
# Calcula duração entre preToolUse (last_tool_ts) e este postToolUse.
# Ambos os timestamps são ISO strings — converte para epoch ms com date -d.
if [ -f "$CTX_FILE" ]; then
    LAST_TOOL_TS="$(jq -r '.last_tool_ts // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    if [ -n "$LAST_TOOL_TS" ] && [ -n "$TIMESTAMP" ]; then
        # Converte ISO 8601 para epoch em milliseconds
        TS_MS="$(date -d "$TIMESTAMP" '+%s%3N' 2> /dev/null || echo '')"
        LAST_MS="$(date -d "$LAST_TOOL_TS" '+%s%3N' 2> /dev/null || echo '')"
        if [ -n "$TS_MS" ] && [ -n "$LAST_MS" ] && [ "$TS_MS" -gt 0 ] && [ "$LAST_MS" -gt 0 ]; then
            DURATION_MS=$((TS_MS - LAST_MS))
            # Sanity: ignora durações negativas ou absurdas (>10min = gap entre sessões)
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
                        tool_name:   $tool,
                        duration_ms: $dur,
                        result_type: $result
                    }' >> "$LOG_DIR/tool-metrics.jsonl"
            fi
        fi
    fi
fi

# Registra ferramentas de quality gate (lint, typecheck, test) no contexto
# tool_input é objeto JSON; extrai .command para identificar gates de qualidade
if [ "$TOOL_NAME" = "run_in_terminal" ] || [ "$TOOL_NAME" = "bash" ]; then
    COMMAND="$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2> /dev/null || echo '')"

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
