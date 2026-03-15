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
enforce_level3_close_key_mandate "$CTX_FILE" "$AUDIT_FILE" "$SESSION_ID" "$STOP_HOOK_ACTIVE" "${TIMESTAMP:-$NOW_ISO}" "$NOW_ISO" || _N3_GUARD_RC=$?
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
TURN_NUMBER=1
SECTION_TURN=1
SECTION_NAME=""
SECTION_ID=""
TURN_INTENT=""
TURN_INTENT_DECLARED=false
TURN_ID=""
TURN_TOOLS_COUNT=0
TURN_FAILURES_COUNT=0
TURN_BLOCK_COUNT=0
SUBTURN_ID=""
SUBTURN_NUMBER=1
SUBTURN_STATE="active"
SUBTURN_REASON="turn_runtime"
SUBTURN_STARTED_AT=""
SUBTURN_PARENT_TURN_ID=""
SUBTURN_DURATION_MS="null"
if [ -f "$CTX_FILE" ]; then
    TURN_NUMBER="$(safe_jq_read_int "$CTX_FILE" '.current_turn.number' 1)"
    SECTION_TURN="$(safe_jq_read_int "$CTX_FILE" '.current_turn.section_turn' 1)"
    SECTION_NAME="$(safe_jq_read "$CTX_FILE" '.current_section.name' '')"
    SECTION_ID="$(safe_jq_read "$CTX_FILE" '.current_section.section_id' '')"
    TURN_INTENT="$(safe_jq_read "$CTX_FILE" '.current_turn.intent' '')"
    TURN_INTENT_DECLARED="$(safe_jq_read "$CTX_FILE" '.current_turn.intent_declared' 'false')"
    TURN_ID="$(safe_jq_read "$CTX_FILE" '.current_turn.turn_id' '')"
    TURN_TOOLS_COUNT="$(safe_jq_read_int "$CTX_FILE" '.current_turn.tools_count' 0)"
    TURN_FAILURES_COUNT="$(safe_jq_read_int "$CTX_FILE" '.current_turn.failures_count' 0)"
    TURN_BLOCK_COUNT="$(safe_jq_read_int "$CTX_FILE" '.current_turn.block_count' 0)"
    SUBTURN_ID="$(safe_jq_read "$CTX_FILE" '.current_turn.subturn.subturn_id' '')"
    SUBTURN_NUMBER="$(safe_jq_read_int "$CTX_FILE" '.current_turn.subturn.number' 1)"
    SUBTURN_STATE="$(safe_jq_read "$CTX_FILE" '.current_turn.subturn.state' 'active')"
    SUBTURN_REASON="$(safe_jq_read "$CTX_FILE" '.current_turn.subturn.reason' 'turn_runtime')"
    SUBTURN_STARTED_AT="$(safe_jq_read "$CTX_FILE" '.current_turn.subturn.started_at' '')"
    SUBTURN_PARENT_TURN_ID="$(safe_jq_read "$CTX_FILE" '.current_turn.subturn.parent_turn_id' '')"
fi

# ── REV-09: contador cumulativo de invocações de agentStop por turno ─────────
# REV4-01: operação atômica via jq (read+increment+write em uma única expressão).
# Elimina race condition de leitura-modificação-escrita em 3 passos separados.
AGENTST_INVOCATIONS=1
if command -v increment_agentstop_invocations_in_context > /dev/null 2>&1; then
    AGENTST_INVOCATIONS="$(increment_agentstop_invocations_in_context "$CTX_FILE")"
fi

# P2 (dual-read): fallback para sessões legadas sem current_turn.subturn explícito.
if [ -z "${SUBTURN_ID:-}" ]; then
    SUBTURN_ID="${TURN_ID:-turn_unknown}_st${AGENTST_INVOCATIONS:-1}"
fi
if [ -z "${SUBTURN_NUMBER:-}" ] || [ "${SUBTURN_NUMBER:-0}" -le 0 ] 2> /dev/null; then
    SUBTURN_NUMBER="${AGENTST_INVOCATIONS:-1}"
fi

# P3/P4: SubTurn sempre subordinado ao TURN ativo.
if [ -n "$TURN_ID" ] && { [ -z "${SUBTURN_PARENT_TURN_ID:-}" ] || [ "$SUBTURN_PARENT_TURN_ID" != "$TURN_ID" ]; }; then
    SUBTURN_PARENT_TURN_ID="$TURN_ID"
    if [ -f "$CTX_FILE" ]; then
        if command -v bind_current_subturn_parent_turn_id > /dev/null 2>&1; then
            bind_current_subturn_parent_turn_id "$NOW_ISO" > /dev/null 2>&1 || true
        else
            _TMP_SUBTURN_BIND="$(mktemp 2> /dev/null || true)"
            if [ -n "$_TMP_SUBTURN_BIND" ] \
                && jq --arg turn_id "$TURN_ID" --arg ts "$NOW_ISO" \
                    '.current_turn.subturn = ((.current_turn.subturn // {}) + {
                        parent_turn_id: $turn_id,
                        last_transition_at: $ts
                     })' \
                    "$CTX_FILE" > "$_TMP_SUBTURN_BIND" 2> /dev/null; then
                mv "$_TMP_SUBTURN_BIND" "$CTX_FILE" 2> /dev/null || rm -f "$_TMP_SUBTURN_BIND"
            else
                [ -n "$_TMP_SUBTURN_BIND" ] && rm -f "$_TMP_SUBTURN_BIND"
            fi
        fi
    fi
    if command -v emit_subturn_transition_event > /dev/null 2>&1; then
        emit_subturn_transition_event \
            "$AUDIT_FILE" \
            "$SESSION_ID" \
            "$NOW_ISO" \
            "$TURN_ID" \
            "$SUBTURN_ID" \
            "${SUBTURN_NUMBER:-1}" \
            "${SUBTURN_STATE:-active}" \
            "${SUBTURN_STATE:-active}" \
            "subturn_rebound_to_current_turn" \
            "agentStop"
    fi
fi

if [ -n "${SUBTURN_STARTED_AT:-}" ] && [ -n "$NOW_ISO" ]; then
    _SUBTURN_START_EPOCH="$(iso_to_epoch_utc "$SUBTURN_STARTED_AT")"
    _SUBTURN_NOW_EPOCH="$(iso_to_epoch_utc "$NOW_ISO")"
    if [ "$_SUBTURN_NOW_EPOCH" -ge "$_SUBTURN_START_EPOCH" ] 2> /dev/null; then
        SUBTURN_DURATION_MS="$(((_SUBTURN_NOW_EPOCH - _SUBTURN_START_EPOCH) * 1000))"
    fi
fi

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
if [ "$AUTH_REQUESTED" = "false" ] && [ "$STOP_HOOK_ACTIVE" != "true" ]; then
    _BLOCK_CLOSE_KEY="$(jq -r '.session.close_key // "N/A"' "$CTX_FILE" 2> /dev/null || echo 'N/A')"
    _BLOCK_CLOSE_VALIDATED="$(jq -r '.session.close_key_validated // false' "$CTX_FILE" 2> /dev/null || echo 'false')"
    _BLOCK_STRICT_MODE="$(jq -r '(.session.strict_turn_close_requires_key | if . == null then true else . end)' "$CTX_FILE" 2> /dev/null || echo 'true')"
    _BLOCK_CONSECUTIVE_RAW="$(safe_jq_read_int "$CTX_FILE" '.compliance.consecutive_unauthorized' 0)"
    _BLOCK_TODO_CREATED="$(jq -r '.current_turn.todo_created // false' "$CTX_FILE" 2> /dev/null || echo false)"
    _BLOCK_COUNT_CURR_RAW="$(safe_jq_read_int "$CTX_FILE" '.current_turn.block_count' 0)"
    # fix Haiku A4.6: guard numérica — valor corrompido no CTX não causa comportamento imprevisível
    _BLOCK_CONSECUTIVE="$(sanitize_nonnegative_int "$_BLOCK_CONSECUTIVE_RAW")"
    _BLOCK_COUNT_CURR="$(sanitize_nonnegative_int "$_BLOCK_COUNT_CURR_RAW")"
    _NEW_CONSEC=$((_BLOCK_CONSECUTIVE + 1))
    _NEW_BLOCK_COUNT=$((_BLOCK_COUNT_CURR + 1))
    _BLOCK_FLAG_REASON="turn_blocked_no_askquestions"
    _BLOCK_FLAG_MESSAGE="Turno bloqueado em agent-stop por ausência de autorização válida"
    if [ -n "$AUTH_INVALID_REASON" ]; then
        _BLOCK_FLAG_REASON="turn_blocked_invalid_authorization"
        _BLOCK_FLAG_MESSAGE="Turno bloqueado em agent-stop por autorização inválida: $AUTH_INVALID_REASON"
    fi
    # Loga o evento de bloqueio (v9.0: inclui todo_created + block_count)
    log_agent_stop_blocked_event \
        "$AUDIT_FILE" \
        "$SESSION_ID" \
        "$NOW_ISO" \
        "$TURN_ID" \
        "$_NEW_CONSEC" \
        "$_BLOCK_TODO_CREATED" \
        "$_NEW_BLOCK_COUNT" \
        "$AUTH_INVALID_REASON"

    # P7.1: lock secundário no Stop (duplo lock preToolUse + Stop)
    log_turn_close_prevented_dual_lock_event \
        "$AUDIT_FILE" \
        "$SESSION_ID" \
        "$NOW_ISO" \
        "stopHook" \
        "$TURN_ID" \
        "${AUTH_INVALID_REASON:-askquestions_not_called}"

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
            "stop_blocked" \
            "blocked" \
            "$SUBTURN_DURATION_MS"
    fi
    # Loga evento extra quando manage_todo_list também não foi chamado (v9.0)
    if [ "$_BLOCK_TODO_CREATED" != "true" ]; then
        log_agent_stop_blocked_no_todo_event \
            "$AUDIT_FILE" \
            "$SESSION_ID" \
            "$NOW_ISO" \
            "$TURN_ID" \
            "$_NEW_CONSEC"
    fi
    # Atualiza CTX: incrementa consecutive_unauthorized + block_count e registra atividade
    if ! update_blocked_turn_context "$CTX_FILE" "$_NEW_CONSEC" "$_NEW_BLOCK_COUNT" "$NOW_ISO"; then
        echo "[warn] agent-stop: mktemp falhou; consecutive_unauthorized não atualizado" >&2
    fi

    _NEXT_SUBTURN=$((SUBTURN_NUMBER + 1))
    _NEXT_SUBTURN_ID="${TURN_ID:-turn_unknown}_st${_NEXT_SUBTURN}"
    record_blocked_subturn_and_schedule_resume \
        "$CTX_FILE" \
        "$NOW_ISO" \
        "$SUBTURN_ID" \
        "${SUBTURN_NUMBER:-1}" \
        "$_NEXT_SUBTURN_ID" \
        "$_NEXT_SUBTURN" \
        "$SUBTURN_DURATION_MS"

    if command -v emit_subturn_start_event > /dev/null 2>&1; then
        emit_subturn_start_event \
            "$AUDIT_FILE" \
            "$SESSION_ID" \
            "$NOW_ISO" \
            "$TURN_ID" \
            "$_NEXT_SUBTURN_ID" \
            "$_NEXT_SUBTURN" \
            "stop_block_resume_pending" \
            "blocked" \
            "agentStop"
    fi
    # Registra flag para o próximo briefing (schema JSON canônico)
    _BLOCK_TURN_NOW="$(jq -r '.session_stats.turn_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    write_turn_block_flag_json \
        "$AUTH_FLAG_FILE" \
        "$NOW_ISO" \
        "$SESSION_ID" \
        "${_BLOCK_TURN_NOW:-0}" \
        "${_NEW_CONSEC:-0}" \
        "$_BLOCK_FLAG_REASON" \
        "$_BLOCK_FLAG_MESSAGE"
    # Constrói o reason com instrução completa para o agente
    _BLOCK_SESSION_INFO="$(build_session_close_hint "$_BLOCK_CLOSE_VALIDATED" "$_BLOCK_CLOSE_KEY")"
    _BLOCK_PAYLOAD="$(build_turn_block_payload "$_BLOCK_TODO_CREATED" "$AUTH_INVALID_REASON" "$_BLOCK_SESSION_INFO" "$_BLOCK_STRICT_MODE")"
    _BLOCK_REASON="${_BLOCK_PAYLOAD%%|*}"
    _BLOCK_REST="${_BLOCK_PAYLOAD#*|}"
    _BLOCK_SYS_MSG="${_BLOCK_REST%%|*}"
    _BLOCK_REASON_CODE="${_BLOCK_REST#*|}"
    if [ -z "$_BLOCK_REASON_CODE" ] || [ "$_BLOCK_REASON_CODE" = "$_BLOCK_REST" ]; then
        _BLOCK_REASON_CODE="unknown_block_reason"
    fi
    _BLOCK_DECISION_TRACE="$(build_decision_trace_json \
        "stop_dual_lock_main" \
        "multi_strategy_v9_1" \
        "${AUTH_INVALID_REASON:-askquestions_not_called}" \
        "$_BLOCK_STRICT_MODE" \
        "$STOP_HOOK_ACTIVE" \
        "$_NEW_BLOCK_COUNT")"
    # Emite o block: hookSpecificOutput.decision=block + systemMessage visível
    emit_stop_block "$_BLOCK_REASON" "$_BLOCK_SYS_MSG" "$_BLOCK_REASON_CODE" "$_BLOCK_DECISION_TRACE"
    exit 0
fi

# ── stop_hook_active=true: segunda invocação após block — loga resultado ──────
# Quando stop_hook_active=true, o agente já foi desbloqueado pelo hook anterior.
# Verificamos se ele cumpriu o protocolo e logamos o resultado.
if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
    if command -v emit_subturn_resume_event > /dev/null 2>&1; then
        emit_subturn_resume_event \
            "$AUDIT_FILE" \
            "$SESSION_ID" \
            "$NOW_ISO" \
            "$TURN_ID" \
            "$SUBTURN_ID" \
            "${SUBTURN_NUMBER:-1}" \
            "stop_hook_active_resume" \
            "agentStop"
    fi

    if [ -f "$CTX_FILE" ]; then
        if command -v write_current_subturn_state > /dev/null 2>&1; then
            write_current_subturn_state \
                "$NOW_ISO" \
                "resumed" \
                "stop_hook_active_resume" \
                "true" \
                "false"
        fi

        if command -v sponge > /dev/null 2>&1; then
            jq '.session_stats.subturn_resumed = ((.session_stats.subturn_resumed // 0) + 1)' \
                "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
        else
            _TMP_SUBTURN_RESUME="$(mktemp 2> /dev/null || true)"
            if [ -n "$_TMP_SUBTURN_RESUME" ] && jq \
                '.session_stats.subturn_resumed = ((.session_stats.subturn_resumed // 0) + 1)' \
                "$CTX_FILE" > "$_TMP_SUBTURN_RESUME" 2> /dev/null; then
                mv "$_TMP_SUBTURN_RESUME" "$CTX_FILE" 2> /dev/null || rm -f "$_TMP_SUBTURN_RESUME"
            else
                [ -n "$_TMP_SUBTURN_RESUME" ] && rm -f "$_TMP_SUBTURN_RESUME"
            fi
        fi
    fi

    if [ "$AUTH_REQUESTED" = "true" ]; then
        log_unblocked_complied_event "$AUDIT_FILE" "$SESSION_ID" "$NOW_ISO" "$TURN_ID"
    else
        _REBLOCK_COUNT_CURR_RAW="$(jq -r '.current_turn.block_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
        _REBLOCK_COUNT_CURR="$(sanitize_nonnegative_int "$_REBLOCK_COUNT_CURR_RAW")"
        _REBLOCK_COUNT_NEXT=$((_REBLOCK_COUNT_CURR + 1))
        _REBLOCK_BUDGET_MAX_RAW="$(jq -r '.session.stop_block_budget_max // 2' "$CTX_FILE" 2> /dev/null || echo 2)"
        _REBLOCK_BUDGET_MAX="$(sanitize_nonnegative_int "$_REBLOCK_BUDGET_MAX_RAW")"
        _REBLOCK_BUDGET_ALREADY_EXCEEDED="$(jq -r '.current_turn.stop_block_budget_exceeded // false' "$CTX_FILE" 2> /dev/null || echo 'false')"
        if [ "$_REBLOCK_BUDGET_MAX" -lt 1 ] 2> /dev/null; then
            _REBLOCK_BUDGET_MAX=1
        fi
        _REBLOCK_STRICT_MODE="$(jq -r '(.session.strict_turn_close_requires_key | if . == null then true else . end)' "$CTX_FILE" 2> /dev/null || echo 'true')"
        if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
            jq --argjson bc "$_REBLOCK_COUNT_NEXT" '.current_turn.block_count = $bc' \
                "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
        fi
        log_reblocked_no_comply_event "$AUDIT_FILE" "$SESSION_ID" "$NOW_ISO" "$TURN_ID" "$_REBLOCK_COUNT_NEXT"

        # P7.1: lock secundário também no caminho de reblock
        log_turn_close_prevented_dual_lock_event \
            "$AUDIT_FILE" \
            "$SESSION_ID" \
            "$NOW_ISO" \
            "stopHook_reblock" \
            "$TURN_ID" \
            "reblock_no_authorization"

        if [ "$_REBLOCK_COUNT_NEXT" -gt "$_REBLOCK_BUDGET_MAX" ] 2> /dev/null; then
            if [ "$_REBLOCK_BUDGET_ALREADY_EXCEEDED" != "true" ]; then
                jq -cn \
                    --arg event "stop_block_budget_exceeded" \
                    --arg sid "$SESSION_ID" \
                    --arg ts "$NOW_ISO" \
                    --arg turn_id "$TURN_ID" \
                    --argjson block_count "$_REBLOCK_COUNT_NEXT" \
                    --argjson budget_max "$_REBLOCK_BUDGET_MAX" \
                    '{
                        event: $event,
                        session_id: $sid,
                        timestamp: $ts,
                        turn_id: (if $turn_id == "" then null else $turn_id end),
                        block_count: $block_count,
                        budget_max: $budget_max,
                        message: "Budget de reblock excedido; mantendo bloqueio estrito para evitar fechamento ilegítimo"
                    }' >> "$AUDIT_FILE"
            fi

            if [ -f "$CTX_FILE" ] && command -v sponge > /dev/null 2>&1; then
                jq --arg ts "$NOW_ISO" --argjson bc "$_REBLOCK_COUNT_NEXT" --argjson bm "$_REBLOCK_BUDGET_MAX" \
                    '.current_turn.stop_block_budget_exceeded = true
                     | .current_turn.stop_block_budget_exceeded_at = $ts
                     | .current_turn.stop_block_budget_exceeded_count = $bc
                     | .current_turn.stop_block_budget_max = $bm' \
                    "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
            fi

            _BUDGET_TRACE="$(build_decision_trace_json \
                "stop_reblock_budget" \
                "multi_strategy_v9_1" \
                "budget_exceeded" \
                "$_REBLOCK_STRICT_MODE" \
                "$STOP_HOOK_ACTIVE" \
                "$_REBLOCK_COUNT_NEXT")"
            emit_reblock_stop_block \
                "Budget de reblock excedido sem autorização válida. Encerramento segue bloqueado até Template F + KEY correta validada." \
                "🚫 BLOQUEIO MANTIDO (budget excedido): pare de iterar ferramentas de trabalho e finalize corretamente com Template F + KEY válida." \
                "stop_block_budget_exceeded" \
                "$_BUDGET_TRACE"
            exit 0
        fi

        _REBLOCK_TRACE="$(build_decision_trace_json \
            "stop_reblock" \
            "multi_strategy_v9_1" \
            "reblock_no_authorization" \
            "$_REBLOCK_STRICT_MODE" \
            "$STOP_HOOK_ACTIVE" \
            "$_REBLOCK_COUNT_NEXT")"
        emit_reblock_stop_block \
            "Turno ainda sem autorização válida. Encerramento legítimo só com Template F + KEY correta validada." \
            "🚫 Encerramento ilegítimo bloqueado novamente: faça askQuestions com opção de escalar para Template F e só encerre após Template F + KEY válida." \
            "reblock_no_authorization" \
            "$_REBLOCK_TRACE"
        exit 0
    fi
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
