#!/bin/bash
# smoke-test.sh — Verifica a integridade estrutural de todos os hooks
#
# Testa sem modifcar estado real de produção:
#   - Dependências instaladas (jq, sponge, date)
#   - Todos os scripts de hook existem e são executáveis
#   - Schema canônico está correto (session-context.json)
#   - Chamadas de script não crasham com inputs mínimos
#
# Uso: bash smoke-test.sh [--quiet]
# Saída: PASS/FAIL por teste; exit code = número de falhas
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS_DIR="$HOOK_DIR/scripts"
STATE_DIR="$HOOK_DIR/state"
LOG_DIR="$HOOK_DIR/logs"
CTX_FILE="$STATE_DIR/session-context.json"
QUIET="${1:-}"

PASS=0
FAIL=0

# ── Helpers ──────────────────────────────────────────────────────────────────
pass() {
    PASS=$((PASS + 1))
    [ "$QUIET" = "--quiet" ] || echo "  ✓ $1"
}
fail() {
    FAIL=$((FAIL + 1))
    echo "  ✗ $1"
}

banner() {
    echo ""
    echo "══════════════════════════════════════════════════"
    echo "  Smoke Test — Copilot Hooks"
    echo "══════════════════════════════════════════════════"
}

[ "$QUIET" = "--quiet" ] || banner

# ── 1. Dependências obrigatórias ─────────────────────────────────────────────
echo ""
echo "1. Dependências"
for cmd in jq sponge date sha256sum wc; do
    if command -v "$cmd" &> /dev/null; then
        pass "comando '$cmd' disponível"
    else
        fail "comando '$cmd' NÃO encontrado — hooks podem falhar"
    fi
done

# ── 2. Scripts de hook existem e são executáveis ─────────────────────────────
echo ""
echo "2. Scripts de hook"
REQUIRED_SCRIPTS=(
    "session-start.sh"
    "log-prompt.sh"
    "pre-tool-use.sh"
    "post-tool-use.sh"
    "agent-stop.sh"
    "subagent-stop.sh"
    "error-occurred.sh"
    "session-end.sh"
    "start-section.sh"
    "section-end.sh"
    "session-checkpoint.sh"
    "generate-session-summary.sh"
    "add-task.sh"
    "complete-task.sh"
    "save-finding.sh"
    "smoke-test.sh"
)
for s in "${REQUIRED_SCRIPTS[@]}"; do
    f="$SCRIPTS_DIR/$s"
    if [ ! -f "$f" ]; then
        fail "$s — arquivo não encontrado"
    elif [ ! -x "$f" ]; then
        fail "$s — não é executável (chmod +x necessário)"
    else
        pass "$s — presente e executável"
    fi
done

# ── 3. copilot-hooks.json existe e é JSON válido ─────────────────────────────
echo ""
echo "3. copilot-hooks.json"
HOOKS_JSON="$HOOK_DIR/copilot-hooks.json"
if [ ! -f "$HOOKS_JSON" ]; then
    fail "copilot-hooks.json não encontrado"
elif ! jq empty "$HOOKS_JSON" 2> /dev/null; then
    fail "copilot-hooks.json é JSON inválido"
else
    HOOK_COUNT="$(jq '.hooks | length' "$HOOKS_JSON" 2> /dev/null || echo 0)"
    pass "copilot-hooks.json válido — $HOOK_COUNT hooks registrados"
fi

# ── 4. Diretórios de estado e logs existem ───────────────────────────────────
echo ""
echo "4. Diretórios"
for d in "$STATE_DIR" "$LOG_DIR"; do
    if [ -d "$d" ]; then
        pass "$(basename "$d")/ existe"
    else
        fail "$(basename "$d")/ não existe — será criado no primeiro uso"
    fi
done

# ── 5. session-context.json — schema canônico mínimo ────────────────────────
echo ""
echo "5. Schema session-context.json"
if [ ! -f "$CTX_FILE" ]; then
    fail "session-context.json não encontrado (nenhuma sessão ativa)"
else
    # check_key <jq_parent_expr> <field_name>
    # Usa has() para verificar presença da chave, mesmo quando o valor é null.
    # null é um valor válido (ex: .session.ended_at durante sessão ativa).
    check_key() {
        local parent="$1" key="$2"
        if [ "$parent" = "." ]; then
            jq -e "has(\"$key\")" "$CTX_FILE" > /dev/null 2>&1
        else
            jq -e "if ($parent | type) == \"object\" then ($parent | has(\"$key\")) else false end" \
                "$CTX_FILE" > /dev/null 2>&1
        fi
    }

    check_key ".session" "id" && pass ".session.id" || fail ".session.id ausente"
    check_key ".session" "started_at" && pass ".session.started_at" || fail ".session.started_at ausente"
    check_key ".session" "ended_at" && pass ".session.ended_at" || fail ".session.ended_at ausente"
    check_key ".session" "end_reason" && pass ".session.end_reason" || fail ".session.end_reason ausente"
    check_key ".session" "close_key" && pass ".session.close_key (Schema v3)" || fail ".session.close_key ausente — Schema v3 não inicializado"
    check_key ".session" "close_key_validated" && pass ".session.close_key_validated (Schema v3)" || fail ".session.close_key_validated ausente — Schema v3 não inicializado"
    check_key ".session_stats" "turn_count" && pass ".session_stats.turn_count" || fail ".session_stats.turn_count ausente"
    check_key ".session_stats" "failures_detected" && pass ".session_stats.failures_detected" || fail ".session_stats.failures_detected ausente"
    check_key ".current_turn" "number" && pass ".current_turn.number" || fail ".current_turn.number ausente"
    check_key ".current_turn" "auth_requested" && pass ".current_turn.auth_requested" || fail ".current_turn.auth_requested ausente"
    check_key ".current_turn" "last_askquestions_response" && pass ".current_turn.last_askquestions_response (Schema v3)" || fail ".current_turn.last_askquestions_response ausente — Schema v3 não inicializado"
    check_key ".current_section" "name" && pass ".current_section.name" || fail ".current_section.name ausente"
    check_key ".compliance" "consecutive_unauthorized" && pass ".compliance.consecutive_unauthorized" || fail ".compliance.consecutive_unauthorized ausente"
    check_key "." "quality_gates" && pass ".quality_gates" || fail ".quality_gates ausente"
    check_key "." "session_summary" && pass ".session_summary" || fail ".session_summary ausente"
    check_key "." "last_turn_ts" && pass ".last_turn_ts" || fail ".last_turn_ts ausente"

    # Verifica formato da close_key (deve ser ENCERRAR-XXXXXXXX)
    CLOSE_KEY_VAL="$(jq -r '.session.close_key // ""' "$CTX_FILE" 2>/dev/null || echo '')"
    if echo "$CLOSE_KEY_VAL" | grep -qE '^ENCERRAR-[0-9A-F]{8}$'; then
        pass ".session.close_key formato válido: $CLOSE_KEY_VAL"
    elif [ -z "$CLOSE_KEY_VAL" ]; then
        fail ".session.close_key está vazio — sessão pode não ter sido reiniciada após Schema v3"
    else
        fail ".session.close_key formato inválido: '$CLOSE_KEY_VAL' (esperado ENCERRAR-XXXXXXXX)"
    fi
fi

# ── 6. Teste funcional: section-end.sh sem seção ativa não crasha ────────────
echo ""
echo "6. Testes funcionais (dry-run)"
if bash "$SCRIPTS_DIR/section-end.sh" "smoke-test" 2> /dev/null; then
    pass "section-end.sh sem seção ativa — encerra sem crash"
else
    fail "section-end.sh sem seção ativa — crashou inesperadamente"
fi

# ── 7. shellcheck nos scripts principais (se disponível) ─────────────────────
echo ""
echo "7. shellcheck (se disponível)"
if ! command -v shellcheck &> /dev/null; then
    [ "$QUIET" = "--quiet" ] || echo "  - shellcheck não instalado — pulando"
else
    SHELLCHECK_FAILS=0
    for s in session-start.sh agent-stop.sh session-end.sh post-tool-use.sh pre-tool-use.sh; do
        f="$SCRIPTS_DIR/$s"
        [ -f "$f" ] || continue
        if shellcheck -S warning "$f" &> /dev/null; then
            pass "shellcheck OK: $s"
        else
            fail "shellcheck encontrou problemas: $s"
            SHELLCHECK_FAILS=$((SHELLCHECK_FAILS + 1))
        fi
    done
fi

# ── Resumo ───────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════"
TOTAL=$((PASS + FAIL))
echo "  Total: $TOTAL  |  ✓ $PASS  |  ✗ $FAIL"
if [ "$FAIL" -eq 0 ]; then
    echo "  STATUS: PASS — todos os hooks operacionais"
else
    echo "  STATUS: FAIL — $FAIL problema(s) detectado(s)"
fi
echo "══════════════════════════════════════════════════"
echo ""

exit "$FAIL"
