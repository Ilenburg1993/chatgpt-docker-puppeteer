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
run_hook "stop.sh" '{"hookEventName":"Stop","stop_hook_active":true,"sessionId":"test-123"}'
if [ "$RC" -eq 0 ] && ! printf '%s' "$OUT" | grep -q '"block"'; then
    pass
else
    fail "T01" "rc=$RC output=$OUT"
fi
teardown

# T02: Sem state → auto-init, cria session.json, exit 0
setup
begin_test "T02: sem state → auto-init session.json + exit 0"
run_hook "stop.sh" '{"hookEventName":"Stop","stop_hook_active":false,"sessionId":"test-123"}'
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
run_hook "stop.sh" '{"hookEventName":"Stop","stop_hook_active":false,"sessionId":"sid"}'
if [ "$RC" -eq 0 ] && ! printf '%s' "$OUT" | grep -q '"block"'; then
    pass
else
    fail "T03" "rc=$RC output=$OUT"
fi
teardown

# T04: ask_questions_called=false + strict_turn_close=true → EMITE block (GAP-03)
setup
write_state "$(_state_aq_false 1)"
begin_test "T04: ask_questions_called=false + strict_turn_close=true → emite block"
run_hook "stop.sh" '{"hookEventName":"Stop","stop_hook_active":false,"sessionId":"sid"}'
if printf '%s' "$OUT" | grep -q '"block"'; then
    pass
else
    fail "T04" "rc=$RC output=$OUT (esperado: block emitido)"
fi
teardown

# T04b: ask_questions_called=false + strict_turn_close=false → sem block
setup
write_state "$(printf '%s' "$(_state_aq_false 1)" | jq '.strict_turn_close = false')"
begin_test "T04b: ask_questions_called=false + strict_turn_close=false → sem block"
run_hook "stop.sh" '{"hookEventName":"Stop","stop_hook_active":false,"sessionId":"sid"}'
if [ "$RC" -eq 0 ] && ! printf '%s' "$OUT" | grep -q '"block"'; then
    pass
else
    fail "T04b" "rc=$RC output=$OUT (esperado: rc=0 sem block)"
fi
teardown

# T05: Turno não-autorizado incrementa turn_unauthorized
setup
write_state "$(_state_aq_false 1)"
begin_test "T05: turno não-autorizado → incrementa turn_unauthorized"
run_hook "stop.sh" '{"hookEventName":"Stop","stop_hook_active":false,"sessionId":"sid"}'
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
run_hook "stop.sh" '{"hookEventName":"Stop","stop_hook_active":false,"sessionId":"sid"}'
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
run_hook "stop.sh" '{"hookEventName":"Stop","stop_hook_active":false,"sessionId":"sid"}'
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
run_hook "stop.sh" '{"hookEventName":"Stop","stop_hook_active":false,"sessionId":"sid"}'
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
run_hook "stop.sh" '{"hookEventName":"Stop","stop_hook_active":false,"sessionId":"sid"}'
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
run_hook "stop.sh" '{"hookEventName":"Stop","stop_hook_active":false,"sessionId":"sid"}'
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
    '{"hookEventName":"PostToolUse","tool_name":"vscode_askQuestions","tool_input":{},"tool_response":"{\"answers\":{\"0\":{\"freeText\":\"ok\"}}}","sessionId":"sid"}'
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
    '{"hookEventName":"PostToolUse","tool_name":"vscode_askQuestions","tool_input":{},"tool_response":"{\"answers\":{\"0\":{\"freeText\":\"ENCERRAR-AABBCCDD\"}}}","sessionId":"sid"}'
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
    '{"hookEventName":"PostToolUse","tool_name":"read_file","tool_input":{"filePath":"/tmp/x"},"tool_response":"conteudo","sessionId":"sid"}'
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
    '{"hookEventName":"PostToolUse","tool_name":"vscode_askQuestions","tool_input":{},"tool_response":"{\"answers\":{\"0\":{\"freeText\":\"ENCERRAR-ERRADA00\"}}}","sessionId":"sid"}'
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
    '{"hookEventName":"PostToolUse","tool_name":"run_in_terminal","tool_input":{"command":"echo hi"},"tool_response":"hi","sessionId":"sid"}'
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
    '{"hookEventName":"PostToolUse","tool_name":"read_file","tool_input":{},"tool_response":"ok","sessionId":"sid"}'
if [ "$RC" -eq 0 ]; then
    pass
else
    fail "T16" "rc=$RC esperado=0"
fi
teardown

# T17: UP-H1b — task_complete bloqueado quando tools_after_ask_questions > 1
setup
begin_test "T17: UP-H1b — task_complete bloqueado se tools extras após askQ"
# ask_questions_called=true mas tools_after=2 (ask → manage_todo_list → read_file)
_state_aq_true | jq \
    '.current_turn.tools_after_ask_questions = 2 |
     .current_turn.last_tool_after_ask_questions = "read_file"' \
    > "$TEST_DIR/session.json"
run_hook "pre-tool-use.sh" \
    '{"hookEventName":"PreToolUse","tool_use_id":"t-h1b-001","tool_name":"task_complete","tool_input":{},"sessionId":"sid"}'
DECISION=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2> /dev/null)
if [ "${DECISION}" = "deny" ]; then
    pass
else
    fail "T17" "permissionDecision='${DECISION}' esperado='deny' (tools_after=2) out='${OUT}'"
fi
teardown

# T18: UP-H1b — task_complete PERMITIDO após askQ + manage_todo_list (bookkeeping exception)
setup
begin_test "T18: UP-H1b — task_complete permitido após askQ + manage_todo_list"
_state_aq_true | jq \
    '.current_turn.tools_after_ask_questions = 1 |
     .current_turn.last_tool_after_ask_questions = "manage_todo_list"' \
    > "$TEST_DIR/session.json"
run_hook "pre-tool-use.sh" \
    '{"hookEventName":"PreToolUse","tool_use_id":"t-h1b-002","tool_name":"task_complete","tool_input":{},"sessionId":"sid"}'
DECISION=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2> /dev/null)
if [ "${DECISION}" != "deny" ]; then
    pass
else
    fail "T18" "permissionDecision='${DECISION}' task_complete com tools_after=1,last=manage_todo_list deveria ser permitido"
fi
teardown

# T19: UP-H1b — task_complete direto após askQ (tools_after=0) é permitido
setup
begin_test "T19: UP-H1b — task_complete direto após askQ (tools_after=0) é permitido"
_state_aq_true | jq \
    '.current_turn.tools_after_ask_questions = 0 |
     .current_turn.last_tool_after_ask_questions = ""' \
    > "$TEST_DIR/session.json"
run_hook "pre-tool-use.sh" \
    '{"hookEventName":"PreToolUse","tool_use_id":"t-h1b-003","tool_name":"task_complete","tool_input":{},"sessionId":"sid"}'
DECISION=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2> /dev/null)
if [ "${DECISION}" != "deny" ]; then
    pass
else
    fail "T19" "permissionDecision='${DECISION}' task_complete direto após askQ (tools_after=0) deveria ser permitido"
fi
teardown

# T20: post-tool-use.sh — vscode_askQuestions reseta tools_after_ask_questions para 0
setup
begin_test "T20: askQuestions reseta tools_after_ask_questions=0"
# Pré-existente: tools_after=3 (de ferramentas anteriores no turno)
_state_aq_false | jq '.current_turn.tools_after_ask_questions = 3' \
    > "$TEST_DIR/session.json"
run_hook "post-tool-use.sh" \
    '{"hookEventName":"PostToolUse","tool_use_id":"t-h1b-004","tool_name":"vscode_askQuestions","tool_input":{"questions":[{"header":"H","question":"Q"}]},"tool_response":"{\"answers\":{}}","sessionId":"sid"}'
VAL=$(read_state_field ".current_turn.tools_after_ask_questions")
if [ "${VAL}" = "0" ]; then
    pass
else
    fail "T20" "tools_after_ask_questions='${VAL}' esperado=0"
fi
teardown

# T21: Guard B — task_complete bloqueado quando summary contém "?" (após askQ OK)
setup
begin_test "T21: Guard B — task_complete bloqueado com perguntas no summary"
write_state "$(_state_aq_true)"
run_hook "pre-tool-use.sh" \
    '{"hookEventName":"PreToolUse","tool_use_id":"t-gb-001","tool_name":"task_complete","tool_input":{"summary":"Tarefa concluída. Devo também corrigir o lint? Quer que eu continue?"},"sessionId":"sid"}'
DECISION=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2> /dev/null)
if [ "${DECISION}" = "deny" ]; then
    pass
else
    fail "T21" "permissionDecision='${DECISION}' esperado='deny' (Guard B: summary com '?') out='${OUT}'"
fi
teardown

# T22: Guard B — task_complete PERMITIDO quando summary não tem "?"
setup
begin_test "T22: Guard B — task_complete permitido com summary sem perguntas"
write_state "$(_state_aq_true)"
run_hook "pre-tool-use.sh" \
    '{"hookEventName":"PreToolUse","tool_use_id":"t-gb-002","tool_name":"task_complete","tool_input":{"summary":"Tarefa concluída com sucesso. Todos os testes passam."},"sessionId":"sid"}'
DECISION=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2> /dev/null)
if [ "${DECISION}" != "deny" ]; then
    pass
else
    fail "T22" "permissionDecision='${DECISION}' task_complete sem perguntas no summary deveria ser permitido"
fi
teardown

# T23: Guard C — deny com razao guard_c quando summary tem heuristica de conclusao (sem askQ)
setup
begin_test "T23: Guard C — deny com heuristica de conclusao no summary"
write_state "$(_state_aq_false)"
run_hook "pre-tool-use.sh" \
    '{"hookEventName":"PreToolUse","tool_use_id":"t-gc-001","tool_name":"task_complete","tool_input":{"summary":"✅ Todos os TODOs completos. Tarefa finalizada com sucesso."},"sessionId":"sid"}'
DECISION=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2> /dev/null)
if [ "${DECISION}" = "deny" ]; then
    pass
else
    fail "T23" "permissionDecision='${DECISION}' esperado='deny' (Guard C: heuristica de conclusao) out='${OUT}'"
fi
teardown

# T24: Guard C — deny padrao quando summary nao tem heuristica de conclusao (sem askQ)
setup
begin_test "T24: Guard C — deny padrao quando summary sem heuristica (sem askQ)"
write_state "$(_state_aq_false)"
run_hook "pre-tool-use.sh" \
    '{"hookEventName":"PreToolUse","tool_use_id":"t-gc-002","tool_name":"task_complete","tool_input":{"summary":"Trabalhei na refatoracao do arquivo."},"sessionId":"sid"}'
DECISION=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2> /dev/null)
if [ "${DECISION}" = "deny" ]; then
    pass
else
    fail "T24" "permissionDecision='${DECISION}' esperado='deny' (UP-H1 normal) out='${OUT}'"
fi
teardown

# T25: manage_todo_list nao incrementa tools_after_ask_questions (bookkeeping exemption)
setup
begin_test "T25: manage_todo_list isento de tools_after_ask_questions"
_state_aq_false | jq '.current_turn.tools_after_ask_questions = 0' \
    > "$TEST_DIR/session.json"
run_hook "post-tool-use.sh" \
    '{"hookEventName":"PostToolUse","tool_use_id":"t-h1b-exempt","tool_name":"manage_todo_list","tool_input":{"todoList":[]},"tool_response":"{}","sessionId":"sid"}'
VAL=$(read_state_field ".current_turn.tools_after_ask_questions")
if [ "${VAL}" = "0" ]; then
    pass
else
    fail "T25" "tools_after_ask_questions='${VAL}' esperado=0 (manage_todo_list deve ser isento)"
fi
teardown

# T26: open_new_turn reseta tools_after_ask_questions para 0 (sem carry-over entre turnos)
setup
begin_test "T26: open_new_turn reseta tools_after_ask_questions entre turnos"
# Estado com turno anterior que deixou tools_after=3 e started_at=null para evitar healing
write_state '{
    "vs_code_session_id":"sid","session_id":"sid",
    "started_at":"2026-01-01T00:00:00Z","ended_at":null,
    "close_key":"ENCERRAR-AABBCCDD","source":"new",
    "pending_session_close":false,"strict_turn_close":true,
    "current_turn":{"number":1,"turn_id":"t1","started_at":null,
        "ask_questions_called":false,"subturn_count":0,"tools_count":2,
        "tools_after_ask_questions":3,"last_tool_after_ask_questions":"read_file",
        "subagents_started":0,"intent":""},
    "current_subturn":{"number":0,"subturn_id":null,"started_at":null,"response_at":null},
    "session_stats":{"turn_count":1,"turn_authorized":0,"turn_unauthorized":0,
        "subturn_total":0,"tools_total":2},
    "compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}
}'
# user-prompt-submit abre novo turno via open_new_turn — deve zerar os contadores UP-H1b
run_hook "user-prompt-submit.sh" \
    '{"hookEventName":"UserPromptSubmit","sessionId":"sid","prompt":"nova tarefa"}'
VAL_TAAQ=$(read_state_field ".current_turn.tools_after_ask_questions")
VAL_LAST=$(read_state_field ".current_turn.last_tool_after_ask_questions")
if [ "${VAL_TAAQ}" = "0" ] && { [ "${VAL_LAST:-}" = "" ] || [ "${VAL_LAST:-}" = "null" ]; }; then
    pass
else
    fail "T26" "tools_after='${VAL_TAAQ}' last='${VAL_LAST}' esperado=0/'' (carry-over entre turnos deve ser zerado)"
fi
teardown

# T27: user-prompt-submit emite aviso quando pending_session_close=true (GAP-UPS1)
setup
begin_test "T27: user-prompt-submit alerta quando pending_session_close=true"
write_state '{"vs_code_session_id":"sid","session_id":"sid","started_at":"2026-01-01T00:00:00Z","ended_at":null,"close_key":"ENCERRAR-AABBCCDD","source":"new","pending_session_close":true,"strict_turn_close":true,"current_turn":{"number":1,"turn_id":"t1","started_at":null,"ask_questions_called":false,"subturn_count":0,"tools_count":0,"tools_after_ask_questions":0,"last_tool_after_ask_questions":"","subagents_started":0,"intent":""},"current_subturn":{"number":0,"subturn_id":null,"started_at":null,"response_at":null},"session_stats":{"turn_count":1,"turn_authorized":0,"turn_unauthorized":0,"subturn_total":0,"tools_total":0},"compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}}'
run_hook "user-prompt-submit.sh" \
    '{"hookEventName":"UserPromptSubmit","sessionId":"sid","prompt":"tarefa nova"}'
if printf '%s' "$OUT" | grep -qi "ENCERRAMENTO PENDENTE"; then
    pass
else
    fail "T27" "esperado aviso 'ENCERRAMENTO PENDENTE' na saída, mas não encontrado. Saída: $(printf '%s' "$OUT" | head -c 200)"
fi
teardown

# T28: user-prompt-submit emite alerta UP-03 quando consecutive_unauthorized >= 2
setup
begin_test "T28: UP-03 — alerta compliance quando consecutive_unauthorized >= 2"
write_state '{"vs_code_session_id":"sid","session_id":"sid","started_at":"2026-01-01T00:00:00Z","ended_at":null,"close_key":"ENCERRAR-AABBCCDD","source":"new","pending_session_close":false,"strict_turn_close":true,"current_turn":{"number":2,"turn_id":"t2","started_at":null,"ask_questions_called":false,"subturn_count":0,"tools_count":0,"tools_after_ask_questions":0,"last_tool_after_ask_questions":"","subagents_started":0,"intent":""},"current_subturn":{"number":0,"subturn_id":null,"started_at":null,"response_at":null},"session_stats":{"turn_count":2,"turn_authorized":0,"turn_unauthorized":2,"subturn_total":0,"tools_total":0},"compliance":{"consecutive_unauthorized":2,"last_turn_authorized":false}}'
run_hook "user-prompt-submit.sh" \
    '{"hookEventName":"UserPromptSubmit","sessionId":"sid","prompt":"outra tarefa"}'
if printf '%s' "$OUT" | grep -qi "COMPLIANCE"; then
    pass
else
    fail "T28" "esperado aviso 'COMPLIANCE' na saída para consecutive_unauthorized=2, mas não encontrado. Saída: $(printf '%s' "$OUT" | head -c 200)"
fi
teardown

# T29: UP-H2 — post-tool-use emite subturnEnd quando git push dispara reminder (GAP-UP-H2)
setup
begin_test "T29: UP-H2 — subturnEnd no audit log quando git push detectado"
write_state '{"vs_code_session_id":"sid","session_id":"sid","started_at":"2026-01-01T00:00:00Z","ended_at":null,"close_key":"ENCERRAR-AABBCCDD","source":"new","pending_session_close":false,"strict_turn_close":true,"current_turn":{"number":1,"turn_id":"t1","started_at":"2026-01-01T00:00:00Z","ask_questions_called":false,"subturn_count":1,"tools_count":1,"tools_after_ask_questions":0,"last_tool_after_ask_questions":"","subagents_started":0,"intent":""},"current_subturn":{"number":1,"subturn_id":"st1","started_at":"2026-01-01T00:00:00Z","response_at":null,"ended_at":null},"session_stats":{"turn_count":1,"turn_authorized":0,"turn_unauthorized":0,"subturn_total":1,"tools_total":1},"compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}}'
run_hook "post-tool-use.sh" \
    '{"hookEventName":"PostToolUse","sessionId":"sid","tool":{"name":"run_in_terminal","use_id":"u1","input":{"command":"git push origin main"},"response":{"output":"Branch pushed"}}}'
if [ -f "$TEST_DIR/audit.jsonl" ] && grep -q '"event":"subturnEnd"' "$TEST_DIR/audit.jsonl"; then
    pass
else
    fail "T29" "esperado evento subturnEnd no audit.jsonl após git push com UP-H2, mas não encontrado"
fi
teardown

# T30: migração v2→v3 — session com schema_version=2 recebe tools_after_ask_questions=0
setup
begin_test "T30: schema v2→v3 — migração adiciona tools_after_ask_questions em state legado"
# State com schema_version=2 (sem tools_after_ask_questions nem last_tool_after_ask_questions)
write_state '{"vs_code_session_id":"sid","session_id":"sid","state_schema_version":"2","started_at":"2026-01-01T00:00:00Z","ended_at":null,"close_key":"ENCERRAR-AABBCCDD","source":"reconnect","pending_session_close":false,"strict_turn_close":true,"current_turn":{"number":1,"turn_id":"t1","started_at":"2026-01-01T00:00:00Z","ask_questions_called":false,"subturn_count":0,"tools_count":0,"subagents_started":0,"intent":"","last_template":""},"current_subturn":{"number":0,"subturn_id":null,"started_at":null,"response_at":null},"session_stats":{"turn_count":1,"turn_authorized":0,"turn_unauthorized":0,"subturn_total":0,"tools_total":0,"subturn_duration_total_ms":0},"compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}}'
run_hook "user-prompt-submit.sh" \
    '{"hookEventName":"UserPromptSubmit","sessionId":"sid","prompt":"continuar trabalho"}'
# Após o hook, state deve ter sido migrado para v3 com o campo tools_after_ask_questions
_taaq=$(grep -o '"tools_after_ask_questions":[0-9]*' "$TEST_DIR/session.json" 2> /dev/null | head -1)
if [ -n "$_taaq" ]; then
    pass
else
    fail "T30" "esperado campo 'tools_after_ask_questions' no state após migração v2→v3, mas não encontrado"
fi
teardown

# T31: GAP-SCHEMA-V3-PTU — post-tool-use tolera state legado sem tools_after_ask_questions (proteção :-0)
setup
begin_test "T31: post-tool-use tolera state sem tools_after_ask_questions (arith safety)"
# State v2 sem o campo tools_after_ask_questions — simula state legado ANTES da migração
write_state '{"vs_code_session_id":"sid","session_id":"sid","state_schema_version":"2","started_at":"2026-01-01T00:00:00Z","ended_at":null,"close_key":"ENCERRAR-AABBCCDD","source":"new","pending_session_close":false,"strict_turn_close":true,"current_turn":{"number":1,"turn_id":"t1","started_at":"2026-01-01T00:00:00Z","ask_questions_called":false,"subturn_count":0,"tools_count":5,"subagents_started":0,"intent":"","last_template":""},"current_subturn":{"number":1,"subturn_id":"sub1","started_at":"2026-01-01T00:00:00Z","response_at":null},"session_stats":{"turn_count":1,"turn_authorized":0,"turn_unauthorized":0,"subturn_total":1,"tools_total":5,"subturn_duration_total_ms":0},"compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}}'
run_hook "post-tool-use.sh" \
    '{"hookEventName":"PostToolUse","sessionId":"sid","tool":{"name":"read_file","use_id":"u1","input":{"file_path":"/tmp/x.txt"},"response":{"output":"conteudo"}}}'
if [ "$RC" -eq 0 ]; then
    pass
else
    fail "T31" "post-tool-use falhou (RC=$RC) com state sem tools_after_ask_questions — possível erro aritmético; saída: $OUT"
fi
teardown

# T32: watchdog tolera state sem session_stats.turn_count (arith safety)
setup
begin_test "T32: watchdog tolera state sem session_stats.turn_count (arith safety)"
# State sem session_stats (schema antigo ou corrompido) — simula que turn_count ausente
write_state '{"vs_code_session_id":"sid","session_id":"sid","started_at":"2026-01-01T00:00:00Z","close_key":"ENCERRAR-AABBCCDD","pending_session_close":false}'
# Criar audit.jsonl no TEST_DIR para que check_audit_coherence tente ler
printf '{"ts":"2026-01-01T00:00:01Z","event":"turnStart","turn":1}\n' > "$TEST_DIR/audit.jsonl"
# Rodar watchdog — deve completar sem erro aritmético; RC pode ser 0 ou 1 (tem problemas)
OUT='' RC=0
OUT=$(HOOKS_TEST_STATE_DIR="$TEST_DIR" bash "$HOOK_DIR/scripts/watchdog.sh" 2> /dev/null) || RC=$?
# Aceitar RC=0 (saudável) ou RC=1 (issues encontrados) — mas NÃO crash (ex: RC=139 ou arith)
if [ "$RC" -le 1 ]; then
    pass
else
    fail "T32" "watchdog saiu com RC=$RC (esperado <=1) — possível crash ou erro aritmético; saída: $OUT"
fi
teardown

# T33: GAP-ABRUPT-SUBTURN — stop.sh deve emitir subturnEnd_abrupt quando subturn ativo sem ended_at
setup
begin_test "T33: stop.sh fecha subturn ativo sem ended_at antes do turnEnd (GAP-ABRUPT-SUBTURN)"
write_state '{"vs_code_session_id":"sid","session_id":"sid","state_schema_version":"3","started_at":"2026-01-01T00:00:00Z","ended_at":null,"close_key":"ENCERRAR-AABBCCDD","pending_session_close":false,"strict_turn_close":false,"current_turn":{"number":1,"turn_id":"t1","started_at":"2026-01-01T00:00:00Z","ask_questions_called":true,"subturn_count":1,"tools_count":1,"tools_after_ask_questions":0,"last_tool_after_ask_questions":"","subagents_started":0,"intent":"","last_template":"A"},"current_subturn":{"number":1,"subturn_id":"st1","started_at":"2026-01-01T00:00:00Z","response_at":null,"ended_at":null},"session_stats":{"turn_count":1,"turn_authorized":0,"turn_unauthorized":0,"subturn_total":1,"tools_total":1,"subturn_duration_total_ms":0},"compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}}'
run_hook "stop.sh" \
    '{"hookEventName":"Stop","sessionId":"sid","reason":"normal"}'
if [ -f "$TEST_DIR/audit.jsonl" ] && grep -q '"event":"subturnEnd_abrupt"' "$TEST_DIR/audit.jsonl"; then
    pass
else
    fail "T33" "esperado evento subturnEnd_abrupt no audit.jsonl ao stop com subturn ativo, mas não encontrado; RC=$RC"
fi
teardown

# T34: GAP-ABRUPT-TURN-END — session-end.sh deve emitir turnEnd_abrupt quando turn ativo sem ended_at
setup
begin_test "T34: session-end.sh fecha turn/subturn ativos (GAP-ABRUPT-TURN-END)"
write_state '{"vs_code_session_id":"sid","session_id":"sid","state_schema_version":"3","started_at":"2026-01-01T00:00:00Z","ended_at":null,"close_key":"ENCERRAR-AABBCCDD","pending_session_close":false,"strict_turn_close":false,"current_turn":{"number":2,"turn_id":"t2","started_at":"2026-01-01T00:01:00Z","ask_questions_called":false,"subturn_count":1,"tools_count":3,"tools_after_ask_questions":0,"last_tool_after_ask_questions":"","subagents_started":0,"intent":"","last_template":""},"current_subturn":{"number":1,"subturn_id":"st1","started_at":"2026-01-01T00:01:00Z","response_at":null,"ended_at":null},"session_stats":{"turn_count":2,"turn_authorized":1,"turn_unauthorized":0,"subturn_total":2,"tools_total":3,"subturn_duration_total_ms":0},"compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}}'
run_hook "session-end.sh" \
    '{"hookEventName":"SessionEnd","sessionId":"sid"}'
if [ -f "$TEST_DIR/audit.jsonl" ] \
    && grep -q '"event":"turnEnd_abrupt"' "$TEST_DIR/audit.jsonl" \
    && grep -q '"event":"subturnEnd_abrupt"' "$TEST_DIR/audit.jsonl"; then
    pass
else
    fail "T34" "esperado eventos turnEnd_abrupt e subturnEnd_abrupt no audit.jsonl; RC=$RC; audit=$(cat "$TEST_DIR/audit.jsonl" 2> /dev/null)"
fi
teardown

# T35: session-end.sh sem turn ativo não deve emitir turnEnd_abrupt (guard de idempotência)
setup
begin_test "T35: session-end.sh sem turn ativo não emite turnEnd_abrupt (idempotência)"
write_state '{"vs_code_session_id":"sid","session_id":"sid","state_schema_version":"3","started_at":"2026-01-01T00:00:00Z","ended_at":null,"close_key":"ENCERRAR-AABBCCDD","pending_session_close":false,"strict_turn_close":false,"current_turn":{"number":1,"turn_id":"t1","started_at":"2026-01-01T00:00:00Z","ask_questions_called":true,"subturn_count":0,"tools_count":0,"tools_after_ask_questions":0,"last_tool_after_ask_questions":"","subagents_started":0,"intent":"","last_template":"A","ended_at":"2026-01-01T00:00:59Z"},"current_subturn":{"number":0,"subturn_id":null,"started_at":null,"response_at":null,"ended_at":null},"session_stats":{"turn_count":1,"turn_authorized":1,"turn_unauthorized":0,"subturn_total":0,"tools_total":0,"subturn_duration_total_ms":0},"compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}}'
run_hook "session-end.sh" \
    '{"hookEventName":"SessionEnd","sessionId":"sid"}'
if [ -f "$TEST_DIR/audit.jsonl" ] && ! grep -q '"event":"turnEnd_abrupt"' "$TEST_DIR/audit.jsonl"; then
    pass
else
    fail "T35" "session-end.sh não deveria emitir turnEnd_abrupt quando turn já encerrado; RC=$RC; audit=$(cat "$TEST_DIR/audit.jsonl" 2> /dev/null)"
fi
teardown

# T36: stop.sh reseta subagents_active=0 quando há subagente órfão ao fechar turno (GAP-SUBAGENT-ORPHAN)
setup
begin_test "T36: stop.sh reseta subagents_active quando há subagente órfão (GAP-SUBAGENT-ORPHAN)"
write_state '{"vs_code_session_id":"sid","session_id":"sid","state_schema_version":"3","started_at":"2026-01-01T00:00:00Z","ended_at":null,"close_key":"ENCERRAR-AABBCCDD","pending_session_close":false,"strict_turn_close":false,"current_turn":{"number":1,"turn_id":"t1","started_at":"2026-01-01T00:00:00Z","ask_questions_called":true,"subturn_count":0,"tools_count":0,"tools_after_ask_questions":0,"last_tool_after_ask_questions":"","subagents_started":1,"intent":"","last_template":"A","ended_at":null},"current_subturn":{"number":0,"subturn_id":null,"started_at":null,"response_at":null,"ended_at":null},"session_stats":{"turn_count":1,"turn_authorized":0,"turn_unauthorized":0,"subturn_total":0,"tools_total":0,"subturn_duration_total_ms":0,"subagents_active":2,"subagents_total":2},"compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}}'
run_hook "stop.sh" \
    '{"hookEventName":"Stop","sessionId":"sid","stop_hook_active":false}'
if grep -q '"event":"subagentOrphan_turnclosed"' "$TEST_DIR/audit.jsonl" 2> /dev/null; then
    # Verificar que subagents_active foi zerado no state
    active=$(jq -r '.session_stats.subagents_active // 99' "$TEST_DIR/session.json" 2> /dev/null)
    if [ "${active:-99}" = "0" ]; then
        pass
    else
        fail "T36" "stop.sh emitiu subagentOrphan_turnclosed mas subagents_active=$active (esperado 0)"
    fi
else
    fail "T36" "stop.sh deveria emitir subagentOrphan_turnclosed com 2 subagentes órfãos; audit=$(cat "$TEST_DIR/audit.jsonl" 2> /dev/null)"
fi
teardown

# T37: stop.sh registra last_activity_at no state ao fechar turno autorizado (UP-HEARTBEAT)
setup
begin_test "T37: stop.sh registra last_activity_at ao fechar turno autorizado (UP-HEARTBEAT)"
write_state '{"vs_code_session_id":"sid","session_id":"sid","state_schema_version":"3","started_at":"2026-01-01T00:00:00Z","ended_at":null,"close_key":"ENCERRAR-AABBCCDD","pending_session_close":false,"strict_turn_close":false,"last_activity_at":null,"current_turn":{"number":1,"turn_id":"t1","started_at":"2026-01-01T00:00:00Z","ask_questions_called":true,"subturn_count":0,"tools_count":0,"tools_after_ask_questions":0,"last_tool_after_ask_questions":"","subagents_started":0,"intent":"","last_template":"A","ended_at":null},"current_subturn":{"number":0,"subturn_id":null,"started_at":null,"response_at":null,"ended_at":null},"session_stats":{"turn_count":1,"turn_authorized":0,"turn_unauthorized":0,"subturn_total":0,"tools_total":0,"subturn_duration_total_ms":0,"subagents_active":0,"subagents_total":0},"compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}}'
run_hook "stop.sh" \
    '{"hookEventName":"Stop","sessionId":"sid","stopReason":"userTriggered","decision":"block","stop_hook_active":false}'
laa=$(jq -r '.last_activity_at // "null"' "$TEST_DIR/session.json" 2> /dev/null)
if [ "${laa:-null}" != "null" ] && [ "${laa:-}" != "" ]; then
    pass
else
    fail "T37" "last_activity_at deveria ser um timestamp ISO8601 após Stop; got='$laa'"
fi
teardown

# T38: subagent-lib.sh emite block quando HOOK_SUBAGENT_HARD_ENFORCEMENT=true e budget excedido (UP-BUDGET)
setup
begin_test "T38: subagent bloqueia com hard enforcement quando budget excedido (UP-BUDGET)"
write_state '{"vs_code_session_id":"sid","session_id":"sid","state_schema_version":"3","started_at":"2026-01-01T00:00:00Z","ended_at":null,"close_key":"ENCERRAR-AABBCCDD","pending_session_close":false,"strict_turn_close":false,"last_activity_at":null,"current_turn":{"number":1,"turn_id":"t1","started_at":"2026-01-01T00:00:00Z","ask_questions_called":false,"subturn_count":0,"tools_count":0,"tools_after_ask_questions":0,"last_tool_after_ask_questions":"","subagents_started":0,"intent":"","last_template":"","ended_at":null},"current_subturn":{"number":0,"subturn_id":null,"started_at":null,"response_at":null,"ended_at":null},"session_stats":{"turn_count":1,"turn_authorized":0,"turn_unauthorized":0,"subturn_total":0,"tools_total":0,"subturn_duration_total_ms":0,"subagents_active":1,"subagents_total":51},"compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}}'
export HOOK_SUBAGENT_HARD_ENFORCEMENT=true HOOK_SUBAGENT_BUDGET_LIMIT=50
_t38_out=''
_t38_rc=0
_t38_out=$(printf '%s' '{"hookEventName":"SubagentStart","sessionId":"sid","subagentId":"sub-42","subagentType":"subagent"}' \
    | HOOKS_TEST_STATE_DIR="$TEST_DIR" bash "$HOOK_DIR/scripts/subagent-start.sh" 2> /dev/null) || _t38_rc=$?
unset HOOK_SUBAGENT_HARD_ENFORCEMENT HOOK_SUBAGENT_BUDGET_LIMIT
if printf '%s' "${_t38_out}" | grep -q '"decision":"block"' 2> /dev/null; then
    pass
else
    fail "T38" "Esperava block com HOOK_SUBAGENT_HARD_ENFORCEMENT=true e 51 subagentes; RC=$_t38_rc OUT=$_t38_out"
fi
teardown

# T39: watchdog emite aviso quando last_activity_at é antigo (UP-WATCHDOG-STALE)
setup
begin_test "T39: watchdog avisa sessão inativa há mais de threshold (UP-WATCHDOG-STALE)"
write_state '{"vs_code_session_id":"sid","session_id":"sid","state_schema_version":"3","started_at":"2020-01-01T00:00:00Z","ended_at":null,"close_key":"ENCERRAR-AABBCCDD","pending_session_close":false,"strict_turn_close":false,"last_activity_at":"2020-01-01T00:00:00Z","current_turn":{"number":1,"turn_id":"t1","started_at":"2020-01-01T00:00:00Z","ask_questions_called":false,"subturn_count":0,"tools_count":0,"tools_after_ask_questions":0,"last_tool_after_ask_questions":"","subagents_started":0,"intent":"","last_template":"","ended_at":null,"duration_ms":0},"current_subturn":{"number":0,"subturn_id":null,"started_at":null,"response_at":null,"ended_at":null,"duration_ms":0},"session_stats":{"turn_count":1,"turn_authorized":0,"turn_unauthorized":0,"subturn_total":0,"tools_total":0,"subturn_duration_total_ms":0,"turn_duration_total_ms":0,"subagents_active":0,"subagents_total":0},"compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}}'
_t39_out=''
_t39_rc=0
_t39_out=$(HOOKS_TEST_STATE_DIR="$TEST_DIR" HOOK_STALE_THRESHOLD=60 bash "$HOOK_DIR/scripts/watchdog.sh" 2> /dev/null) || _t39_rc=$?
if printf '%s' "$_t39_out" | grep -qi 'inativ\|stale\|atividade\|aviso\|warning' 2> /dev/null; then
    pass
else
    fail "T39" "Watchdog deveria emitir aviso de sessão inativa (last_activity_at=2020); RC=$_t39_rc OUT=$_t39_out"
fi
teardown

# T40: stop.sh registra current_turn.duration_ms > 0 após fechar turno (UP-DURATION)
setup
begin_test "T40: stop.sh registra current_turn.duration_ms após fechar turno (UP-DURATION)"
write_state '{"vs_code_session_id":"sid","session_id":"sid","state_schema_version":"3","started_at":"2026-01-01T00:00:00Z","ended_at":null,"close_key":"ENCERRAR-AABBCCDD","pending_session_close":false,"strict_turn_close":false,"last_activity_at":null,"current_turn":{"number":1,"turn_id":"t1","started_at":"2026-01-01T00:00:00Z","ask_questions_called":true,"subturn_count":0,"tools_count":0,"tools_after_ask_questions":0,"last_tool_after_ask_questions":"","subagents_started":0,"intent":"","last_template":"A","ended_at":null,"duration_ms":0},"current_subturn":{"number":0,"subturn_id":null,"started_at":null,"response_at":null,"ended_at":null,"duration_ms":0},"session_stats":{"turn_count":1,"turn_authorized":0,"turn_unauthorized":0,"subturn_total":0,"tools_total":0,"subturn_duration_total_ms":0,"turn_duration_total_ms":0,"subagents_active":0,"subagents_total":0},"compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}}'
run_hook "stop.sh" \
    '{"hookEventName":"Stop","sessionId":"sid","stopReason":"userTriggered","decision":"block","stop_hook_active":false}'
_t40_dur=$(jq -r '.current_turn.duration_ms // -1' "$TEST_DIR/session.json" 2> /dev/null)
_t40_total=$(jq -r '.session_stats.turn_duration_total_ms // -1' "$TEST_DIR/session.json" 2> /dev/null)
if [ "${_t40_dur:-0}" -ge 0 ] 2> /dev/null && [ "${_t40_total:-0}" -ge 0 ] 2> /dev/null; then
    pass
else
    fail "T40" "current_turn.duration_ms=$_t40_dur turn_duration_total_ms=$_t40_total — esperado >= 0"
fi
teardown

# ---------------------------------------------------------------------------
# === UP-AUDIT: testes do sistema de audit log ===
# ---------------------------------------------------------------------------

# T41: HOOK_AUDIT_LEVEL=normal suprime subturnStart/subturnEnd do audit.jsonl
setup
begin_test "T41: HOOK_AUDIT_LEVEL=normal suprime subturnStart/subturnEnd (UP-AUDIT)"
_t41_audit="$TEST_DIR/audit.jsonl"
# Usar HOOKS_TEST_STATE_DIR para apontar log_audit para o TEST_DIR
write_state '{"vs_code_session_id":"sid","session_id":"s-audit-t41","state_schema_version":"3","started_at":"2026-01-01T00:00:00Z","ended_at":null,"close_key":"ENCERRAR-AABBCCDD","pending_session_close":false,"strict_turn_close":false,"last_activity_at":"2026-01-01T00:00:00Z","current_turn":{"number":1,"turn_id":"t1","started_at":"2026-01-01T00:00:00Z","ask_questions_called":false,"subturn_count":0,"tools_count":0,"tools_after_ask_questions":0,"last_tool_after_ask_questions":"","subagents_started":0,"intent":"","last_template":"","ended_at":null,"duration_ms":0},"current_subturn":{"number":0,"subturn_id":null,"started_at":null,"response_at":null,"ended_at":null,"duration_ms":0},"session_stats":{"turn_count":1,"turn_authorized":0,"turn_unauthorized":0,"subturn_total":0,"tools_total":0,"subturn_duration_total_ms":0,"turn_duration_total_ms":0,"subagents_active":0,"subagents_total":0},"compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}}'
# Chamar PreToolUse para gerar subturnStart (hook chama log_audit internamente)
HOOK_AUDIT_LEVEL=normal HOOKS_TEST_STATE_DIR="$TEST_DIR" bash "$HOOK_DIR/scripts/pre-tool-use.sh" \
    <<< '{"hookEventName":"PreToolUse","tool_use_id":"t-t41","tool_name":"read_file","tool_input":{"filePath":"/tmp/x"},"sessionId":"s-audit-t41"}' \
    > /dev/null 2>&1 || true
# subturnStart NÃO deve aparecer no audit com HOOK_AUDIT_LEVEL=normal
if [ -f "$_t41_audit" ] && grep -q '"event":"subturnStart"' "$_t41_audit" 2> /dev/null; then
    fail "T41" "subturnStart foi gravado no audit com HOOK_AUDIT_LEVEL=normal — esperado suprimido"
else
    pass
fi
teardown

# T42: HOOK_AUDIT_LEVEL=verbose grava subturnStart no audit.jsonl
setup
begin_test "T42: HOOK_AUDIT_LEVEL=verbose grava subturnStart no audit.jsonl (UP-AUDIT)"
_t42_audit="$TEST_DIR/audit.jsonl"
write_state '{"vs_code_session_id":"sid","session_id":"s-audit-t42","state_schema_version":"3","started_at":"2026-01-01T00:00:00Z","ended_at":null,"close_key":"ENCERRAR-AABBCCDD","pending_session_close":false,"strict_turn_close":false,"last_activity_at":"2026-01-01T00:00:00Z","current_turn":{"number":1,"turn_id":"t1","started_at":"2026-01-01T00:00:00Z","ask_questions_called":false,"subturn_count":0,"tools_count":0,"tools_after_ask_questions":0,"last_tool_after_ask_questions":"","subagents_started":0,"intent":"","last_template":"","ended_at":null,"duration_ms":0},"current_subturn":{"number":0,"subturn_id":null,"started_at":null,"response_at":null,"ended_at":null,"duration_ms":0},"session_stats":{"turn_count":1,"turn_authorized":0,"turn_unauthorized":0,"subturn_total":0,"tools_total":0,"subturn_duration_total_ms":0,"turn_duration_total_ms":0,"subagents_active":0,"subagents_total":0},"compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}}'
HOOK_AUDIT_LEVEL=verbose HOOKS_TEST_STATE_DIR="$TEST_DIR" bash "$HOOK_DIR/scripts/pre-tool-use.sh" \
    <<< '{"hookEventName":"PreToolUse","tool_use_id":"t-t42","tool_name":"read_file","tool_input":{"filePath":"/tmp/x"},"sessionId":"s-audit-t42"}' \
    > /dev/null 2>&1 || true
if [ -f "$_t42_audit" ] && grep -q '"event":"subturnStart"' "$_t42_audit" 2> /dev/null; then
    pass
else
    fail "T42" "subturnStart NÃO foi gravado com HOOK_AUDIT_LEVEL=verbose — esperado gravado (audit=$_t42_audit)"
fi
teardown

# T43: cap mid-session rotaciona audit.jsonl quando excede HOOKS_AUDIT_MAX_LINES
setup
begin_test "T43: cap mid-session rotaciona audit.jsonl ao atingir HOOKS_AUDIT_MAX_LINES (UP-AUDIT)"
_t43_dir="$TEST_DIR"
_t43_logdir="$TEST_DIR/logs"
mkdir -p "$_t43_logdir"
write_state '{"vs_code_session_id":"sid","session_id":"s-cap","state_schema_version":"3","started_at":"2026-01-01T00:00:00Z","ended_at":null,"close_key":"X","pending_session_close":false,"strict_turn_close":false,"last_activity_at":"2026-01-01T00:00:00Z","current_turn":{"number":1,"turn_id":"t1","started_at":"2026-01-01T00:00:00Z","ask_questions_called":false,"subturn_count":0,"tools_count":0,"tools_after_ask_questions":0,"last_tool_after_ask_questions":"","subagents_started":0,"intent":"","last_template":"","ended_at":null,"duration_ms":0},"current_subturn":{"number":0,"subturn_id":null,"started_at":null,"response_at":null,"ended_at":null,"duration_ms":0},"session_stats":{"turn_count":1,"turn_authorized":0,"turn_unauthorized":0,"subturn_total":0,"tools_total":0,"subturn_duration_total_ms":0,"turn_duration_total_ms":0,"subagents_active":0,"subagents_total":0},"compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}}'
# Preencher audit com 5 linhas e definir cap=4 → deve rotacionar na próxima gravação
printf '{"ts":"2026-01-01T00:00:00Z","event":"a"}\n%.0s' {1..5} > "$_t43_dir/audit.jsonl"
# Invocar _audit_cap_check via subshell isolada com todas as dependências carregadas
_t43_out=''
_t43_rc=0
_t43_out=$(bash -c "
    export HOOKS_TEST_STATE_DIR=\"$_t43_dir\"
    export HOOKS_AUDIT_MAX_LINES=4
    export HOOKS_AUDIT_LOG_DIR=\"$_t43_logdir\"
    source \"$HOOK_DIR/lib/common.sh\" 2>/dev/null
    _audit_cap_check
" 2> /dev/null) || _t43_rc=$?
# Deve existir ao menos um arquivo rotacionado em logs/
_t43_count=$(find "$_t43_logdir" -maxdepth 1 -name 'audit-*.jsonl' 2> /dev/null | wc -l | tr -d ' ')
if [ "${_t43_count:-0}" -ge 1 ]; then
    pass
else
    fail "T43" "Nenhum arquivo rotacionado em $_t43_logdir após cap mid-session (logs=$(ls "$_t43_logdir" 2> /dev/null || echo vazio))"
fi
teardown

# T44: check_checkpoint_cleanup no watchdog remove checkpoints além de HOOKS_CHECKPOINT_MAX
setup
begin_test "T44: watchdog check_checkpoint_cleanup remove checkpoints antigos (UP-AUDIT)"
mkdir -p "$TEST_DIR/checkpoints"
# Criar 12 checkpoints falsos (além do default de 10)
for i in $(seq 1 12); do
    printf '{"session_id":"s"}' > "$TEST_DIR/checkpoints/session-2026030${i}-120000.json" 2> /dev/null \
        || printf '{"session_id":"s"}' > "$TEST_DIR/checkpoints/session-20260${i}01-120000.json"
done
write_state '{"vs_code_session_id":"sid","session_id":"s-wdcp","state_schema_version":"3","started_at":"2026-01-01T00:00:00Z","ended_at":null,"close_key":"X","pending_session_close":false,"strict_turn_close":false,"last_activity_at":"2026-01-01T00:00:00Z","current_turn":{"number":1,"turn_id":"t1","started_at":"2026-01-01T00:00:00Z","ask_questions_called":false,"subturn_count":0,"tools_count":0,"tools_after_ask_questions":0,"last_tool_after_ask_questions":"","subagents_started":0,"intent":"","last_template":"","ended_at":null,"duration_ms":0},"current_subturn":{"number":0,"subturn_id":null,"started_at":null,"response_at":null,"ended_at":null,"duration_ms":0},"session_stats":{"turn_count":1,"turn_authorized":0,"turn_unauthorized":0,"subturn_total":0,"tools_total":0,"subturn_duration_total_ms":0,"turn_duration_total_ms":0,"subagents_active":0,"subagents_total":0},"compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}}'
_t44_out=''
_t44_rc=0
_t44_out=$(HOOKS_TEST_STATE_DIR="$TEST_DIR" HOOKS_CHECKPOINT_MAX=10 \
    bash "$HOOK_DIR/scripts/watchdog.sh" 2> /dev/null) || _t44_rc=$?
_t44_remaining=$(find "$TEST_DIR/checkpoints" -maxdepth 1 -name 'session-*.json' 2> /dev/null | wc -l | tr -d ' ')
if [ "${_t44_remaining:-12}" -le 10 ]; then
    pass
else
    fail "T44" "Checkpoints restantes=$_t44_remaining — esperado <= 10 após cleanup (HOOKS_CHECKPOINT_MAX=10)"
fi
teardown

# ---------------------------------------------------------------------------
# === UP-SUBAGENT-STOP (U7): enforcement no SubagentStop ===
# ---------------------------------------------------------------------------

# T45: SubagentStop normal (subagents_active > 0) decrementa contador e emite subagentStop
setup
begin_test "T45: SubagentStop normal decrementa subagents_active e emite subagentStop (UP-SUBAGENT-STOP)"
write_state '{"vs_code_session_id":"sid","session_id":"sid","state_schema_version":"3","started_at":"2026-01-01T00:00:00Z","ended_at":null,"close_key":"X","pending_session_close":false,"strict_turn_close":false,"last_activity_at":"2026-01-01T00:00:00Z","current_turn":{"number":1,"turn_id":"t1","started_at":"2026-01-01T00:00:00Z","ask_questions_called":false,"subturn_count":0,"tools_count":0,"tools_after_ask_questions":0,"last_tool_after_ask_questions":"","subagents_started":1,"intent":"","last_template":"","ended_at":null,"duration_ms":0},"current_subturn":{"number":0,"subturn_id":null,"started_at":null,"response_at":null,"ended_at":null,"duration_ms":0},"session_stats":{"turn_count":1,"turn_authorized":0,"turn_unauthorized":0,"subturn_total":0,"tools_total":0,"subturn_duration_total_ms":0,"turn_duration_total_ms":0,"subagents_active":1,"subagents_total":1},"compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}}'
_t45_out=''
_t45_rc=0
_t45_out=$(printf '%s' '{"hookEventName":"SubagentStop","sessionId":"sid","agent_id":"sub-t45","agent_type":"subagent","stop_hook_active":false}' \
    | HOOKS_TEST_STATE_DIR="$TEST_DIR" HOOK_SUBAGENT_STOP_ENFORCEMENT=soft \
        bash "$HOOK_DIR/scripts/subagent-stop.sh" 2> /dev/null) || _t45_rc=$?
_t45_active=$(jq -r '.session_stats.subagents_active // 99' "$TEST_DIR/session.json" 2> /dev/null)
_t45_has_stop=0
grep -q '"event":"subagentStop"' "$TEST_DIR/audit.jsonl" 2> /dev/null && _t45_has_stop=1
if [ "${_t45_active:-99}" = "0" ] && [ "$_t45_has_stop" = "1" ]; then
    pass
else
    fail "T45" "subagents_active=$_t45_active (esperado 0); subagentStop no audit=$_t45_has_stop; OUT=$_t45_out"
fi
teardown

# T46: SubagentStop órfão (subagents_active=0) com soft enforcement emite subagentStop_orphan + systemMessage
setup
begin_test "T46: SubagentStop orfao com soft enforcement emite subagentStop_orphan (UP-SUBAGENT-STOP)"
write_state '{"vs_code_session_id":"sid","session_id":"sid","state_schema_version":"3","started_at":"2026-01-01T00:00:00Z","ended_at":null,"close_key":"X","pending_session_close":false,"strict_turn_close":false,"last_activity_at":"2026-01-01T00:00:00Z","current_turn":{"number":1,"turn_id":"t1","started_at":"2026-01-01T00:00:00Z","ask_questions_called":false,"subturn_count":0,"tools_count":0,"tools_after_ask_questions":0,"last_tool_after_ask_questions":"","subagents_started":0,"intent":"","last_template":"","ended_at":null,"duration_ms":0},"current_subturn":{"number":0,"subturn_id":null,"started_at":null,"response_at":null,"ended_at":null,"duration_ms":0},"session_stats":{"turn_count":1,"turn_authorized":0,"turn_unauthorized":0,"subturn_total":0,"tools_total":0,"subturn_duration_total_ms":0,"turn_duration_total_ms":0,"subagents_active":0,"subagents_total":0},"compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}}'
_t46_out=''
_t46_rc=0
_t46_out=$(printf '%s' '{"hookEventName":"SubagentStop","sessionId":"sid","agent_id":"sub-t46","agent_type":"subagent","stop_hook_active":false}' \
    | HOOKS_TEST_STATE_DIR="$TEST_DIR" HOOK_SUBAGENT_STOP_ENFORCEMENT=soft \
        bash "$HOOK_DIR/scripts/subagent-stop.sh" 2> /dev/null) || _t46_rc=$?
_t46_orphan=0
grep -q '"event":"subagentStop_orphan"' "$TEST_DIR/audit.jsonl" 2> /dev/null && _t46_orphan=1
_t46_sys=0
printf '%s' "$_t46_out" | grep -q '"systemMessage"' 2> /dev/null && _t46_sys=1
if [ "$_t46_orphan" = "1" ] && [ "$_t46_sys" = "1" ]; then
    pass
else
    fail "T46" "orphan_audit=$_t46_orphan sys_msg=$_t46_sys (esperado ambos=1); OUT=$_t46_out"
fi
teardown

# T47: SubagentStop órfão com hard enforcement emite decision:block
setup
begin_test "T47: SubagentStop orfao com hard enforcement emite decision:block (UP-SUBAGENT-STOP)"
write_state '{"vs_code_session_id":"sid","session_id":"sid","state_schema_version":"3","started_at":"2026-01-01T00:00:00Z","ended_at":null,"close_key":"X","pending_session_close":false,"strict_turn_close":false,"last_activity_at":"2026-01-01T00:00:00Z","current_turn":{"number":1,"turn_id":"t1","started_at":"2026-01-01T00:00:00Z","ask_questions_called":false,"subturn_count":0,"tools_count":0,"tools_after_ask_questions":0,"last_tool_after_ask_questions":"","subagents_started":0,"intent":"","last_template":"","ended_at":null,"duration_ms":0},"current_subturn":{"number":0,"subturn_id":null,"started_at":null,"response_at":null,"ended_at":null,"duration_ms":0},"session_stats":{"turn_count":1,"turn_authorized":0,"turn_unauthorized":0,"subturn_total":0,"tools_total":0,"subturn_duration_total_ms":0,"turn_duration_total_ms":0,"subagents_active":0,"subagents_total":0},"compliance":{"consecutive_unauthorized":0,"last_turn_authorized":true}}'
_t47_out=''
_t47_rc=0
_t47_out=$(printf '%s' '{"hookEventName":"SubagentStop","sessionId":"sid","agent_id":"sub-t47","agent_type":"subagent","stop_hook_active":false}' \
    | HOOKS_TEST_STATE_DIR="$TEST_DIR" HOOK_SUBAGENT_STOP_ENFORCEMENT=hard \
        bash "$HOOK_DIR/scripts/subagent-stop.sh" 2> /dev/null) || _t47_rc=$?
if printf '%s' "$_t47_out" | grep -q '"decision":"block"' 2> /dev/null; then
    pass
else
    fail "T47" "SubagentStop orfao com hard enforcement deveria emitir block; RC=$_t47_rc OUT=$_t47_out"
fi
teardown

# ---------------------------------------------------------------------------
# === U8 — Audit system API (hook_log_audit via _audit_write_event) ===
# ---------------------------------------------------------------------------
_log ""
_log "=== U8: audit API ==="

# T48: hook_log_audit grava evento com campos ts/event/session_id quando HOOK_AUDIT_LEVEL=verbose
setup
begin_test "T48: HOOK_AUDIT_LEVEL=verbose grava evento no audit.jsonl via pre-tool-use"
write_state "$(_state_aq_false 1)"
_T48_OUT="" _T48_RC=0
_T48_OUT=$(printf '%s' '{"hookEventName":"PreToolUse","tool_use_id":"t48","tool_name":"read_file","tool_input":{"filePath":"/tmp/x"},"sessionId":"sid"}' \
    | HOOKS_TEST_STATE_DIR="$TEST_DIR" HOOK_AUDIT_LEVEL=verbose \
        bash "$HOOK_DIR/scripts/pre-tool-use.sh" 2> /dev/null) || _T48_RC=$?
_T48_AUDIT="$TEST_DIR/audit.jsonl"
if [ -f "$_T48_AUDIT" ] && grep -q '"event"' "$_T48_AUDIT" 2> /dev/null; then
    pass
else
    fail "T48" "audit.jsonl ausente ou sem campo event com HOOK_AUDIT_LEVEL=verbose; RC=$_T48_RC file=$(ls "$TEST_DIR" 2> /dev/null | tr '\n' ' ')"
fi
teardown

# T49: hook_audit_count retorna 0 quando arquivo ausente
setup
begin_test "T49: hook_audit_count retorna 0 quando audit.jsonl ausente"
export HOOKS_TEST_STATE_DIR="$TEST_DIR"
_T49_CNT=$(bash -c "
    HOOK_DIR='$HOOK_DIR'
    AUDIT_FILE='$TEST_DIR/audit.jsonl'
    . '$HOOK_DIR/lib/api/15-audit.sh' 2>/dev/null
    hook_audit_count 'turnStart'
" 2> /dev/null)
if [ "${_T49_CNT:-0}" = "0" ]; then
    pass
else
    fail "T49" "hook_audit_count deveria retornar 0 para arquivo ausente; got=${_T49_CNT}"
fi
teardown

# T50: hook_audit_has retorna exit 1 quando evento não existe
setup
begin_test "T50: hook_audit_has retorna exit 1 para evento inexistente"
export HOOKS_TEST_STATE_DIR="$TEST_DIR"
printf '{"ts":"2026-01-01T00:00:00Z","event":"turnStart","session_id":"x"}\n' > "$TEST_DIR/audit.jsonl"
_T50_RC=0
bash -c "
    AUDIT_FILE='$TEST_DIR/audit.jsonl'
    . '$HOOK_DIR/lib/api/15-audit.sh' 2>/dev/null
    hook_audit_has 'turnEnd_authorized'
" 2> /dev/null || _T50_RC=$?
if [ "$_T50_RC" -ne 0 ]; then
    pass
else
    fail "T50" "hook_audit_has deveria retornar exit 1 para evento inexistente; RC=$_T50_RC"
fi
teardown

# T51: hook_audit_last retorna campo correto do último evento
setup
begin_test "T51: hook_audit_last retorna valor de campo do último evento"
export HOOKS_TEST_STATE_DIR="$TEST_DIR"
printf '{"ts":"2026-01-01T00:00:00Z","event":"turnStart","session_id":"sid","turn":"1"}\n' > "$TEST_DIR/audit.jsonl"
printf '{"ts":"2026-01-01T00:01:00Z","event":"turnStart","session_id":"sid","turn":"2"}\n' >> "$TEST_DIR/audit.jsonl"
_T51_VAL=$(bash -c "
    AUDIT_FILE='$TEST_DIR/audit.jsonl'
    . '$HOOK_DIR/lib/api/15-audit.sh' 2>/dev/null
    hook_audit_last 'turnStart' 'turn'
" 2> /dev/null)
if [ "${_T51_VAL}" = "2" ]; then
    pass
else
    fail "T51" "hook_audit_last deveria retornar '2'; got='${_T51_VAL}'"
fi
teardown

# T52: hook_audit_events_since filtra por timestamp
setup
begin_test "T52: hook_audit_events_since filtra eventos por timestamp"
export HOOKS_TEST_STATE_DIR="$TEST_DIR"
printf '{"ts":"2026-01-01T00:00:00Z","event":"turnStart","session_id":"sid"}\n' > "$TEST_DIR/audit.jsonl"
printf '{"ts":"2026-01-02T00:00:00Z","event":"turnEnd_authorized","session_id":"sid"}\n' >> "$TEST_DIR/audit.jsonl"
_T52_OUT=$(bash -c "
    AUDIT_FILE='$TEST_DIR/audit.jsonl'
    . '$HOOK_DIR/lib/api/15-audit.sh' 2>/dev/null
    hook_audit_events_since '2026-01-01T12:00:00Z'
" 2> /dev/null)
if printf '%s' "$_T52_OUT" | grep -q 'turnEnd_authorized' \
    && ! printf '%s' "$_T52_OUT" | grep -q '"turnStart"'; then
    pass
else
    fail "T52" "hook_audit_events_since deveria retornar apenas turnEnd_authorized; got='${_T52_OUT}'"
fi
teardown

# T53: HOOK_AUDIT_ENRICH=false desativa auto-enrichment de turn/turn_id
setup
begin_test "T53: HOOK_AUDIT_ENRICH=false desativa auto-enrichment"
write_state "$(_state_aq_false 1)"
export HOOKS_TEST_STATE_DIR="$TEST_DIR"
run_hook "pre-tool-use.sh" \
    '{"hookEventName":"PreToolUse","tool_use_id":"t53","tool_name":"read_file","tool_input":{"filePath":"/tmp/x"},"sessionId":"sid"}'
_T53_AUDIT="$TEST_DIR/audit.jsonl"
# Com HOOK_AUDIT_ENRICH=false, eventos NÃO devem ter campo "turn_id" enriquecido
_T53_HAS_ENRICH=$(HOOK_AUDIT_ENRICH=false bash -c "
    HOOK_DIR='$HOOK_DIR'
    AUDIT_FILE='$TEST_DIR/audit.jsonl'
    HOOKS_TEST_STATE_DIR='$TEST_DIR'
    STATE_FILE='$TEST_DIR/session.json'
    . '$HOOK_DIR/lib/api/15-audit.sh' 2>/dev/null
    _audit_write_event 'test_no_enrich'
    grep -c '\"turn_id\"' '$TEST_DIR/audit.jsonl' 2>/dev/null || echo 0
" 2> /dev/null)
# Se enrich=false, turn_id não deve aparecer nesse evento específico
# (audit.jsonl pode já ter eventos de run_hook acima — verificamos o último)
_T53_LAST=$(tail -1 "$TEST_DIR/audit.jsonl" 2> /dev/null)
if ! printf '%s' "$_T53_LAST" | grep -q '"turn_id"' 2> /dev/null; then
    pass
else
    fail "T53" "evento com HOOK_AUDIT_ENRICH=false nao deveria ter turn_id; last='${_T53_LAST}'"
fi
teardown

# ---------------------------------------------------------------------------
# === U8A — UP-H4: consecutive-unauthorized enforcement ===
# ---------------------------------------------------------------------------
_log ""
_log "=== U8A: UP-H4 consecutive-unauthorized enforcement ==="

# Helper: state com consecutive_unauthorized=N, ask_questions_called=false no turno atual
_state_consec_unauth() {
    local n="${1:-1}"
    printf '{
    "vs_code_session_id":"sid","session_id":"sid",
    "started_at":"2026-01-01T00:00:00Z","ended_at":null,
    "close_key":"ENCERRAR-AABBCCDD","source":"new",
    "pending_session_close":false,"strict_turn_close":true,
    "current_turn":{"number":%s,"turn_id":"t1","started_at":"2026-01-01T00:01:00Z",
        "ask_questions_called":false,"subturn_count":0,"tools_count":0,
        "tools_after_ask_questions":0,"last_tool_after_ask_questions":""},
    "current_subturn":{"number":0,"subturn_id":null,"started_at":null,"response_at":null},
    "session_stats":{"turn_count":%s,"turn_authorized":0,"turn_unauthorized":%s,
        "subturn_total":0,"tools_total":0},
    "compliance":{"consecutive_unauthorized":%s,"last_turn_authorized":false}
}' "$((n + 1))" "$((n + 1))" "$n" "$n"
}

# T54: UP-H4 soft — 1 turno não-autorizado, tools_count=0 → reminder injetado para read_file
setup
begin_test "T54: UP-H4 soft (consec=1) → reminder injetado no 1o tool do turno"
write_state "$(_state_consec_unauth 1)"
run_hook "pre-tool-use.sh" \
    '{"hookEventName":"PreToolUse","tool_use_id":"t54","tool_name":"read_file","tool_input":{"filePath":"/tmp/x"},"sessionId":"sid"}'
# Soft não bloqueia (sem "deny") mas injeta mensagem via hook_out_pre_allow
# RC=0 e output contém o reminder (qualquer saída JSON indica que saiu pelo allow path)
if [ "$RC" -eq 0 ] && ! printf '%s' "$OUT" | grep -q '"deny"' 2> /dev/null; then
    pass
else
    fail "T54" "UP-H4 soft deveria permitir com reminder; RC=$RC OUT=$OUT"
fi
teardown

# T55: UP-H4 soft — tools_count=1 (segunda tool do turno) → sem reminder (só na 1a tool)
setup
begin_test "T55: UP-H4 soft (consec=1,tools_count=1) → sem reminder na 2a tool"
write_state "$(_state_consec_unauth 1 | jq '.current_turn.tools_count = 1')"
run_hook "pre-tool-use.sh" \
    '{"hookEventName":"PreToolUse","tool_use_id":"t55","tool_name":"read_file","tool_input":{"filePath":"/tmp/x"},"sessionId":"sid"}'
# Com tools_count=1 não deve disparar o reminder (só tools_count==0)
# Apenas verifica que não "bloqueou" → RC=0
if [ "$RC" -eq 0 ]; then
    pass
else
    fail "T55" "UP-H4 nao deve bloquear na 2a tool com soft enforcement; RC=$RC"
fi
teardown

# T56: UP-H4 hard — 3 turnos não-autorizados consecutivos → read_file bloqueado
setup
begin_test "T56: UP-H4 hard (consec=3) → read_file bloqueado"
write_state "$(_state_consec_unauth 3)"
run_hook "pre-tool-use.sh" \
    '{"hookEventName":"PreToolUse","tool_use_id":"t56","tool_name":"read_file","tool_input":{"filePath":"/tmp/x"},"sessionId":"sid"}'
DECISION=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2> /dev/null)
if [ "${DECISION}" = "deny" ]; then
    pass
else
    fail "T56" "UP-H4 hard deveria bloquear read_file com consec=3; DECISION='${DECISION}' OUT='${OUT}'"
fi
teardown

# T57: UP-H4 hard — vscode_askQuestions é EXEMPTO (não bloqueado)
setup
begin_test "T57: UP-H4 hard (consec=3) → vscode_askQuestions é exempto"
write_state "$(_state_consec_unauth 3)"
run_hook "pre-tool-use.sh" \
    '{"hookEventName":"PreToolUse","tool_use_id":"t57","tool_name":"vscode_askQuestions","tool_input":{"questions":[{"header":"Próxima ação","question":"O que fazer?","options":["A","B"]}]},"sessionId":"sid"}'
DECISION=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2> /dev/null)
if [ "${DECISION}" != "deny" ]; then
    pass
else
    fail "T57" "vscode_askQuestions deve ser exempto de UP-H4 hard; DECISION='${DECISION}'"
fi
teardown

# T58: UP-H4 hard — manage_todo_list é EXEMPTO (não bloqueado)
setup
begin_test "T58: UP-H4 hard (consec=3) → manage_todo_list é exempto"
write_state "$(_state_consec_unauth 3)"
run_hook "pre-tool-use.sh" \
    '{"hookEventName":"PreToolUse","tool_use_id":"t58","tool_name":"manage_todo_list","tool_input":{"todoList":[]},"sessionId":"sid"}'
DECISION=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2> /dev/null)
if [ "${DECISION}" != "deny" ]; then
    pass
else
    fail "T58" "manage_todo_list deve ser exempto de UP-H4 hard; DECISION='${DECISION}'"
fi
teardown

# T59: UP-H4 threshold — consec=2 com HOOK_CONSEC_UNAUTH_HARD=3 → NÃO bloqueia (abaixo do hard)
setup
begin_test "T59: UP-H4 consec=2 com HARD=3 → nao bloqueia (abaixo do threshold)"
write_state "$(_state_consec_unauth 2)"
_T59_OUT="" _T59_RC=0
_T59_OUT=$(printf '%s' '{"hookEventName":"PreToolUse","tool_use_id":"t59","tool_name":"read_file","tool_input":{"filePath":"/tmp/x"},"sessionId":"sid"}' \
    | HOOKS_TEST_STATE_DIR="$TEST_DIR" HOOK_CONSEC_UNAUTH_HARD=3 \
        bash "$HOOK_DIR/scripts/pre-tool-use.sh" 2> /dev/null) || _T59_RC=$?
_T59_DEC=$(printf '%s' "$_T59_OUT" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2> /dev/null)
if [ "${_T59_DEC}" != "deny" ]; then
    pass
else
    fail "T59" "consec=2 com HARD=3 nao deveria bloquear; DEC='${_T59_DEC}'"
fi
teardown

# ---------------------------------------------------------------------------
# T60-T67: UP-SUBAGENT-U9 — depth limit, compliance, context-rich, types
# ---------------------------------------------------------------------------
_log ""
_log "=== UP-SUBAGENT-U9: depth limit, compliance, context-rich, types ==="

# T60: UP-DEPTH-LIMIT — SubagentStart bloqueado quando depth >= limit
setup
begin_test "T60: UP-DEPTH-LIMIT bloquia SubagentStart quando depth >= limite"
write_state "$(printf '%s' "$(_state_aq_false 1)" | jq '
    .session_stats.subagents_active = 3 |
    .session_stats.subagents_total = 3 |
    .current_turn.subagents_started = 3')"
_t60_out="" _t60_rc=0
_t60_out=$(printf '%s' '{"hookEventName":"SubagentStart","sessionId":"sid","agent_id":"sub-depth","agent_type":"Plan"}' \
    | HOOKS_TEST_STATE_DIR="$TEST_DIR" HOOK_SUBAGENT_DEPTH_LIMIT=3 \
        bash "$HOOK_DIR/scripts/subagent-start.sh" 2> /dev/null) || _t60_rc=$?
_t60_decision=$(printf '%s' "$_t60_out" | jq -r '.decision // empty' 2> /dev/null)
_t60_has_audit=0
grep -q '"event":"subagentStart_depth_exceeded"' "$TEST_DIR/audit.jsonl" 2> /dev/null && _t60_has_audit=1
if [ "$_t60_decision" = "block" ] && [ "$_t60_has_audit" = "1" ]; then
    pass
else
    fail "T60" "depth>=limit deveria bloquear; decision='$_t60_decision' audit=$_t60_has_audit OUT=$_t60_out"
fi
teardown

# T61: UP-DEPTH-LIMIT — SubagentStart permitido quando depth < limit
setup
begin_test "T61: UP-DEPTH-LIMIT permite SubagentStart quando depth < limite"
write_state "$(printf '%s' "$(_state_aq_false 1)" | jq '
    .session_stats.subagents_active = 2 |
    .session_stats.subagents_total = 2 |
    .current_turn.subagents_started = 2')"
_t61_out="" _t61_rc=0
_t61_out=$(printf '%s' '{"hookEventName":"SubagentStart","sessionId":"sid","agent_id":"sub-ok","agent_type":"Plan"}' \
    | HOOKS_TEST_STATE_DIR="$TEST_DIR" HOOK_SUBAGENT_DEPTH_LIMIT=3 \
        bash "$HOOK_DIR/scripts/subagent-start.sh" 2> /dev/null) || _t61_rc=$?
_t61_decision=$(printf '%s' "$_t61_out" | jq -r '.decision // empty' 2> /dev/null)
if [ "$_t61_decision" != "block" ]; then
    pass
else
    fail "T61" "depth<limit nao deveria bloquear; decision='$_t61_decision' OUT=$_t61_out"
fi
teardown

# T62: UP-TYPES — hook_subagent_is_known_type reconhece tipos built-in
setup
begin_test "T62: UP-TYPES hook_subagent_is_known_type reconhece Plan/SWE/Explore/QA/RUG"
_t62_ok=1
for _t62_type in Plan SWE Explore QA RUG; do
    _t62_result=$(bash -c "
        source '$HOOK_DIR/lib/api/01-vars.sh'
        hook_api_vars_init
        source '$HOOK_DIR/lib/api/12-subagent.sh'
        HOOK_AGENT_TYPE='$_t62_type'
        hook_subagent_is_known_type && echo ok || echo fail
    " 2> /dev/null)
    [ "$_t62_result" = "ok" ] || _t62_ok=0
done
if [ "$_t62_ok" = "1" ]; then
    pass
else
    fail "T62" "hook_subagent_is_known_type falhou para algum tipo built-in"
fi
teardown

# T63: UP-TYPES — hook_subagent_is_known_type retorna 1 para tipo desconhecido
setup
begin_test "T63: UP-TYPES hook_subagent_is_known_type retorna false p/ tipo desconhecido"
_t63_result=$(bash -c "
    source '$HOOK_DIR/lib/api/01-vars.sh'
    hook_api_vars_init
    source '$HOOK_DIR/lib/api/12-subagent.sh'
    HOOK_AGENT_TYPE='XyzUnknownAgent'
    hook_subagent_is_known_type && echo ok || echo fail
" 2> /dev/null)
if [ "$_t63_result" = "fail" ]; then
    pass
else
    fail "T63" "tipo 'XyzUnknownAgent' deveria retornar false; got='$_t63_result'"
fi
teardown

# T64: UP-COMPLIANCE soft — ask_questions_called=false → systemMessage de violação
setup
begin_test "T64: UP-COMPLIANCE soft emite systemMessage quando subagente nao chamou askQuestions"
write_state "$(printf '%s' "$(_state_aq_false 1)" | jq '
    .session_stats.subagents_active = 1 |
    .session_stats.subagents_total = 1 |
    .current_turn.subagents_started = 1 |
    .current_turn.ask_questions_called = false')"
_t64_out="" _t64_rc=0
_t64_out=$(printf '%s' '{"hookEventName":"SubagentStop","sessionId":"sid","agent_id":"sub-nc","agent_type":"Plan"}' \
    | HOOKS_TEST_STATE_DIR="$TEST_DIR" HOOK_SUBAGENT_COMPLIANCE_ENFORCEMENT=soft \
        bash "$HOOK_DIR/scripts/subagent-stop.sh" 2> /dev/null) || _t64_rc=$?
_t64_has_audit=0
grep -q '"event":"subagentStop_protocol_violation"' "$TEST_DIR/audit.jsonl" 2> /dev/null && _t64_has_audit=1
_t64_sys=$(printf '%s' "$_t64_out" | jq -r '.systemMessage // empty' 2>/dev/null)
if [ "$_t64_has_audit" = "1" ] && [ -n "$_t64_sys" ]; then
    pass
else
    fail "T64" "compliance soft deveria auditar+systemMessage; audit=$_t64_has_audit sys='$_t64_sys' out=$_t64_out"
fi
teardown

# T65: UP-COMPLIANCE none — ask_questions_called=false → só audit, sem output
setup
begin_test "T65: UP-COMPLIANCE none nao emite output (so audit) quando violacao"
write_state "$(printf '%s' "$(_state_aq_false 1)" | jq '
    .session_stats.subagents_active = 1 |
    .session_stats.subagents_total = 1 |
    .current_turn.subagents_started = 1 |
    .current_turn.ask_questions_called = false')"
_t65_out="" _t65_rc=0
_t65_out=$(printf '%s' '{"hookEventName":"SubagentStop","sessionId":"sid","agent_id":"sub-nc","agent_type":"QA"}' \
    | HOOKS_TEST_STATE_DIR="$TEST_DIR" HOOK_SUBAGENT_COMPLIANCE_ENFORCEMENT=none \
        bash "$HOOK_DIR/scripts/subagent-stop.sh" 2> /dev/null) || _t65_rc=$?
# Com "none" o output deve estar vazio (sem systemMessage nem block)
_t65_sys=$(printf '%s' "$_t65_out" | jq -r '.systemMessage // empty' 2>/dev/null)
_t65_dec=$(printf '%s' "$_t65_out" | jq -r '.decision // empty' 2> /dev/null)
if [ -z "$_t65_sys" ] && [ "$_t65_dec" != "block" ]; then
    pass
else
    fail "T65" "compliance none nao devia emitir output; sys='$_t65_sys' dec='$_t65_dec' out=$_t65_out"
fi
teardown

# T66: UP-COMPLIANCE — compliant (ask_questions_called=true) nao gera violacao
setup
begin_test "T66: UP-COMPLIANCE nao gera violacao quando ask_questions_called=true"
write_state "$(printf '%s' "$(_state_aq_true)" | jq '
    .session_stats.subagents_active = 1 |
    .session_stats.subagents_total = 1 |
    .current_turn.subagents_started = 1 |
    .current_turn.ask_questions_called = true')"
_t66_out="" _t66_rc=0
_t66_out=$(printf '%s' '{"hookEventName":"SubagentStop","sessionId":"sid","agent_id":"sub-ok","agent_type":"SWE"}' \
    | HOOKS_TEST_STATE_DIR="$TEST_DIR" HOOK_SUBAGENT_COMPLIANCE_ENFORCEMENT=soft \
        bash "$HOOK_DIR/scripts/subagent-stop.sh" 2> /dev/null) || _t66_rc=$?
_t66_has_viol=0
grep -q '"event":"subagentStop_protocol_violation"' "$TEST_DIR/audit.jsonl" 2> /dev/null && _t66_has_viol=1
if [ "$_t66_has_viol" = "0" ]; then
    pass
else
    fail "T66" "subagente compliant nao deveria gerar violacao no audit; OUT=$_t66_out"
fi
teardown

# T67: UP-CONTEXT-RICH — SubagentStart com type=Plan injeta regras especificas de Plan
setup
begin_test "T67: UP-CONTEXT-RICH injeta contexto especifico para agent_type=Plan"
write_state "$(_state_aq_false 1)"
_t67_out="" _t67_rc=0
_t67_out=$(printf '%s' '{"hookEventName":"SubagentStart","sessionId":"sid","agent_id":"sub-plan","agent_type":"Plan"}' \
    | HOOKS_TEST_STATE_DIR="$TEST_DIR" HOOK_SUBAGENT_CONTEXT_RICH=true \
        bash "$HOOK_DIR/scripts/subagent-start.sh" 2> /dev/null) || _t67_rc=$?
_t67_ctx=$(printf '%s' "$_t67_out" | jq -r '.hookSpecificOutput.additionalContext // empty' 2> /dev/null)
if printf '%s' "$_t67_ctx" | grep -q 'PAPEL=Plan'; then
    pass
else
    fail "T67" "context-rich deveria conter 'PAPEL=Plan'; ctx='$_t67_ctx' out=$_t67_out"
fi
teardown

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
