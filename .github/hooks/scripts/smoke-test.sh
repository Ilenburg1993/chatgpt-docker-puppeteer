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
if grep -q '_CTX_SECTION' "$SCRIPTS_DIR/agent-stop.sh" 2> /dev/null; then
    pass "agent-stop.sh emite systemMessage rico com estado contextualizado"
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
if grep -q 'section_turn' "$SCRIPTS_DIR/log-prompt.sh" 2> /dev/null; then
    pass "log-prompt.sh calcula current_turn.section_turn (numeração local)"
else
    fail "log-prompt.sh não calcula section_turn"
fi
if grep -q '_CTX_SECTION_TURN' "$SCRIPTS_DIR/agent-stop.sh" 2> /dev/null; then
    pass "agent-stop.sh exibe TURN local/global no systemMessage"
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
if grep -q 'rotate-audit.sh' "$SCRIPTS_DIR/session-start.sh" 2> /dev/null; then
    pass "G9-02: session-start.sh integra rotate-audit.sh"
else
    fail "G9-02: session-start.sh não chama rotate-audit.sh"
fi

# G9-03: session-start.sh faz auto-clear de flag stale
if grep -q 'authViolation_stale_cleared' "$SCRIPTS_DIR/session-start.sh" 2> /dev/null; then
    pass "G9-03: session-start.sh auto-limpa UNAUTHORIZED_CLOSE.flag de sessões diferentes"
else
    fail "G9-03: session-start.sh não implementa auto-clear de flag stale"
fi

# G9-04: HEAL v2 em agent-stop.sh
if grep -q 'mismatch_track\|HEAL v2\|healed_from_consecutive_mismatch' "$SCRIPTS_DIR/agent-stop.sh" 2> /dev/null; then
    pass "G9-04: agent-stop.sh implementa HEAL v2 (mismatch consecutivo)"
else
    fail "G9-04: agent-stop.sh não tem HEAL v2"
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
if grep -q 'flock.*CTX.*lock\|CTX.*lock.*flock\|\.lock.*exec.*9\|exec.*9.*CTX' "$SCRIPTS_DIR/pre-tool-use.sh" 2> /dev/null; then
    pass "BUG-A.1: pre-tool-use.sh tem flock (race condition corrigido)"
else
    fail "BUG-A.1: pre-tool-use.sh sem flock — race condition em session-context.json"
fi

# BUG-A.2: session-start.sh limpa .mismatch_track.json
if grep -q 'mismatch_track' "$SCRIPTS_DIR/session-start.sh" 2> /dev/null; then
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
if grep -q 'source.*common.sh\|\. .*common.sh' "$SCRIPTS_DIR/pre-tool-use.sh" 2> /dev/null; then
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

# smoke-test fix: --absolute-git-dir
if grep -q 'absolute-git-dir' "$SCRIPTS_DIR/smoke-test.sh" 2> /dev/null; then
    pass "Smoke-test usa --absolute-git-dir (path resolution fix)"
else
    fail "Smoke-test usa --git-dir sem absolute — G9-01 pode falhar com paths relativos"
fi

# ── 17. Segunda revisão (REV-09, REV-11, HEAL v2 doc) ────────────────────────
echo ""
echo "17. Segunda revisão — REV-09 / REV-11 / config.sh / HEAL v2"

# REV-09: agent-stop.sh incrementa agentStop_invocations
if grep -q 'agentStop_invocations' "$SCRIPTS_DIR/agent-stop.sh" 2> /dev/null; then
    pass "REV-09: agent-stop.sh rastreia agentStop_invocations"
else
    fail "REV-09: agentStop_invocations ausente em agent-stop.sh"
fi

# REV-09: log-prompt.sh reseta agentStop_invocations no início do turno
if grep -q 'agentStop_invocations.*=.*0' "$SCRIPTS_DIR/log-prompt.sh" 2> /dev/null; then
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
if grep -q 'subagent_delegated' "$HOOK_DIR/scripts/pre-tool-use.sh" \
    && grep -q 'subagentStart' "$HOOK_DIR/scripts/pre-tool-use.sh"; then
    pass "Hardening v6: pre-tool-use.sh detecta runSubagent/Task e loga subagentStart"
else
    fail "Hardening v6: pre-tool-use.sh faltando detecção de subagente/subagentStart"
fi

# Hardening subagente v6 — agent-stop.sh aceita subagentStart nas Strategies 1+2
if grep -q 'subagentStart' "$HOOK_DIR/scripts/agent-stop.sh" \
    && grep -q 'subagent_delegated' "$HOOK_DIR/scripts/agent-stop.sh"; then
    pass "Hardening v6: agent-stop.sh aceita subagentStart + Strategy 4 (subagent_delegated)"
else
    fail "Hardening v6: agent-stop.sh faltando subagentStart ou Strategy 4"
fi

# Hardening subagente v6 — auth_via_subagent_delegation logado
if grep -q 'auth_via_subagent_delegation' "$HOOK_DIR/scripts/agent-stop.sh"; then
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
if [ "$(grep -c 'auth_requested_at' "$HOOK_DIR/scripts/post-tool-use.sh")" -ge 2 ]; then
    pass "REV4-06: post-tool-use.sh seta auth_requested_at nos dois branches"
else
    fail "REV4-06: post-tool-use.sh seta auth_requested_at em menos de 2 branches"
fi

# REV4-07: session-end.sh tem flock
if grep -q 'flock' "$HOOK_DIR/scripts/session-end.sh"; then
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
mkdir -p "$_SC_STATE" "$_SC_LOG"

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
    _SC_OUT="$(HOOKS_STATE_DIR="$_SC_STATE" HOOKS_LOG_DIR="$_SC_LOG" \
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
    _SC_OUT2="$(HOOKS_STATE_DIR="$_SC_STATE" HOOKS_LOG_DIR="$_SC_LOG" \
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
    _SC_OUT3="$(HOOKS_STATE_DIR="$_SC_STATE" HOOKS_LOG_DIR="$_SC_LOG" \
        HOME="$_SC_DIR" \
        bash "$_SC_SCRIPT" 2>&1)" && _SC_RC3=$? || _SC_RC3=$?

    if [ "$_SC_RC3" -ne 0 ]; then
        pass "SC-3: session-close.sh sem KEY → exit≠0 (rc=$_SC_RC3)"
    else
        fail "SC-3: session-close.sh sem KEY → esperado exit≠0, obtido exit 0"
    fi

    # Teste SC-4: após KEY correta, sessionCloseAuthorized logado em audit.jsonl
    cp "$_SC_CTX_COPY" "$_SC_CTX"
    HOOKS_STATE_DIR="$_SC_STATE" HOOKS_LOG_DIR="$_SC_LOG" \
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
    HOOKS_STATE_DIR="$_SC_STATE" HOOKS_LOG_DIR="$_SC_LOG" \
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
