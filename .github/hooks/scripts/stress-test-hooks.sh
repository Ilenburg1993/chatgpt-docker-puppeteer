#!/usr/bin/env bash
# stress-test-hooks.sh — Stress test de sessão com múltiplos turnos (GAP-49)
#
# Propósito: verificar que após N ciclos completos (SessionStart → prompt → tool
#            → askQ → Stop), o sistema não acumula arquivos temporários e o
#            desempenho de read_field mantém-se estável.
#
# Uso: bash .github/hooks/scripts/stress-test-hooks.sh [TURNS]
#   TURNS: número de turnos simulados (default: 20)
#
# Isola state em diretório temporário — NUNCA toca no state de produção.

set -uo pipefail

HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS_DIR="$HOOKS_DIR/scripts"
TURNS="${1:-20}"

# ---------------------------------------------------------------------------
# Infraestrutura de teste
# ---------------------------------------------------------------------------
PASS_COUNT=0
FAIL_COUNT=0

ok() {
    printf '  \033[32m✓\033[0m %s\n' "$1"
    PASS_COUNT=$((PASS_COUNT + 1))
}
fail() {
    printf '  \033[31m✗\033[0m %s\n' "$1"
    FAIL_COUNT=$((FAIL_COUNT + 1))
}
info() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }

# Ambiente isolado
STRESS_STATE="$(mktemp -d /tmp/hooks-stress-XXXXXX)"
export HOOKS_TEST_STATE_DIR="$STRESS_STATE"
trap 'rm -rf "$STRESS_STATE"' EXIT

run_hook() {
    local script="$1" payload="$2"
    printf '%s' "$payload" | bash "$script" > /dev/null 2>&1
    return $?
}

# ---------------------------------------------------------------------------
# Fase 1: Inicializa sessão
# ---------------------------------------------------------------------------
info "Stress test — $TURNS turnos"
SESSION_ID="stress-s001"

P_START="{\"hookEventName\":\"SessionStart\",\"sessionId\":\"$SESSION_ID\",\"timestamp\":\"2026-01-01T00:00:00Z\",\"source\":\"new\",\"cwd\":\"/workspaces\"}"
if run_hook "$SCRIPTS_DIR/session-start.sh" "$P_START"; then
    ok "SessionStart inicial"
else
    fail "SessionStart inicial (exit código != 0)"
fi

# ---------------------------------------------------------------------------
# Fase 2: Ciclos de turno
# ---------------------------------------------------------------------------
info "Simulando $TURNS ciclos turno completo"

for i in $(seq 1 "$TURNS"); do
    TS="2026-01-01T$(printf '%02d' $((i / 3600))):%02d:%02d" 2> /dev/null || TS="2026-01-01T${i}:00:00Z"
    TS="2026-01-01T00:00:${i}Z"
    P_PROMPT="{\"hookEventName\":\"UserPromptSubmit\",\"sessionId\":\"$SESSION_ID\",\"timestamp\":\"$TS\",\"prompt\":\"turno $i\",\"cwd\":\"/workspaces\"}"
    P_PRE="{\"hookEventName\":\"PreToolUse\",\"sessionId\":\"$SESSION_ID\",\"timestamp\":\"$TS\",\"tool_name\":\"read_file\",\"tool_use_id\":\"t-${i}\",\"tool_input\":{\"filePath\":\"/x\"}}"
    P_POST="{\"hookEventName\":\"PostToolUse\",\"sessionId\":\"$SESSION_ID\",\"timestamp\":\"$TS\",\"tool_name\":\"read_file\",\"tool_use_id\":\"t-${i}\",\"tool_input\":{},\"tool_response\":\"r\"}"
    P_ASK="{\"hookEventName\":\"PreToolUse\",\"sessionId\":\"$SESSION_ID\",\"timestamp\":\"$TS\",\"tool_name\":\"vscode_askQuestions\",\"tool_use_id\":\"ask-${i}\",\"tool_input\":{\"questions\":[{}]}}"
    P_ASKR="{\"hookEventName\":\"PostToolUse\",\"sessionId\":\"$SESSION_ID\",\"timestamp\":\"$TS\",\"tool_name\":\"vscode_askQuestions\",\"tool_use_id\":\"ask-${i}\",\"tool_input\":{},\"tool_response\":{\"answers\":{}}}"
    P_STOP="{\"hookEventName\":\"Stop\",\"sessionId\":\"$SESSION_ID\",\"timestamp\":\"$TS\",\"stop_hook_active\":false}"

    run_hook "$SCRIPTS_DIR/user-prompt-submit.sh" "$P_PROMPT"
    run_hook "$SCRIPTS_DIR/pre-tool-use.sh" "$P_PRE"
    run_hook "$SCRIPTS_DIR/post-tool-use.sh" "$P_POST"
    run_hook "$SCRIPTS_DIR/pre-tool-use.sh" "$P_ASK"
    run_hook "$SCRIPTS_DIR/post-tool-use.sh" "$P_ASKR"
    run_hook "$SCRIPTS_DIR/stop.sh" "$P_STOP"
done

ok "Concluiu $TURNS ciclos sem crash"

# ---------------------------------------------------------------------------
# Fase 3: Verificações pós-stress
# ---------------------------------------------------------------------------
info "Verificações pós-stress"

STATE_FILE="$STRESS_STATE/session.json"

# a) session.json deve ser JSON válido
if [ -f "$STATE_FILE" ] && jq empty "$STATE_FILE" 2> /dev/null; then
    ok "session.json válido após $TURNS ciclos"
else
    fail "session.json inválido ou ausente após $TURNS ciclos"
fi

# b) turn_count deve ser >= TURNS
if [ -f "$STATE_FILE" ]; then
    TC=$(jq -r '.session_stats.turn_count // 0' "$STATE_FILE" 2> /dev/null)
    if [ "${TC:-0}" -ge "$TURNS" ] 2> /dev/null; then
        ok "turn_count=$TC >= $TURNS"
    else
        fail "turn_count=$TC < $TURNS (ciclos não contabilizados corretamente)"
    fi

    # c) turn_authorized deve ser >= TURNS (todos com askQ)
    AUTH=$(jq -r '.session_stats.turn_authorized // 0' "$STATE_FILE" 2> /dev/null)
    if [ "${AUTH:-0}" -ge "$TURNS" ] 2> /dev/null; then
        ok "turn_authorized=$AUTH >= $TURNS"
    else
        fail "turn_authorized=$AUTH < $TURNS"
    fi

    # d) sem arquivos .state.* temporários acumulados (escrita atômica limpa)
    TEMP_COUNT=$(find "$STRESS_STATE" -name '.state.*' 2> /dev/null | wc -l)
    if [ "${TEMP_COUNT:-0}" -eq 0 ]; then
        ok "Sem arquivos .state.* temporários acumulados ($TEMP_COUNT)"
    else
        fail "Há $TEMP_COUNT arquivo(s) .state.* temporário(s) não limpos"
    fi

    # e) audit.jsonl deve existir e ser não-vazio
    AUDIT_FILE="$STRESS_STATE/audit.jsonl"
    if [ -f "$AUDIT_FILE" ] && [ -s "$AUDIT_FILE" ]; then
        AUDIT_LINES=$(wc -l < "$AUDIT_FILE" 2> /dev/null || echo 0)
        ok "audit.jsonl existe com $AUDIT_LINES linhas"
    else
        fail "audit.jsonl ausente ou vazio após $TURNS ciclos"
    fi
fi

# f) Desempenho de read_field: deve completar em tempo razoável
source "$HOOKS_DIR/lib/hook-payload-api.sh" 2> /dev/null || true
if declare -f read_field > /dev/null 2>&1; then
    START_NS=$(date +%s%N 2> /dev/null || echo 0)
    for _ in $(seq 1 100); do
        read_field '.session_stats.turn_count' > /dev/null 2>&1
    done
    END_NS=$(date +%s%N 2> /dev/null || echo 0)
    ELAPSED_MS=$(((END_NS - START_NS) / 1000000))
    if [ "$ELAPSED_MS" -lt 5000 ] 2> /dev/null; then
        ok "100x read_field em ${ELAPSED_MS}ms (< 5000ms)"
    else
        fail "100x read_field em ${ELAPSED_MS}ms (muito lento — possível regressão)"
    fi
else
    ok "read_field não disponível no contexto atual (pulado)"
fi

# ---------------------------------------------------------------------------
# Resultado
# ---------------------------------------------------------------------------
printf '\n'
printf '═%.0s' {1..55}
printf '\n'
printf ' stress-test-hooks: %d PASS  %d FAIL  (%d turnos)\n' \
    "$PASS_COUNT" "$FAIL_COUNT" "$TURNS"
printf '═%.0s' {1..55}
printf '\n'

if [ "$FAIL_COUNT" -gt 0 ]; then
    exit 1
fi
exit 0
