#!/bin/bash
# post-tool-use.sh — Hook postToolUse do Copilot
# Executado APÓS cada uso de ferramenta (sucesso ou falha).
# Input JSON (stdin): {timestamp, hook_event_name, session_id, transcript_path,
#                      tool_name, tool_input, tool_response, tool_use_id, cwd}
# Schema verificado empiricamente em 2026-03-09 (vide raw-post-input.jsonl).
# Output: ignorado pelo Copilot.
#
# Schema v2: atualiza last_tool.result e current_turn.failures_count.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
CTX_FILE="$STATE_DIR/session-context.json"

mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"

INPUT="$(cat 2> /dev/null || true)"

# Extrai campos usando o schema real (snake_case)
TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2>/dev/null || echo '')"
TOOL_NAME="$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null || echo '')"
TOOL_USE_ID="$(echo "$INPUT" | jq -r '.tool_use_id // ""' 2>/dev/null || echo '')"
TOOL_RESPONSE="$(echo "$INPUT" | jq -r '.tool_response // ""' 2>/dev/null || echo '')"

# session_id vem diretamente do payload (UUID real do Copilot)
SESSION_ID="$(echo "$INPUT" | jq -r '.session_id // ""' 2>/dev/null || echo '')"

# Fallback: se session_id não veio do payload, usa o do contexto
if [ -z "$SESSION_ID" ] && [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session.id // ""' "$CTX_FILE" 2>/dev/null || echo '')"
fi

# ── Determina result_type (heurística progressiva) ───────────────────────────
# 1. Resposta vazia → "unknown" (muitos sucessos não têm body)
# 2. Padrões explícitos de falha → "failure"
# 3. Resposta não-vazia sem padrão de falha → "success"
if [ -z "$TOOL_RESPONSE" ]; then
    RESULT_TYPE="unknown"
elif echo "$TOOL_RESPONSE" | grep -qiE \
    "String replacement failed|No such file or directory|Permission denied|command not found|ENOENT|EACCES|fatal:|Error:.*failed|cannot|not found|failed to"; then
    RESULT_TYPE="failure"
else
    RESULT_TYPE="success"
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

# ── Atualiza contexto — Schema v3 ────────────────────────────────────────────
# last_tool.result: resultado desta chamada específica
# current_turn.failures_count: acumula falhas do turno atual
# session_stats.failures_detected: acumula falhas da sessão
# current_turn.last_askquestions_response: captura todas as respostas de vscode_askQuestions
if [ -f "$CTX_FILE" ] && command -v sponge &>/dev/null; then
    if [ "$TOOL_NAME" = "vscode_askQuestions" ] && [ -n "$TOOL_RESPONSE" ]; then
        # Captura resposta completa do usuário ao vscode_askQuestions
        # tool_response para askQuestions é JSON: {answers:{...}} — normaliza para string
        RESPONSE_STR="$(echo "$TOOL_RESPONSE" | jq -c '.' 2>/dev/null || echo "$TOOL_RESPONSE")"

        # Lê close_key atual do contexto para verificar se a resposta contém a chave de encerramento
        CURRENT_CLOSE_KEY="$(jq -r '.session.close_key // ""' "$CTX_FILE" 2>/dev/null || echo '')"
        KEY_FOUND=false
        if [ -n "$CURRENT_CLOSE_KEY" ] && echo "$TOOL_RESPONSE" | grep -qF "$CURRENT_CLOSE_KEY"; then
            KEY_FOUND=true
        fi

        # Log da resposta no audit.jsonl (sem dados sensíveis excessivos — truncada a 500 chars)
        RESPONSE_TRUNCATED="$(echo "$RESPONSE_STR" | head -c 500)"
        jq -cn \
            --arg sid "$SESSION_ID" \
            --arg ts "$TIMESTAMP" \
            --arg tool_use_id "$TOOL_USE_ID" \
            --arg response "$RESPONSE_TRUNCATED" \
            --argjson key_found "$KEY_FOUND" \
            '{
                event:        "askQuestions_response",
                session_id:   $sid,
                timestamp:    $ts,
                tool_use_id:  $tool_use_id,
                response:     $response,
                close_key_found: $key_found
            }' >> "$LOG_DIR/audit.jsonl"

        # Atualiza contexto com resposta e, se necessário, valida a close_key
        if [ "$KEY_FOUND" = "true" ]; then
            jq --arg result "$RESULT_TYPE" \
               --arg response "$RESPONSE_STR" \
                '.last_tool.result = $result
                 | .current_turn.last_askquestions_response = $response
                 | .session.close_key_validated = true' \
                "$CTX_FILE" | sponge "$CTX_FILE" 2>/dev/null || true

            # Log do evento de validação da chave
            jq -cn \
                --arg sid "$SESSION_ID" \
                --arg ts "$TIMESTAMP" \
                --arg key "$CURRENT_CLOSE_KEY" \
                '{
                    event:      "sessionClose_key_validated",
                    session_id: $sid,
                    timestamp:  $ts,
                    close_key:  $key
                }' >> "$LOG_DIR/audit.jsonl"
        else
            jq --arg result "$RESULT_TYPE" \
               --arg response "$RESPONSE_STR" \
                '.last_tool.result = $result
                 | .current_turn.last_askquestions_response = $response' \
                "$CTX_FILE" | sponge "$CTX_FILE" 2>/dev/null || true
        fi
    elif [ "$RESULT_TYPE" = "failure" ]; then
        jq --arg result "$RESULT_TYPE" --arg tool "$TOOL_NAME" \
            '.last_tool.result = $result
             | .current_turn.failures_count = ((.current_turn.failures_count // 0) + 1)
             | .session_stats.failures_detected = ((.session_stats.failures_detected // 0) + 1)' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2>/dev/null || true
    else
        jq --arg result "$RESULT_TYPE" \
            '.last_tool.result = $result' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2>/dev/null || true
    fi
fi

# ── Métricas de tempo por ferramenta ─────────────────────────────────────────
# Calcula duração entre preToolUse (last_tool.ts) e este postToolUse.
# Ambos os timestamps são ISO strings — converte para epoch ms com date -d.
if [ -f "$CTX_FILE" ]; then
    LAST_TOOL_TS="$(jq -r '.last_tool.ts // ""' "$CTX_FILE" 2>/dev/null || echo '')"
    if [ -n "$LAST_TOOL_TS" ] && [ -n "$TIMESTAMP" ]; then
        TS_MS="$(date -d "$TIMESTAMP" '+%s%3N' 2>/dev/null || echo '')"
        LAST_MS="$(date -d "$LAST_TOOL_TS" '+%s%3N' 2>/dev/null || echo '')"
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

# ── Quality gates: registra execuções de lint/typecheck/test/format ──────────
# tool_input é objeto JSON; extrai .command para identificar gates de qualidade
if [ "$TOOL_NAME" = "run_in_terminal" ] || [ "$TOOL_NAME" = "bash" ]; then
    COMMAND="$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || echo '')"

    for GATE_PATTERN in "npm run lint" "npm run typecheck" "npm run test" "npm run format"; do
        if echo "$COMMAND" | grep -qF "$GATE_PATTERN"; then
            if [ -f "$CTX_FILE" ] && command -v sponge &>/dev/null; then
                GATE_KEY="$(echo "$GATE_PATTERN" | sed 's/npm run //' | sed 's/:/_/g')"
                jq --arg key "gate_${GATE_KEY}" --arg ts "$TIMESTAMP" --arg result "$RESULT_TYPE" \
                    '.quality_gates[$key] = {timestamp: $ts, result: $result}' \
                    "$CTX_FILE" | sponge "$CTX_FILE" 2>/dev/null || true
            fi
            break
        fi
    done
fi

exit 0
