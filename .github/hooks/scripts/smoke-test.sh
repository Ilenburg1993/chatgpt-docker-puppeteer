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
    "subagent-start.sh"
    "error-occurred.sh"
    "tool-use-failure.sh"
    "pre-compact.sh"
    "session-end.sh"
    "start-section.sh"
    "section-end.sh"
    "start-turn.sh"
    "session-checkpoint.sh"
    "generate-session-summary.sh"
    "manual-session-init.sh"
    "watchdog.sh"
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

    # Schema v4 — SESSION/SECTION/TURN canônico
    check_key ".session_stats" "section_count" && pass ".session_stats.section_count (Schema v4)" || fail ".session_stats.section_count ausente — Schema v4 não inicializado"
    check_key ".session_stats" "section_names" && pass ".session_stats.section_names[] (Schema v4)" || fail ".session_stats.section_names ausente — Schema v4 não inicializado"
    check_key ".current_section" "section_number" && pass ".current_section.section_number (Schema v4)" || fail ".current_section.section_number ausente — Schema v4 não inicializado"
    check_key ".current_turn" "section_name" && pass ".current_turn.section_name (Schema v4)" || fail ".current_turn.section_name ausente — Schema v4 não inicializado"

    # Verifica invariante: current_section.name não deve ser null nem vazio
    ACTIVE_SECTION_NAME="$(jq -r '.current_section.name // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    if [ -n "$ACTIVE_SECTION_NAME" ] && [ "$ACTIVE_SECTION_NAME" != "null" ]; then
        pass ".current_section.name não-nulo: '$ACTIVE_SECTION_NAME' (invariante SECTION ativa)"
    else
        fail ".current_section.name é null/vazio — invariante violado: sempre deve haver uma SECTION ativa"
    fi

    # Verifica que section_names é um array com pelo menos 1 entry
    SECTION_NAMES_LEN="$(jq '.session_stats.section_names | if type == "array" then length else -1 end' "$CTX_FILE" 2> /dev/null || echo -1)"
    if [ "$SECTION_NAMES_LEN" -ge 1 ] 2> /dev/null; then
        pass ".session_stats.section_names array com $SECTION_NAMES_LEN entry(ies) (Schema v4)"
    else
        fail ".session_stats.section_names não é array ou está vazio — Schema v4 não inicializado"
    fi

    check_key ".compliance" "consecutive_unauthorized" && pass ".compliance.consecutive_unauthorized" || fail ".compliance.consecutive_unauthorized ausente"
    check_key "." "quality_gates" && pass ".quality_gates" || fail ".quality_gates ausente"
    check_key "." "session_summary" && pass ".session_summary" || fail ".session_summary ausente"
    check_key "." "last_turn_ts" && pass ".last_turn_ts" || fail ".last_turn_ts ausente"

    # Verifica formato da close_key (deve ser ENCERRAR-XXXXXXXX)
    CLOSE_KEY_VAL="$(jq -r '.session.close_key // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    if echo "$CLOSE_KEY_VAL" | grep -qE '^ENCERRAR-[0-9A-F]{8}$'; then
        pass ".session.close_key formato válido: $CLOSE_KEY_VAL"
    elif [ -z "$CLOSE_KEY_VAL" ]; then
        fail ".session.close_key está vazio — sessão pode não ter sido reiniciada após Schema v3"
    else
        fail ".session.close_key formato inválido: '$CLOSE_KEY_VAL' (esperado ENCERRAR-XXXXXXXX)"
    fi
fi

# ── 6. Teste funcional: section-end.sh sem seção ativa não crasha ────────────
# HARDENING: usa sandbox isolado para não contaminar estado real.
# Os scripts resolvem HOOK_DIR via dirname($BASH_SOURCE) — ao copiar scripts para
# um diretório temporário, HOOK_DIR aponta para o sandbox automaticamente.
echo ""
echo "6. Testes funcionais (dry-run, sandbox isolado)"

SANDBOX="$(mktemp -d)"
SANDBOX_SCRIPTS="$SANDBOX/scripts"
SANDBOX_STATE="$SANDBOX/state"
SANDBOX_LOGS="$SANDBOX/logs"
mkdir -p "$SANDBOX_SCRIPTS" "$SANDBOX_STATE" "$SANDBOX_LOGS"

# Copia scripts para sandbox (HOOK_DIR será resolvido como $SANDBOX)
cp -a "$SCRIPTS_DIR"/*.sh "$SANDBOX_SCRIPTS/" 2> /dev/null || true

# Seed: session-context.json mínimo para Schema v4
jq -cn '{
    session: {
        id: "smoke-sandbox-001",
        started_at: (now | strftime("%Y-%m-%dT%H:%M:%SZ")),
        ended_at: null,
        end_reason: null,
        close_key: "ENCERRAR-00000000",
        close_key_validated: false
    },
    session_stats: {
        turn_count: 0, tools_total: 0, failures_detected: 0,
        turn_authorized: 0, turn_unauthorized: 0,
        section_count: 1, section_names: ["smoke-test"]
    },
    current_turn: {
        number: 0, started_at: null, tools_count: 0,
        auth_requested: false, auth_requested_at: null,
        last_askquestions_response: null, section_name: "smoke-test",
        block_count: 0
    },
    current_section: {
        name: null, section_number: 0, started_at: null, turn_count: 0
    },
    compliance: {
        last_turn_authorized: true, consecutive_unauthorized: 0,
        flag_file_exists: false
    },
    quality_gates: {lint: null, typecheck: null, test: null, format: null},
    session_summary: "",
    last_turn_ts: null,
    tasks: [], findings: []
}' > "$SANDBOX_STATE/session-context.json"

# Executa section-end.sh no sandbox
if bash "$SANDBOX_SCRIPTS/section-end.sh" "smoke-test" 2> /dev/null; then
    pass "section-end.sh (sandbox) sem seção ativa — encerra sem crash"
else
    fail "section-end.sh (sandbox) sem seção ativa — crashou inesperadamente"
fi

# Verifica que estado REAL não foi modificado
if [ -f "$CTX_FILE" ]; then
    REAL_SID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    if [ "$REAL_SID" != "smoke-sandbox-001" ]; then
        pass "sandbox isolado — session-context.json real não contaminado"
    else
        fail "sandbox VAZOU para session-context.json real — isolamento falhou"
    fi
fi

# Cleanup sandbox
rm -rf "$SANDBOX"

# ── 7. shellcheck nos scripts principais (se disponível) ─────────────────────
echo ""
echo "7. shellcheck (se disponível)"
if ! command -v shellcheck &> /dev/null; then
    [ "$QUIET" = "--quiet" ] || echo "  - shellcheck não instalado — pulando"
else
    SHELLCHECK_FAILS=0
    for s in session-start.sh agent-stop.sh session-end.sh post-tool-use.sh pre-tool-use.sh \
        subagent-stop.sh subagent-start.sh tool-use-failure.sh pre-compact.sh \
        watchdog.sh generate-daily-report.sh install-git-hooks.sh; do
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

# ── 8. Cobertura de session_id guards (Hardening v5) ─────────────────────────
echo ""
echo "8. session_id guards (Hardening v5)"
# Scripts que DEVEM ter session_id guard (hooks auto-triggered que modificam estado)
GUARD_REQUIRED=(agent-stop.sh pre-tool-use.sh post-tool-use.sh log-prompt.sh error-occurred.sh subagent-stop.sh subagent-start.sh tool-use-failure.sh pre-compact.sh)
# Scripts que NÃO devem ter guard (criador de session_id / encerramento legítimo)
GUARD_EXCLUDED=(session-start.sh session-end.sh)

for s in "${GUARD_REQUIRED[@]}"; do
    f="$SCRIPTS_DIR/$s"
    if [ -f "$f" ] && rg -q "session_id_mismatch" "$f" 2> /dev/null; then
        pass "session_id guard presente: $s"
    elif [ -f "$f" ]; then
        fail "session_id guard AUSENTE: $s — vulnerável a contaminação cruzada"
    fi
done

for s in "${GUARD_EXCLUDED[@]}"; do
    f="$SCRIPTS_DIR/$s"
    if [ -f "$f" ] && ! rg -q "session_id_mismatch" "$f" 2> /dev/null; then
        pass "session_id guard ausente (correto): $s"
    elif [ -f "$f" ]; then
        fail "session_id guard encontrado onde não deveria: $s"
    fi
done

# ── 9. Watchdog (F2.1) ────────────────────────────────────────────────────────
echo ""
echo "9. Watchdog (F2.1)"
WATCHDOG_SCRIPT="$SCRIPTS_DIR/watchdog.sh"
WATCHDOG_REPORT="$STATE_DIR/watchdog-report.json"
if [ ! -f "$WATCHDOG_SCRIPT" ]; then
    fail "watchdog.sh não encontrado"
elif ! bash "$WATCHDOG_SCRIPT" --quiet 2> /dev/null; then
    fail "watchdog.sh falhou ao executar"
else
    pass "watchdog.sh executa sem erros"
fi
if [ -f "$WATCHDOG_REPORT" ] && jq empty "$WATCHDOG_REPORT" 2> /dev/null; then
    WD_STATUS="$(jq -r '.status // "unknown"' "$WATCHDOG_REPORT" 2> /dev/null || echo 'unknown')"
    WD_CRITICAL="$(jq -r '.summary.critical // 0' "$WATCHDOG_REPORT" 2> /dev/null || echo 0)"
    WD_WARN="$(jq -r '.summary.warnings // 0' "$WATCHDOG_REPORT" 2> /dev/null || echo 0)"
    pass "watchdog-report.json válido — status=$WD_STATUS, critical=$WD_CRITICAL, warnings=$WD_WARN"
else
    fail "watchdog-report.json não gerado ou inválido"
fi

# ── 10. Instruções de hooks (applyTo: **/*) ────────────────────────────────────
echo ""
echo "10. Instructions — hooks-protocol"
HOOKS_INSTR="$HOOK_DIR/../../.github/instructions/hooks-protocol.instructions.md"
if [ -f "$HOOKS_INSTR" ]; then
    if grep -q 'applyTo.*\*\*/\*' "$HOOKS_INSTR" 2> /dev/null; then
        pass "hooks-protocol.instructions.md existe com applyTo: '**/*'"
    else
        fail "hooks-protocol.instructions.md existe mas sem applyTo: '**/*'"
    fi
else
    fail "hooks-protocol.instructions.md não encontrado"
fi

# ── 11. start-turn.sh — campo intent_declared ──────────────────────────────────
echo ""
echo "11. start-turn.sh — intent_declared"
if grep -q 'intent_declared' "$SCRIPTS_DIR/start-turn.sh" 2> /dev/null; then
    pass "start-turn.sh define intent_declared no session-context.json"
else
    fail "start-turn.sh não define intent_declared"
fi
if grep -q 'intent_declared' "$SCRIPTS_DIR/log-prompt.sh" 2> /dev/null; then
    pass "log-prompt.sh reseta intent_declared no início do turno"
else
    fail "log-prompt.sh não reseta intent_declared"
fi

# ── 12. agent-stop.sh — invariante + auto-enrich ───────────────────────────────
echo ""
echo "12. agent-stop.sh — invariante e feedback"
if grep -q 'turnStart_enriched_auto' "$SCRIPTS_DIR/agent-stop.sh" 2> /dev/null; then
    pass "agent-stop.sh gera turnStart_enriched_auto para turnos sem intenção declarada"
else
    fail "agent-stop.sh não tem auto-enrich de intenção"
fi
if grep -q '"retomada"' "$SCRIPTS_DIR/agent-stop.sh" 2> /dev/null; then
    pass "agent-stop.sh auto-cria seção 'retomada' para garantir invariante"
else
    fail "agent-stop.sh não implementa invariante SESSION+SECTION+TURN"
fi
if grep -q '_RICH_SECTION' "$SCRIPTS_DIR/agent-stop.sh" 2> /dev/null; then
    pass "agent-stop.sh emite systemMessage rico com estado contextualizado"
else
    fail "agent-stop.sh usa systemMessage genérico (não contextualizado)"
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
