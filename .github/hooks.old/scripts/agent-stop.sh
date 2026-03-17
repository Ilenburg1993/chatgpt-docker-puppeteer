#!/bin/bash
# agent-stop.sh — Hook agentStop do Copilot (Stop event)
# Executado quando o agente termina de responder ao prompt (fim de turno).
# Input JSON (stdin): {timestamp, hook_event_name, session_id, stop_hook_active, ...}
#
# PROTOCOLO DE ENCERRAMENTO (v7.0 — BLOCKING ESTRUTURAL via decision:block):
#   - TURNs têm o FECHAMENTO bloqueado quando AUTH_REQUESTED=false e stop_hook_active=false.
#     (Semântica oficial do Stop: decision:block impede parar e força continuação do agente.)
#   - O agente é forçado a chamar vscode_askQuestions antes de encerrar o TURN.
#   - Exceções: stop_hook_active=true (anti-loop controlado com reblock),
#     AUTH_REQUESTED=true (askQuestions já foi chamado), subagente delegado.
#   - Output de bloqueio: hookSpecificOutput.decision="block" + reason + systemMessage.
#   - Estratégia 2 REMOVIDA (causava falso positivo cross-turn — v7.0).
#   - Auditoria: turnEnd_no_askQuestions / agentStop_blocked / agentStop_unblocked_* em audit.jsonl.
#   - UNAUTHORIZED_CLOSE.flag: criado quando turno é bloqueado.
#   - Calcula turn_duration a partir de current_turn.started_at (fix B3)
#   - session_summary usa métricas DO TURNO, não da sessão (fix B4)
#   - Reseta current_turn.* e incrementa session_stats.* após cada turno
#   - compliance.* controla o estado de autorização
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
CTX_FILE="$STATE_DIR/session-context.json"
# shellcheck disable=SC1091
if [ -f "$HOOK_DIR/hooks-lib/common.sh" ]; then
    source "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null \
        || echo "[warn] common.sh falhou ao carregar em agent-stop.sh" >&2
else
    echo "[warn] common.sh não encontrado (agent-stop.sh) — heal_v1/ctx functions indisponíveis" >&2
fi
if [ -f "$HOOK_DIR/hooks-lib/agent-stop-lib.sh" ]; then
    # shellcheck disable=SC1091
    source "$HOOK_DIR/hooks-lib/agent-stop-lib.sh" 2> /dev/null \
        || {
            echo "[error] agent-stop-lib.sh falhou ao carregar em agent-stop.sh" >&2
            exit 1
        }
else
    echo "[error] agent-stop-lib.sh não encontrado (agent-stop.sh)" >&2
    exit 1
fi
mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"
# CRÍTICO-1 FIX: lê stdin e resolve per-session ANTES de abrir o flock (fd 9)
if command -v resolve_hook_runtime_input > /dev/null 2>&1; then
    resolve_hook_runtime_input
else
    INPUT="$(cat 2> /dev/null || true)"
    TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
    SESSION_ID_PAYLOAD="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"
    NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
    apply_per_session_paths "${SESSION_ID_PAYLOAD:-}" 2> /dev/null || true
fi

# G9-08: Lock exclusivo APÓS resolver CTX_FILE per-session
# flock -w 3: aguarda até 3s; se não conseguir, continua sem lock (degraded mode).
_CTX_LOCK="${CTX_FILE}.lock"
exec 9> "$_CTX_LOCK"
if command -v flock > /dev/null 2>&1; then
    flock -x -w 3 9 2> /dev/null
fi

# stop_hook_active: true quando esta parada foi iniciada por um hook (prevenção de recursão).
# IMPORTANTE: não tentar bloquear (decision: block) quando stop_hook_active=true.
STOP_HOOK_ACTIVE="$(echo "$INPUT" | jq -r '.stop_hook_active // false' 2> /dev/null || echo 'false')"

# session_id: prioriza payload; fallback para contexto
SESSION_ID="$SESSION_ID_PAYLOAD"
if [ -z "$SESSION_ID" ] && [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
fi

# Helpers estruturais carregados de hooks-lib/agent-stop-lib.sh

# ── Nível 3: MANDATE (opt-in) — close_key no encerramento de SESSION ─────────
# Objetivo: opcionalmente exigir close_key_validated=true no Stop.
#
# IMPORTANTE: esta regra é opt-in via session.enforce_close_key_on_stop=true.
# Default=false para não bloquear encerramentos normais de TURN sem intenção de
# encerrar a SESSION.
#
# Exceção: stop_hook_active=true (hook iniciou parada, não agente) — não bloqueamos.
_N3_GUARD_RC=0
enforce_level3_close_key_mandate "$CTX_FILE" "$AUDIT_FILE" "$SESSION_ID" "$STOP_HOOK_ACTIVE" "$NOW_ISO" || _N3_GUARD_RC=$?
if [ "$_N3_GUARD_RC" -eq 10 ]; then
    exit 0
fi

# ── Guard: session_id deve corresponder ao contexto ativo ─────────────────────
# HARDENING v5: previne contaminação cruzada entre sessões.
# F0.3: detecta contexto vazio (sessionStart não disparou ou state foi limpo)
if [ -f "$CTX_FILE" ] && [ ! -s "$CTX_FILE" ]; then
    echo "[guard] session-context.json vazio — guard desabilitado (aguardando auto-recovery via preToolUse)" >&2
fi
_STOP_GUARD_RC=0
_STOP_GUARD_SESSION_ID="$(reconcile_session_id_guard_stop \
    "$CTX_FILE" \
    "$AUDIT_FILE" \
    "$STATE_DIR" \
    "$SESSION_ID_PAYLOAD" \
    "$SESSION_ID" \
    "$STOP_HOOK_ACTIVE" \
    "${TIMESTAMP:-}" \
    "$NOW_ISO")" || _STOP_GUARD_RC=$?

if [ -n "$_STOP_GUARD_SESSION_ID" ]; then
    SESSION_ID="$_STOP_GUARD_SESSION_ID"
fi

if [ "$_STOP_GUARD_RC" -eq 10 ]; then
    echo "[BLOCKED] agent-stop: session_id_guard detectou incompatibilidade não saneada" >&2
    exit 0
fi

# Hardening adicional: persiste strict_turn_close_requires_key em contextos legados.
if command -v ensure_strict_turn_close_flag_default > /dev/null 2>&1; then
    ensure_strict_turn_close_flag_default "$CTX_FILE" > /dev/null 2>&1 || true
fi

# ── Calcula duração do turno — fix B3 ────────────────────────────────────────
# Usa current_turn.started_at (timestamp de userPromptSubmitted) em vez de
# last_tool_ts, que apenas reflete o último tool call (impreciso para o turno todo).
TURN_DURATION_S=0
TURN_STARTED_AT=""
if [ -f "$CTX_FILE" ]; then
    TURN_STARTED_AT="$(safe_jq_read "$CTX_FILE" '.current_turn.started_at' '')"
    if [ -n "$TURN_STARTED_AT" ] && [ -n "$NOW_ISO" ]; then
        TURN_DURATION_S="$(compute_turn_duration_seconds "$TURN_STARTED_AT" "$NOW_ISO")"
    fi
fi

# ── Lê metadados do turno atual para enriquecimento de todos os eventos ───────
SUBTURN_DURATION_MS="null"
IFS=$'\x1f' read -r \
    TURN_NUMBER \
    SECTION_TURN \
    SECTION_NAME \
    SECTION_ID \
    TURN_INTENT \
    TURN_INTENT_DECLARED \
    TURN_ID \
    TURN_TOOLS_COUNT \
    TURN_FAILURES_COUNT \
    TURN_BLOCK_COUNT \
    SUBTURN_ID \
    SUBTURN_NUMBER \
    SUBTURN_STATE \
    SUBTURN_REASON \
    SUBTURN_STARTED_AT \
    SUBTURN_PARENT_TURN_ID \
    < <(populate_agent_stop_metadata_from_ctx "$CTX_FILE")

# ── REV-09: contador cumulativo de invocações de agentStop por turno ─────────
# REV4-01: operação atômica via jq (read+increment+write em uma única expressão).
# Elimina race condition de leitura-modificação-escrita em 3 passos separados.
AGENTST_INVOCATIONS=1
if command -v increment_agentstop_invocations_in_context > /dev/null 2>&1; then
    AGENTST_INVOCATIONS="$(increment_agentstop_invocations_in_context "$CTX_FILE")"
fi

IFS=$'\x1f' read -r \
    SUBTURN_ID \
    SUBTURN_NUMBER \
    SUBTURN_PARENT_TURN_ID \
    SUBTURN_DURATION_MS \
    < <(normalize_agent_stop_subturn_state \
        "$CTX_FILE" \
        "$AUDIT_FILE" \
        "$SESSION_ID" \
        "$NOW_ISO" \
        "$AGENTST_INVOCATIONS" \
        "$TURN_ID" \
        "$SUBTURN_ID" \
        "$SUBTURN_NUMBER" \
        "$SUBTURN_STATE" \
        "$SUBTURN_REASON" \
        "$SUBTURN_STARTED_AT" \
        "$SUBTURN_PARENT_TURN_ID")

# Append em audit.jsonl — registra o fim do turno
log_agent_stop_event \
    "$AUDIT_FILE" \
    "$SESSION_ID" \
    "${TIMESTAMP:-$NOW_ISO}" \
    "$TURN_DURATION_S" \
    "$STOP_HOOK_ACTIVE" \
    "$TURN_NUMBER" \
    "$SECTION_TURN" \
    "$SECTION_NAME" \
    "$SECTION_ID" \
    "$TURN_ID" \
    "$TURN_INTENT" \
    "${TURN_INTENT_DECLARED:-false}" \
    "$TURN_TOOLS_COUNT" \
    "$TURN_FAILURES_COUNT" \
    "$TURN_BLOCK_COUNT" \
    "$AGENTST_INVOCATIONS"

# ── BUG-79 GUARD: SESSION CLOSURE authorization (PRÉ-CLOSE validation) ────────
# Hardening Fase 0: Detecta tentativa não autorizada de encerrar sessão
# Protocolo TODO v9.0: SESSION closure APENAS via vscode_askQuestions Template F + close_key
# Se session.ended_at != null e closure_authorized_at == null → VIOLAÇÃO
if ! enforce_session_closure_authorization_guard "$CTX_FILE" "$AUDIT_FILE" "$STATE_DIR" "$SESSION_ID" "$NOW_ISO"; then
    # BLOQUEADOR: Falha com exit code 1
    exit 1
fi

# ── Detecção de autorização ───────────────────────────────────────────────────
# Estratégia em camadas (do mais preciso ao mais tolerante):
#   1. Fronteira por userPromptSubmitted (preciso): busca após o último prompt
#   2. [REMOVIDO v7.0 — causava falso positivo — ver comentário abaixo]
#   3. Contexto do turno atual: lê current_turn.auth_requested do session-context.json
#   4. Delegação ao subagente: subagent_delegated=true = autorização implícita
# A Estratégia 2 foi REMOVIDA em v7.0 porque verificava "últimas 150 linhas" do audit.jsonl
# e encontrava vscode_askQuestions de TURNOS ANTERIORES, gerando AUTH_REQUESTED=true falso.
# A Estratégia 3 (current_turn.auth_requested) é perfeitamente escoped ao turno atual:
# setada por post-tool-use.sh quando askQuestions é chamado, resetada aqui no fim do turno.
AUTH_FLAG_FILE="$STATE_DIR/UNAUTHORIZED_CLOSE.flag"
AUTHORIZED_FLAG_FILE="$STATE_DIR/AUTHORIZED_CLOSE.flag"
AUTH_REQUESTED="false"
AUTH_INVALID_REASON=""
_AUTH_EVAL="$(evaluate_turn_authorization "$AUDIT_FILE" "$CTX_FILE" "$SESSION_ID" "$NOW_ISO" "$TURN_ID")"
AUTH_REQUESTED="${_AUTH_EVAL%%|*}"
AUTH_INVALID_REASON="${_AUTH_EVAL#*|}"

# ── P7.3/M4: guard contratual de autorização do TURN (modularizado) ─────────
_AUTH_GUARD_EVAL="$(apply_turn_authorization_contract_guard \
    "$CTX_FILE" \
    "$AUDIT_FILE" \
    "$STATE_DIR" \
    "$SESSION_ID" \
    "$TURN_ID" \
    "$NOW_ISO" \
    "$STOP_HOOK_ACTIVE" \
    "$AUTH_REQUESTED" \
    "$AUTH_INVALID_REASON")"
AUTH_REQUESTED="${_AUTH_GUARD_EVAL%%|*}"
AUTH_INVALID_REASON="${_AUTH_GUARD_EVAL#*|}"

# ── Auditoria de turno sem vscode_askQuestions (informativo) ────────────────
# Loga turnEnd_no_askQuestions antes de decidir se bloqueia.
# Não loga quando stop_hook_active=true (segunda invocação após block).
if [ "$AUTH_REQUESTED" = "false" ] && [ "$STOP_HOOK_ACTIVE" != "true" ]; then
    if [ -n "$AUTH_INVALID_REASON" ]; then
        log_turn_end_invalid_authorization_event "$AUDIT_FILE" "$SESSION_ID" "$NOW_ISO" "$SECTION_ID" "$TURN_ID" "$AUTH_INVALID_REASON"
    else
        log_turn_end_no_askquestions_event "$AUDIT_FILE" "$SESSION_ID" "$NOW_ISO" "$SECTION_ID" "$TURN_ID"
    fi
fi

# ── Hardening v7.0: BLOCKING estrutural via Stop hook (decision:block) ────────
# Quando AUTH_REQUESTED=false E stop_hook_active=false: BLOQUEIA O FECHAMENTO do turno.
# Isso força o agente a chamar vscode_askQuestions antes de poder encerrar.
# CRÍTICO: se stop_hook_active=true, NUNCA bloquear (prevenção de loop infinito).
# Referência: https://code.visualstudio.com/docs/copilot/customization/hooks
_MAIN_BLOCK_BRANCH_RC=0
handle_main_stop_block_branch \
    "$CTX_FILE" \
    "$AUDIT_FILE" \
    "$STATE_DIR" \
    "$SESSION_ID" \
    "$NOW_ISO" \
    "$TURN_ID" \
    "$SUBTURN_ID" \
    "$SUBTURN_NUMBER" \
    "$SUBTURN_STATE" \
    "$SUBTURN_REASON" \
    "$SUBTURN_DURATION_MS" \
    "$AUTH_INVALID_REASON" \
    "$AUTH_REQUESTED" \
    "$STOP_HOOK_ACTIVE" \
    || _MAIN_BLOCK_BRANCH_RC=$?
if [ "$_MAIN_BLOCK_BRANCH_RC" -eq 10 ]; then
    exit 0
fi

# ── stop_hook_active=true: segunda invocação após block — loga resultado ──────
# Quando stop_hook_active=true, o agente já foi desbloqueado pelo hook anterior.
# Verificamos se ele cumpriu o protocolo e logamos o resultado.
_STOP_HOOK_BRANCH_RC=0
handle_stop_hook_active_branch \
    "$CTX_FILE" \
    "$AUDIT_FILE" \
    "$SESSION_ID" \
    "$NOW_ISO" \
    "$TURN_ID" \
    "$SUBTURN_ID" \
    "$SUBTURN_NUMBER" \
    "$SUBTURN_STATE" \
    "$SUBTURN_REASON" \
    "$SUBTURN_DURATION_MS" \
    "$STOP_HOOK_ACTIVE" \
    "$AUTH_REQUESTED" \
    || _STOP_HOOK_BRANCH_RC=$?
if [ "$_STOP_HOOK_BRANCH_RC" -eq 10 ]; then
    exit 0
fi

# ── systemMessage contextual — nudge periódico (complementar ao blocking) ─────
# Este nudge é alcançado apenas quando AUTH_REQUESTED=true (turno autorizado)
# ou quando stop_hook_active=true (segunda invocação após block).
# O blocking via decision:block (acima) já cobre os casos críticos.
# Este systemMessage serve como contexto adicional para turnos autorizados.
# Condições para emitir:
#   1. pending_section_after_push == true  (git push sem declaração de seção)
#   2. turns_since_askQuestions >= 3       (raramente alcançado com blocking ativo)
#   3. consecutive_unauthorized >= 1       (SEMPRE emite após qualquer violação)
_CTX_MSG="$(build_context_nudge_message "$CTX_FILE" "$STATE_DIR" "$AUTH_REQUESTED")"
if [ -n "$_CTX_MSG" ]; then
    printf '%s\n' "{\"systemMessage\":$(printf '%s' "$_CTX_MSG" | jq -Rs .)}"
fi

# ── Auto-enrich: gera turnStart_enriched_auto se start-turn.sh não foi chamado ──
if [ "$TURN_INTENT_DECLARED" = "false" ] && [ "$TURN_NUMBER" -gt 0 ]; then
    AUTO_INTENT="(não declarada)"
    if [ -f "$CTX_FILE" ]; then
        # Usa as ferramentas do turno como proxy de intenção
        TOP_TOOLS="$(build_auto_intent_from_turn_tools "$CTX_FILE")"
        [ -n "$TOP_TOOLS" ] && AUTO_INTENT="ferramentas: ${TOP_TOOLS}"
    fi
    log_turn_start_enriched_auto_event \
        "$AUDIT_FILE" \
        "$SESSION_ID" \
        "$NOW_ISO" \
        "$TURN_NUMBER" \
        "$SECTION_NAME" \
        "$SECTION_ID" \
        "$TURN_ID" \
        "$AUTO_INTENT"
fi

# ── Registra resultado do turno e atualiza compliance ────────────────────────
if [ "$AUTH_REQUESTED" = "true" ]; then
    rm -f "$AUTH_FLAG_FILE" 2> /dev/null || true
    # Cria flag de autorização (simétrico ao UNAUTHORIZED_CLOSE.flag para auditoria bidirecional)
    TURN_COUNT_NOW="$(jq -r '.session_stats.turn_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    write_authorized_close_flag "$AUTHORIZED_FLAG_FILE" "$NOW_ISO" "$SESSION_ID" "$TURN_COUNT_NOW"
    mark_turn_authorized_in_context "$CTX_FILE"
    _TURN_AUTH_PUSH_PENDING="$(jq -r '.session_stats.pending_section_after_push // false' "$CTX_FILE" 2> /dev/null || echo 'false')"
    log_turn_end_authorized_event \
        "$AUDIT_FILE" \
        "$SESSION_ID" \
        "$NOW_ISO" \
        "$TURN_NUMBER" \
        "$SECTION_TURN" \
        "$SECTION_NAME" \
        "$SECTION_ID" \
        "$TURN_ID" \
        "$TURN_DURATION_S" \
        "$TURN_TOOLS_COUNT" \
        "$TURN_INTENT" \
        "$TURN_FAILURES_COUNT" \
        "$_TURN_AUTH_PUSH_PENDING"

    if command -v emit_subturn_end_event > /dev/null 2>&1; then
        emit_subturn_end_event \
            "$AUDIT_FILE" \
            "$SESSION_ID" \
            "$NOW_ISO" \
            "$TURN_ID" \
            "$SUBTURN_ID" \
            "${SUBTURN_NUMBER:-1}" \
            "$SUBTURN_STATE" \
            "$SUBTURN_REASON" \
            "turn_closed_authorized" \
            "closed" \
            "$SUBTURN_DURATION_MS"
    fi
else
    # Hardening v5.1: re-introduz UNAUTHORIZED_CLOSE.flag para rastreamento cross-session.
    # v5.0 removia silenciosamente este flag, impedindo session-start.sh de exibir alerta
    # de violação no próximo briefing → encerramento 100% silencioso sem feedback ao usuário.
    # Solução: criar o flag com metadados completos; session-start.sh exibe alerta automaticamente.
    rm -f "$AUTHORIZED_FLAG_FILE" 2> /dev/null || true
    _CONSEC_NOW="$(jq -r '.compliance.consecutive_unauthorized // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    _TURN_NOW="$(jq -r '.session_stats.turn_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    # FIX v9.0: Quando stop_hook_active=true, o bloco de primeira invocação JÁ incrementou
    # consecutive_unauthorized. Não incrementar novamente aqui (evita double-increment).
    _CONSEC_FOR_FLAG="$(compute_consecutive_for_unauthorized_flag "$STOP_HOOK_ACTIVE" "$_CONSEC_NOW")"
    write_unauthorized_close_flag \
        "$AUTH_FLAG_FILE" \
        "$NOW_ISO" \
        "$SESSION_ID" \
        "${_TURN_NOW:-0}" \
        "${_CONSEC_FOR_FLAG:-$_CONSEC_NOW}" \
        "$TURN_INTENT"
    mark_turn_unauthorized_in_context "$CTX_FILE" "$STOP_HOOK_ACTIVE"
    # Nota: o evento turnEnd_no_askQuestions já foi emitido anteriormente (seção de auditoria informativa).
fi

# ── Incrementa session_stats, constrói session_summary e reseta current_turn ──
# CRÍTICO: reseta current_turn.auth_requested para false APÓS processamento.
# Sem este reset, a Estratégia 3 produziria falsos positivos no turno seguinte.
# session_summary usa métricas DO TURNO ATUAL (fix B4), não totais da sessão.
# Schema v7: appenda turn_history (cap 20) e atualiza recovery_hints.
if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
    SESSION_SUMMARY="$(build_turn_session_summary "$TURN_NUMBER" "$TURN_DURATION_S" "$TURN_TOOLS_COUNT")"
    AUTH_INCR_FIELD="$(select_auth_increment_field "$AUTH_REQUESTED")"
    NEXT_TURN=$((TURN_NUMBER + 1))
    finalize_turn_context_state \
        "$CTX_FILE" \
        "$NOW_ISO" \
        "$SESSION_SUMMARY" \
        "$AUTH_INCR_FIELD" \
        "$NEXT_TURN" \
        "$SECTION_NAME" \
        "$SECTION_ID" \
        "$TURN_ID" \
        "$TURN_NUMBER" \
        "$SECTION_TURN" \
        "$TURN_DURATION_S" \
        "$TURN_TOOLS_COUNT" \
        "$TURN_INTENT" \
        "$AUTH_REQUESTED" \
        "$TURN_FAILURES_COUNT"
fi

# ── Invariante SESSION+SECTION+TURN: auto-cria seção 'retomada' se null/fechada ──
ensure_section_invariant_retomada "$CTX_FILE" "$AUDIT_FILE" "$SESSION_ID"

# ── Checkpoint de estado do turno ────────────────────────────────────────────
CHECKPOINT_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/session-checkpoint.sh"
run_optional_hook_script "$CHECKPOINT_SCRIPT"

# ── Sync automático de tarefas para DOCUMENTACAO/ (a cada 5 turnos) ──────────
TURN_COUNT_SYNC="$(jq -r '.session_stats.turn_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
SYNC_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/sync-tasks-to-docs.sh"
if should_sync_tasks_to_docs_every_five_turns "$TURN_COUNT_SYNC"; then
    run_optional_hook_script "$SYNC_SCRIPT"
fi
