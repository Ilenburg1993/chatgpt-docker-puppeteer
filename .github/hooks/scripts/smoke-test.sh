#!/bin/bash
# smoke-test.sh — Verifica a integridade estrutural de todos os hooks
#
# Testa sem modifcar estado real de produção:
#   - Dependências instaladas (jq, sponge, date)
#   - Todos os scripts de hook existem e são executáveis
#   - Schema canônico está correto (session-context.json)
#   - Chamadas de script não crasham com inputs mínimos
#
# Uso: bash smoke-test.sh [--quiet] [--domains|--all]
# Saída: PASS/FAIL por teste; exit code = número de falhas
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS_DIR="$HOOK_DIR/scripts"
STATE_DIR="$HOOK_DIR/state"
LOG_DIR="$HOOK_DIR/logs"
CTX_FILE="$STATE_DIR/session-context.json"
ROLLOUT_METRICS_FILE="$STATE_DIR/smoke-rollout-metrics.json"

AGENT_STOP_LIB="$HOOK_DIR/hooks-lib/agent-stop-lib.sh"
PRE_TOOL_USE_LIB="$HOOK_DIR/hooks-lib/policy/pre-tool-use-lib.sh"
POST_TOOL_USE_LIB="$HOOK_DIR/hooks-lib/policy/post-tool-use-lib.sh"
LOG_PROMPT_LIB="$HOOK_DIR/hooks-lib/lifecycle/log-prompt-lib.sh"
SESSION_START_LIB="$HOOK_DIR/hooks-lib/lifecycle/session-start-lib.sh"
SESSION_START_RUNTIME_LIB="$HOOK_DIR/hooks-lib/lifecycle/session-start-runtime.sh"
SESSION_START_EVENTS_LIB="$HOOK_DIR/hooks-lib/lifecycle/session-start-events.sh"
SESSION_START_VIOLATIONS_LIB="$HOOK_DIR/hooks-lib/lifecycle/session-start-violations.sh"
SESSION_END_LIB="$HOOK_DIR/hooks-lib/lifecycle/session-end-lib.sh"
SUBAGENT_START_LIB="$HOOK_DIR/hooks-lib/lifecycle/subagent-start-lib.sh"
SUBAGENT_STOP_LIB="$HOOK_DIR/hooks-lib/lifecycle/subagent-stop-lib.sh"
PRE_COMPACT_LIB="$HOOK_DIR/hooks-lib/lifecycle/pre-compact-lib.sh"
ERROR_OCCURRED_LIB="$HOOK_DIR/hooks-lib/audit/error-occurred-lib.sh"
COMMON_LIB="$HOOK_DIR/hooks-lib/common.sh"

# shellcheck disable=SC1091
if [ -f "$HOOK_DIR/hooks-lib/config.sh" ]; then
    source "$HOOK_DIR/hooks-lib/config.sh" 2> /dev/null || true
fi

QUIET=""
SMOKE_MODE="legacy"
SMOKE_DOMAINS_FLAG="${HOOKS_FF_SMOKE_DOMAINS:-shadow}"

for arg in "$@"; do
    case "$arg" in
        --quiet)
            QUIET="--quiet"
            ;;
        --domains)
            SMOKE_MODE="domains"
            ;;
        --all)
            SMOKE_MODE="all"
            ;;
    esac
done

if [ "$SMOKE_DOMAINS_FLAG" != "off" ] && [ "$SMOKE_DOMAINS_FLAG" != "shadow" ] && [ "$SMOKE_DOMAINS_FLAG" != "on" ]; then
    SMOKE_DOMAINS_FLAG="shadow"
fi

if [ "$SMOKE_MODE" = "domains" ]; then
    if [ "$SMOKE_DOMAINS_FLAG" = "off" ]; then
        echo "[smoke-domains] rollout desativado por HOOKS_FF_SMOKE_DOMAINS=off"
        exit 0
    fi
    exec bash "$SCRIPTS_DIR/smoke-test-domains.sh" "$QUIET"
fi

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

contains_pattern_in_files() {
    local pattern="$1"
    shift || true

    local file
    for file in "$@"; do
        [ -f "$file" ] || continue
        if grep -qE "$pattern" "$file" 2> /dev/null; then
            return 0
        fi
    done

    return 1
}

count_pattern_in_files() {
    local pattern="$1"
    shift || true

    local file count total=0
    for file in "$@"; do
        [ -f "$file" ] || continue
        count="$(grep -cE "$pattern" "$file" 2> /dev/null || echo 0)"
        count="${count:-0}"
        total=$((total + count))
    done

    printf '%s\n' "$total"
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
    "verify-hook-delivery.sh"
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
        turn_authorized: 0, turn_no_askQuestions: 0,
        turns_since_askQuestions: 0,
        section_count: 1, section_names: ["smoke-test"]
    },
    current_turn: {
        number: 0, started_at: null, tools_count: 0,
        auth_requested: false, auth_requested_at: null,
        last_askquestions_response: null, section_name: "smoke-test"
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
        watchdog.sh generate-daily-report.sh install-git-hooks.sh \
        log-prompt.sh start-section.sh on-git-push.sh continue-section.sh; do
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
    companion_lib=""
    case "$s" in
        agent-stop.sh)
            companion_lib="$AGENT_STOP_LIB"
            ;;
        pre-tool-use.sh)
            companion_lib="$PRE_TOOL_USE_LIB"
            ;;
        post-tool-use.sh)
            companion_lib="$POST_TOOL_USE_LIB"
            ;;
        log-prompt.sh)
            companion_lib="$LOG_PROMPT_LIB"
            ;;
        error-occurred.sh)
            companion_lib="$ERROR_OCCURRED_LIB"
            ;;
        subagent-start.sh)
            companion_lib="$SUBAGENT_START_LIB"
            ;;
        subagent-stop.sh)
            companion_lib="$SUBAGENT_STOP_LIB"
            ;;
        pre-compact.sh)
            companion_lib="$PRE_COMPACT_LIB"
            ;;
    esac

    # Guard válido: script loga session_id_mismatch (bloqueia) OU sessionReconnect (rollover RECONNECT-01)
    if [ -f "$f" ] && (
        contains_pattern_in_files '"session_id_mismatch(_[A-Za-z0-9]+)?"' "$f" "$companion_lib" \
            || contains_pattern_in_files 'sessionReconnect' "$f" "$companion_lib" \
            || contains_pattern_in_files 'reconcile_session_id_guard_(prepost|stop)' "$f" "$companion_lib" \
            || contains_pattern_in_files 'handle_manual_recovery_session_id' "$f" "$companion_lib"
    ); then
        pass "session_id guard presente: $s"
    elif [ -f "$f" ]; then
        fail "session_id guard AUSENTE: $s — vulnerável a contaminação cruzada"
    fi
done

for s in "${GUARD_EXCLUDED[@]}"; do
    f="$SCRIPTS_DIR/$s"
    if [ -f "$f" ] && ! rg -q '"session_id_mismatch(_[A-Za-z0-9]+)?"' "$f" 2> /dev/null; then
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
if contains_pattern_in_files 'intent_declared' "$SCRIPTS_DIR/log-prompt.sh" "$LOG_PROMPT_LIB"; then
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
if grep -q '"retomada"' "$SCRIPTS_DIR/agent-stop.sh" 2> /dev/null \
    || grep -q '"retomada"' "$HOOK_DIR/hooks-lib/agent-stop-lib.sh" 2> /dev/null; then
    pass "agent-stop.sh auto-cria seção 'retomada' para garantir invariante"
else
    fail "agent-stop.sh não implementa invariante SESSION+SECTION+TURN"
fi
if grep -q 'build_context_nudge_message' "$SCRIPTS_DIR/agent-stop.sh" 2> /dev/null \
    || grep -q 'build_context_system_message' "$HOOK_DIR/hooks-lib/agent-stop-lib.sh" 2> /dev/null; then
    pass "agent-stop.sh emite systemMessage rico com estado contextualizado (inline ou modularizado)"
else
    fail "agent-stop.sh usa systemMessage genérico (não contextualizado)"
fi

# ── 13. Dual numbering — section_turn ────────────────────────────────────────
echo ""
echo "13. Dual numbering — section_turn e local_turn"
if grep -q 'local_turn' "$SCRIPTS_DIR/start-section.sh" 2> /dev/null; then
    pass "start-section.sh define local_turn=0 ao criar nova section"
else
    fail "start-section.sh não reseta local_turn na nova section"
fi
if contains_pattern_in_files 'section_turn' "$SCRIPTS_DIR/log-prompt.sh" "$LOG_PROMPT_LIB"; then
    pass "log-prompt.sh calcula current_turn.section_turn (numeração local)"
else
    fail "log-prompt.sh não calcula section_turn"
fi
if grep -q '_CTX_SECTION_TURN' "$SCRIPTS_DIR/agent-stop.sh" 2> /dev/null \
    || grep -Fq 'TURN ${section_turn}/${turn_number}' "$HOOK_DIR/hooks-lib/agent-stop-lib.sh" 2> /dev/null; then
    pass "agent-stop.sh exibe TURN local/global no systemMessage (inline ou modularizado)"
else
    fail "agent-stop.sh não exibe dual turn no systemMessage"
fi

# ── 14. Git push — on-git-push.sh e continue-section.sh ─────────────────────
echo ""
echo "14. Git push — on-git-push.sh e continue-section.sh"
if [ -f "$SCRIPTS_DIR/on-git-push.sh" ]; then
    pass "on-git-push.sh existe"
else
    fail "on-git-push.sh não encontrado"
fi
if grep -q 'gitPush' "$SCRIPTS_DIR/on-git-push.sh" 2> /dev/null; then
    pass "on-git-push.sh loga evento gitPush em audit.jsonl"
else
    fail "on-git-push.sh não loga evento gitPush"
fi
if grep -q 'pending_section_after_push' "$SCRIPTS_DIR/on-git-push.sh" 2> /dev/null; then
    pass "on-git-push.sh define flag pending_section_after_push"
else
    fail "on-git-push.sh não define pending_section_after_push"
fi
if [ -f "$SCRIPTS_DIR/continue-section.sh" ]; then
    pass "continue-section.sh existe"
else
    fail "continue-section.sh não encontrado"
fi
if grep -q 'pending_section_after_push' "$SCRIPTS_DIR/agent-stop.sh" 2> /dev/null; then
    pass "agent-stop.sh lê flag pending_section_after_push e avisa no systemMessage"
else
    fail "agent-stop.sh não trata pending_section_after_push"
fi
if grep -q 'pre-push' "$SCRIPTS_DIR/install-git-hooks.sh" 2> /dev/null; then
    pass "install-git-hooks.sh instala hook pre-push"
else
    fail "install-git-hooks.sh não instala pre-push"
fi

# ── 15. Fase 9 — G9 checks ───────────────────────────────────────────────────
echo ""
echo "15. Fase 9 — G9 checks"

# G9-01: pre-push git hook instalado
if [ -f "$(git -C "$HOOK_DIR/../.." rev-parse --absolute-git-dir 2> /dev/null)/hooks/pre-push" ]; then
    pass "G9-01: .git/hooks/pre-push instalado"
else
    fail "G9-01: .git/hooks/pre-push NÃO instalado — rode install-git-hooks.sh"
fi

# G9-02: rotate-audit.sh existe e é executável
if [ -x "$SCRIPTS_DIR/rotate-audit.sh" ]; then
    pass "G9-02: rotate-audit.sh presente e executável"
else
    fail "G9-02: rotate-audit.sh ausente ou não-executável"
fi

# G9-02: session-start.sh chama rotate-audit.sh
if contains_pattern_in_files 'rotate-audit.sh' "$SCRIPTS_DIR/session-start.sh" "$SESSION_START_RUNTIME_LIB"; then
    pass "G9-02: session-start.sh integra rotate-audit.sh"
else
    fail "G9-02: session-start.sh não chama rotate-audit.sh"
fi

# G9-03: session-start.sh faz auto-clear de flag stale
if contains_pattern_in_files 'authViolation_stale_cleared' "$SCRIPTS_DIR/session-start.sh" "$SESSION_START_VIOLATIONS_LIB"; then
    pass "G9-03: session-start.sh auto-limpa UNAUTHORIZED_CLOSE.flag de sessões diferentes"
else
    fail "G9-03: session-start.sh não implementa auto-clear de flag stale"
fi

# G9-04: HEAL v2 em agent-stop (inline ou helper)
if grep -q 'mismatch_track\|HEAL v2\|healed_from_consecutive_mismatch\|reconcile_session_id_guard_stop' "$SCRIPTS_DIR/agent-stop.sh" 2> /dev/null \
    || grep -q 'mismatch_track\|HEAL v2\|healed_from_consecutive_mismatch\|reconcile_session_id_guard_stop' "$HOOK_DIR/hooks-lib/agent-stop-lib.sh" 2> /dev/null; then
    pass "G9-04: agent-stop implementa HEAL v2 (inline ou helper)"
else
    fail "G9-04: agent-stop não tem HEAL v2"
fi

# G9-05: raw-*.jsonl não devem existir (arquivos de diagnóstico obsoletos)
RAW_COUNT=0
for _f in "$LOG_DIR"/raw-*.jsonl; do
    [ -f "$_f" ] && RAW_COUNT=$((RAW_COUNT + 1))
done
if [ "$RAW_COUNT" -eq 0 ]; then
    pass "G9-05: nenhum arquivo raw-*.jsonl presente (diagnóstico removido)"
else
    fail "G9-05: $RAW_COUNT arquivo(s) raw-*.jsonl presente(s) — executar rotate-audit.sh"
fi

# G9-06: contracts/events-contract.md existe
if [ -f "$HOOK_DIR/contracts/events-contract.md" ]; then
    pass "G9-06: contracts/events-contract.md existe"
else
    fail "G9-06: contracts/events-contract.md não encontrado"
fi

# ── 16. Solidificação pós-review ─────────────────────────────────────────────
echo ""
echo "16. Solidificação pós-review (bugs críticos/altos + gaps)"

# BUG-A.1: pre-tool-use.sh tem flock
if contains_pattern_in_files 'flock.*CTX.*lock|CTX.*lock.*flock|\.lock.*exec.*9|exec.*9.*CTX|flock -x -w' "$SCRIPTS_DIR/pre-tool-use.sh" "$PRE_TOOL_USE_LIB"; then
    pass "BUG-A.1: pre-tool-use.sh tem flock (race condition corrigido)"
else
    fail "BUG-A.1: pre-tool-use.sh sem flock — race condition em session-context.json"
fi

# BUG-A.2: session-start.sh limpa .mismatch_track.json
if contains_pattern_in_files 'mismatch_track' "$SCRIPTS_DIR/session-start.sh" "$SESSION_START_LIB"; then
    pass "BUG-A.2: session-start.sh limpa .mismatch_track.json (HEAL v2 anti-contaminação)"
else
    fail "BUG-A.2: session-start.sh não limpa .mismatch_track.json — HEAL v2 pode herdar estado de sessão anterior"
fi

# BUG-A.3: section-end.sh tem aviso de invariante
if grep -q 'Invariante.*SECTION\|SECTION.*TURN.*null\|start-section.sh.*IMEDIATAMENTE' "$SCRIPTS_DIR/section-end.sh" 2> /dev/null; then
    pass "BUG-A.3: section-end.sh tem aviso de invariante SESSION+SECTION+TURN"
else
    fail "BUG-A.3: section-end.sh sem aviso de invariante"
fi

# BUG-B.3: agent-stop.sh tracked turns_since_askQuestions (substitui decision:block removido)
if grep -q 'turns_since_askQuestions' "$SCRIPTS_DIR/agent-stop.sh" 2> /dev/null; then
    pass "BUG-B.3: agent-stop.sh rastreia turns_since_askQuestions (TURN aut\u00f4nomo v5.0)"
else
    fail "BUG-B.3: agent-stop.sh n\u00e3o rastreia turns_since_askQuestions — contador de nudge ausente"
fi

# SEC-D.1: redaction inclui novos padrões
if grep -q 'github_pat_\|glpat-\|AKIA' "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null; then
    pass "SEC-D.1: common.sh::redact_credentials cobre github_pat_, glpat-, AKIA (AWS)"
else
    fail "SEC-D.1: common.sh::redact_credentials sem padrões github_pat_/glpat-/AKIA"
fi

# GAP-C.1: pre-tool-use.sh usa common.sh
if contains_pattern_in_files 'source.*common.sh|\. .*common.sh|COMMON_LIB=' "$SCRIPTS_DIR/pre-tool-use.sh" "$PRE_TOOL_USE_LIB"; then
    pass "GAP-C.1: pre-tool-use.sh carrega hooks-lib/common.sh"
else
    fail "GAP-C.1: pre-tool-use.sh não integra hooks-lib/common.sh"
fi

# GAP-C.2: contracts/session-context.schema.json existe
if [ -f "$HOOK_DIR/contracts/session-context.schema.json" ]; then
    if jq empty "$HOOK_DIR/contracts/session-context.schema.json" 2> /dev/null; then
        pass "GAP-C.2: contracts/session-context.schema.json existe e é JSON válido"
    else
        fail "GAP-C.2: contracts/session-context.schema.json é JSON inválido"
    fi
else
    fail "GAP-C.2: contracts/session-context.schema.json não encontrado"
fi

# F8.2: cobertura contratual de reason codes e payload mínimo do stop block
_F82_CONTRACT_REGISTRY="$HOOK_DIR/contracts/contract-registry.json"
_F82_STOP_SCHEMA="$HOOK_DIR/contracts/stop-decision.schema.json"
_F82_AGENT_STOP_LIB="$HOOK_DIR/hooks-lib/agent-stop-lib.sh"

if [ -f "$_F82_CONTRACT_REGISTRY" ]; then
    if jq empty "$_F82_CONTRACT_REGISTRY" 2> /dev/null; then
        pass "F8.2: contract-registry.json existe e é JSON válido"
    else
        fail "F8.2: contract-registry.json é JSON inválido"
    fi
else
    fail "F8.2: contract-registry.json não encontrado"
fi

if [ -f "$_F82_STOP_SCHEMA" ]; then
    if jq empty "$_F82_STOP_SCHEMA" 2> /dev/null; then
        pass "F8.2: stop-decision.schema.json existe e é JSON válido"
    else
        fail "F8.2: stop-decision.schema.json é JSON inválido"
    fi
else
    fail "F8.2: stop-decision.schema.json não encontrado"
fi

if [ -f "$_F82_CONTRACT_REGISTRY" ] && jq -e '.contracts | any(.id == "stop-decision-output" and .path == "contracts/stop-decision.schema.json")' "$_F82_CONTRACT_REGISTRY" > /dev/null 2>&1; then
    pass "F8.2: contract-registry referencia stop-decision-output"
else
    fail "F8.2: contract-registry sem referência consistente para stop-decision-output"
fi

if [ -f "$_F82_STOP_SCHEMA" ] && jq -e '.required | index("decision") and index("reason") and index("hookSpecificOutput")' "$_F82_STOP_SCHEMA" > /dev/null 2>&1; then
    pass "F8.2: schema exige decision/reason/hookSpecificOutput"
else
    fail "F8.2: schema sem campos mínimos obrigatórios"
fi

for _f82_reason_code in \
    strict_context_missing \
    askquestions_not_last_tool \
    askquestions_api_error \
    askquestions_skipped_or_empty \
    auto_audit_required_not_started \
    required_docs_not_read \
    non_template_f_continuation_mandatory \
    askquestions_missing_template_f_option \
    template_f_called_without_prior_request \
    turn_close_requires_template_f \
    turn_close_key_missing_or_invalid \
    turn_auth_context_invalid; do
    if grep -q "${_f82_reason_code}" "$_F82_AGENT_STOP_LIB" 2> /dev/null; then
        pass "F8.2: reason code obrigatório presente (${_f82_reason_code})"
    else
        fail "F8.2: reason code obrigatório ausente (${_f82_reason_code})"
    fi
done

if grep -q 'decision:[[:space:]]*"block"' "$_F82_AGENT_STOP_LIB" 2> /dev/null; then
    pass "F8.2: payload stop inclui decision=block"
else
    fail "F8.2: payload stop sem decision=block"
fi
if grep -q 'decisionReason:[[:space:]]*\$reason' "$_F82_AGENT_STOP_LIB" 2> /dev/null; then
    pass "F8.2: payload stop inclui decisionReason legado"
else
    fail "F8.2: payload stop sem decisionReason legado"
fi
if grep -q 'reason:[[:space:]]*\$reason' "$_F82_AGENT_STOP_LIB" 2> /dev/null; then
    pass "F8.2: payload stop inclui reason canônico"
else
    fail "F8.2: payload stop sem reason canônico"
fi
if grep -q 'hookSpecificOutput:[[:space:]]*{' "$_F82_AGENT_STOP_LIB" 2> /dev/null; then
    pass "F8.2: payload stop inclui hookSpecificOutput"
else
    fail "F8.2: payload stop sem hookSpecificOutput"
fi
if grep -q 'hookEventName:[[:space:]]*"Stop"' "$_F82_AGENT_STOP_LIB" 2> /dev/null; then
    pass "F8.2: payload stop inclui hookEventName=Stop"
else
    fail "F8.2: payload stop sem hookEventName=Stop"
fi
if grep -q 'systemMessage:[[:space:]]*\$system_message' "$_F82_AGENT_STOP_LIB" 2> /dev/null; then
    pass "F8.2: payload stop inclui systemMessage"
else
    fail "F8.2: payload stop sem systemMessage"
fi

# smoke-test fix: --absolute-git-dir
if grep -q 'absolute-git-dir' "$SCRIPTS_DIR/smoke-test.sh" 2> /dev/null; then
    pass "Smoke-test usa --absolute-git-dir (path resolution fix)"
else
    fail "Smoke-test usa --git-dir sem absolute — G9-01 pode falhar com paths relativos"
fi

# ── 17. Segunda revisão (REV-09, REV-11, HEAL v2 doc) ────────────────────────
echo ""
echo "17. Segunda revisão — REV-09 / REV-11 / config.sh / HEAL v2"

# REV-09: agent-stop.sh incrementa agentStop_invocations (inline ou via helper modularizado)
if grep -q 'agentStop_invocations' "$SCRIPTS_DIR/agent-stop.sh" 2> /dev/null \
    || grep -q 'increment_agentstop_invocations_in_context' "$SCRIPTS_DIR/agent-stop.sh" 2> /dev/null; then
    pass "REV-09: agent-stop.sh rastreia agentStop_invocations (inclui caminho modularizado)"
else
    fail "REV-09: agentStop_invocations ausente em agent-stop.sh"
fi

# REV-09: log-prompt.sh reseta agentStop_invocations no início do turno
if contains_pattern_in_files 'agentStop_invocations.*=.*0' "$SCRIPTS_DIR/log-prompt.sh" "$LOG_PROMPT_LIB"; then
    pass "REV-09: log-prompt.sh reseta agentStop_invocations = 0"
else
    fail "REV-09: log-prompt.sh não reseta agentStop_invocations"
fi

# REV-11: redact_credentials cobre hf_ e xai-
if grep -qE 'hf_\[A-Za-z0-9\]' "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null; then
    pass "REV-11: redact_credentials cobre hf_ (HuggingFace)"
else
    fail "REV-11: redact_credentials não cobre hf_"
fi
if grep -q 'xai-' "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null; then
    pass "REV-11: redact_credentials cobre xai- (xAI/Grok)"
else
    fail "REV-11: redact_credentials não cobre xai-"
fi

# Ordem sk-ant- antes de sk-
_SK_ANT_LINE="$(grep -n 'sk-ant-' "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null | head -1 | cut -d: -f1 || true)"
_SK_LINE="$(grep -n "sk-\[A-Za-z" "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null | head -1 | cut -d: -f1 || true)"
if [ -n "$_SK_ANT_LINE" ] && [ -n "$_SK_LINE" ] && [ "$_SK_ANT_LINE" -lt "$_SK_LINE" ]; then
    pass "REV-11: redact_credentials — sk-ant- vem ANTES de sk- (ordem correta)"
else
    fail "REV-11: redact_credentials — sk- antes de sk-ant- captura Anthropic como OpenAI"
fi

# config.sh existe e tem as variáveis canônicas
if [ -f "$HOOK_DIR/hooks-lib/config.sh" ]; then
    pass "config.sh existe (tunáveis centralizados)"
    if grep -q 'HOOKS_FLOCK_TIMEOUT' "$HOOK_DIR/hooks-lib/config.sh" \
        && grep -q 'HOOKS_TURN_HISTORY_CAP' "$HOOK_DIR/hooks-lib/config.sh" \
        && grep -q 'HOOKS_SECTION_HISTORY_CAP' "$HOOK_DIR/hooks-lib/config.sh" \
        && grep -q 'HOOKS_HEAL_THRESHOLD' "$HOOK_DIR/hooks-lib/config.sh"; then
        pass "config.sh tem variáveis canônicas (FLOCK_TIMEOUT, HISTORY_CAPs, HEAL_THRESHOLD)"
    else
        fail "config.sh está incompleto — variáveis canônicas ausentes"
    fi
else
    fail "config.sh não encontrado em hooks-lib/"
fi

# REV-12: documentação HEAL v2
if [ -f "$HOOK_DIR/../../../DOCUMENTAÇÃO/HOOKS/HEAL-v2.md" ] 2> /dev/null \
    || [ -f "$(git -C "$HOOK_DIR" rev-parse --show-toplevel 2> /dev/null)/DOCUMENTAÇÃO/HOOKS/HEAL-v2.md" ] 2> /dev/null; then
    pass "REV-12: HEAL-v2.md documentação existe"
else
    # Tenta path relativo
    if [ -f "$HOOK_DIR/../../DOCUMENTAÇÃO/HOOKS/HEAL-v2.md" ] 2> /dev/null; then
        pass "REV-12: HEAL-v2.md documentação existe"
    else
        fail "REV-12: HEAL-v2.md não encontrado em DOCUMENTAÇÃO/HOOKS/"
    fi
fi

# ── Fase 7: Hardening subagente + REV4-03 a REV4-07 ────────────────────────
echo ""
echo "[ Fase 7 — hardening subagente + REV4-03~07 ]"

# Hardening subagente v6 — pre-tool-use.sh
if contains_pattern_in_files 'subagent_delegated' "$HOOK_DIR/scripts/pre-tool-use.sh" "$PRE_TOOL_USE_LIB" \
    && contains_pattern_in_files 'subagentStart' "$HOOK_DIR/scripts/pre-tool-use.sh" "$PRE_TOOL_USE_LIB"; then
    pass "Hardening v6: pre-tool-use.sh detecta runSubagent/Task e loga subagentStart"
else
    fail "Hardening v6: pre-tool-use.sh faltando detecção de subagente/subagentStart"
fi

# Hardening subagente v6 — agent-stop.sh aceita subagentStart nas Strategies 1+2
if { grep -q 'subagentStart' "$HOOK_DIR/scripts/agent-stop.sh" 2> /dev/null \
    || grep -q 'subagentStart' "$HOOK_DIR/hooks-lib/agent-stop-lib.sh" 2> /dev/null; } \
    && { grep -q 'subagent_delegated' "$HOOK_DIR/scripts/agent-stop.sh" 2> /dev/null \
        || grep -q 'subagent_delegated' "$HOOK_DIR/hooks-lib/agent-stop-lib.sh" 2> /dev/null; }; then
    pass "Hardening v6: agent-stop.sh aceita subagentStart + Strategy 4 (subagent_delegated)"
else
    fail "Hardening v6: agent-stop.sh faltando subagentStart ou Strategy 4"
fi

# Hardening subagente v6 — auth_via_subagent_delegation logado
if grep -q 'auth_via_subagent_delegation' "$HOOK_DIR/scripts/agent-stop.sh" 2> /dev/null \
    || grep -q 'auth_via_subagent_delegation' "$HOOK_DIR/hooks-lib/agent-stop-lib.sh" 2> /dev/null; then
    pass "Hardening v6: agent-stop.sh loga auth_via_subagent_delegation (Strategy 4)"
else
    fail "Hardening v6: agent-stop.sh não loga auth_via_subagent_delegation"
fi

# REV4-03/04: generate-section-summary.sh e start-section.sh usam cap da config
if grep -q 'HOOKS_SECTION_HISTORY_CAP' "$HOOK_DIR/scripts/generate-section-summary.sh" \
    && grep -q 'HOOKS_SECTION_HISTORY_CAP' "$HOOK_DIR/scripts/start-section.sh"; then
    pass "REV4-03/04: generate-section-summary.sh e start-section.sh usam HOOKS_SECTION_HISTORY_CAP"
else
    fail "REV4-03/04: generate-section-summary.sh ou start-section.sh sem HOOKS_SECTION_HISTORY_CAP"
fi

# REV4-04: start-turn.sh usa HOOKS_TURN_HISTORY_CAP
if grep -q 'HOOKS_TURN_HISTORY_CAP' "$HOOK_DIR/scripts/start-turn.sh"; then
    pass "REV4-04: start-turn.sh usa HOOKS_TURN_HISTORY_CAP"
else
    fail "REV4-04: start-turn.sh sem HOOKS_TURN_HISTORY_CAP"
fi

# REV4-05: ctx_guard_session_id removida de common.sh (dead code)
if ! grep -q 'ctx_guard_session_id' "$HOOK_DIR/hooks-lib/common.sh"; then
    pass "REV4-05: ctx_guard_session_id removida de common.sh (dead code eliminado)"
else
    fail "REV4-05: ctx_guard_session_id ainda presente em common.sh"
fi

# REV4-06: post-tool-use.sh seta auth_requested_at em ambos os branches
if [ "$(count_pattern_in_files 'auth_requested_at' "$HOOK_DIR/scripts/post-tool-use.sh" "$POST_TOOL_USE_LIB")" -ge 2 ]; then
    pass "REV4-06: post-tool-use.sh seta auth_requested_at nos dois branches"
else
    fail "REV4-06: post-tool-use.sh seta auth_requested_at em menos de 2 branches"
fi

# REV4-07: session-end.sh tem flock
if contains_pattern_in_files 'flock' "$HOOK_DIR/scripts/session-end.sh" "$SESSION_END_LIB"; then
    pass "REV4-07: session-end.sh tem flock para prevenir race condition"
else
    fail "REV4-07: session-end.sh sem flock"
fi

# REV4-02: events-contract.md atualizado com novos eventos
if grep -q 'auth_via_subagent_delegation' "$HOOK_DIR/contracts/events-contract.md" \
    && grep -q 'sectionContinued' "$HOOK_DIR/contracts/events-contract.md" \
    && grep -q 'turnStart_enriched' "$HOOK_DIR/contracts/events-contract.md" \
    && grep -q 'errorOccurred' "$HOOK_DIR/contracts/events-contract.md" \
    && grep -q 'session_manual_recovery' "$HOOK_DIR/contracts/events-contract.md"; then
    pass "REV4-02: events-contract.md tem eventos da Fase 7 documentados"
else
    fail "REV4-02: events-contract.md faltando eventos da Fase 7"
fi

# ── REV4-08: Sandbox de execução — scripts em dry-run ───────────────────────
echo ""
echo "[ REV4-08 — Sandbox de execução de scripts ]"

_SANDBOX_DIR="$(mktemp -d)"
_SANDBOX_PASS=0
_SANDBOX_FAIL=0

_sandbox_pass() {
    _SANDBOX_PASS=$((_SANDBOX_PASS + 1))
    pass "$1"
}
_sandbox_fail() {
    _SANDBOX_FAIL=$((_SANDBOX_FAIL + 1))
    fail "$1"
}

_run_script_dry() {
    local script="$1" input="$2" label="$3"
    # Executa com echo vazio (sem stdin real) para detectar syntax errors e erros imediatos
    echo "$input" | bash -n "$script" 2>&1
    local rc=$?
    if [ "$rc" -eq 0 ]; then
        _sandbox_pass "Sandbox: $label — sem erros de sintaxe bash"
    else
        _sandbox_fail "Sandbox: $label — erro de sintaxe detectado (rc=$rc)"
    fi
}

# Syntax check: scripts principais
for _script in \
    "$HOOK_DIR/scripts/pre-tool-use.sh" \
    "$HOOK_DIR/scripts/post-tool-use.sh" \
    "$HOOK_DIR/scripts/agent-stop.sh" \
    "$HOOK_DIR/scripts/session-start.sh" \
    "$HOOK_DIR/scripts/session-end.sh" \
    "$HOOK_DIR/scripts/session-close.sh" \
    "$HOOK_DIR/scripts/start-turn.sh" \
    "$HOOK_DIR/scripts/start-section.sh" \
    "$HOOK_DIR/scripts/generate-section-summary.sh" \
    "$HOOK_DIR/scripts/continue-section.sh" \
    "$HOOK_DIR/hooks-lib/common.sh" \
    "$HOOK_DIR/hooks-lib/config.sh"; do
    _script_name="$(basename "$_script")"
    if [ -f "$_script" ]; then
        bash -n "$_script" 2> /dev/null \
            && _sandbox_pass "Sandbox syntax OK: $_script_name" \
            || _sandbox_fail "Sandbox syntax FAIL: $_script_name"
    else
        _sandbox_fail "Sandbox: $_script_name não encontrado"
    fi
done

# Execução real com sandbox isolado: watchdog.sh --json (leitura-only)
if [ -f "$HOOK_DIR/scripts/watchdog.sh" ]; then
    _SANDBOX_STATE="$_SANDBOX_DIR/state"
    mkdir -p "$_SANDBOX_STATE"
    # watchdog.sh deve lidar graciosamente com state vazio
    HOOKS_STATE_DIR="$_SANDBOX_STATE" \
        HOOKS_LOG_DIR="$_SANDBOX_DIR/logs" \
        bash "$HOOK_DIR/scripts/watchdog.sh" --json > "$_SANDBOX_DIR/watchdog-out.json" 2> /dev/null
    _WD_RC=$?
    if [ "$_WD_RC" -eq 0 ] || [ "$_WD_RC" -le 2 ]; then
        _sandbox_pass "Sandbox exec: watchdog.sh --json retornou rc=$_WD_RC (aceitável)"
    else
        _sandbox_fail "Sandbox exec: watchdog.sh --json retornou rc=$_WD_RC inesperado"
    fi
fi

rm -rf "$_SANDBOX_DIR"

# ── Testes do session-close.sh (validação de close_key) ──────────────────────
echo ""
echo "── Grupo 17: session-close.sh — validação de close_key ─────────────────────"

_SC_SCRIPT="$HOOK_DIR/scripts/session-close.sh"
_SC_DIR="$(mktemp -d)"
_SC_STATE="$_SC_DIR/state"
_SC_LOG="$_SC_DIR/logs"
_SC_DOCS="$_SC_DIR/docs"
mkdir -p "$_SC_STATE" "$_SC_LOG" "$_SC_DOCS"

# Seed: contexto mínimo com close_key definida
_SC_CTX="$_SC_STATE/session-context.json"
cat > "$_SC_CTX" << 'SCJSON'
{
  "schema_version": 9,
  "session": {
    "id": "test-sc-session-001",
    "close_key": "ENCERRAR-TESTTEST",
    "close_key_validated": false,
    "started_at": "2026-01-01T00:00:00Z"
  }
}
SCJSON
touch "$_SC_LOG/audit.jsonl"

if [ -f "$_SC_SCRIPT" ]; then
    # Teste SC-1: KEY correta → exit 0
    _SC_CTX_COPY="$_SC_STATE/ctx_copy.json"
    cp "$_SC_CTX" "$_SC_CTX_COPY"
    # Chama script com sandbox de state/log
    _SC_OUT="$(HOOKS_STATE_DIR="$_SC_STATE" HOOKS_LOG_DIR="$_SC_LOG" HOOKS_DOCS_DIR="$_SC_DOCS" \
        HOME="$_SC_DIR" \
        bash "$_SC_SCRIPT" "ENCERRAR-TESTTEST" 2>&1)" && _SC_RC=$? || _SC_RC=$?

    if [ "$_SC_RC" -eq 0 ]; then
        pass "SC-1: session-close.sh KEY correta → exit 0"
    else
        fail "SC-1: session-close.sh KEY correta → esperado exit 0, obtido rc=$_SC_RC (out: $_SC_OUT)"
    fi

    # Restaura contexto para próximo teste
    cp "$_SC_CTX_COPY" "$_SC_CTX"

    # Teste SC-2: KEY errada → exit 1
    _SC_OUT2="$(HOOKS_STATE_DIR="$_SC_STATE" HOOKS_LOG_DIR="$_SC_LOG" HOOKS_DOCS_DIR="$_SC_DOCS" \
        HOME="$_SC_DIR" \
        bash "$_SC_SCRIPT" "ENCERRAR-WRONGKEY" 2>&1)" && _SC_RC2=$? || _SC_RC2=$?

    if [ "$_SC_RC2" -ne 0 ]; then
        pass "SC-2: session-close.sh KEY errada → exit≠0 (rc=$_SC_RC2)"
    else
        fail "SC-2: session-close.sh KEY errada → esperado exit≠0, obtido exit 0"
    fi

    # Restaura contexto para próximo teste
    cp "$_SC_CTX_COPY" "$_SC_CTX"

    # Teste SC-3: KEY ausente (sem argumento) → exit 1
    _SC_OUT3="$(HOOKS_STATE_DIR="$_SC_STATE" HOOKS_LOG_DIR="$_SC_LOG" HOOKS_DOCS_DIR="$_SC_DOCS" \
        HOME="$_SC_DIR" \
        bash "$_SC_SCRIPT" 2>&1)" && _SC_RC3=$? || _SC_RC3=$?

    if [ "$_SC_RC3" -ne 0 ]; then
        pass "SC-3: session-close.sh sem KEY → exit≠0 (rc=$_SC_RC3)"
    else
        fail "SC-3: session-close.sh sem KEY → esperado exit≠0, obtido exit 0"
    fi

    # Teste SC-4: após KEY correta, sessionCloseAuthorized logado em audit.jsonl
    cp "$_SC_CTX_COPY" "$_SC_CTX"
    HOOKS_STATE_DIR="$_SC_STATE" HOOKS_LOG_DIR="$_SC_LOG" HOOKS_DOCS_DIR="$_SC_DOCS" \
        HOME="$_SC_DIR" \
        bash "$_SC_SCRIPT" "ENCERRAR-TESTTEST" > /dev/null 2>&1 || true
    if grep -q '"sessionCloseAuthorized"' "$_SC_LOG/audit.jsonl" 2> /dev/null; then
        pass "SC-4: sessionCloseAuthorized logado em audit.jsonl após KEY correta"
    else
        fail "SC-4: sessionCloseAuthorized NÃO encontrado em audit.jsonl"
    fi

    # Teste SC-5: SESSION_CLOSE_AUTHORIZED.flag gerado após KEY correta
    if [ -f "$_SC_STATE/SESSION_CLOSE_AUTHORIZED.flag" ]; then
        pass "SC-5: SESSION_CLOSE_AUTHORIZED.flag gerado"
    else
        fail "SC-5: SESSION_CLOSE_AUTHORIZED.flag NÃO gerado"
    fi

    # Teste SC-6: após KEY errada, sessionClose_REJECTED logado
    cp "$_SC_CTX_COPY" "$_SC_CTX"
    HOOKS_STATE_DIR="$_SC_STATE" HOOKS_LOG_DIR="$_SC_LOG" HOOKS_DOCS_DIR="$_SC_DOCS" \
        HOME="$_SC_DIR" \
        bash "$_SC_SCRIPT" "ENCERRAR-BADKEY" > /dev/null 2>&1 || true
    if grep -q '"sessionClose_REJECTED"' "$_SC_LOG/audit.jsonl" 2> /dev/null; then
        pass "SC-6: sessionClose_REJECTED logado para KEY errada"
    else
        fail "SC-6: sessionClose_REJECTED NÃO encontrado em audit.jsonl"
    fi
else
    fail "SC-0: session-close.sh não encontrado em $HOOK_DIR/scripts/"
fi

rm -rf "$_SC_DIR"

# ── Grupo 18: agent-stop.sh — decision:block v7.0 ───────────────────────────
echo ""
echo "── Grupo 18: agent-stop.sh — decision:block v7.0 ───────────────────────────"

_AS_SCRIPT="$HOOK_DIR/scripts/agent-stop.sh"
if [ -f "$_AS_SCRIPT" ]; then
    _AS_DIR="$(mktemp -d)"
    _AS_STATE="$_AS_DIR/state"
    _AS_LOG="$_AS_DIR/logs"
    mkdir -p "$_AS_STATE" "$_AS_LOG"

    # Contexto mínimo para agent-stop.sh rodar
    _AS_CTX="$_AS_STATE/session-context.json"
    cat > "$_AS_CTX" << 'ASJSON'
{
  "schema_version": 9,
  "session": {
    "id": "test-as-session-001",
    "close_key": "ENCERRAR-ASTEST",
    "close_key_validated": false,
    "started_at": "2026-01-01T00:00:00Z"
  },
  "current_section": { "name": "teste", "section_id": "s1", "section_number": 1, "turn_start": 0 },
  "current_turn": {
    "number": 2, "section_turn": 2,
    "started_at": "2026-01-01T00:00:00Z",
    "intent": "teste-smoke",
    "intent_declared": true,
    "tools_count": 5,
    "auth_requested": false,
    "agentStop_invocations": 0,
    "subagent_delegated": false
  },
  "session_stats": {
    "turn_count": 2, "turn_authorized": 1, "turn_no_askQuestions": 1,
    "turns_since_askQuestions": 1, "tools_total": 10,
    "push_count": 0, "pending_section_after_push": false
  },
  "compliance": { "consecutive_unauthorized": 0, "last_turn_authorized": false }
}
ASJSON

    # Teste AS-1: agent-stop.sh contém decision:block no código
    if grep -q 'decision.*block' "$_AS_SCRIPT" 2> /dev/null \
        && grep -q 'hookSpecificOutput' "$_AS_SCRIPT" 2> /dev/null; then
        pass "AS-1: agent-stop.sh contém código de decision:block e hookSpecificOutput"
    else
        fail "AS-1: agent-stop.sh NÃO contém decision:block ou hookSpecificOutput"
    fi

    # Teste AS-2: agent-stop.sh verifica stop_hook_active antes de bloquear
    if grep -q 'STOP_HOOK_ACTIVE.*true\|stop_hook_active.*true' "$_AS_SCRIPT" 2> /dev/null \
        && grep -q 'NUNCA bloquear\|anti-loop' "$_AS_SCRIPT" 2> /dev/null; then
        pass "AS-2: agent-stop.sh tem guarda anti-loop (stop_hook_active check)"
    else
        fail "AS-2: agent-stop.sh NÃO tem guarda anti-loop contra stop_hook_active"
    fi

    # Teste AS-3: Estratégia 2 foi removida (variável RECENT_LINES não deve ser usada)
    if ! grep -q 'RECENT_LINES=' "$_AS_SCRIPT" 2> /dev/null; then
        pass "AS-3: Estratégia 2 removida (RECENT_LINES não atribuída em agent-stop.sh)"
    else
        fail "AS-3: Estratégia 2 ainda usa RECENT_LINES (falso positivo cross-turn)"
    fi

    # Teste AS-4: agent-stop.sh passa shellcheck (erros críticos)
    if command -v shellcheck > /dev/null 2>&1; then
        if shellcheck -S error "$_AS_SCRIPT" > /dev/null 2>&1; then
            pass "AS-4: agent-stop.sh passa shellcheck -S error"
        else
            fail "AS-4: agent-stop.sh tem erros de shellcheck"
        fi
    else
        pass "AS-4: shellcheck não disponível (skip)"
    fi

    # Teste AS-5: decision:block tem reason obrigatório e código de razão canônico
    if { grep -q 'reason: \$reason' "$_AS_SCRIPT" 2> /dev/null \
        || grep -q 'reason: \$reason' "$HOOK_DIR/hooks-lib/agent-stop-lib.sh" 2> /dev/null; } \
        && { grep -q '_BLOCK_REASON=' "$_AS_SCRIPT" 2> /dev/null \
            || grep -q 'local reason_code=' "$HOOK_DIR/hooks-lib/agent-stop-lib.sh" 2> /dev/null \
            || grep -q 'block_reason=' "$HOOK_DIR/hooks-lib/agent-stop-lib.sh" 2> /dev/null; }; then
        pass "AS-5: decision:block tem campo reason obrigatório + razão canônica (modularizado)"
    else
        fail "AS-5: decision:block NÃO tem campo reason/razão canônica (falta reason: \$reason + reason_code/block_reason)"
    fi

    # Teste AS-6: agentStop_blocked é logado quando bloqueia
    if grep -q 'agentStop_blocked' "$_AS_SCRIPT" 2> /dev/null \
        || grep -q 'agentStop_blocked' "$HOOK_DIR/hooks-lib/agent-stop-lib.sh" 2> /dev/null; then
        pass "AS-6: agent-stop.sh loga evento agentStop_blocked em audit.jsonl"
    else
        fail "AS-6: agent-stop.sh NÃO loga agentStop_blocked"
    fi

    rm -rf "$_AS_DIR"
else
    fail "AS-0: agent-stop.sh não encontrado em $HOOK_DIR/scripts/"
fi

# ── Grupo 19: pre-tool-use.sh — SESSION persistente v8.0 ─────────────────────
echo ""
echo "── Grupo 19: pre-tool-use.sh — SESSION persistente v8.0 ──────────────────"

_PTU_SCRIPT="$HOOK_DIR/scripts/pre-tool-use.sh"
if [ -f "$_PTU_SCRIPT" ]; then
    # Teste PR-1: pre-tool-use.sh contém guard do Mecanismo 5 (session-close.sh bloqueio)
    if contains_pattern_in_files 'sessionClose_direct_blocked|session-close\.sh|Mechanism 5' "$_PTU_SCRIPT" "$PRE_TOOL_USE_LIB"; then
        pass "PR-1: pre-tool-use.sh contém guard do Mecanismo 5 (session-close.sh)"
    else
        fail "PR-1: pre-tool-use.sh NÃO contém guard do Mecanismo 5"
    fi

    # Teste PR-2: pre-tool-use.sh emite permissionDecision:deny para session-close.sh
    if contains_pattern_in_files 'permissionDecision.*deny|"deny"' "$_PTU_SCRIPT" "$PRE_TOOL_USE_LIB"; then
        pass "PR-2: pre-tool-use.sh emite permissionDecision:deny quando necessário"
    else
        fail "PR-2: pre-tool-use.sh NÃO emite permissionDecision:deny"
    fi

    # Teste PR-3: intervalo de reminder é 10 (padrão v8.0)
    if contains_pattern_in_files 'HOOKS_SESSION_REMINDER_TOOL_INTERVAL:-10' "$_PTU_SCRIPT" "$PRE_TOOL_USE_LIB"; then
        pass "PR-3: intervalo de SESSION reminder é 10 (padrão v8.0)"
    else
        fail "PR-3: intervalo de SESSION reminder NÃO é 10 (esperado v8.0)"
    fi

    # Teste PR-4: pre-tool-use.sh verifica close_key_validated antes de bloquear
    if contains_pattern_in_files '_M5_VALIDATED|close_key_validated' "$_PTU_SCRIPT" "$PRE_TOOL_USE_LIB"; then
        pass "PR-4: pre-tool-use.sh verifica close_key_validated antes de bloquear"
    else
        fail "PR-4: pre-tool-use.sh NÃO verifica close_key_validated"
    fi

    # Teste PR-5: pre-tool-use.sh passa shellcheck -S error
    if shellcheck -S error "$_PTU_SCRIPT" 2> /dev/null; then
        pass "PR-5: pre-tool-use.sh passa shellcheck -S error"
    else
        fail "PR-5: pre-tool-use.sh FALHOU no shellcheck -S error"
    fi

    # Teste PR-6: guard verifica tool_name = run_in_terminal antes de bloquear
    if contains_pattern_in_files 'run_in_terminal' "$_PTU_SCRIPT" "$PRE_TOOL_USE_LIB"; then
        pass "PR-6: pre-tool-use.sh verifica tool_name run_in_terminal no Mecanismo 5"
    else
        fail "PR-6: pre-tool-use.sh NÃO verifica tool_name run_in_terminal"
    fi

    # Teste PR-7/PR-8: regressão de falso positivo no guard de session-close.sh
    _PTU_SB="$(mktemp -d)"
    _PTU_SB_SCRIPTS="$_PTU_SB/scripts"
    _PTU_SB_STATE="$_PTU_SB/state"
    _PTU_SB_LOGS="$_PTU_SB/logs"
    _PTU_SB_LIB="$_PTU_SB/hooks-lib"
    mkdir -p "$_PTU_SB_SCRIPTS" "$_PTU_SB_STATE" "$_PTU_SB_LOGS" "$_PTU_SB_LIB"
    cp -a "$HOOK_DIR/scripts/pre-tool-use.sh" "$_PTU_SB_SCRIPTS/" 2> /dev/null || true
    cp -a "$HOOK_DIR/hooks-lib/"* "$_PTU_SB_LIB/" 2> /dev/null || true

    cat > "$_PTU_SB_STATE/session-context.json" << 'PTUCTX'
{
    "session": {
        "id": "ptu-guard-test-001",
        "close_key": "ENCERRAR-PTUTEST",
        "close_key_validated": false,
        "started_at": "2026-01-01T00:00:00Z"
    },
    "session_stats": {
        "tools_total": 0,
        "tools_by_name": {}
    },
    "current_turn": {
        "tools_count": 0,
        "tools_by_name": {},
        "auth_requested": false,
        "section_name": "teste"
    },
    "current_section": {
        "name": "teste",
        "tools_by_name": {}
    },
    "last_tool": {
        "name": null,
        "ts": null,
        "use_id": null,
        "result": null
    },
    "compliance": {
        "consecutive_unauthorized": 0
    }
}
PTUCTX

    _PTU_PAYLOAD_ARG='{"timestamp":"2026-01-01T00:00:00Z","session_id":"ptu-guard-test-001","cwd":"/tmp","tool_name":"run_in_terminal","tool_use_id":"ptu-u1","tool_input":{"command":"git add .github/hooks/scripts/session-close.sh README.md"}}'
    _PTU_OUT_ARG="$(echo "$_PTU_PAYLOAD_ARG" | bash "$_PTU_SB_SCRIPTS/pre-tool-use.sh" 2> /dev/null || true)"
    if echo "$_PTU_OUT_ARG" | grep -q '"permissionDecision"[[:space:]]*:[[:space:]]*"deny"'; then
        fail "PR-7: falso positivo — comando com session-close.sh como argumento foi bloqueado"
    else
        pass "PR-7: sem falso positivo — argumento contendo session-close.sh NÃO bloqueia"
    fi

    _PTU_PAYLOAD_DIRECT='{"timestamp":"2026-01-01T00:00:00Z","session_id":"ptu-guard-test-001","cwd":"/tmp","tool_name":"run_in_terminal","tool_use_id":"ptu-u2","tool_input":{"command":"bash .github/hooks/scripts/session-close.sh ENCERRAR-PTUTEST"}}'
    _PTU_OUT_DIRECT="$(echo "$_PTU_PAYLOAD_DIRECT" | bash "$_PTU_SB_SCRIPTS/pre-tool-use.sh" 2> /dev/null || true)"
    if echo "$_PTU_OUT_DIRECT" | grep -q '"permissionDecision"[[:space:]]*:[[:space:]]*"deny"'; then
        pass "PR-8: chamada direta de session-close.sh continua bloqueada"
    else
        fail "PR-8: chamada direta de session-close.sh NÃO foi bloqueada"
    fi

    cat > "$_PTU_SB_STATE/session-context.json" << 'PTUCTX_STALE'
{
    "session": {
        "id": "ptu-guard-test-001",
        "close_key": "ENCERRAR-PTUTEST",
        "close_key_validated": false,
        "started_at": "2026-01-01T00:00:00Z"
    },
    "session_stats": {
        "tools_total": 0,
        "tools_by_name": {}
    },
    "current_turn": {
        "tools_count": 0,
        "tools_by_name": {},
        "auth_requested": false,
        "section_name": "teste"
    },
    "current_section": {
        "name": "teste",
        "tools_by_name": {}
    },
    "last_tool": {
        "name": null,
        "ts": null,
        "use_id": null,
        "result": null
    },
    "compliance": {
        "consecutive_unauthorized": 0
    },
    "recovery": {
        "close_mode": "abrupt_no_key",
        "prev_session_id": "sess_test123_old",
        "prev_session_ts": "2026-03-15T09:55:00Z",
        "alerts": ["alerta fake"],
        "alerts_require_kickoff": true,
        "detected_at": "2026-03-15T10:00:00Z"
    }
}
PTUCTX_STALE

    cp "$_PTU_SB_STATE/session-context.json" "$_PTU_SB_STATE/session-context-ptu-guar.json" 2> /dev/null || true

    _PTU_PAYLOAD_STALE='{"timestamp":"2026-01-01T00:00:00Z","session_id":"ptu-guard-test-001","cwd":"/tmp","tool_name":"run_in_terminal","tool_use_id":"ptu-u3","tool_input":{"command":"echo ok"}}'
    echo "$_PTU_PAYLOAD_STALE" | bash "$_PTU_SB_SCRIPTS/pre-tool-use.sh" > /dev/null 2>&1 || true
    _PTU_STALE_CTX_FILE="$_PTU_SB_STATE/session-context-ptu-guar.json"
    _PTU_STALE_MODE="$(jq -r '.recovery.close_mode // ""' "$_PTU_STALE_CTX_FILE" 2> /dev/null || echo '')"
    _PTU_STALE_PREV_SID="$(jq -r '.recovery.prev_session_id // ""' "$_PTU_STALE_CTX_FILE" 2> /dev/null || echo '')"
    _PTU_STALE_ALERTS_REQ="$(jq -r '.recovery.alerts_require_kickoff' "$_PTU_STALE_CTX_FILE" 2> /dev/null || echo true)"
    if [ "$_PTU_STALE_MODE" = "ok" ] && [ -z "$_PTU_STALE_PREV_SID" ] && [ "$_PTU_STALE_ALERTS_REQ" = "false" ]; then
        pass "PR-9: pre-tool-use sanitiza recovery stale contaminado (sess_test*)"
    else
        fail "PR-9: pre-tool-use NÃO sanitizou recovery stale (mode=$_PTU_STALE_MODE sid=$_PTU_STALE_PREV_SID kickoff=$_PTU_STALE_ALERTS_REQ)"
    fi

    rm -rf "$_PTU_SB"
else
    fail "PR-0: pre-tool-use.sh não encontrado em $HOOK_DIR/scripts/"
fi

# ── Grupo 20: v8.1 — sessionEnd falsos e auto_recovery ───────────────────────
echo ""
echo "── Grupo 20: v8.1 — sessionEnd falsos e auto_recovery ────────────────────"

_SC_SCRIPT="$HOOK_DIR/scripts/session-close.sh"
if [ -f "$_SC_SCRIPT" ]; then
    # Teste V81-1: session-close.sh NÃO chama session-end.sh diretamente
    if ! grep -q 'bash.*session-end\.sh\|"session-end\.sh"' "$_SC_SCRIPT" 2> /dev/null; then
        pass "V81-1: session-close.sh não chama session-end.sh diretamente (fix v8.1)"
    else
        fail "V81-1: session-close.sh AINDA chama session-end.sh — risco de sessionEnd falso"
    fi

    # Teste V81-2: session-close.sh apenas cria SESSION_CLOSE_AUTHORIZED.flag
    if grep -q 'SESSION_CLOSE_AUTHORIZED' "$_SC_SCRIPT" 2> /dev/null; then
        pass "V81-2: session-close.sh cria SESSION_CLOSE_AUTHORIZED.flag"
    else
        fail "V81-2: session-close.sh NÃO cria SESSION_CLOSE_AUTHORIZED.flag"
    fi

    # Teste V81-3: session-close.sh seta close_key_validated=true no contexto
    if grep -q 'close_key_validated = true\|close_key_validated.*true' "$_SC_SCRIPT" 2> /dev/null; then
        pass "V81-3: session-close.sh seta close_key_validated=true"
    else
        fail "V81-3: session-close.sh NÃO seta close_key_validated=true"
    fi
else
    fail "V81-0: session-close.sh não encontrado"
fi

_PTU_SCRIPT2="$HOOK_DIR/scripts/pre-tool-use.sh"
if [ -f "$_PTU_SCRIPT2" ]; then
    # Teste V81-4: auto_recovery herda close_key_validated do SESSION_CLOSE_AUTHORIZED.flag (v8.1)
    if contains_pattern_in_files 'SESSION_CLOSE_AUTHORIZED|_AUTH_FLAG|_RECOVERY_KEY_VALIDATED' "$_PTU_SCRIPT2" "$PRE_TOOL_USE_LIB"; then
        pass "V81-4: auto_recovery herda close_key_validated de SESSION_CLOSE_AUTHORIZED.flag"
    else
        fail "V81-4: auto_recovery NÃO herda close_key_validated (v8.1 não aplicado)"
    fi

    # Teste V81-5: auto_recovery usa _RECOVERY_KEY_VALIDATED como argjson (não string fixa false)
    if contains_pattern_in_files 'argjson key_validated|key_validated.*RECOVERY' "$_PTU_SCRIPT2" "$PRE_TOOL_USE_LIB"; then
        pass "V81-5: auto_recovery usa _RECOVERY_KEY_VALIDATED como argjson"
    else
        fail "V81-5: auto_recovery NÃO usa _RECOVERY_KEY_VALIDATED corretamente"
    fi
else
    fail "V81-0: pre-tool-use.sh não encontrado"
fi

# Teste V81-6: session-close.sh passa shellcheck -S error após fix
if shellcheck -S error "$_SC_SCRIPT" 2> /dev/null; then
    pass "V81-6: session-close.sh passa shellcheck -S error após fix v8.1"
else
    fail "V81-6: session-close.sh FALHOU no shellcheck -S error"
fi

# ── Grupo 21: Protocolo TODO Obrigatório v9.0 ─────────────────────────────────
echo ""
echo "── Grupo 21: Protocolo TODO Obrigatório v9.0 ──────────────────────────────"

_AG_STOP="$SCRIPTS_DIR/agent-stop.sh"
_AG_STOP_LIB="$HOOK_DIR/hooks-lib/agent-stop-lib.sh"
_LOG_PROMPT="$SCRIPTS_DIR/log-prompt.sh"
_POST_TOOL="$SCRIPTS_DIR/post-tool-use.sh"
_REPO_ROOT="$(cd "$HOOK_DIR/.." && pwd)"

# V90-1: post-tool-use.sh rastreia manage_todo_list → todo_created=true
if [ -f "$_POST_TOOL" ]; then
    if contains_pattern_in_files 'manage_todo_list' "$_POST_TOOL" "$POST_TOOL_USE_LIB" \
        && contains_pattern_in_files 'todo_created.*true' "$_POST_TOOL" "$POST_TOOL_USE_LIB"; then
        pass "V90-1: post-tool-use.sh seta todo_created=true quando manage_todo_list é chamado"
    else
        fail "V90-1: post-tool-use.sh NÃO rastreia manage_todo_list → todo_created"
    fi
else
    fail "V90-1: post-tool-use.sh não encontrado"
fi

# V90-2: log-prompt.sh reseta todo_created=false no início de cada turno
if [ -f "$_LOG_PROMPT" ]; then
    if contains_pattern_in_files 'todo_created.*false' "$_LOG_PROMPT" "$LOG_PROMPT_LIB"; then
        pass "V90-2: log-prompt.sh reseta todo_created=false no início de cada turno"
    else
        fail "V90-2: log-prompt.sh NÃO reseta todo_created — campo fica sujo entre TURNs"
    fi
else
    fail "V90-2: log-prompt.sh não encontrado"
fi

# V90-3: fluxo de block lê todo_created do contexto (inline ou helper)
if [ -f "$_AG_STOP" ]; then
    if grep -q '_BLOCK_TODO_CREATED\|block_todo_created' "$_AG_STOP" 2> /dev/null \
        || grep -q 'block_todo_created' "$_AG_STOP_LIB" 2> /dev/null; then
        pass "V90-3: fluxo do Stop lê todo_created do contexto (inline/helper)"
    else
        fail "V90-3: fluxo do Stop NÃO lê todo_created — sem distinção de violação dupla"
    fi
else
    fail "V90-3: agent-stop.sh não encontrado"
fi

# V90-4: agent-stop.sh emite agentStop_blocked_no_todo quando todo_created=false
if [ -f "$_AG_STOP" ]; then
    if grep -q 'agentStop_blocked_no_todo' "$_AG_STOP" 2> /dev/null \
        || grep -q 'agentStop_blocked_no_todo' "$_AG_STOP_LIB" 2> /dev/null; then
        pass "V90-4: agent-stop.sh emite evento agentStop_blocked_no_todo quando manage_todo_list ausente"
    else
        fail "V90-4: agent-stop.sh NÃO emite agentStop_blocked_no_todo — sem observabilidade de violação dupla"
    fi
else
    fail "V90-4: agent-stop.sh não encontrado"
fi

# V90-5: agent-stop.sh inclui DUPLA VIOLAÇÃO na mensagem quando todo_created=false
if [ -f "$_AG_STOP" ]; then
    if grep -q 'DUPLA' "$_AG_STOP" 2> /dev/null || grep -q 'DUPLA' "$_AG_STOP_LIB" 2> /dev/null; then
        pass "V90-5: agent-stop.sh usa mensagem de DUPLA VIOLAÇÃO quando manage_todo_list ausente"
    else
        fail "V90-5: agent-stop.sh NÃO diferencia mensagem de dupla violação"
    fi
else
    fail "V90-5: agent-stop.sh não encontrado"
fi

# V90-6: hooks-protocol.instructions.md contém PROTOCOLO TODO OBRIGATÓRIO
_HOOKS_PROTO="$_REPO_ROOT/instructions/hooks-protocol.instructions.md"
if [ -f "$_HOOKS_PROTO" ]; then
    if grep -q 'PROTOCOLO TODO OBRIGATÓRIO' "$_HOOKS_PROTO"; then
        pass "V90-6: hooks-protocol.instructions.md contém seção PROTOCOLO TODO OBRIGATÓRIO"
    else
        fail "V90-6: hooks-protocol.instructions.md NÃO contém PROTOCOLO TODO OBRIGATÓRIO"
    fi
else
    fail "V90-6: hooks-protocol.instructions.md não encontrado"
fi

# V90-7: AGENTS.md não contém linguagem 'recomendado, não obrigatório' na seção TURN
_AGENTS_MD="$_REPO_ROOT/AGENTS.md"
if [ -f "$_AGENTS_MD" ]; then
    if grep -q 'recomendado, não obrigatório' "$_AGENTS_MD"; then
        fail "V90-7: AGENTS.md AINDA contém 'recomendado, não obrigatório' na seção TURN — doc contradiz enforcement"
    else
        pass "V90-7: AGENTS.md NÃO contém linguagem contraditória 'recomendado, não obrigatório'"
    fi
else
    fail "V90-7: AGENTS.md não encontrado"
fi

# V90-8: log-prompt.sh emite session_id_in_payload no evento userPromptSubmitted
if [ -f "$_LOG_PROMPT" ]; then
    if contains_pattern_in_files 'session_id_in_payload' "$_LOG_PROMPT" "$LOG_PROMPT_LIB"; then
        pass "V90-8: log-prompt.sh inclui session_id_in_payload no evento userPromptSubmitted"
    else
        fail "V90-8: log-prompt.sh NÃO emite session_id_in_payload — perda de observabilidade"
    fi
else
    fail "V90-8: log-prompt.sh não encontrado"
fi

# V90-9: shellcheck -S error nos três scripts centrais do v9.0
_SC_ERRORS=0
for _SC_F in "$_AG_STOP" "$_LOG_PROMPT" "$_POST_TOOL"; do
    if ! shellcheck -S error "$_SC_F" 2> /dev/null; then
        _SC_ERRORS=$((_SC_ERRORS + 1))
    fi
done
if [ "$_SC_ERRORS" -eq 0 ]; then
    pass "V90-9: agent-stop.sh, log-prompt.sh e post-tool-use.sh passam shellcheck -S error"
else
    fail "V90-9: ${_SC_ERRORS} script(s) falhou no shellcheck -S error após mudanças v9.0"
fi

# V90-10: agent-stop.sh não incrementa consecutive_unauthorized quando stop_hook_active=true (anti-double-increment)
if [ -f "$_AG_STOP" ]; then
    if grep -q 'STOP_HOOK_ACTIVE.*consecutive\|stop_hook.*consecutive_unauthorized\|if \$stop_hook' "$_AG_STOP" 2> /dev/null \
        || grep -q 'mark_turn_unauthorized_in_context\|if \$stop_hook' "$_AG_STOP_LIB" 2> /dev/null; then
        pass "V90-10: agent-stop.sh usa guarda anti-duplo-incremento de consecutive_unauthorized (fix v9.0)"
    else
        fail "V90-10: agent-stop.sh NÃO tem guarda anti-duplo-incremento — bug: cada turn bloqueado conta 2x consecutivos"
    fi
else
    fail "V90-10: agent-stop.sh não encontrado"
fi

# V90-11: agent-stop.sh reseta todo_created=false no jq de fim de turno (reset canônico)
if [ -f "$_AG_STOP" ]; then
    if grep -q 'current_turn.todo_created.*=.*false' "$_AG_STOP" 2> /dev/null \
        || grep -q 'current_turn.todo_created.*=.*false' "$_AG_STOP_LIB" 2> /dev/null; then
        pass "V90-11: agent-stop.sh reseta current_turn.todo_created=false no reset de fim de turno"
    else
        fail "V90-11: agent-stop.sh NÃO reseta todo_created no fim de turno — campo fica sujo no contexto"
    fi
else
    fail "V90-11: agent-stop.sh não encontrado"
fi

_WD_SCRIPT="$SCRIPTS_DIR/watchdog.sh"

# V90-12: watchdog.sh detecta source=auto_recovery com ended_at não-nulo e trata como sessão ativa
if [ -f "$_WD_SCRIPT" ]; then
    if grep -q 'auto_recovery' "$_WD_SCRIPT" \
        && grep -q '_STALE_ENDED_AT_WARN' "$_WD_SCRIPT" \
        && grep -q 'STALE_ENDED_AT' "$_WD_SCRIPT"; then
        pass "V90-12: watchdog.sh detecta auto_recovery e emite alerta STALE_ENDED_AT (fix v9.0)"
    else
        fail "V90-12: watchdog.sh NÃO trata auto_recovery corretamente ou falta alerta STALE_ENDED_AT"
    fi
else
    fail "V90-12: watchdog.sh não encontrado"
fi

# V90-13: watchdog.sh usa threshold SESSION_STALE ≥ 24h (sessões longas são esperadas)
if [ -f "$_WD_SCRIPT" ]; then
    _STALE_VAL="$(grep -oP 'WATCHDOG_STALE_HOURS:-\K[0-9]+' "$_WD_SCRIPT" 2> /dev/null | head -1)"
    if [ -n "$_STALE_VAL" ] && [ "$_STALE_VAL" -ge 24 ] 2> /dev/null; then
        pass "V90-13: watchdog.sh SESSION_STALE threshold ≥ 24h (atual: ${_STALE_VAL}h — sessões longas não são falso-positivo)"
    else
        fail "V90-13: watchdog.sh SESSION_STALE threshold < 24h (${_STALE_VAL}h) — dispara falso-positivo em sessões longas"
    fi
else
    fail "V90-13: watchdog.sh não encontrado"
fi

# V90-14: watchdog.sh filtra STALE_ID_MISMATCHES por session_id, cutoff 6h e exclui subagente
if [ -f "$_WD_SCRIPT" ]; then
    if grep -q 'subagent-stop.sh' "$_WD_SCRIPT" \
        && grep -q '_MISMATCH_CUTOFF' "$_WD_SCRIPT" \
        && grep -q '6 hours ago' "$_WD_SCRIPT"; then
        pass "V90-14: watchdog.sh filtra STALE_ID_MISMATCHES por sessão atual, cutoff 6h e exclui ruído de subagente"
    else
        fail "V90-14: watchdog.sh NÃO filtra adequadamente STALE_ID_MISMATCHES (falta cutoff temporal ou filtro de subagente)"
    fi
else
    fail "V90-14: watchdog.sh não encontrado"
fi

# V90-15: agent-stop.sh atualiza last_turn_ts mesmo em turnos bloqueados (TURN_IDLE mede atividade)
if [ -f "$_AG_STOP" ]; then
    _V90_15_COUNT_MAIN_RAW="$(grep -c 'last_turn_ts.*now\|last_turn_ts.*NOW' "$_AG_STOP" 2> /dev/null || true)"
    _V90_15_COUNT_LIB_RAW="$(grep -c 'last_turn_ts.*now\|last_turn_ts.*NOW' "$_AG_STOP_LIB" 2> /dev/null || true)"
    _V90_15_COUNT_MAIN="$(printf '%s\n' "${_V90_15_COUNT_MAIN_RAW:-0}" | head -1 | tr -d '[:space:]')"
    _V90_15_COUNT_LIB="$(printf '%s\n' "${_V90_15_COUNT_LIB_RAW:-0}" | head -1 | tr -d '[:space:]')"
    [ -z "$_V90_15_COUNT_MAIN" ] && _V90_15_COUNT_MAIN=0
    [ -z "$_V90_15_COUNT_LIB" ] && _V90_15_COUNT_LIB=0
    _V90_15_COUNT_TOTAL=$((_V90_15_COUNT_MAIN + _V90_15_COUNT_LIB))
    if [ "$_V90_15_COUNT_TOTAL" -ge 2 ]; then
        pass "V90-15: agent-stop.sh atualiza last_turn_ts em bloqueios E em turnos normais (TURN_IDLE preciso)"
    else
        fail "V90-15: agent-stop.sh NÃO atualiza last_turn_ts em turnos bloqueados — TURN_IDLE falso-positivo"
    fi
else
    fail "V90-15: agent-stop.sh não encontrado"
fi

# V90-16: log-prompt.sh RECONNECT-02 — sessão com ended_at != null inicia sessão inline (BUG-PC-01)
# Cria sandbox isolado: HOOK_DIR = $sandbox via dirname(BASH_SOURCE[0])
_V16_DIR="$(mktemp -d)"
_V16_SCRIPTS="$_V16_DIR/scripts"
_V16_STATE="$_V16_DIR/state"
_V16_LOGS="$_V16_DIR/logs"
_V16_LIB="$_V16_DIR/hooks-lib"
mkdir -p "$_V16_SCRIPTS" "$_V16_STATE" "$_V16_LOGS" "$_V16_LIB"
cp -a "$SCRIPTS_DIR"/*.sh "$_V16_SCRIPTS/" 2> /dev/null || true
cp -a "$HOOK_DIR/hooks-lib/"* "$_V16_LIB/" 2> /dev/null || true
# Contexto com sessão encerrada: ended_at != null
cat > "$_V16_STATE/session-context.json" << 'V16CTX'
{
  "schema_version": 9,
  "session": {
    "id": "v16-old-sid",
    "close_key": "ENCERRAR-V16OLD",
    "close_key_validated": true,
    "started_at": "2026-01-01T00:00:00Z",
    "ended_at": "2026-01-01T01:00:00Z",
    "end_reason": "authorized_close",
    "source": "auto_recovery"
  },
  "current_section": {"name": "test", "section_id": "v16-s1", "section_number": 1, "turn_start": 0},
  "current_turn": {"number": 1, "section_turn": 1, "tools_count": 0, "auth_requested": false,
    "intent": null, "intent_declared": false, "todo_created": false, "agentStop_invocations": 0,
    "subagent_delegated": false},
  "session_stats": {"turn_count": 1, "turn_authorized": 1, "turn_no_askQuestions": 0,
    "turns_since_askQuestions": 0, "tools_total": 0, "push_count": 0,
    "pending_section_after_push": false, "failures_detected": 0},
  "compliance": {"consecutive_unauthorized": 0, "last_turn_authorized": true}
}
V16CTX
touch "$_V16_LOGS/audit.jsonl"
# Executa log-prompt.sh no sandbox (HOOK_DIR resolve para $_V16_DIR via dirname)
_V16_INPUT='{"timestamp":"2026-01-01T02:00:00Z","cwd":"/tmp","prompt":"test v90-16","session_id":"v16-new-sid"}'
echo "$_V16_INPUT" | bash "$_V16_SCRIPTS/log-prompt.sh" > /dev/null 2> /dev/null || true
_V16_SRC="$(jq -r '.session.source // ""' "$_V16_STATE/session-context.json" 2> /dev/null || echo '')"
_V16_EA="$(jq '.session.ended_at' "$_V16_STATE/session-context.json" 2> /dev/null || echo 'err')"
_V16_EVT_RAW="$(grep -c '"sessionStart_inline"' "$_V16_LOGS/audit.jsonl" 2> /dev/null || true)"
_V16_EVT="$(printf '%s\n' "${_V16_EVT_RAW:-0}" | tail -1 | tr -d '[:space:]')"
[ -z "$_V16_EVT" ] && _V16_EVT=0
if [ "$_V16_SRC" = "inline_restart" ] && [ "$_V16_EA" = "null" ] && [ "$_V16_EVT" -ge 1 ]; then
    pass "V90-16: log-prompt.sh RECONNECT-02 — ended_at!=null inicia inline_restart (source=inline_restart, ended_at=null, sessionStart_inline logado)"
else
    fail "V90-16: log-prompt.sh RECONNECT-02 FAIL — source='$_V16_SRC', ended_at='$_V16_EA', sessionStart_inline_count=$_V16_EVT"
fi
rm -rf "$_V16_DIR"

# V90-16B: log-prompt.sh RECONNECT-01 backfilla strict_turn_close_requires_key quando contexto legado não possui o campo
_V16B_DIR="$(mktemp -d)"
_V16B_SCRIPTS="$_V16B_DIR/scripts"
_V16B_STATE="$_V16B_DIR/state"
_V16B_LOGS="$_V16B_DIR/logs"
_V16B_LIB="$_V16B_DIR/hooks-lib"
mkdir -p "$_V16B_SCRIPTS" "$_V16B_STATE" "$_V16B_LOGS" "$_V16B_LIB"
cp -a "$SCRIPTS_DIR"/*.sh "$_V16B_SCRIPTS/" 2> /dev/null || true
cp -a "$HOOK_DIR/hooks-lib/"* "$_V16B_LIB/" 2> /dev/null || true
cat > "$_V16B_STATE/session-context.json" << 'V16BCTX'
{
    "session": {
        "id": "v16b-old-sid",
        "close_key": "ENCERRAR-V16BOLD",
        "close_key_validated": false,
        "started_at": "2026-01-01T00:00:00Z",
        "ended_at": null,
        "end_reason": null,
        "source": "auto_recovery"
    },
    "current_section": {"name": "test", "section_id": "v16b-s1", "section_number": 1, "turn_start": 0, "local_turn": 0},
    "current_turn": {"number": 1, "section_turn": 1, "tools_count": 0, "auth_requested": false, "intent": null, "intent_declared": false, "todo_created": false, "agentStop_invocations": 0, "subagent_delegated": false},
    "session_stats": {"turn_count": 1, "turn_authorized": 1, "turn_no_askQuestions": 0, "turns_since_askQuestions": 0, "tools_total": 0, "push_count": 0, "pending_section_after_push": false, "failures_detected": 0, "section_count": 1, "section_names": ["test"]},
    "compliance": {"consecutive_unauthorized": 0, "last_turn_authorized": true}
}
V16BCTX
touch "$_V16B_LOGS/audit.jsonl"
_V16B_INPUT='{"timestamp":"2026-01-01T02:00:00Z","cwd":"/tmp","prompt":"test v90-16b","session_id":"v16b-new-sid"}'
echo "$_V16B_INPUT" | bash "$_V16B_SCRIPTS/log-prompt.sh" > /dev/null 2> /dev/null || true
_V16B_SRC="$(jq -r '.session.source // ""' "$_V16B_STATE/session-context.json" 2> /dev/null || echo '')"
_V16B_SID="$(jq -r '.session.id // ""' "$_V16B_STATE/session-context.json" 2> /dev/null || echo '')"
_V16B_STRICT="$(jq -r '.session.strict_turn_close_requires_key // "MISSING"' "$_V16B_STATE/session-context.json" 2> /dev/null || echo 'MISSING')"
if [ "$_V16B_SRC" = "reconnect_rollover" ] && [ "$_V16B_SID" = "v16b-new-sid" ] && [ "$_V16B_STRICT" = "true" ]; then
    pass "V90-16B: reconnect_rollover faz backfill de strict_turn_close_requires_key em contexto legado"
else
    fail "V90-16B: reconnect_rollover sem backfill strict (source='$_V16B_SRC', sid='$_V16B_SID', strict='$_V16B_STRICT')"
fi
rm -rf "$_V16B_DIR"

# V90-17: watchdog.sh distingue close legítimo (end_reason=authorized_close) de stale ended_at (BUG-PC-02)
if [ -f "$WATCHDOG_SCRIPT" ]; then
    if grep -q 'authorized_close' "$WATCHDOG_SCRIPT" \
        && grep -q '_CTX_END_REASON\|end_reason' "$WATCHDOG_SCRIPT"; then
        pass "V90-17: watchdog.sh BUG-PC-02 — STALE_ENDED_AT distingue authorized_close de stale real (guard end_reason presente)"
    else
        fail "V90-17: watchdog.sh SEM guard authorized_close no STALE_ENDED_AT — BUG-PC-02 não aplicado"
    fi
else
    fail "V90-17: watchdog.sh não encontrado"
fi

# V90-18: post-tool-use.sh tem guard de idempotência para session-close.sh (BUG-PC-03)
_PTU_SCRIPT="$SCRIPTS_DIR/post-tool-use.sh"
if [ -f "$_PTU_SCRIPT" ]; then
    if contains_pattern_in_files '_ALREADY_VALIDATED' "$_PTU_SCRIPT" "$POST_TOOL_USE_LIB" \
        && contains_pattern_in_files 'close_key_validated // false' "$_PTU_SCRIPT" "$POST_TOOL_USE_LIB"; then
        pass "V90-18: post-tool-use.sh BUG-PC-03 — guard de idempotência (_ALREADY_VALIDATED) previne duplo sessionCloseAuthorized"
    else
        fail "V90-18: post-tool-use.sh SEM guard de idempotência — BUG-PC-03 não aplicado"
    fi
else
    fail "V90-18: post-tool-use.sh não encontrado"
fi

# V90-18B: post-tool-use.sh aplica backfill de strict_turn_close_requires_key (anti-lacuna em contextos legados)
if [ -f "$_PTU_SCRIPT" ]; then
    if contains_pattern_in_files 'ensure_strict_turn_close_flag_default' "$_PTU_SCRIPT" "$POST_TOOL_USE_LIB"; then
        pass "V90-18B: post-tool-use.sh aplica backfill da flag strict_turn_close_requires_key"
    else
        fail "V90-18B: post-tool-use.sh NÃO aplica backfill da flag strict_turn_close_requires_key"
    fi
else
    fail "V90-18B: post-tool-use.sh não encontrado"
fi

# V90-18C: log-prompt.sh preserva/força strict_turn_close_requires_key no reconnect_rollover e backfill geral
if [ -f "$_LOG_PROMPT" ]; then
    if contains_pattern_in_files 'strict_turn_close_requires_key = \(if \(\.session\.strict_turn_close_requires_key == null\) then true else \.session\.strict_turn_close_requires_key end\)' "$_LOG_PROMPT" "$LOG_PROMPT_LIB" \
        && contains_pattern_in_files 'ensure_strict_turn_close_flag_default' "$_LOG_PROMPT" "$LOG_PROMPT_LIB"; then
        pass "V90-18C: log-prompt.sh garante strict_turn_close_requires_key em reconnect_rollover + backfill"
    else
        fail "V90-18C: log-prompt.sh NÃO garante strict_turn_close_requires_key em reconnect_rollover/backfill"
    fi
else
    fail "V90-18C: log-prompt.sh não encontrado"
fi

# V90-18D: backfill strict também presente em session-close.sh, session-end.sh e agent-stop.sh
_SE_SCRIPT="$SCRIPTS_DIR/session-end.sh"
_SC_SCRIPT="$SCRIPTS_DIR/session-close.sh"
if [ -f "$_SE_SCRIPT" ] && [ -f "$_SC_SCRIPT" ] && [ -f "$_AG_STOP" ]; then
    if contains_pattern_in_files 'ensure_strict_turn_close_flag_default' "$_SE_SCRIPT" "$SESSION_END_LIB" 2> /dev/null \
        && grep -q 'strict_turn_close_requires_key' "$_SC_SCRIPT" 2> /dev/null \
        && contains_pattern_in_files 'ensure_strict_turn_close_flag_default' "$_AG_STOP" "$AGENT_STOP_LIB"; then
        pass "V90-18D: backfill strict coberto em session-close/session-end/agent-stop"
    else
        fail "V90-18D: cobertura de backfill strict incompleta em session-close/session-end/agent-stop"
    fi
else
    fail "V90-18D: scripts necessários não encontrados"
fi

# V90-19: agent-stop.sh invalida auth quando vscode_askQuestions não é a última ferramenta (v9.1)
if [ -f "$_AG_STOP" ]; then
    if { grep -q 'askquestions_not_last_tool' "$_AG_STOP" 2> /dev/null \
        || grep -q 'askquestions_not_last_tool' "$HOOK_DIR/hooks-lib/agent-stop-lib.sh" 2> /dev/null; } \
        && { grep -q 'last_tool.name' "$_AG_STOP" 2> /dev/null \
            || grep -q 'evaluate_turn_authorization' "$_AG_STOP" 2> /dev/null; }; then
        pass "V90-19: agent-stop.sh invalida auth quando vscode_askQuestions não é a última ferramenta"
    else
        fail "V90-19: agent-stop.sh NÃO valida regra de último ato para vscode_askQuestions"
    fi
else
    fail "V90-19: agent-stop.sh não encontrado"
fi

# V90-25: agent-stop.sh permite manage_todo_list após askQuestions (bookkeeping permitido)
if [ -f "$_AG_STOP" ]; then
    if { grep -q '_AUTH_LAST_NON_BOOKKEEPING_TOOL' "$_AG_STOP" 2> /dev/null \
        && grep -q 'is_bookkeeping_after_askquestions' "$_AG_STOP" 2> /dev/null; } \
        || { grep -q 'is_bookkeeping_after_askquestions' "$_AG_STOP_LIB" 2> /dev/null \
            && grep -q 'manage_todo_list' "$_AG_STOP_LIB" 2> /dev/null \
            && grep -q 'vscode_askQuestions' "$_AG_STOP_LIB" 2> /dev/null; }; then
        pass "V90-25: agent-stop.sh aceita sequência askQuestions -> manage_todo_list (bookkeeping)"
    else
        fail "V90-25: agent-stop.sh NÃO cobre exceção de bookkeeping após askQuestions"
    fi
else
    fail "V90-25: agent-stop.sh não encontrado"
fi

# V90-26: agent-stop.sh não duplica prefixo ENCERRAR- na instrução de close_key
if [ -f "$_AG_STOP" ]; then
    if { grep -q 'Digite " + \$key + " no campo de resposta' "$_AG_STOP" 2> /dev/null \
        || grep -q 'Digite \${_N3_CLOSE_KEY} no campo de resposta' "$_AG_STOP" 2> /dev/null \
        || grep -q 'Digite \${n3_close_key} no campo de resposta' "$HOOK_DIR/hooks-lib/agent-stop-lib.sh" 2> /dev/null; } \
        && ! grep -q 'ENCERRAR-ENCERRAR-' "$_AG_STOP" 2> /dev/null \
        && ! grep -q 'Digite ENCERRAR-" + \$key' "$_AG_STOP" 2> /dev/null; then
        pass "V90-26: instrução de close_key usa chave completa sem duplicar prefixo"
    else
        fail "V90-26: instrução de close_key ainda duplica prefixo ENCERRAR-"
    fi
else
    fail "V90-26: agent-stop.sh não encontrado"
fi

# V90-27: fluxo do Stop grava UNAUTHORIZED_CLOSE.flag em JSON canônico no block path
if [ -f "$_AG_STOP" ]; then
    if { grep -q 'turn_blocked_no_askquestions' "$_AG_STOP" 2> /dev/null \
        || grep -q 'turn_blocked_no_askquestions' "$_AG_STOP_LIB" 2> /dev/null; } \
        && { grep -q 'consecutive_unauthorized' "$_AG_STOP" 2> /dev/null \
            || grep -q 'consecutive_unauthorized' "$_AG_STOP_LIB" 2> /dev/null; } \
        && ! grep -Fq 'TURN_BLOCKED|' "$_AG_STOP" 2> /dev/null \
        && ! grep -Fq 'TURN_BLOCKED|' "$_AG_STOP_LIB" 2> /dev/null; then
        pass "V90-27: UNAUTHORIZED_CLOSE.flag usa schema JSON no caminho de bloqueio (inline/helper)"
    else
        fail "V90-27: UNAUTHORIZED_CLOSE.flag ainda usa formato texto legado no block path"
    fi
else
    fail "V90-27: agent-stop.sh não encontrado"
fi

# V90-28: log-prompt.sh sincroniza current-session-id e symlinks por TURN (P1)
if [ -f "$_LOG_PROMPT" ]; then
    if contains_pattern_in_files 'set_current_session_id' "$_LOG_PROMPT" "$LOG_PROMPT_LIB"; then
        pass "V90-28: log-prompt.sh sincroniza ponteiro current-session-id por TURN"
    else
        fail "V90-28: log-prompt.sh não sincroniza current-session-id"
    fi
else
    fail "V90-28: log-prompt.sh não encontrado"
fi

# V90-29: teste comportamental — sequência Template F + KEY -> manage_todo_list deve autorizar TURN
if [ -f "$_AG_STOP" ]; then
    _V29_DIR="$(mktemp -d)"
    _V29_SCRIPTS="$_V29_DIR/scripts"
    _V29_LIB="$_V29_DIR/hooks-lib"
    _V29_STATE="$_V29_DIR/state"
    _V29_LOGS="$_V29_DIR/logs"
    mkdir -p "$_V29_SCRIPTS" "$_V29_LIB" "$_V29_STATE" "$_V29_LOGS"
    cp -a "$HOOK_DIR/scripts/agent-stop.sh" "$_V29_SCRIPTS/" 2> /dev/null || true
    cp -a "$HOOK_DIR/scripts/session-checkpoint.sh" "$_V29_SCRIPTS/" 2> /dev/null || true
    cp -a "$HOOK_DIR/hooks-lib/"* "$_V29_LIB/" 2> /dev/null || true

    cat > "$_V29_STATE/session-context.json" << 'V29CTX'
{
    "session": {"id": "v90-29-sid", "close_key": "ENCERRAR-V90T29", "close_key_validated": true, "strict_turn_close_requires_key": true, "template_f_request_pending": true, "started_at": "2026-01-01T00:00:00Z"},
  "current_section": {"name": "teste", "section_id": "v29-sec", "section_number": 1, "turn_start": 1, "local_turn": 1},
  "current_turn": {
    "number": 2,
    "section_turn": 2,
    "started_at": "2026-01-01T00:01:00Z",
    "intent": "smoke v90-29",
    "intent_declared": true,
    "tools_count": 2,
    "failures_count": 0,
    "block_count": 0,
    "auth_requested": true,
    "auth_requested_at": "2026-01-01T00:01:20Z",
    "last_askquestions_response": "{\"answers\":{\"Session Close\":{\"selected\":[\"Encerrar sessão\"],\"freeText\":\"ENCERRAR-V90T29\",\"skipped\":false}}}",
    "last_askquestions_template": "template_f",
    "last_askquestions_close_action": "close_with_key",
    "last_askquestions_close_key_found": true,
    "last_non_bookkeeping_tool": "vscode_askQuestions",
    "todo_created": true,
    "todo_last_item_label": "Chamar vscode_askQuestions [Template A - continuidade]",
    "todo_last_item_is_askquestions_continuation": true,
    "todo_last_item_checked_at": "2026-01-01T00:01:30Z",
    "todo_protocol_version": "subturn_v1",
    "agentStop_invocations": 0,
    "subagent_delegated": false,
    "turn_id": "v29-turn"
  },
  "session_stats": {
    "turn_count": 1,
    "turn_authorized": 1,
    "turn_no_askQuestions": 0,
    "turns_since_askQuestions": 0,
    "tools_total": 4,
    "push_count": 0,
    "pending_section_after_push": false,
    "section_count": 1,
    "section_names": ["teste"],
    "recovery_hints": {}
  },
  "last_tool": {"name": "manage_todo_list", "ts": "2026-01-01T00:01:30Z", "use_id": "v29-tool", "result": "success"},
  "compliance": {"consecutive_unauthorized": 0, "last_turn_authorized": true, "flag_file_exists": false}
}
V29CTX

    cat > "$_V29_LOGS/audit.jsonl" << 'V29AUDIT'
{"event":"userPromptSubmitted","session_id":"v90-29-sid","timestamp":"2026-01-01T00:01:00Z"}
{"event":"postToolUse","session_id":"v90-29-sid","timestamp":"2026-01-01T00:01:20Z","tool_name":"vscode_askQuestions"}
{"event":"postToolUse","session_id":"v90-29-sid","timestamp":"2026-01-01T00:01:30Z","tool_name":"manage_todo_list"}
V29AUDIT

    _V29_OUT="$(echo '{"timestamp":"2026-01-01T00:02:00Z","session_id":"v90-29-sid","stop_hook_active":false}' | bash "$_V29_SCRIPTS/agent-stop.sh" 2> /dev/null || true)"
    if echo "$_V29_OUT" | grep -q '"decision"[[:space:]]*:[[:space:]]*"block"'; then
        fail "V90-29: sequência Template F+KEY->manage_todo_list foi bloqueada indevidamente"
    elif grep -q '"event":"turnEnd_authorized"' "$_V29_LOGS/audit.jsonl" 2> /dev/null; then
        pass "V90-29: sequência Template F+KEY->manage_todo_list autoriza TURN (teste comportamental)"
    else
        fail "V90-29: turnEnd_authorized não foi registrado no cenário válido"
    fi

    rm -rf "$_V29_DIR"
else
    fail "V90-29: agent-stop.sh não encontrado"
fi

# V90-30: teste comportamental — askQuestions seguido de outra tool deve bloquear TURN
if [ -f "$_AG_STOP" ]; then
    _V30_DIR="$(mktemp -d)"
    _V30_SCRIPTS="$_V30_DIR/scripts"
    _V30_LIB="$_V30_DIR/hooks-lib"
    _V30_STATE="$_V30_DIR/state"
    _V30_LOGS="$_V30_DIR/logs"
    mkdir -p "$_V30_SCRIPTS" "$_V30_LIB" "$_V30_STATE" "$_V30_LOGS"
    cp -a "$HOOK_DIR/scripts/agent-stop.sh" "$_V30_SCRIPTS/" 2> /dev/null || true
    cp -a "$HOOK_DIR/scripts/session-checkpoint.sh" "$_V30_SCRIPTS/" 2> /dev/null || true
    cp -a "$HOOK_DIR/hooks-lib/"* "$_V30_LIB/" 2> /dev/null || true

    cat > "$_V30_STATE/session-context.json" << 'V30CTX'
{
    "session": {"id": "v90-30-sid", "close_key": "ENCERRAR-V90T30", "close_key_validated": false, "strict_turn_close_requires_key": true, "started_at": "2026-01-01T00:00:00Z"},
  "current_section": {"name": "teste", "section_id": "v30-sec", "section_number": 1, "turn_start": 1, "local_turn": 1},
  "current_turn": {
    "number": 2,
    "section_turn": 2,
    "started_at": "2026-01-01T00:01:00Z",
    "intent": "smoke v90-30",
    "intent_declared": true,
    "tools_count": 3,
    "failures_count": 0,
    "block_count": 0,
    "auth_requested": true,
    "auth_requested_at": "2026-01-01T00:01:20Z",
    "last_askquestions_response": "{\"answers\":{\"Template A\":{\"selected\":[\"ok\"],\"freeText\":null,\"skipped\":false}}}",
    "todo_created": true,
    "agentStop_invocations": 0,
    "subagent_delegated": false,
    "turn_id": "v30-turn"
  },
  "session_stats": {
    "turn_count": 1,
    "turn_authorized": 1,
    "turn_no_askQuestions": 0,
    "turns_since_askQuestions": 0,
    "tools_total": 5,
    "push_count": 0,
    "pending_section_after_push": false,
    "section_count": 1,
    "section_names": ["teste"],
    "recovery_hints": {}
  },
  "last_tool": {"name": "run_in_terminal", "ts": "2026-01-01T00:01:40Z", "use_id": "v30-tool", "result": "success"},
  "compliance": {"consecutive_unauthorized": 0, "last_turn_authorized": true, "flag_file_exists": false}
}
V30CTX

    cat > "$_V30_LOGS/audit.jsonl" << 'V30AUDIT'
{"event":"userPromptSubmitted","session_id":"v90-30-sid","timestamp":"2026-01-01T00:01:00Z"}
{"event":"postToolUse","session_id":"v90-30-sid","timestamp":"2026-01-01T00:01:20Z","tool_name":"vscode_askQuestions"}
{"event":"postToolUse","session_id":"v90-30-sid","timestamp":"2026-01-01T00:01:40Z","tool_name":"run_in_terminal"}
V30AUDIT

    _V30_OUT="$(echo '{"timestamp":"2026-01-01T00:02:00Z","session_id":"v90-30-sid","stop_hook_active":false}' | bash "$_V30_SCRIPTS/agent-stop.sh" 2> /dev/null || true)"
    if echo "$_V30_OUT" | grep -q '"decision"[[:space:]]*:[[:space:]]*"block"' \
        && grep -q '"event":"turnAuth_invalidated"' "$_V30_LOGS/audit.jsonl" 2> /dev/null; then
        pass "V90-30: askQuestions seguido de outra tool bloqueia TURN (teste comportamental)"
    else
        fail "V90-30: cenário inválido não bloqueou TURN como esperado"
    fi

    rm -rf "$_V30_DIR"
else
    fail "V90-30: agent-stop.sh não encontrado"
fi

# V90-37: askQuestions de continuação sem opção de escalonamento para Template F deve bloquear TURN
if [ -f "$_AG_STOP" ]; then
    _V37_DIR="$(mktemp -d)"
    _V37_SCRIPTS="$_V37_DIR/scripts"
    _V37_LIB="$_V37_DIR/hooks-lib"
    _V37_STATE="$_V37_DIR/state"
    _V37_LOGS="$_V37_DIR/logs"
    mkdir -p "$_V37_SCRIPTS" "$_V37_LIB" "$_V37_STATE" "$_V37_LOGS"
    cp -a "$HOOK_DIR/scripts/agent-stop.sh" "$_V37_SCRIPTS/" 2> /dev/null || true
    cp -a "$HOOK_DIR/scripts/session-checkpoint.sh" "$_V37_SCRIPTS/" 2> /dev/null || true
    cp -a "$HOOK_DIR/hooks-lib/"* "$_V37_LIB/" 2> /dev/null || true

    cat > "$_V37_STATE/session-context.json" << 'V37CTX'
{
  "session": {"id": "v90-37-sid", "close_key": "ENCERRAR-V90T37", "close_key_validated": false, "strict_turn_close_requires_key": true, "started_at": "2026-01-01T00:00:00Z"},
  "current_section": {"name": "teste", "section_id": "v37-sec", "section_number": 1, "turn_start": 1, "local_turn": 1},
  "current_turn": {
    "number": 2,
    "section_turn": 2,
    "started_at": "2026-01-01T00:01:00Z",
    "intent": "smoke v90-37",
    "intent_declared": true,
    "tools_count": 1,
    "failures_count": 0,
    "block_count": 0,
    "auth_requested": true,
    "auth_requested_at": "2026-01-01T00:01:20Z",
    "last_askquestions_response": "{\"answers\":{\"Template A\":{\"selected\":[\"ok\"],\"freeText\":null,\"skipped\":false}}}",
    "last_askquestions_template": "other",
    "last_askquestions_close_action": "not_applicable",
    "last_askquestions_close_key_found": false,
    "last_non_bookkeeping_tool": "vscode_askQuestions",
    "last_askquestions_has_template_f_option": false,
    "todo_created": true,
    "todo_last_item_label": "Chamar vscode_askQuestions [Template A - continuidade]",
    "todo_last_item_is_askquestions_continuation": true,
    "todo_last_item_checked_at": "2026-01-01T00:01:20Z",
    "todo_protocol_version": "subturn_v1",
    "agentStop_invocations": 0,
    "subagent_delegated": false,
    "turn_id": "v37-turn"
  },
  "session_stats": {
    "turn_count": 1,
    "turn_authorized": 1,
    "turn_no_askQuestions": 0,
    "turns_since_askQuestions": 0,
    "tools_total": 3,
    "push_count": 0,
    "pending_section_after_push": false,
    "section_count": 1,
    "section_names": ["teste"],
    "recovery_hints": {}
  },
  "last_tool": {"name": "vscode_askQuestions", "ts": "2026-01-01T00:01:20Z", "use_id": "v37-tool", "result": "success"},
  "compliance": {"consecutive_unauthorized": 0, "last_turn_authorized": true, "flag_file_exists": false}
}
V37CTX

    cat > "$_V37_LOGS/audit.jsonl" << 'V37AUDIT'
{"event":"userPromptSubmitted","session_id":"v90-37-sid","timestamp":"2026-01-01T00:01:00Z"}
{"event":"postToolUse","session_id":"v90-37-sid","timestamp":"2026-01-01T00:01:20Z","tool_name":"vscode_askQuestions"}
V37AUDIT

    _V37_OUT="$(echo '{"timestamp":"2026-01-01T00:02:00Z","session_id":"v90-37-sid","stop_hook_active":false}' | bash "$_V37_SCRIPTS/agent-stop.sh" 2> /dev/null || true)"
    if echo "$_V37_OUT" | grep -q '"decision"[[:space:]]*:[[:space:]]*"block"' \
        && grep -q '"reason":"askquestions_missing_template_f_option"' "$_V37_LOGS/audit.jsonl" 2> /dev/null; then
        pass "V90-37: askQuestions sem opção de escalonamento para Template F é bloqueado"
    else
        fail "V90-37: ausência de opção de escalonamento para Template F não foi bloqueada"
    fi

    rm -rf "$_V37_DIR"
else
    fail "V90-37: agent-stop.sh não encontrado"
fi

# V90-31: session-start.sh registra evento canônico sessionStart no audit
_SESSION_START_SCRIPT="$SCRIPTS_DIR/session-start.sh"
if [ -f "$_SESSION_START_SCRIPT" ]; then
    if contains_pattern_in_files 'event "sessionStart"' "$_SESSION_START_SCRIPT" "$SESSION_START_EVENTS_LIB" \
        && contains_pattern_in_files 'Hook sessionStart processado' "$_SESSION_START_SCRIPT" "$SESSION_START_EVENTS_LIB"; then
        pass "V90-31: session-start.sh loga evento canônico sessionStart em audit.jsonl"
    else
        fail "V90-31: session-start.sh NÃO loga evento canônico sessionStart"
    fi
else
    fail "V90-31: session-start.sh não encontrado"
fi

# V90-38: teste comportamental — Template F sem KEY + manage_todo_list deve bloquear TURN (sem bypass de bookkeeping)
if [ -f "$_AG_STOP" ]; then
    _V38_DIR="$(mktemp -d)"
    _V38_SCRIPTS="$_V38_DIR/scripts"
    _V38_LIB="$_V38_DIR/hooks-lib"
    _V38_STATE="$_V38_DIR/state"
    _V38_LOGS="$_V38_DIR/logs"
    mkdir -p "$_V38_SCRIPTS" "$_V38_LIB" "$_V38_STATE" "$_V38_LOGS"
    cp -a "$HOOK_DIR/scripts/agent-stop.sh" "$_V38_SCRIPTS/" 2> /dev/null || true
    cp -a "$HOOK_DIR/scripts/session-checkpoint.sh" "$_V38_SCRIPTS/" 2> /dev/null || true
    cp -a "$HOOK_DIR/hooks-lib/"* "$_V38_LIB/" 2> /dev/null || true

    cat > "$_V38_STATE/session-context.json" << 'V38CTX'
{
  "session": {"id": "v90-38-sid", "close_key": "ENCERRAR-V90T38", "close_key_validated": false, "strict_turn_close_requires_key": true, "started_at": "2026-01-01T00:00:00Z"},
  "current_section": {"name": "teste", "section_id": "v38-sec", "section_number": 1, "turn_start": 1, "local_turn": 1},
  "current_turn": {
    "number": 2,
    "section_turn": 2,
    "started_at": "2026-01-01T00:01:00Z",
    "intent": "smoke v90-38",
    "intent_declared": true,
    "tools_count": 2,
    "failures_count": 0,
    "block_count": 0,
    "auth_requested": true,
    "auth_requested_at": "2026-01-01T00:01:20Z",
    "last_askquestions_response": "{\"answers\":{\"Template F — Session Close\":{\"selected\":[\"Continuar sessão\"],\"freeText\":null,\"skipped\":false}}}",
    "last_askquestions_template": "template_f",
    "last_askquestions_close_action": "cancel_or_continue",
    "last_askquestions_close_key_found": false,
    "last_non_bookkeeping_tool": "vscode_askQuestions",
    "todo_created": true,
    "agentStop_invocations": 0,
    "subagent_delegated": false,
    "turn_id": "v38-turn"
  },
  "session_stats": {
    "turn_count": 1,
    "turn_authorized": 1,
    "turn_no_askQuestions": 0,
    "turns_since_askQuestions": 0,
    "tools_total": 4,
    "push_count": 0,
    "pending_section_after_push": false,
    "section_count": 1,
    "section_names": ["teste"],
    "recovery_hints": {}
  },
  "last_tool": {"name": "manage_todo_list", "ts": "2026-01-01T00:01:30Z", "use_id": "v38-tool", "result": "success"},
  "compliance": {"consecutive_unauthorized": 0, "last_turn_authorized": true, "flag_file_exists": false}
}
V38CTX

    cat > "$_V38_LOGS/audit.jsonl" << 'V38AUDIT'
{"event":"userPromptSubmitted","session_id":"v90-38-sid","timestamp":"2026-01-01T00:01:00Z"}
{"event":"postToolUse","session_id":"v90-38-sid","timestamp":"2026-01-01T00:01:20Z","tool_name":"vscode_askQuestions"}
{"event":"postToolUse","session_id":"v90-38-sid","timestamp":"2026-01-01T00:01:30Z","tool_name":"manage_todo_list"}
V38AUDIT

    _V38_OUT="$(echo '{"timestamp":"2026-01-01T00:02:00Z","session_id":"v90-38-sid","stop_hook_active":false}' | bash "$_V38_SCRIPTS/agent-stop.sh" 2> /dev/null || true)"
    if echo "$_V38_OUT" | grep -q '"decision"[[:space:]]*:[[:space:]]*"block"' \
        && grep -q '"event":"turnAuth_invalidated"' "$_V38_LOGS/audit.jsonl" 2> /dev/null; then
        pass "V90-38: modo estrito bloqueia Template F sem KEY mesmo com manage_todo_list no fim"
    else
        fail "V90-38: bypass de bookkeeping permitiu fechamento sem KEY válida"
    fi

    rm -rf "$_V38_DIR"
else
    fail "V90-38: agent-stop.sh não encontrado"
fi

# V90-39: agentStop_blocked diferencia ausência de askQuestions vs autorização inválida
if [ -f "$_AG_STOP" ] && [ -f "$_AG_STOP_LIB" ]; then
    if grep -q 'block_reason' "$_AG_STOP_LIB" 2> /dev/null \
        && grep -q 'invalid_reason' "$_AG_STOP_LIB" 2> /dev/null \
        && { grep -q 'turn_blocked_invalid_authorization' "$_AG_STOP" 2> /dev/null \
            || grep -q 'turn_blocked_invalid_authorization' "$_AG_STOP_LIB" 2> /dev/null; }; then
        pass "V90-39: observabilidade do bloqueio distingue no_askquestions de invalid_authorization"
    else
        fail "V90-39: sem campos de causa em agentStop_blocked/UNAUTHORIZED_CLOSE.flag"
    fi
else
    fail "V90-39: agent-stop.sh ou agent-stop-lib.sh não encontrado"
fi

# V90-40: continuidade não-Template F deve autorizar fechamento de TURN mesmo com strict=false
if [ -f "$_AG_STOP" ]; then
    _V40_DIR="$(mktemp -d)"
    _V40_SCRIPTS="$_V40_DIR/scripts"
    _V40_LIB="$_V40_DIR/hooks-lib"
    _V40_STATE="$_V40_DIR/state"
    _V40_LOGS="$_V40_DIR/logs"
    mkdir -p "$_V40_SCRIPTS" "$_V40_LIB" "$_V40_STATE" "$_V40_LOGS"
    cp -a "$HOOK_DIR/scripts/agent-stop.sh" "$_V40_SCRIPTS/" 2> /dev/null || true
    cp -a "$HOOK_DIR/scripts/session-checkpoint.sh" "$_V40_SCRIPTS/" 2> /dev/null || true
    cp -a "$HOOK_DIR/hooks-lib/"* "$_V40_LIB/" 2> /dev/null || true

    cat > "$_V40_STATE/session-context.json" << 'V40CTX'
{
  "session": {"id": "v90-40-sid", "close_key": "ENCERRAR-V90T40", "close_key_validated": false, "strict_turn_close_requires_key": false, "started_at": "2026-01-01T00:00:00Z"},
  "current_section": {"name": "teste", "section_id": "v40-sec", "section_number": 1, "turn_start": 1, "local_turn": 1},
  "current_turn": {
    "number": 2,
    "section_turn": 2,
    "started_at": "2026-01-01T00:01:00Z",
    "intent": "smoke v90-40",
    "intent_declared": true,
    "tools_count": 1,
    "failures_count": 0,
    "block_count": 0,
    "auth_requested": true,
    "auth_requested_at": "2026-01-01T00:01:20Z",
    "last_askquestions_response": "{\"answers\":{\"Template A\":{\"selected\":[\"ok\"],\"freeText\":null,\"skipped\":false}}}",
    "last_askquestions_template": "other",
    "last_askquestions_close_action": "not_applicable",
    "last_askquestions_close_key_found": false,
    "last_non_bookkeeping_tool": "vscode_askQuestions",
    "todo_created": true,
    "todo_last_item_label": "Chamar vscode_askQuestions [Template A - continuidade]",
    "todo_last_item_is_askquestions_continuation": true,
    "todo_last_item_checked_at": "2026-01-01T00:01:20Z",
    "todo_protocol_version": "subturn_v1",
    "agentStop_invocations": 0,
    "subagent_delegated": false,
    "turn_id": "v40-turn"
  },
  "session_stats": {
    "turn_count": 1,
    "turn_authorized": 1,
    "turn_no_askQuestions": 0,
    "turns_since_askQuestions": 0,
    "tools_total": 3,
    "push_count": 0,
    "pending_section_after_push": false,
    "section_count": 1,
    "section_names": ["teste"],
    "recovery_hints": {}
  },
  "last_tool": {"name": "vscode_askQuestions", "ts": "2026-01-01T00:01:20Z", "use_id": "v40-tool", "result": "success"},
  "compliance": {"consecutive_unauthorized": 0, "last_turn_authorized": true, "flag_file_exists": false}
}
V40CTX

    cat > "$_V40_LOGS/audit.jsonl" << 'V40AUDIT'
{"event":"userPromptSubmitted","session_id":"v90-40-sid","timestamp":"2026-01-01T00:01:00Z"}
{"event":"postToolUse","session_id":"v90-40-sid","timestamp":"2026-01-01T00:01:20Z","tool_name":"vscode_askQuestions"}
V40AUDIT

    _V40_OUT="$(echo '{"timestamp":"2026-01-01T00:02:00Z","session_id":"v90-40-sid","stop_hook_active":false}' | bash "$_V40_SCRIPTS/agent-stop.sh" 2> /dev/null || true)"
    if ! echo "$_V40_OUT" | grep -q '"decision"[[:space:]]*:[[:space:]]*"block"' \
        && grep -q '"event":"turnEnd_authorized"' "$_V40_LOGS/audit.jsonl" 2> /dev/null; then
        pass "V90-40: continuidade não-Template F autoriza fechamento de TURN com strict=false"
    else
        fail "V90-40: continuidade não-Template F deveria autorizar fechamento de TURN com strict=false"
    fi

    rm -rf "$_V40_DIR"
else
    fail "V90-40: agent-stop.sh não encontrado"
fi

# V90-41: Template F com KEY válida sem solicitação prévia deve bloquear TURN
if [ -f "$_AG_STOP" ]; then
    _V41_DIR="$(mktemp -d)"
    _V41_SCRIPTS="$_V41_DIR/scripts"
    _V41_LIB="$_V41_DIR/hooks-lib"
    _V41_STATE="$_V41_DIR/state"
    _V41_LOGS="$_V41_DIR/logs"
    mkdir -p "$_V41_SCRIPTS" "$_V41_LIB" "$_V41_STATE" "$_V41_LOGS"
    cp -a "$HOOK_DIR/scripts/agent-stop.sh" "$_V41_SCRIPTS/" 2> /dev/null || true
    cp -a "$HOOK_DIR/scripts/session-checkpoint.sh" "$_V41_SCRIPTS/" 2> /dev/null || true
    cp -a "$HOOK_DIR/hooks-lib/"* "$_V41_LIB/" 2> /dev/null || true

    cat > "$_V41_STATE/session-context.json" << 'V41CTX'
{
  "session": {"id": "v90-41-sid", "close_key": "ENCERRAR-V90T41", "close_key_validated": true, "strict_turn_close_requires_key": true, "template_f_request_pending": false, "started_at": "2026-01-01T00:00:00Z"},
  "current_section": {"name": "teste", "section_id": "v41-sec", "section_number": 1, "turn_start": 1, "local_turn": 1},
  "current_turn": {
    "number": 2,
    "section_turn": 2,
    "started_at": "2026-01-01T00:01:00Z",
    "intent": "smoke v90-41",
    "intent_declared": true,
    "tools_count": 1,
    "failures_count": 0,
    "block_count": 0,
    "auth_requested": true,
    "auth_requested_at": "2026-01-01T00:01:20Z",
    "last_askquestions_response": "{\"answers\":{\"Session Close\":{\"selected\":[\"Encerrar sessão\"],\"freeText\":\"ENCERRAR-V90T41\",\"skipped\":false}}}",
    "last_askquestions_template": "template_f",
    "last_askquestions_close_action": "close_with_key",
    "last_askquestions_close_key_found": true,
    "last_askquestions_has_template_f_option": true,
    "last_non_bookkeeping_tool": "vscode_askQuestions",
    "todo_created": true,
    "todo_last_item_label": "Chamar vscode_askQuestions [Template A - continuidade]",
    "todo_last_item_is_askquestions_continuation": true,
    "todo_last_item_checked_at": "2026-01-01T00:01:20Z",
    "todo_protocol_version": "subturn_v1",
    "agentStop_invocations": 0,
    "subagent_delegated": false,
    "turn_id": "v41-turn"
  },
  "session_stats": {
    "turn_count": 1,
    "turn_authorized": 1,
    "turn_no_askQuestions": 0,
    "turns_since_askQuestions": 0,
    "tools_total": 3,
    "push_count": 0,
    "pending_section_after_push": false,
    "section_count": 1,
    "section_names": ["teste"],
    "recovery_hints": {}
  },
  "last_tool": {"name": "vscode_askQuestions", "ts": "2026-01-01T00:01:20Z", "use_id": "v41-tool", "result": "success"},
  "compliance": {"consecutive_unauthorized": 0, "last_turn_authorized": true, "flag_file_exists": false}
}
V41CTX

    cat > "$_V41_LOGS/audit.jsonl" << 'V41AUDIT'
{"event":"userPromptSubmitted","session_id":"v90-41-sid","timestamp":"2026-01-01T00:01:00Z"}
{"event":"postToolUse","session_id":"v90-41-sid","timestamp":"2026-01-01T00:01:20Z","tool_name":"vscode_askQuestions"}
V41AUDIT

    _V41_OUT="$(echo '{"timestamp":"2026-01-01T00:02:00Z","session_id":"v90-41-sid","stop_hook_active":false}' | bash "$_V41_SCRIPTS/agent-stop.sh" 2> /dev/null || true)"
    if echo "$_V41_OUT" | grep -q '"decision"[[:space:]]*:[[:space:]]*"block"' \
        && grep -q '"reason":"template_f_called_without_prior_request"' "$_V41_LOGS/audit.jsonl" 2> /dev/null; then
        pass "V90-41: Template F sem solicitação prévia é bloqueado mesmo com KEY válida"
    else
        fail "V90-41: Template F sem solicitação prévia não foi bloqueado como esperado"
    fi

    rm -rf "$_V41_DIR"
else
    fail "V90-41: agent-stop.sh não encontrado"
fi

# V90-42: em modo estrito, continuidade não-Template F com opção de escalonamento autoriza fechamento de TURN
if [ -f "$_AG_STOP" ]; then
    _V42_DIR="$(mktemp -d)"
    _V42_SCRIPTS="$_V42_DIR/scripts"
    _V42_LIB="$_V42_DIR/hooks-lib"
    _V42_STATE="$_V42_DIR/state"
    _V42_LOGS="$_V42_DIR/logs"
    mkdir -p "$_V42_SCRIPTS" "$_V42_LIB" "$_V42_STATE" "$_V42_LOGS"
    cp -a "$HOOK_DIR/scripts/agent-stop.sh" "$_V42_SCRIPTS/" 2> /dev/null || true
    cp -a "$HOOK_DIR/scripts/session-checkpoint.sh" "$_V42_SCRIPTS/" 2> /dev/null || true
    cp -a "$HOOK_DIR/hooks-lib/"* "$_V42_LIB/" 2> /dev/null || true

    cat > "$_V42_STATE/session-context.json" << 'V42CTX'
{
  "session": {"id": "v90-42-sid", "close_key": "ENCERRAR-V90T42", "close_key_validated": false, "strict_turn_close_requires_key": true, "template_f_request_pending": false, "started_at": "2026-01-01T00:00:00Z"},
  "current_section": {"name": "teste", "section_id": "v42-sec", "section_number": 1, "turn_start": 1, "local_turn": 1},
  "current_turn": {
    "number": 2,
    "section_turn": 2,
    "started_at": "2026-01-01T00:01:00Z",
    "intent": "smoke v90-42",
    "intent_declared": true,
    "tools_count": 1,
    "failures_count": 0,
    "block_count": 0,
    "auth_requested": true,
    "auth_requested_at": "2026-01-01T00:01:20Z",
    "last_askquestions_response": "{\"answers\":{\"Template A\":{\"selected\":[\"ok\"],\"freeText\":null,\"skipped\":false}}}",
    "last_askquestions_template": "other",
    "last_askquestions_close_action": "not_applicable",
    "last_askquestions_close_key_found": false,
    "last_askquestions_has_template_f_option": true,
    "last_non_bookkeeping_tool": "vscode_askQuestions",
    "todo_created": true,
    "todo_last_item_label": "Chamar vscode_askQuestions [Template A - continuidade]",
    "todo_last_item_is_askquestions_continuation": true,
    "todo_last_item_checked_at": "2026-01-01T00:01:20Z",
    "todo_protocol_version": "subturn_v1",
    "agentStop_invocations": 0,
    "subagent_delegated": false,
    "turn_id": "v42-turn"
  },
  "session_stats": {
    "turn_count": 1,
    "turn_authorized": 1,
    "turn_no_askQuestions": 0,
    "turns_since_askQuestions": 0,
    "tools_total": 3,
    "push_count": 0,
    "pending_section_after_push": false,
    "section_count": 1,
    "section_names": ["teste"],
    "recovery_hints": {}
  },
  "last_tool": {"name": "vscode_askQuestions", "ts": "2026-01-01T00:01:20Z", "use_id": "v42-tool", "result": "success"},
  "compliance": {"consecutive_unauthorized": 0, "last_turn_authorized": true, "flag_file_exists": false}
}
V42CTX

    cat > "$_V42_LOGS/audit.jsonl" << 'V42AUDIT'
{"event":"userPromptSubmitted","session_id":"v90-42-sid","timestamp":"2026-01-01T00:01:00Z"}
{"event":"postToolUse","session_id":"v90-42-sid","timestamp":"2026-01-01T00:01:20Z","tool_name":"vscode_askQuestions"}
V42AUDIT

    _V42_OUT="$(echo '{"timestamp":"2026-01-01T00:02:00Z","session_id":"v90-42-sid","stop_hook_active":false}' | bash "$_V42_SCRIPTS/agent-stop.sh" 2> /dev/null || true)"
    if ! echo "$_V42_OUT" | grep -q '"decision"[[:space:]]*:[[:space:]]*"block"' \
        && grep -q '"event":"turnEnd_authorized"' "$_V42_LOGS/audit.jsonl" 2> /dev/null; then
        pass "V90-42: modo estrito autoriza fechamento de TURN após continuidade não-Template F válida"
    else
        fail "V90-42: continuidade não-Template F válida deveria autorizar fechamento de TURN"
    fi

    rm -rf "$_V42_DIR"
else
    fail "V90-42: agent-stop.sh não encontrado"
fi

# V90-43: sem CTX, mesmo com sinal de askQuestions no audit, TURN deve bloquear
if [ -f "$_AG_STOP" ]; then
    _V43_DIR="$(mktemp -d)"
    _V43_SCRIPTS="$_V43_DIR/scripts"
    _V43_LIB="$_V43_DIR/hooks-lib"
    _V43_STATE="$_V43_DIR/state"
    _V43_LOGS="$_V43_DIR/logs"
    mkdir -p "$_V43_SCRIPTS" "$_V43_LIB" "$_V43_STATE" "$_V43_LOGS"
    cp -a "$HOOK_DIR/scripts/agent-stop.sh" "$_V43_SCRIPTS/" 2> /dev/null || true
    cp -a "$HOOK_DIR/scripts/session-checkpoint.sh" "$_V43_SCRIPTS/" 2> /dev/null || true
    cp -a "$HOOK_DIR/hooks-lib/"* "$_V43_LIB/" 2> /dev/null || true

    # Deliberadamente NÃO cria session-context.json
    cat > "$_V43_LOGS/audit.jsonl" << 'V43AUDIT'
{"event":"userPromptSubmitted","session_id":"v90-43-sid","timestamp":"2026-01-01T00:01:00Z"}
{"event":"postToolUse","session_id":"v90-43-sid","timestamp":"2026-01-01T00:01:20Z","tool_name":"vscode_askQuestions"}
V43AUDIT

    _V43_OUT="$(echo '{"timestamp":"2026-01-01T00:02:00Z","session_id":"v90-43-sid","stop_hook_active":false}' | bash "$_V43_SCRIPTS/agent-stop.sh" 2> /dev/null || true)"
    if echo "$_V43_OUT" | grep -q '"decision"[[:space:]]*:[[:space:]]*"block"' \
        && echo "$_V43_OUT" | grep -q '"hookEventName"[[:space:]]*:[[:space:]]*"Stop"'; then
        pass "V90-43: sem CTX não existe autorização legítima — block obrigatório aplicado"
    else
        fail "V90-43: sem CTX o TURN não foi bloqueado como deveria"
    fi

    rm -rf "$_V43_DIR"
else
    fail "V90-43: agent-stop.sh não encontrado"
fi

# V90-44: P7.1 — pre-tool-use registra turnClose_prevented_dual_lock no lock primário
_PRE_TOOL_SCRIPT="$SCRIPTS_DIR/pre-tool-use.sh"
if [ -f "$_PRE_TOOL_SCRIPT" ]; then
    if contains_pattern_in_files 'turnClose_prevented_dual_lock' "$_PRE_TOOL_SCRIPT" "$PRE_TOOL_USE_LIB" \
        && contains_pattern_in_files 'lock_stage.*preToolUse|"preToolUse"' "$_PRE_TOOL_SCRIPT" "$PRE_TOOL_USE_LIB"; then
        pass "V90-44: pre-tool-use implementa lock primário e loga turnClose_prevented_dual_lock"
    else
        fail "V90-44: pre-tool-use não loga turnClose_prevented_dual_lock no lock primário"
    fi
else
    fail "V90-44: pre-tool-use.sh não encontrado"
fi

# V90-45: P7.1/P7.5 — agent-stop implementa lock secundário + decisionTrace em block
if [ -f "$_AG_STOP" ] && [ -f "$_AG_STOP_LIB" ]; then
    if { grep -q 'turnClose_prevented_dual_lock' "$_AG_STOP" 2> /dev/null \
        || grep -q 'turnClose_prevented_dual_lock' "$_AG_STOP_LIB" 2> /dev/null; } \
        && grep -q 'decisionTrace\|build_decision_trace_json' "$_AG_STOP_LIB" 2> /dev/null; then
        pass "V90-45: agent-stop implementa lock secundário e decisão explicável (decisionTrace)"
    else
        fail "V90-45: agent-stop sem lock secundário ou sem decisionTrace"
    fi
else
    fail "V90-45: agent-stop.sh ou agent-stop-lib.sh não encontrado"
fi

# V90-46: P7.2 — budget anti-loop de reblock está presente
if [ -f "$_AG_STOP" ]; then
    if grep -q 'stop_block_budget_max\|stop_block_budget_exceeded' "$_AG_STOP" 2> /dev/null \
        || grep -q 'stop_block_budget_max\|stop_block_budget_exceeded' "$_AG_STOP_LIB" 2> /dev/null; then
        pass "V90-46: agent-stop possui budget anti-loop para reblock (P7.2)"
    else
        fail "V90-46: agent-stop não possui budget anti-loop para reblock"
    fi
else
    fail "V90-46: agent-stop.sh não encontrado"
fi

# V90-47: P7.3 — schema de contexto de autorização existe e é JSON válido
_TURN_AUTH_SCHEMA="$HOOK_DIR/contracts/turn-authorization-context.schema.json"
if [ -f "$_TURN_AUTH_SCHEMA" ]; then
    if jq empty "$_TURN_AUTH_SCHEMA" 2> /dev/null; then
        pass "V90-47: turn-authorization-context.schema.json existe e é JSON válido"
    else
        fail "V90-47: turn-authorization-context.schema.json existe mas é inválido"
    fi
else
    fail "V90-47: schema turn-authorization-context não encontrado"
fi

# V90-48: P7.3 — agent-stop valida contrato de autorização e bloqueia em contexto inválido
if [ -f "$_AG_STOP" ] && [ -f "$_AG_STOP_LIB" ]; then
    if { grep -q 'validate_turn_authorization_context_json' "$_AG_STOP" 2> /dev/null \
        || grep -q 'apply_turn_authorization_contract_guard' "$_AG_STOP" 2> /dev/null; } \
        && grep -q 'turn_auth_context_invalid' "$_AG_STOP_LIB" 2> /dev/null; then
        pass "V90-48: contrato de autorização é validado e possui reason de bloqueio dedicado"
    else
        fail "V90-48: validação/razão de contrato inválido não encontrada no fluxo do Stop"
    fi
else
    fail "V90-48: agent-stop.sh ou agent-stop-lib.sh não encontrado"
fi

# V90-52: M4 — guard contratual modularizado via helper único
if [ -f "$_AG_STOP" ] && [ -f "$_AG_STOP_LIB" ]; then
    if grep -q 'apply_turn_authorization_contract_guard' "$_AG_STOP" 2> /dev/null \
        && grep -q 'apply_turn_authorization_contract_guard' "$_AG_STOP_LIB" 2> /dev/null; then
        pass "V90-52: guard contratual do TURN foi modularizado (agent-stop -> helper)"
    else
        fail "V90-52: guard contratual ainda não está modularizado conforme M4"
    fi
else
    fail "V90-52: agent-stop.sh ou agent-stop-lib.sh não encontrado"
fi

# V90-56: mensagem de block em modo estrito orienta fechamento com askQuestions de continuidade (A/D/E)
if [ -f "$_AG_STOP_LIB" ]; then
    if grep -q 'required_turn_close_action="vscode_askQuestions de continuidade \(Template A/D/E\)"' "$_AG_STOP_LIB" 2> /dev/null \
        && grep -q 'Fechamento legítimo deste TURN exige \${required_turn_close_action}' "$_AG_STOP_LIB" 2> /dev/null; then
        pass "V90-56: helper de block orienta explicitamente askQuestions de continuidade (A/D/E) no modo estrito"
    else
        fail "V90-56: helper de block não orienta explicitamente askQuestions de continuidade (A/D/E)"
    fi
else
    fail "V90-56: agent-stop-lib.sh não encontrado"
fi

# V90-57: agent-stop propaga strict_turn_close_requires_key ao payload builder
if [ -f "$_AG_STOP" ]; then
    if grep -q 'build_turn_block_payload "\$_BLOCK_TODO_CREATED" "\$AUTH_INVALID_REASON" "\$_BLOCK_SESSION_INFO" "\$_BLOCK_STRICT_MODE"' "$_AG_STOP" 2> /dev/null \
        || grep -q 'build_turn_block_payload .*block_todo_created.*auth_invalid_reason.*block_session_info.*block_strict_mode' "$_AG_STOP_LIB" 2> /dev/null; then
        pass "V90-57: agent-stop envia flag strict para build_turn_block_payload"
    else
        fail "V90-57: agent-stop não propaga strict mode ao payload de block"
    fi
else
    fail "V90-57: agent-stop.sh não encontrado"
fi

# V90-58: payload Stop preserva compatibilidade top-level (decision/decisionReason)
if [ -f "$_AG_STOP_LIB" ]; then
    if grep -q 'decision: "block"' "$_AG_STOP_LIB" 2> /dev/null \
        && grep -q 'decisionReason: \$reason' "$_AG_STOP_LIB" 2> /dev/null; then
        pass "V90-58: emit_stop_block mantém campos top-level de decisão para compatibilidade"
    else
        fail "V90-58: emit_stop_block sem campos top-level de decisão (risco de block ignorado)"
    fi
else
    fail "V90-58: agent-stop-lib.sh não encontrado"
fi

# V90-59: payload Stop mantém hookSpecificOutput do evento Stop
if [ -f "$_AG_STOP_LIB" ]; then
    if grep -q 'hookEventName: "Stop"' "$_AG_STOP_LIB" 2> /dev/null \
        && grep -q 'hookSpecificOutput' "$_AG_STOP_LIB" 2> /dev/null; then
        pass "V90-59: emit_stop_block mantém hookSpecificOutput para Stop"
    else
        fail "V90-59: emit_stop_block sem hookSpecificOutput de Stop"
    fi
else
    fail "V90-59: agent-stop-lib.sh não encontrado"
fi

# V90-55: M4 — atualização de subturn bloqueado modularizada em helper
if [ -f "$_AG_STOP" ] && [ -f "$_AG_STOP_LIB" ]; then
    if grep -q 'record_blocked_subturn_and_schedule_resume' "$_AG_STOP_LIB" 2> /dev/null \
        && { grep -q 'record_blocked_subturn_and_schedule_resume' "$_AG_STOP" 2> /dev/null \
            || grep -q 'handle_main_stop_block_branch' "$_AG_STOP" 2> /dev/null; }; then
        pass "V90-55: bloco de subturn bloqueado foi extraído para helper M4"
    else
        fail "V90-55: bloco de subturn bloqueado ainda não está modularizado"
    fi
else
    fail "V90-55: agent-stop.sh ou agent-stop-lib.sh não encontrado"
fi

# V90-51: semântica explícita — decision:block no Stop bloqueia fechamento e força continuação
if [ -f "$_AG_STOP_LIB" ]; then
    if grep -q 'hookEventName: "Stop"' "$_AG_STOP_LIB" 2> /dev/null \
        && grep -q 'FECHAMENTO DO TURN BLOQUEADO' "$_AG_STOP_LIB" 2> /dev/null; then
        pass "V90-51: semântica de block explícita (bloqueia fechamento, agente continua)"
    else
        fail "V90-51: semântica de block vs continuação ainda ambígua no payload do Stop"
    fi
else
    fail "V90-51: agent-stop-lib.sh não encontrado"
fi

# V90-49: P7.6 — baseline de segurança em .vscode/settings.json (quando presente)
_VSCODE_SETTINGS="$HOOK_DIR/../../.vscode/settings.json"
if [ -f "$_VSCODE_SETTINGS" ]; then
    if jq empty "$_VSCODE_SETTINGS" 2> /dev/null; then
        _S_GLOBAL_AUTO="$(jq -r '."chat.tools.global.autoApprove" // false' "$_VSCODE_SETTINGS" 2> /dev/null || echo false)"
        _S_TERM_AUTO="$(jq -r '."chat.tools.terminal.enableAutoApprove" // false' "$_VSCODE_SETTINGS" 2> /dev/null || echo false)"
        _S_HOOKS_ON="$(jq -r 'if has("chat.useHooks") then ."chat.useHooks" else true end' "$_VSCODE_SETTINGS" 2> /dev/null || echo true)"
        if [ "$_S_GLOBAL_AUTO" != "true" ] && [ "$_S_TERM_AUTO" != "true" ] && [ "$_S_HOOKS_ON" = "true" ]; then
            pass "V90-49: baseline de segurança OK (auto-approve global/terminal desativado; hooks ativos)"
        else
            fail "V90-49: baseline inseguro em .vscode/settings.json (globalAuto=$_S_GLOBAL_AUTO terminalAuto=$_S_TERM_AUTO hooks=$_S_HOOKS_ON)"
        fi
    else
        pass "V90-49: .vscode/settings.json em JSONC/não parseável por jq — baseline local não validado por smoke"
    fi
else
    pass "V90-49: .vscode/settings.json ausente (baseline local não aplicável neste workspace)"
fi

# V90-50: P7.7 — teste comportamental: contrato de autorização inválido deve bloquear TURN
if [ -f "$_AG_STOP" ]; then
    _V50_DIR="$(mktemp -d)"
    _V50_SCRIPTS="$_V50_DIR/scripts"
    _V50_LIB="$_V50_DIR/hooks-lib"
    _V50_STATE="$_V50_DIR/state"
    _V50_LOGS="$_V50_DIR/logs"
    mkdir -p "$_V50_SCRIPTS" "$_V50_LIB" "$_V50_STATE" "$_V50_LOGS"
    cp -a "$HOOK_DIR/scripts/agent-stop.sh" "$_V50_SCRIPTS/" 2> /dev/null || true
    cp -a "$HOOK_DIR/scripts/session-checkpoint.sh" "$_V50_SCRIPTS/" 2> /dev/null || true
    cp -a "$HOOK_DIR/hooks-lib/"* "$_V50_LIB/" 2> /dev/null || true

    cat > "$_V50_STATE/session-context.json" << 'V50CTX'
{
  "session": {"id": "", "close_key": "ENCERRAR-V90T50", "close_key_validated": false, "strict_turn_close_requires_key": true, "started_at": "2026-01-01T00:00:00Z"},
  "current_section": {"name": "teste", "section_id": "v50-sec", "section_number": 1, "turn_start": 1, "local_turn": 1},
  "current_turn": {
    "number": 2,
    "section_turn": 2,
    "started_at": "2026-01-01T00:01:00Z",
    "intent": "smoke v90-50",
    "intent_declared": true,
    "tools_count": 1,
    "failures_count": 0,
    "block_count": 0,
    "auth_requested": true,
    "auth_requested_at": "2026-01-01T00:01:20Z",
    "last_askquestions_response": "{\"answers\":{\"Template A\":{\"selected\":[\"ok\"],\"freeText\":null,\"skipped\":false}}}",
    "last_askquestions_template": "other",
    "last_askquestions_close_action": "not_applicable",
    "last_askquestions_close_key_found": false,
    "last_non_bookkeeping_tool": "vscode_askQuestions",
    "todo_created": true,
    "agentStop_invocations": 0,
    "subagent_delegated": false,
    "turn_id": "v50-turn"
  },
  "session_stats": {
    "turn_count": 1,
    "turn_authorized": 1,
    "turn_no_askQuestions": 0,
    "turns_since_askQuestions": 0,
    "tools_total": 3,
    "push_count": 0,
    "pending_section_after_push": false,
    "section_count": 1,
    "section_names": ["teste"],
    "recovery_hints": {}
  },
  "last_tool": {"name": "vscode_askQuestions", "ts": "2026-01-01T00:01:20Z", "use_id": "v50-tool", "result": "success"},
  "compliance": {"consecutive_unauthorized": 0, "last_turn_authorized": true, "flag_file_exists": false}
}
V50CTX

    cat > "$_V50_LOGS/audit.jsonl" << 'V50AUDIT'
{"event":"userPromptSubmitted","session_id":"","timestamp":"2026-01-01T00:01:00Z"}
{"event":"postToolUse","session_id":"","timestamp":"2026-01-01T00:01:20Z","tool_name":"vscode_askQuestions"}
V50AUDIT

    _V50_OUT="$(echo '{"timestamp":"2026-01-01T00:02:00Z","session_id":"","stop_hook_active":false}' | bash "$_V50_SCRIPTS/agent-stop.sh" 2> /dev/null || true)"
    if echo "$_V50_OUT" | grep -q '"decision"[[:space:]]*:[[:space:]]*"block"' \
        && grep -q '"event":"turnAuth_context_invalid"' "$_V50_LOGS/audit.jsonl" 2> /dev/null; then
        pass "V90-50: contrato inválido força block com evento turnAuth_context_invalid"
    else
        fail "V90-50: contrato inválido não forçou block como esperado"
    fi

    rm -rf "$_V50_DIR"
else
    fail "V90-50: agent-stop.sh não encontrado"
fi

# V90-32: log-prompt.sh detecta retomada via userPromptSubmitted e incrementa resume_count
if [ -f "$_LOG_PROMPT" ]; then
    if contains_pattern_in_files 'sessionResumeDetected' "$_LOG_PROMPT" "$LOG_PROMPT_LIB" \
        && contains_pattern_in_files 'session_stats.resume_count' "$_LOG_PROMPT" "$LOG_PROMPT_LIB"; then
        pass "V90-32: log-prompt.sh detecta retomada de sessão existente e contabiliza resume_count"
    else
        fail "V90-32: log-prompt.sh NÃO implementa detecção de retomada via userPromptSubmitted"
    fi
else
    fail "V90-32: log-prompt.sh não encontrado"
fi

# V90-33: log-prompt.sh implementa prompt_auto_recovery quando CTX está ausente
if [ -f "$_LOG_PROMPT" ]; then
    if contains_pattern_in_files 'session_auto_recovery_prompt' "$_LOG_PROMPT" "$LOG_PROMPT_LIB" \
        && contains_pattern_in_files 'prompt_auto_recovery' "$_LOG_PROMPT" "$LOG_PROMPT_LIB"; then
        pass "V90-33: log-prompt.sh tem auto-recovery no userPromptSubmitted (prompt_auto_recovery)"
    else
        fail "V90-33: log-prompt.sh NÃO implementa auto-recovery no userPromptSubmitted"
    fi
else
    fail "V90-33: log-prompt.sh não encontrado"
fi

# V90-34: teste comportamental — sem CTX, log-prompt cria contexto mínimo e loga session_auto_recovery_prompt
if [ -f "$_LOG_PROMPT" ]; then
    _V34_DIR="$(mktemp -d)"
    _V34_SCRIPTS="$_V34_DIR/scripts"
    _V34_LIB="$_V34_DIR/hooks-lib"
    _V34_STATE="$_V34_DIR/state"
    _V34_LOGS="$_V34_DIR/logs"
    mkdir -p "$_V34_SCRIPTS" "$_V34_LIB" "$_V34_STATE" "$_V34_LOGS"
    cp -a "$HOOK_DIR/scripts/log-prompt.sh" "$_V34_SCRIPTS/" 2> /dev/null || true
    cp -a "$HOOK_DIR/hooks-lib/"* "$_V34_LIB/" 2> /dev/null || true
    touch "$_V34_LOGS/audit.jsonl"

    _V34_INPUT='{"timestamp":"2026-01-02T00:00:00Z","cwd":"/tmp","prompt":"test v90-34","session_id":"v34-sid"}'
    echo "$_V34_INPUT" | bash "$_V34_SCRIPTS/log-prompt.sh" > /dev/null 2> /dev/null || true

    _V34_SRC="$(jq -r '.session.source // ""' "$_V34_STATE/session-context.json" 2> /dev/null || echo '')"
    _V34_SID="$(jq -r '.session.id // ""' "$_V34_STATE/session-context.json" 2> /dev/null || echo '')"
    _V34_EVT="$(grep -c '"session_auto_recovery_prompt"' "$_V34_LOGS/audit.jsonl" 2> /dev/null || echo 0)"
    if [ "$_V34_SRC" = "prompt_auto_recovery" ] && [ "$_V34_SID" = "v34-sid" ] && [ "$_V34_EVT" -ge 1 ]; then
        pass "V90-34: log-prompt.sh cria CTX mínimo + loga session_auto_recovery_prompt quando sessionStart não dispara"
    else
        fail "V90-34: auto-recovery no userPromptSubmitted falhou (source=$_V34_SRC sid=$_V34_SID evt=$_V34_EVT)"
    fi

    rm -rf "$_V34_DIR"
else
    fail "V90-34: log-prompt.sh não encontrado"
fi

# V90-35: teste comportamental — sessionResumeDetected + incremento de resume_count
if [ -f "$_LOG_PROMPT" ]; then
    _V35_DIR="$(mktemp -d)"
    _V35_SCRIPTS="$_V35_DIR/scripts"
    _V35_LIB="$_V35_DIR/hooks-lib"
    _V35_STATE="$_V35_DIR/state"
    _V35_LOGS="$_V35_DIR/logs"
    mkdir -p "$_V35_SCRIPTS" "$_V35_LIB" "$_V35_STATE" "$_V35_LOGS"
    cp -a "$HOOK_DIR/scripts/log-prompt.sh" "$_V35_SCRIPTS/" 2> /dev/null || true
    cp -a "$HOOK_DIR/hooks-lib/"* "$_V35_LIB/" 2> /dev/null || true
    cat > "$_V35_STATE/session-context.json" << 'V35CTX'
{
  "session": {"id": "v35-sid", "source": "new", "close_key": "ENCERRAR-V35"},
  "session_stats": {"turn_count": 2, "resume_count": 0, "tools_total": 0, "turns_since_askQuestions": 0},
  "current_section": {"name": "início", "section_id": "v35-sec", "local_turn": 2},
  "current_turn": {"number": 3, "section_turn": 3, "tools_count": 0, "auth_requested": false},
  "last_turn_ts": "2026-01-01T00:00:00Z"
}
V35CTX
    touch "$_V35_LOGS/audit.jsonl"
    _V35_INPUT='{"timestamp":"2026-01-01T00:10:00Z","cwd":"/tmp","prompt":"test v90-35","session_id":"v35-sid"}'
    echo "$_V35_INPUT" | bash "$_V35_SCRIPTS/log-prompt.sh" > /dev/null 2> /dev/null || true
    _V35_EVT="$(grep -c '"sessionResumeDetected"' "$_V35_LOGS/audit.jsonl" 2> /dev/null || echo 0)"
    _V35_RC="$(jq -r '.session_stats.resume_count // -1' "$_V35_STATE/session-context.json" 2> /dev/null || echo -1)"
    if [ "$_V35_EVT" -ge 1 ] && [ "$_V35_RC" -ge 1 ]; then
        pass "V90-35: log-prompt.sh registra sessionResumeDetected e incrementa resume_count"
    else
        fail "V90-35: retomada não contabilizada corretamente (evt=$_V35_EVT resume_count=$_V35_RC)"
    fi
    rm -rf "$_V35_DIR"
else
    fail "V90-35: log-prompt.sh não encontrado"
fi

# V90-36: teste comportamental — session-start.sh escreve evento sessionStart no audit
_SESSION_START_SCRIPT="$SCRIPTS_DIR/session-start.sh"
if [ -f "$_SESSION_START_SCRIPT" ]; then
    _V36_DIR="$(mktemp -d)"
    _V36_SCRIPTS="$_V36_DIR/scripts"
    _V36_LIB="$_V36_DIR/hooks-lib"
    _V36_STATE="$_V36_DIR/state"
    _V36_LOGS="$_V36_DIR/logs"
    mkdir -p "$_V36_SCRIPTS" "$_V36_LIB" "$_V36_STATE" "$_V36_LOGS"
    cp -a "$HOOK_DIR/scripts/"*.sh "$_V36_SCRIPTS/" 2> /dev/null || true
    cp -a "$HOOK_DIR/hooks-lib/"* "$_V36_LIB/" 2> /dev/null || true
    touch "$_V36_LOGS/audit.jsonl"
    _V36_INPUT='{"timestamp":"2026-01-02T00:00:00Z","cwd":"/tmp","source":"new","session_id":"v36-sid"}'
    echo "$_V36_INPUT" | bash "$_V36_SCRIPTS/session-start.sh" > /dev/null 2> /dev/null || true
    _V36_EVT_RAW="$(grep -h '"event":"sessionStart"' "$_V36_LOGS"/audit*.jsonl 2> /dev/null | wc -l | tr -d '[:space:]' || true)"
    _V36_EVT="$(printf '%s\n' "${_V36_EVT_RAW:-0}" | tail -1 | tr -d '[:space:]')"
    [ -z "$_V36_EVT" ] && _V36_EVT=0
    if [ "$_V36_EVT" -ge 1 ]; then
        pass "V90-36: session-start.sh grava evento sessionStart no audit"
    else
        fail "V90-36: session-start.sh não gravou evento sessionStart no audit"
    fi
    rm -rf "$_V36_DIR"
else
    fail "V90-36: session-start.sh não encontrado"
fi

# V90-20: agent-stop.sh invalida auth quando askQuestions falhou na API (no choices)
if [ -f "$_AG_STOP" ]; then
    if grep -q 'askquestions_api_error' "$_AG_STOP" 2> /dev/null \
        || grep -q 'askquestions_api_error' "$_AG_STOP_LIB" 2> /dev/null; then
        pass "V90-20: agent-stop.sh invalida auth quando current_turn.askquestions_api_error=true"
    else
        fail "V90-20: agent-stop.sh NÃO trata askquestions_api_error no fechamento do turno"
    fi
else
    fail "V90-20: agent-stop.sh não encontrado"
fi

# V90-21: agent-stop.sh reseta flags de erro API de askQuestions no reset de turno
if [ -f "$_AG_STOP" ]; then
    if { grep -q 'current_turn.askquestions_api_error.*=.*false' "$_AG_STOP" 2> /dev/null \
        && grep -q 'current_turn.askquestions_api_error_at.*=.*null' "$_AG_STOP" 2> /dev/null; } \
        || { grep -q 'current_turn.askquestions_api_error.*=.*false' "$_AG_STOP_LIB" 2> /dev/null \
            && grep -q 'current_turn.askquestions_api_error_at.*=.*null' "$_AG_STOP_LIB" 2> /dev/null; }; then
        pass "V90-21: agent-stop.sh reseta flags askquestions_api_error no fim do turno"
    else
        fail "V90-21: agent-stop.sh NÃO reseta flags askquestions_api_error no fim do turno"
    fi
else
    fail "V90-21: agent-stop.sh não encontrado"
fi

# V90-22: agent-stop.sh invalida auth quando askQuestions retorna skip/resposta vazia
if [ -f "$_AG_STOP" ]; then
    if { grep -q 'askquestions_skipped_or_empty' "$_AG_STOP" 2> /dev/null \
        || grep -q 'askquestions_skipped_or_empty' "$HOOK_DIR/hooks-lib/agent-stop-lib.sh" 2> /dev/null; } \
        && { grep -q '_AUTH_HAS_USER_ANSWER' "$_AG_STOP" 2> /dev/null \
            || grep -q 'askquestions_has_user_answer' "$HOOK_DIR/hooks-lib/agent-stop-lib.sh" 2> /dev/null; }; then
        pass "V90-22: agent-stop.sh exige resposta explícita do usuário em askQuestions"
    else
        fail "V90-22: agent-stop.sh NÃO valida skip/vazio em askQuestions"
    fi
else
    fail "V90-22: agent-stop.sh não encontrado"
fi

# V90-23: agent-stop.sh bloqueia Stop quando session_id mismatch permanece sem heal
if [ -f "$_AG_STOP" ]; then
    if { grep -q 'Session ID mismatch unresolved' "$_AG_STOP" 2> /dev/null \
        || grep -q 'Session ID mismatch unresolved' "$HOOK_DIR/hooks-lib/agent-stop-lib.sh" 2> /dev/null; } \
        && { grep -q 'TURN BLOQUEADO (v9.2)' "$_AG_STOP" 2> /dev/null \
            || grep -q 'TURN BLOQUEADO (v9.2)' "$HOOK_DIR/hooks-lib/agent-stop-lib.sh" 2> /dev/null; }; then
        pass "V90-23: agent-stop.sh bloqueia fechamento silencioso em session_id mismatch pendente"
    else
        fail "V90-23: agent-stop.sh NÃO bloqueia Stop em mismatch pendente"
    fi
else
    fail "V90-23: agent-stop.sh não encontrado"
fi

# V90-24: agent-stop.sh só aceita auth implícita de subagente quando delegação é imediata
if [ -f "$_AG_STOP" ]; then
    if { grep -q '_AUTH_SUBAGENT_IMMEDIATE' "$_AG_STOP" 2> /dev/null \
        || grep -q 'is_immediate_subagent_delegation' "$HOOK_DIR/hooks-lib/agent-stop-lib.sh" 2> /dev/null; } \
        && { grep -q 'last_tool.name' "$_AG_STOP" 2> /dev/null \
            || grep -q 'evaluate_turn_authorization' "$_AG_STOP" 2> /dev/null; } \
        && { grep -q 'auth_via_subagent_delegation' "$_AG_STOP" 2> /dev/null \
            || grep -q 'auth_via_subagent_delegation' "$HOOK_DIR/hooks-lib/agent-stop-lib.sh" 2> /dev/null; }; then
        pass "V90-24: auth de subagente limitada a delegação imediata (sem bypass stale)"
    else
        fail "V90-24: agent-stop.sh NÃO limita auth de subagente à delegação imediata"
    fi
else
    fail "V90-24: agent-stop.sh não encontrado"
fi

# V90-44: session-context.schema.json define bloco current_turn.subturn e subturn_history
_SCHEMA_FILE="$HOOK_DIR/contracts/session-context.schema.json"
if [ -f "$_SCHEMA_FILE" ]; then
    if jq -e '.properties.current_turn.properties.subturn and .properties.current_turn.properties.subturn_history' "$_SCHEMA_FILE" > /dev/null 2>&1; then
        pass "V90-44: schema possui current_turn.subturn e current_turn.subturn_history"
    else
        fail "V90-44: schema NÃO possui current_turn.subturn/subturn_history"
    fi
else
    fail "V90-44: session-context.schema.json não encontrado"
fi

# V90-45: events-contract documenta eventos subturnStart/subturnTransition/subturnResume/subturnEnd
_EVENTS_CONTRACT="$HOOK_DIR/contracts/events-contract.md"
if [ -f "$_EVENTS_CONTRACT" ]; then
    if grep -q 'subturnStart' "$_EVENTS_CONTRACT" 2> /dev/null \
        && grep -q 'subturnTransition' "$_EVENTS_CONTRACT" 2> /dev/null \
        && grep -q 'subturnResume' "$_EVENTS_CONTRACT" 2> /dev/null \
        && grep -q 'subturnEnd' "$_EVENTS_CONTRACT" 2> /dev/null; then
        pass "V90-45: events-contract documenta eventos canônicos de SubTurn"
    else
        fail "V90-45: events-contract não documenta todos os eventos de SubTurn"
    fi
else
    fail "V90-45: events-contract.md não encontrado"
fi

# V90-46: log-prompt.sh inicializa current_turn.subturn no início do TURN
if [ -f "$_LOG_PROMPT" ]; then
    if contains_pattern_in_files 'current_turn.subturn' "$_LOG_PROMPT" "$LOG_PROMPT_LIB" \
        && { contains_pattern_in_files 'subturnStart' "$_LOG_PROMPT" "$LOG_PROMPT_LIB" \
            || contains_pattern_in_files 'emit_subturn_start_event' "$_LOG_PROMPT" "$LOG_PROMPT_LIB"; }; then
        pass "V90-46: log-prompt.sh inicializa subturn e emite subturnStart"
    else
        fail "V90-46: log-prompt.sh não inicializa/loga subturn no turn start"
    fi
else
    fail "V90-46: log-prompt.sh não encontrado"
fi

# V90-47: pre-tool-use.sh registra transição de subturn em delegação para subagente
if [ -f "$_PTU_SCRIPT" ]; then
    if { contains_pattern_in_files 'subturnTransition' "$_PTU_SCRIPT" "$PRE_TOOL_USE_LIB" \
        || contains_pattern_in_files 'emit_subturn_transition_event' "$_PTU_SCRIPT" "$PRE_TOOL_USE_LIB"; } \
        && contains_pattern_in_files 'subagent_delegate' "$_PTU_SCRIPT" "$PRE_TOOL_USE_LIB"; then
        pass "V90-47: pre-tool-use.sh registra subturnTransition para subagent_delegate"
    else
        fail "V90-47: pre-tool-use.sh não registra transição de subturn para subagente"
    fi
else
    fail "V90-47: pre-tool-use.sh não encontrado"
fi

# V90-48: post-tool-use.sh atualiza estado de subturn no fluxo askQuestions
if [ -f "$_POST_TOOL" ]; then
    if contains_pattern_in_files 'SUBTURN_TO_STATE' "$_POST_TOOL" "$POST_TOOL_USE_LIB" \
        && contains_pattern_in_files 'session_stats.subturn_via_askquestions' "$_POST_TOOL" "$POST_TOOL_USE_LIB"; then
        pass "V90-48: post-tool-use.sh atualiza estado/counter de subturn via askQuestions"
    else
        fail "V90-48: post-tool-use.sh não atualiza subturn no fluxo askQuestions"
    fi
else
    fail "V90-48: post-tool-use.sh não encontrado"
fi

# V90-49: agent-stop.sh registra eventos de ciclo de subturn (start/resume/end)
if [ -f "$_AG_STOP" ]; then
    if { grep -q 'subturnStart\|emit_subturn_start_event' "$_AG_STOP" 2> /dev/null \
        || grep -q 'subturnStart\|emit_subturn_start_event' "$_AG_STOP_LIB" 2> /dev/null; } \
        && { grep -q 'subturnResume\|emit_subturn_resume_event' "$_AG_STOP" 2> /dev/null \
            || grep -q 'subturnResume\|emit_subturn_resume_event' "$_AG_STOP_LIB" 2> /dev/null; } \
        && { grep -q 'subturnEnd\|emit_subturn_end_event' "$_AG_STOP" 2> /dev/null \
            || grep -q 'subturnEnd\|emit_subturn_end_event' "$_AG_STOP_LIB" 2> /dev/null; }; then
        pass "V90-49: agent-stop.sh registra ciclo de eventos de SubTurn"
    else
        fail "V90-49: agent-stop.sh não registra todos os eventos de SubTurn"
    fi
else
    fail "V90-49: agent-stop.sh não encontrado"
fi

# V90-50: contrato de eventos explicita parent_turn_id e semântica temporal SESSION/TURN/SUBTURN
if [ -f "$_EVENTS_CONTRACT" ]; then
    if grep -q 'parent_turn_id' "$_EVENTS_CONTRACT" 2> /dev/null \
        && grep -q 'Semântica temporal canônica' "$_EVENTS_CONTRACT" 2> /dev/null \
        && grep -q 'dias, semanas ou meses' "$_EVENTS_CONTRACT" 2> /dev/null; then
        pass "V90-50: events-contract reforça parent_turn_id e semântica temporal canônica"
    else
        fail "V90-50: events-contract sem parent_turn_id ou semântica temporal SESSION/TURN/SUBTURN"
    fi
else
    fail "V90-50: events-contract.md não encontrado"
fi

# V90-51: hooks de subturn emitem parent_turn_id nos eventos
if [ -f "$_LOG_PROMPT" ] && [ -f "$_PTU_SCRIPT" ] && [ -f "$_POST_TOOL" ] && [ -f "$_AG_STOP" ]; then
    if contains_pattern_in_files 'parent_turn_id' "$_LOG_PROMPT" "$LOG_PROMPT_LIB" \
        && { contains_pattern_in_files 'parent_turn_id' "$_PTU_SCRIPT" "$PRE_TOOL_USE_LIB" \
            || contains_pattern_in_files 'write_current_subturn_state' "$_PTU_SCRIPT" "$PRE_TOOL_USE_LIB"; } \
        && { contains_pattern_in_files 'parent_turn_id' "$_POST_TOOL" "$POST_TOOL_USE_LIB" \
            || contains_pattern_in_files 'write_current_subturn_state' "$_POST_TOOL" "$POST_TOOL_USE_LIB"; } \
        && { grep -q 'parent_turn_id' "$_AG_STOP" 2> /dev/null \
            || grep -q 'parent_turn_id' "$_AG_STOP_LIB" 2> /dev/null; } \
        && grep -q 'parent_turn_id: (.current_turn.turn_id // null)' "$COMMON_LIB" 2> /dev/null; then
        pass "V90-51: eventos subturn nos hooks incluem parent_turn_id"
    else
        fail "V90-51: algum hook de subturn não emite parent_turn_id"
    fi
else
    fail "V90-51: arquivos de hooks necessários não encontrados"
fi

# V90-52: estado de subturn mantém vínculo parent_turn_id no contexto
if [ -f "$_SCHEMA_FILE" ] && [ -f "$_PTU_SCRIPT" ] && [ -f "$_POST_TOOL" ] && [ -f "$_AG_STOP" ]; then
    if jq -e '.properties.current_turn.properties.subturn.properties.parent_turn_id' "$_SCHEMA_FILE" > /dev/null 2>&1 \
        && grep -q 'parent_turn_id: (.current_turn.turn_id // null)' "$COMMON_LIB" 2> /dev/null \
        && { contains_pattern_in_files 'parent_turn_id: (.current_turn.turn_id // null)' "$_PTU_SCRIPT" "$PRE_TOOL_USE_LIB" \
            || contains_pattern_in_files 'write_current_subturn_state' "$_PTU_SCRIPT" "$PRE_TOOL_USE_LIB"; } \
        && { contains_pattern_in_files 'parent_turn_id: (.current_turn.turn_id // null)' "$_POST_TOOL" "$POST_TOOL_USE_LIB" \
            || contains_pattern_in_files 'write_current_subturn_state' "$_POST_TOOL" "$POST_TOOL_USE_LIB"; } \
        && { grep -q 'subturn_rebound_to_current_turn' "$_AG_STOP" 2> /dev/null \
            || grep -q 'subturn_rebound_to_current_turn' "$_AG_STOP_LIB" 2> /dev/null; }; then
        pass "V90-52: contexto de subturn mantém e repara vínculo parent_turn_id -> current_turn.turn_id"
    else
        fail "V90-52: vínculo parent_turn_id no contexto está incompleto"
    fi
else
    fail "V90-52: arquivos necessários para validar parent_turn_id não encontrados"
fi

# V90-53: agent-stop.sh persiste parent_turn_id também no subturn_history (não só no estado vivo)
if [ -f "$_AG_STOP" ] && [ -f "$_AG_STOP_LIB" ]; then
    if { grep -q 'subturn_history' "$_AG_STOP" 2> /dev/null \
        || grep -q 'subturn_history' "$_AG_STOP_LIB" 2> /dev/null; } \
        && { grep -q 'parent_turn_id: (.current_turn.turn_id // null)' "$_AG_STOP" 2> /dev/null \
            || grep -q 'parent_turn_id: (.current_turn.turn_id // null)' "$_AG_STOP_LIB" 2> /dev/null; }; then
        pass "V90-53: agent-stop.sh persiste parent_turn_id em entradas de subturn_history"
    else
        fail "V90-53: subturn_history sem parent_turn_id em agent-stop.sh"
    fi
else
    fail "V90-53: agent-stop.sh/agent-stop-lib.sh não encontrado"
fi

# V90-54: janela temporal esperada de SubTurn (minutos) está explícita no estado criado pelos hooks
if [ -f "$_LOG_PROMPT" ] && [ -f "$_AG_STOP" ] && [ -f "$_AG_STOP_LIB" ]; then
    if contains_pattern_in_files 'expected_window_minutes: 15' "$_LOG_PROMPT" "$LOG_PROMPT_LIB" \
        && { grep -q 'expected_window_minutes: 15' "$_AG_STOP" 2> /dev/null \
            || grep -q 'expected_window_minutes: 15' "$_AG_STOP_LIB" 2> /dev/null; }; then
        pass "V90-54: hooks definem expected_window_minutes=15 para SubTurn"
    else
        fail "V90-54: expected_window_minutes ausente em inicialização/retomada de SubTurn"
    fi
else
    fail "V90-54: arquivos necessários não encontrados"
fi

if [ "$SMOKE_MODE" = "all" ]; then
    echo ""
    echo "── Grupo extra: agregador de domínios (F5.2) ───────────────────────────────"
    LEGACY_FAIL_BEFORE_DOMAINS="$FAIL"
    DOMAINS_RC=0
    DOMAINS_EXECUTION_MODE="skipped"

    if [ "$SMOKE_DOMAINS_FLAG" = "off" ]; then
        DOMAINS_EXECUTION_MODE="off"
        pass "F6.1: agregador de domínios desativado por feature flag (off)"
    else
        if bash "$SCRIPTS_DIR/smoke-test-domains.sh" "$QUIET" > /dev/null 2>&1; then
            DOMAINS_RC=0
            DOMAINS_EXECUTION_MODE="$SMOKE_DOMAINS_FLAG"
            pass "F5.2/F6.1: smoke-test-domains.sh executou sem falhas (flag=$SMOKE_DOMAINS_FLAG)"
        else
            DOMAINS_RC=$?
            DOMAINS_EXECUTION_MODE="$SMOKE_DOMAINS_FLAG"
            if [ "$SMOKE_DOMAINS_FLAG" = "shadow" ]; then
                pass "F6.1: smoke-domains executou em shadow com falhas (sem quebrar gate legado)"
            else
                fail "F6.1: smoke-test-domains.sh retornou falhas em modo on"
            fi
        fi
    fi

    if command -v jq > /dev/null 2>&1; then
        LEGACY_STATUS="pass"
        DOMAINS_STATUS="pass"
        DIVERGENCE=false

        if [ "$LEGACY_FAIL_BEFORE_DOMAINS" -gt 0 ] 2> /dev/null; then
            LEGACY_STATUS="fail"
        fi

        if [ "$DOMAINS_RC" -gt 0 ] 2> /dev/null; then
            DOMAINS_STATUS="fail"
        fi

        if [ "$DOMAINS_EXECUTION_MODE" = "on" ] || [ "$DOMAINS_EXECUTION_MODE" = "shadow" ]; then
            if [ "$LEGACY_STATUS" != "$DOMAINS_STATUS" ]; then
                DIVERGENCE=true
            fi
        fi

        jq -cn \
            --arg ts "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
            --arg smoke_mode "$SMOKE_MODE" \
            --arg rollout_flag "$SMOKE_DOMAINS_FLAG" \
            --arg domains_exec_mode "$DOMAINS_EXECUTION_MODE" \
            --arg legacy_status "$LEGACY_STATUS" \
            --arg domains_status "$DOMAINS_STATUS" \
            --argjson legacy_failures "${LEGACY_FAIL_BEFORE_DOMAINS:-0}" \
            --argjson domains_failures "${DOMAINS_RC:-0}" \
            --argjson divergence "$DIVERGENCE" \
            '{
                timestamp: $ts,
                smoke_mode: $smoke_mode,
                rollout_flag: $rollout_flag,
                domains_execution_mode: $domains_exec_mode,
                legacy: {status: $legacy_status, failures: $legacy_failures},
                domains: {status: $domains_status, failures: $domains_failures},
                divergence_detected: $divergence
            }' > "$ROLLOUT_METRICS_FILE" 2> /dev/null || true
    fi
fi

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
