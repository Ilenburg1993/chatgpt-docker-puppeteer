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
