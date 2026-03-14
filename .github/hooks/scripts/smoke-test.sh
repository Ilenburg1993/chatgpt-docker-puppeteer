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
    # Guard válido: script loga session_id_mismatch (bloqueia) OU sessionReconnect (rollover RECONNECT-01)
    if [ -f "$f" ] && (rg -q '"session_id_mismatch(_[A-Za-z0-9]+)?"' "$f" 2> /dev/null || rg -q "sessionReconnect" "$f" 2> /dev/null); then
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

    # Teste AS-5: decision:block tem reason obrigatório (campo FORA do hookSpecificOutput também)
    if grep -q 'reason: \$reason' "$_AS_SCRIPT" 2> /dev/null \
        && grep -q '_BLOCK_REASON=' "$_AS_SCRIPT" 2> /dev/null; then
        pass "AS-5: decision:block tem campo reason obrigatório (_BLOCK_REASON)"
    else
        fail "AS-5: decision:block NÃO tem campo reason (falta reason: \$reason ou _BLOCK_REASON=)"
    fi

    # Teste AS-6: agentStop_blocked é logado quando bloqueia
    if grep -q 'agentStop_blocked' "$_AS_SCRIPT" 2> /dev/null; then
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
    if grep -q 'sessionClose_direct_blocked\|session-close\.sh\|Mechanism 5' "$_PTU_SCRIPT" 2> /dev/null; then
        pass "PR-1: pre-tool-use.sh contém guard do Mecanismo 5 (session-close.sh)"
    else
        fail "PR-1: pre-tool-use.sh NÃO contém guard do Mecanismo 5"
    fi

    # Teste PR-2: pre-tool-use.sh emite permissionDecision:deny para session-close.sh
    if grep -q 'permissionDecision.*deny\|"deny"' "$_PTU_SCRIPT" 2> /dev/null; then
        pass "PR-2: pre-tool-use.sh emite permissionDecision:deny quando necessário"
    else
        fail "PR-2: pre-tool-use.sh NÃO emite permissionDecision:deny"
    fi

    # Teste PR-3: intervalo de reminder é 10 (padrão v8.0)
    if grep -q 'HOOKS_SESSION_REMINDER_TOOL_INTERVAL:-10' "$_PTU_SCRIPT" 2> /dev/null; then
        pass "PR-3: intervalo de SESSION reminder é 10 (padrão v8.0)"
    else
        fail "PR-3: intervalo de SESSION reminder NÃO é 10 (esperado v8.0)"
    fi

    # Teste PR-4: pre-tool-use.sh verifica close_key_validated antes de bloquear
    if grep -q '_M5_VALIDATED\|close_key_validated' "$_PTU_SCRIPT" 2> /dev/null; then
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
    if grep -q 'run_in_terminal' "$_PTU_SCRIPT" 2> /dev/null; then
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
    if grep -q 'SESSION_CLOSE_AUTHORIZED\|_AUTH_FLAG\|_RECOVERY_KEY_VALIDATED' "$_PTU_SCRIPT2" 2> /dev/null; then
        pass "V81-4: auto_recovery herda close_key_validated de SESSION_CLOSE_AUTHORIZED.flag"
    else
        fail "V81-4: auto_recovery NÃO herda close_key_validated (v8.1 não aplicado)"
    fi

    # Teste V81-5: auto_recovery usa _RECOVERY_KEY_VALIDATED como argjson (não string fixa false)
    if grep -q 'argjson key_validated\|key_validated.*RECOVERY' "$_PTU_SCRIPT2" 2> /dev/null; then
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
_LOG_PROMPT="$SCRIPTS_DIR/log-prompt.sh"
_POST_TOOL="$SCRIPTS_DIR/post-tool-use.sh"
_REPO_ROOT="$(cd "$HOOK_DIR/.." && pwd)"

# V90-1: post-tool-use.sh rastreia manage_todo_list → todo_created=true
if [ -f "$_POST_TOOL" ]; then
    if grep -q 'manage_todo_list' "$_POST_TOOL" && grep -q 'todo_created.*true' "$_POST_TOOL"; then
        pass "V90-1: post-tool-use.sh seta todo_created=true quando manage_todo_list é chamado"
    else
        fail "V90-1: post-tool-use.sh NÃO rastreia manage_todo_list → todo_created"
    fi
else
    fail "V90-1: post-tool-use.sh não encontrado"
fi

# V90-2: log-prompt.sh reseta todo_created=false no início de cada turno
if [ -f "$_LOG_PROMPT" ]; then
    if grep -q 'todo_created.*false' "$_LOG_PROMPT"; then
        pass "V90-2: log-prompt.sh reseta todo_created=false no início de cada turno"
    else
        fail "V90-2: log-prompt.sh NÃO reseta todo_created — campo fica sujo entre TURNs"
    fi
else
    fail "V90-2: log-prompt.sh não encontrado"
fi

# V90-3: agent-stop.sh lê _BLOCK_TODO_CREATED do contexto
if [ -f "$_AG_STOP" ]; then
    if grep -q '_BLOCK_TODO_CREATED' "$_AG_STOP"; then
        pass "V90-3: agent-stop.sh lê _BLOCK_TODO_CREATED do contexto"
    else
        fail "V90-3: agent-stop.sh NÃO lê _BLOCK_TODO_CREATED — sem distinção de violação dupla"
    fi
else
    fail "V90-3: agent-stop.sh não encontrado"
fi

# V90-4: agent-stop.sh emite agentStop_blocked_no_todo quando todo_created=false
if [ -f "$_AG_STOP" ]; then
    if grep -q 'agentStop_blocked_no_todo' "$_AG_STOP"; then
        pass "V90-4: agent-stop.sh emite evento agentStop_blocked_no_todo quando manage_todo_list ausente"
    else
        fail "V90-4: agent-stop.sh NÃO emite agentStop_blocked_no_todo — sem observabilidade de violação dupla"
    fi
else
    fail "V90-4: agent-stop.sh não encontrado"
fi

# V90-5: agent-stop.sh inclui DUPLA VIOLAÇÃO na mensagem quando todo_created=false
if [ -f "$_AG_STOP" ]; then
    if grep -q 'DUPLA' "$_AG_STOP"; then
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
    if grep -q 'session_id_in_payload' "$_LOG_PROMPT"; then
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
    if grep -q 'STOP_HOOK_ACTIVE.*consecutive\|stop_hook.*consecutive_unauthorized\|if \$stop_hook' "$_AG_STOP"; then
        pass "V90-10: agent-stop.sh usa guarda anti-duplo-incremento de consecutive_unauthorized (fix v9.0)"
    else
        fail "V90-10: agent-stop.sh NÃO tem guarda anti-duplo-incremento — bug: cada turn bloqueado conta 2x consecutivos"
    fi
else
    fail "V90-10: agent-stop.sh não encontrado"
fi

# V90-11: agent-stop.sh reseta todo_created=false no jq de fim de turno (reset canônico)
if [ -f "$_AG_STOP" ]; then
    if grep -q 'current_turn.todo_created.*=.*false' "$_AG_STOP"; then
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
    if grep -q 'last_turn_ts.*now\|last_turn_ts.*NOW' "$_AG_STOP" 2> /dev/null \
        &&
        # Verifica que last_turn_ts aparece tanto no bloco de bloqueio (jq compliance) quanto no fim de turno
        [ "$(grep -c 'last_turn_ts.*now\|last_turn_ts.*NOW' "$_AG_STOP" 2> /dev/null)" -ge 2 ]; then
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
_V16_EVT="$(grep -c '"sessionStart_inline"' "$_V16_LOGS/audit.jsonl" 2> /dev/null || echo 0)"
if [ "$_V16_SRC" = "inline_restart" ] && [ "$_V16_EA" = "null" ] && [ "$_V16_EVT" -ge 1 ]; then
    pass "V90-16: log-prompt.sh RECONNECT-02 — ended_at!=null inicia inline_restart (source=inline_restart, ended_at=null, sessionStart_inline logado)"
else
    fail "V90-16: log-prompt.sh RECONNECT-02 FAIL — source='$_V16_SRC', ended_at='$_V16_EA', sessionStart_inline_count=$_V16_EVT"
fi
rm -rf "$_V16_DIR"

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
    if grep -q '_ALREADY_VALIDATED' "$_PTU_SCRIPT" \
        && grep -q 'close_key_validated // false' "$_PTU_SCRIPT"; then
        pass "V90-18: post-tool-use.sh BUG-PC-03 — guard de idempotência (_ALREADY_VALIDATED) previne duplo sessionCloseAuthorized"
    else
        fail "V90-18: post-tool-use.sh SEM guard de idempotência — BUG-PC-03 não aplicado"
    fi
else
    fail "V90-18: post-tool-use.sh não encontrado"
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
