#!/usr/bin/env bash
# smoke-test.sh — Suite básica de testes (F1)
# Valida contratos de I/O de stop.sh e post-tool-use.sh
# Gate de aceitação F1: retorna PASS quando todos os testes passam.
#
# Uso: bash .github/hooks/scripts/smoke-test.sh [--quiet]
#
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1

PASS=0
FAIL=0
ERRORS=()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_log() { [ "$QUIET" -eq 0 ] && printf '%s\n' "$*" || true; }

begin_test() {
    [ "$QUIET" -eq 0 ] && printf '  %-60s' "$1..." || true
}

pass() {
    PASS=$((PASS + 1))
    [ "$QUIET" -eq 0 ] && printf 'PASS\n' || true
}

fail() {
    local label="$1" reason="$2"
    FAIL=$((FAIL + 1))
    ERRORS+=("$label: $reason")
    [ "$QUIET" -eq 0 ] && printf 'FAIL — %s\n' "$reason" || true
}

# Roda hook capturando stdout (OUT) e exit code (RC)
# Usa HOOKS_TEST_STATE_DIR para isolar state
run_hook() {
    local script="$1" input="$2"
    OUT='' RC=0
    OUT=$(printf '%s' "$input" | HOOKS_TEST_STATE_DIR="$TEST_DIR" bash "$HOOK_DIR/scripts/$script" 2> /dev/null) || RC=$?
}

setup() {
    TEST_DIR="$(mktemp -d)"
    mkdir -p "$TEST_DIR"
    OUT='' RC=0
}

teardown() {
    rm -rf "$TEST_DIR"
    OUT='' RC=0
}

# Escreve session.json no TEST_DIR
write_state() {
    printf '%s\n' "$1" > "$TEST_DIR/session.json"
}

# Lê campo do session.json no TEST_DIR
# NOTA: NÃO usa `// empty` — o operador `//` do jq trata `false` como falsy,
# o que causaria boolean false → "" (string vazia). Usamos jq -r direto para
# que false → "false", true → "true", null → "null".
read_state_field() {
    jq -r "${1}" "$TEST_DIR/session.json" 2> /dev/null
}

# State de teste padrão com ask_questions_called=false, turn_count > 0
_state_aq_false() {
    printf '{
    "vs_code_session_id":"sid","session_id":"sid",
    "started_at":"2026-01-01T00:00:00Z","ended_at":null,
    "close_key":"ENCERRAR-AABBCCDD","source":"new",
    "pending_session_close":false,"strict_turn_close":true,
    "current_turn":{"number":%s,"turn_id":"t1","started_at":"2026-01-01T00:01:00Z",
        "ask_questions_called":false,"subturn_count":0,"tools_count":0},
    "current_subturn":{"number":0,"subturn_id":null,"started_at":null,"response_at":null},
    "session_stats":{"turn_count":%s,"turn_authorized":0,"turn_unauthorized":0,
        "subturn_total":0,"tools_total":2},
    "compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}
}' "${1:-1}" "${1:-1}"
}

# State de teste com ask_questions_called=true
_state_aq_true() {
    printf '{
    "vs_code_session_id":"sid","session_id":"sid",
    "started_at":"2026-01-01T00:00:00Z","ended_at":null,
    "close_key":"ENCERRAR-AABBCCDD","source":"new",
    "pending_session_close":false,"strict_turn_close":true,
    "current_turn":{"number":2,"turn_id":"t2","started_at":"2026-01-01T00:01:00Z",
        "ask_questions_called":true,"subturn_count":1,"tools_count":3},
    "current_subturn":{"number":1,"subturn_id":"s1","started_at":"2026-01-01T00:01:30Z",
        "response_at":"2026-01-01T00:01:45Z"},
    "session_stats":{"turn_count":2,"turn_authorized":1,"turn_unauthorized":0,
        "subturn_total":1,"tools_total":3},
    "compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}
}'
}

# ---------------------------------------------------------------------------
# === stop.sh ===
# ---------------------------------------------------------------------------
_log ""
_log "=== stop.sh ==="

# T01: Anti-loop — stop_hook_active=true → exit 0 + SEM block
setup
begin_test "T01: anti-loop stop_hook_active=true → exit 0 sem block"
run_hook "stop.sh" '{"stop_hook_active":true,"sessionId":"test-123"}'
if [ "$RC" -eq 0 ] && ! printf '%s' "$OUT" | grep -q '"block"'; then
    pass
else
    fail "T01" "rc=$RC output=$OUT"
fi
teardown

# T02: Sem state → auto-init, cria session.json, exit 0
setup
begin_test "T02: sem state → auto-init session.json + exit 0"
run_hook "stop.sh" '{"stop_hook_active":false,"sessionId":"test-123"}'
if [ "$RC" -eq 0 ] && [ -f "$TEST_DIR/session.json" ]; then
    pass
else
    fail "T02" "rc=$RC, state_exists=$([ -f "$TEST_DIR/session.json" ] && echo yes || echo no)"
fi
teardown

# T03: State com turn_count=0 → exit 0 sem block (sessão nova, safety guard)
setup
write_state "$(jq -n '{
    "vs_code_session_id":"sid","session_id":"sid",
    "started_at":"2026-01-01T00:00:00Z","ended_at":null,
    "close_key":"ENCERRAR-AABBCCDD","source":"new",
    "pending_session_close":false,"strict_turn_close":true,
    "current_turn":{"number":0,"turn_id":null,"started_at":null,
        "ask_questions_called":false,"subturn_count":0,"tools_count":0},
    "current_subturn":{"number":0,"subturn_id":null,"started_at":null,"response_at":null},
    "session_stats":{"turn_count":0,"turn_authorized":0,"turn_unauthorized":0,
        "subturn_total":0,"tools_total":0},
    "compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}
}')"
begin_test "T03: turn_count=0 → exit 0 sem block (edge case)"
run_hook "stop.sh" '{"stop_hook_active":false,"sessionId":"sid"}'
if [ "$RC" -eq 0 ] && ! printf '%s' "$OUT" | grep -q '"block"'; then
    pass
else
    fail "T03" "rc=$RC output=$OUT"
fi
teardown

# T04: ask_questions_called=false + strict_turn_close=true → SEM block (enforcement desativado)
setup
write_state "$(_state_aq_false 1)"
begin_test "T04: ask_questions_called=false + strict → sem block (enforcement off)"
run_hook "stop.sh" '{"stop_hook_active":false,"sessionId":"sid"}'
if [ "$RC" -eq 0 ] && ! printf '%s' "$OUT" | grep -q '"block"'; then
    pass
else
    fail "T04" "rc=$RC output=$OUT (esperado: rc=0 sem block)"
fi
teardown

# T05: Turno não-autorizado incrementa turn_unauthorized
setup
write_state "$(_state_aq_false 1)"
begin_test "T05: turno não-autorizado → incrementa turn_unauthorized"
run_hook "stop.sh" '{"stop_hook_active":false,"sessionId":"sid"}'
UNAUTH=$(read_state_field ".session_stats.turn_unauthorized")
if [ "$UNAUTH" -ge 1 ] 2> /dev/null; then
    pass
else
    fail "T05" "turn_unauthorized=$UNAUTH esperado>=1"
fi
teardown

# T06: Turno não-autorizado incrementa compliance.consecutive_unauthorized
setup
write_state "$(_state_aq_false 1)"
begin_test "T06: turno não-autorizado → incrementa consecutive_unauthorized"
run_hook "stop.sh" '{"stop_hook_active":false,"sessionId":"sid"}'
CONSEC=$(read_state_field ".compliance.consecutive_unauthorized")
if [ "$CONSEC" -ge 1 ] 2> /dev/null; then
    pass
else
    fail "T06" "consecutive_unauthorized=$CONSEC esperado>=1"
fi
teardown

# T07: ask_questions_called=true → exit 0 SEM block
setup
write_state "$(_state_aq_true)"
begin_test "T07: ask_questions_called=true → exit 0 sem block"
run_hook "stop.sh" '{"stop_hook_active":false,"sessionId":"sid"}'
if [ "$RC" -eq 0 ] && ! printf '%s' "$OUT" | grep -q '"block"'; then
    pass
else
    fail "T07" "rc=$RC output=$OUT"
fi
teardown

# T08: Após turno autorizado, ask_questions_called é resetado
setup
write_state "$(_state_aq_true)"
begin_test "T08: turno autorizado reseta ask_questions_called para false"
run_hook "stop.sh" '{"stop_hook_active":false,"sessionId":"sid"}'
FIELD=$(read_state_field ".current_turn.ask_questions_called")
if [ "$FIELD" = "false" ]; then
    pass
else
    fail "T08" "ask_questions_called=$FIELD esperado=false"
fi
teardown

# T09: Após block, consecutive_unauthorized é incrementado
setup
write_state "$(_state_aq_false 3)"
begin_test "T09: block incrementa compliance.consecutive_unauthorized"
run_hook "stop.sh" '{"stop_hook_active":false,"sessionId":"sid"}'
CONSEC=$(read_state_field ".compliance.consecutive_unauthorized")
if [ "${CONSEC:-0}" -ge 1 ]; then
    pass
else
    fail "T09" "consecutive_unauthorized=$CONSEC esperado>=1"
fi
teardown

# T10: Após turno autorizado, consecutive_unauthorized é zerado
setup
write_state "$(printf '%s' "$(_state_aq_true)" | jq '.compliance.consecutive_unauthorized = 3')"
begin_test "T10: turno autorizado zera consecutive_unauthorized"
run_hook "stop.sh" '{"stop_hook_active":false,"sessionId":"sid"}'
CONSEC=$(read_state_field ".compliance.consecutive_unauthorized")
if [ "${CONSEC:-99}" -eq 0 ]; then
    pass
else
    fail "T10" "consecutive_unauthorized=$CONSEC esperado=0"
fi
teardown

# ---------------------------------------------------------------------------
# === post-tool-use.sh ===
# ---------------------------------------------------------------------------
_log ""
_log "=== post-tool-use.sh ==="

# T11: vscode_askQuestions → ask_questions_called=true
setup
write_state "$(_state_aq_false 1)"
begin_test "T11: vscode_askQuestions → ask_questions_called=true"
run_hook "post-tool-use.sh" \
    '{"tool_name":"vscode_askQuestions","tool_input":{},"tool_response":"{\"answers\":{\"0\":{\"freeText\":\"ok\"}}}","sessionId":"sid"}'
FIELD=$(read_state_field ".current_turn.ask_questions_called")
if [ "$FIELD" = "true" ]; then
    pass
else
    fail "T11" "ask_questions_called=$FIELD esperado=true"
fi
teardown

# T12: close_key no freeText → pending_session_close=true
setup
write_state "$(_state_aq_false 1)"
begin_test "T12: close_key detectada → pending_session_close=true"
run_hook "post-tool-use.sh" \
    '{"tool_name":"vscode_askQuestions","tool_input":{},"tool_response":"{\"answers\":{\"0\":{\"freeText\":\"ENCERRAR-AABBCCDD\"}}}","sessionId":"sid"}'
FIELD=$(read_state_field ".pending_session_close")
if [ "$FIELD" = "true" ]; then
    pass
else
    fail "T12" "pending_session_close=$FIELD esperado=true"
fi
teardown

# T13: Ferramenta diferente não altera ask_questions_called
setup
write_state "$(_state_aq_false 1)"
begin_test "T13: read_file não altera ask_questions_called"
run_hook "post-tool-use.sh" \
    '{"tool_name":"read_file","tool_input":{"filePath":"/tmp/x"},"tool_response":"conteudo","sessionId":"sid"}'
FIELD=$(read_state_field ".current_turn.ask_questions_called")
if [ "$FIELD" = "false" ]; then
    pass
else
    fail "T13" "ask_questions_called=$FIELD esperado=false"
fi
teardown

# T14: close_key errada não seta pending_session_close
setup
write_state "$(_state_aq_false 1)"
begin_test "T14: close_key incorreta não seta pending_session_close"
run_hook "post-tool-use.sh" \
    '{"tool_name":"vscode_askQuestions","tool_input":{},"tool_response":"{\"answers\":{\"0\":{\"freeText\":\"ENCERRAR-ERRADA00\"}}}","sessionId":"sid"}'
FIELD=$(read_state_field ".pending_session_close")
if [ "$FIELD" = "false" ]; then
    pass
else
    fail "T14" "pending_session_close=$FIELD esperado=false"
fi
teardown

# T15: post-tool-use.sh exit 0 sempre (ferramenta comum)
setup
write_state "$(_state_aq_false 1)"
begin_test "T15: post-tool-use.sh exit 0 para ferramenta comum"
run_hook "post-tool-use.sh" \
    '{"tool_name":"run_in_terminal","tool_input":{"command":"echo hi"},"tool_response":"hi","sessionId":"sid"}'
if [ "$RC" -eq 0 ]; then
    pass
else
    fail "T15" "rc=$RC esperado=0"
fi
teardown

# T16: post-tool-use.sh sem state previo — não falha
setup
begin_test "T16: sem state previo → post-tool-use.sh exit 0"
run_hook "post-tool-use.sh" \
    '{"tool_name":"read_file","tool_input":{},"tool_response":"ok","sessionId":"sid"}'
if [ "$RC" -eq 0 ]; then
    pass
else
    fail "T16" "rc=$RC esperado=0"
fi
teardown

# ---------------------------------------------------------------------------
# === Resultado Final ===
# ---------------------------------------------------------------------------
_log ""
_log "==================================================="
TOTAL=$((PASS + FAIL))
_log "$(printf 'RESULTADO: %d/%d testes passaram' "$PASS" "$TOTAL")"

if [ "${#ERRORS[@]}" -gt 0 ]; then
    _log ""
    _log "FALHAS:"
    for e in "${ERRORS[@]}"; do
        _log "  - $e"
    done
    _log ""
    printf 'STATUS: FAIL (%d/%d)\n' "$PASS" "$TOTAL"
    exit 1
fi

printf 'STATUS: PASS (%d/%d)\n' "$PASS" "$TOTAL"
exit 0
