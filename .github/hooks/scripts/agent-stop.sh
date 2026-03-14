#!/bin/bash
# agent-stop.sh — Hook agentStop do Copilot (Stop event)
# Executado quando o agente termina de responder ao prompt (fim de turno).
# Input JSON (stdin): {timestamp, hook_event_name, session_id, stop_hook_active, ...}
#
# PROTOCOLO DE ENCERRAMENTO (v7.0 — BLOCKING ESTRUTURAL via decision:block):
#   - TURNs SÃO BLOQUEADOS quando AUTH_REQUESTED=false e stop_hook_active=false.
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
INPUT="$(cat 2> /dev/null || true)"

# Extrai campos usando schema real
TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
SESSION_ID_PAYLOAD="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"
NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
# UPG-AUDIT-01: resolve per-session files ANTES do flock (override CTX_FILE, AUDIT_FILE, _CTX_LOCK)
apply_per_session_paths "${SESSION_ID_PAYLOAD:-}" 2> /dev/null || true

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
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] && [ -n "$SESSION_ID_PAYLOAD" ]; then
    CTX_ACTIVE_SID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    if [ -n "$CTX_ACTIVE_SID" ] && [ "$SESSION_ID_PAYLOAD" != "$CTX_ACTIVE_SID" ]; then
        CTX_SOURCE="$(jq -r '.session.source // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        if [ "$CTX_SOURCE" = "manual_recovery" ]; then
            NOW_HEAL="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
            if command -v sponge &> /dev/null; then
                jq --arg real_sid "$SESSION_ID_PAYLOAD" --arg ts "$NOW_HEAL" \
                    '.session.id = $real_sid | .session.vs_code_session_id = $real_sid | .session.source = "healed_from_real_session" | .session.healed_at = $ts' \
                    "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
            else
                _TMP_HEAL="$(mktemp)"
                if jq --arg real_sid "$SESSION_ID_PAYLOAD" --arg ts "$NOW_HEAL" \
                    '.session.id = $real_sid | .session.vs_code_session_id = $real_sid | .session.source = "healed_from_real_session" | .session.healed_at = $ts' \
                    "$CTX_FILE" > "$_TMP_HEAL" 2> /dev/null; then
                    mv "$_TMP_HEAL" "$CTX_FILE" 2> /dev/null || rm -f "$_TMP_HEAL"
                else
                    rm -f "$_TMP_HEAL"
                fi
            fi
            jq -cn \
                --arg event "session_id_healed" \
                --arg old "$CTX_ACTIVE_SID" \
                --arg new "$SESSION_ID_PAYLOAD" \
                --arg source "agent-stop.sh" \
                --arg ts "${TIMESTAMP:-$NOW_HEAL}" \
                '{event: $event, old_session_id: $old, new_session_id: $new, source: $source, timestamp: $ts,
                  message: "CTX manual_recovery adotado: session_id atualizado para sessão real do Copilot"}' \
                >> "$AUDIT_FILE"
            SESSION_ID="$SESSION_ID_PAYLOAD" # continua com ID correto
        elif [ "$CTX_SOURCE" = "inline_restart" ]; then
            # FIX BUG-06: inline_restart — CTX tem o session_id correto do VS Code (PREMISSA 1).
            # Payload está stale (compilado com contexto antigo). Adotamos CTX como verdade.
            # Não executamos HEAL v2 (que heala na direção errada); apenas sincronizamos SESSION_ID.
            SESSION_ID="$CTX_ACTIVE_SID"
            jq -cn \
                --arg event "session_id_sync_inline_restart" \
                --arg stale "$SESSION_ID_PAYLOAD" \
                --arg adopted "$CTX_ACTIVE_SID" \
                --arg source "agent-stop.sh" \
                --arg ts "${TIMESTAMP:-}" \
                '{event: $event, stale_payload_sid: $stale, adopted_ctx_sid: $adopted,
                  source: $source, timestamp: $ts,
                  message: "inline_restart: payload stale — adotado session_id do CTX (VS Code, PREMISSA 1)"}' \
                >> "$AUDIT_FILE"
            # Continua normalmente sem bloquear
        else
            # G9-04: HEAL v2 — rastreia mismatches consecutivos com o mesmo "got" session_id.
            # Após 3 ocorrências do mesmo "got", auto-heal (CTX provavelmente defasado).
            MISMATCH_TRACK_FILE="$STATE_DIR/.mismatch_track.json"
            NEW_COUNT="$(update_mismatch_tracker "$MISMATCH_TRACK_FILE" "$SESSION_ID_PAYLOAD")"

            if [ "$NEW_COUNT" -ge 3 ]; then
                # HEAL v2: ID recorrente → trust como real e sanar o contexto
                NOW_HEAL="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
                if command -v sponge &> /dev/null; then
                    jq --arg real_sid "$SESSION_ID_PAYLOAD" --arg ts "$NOW_HEAL" \
                        '.session.id = $real_sid | .session.vs_code_session_id = $real_sid | .session.source = "healed_from_consecutive_mismatch" | .session.healed_at = $ts' \
                        "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
                else
                    _TMP_HEAL="$(mktemp)"
                    if jq --arg real_sid "$SESSION_ID_PAYLOAD" --arg ts "$NOW_HEAL" \
                        '.session.id = $real_sid | .session.vs_code_session_id = $real_sid | .session.source = "healed_from_consecutive_mismatch" | .session.healed_at = $ts' \
                        "$CTX_FILE" > "$_TMP_HEAL" 2> /dev/null; then
                        mv "$_TMP_HEAL" "$CTX_FILE" 2> /dev/null || rm -f "$_TMP_HEAL"
                    else
                        rm -f "$_TMP_HEAL"
                    fi
                fi
                rm -f "$MISMATCH_TRACK_FILE" 2> /dev/null || true
                jq -cn \
                    --arg event "session_id_healed" \
                    --arg old "$CTX_ACTIVE_SID" \
                    --arg new "$SESSION_ID_PAYLOAD" \
                    --arg source "agent-stop.sh:heal_v2" \
                    --arg ts "${TIMESTAMP:-$NOW_HEAL}" \
                    --argjson count "$NEW_COUNT" \
                    '{event: $event, old_session_id: $old, new_session_id: $new, source: $source,
                      timestamp: $ts, consecutive_mismatches: $count,
                      message: "HEAL v2: mismatch consecutivo (3x) — session_id sanado para ID recorrente"}' \
                    >> "$AUDIT_FILE"
                SESSION_ID="$SESSION_ID_PAYLOAD"
            else
                jq -cn \
                    --arg event "session_id_mismatch" \
                    --arg expected "$CTX_ACTIVE_SID" \
                    --arg got "$SESSION_ID_PAYLOAD" \
                    --arg source "agent-stop.sh" \
                    --arg ts "${TIMESTAMP:-}" \
                    --argjson count "$NEW_COUNT" \
                    '{
                        event:   $event,
                        expected: $expected,
                        got:      $got,
                        source:   $source,
                        timestamp: $ts,
                        consecutive_count: $count,
                        message:  "Payload session_id diferente do contexto ativo — state write bloqueado"
                    }' >> "$AUDIT_FILE"

                # Hardening v9.2: mismatch pendente NÃO pode encerrar TURN silenciosamente.
                # Se ainda não houve heal (count < 3), bloqueia este Stop para evitar
                # fechamento não autorizado em contexto inconsistente.
                if [ "$STOP_HOOK_ACTIVE" != "true" ]; then
                    emit_unresolved_session_mismatch_block "$CTX_ACTIVE_SID" "$SESSION_ID_PAYLOAD" "$NEW_COUNT"
                fi
                exit 0
            fi
        fi
    fi
fi

# ── Calcula duração do turno — fix B3 ────────────────────────────────────────
# Usa current_turn.started_at (timestamp de userPromptSubmitted) em vez de
# last_tool_ts, que apenas reflete o último tool call (impreciso para o turno todo).
TURN_DURATION_S=0
TURN_STARTED_AT=""
if [ -f "$CTX_FILE" ]; then
    TURN_STARTED_AT="$(jq -r '.current_turn.started_at // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    if [ -n "$TURN_STARTED_AT" ] && [ -n "$NOW_ISO" ]; then
        # BUG-59 FIX: date -d é GNU-only; fallback para BSD (macOS)
        if date -d "$TURN_STARTED_AT" '+%s' > /dev/null 2>&1; then
            TURN_START_S="$(date -d "$TURN_STARTED_AT" '+%s' 2> /dev/null || echo 0)"
        else
            TURN_START_S="$(date -j -f '%Y-%m-%dT%H:%M:%SZ' "$TURN_STARTED_AT" '+%s' 2> /dev/null || echo 0)"
        fi
        if date -d "$NOW_ISO" '+%s' > /dev/null 2>&1; then
            NOW_S="$(date -d "$NOW_ISO" '+%s' 2> /dev/null || echo 0)"
        else
            NOW_S="$(date -j -f '%Y-%m-%dT%H:%M:%SZ' "$NOW_ISO" '+%s' 2> /dev/null || echo 0)"
        fi
        if [ "$NOW_S" -gt "$TURN_START_S" ] 2> /dev/null; then
            TURN_DURATION_S=$((NOW_S - TURN_START_S))
        fi
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
if [ -f "$CTX_FILE" ]; then
    TURN_NUMBER="$(jq -r '.current_turn.number // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
    SECTION_TURN="$(jq -r '.current_turn.section_turn // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
    SECTION_NAME="$(jq -r '.current_section.name // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    SECTION_ID="$(jq -r '.current_section.section_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    TURN_INTENT="$(jq -r '.current_turn.intent // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    TURN_INTENT_DECLARED="$(jq -r '.current_turn.intent_declared // false' "$CTX_FILE" 2> /dev/null || echo false)"
    TURN_ID="$(jq -r '.current_turn.turn_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    TURN_TOOLS_COUNT="$(jq -r '.current_turn.tools_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    TURN_FAILURES_COUNT="$(jq -r '.current_turn.failures_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    TURN_BLOCK_COUNT="$(jq -r '.current_turn.block_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
fi

# ── REV-09: contador cumulativo de invocações de agentStop por turno ─────────
# REV4-01: operação atômica via jq (read+increment+write em uma única expressão).
# Elimina race condition de leitura-modificação-escrita em 3 passos separados.
AGENTST_INVOCATIONS=1
if [ -f "$CTX_FILE" ]; then
    if command -v sponge &> /dev/null; then
        jq '.current_turn.agentStop_invocations = ((.current_turn.agentStop_invocations // 0) + 1)' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
        AGENTST_INVOCATIONS="$(jq -r '.current_turn.agentStop_invocations // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
    else
        _TMP_INV="$(mktemp)"
        jq '.current_turn.agentStop_invocations = ((.current_turn.agentStop_invocations // 0) + 1)' \
            "$CTX_FILE" > "$_TMP_INV" && mv "$_TMP_INV" "$CTX_FILE" || true
        AGENTST_INVOCATIONS="$(jq -r '.current_turn.agentStop_invocations // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
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
AUTH_REQUESTED=false
AUTH_INVALID_REASON=""

if [ -f "$AUDIT_FILE" ]; then
    # Estratégia 1: fronteira por userPromptSubmitted
    if audit_has_turn_auth_signal "$AUDIT_FILE"; then
        AUTH_REQUESTED=true
    fi

    # Estratégia 2 REMOVIDA em v7.0 (falso positivo cross-turn).
    # Estratégia 3 (session-context.json) é o fallback correto abaixo.
fi

# Estratégia 3 (fallback de contexto): lê flag do session-context.json
# Schema v2: current_turn.auth_requested; legado: auth_requested_this_turn
if [ "$AUTH_REQUESTED" = "false" ] && [ -f "$CTX_FILE" ]; then
    if context_turn_auth_requested "$CTX_FILE"; then
        AUTH_REQUESTED=true
    fi
fi

# Estratégia 4: delegação ao subagente = autorização implícita
# runSubagent dispara agentStop no agente pai antes do subagente iniciar.
# pre-tool-use.sh seta subagent_delegated=true quando detecta a chamada.
# Esta estratégia captura o caso em que o contexto foi atualizado mas o audit.jsonl
# ainda não tinha o evento (race window mínima mas possível).
if [ "$AUTH_REQUESTED" = "false" ] && [ -f "$CTX_FILE" ]; then
    SUBAGENT_DELEGATED="$(jq -r '.current_turn.subagent_delegated // false' "$CTX_FILE" 2> /dev/null || echo false)"
    if [ "$SUBAGENT_DELEGATED" = "true" ]; then
        SUBAGENT_LAST_TOOL="$(jq -r '.last_tool.name // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        if [ "$SUBAGENT_LAST_TOOL" = "runSubagent" ] || [ "$SUBAGENT_LAST_TOOL" = "search_subagent" ]; then
            AUTH_REQUESTED=true
            log_auth_via_subagent_delegation_event "$AUDIT_FILE" "$SESSION_ID" "$NOW_ISO" "$TURN_ID"
        fi
    fi
fi

# ── Hardening v9.1: askQuestions deve ser o ÚLTIMO ato do TURN ─────────────
# Protocolo TODO v9.0 exige que o último passo do turno seja vscode_askQuestions.
# Sem isso, chamadas antigas de askQuestions no mesmo turno não autorizam o fechamento.
if [ "$AUTH_REQUESTED" = "true" ] && [ -f "$CTX_FILE" ]; then
    _AUTH_LAST_TOOL_NAME="$(jq -r '.last_tool.name // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    _AUTH_SUBAGENT_DELEGATED="$(jq -r '.current_turn.subagent_delegated // false' "$CTX_FILE" 2> /dev/null || echo false)"
    _AUTH_ASK_API_ERROR="$(jq -r '.current_turn.askquestions_api_error // false' "$CTX_FILE" 2> /dev/null || echo false)"
    _AUTH_LAST_RESPONSE="$(jq -r '.current_turn.last_askquestions_response // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    _AUTH_LAST_NON_BOOKKEEPING_TOOL=""

    _AUTH_LAST_NON_BOOKKEEPING_TOOL="$(last_non_bookkeeping_tool_since_prompt "$AUDIT_FILE")"

    AUTH_INVALID_REASON="$(determine_turn_auth_invalid_reason \
        "$_AUTH_LAST_TOOL_NAME" \
        "$_AUTH_SUBAGENT_DELEGATED" \
        "$_AUTH_ASK_API_ERROR" \
        "$_AUTH_LAST_RESPONSE" \
        "$_AUTH_LAST_NON_BOOKKEEPING_TOOL")"

    if [ -n "$AUTH_INVALID_REASON" ]; then
        AUTH_REQUESTED=false
        log_turn_auth_invalidated_event \
            "$AUDIT_FILE" \
            "$SESSION_ID" \
            "$NOW_ISO" \
            "$AUTH_INVALID_REASON" \
            "$_AUTH_LAST_TOOL_NAME" \
            "$_AUTH_LAST_NON_BOOKKEEPING_TOOL" \
            "$TURN_ID"
    fi
fi

# ── Auditoria de turno sem vscode_askQuestions (informativo) ────────────────
# Loga turnEnd_no_askQuestions antes de decidir se bloqueia.
# Não loga quando stop_hook_active=true (segunda invocação após block).
if [ "$AUTH_REQUESTED" = "false" ] && [ "$STOP_HOOK_ACTIVE" != "true" ]; then
    log_turn_end_no_askquestions_event "$AUDIT_FILE" "$SESSION_ID" "$NOW_ISO" "$SECTION_ID" "$TURN_ID"
fi

# ── Hardening v7.0: BLOCKING estrutural via Stop hook (decision:block) ────────
# Quando AUTH_REQUESTED=false E stop_hook_active=false: BLOQUEIA o turno.
# Isso força o agente a chamar vscode_askQuestions antes de poder encerrar.
# CRÍTICO: se stop_hook_active=true, NUNCA bloquear (prevenção de loop infinito).
# Referência: https://code.visualstudio.com/docs/copilot/customization/hooks
if [ "$AUTH_REQUESTED" = "false" ] && [ "$STOP_HOOK_ACTIVE" != "true" ] && [ -f "$CTX_FILE" ]; then
    _BLOCK_CLOSE_KEY="$(jq -r '.session.close_key // "N/A"' "$CTX_FILE" 2> /dev/null || echo 'N/A')"
    _BLOCK_CLOSE_VALIDATED="$(jq -r '.session.close_key_validated // false' "$CTX_FILE" 2> /dev/null || echo 'false')"
    _BLOCK_CONSECUTIVE_RAW="$(jq -r '.compliance.consecutive_unauthorized // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    _BLOCK_TODO_CREATED="$(jq -r '.current_turn.todo_created // false' "$CTX_FILE" 2> /dev/null || echo false)"
    _BLOCK_COUNT_CURR_RAW="$(jq -r '.current_turn.block_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    # fix Haiku A4.6: guard numérica — valor corrompido no CTX não causa comportamento imprevisível
    _BLOCK_CONSECUTIVE="$(sanitize_nonnegative_int "$_BLOCK_CONSECUTIVE_RAW")"
    _BLOCK_COUNT_CURR="$(sanitize_nonnegative_int "$_BLOCK_COUNT_CURR_RAW")"
    _NEW_CONSEC=$((_BLOCK_CONSECUTIVE + 1))
    _NEW_BLOCK_COUNT=$((_BLOCK_COUNT_CURR + 1))
    # Loga o evento de bloqueio (v9.0: inclui todo_created + block_count)
    log_agent_stop_blocked_event \
        "$AUDIT_FILE" \
        "$SESSION_ID" \
        "$NOW_ISO" \
        "$TURN_ID" \
        "$_NEW_CONSEC" \
        "$_BLOCK_TODO_CREATED" \
        "$_NEW_BLOCK_COUNT"
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
    # Registra flag para o próximo briefing (schema JSON canônico)
    _BLOCK_TURN_NOW="$(jq -r '.session_stats.turn_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    write_turn_block_flag_json \
        "$AUTH_FLAG_FILE" \
        "$NOW_ISO" \
        "$SESSION_ID" \
        "${_BLOCK_TURN_NOW:-0}" \
        "${_NEW_CONSEC:-0}" \
        "turn_blocked_no_askquestions" \
        "Turno bloqueado em agent-stop por ausência de autorização válida"
    # Constrói o reason com instrução completa para o agente
    _BLOCK_SESSION_INFO="$(build_session_close_hint "$_BLOCK_CLOSE_VALIDATED" "$_BLOCK_CLOSE_KEY")"
    _BLOCK_PAYLOAD="$(build_turn_block_payload "$_BLOCK_TODO_CREATED" "$AUTH_INVALID_REASON" "$_BLOCK_SESSION_INFO")"
    _BLOCK_REASON="${_BLOCK_PAYLOAD%%|*}"
    _BLOCK_SYS_MSG="${_BLOCK_PAYLOAD#*|}"
    # Emite o block: hookSpecificOutput.decision=block + systemMessage visível
    emit_stop_block "$_BLOCK_REASON" "$_BLOCK_SYS_MSG"
    exit 0
fi

# ── stop_hook_active=true: segunda invocação após block — loga resultado ──────
# Quando stop_hook_active=true, o agente já foi desbloqueado pelo hook anterior.
# Verificamos se ele cumpriu o protocolo e logamos o resultado.
if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
    if [ "$AUTH_REQUESTED" = "true" ]; then
        log_unblocked_complied_event "$AUDIT_FILE" "$SESSION_ID" "$NOW_ISO" "$TURN_ID"
    else
        _REBLOCK_COUNT_CURR_RAW="$(jq -r '.current_turn.block_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
        _REBLOCK_COUNT_CURR="$(sanitize_nonnegative_int "$_REBLOCK_COUNT_CURR_RAW")"
        _REBLOCK_COUNT_NEXT=$((_REBLOCK_COUNT_CURR + 1))
        if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
            jq --argjson bc "$_REBLOCK_COUNT_NEXT" '.current_turn.block_count = $bc' \
                "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
        fi
        log_reblocked_no_comply_event "$AUDIT_FILE" "$SESSION_ID" "$NOW_ISO" "$TURN_ID" "$_REBLOCK_COUNT_NEXT"

        emit_reblock_stop_block
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
_EMIT_CONTEXT_MSG=false
_PUSH_PENDING="false"
_TURNS_SINCE_ASK=0
_CONSECUTIVE_UNAUTH=0
if [ -f "$CTX_FILE" ]; then
    _PUSH_PENDING="$(jq -r '.session_stats.pending_section_after_push // false' "$CTX_FILE" 2> /dev/null || echo 'false')"
    _TURNS_SINCE_ASK="$(jq -r '.session_stats.turns_since_askQuestions // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    _CONSECUTIVE_UNAUTH="$(jq -r '.compliance.consecutive_unauthorized // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
fi
if should_emit_context_nudge "$_PUSH_PENDING" "$_TURNS_SINCE_ASK" "$_CONSECUTIVE_UNAUTH" "$AUTH_REQUESTED"; then
    _EMIT_CONTEXT_MSG=true
fi

if [ "$_EMIT_CONTEXT_MSG" = "true" ] && [ -f "$CTX_FILE" ]; then
    _CTX_SECTION="$(jq -r '.current_section.name // "(nenhuma)"' "$CTX_FILE" 2> /dev/null || echo '(nenhuma)')"
    _CTX_SECTION_NUM="$(jq -r '.current_section.section_number // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
    _CTX_TURN="$(jq -r '.current_turn.number // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
    _CTX_SECTION_TURN="$(jq -r '.current_turn.section_turn // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
    _CTX_PUSH_COUNT="$(jq -r '.session_stats.push_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    _CTX_ALTA=0
    _CTX_MEDIA=0
    _CTX_BACKLOG=0
    _CTX_NEXT_TASK="(sem tarefas)"
    TASKS_FILE_RT="$STATE_DIR/pending-tasks.md"
    if [ -f "$TASKS_FILE_RT" ]; then
        _CTX_ALTA="$(grep -c '^- \[ \].*\[alta\]' "$TASKS_FILE_RT" 2> /dev/null || echo 0)"
        _CTX_MEDIA="$(grep -c '^- \[ \].*\[media\]' "$TASKS_FILE_RT" 2> /dev/null || echo 0)"
        _CTX_BACKLOG="$(grep -c '^- \[ \].*\[backlog\]' "$TASKS_FILE_RT" 2> /dev/null || echo 0)"
        _CTX_NEXT_TASK="$(grep '^- \[ \].*\[alta\]' "$TASKS_FILE_RT" 2> /dev/null | head -1 | sed 's/^- \[ \] //' || echo '(sem tarefas alta)')"
    fi
    _CTX_PUSH_MSG=""
    if [ "$_PUSH_PENDING" = "true" ]; then
        _CTX_PUSH_MSG="
🔀 GIT PUSH DETECTADO (push #${_CTX_PUSH_COUNT}):
  → Declarar nova fase:  bash .github/hooks/scripts/start-section.sh \"nome-da-fase\"
  → Continuar na seção:  npm run hooks:continue-section"
    fi
    # Hardening v5.1: mensagem de violação escalona por gravidade
    _CTX_VIOLATION_MSG=""
    if [ "$AUTH_REQUESTED" = "false" ]; then
        if { [ "$_CONSECUTIVE_UNAUTH" -ge 3 ] 2> /dev/null; }; then
            _CTX_VIOLATION_MSG="
🚨 CRÍTICO: ${_CONSECUTIVE_UNAUTH} TURNs CONSECUTIVOS sem vscode_askQuestions!
  ⛔ SESSION em risco de encerramento não-autorizado.
  → Chame vscode_askQuestions AGORA (Template A, D, ou C conforme o contexto)"
        elif { [ "$_CONSECUTIVE_UNAUTH" -ge 2 ] 2> /dev/null; }; then
            _CTX_VIOLATION_MSG="
⛔ ALERTA: ${_CONSECUTIVE_UNAUTH} TURNs CONSECUTIVOS sem vscode_askQuestions!
  Esta violação será registrada no briefing da próxima sessão.
  → Template A (tarefa concluída) | Template D (checkpoint) | Template C (proposta)"
        elif { [ "$_CONSECUTIVE_UNAUTH" -ge 1 ] 2> /dev/null; } || { [ "$_TURNS_SINCE_ASK" -ge 3 ] 2> /dev/null; }; then
            _CTX_VIOLATION_MSG="
⚠ Turno encerrado sem vscode_askQuestions (${_TURNS_SINCE_ASK} desde o último).
  → Template A se concluiu tarefa | Template D para checkpoint periódico"
        fi
    fi
    # ── Hardening v6.0: SESSION close key SEMPRE visível no nudge ────────────
    # Removida condição >= 10 turnos que tornava o lembrete ineficaz.
    # A close_key é exibida em TODOS os nudges enquanto SESSION não for encerrada.
    _CTX_SESSION_CLOSE_MSG=""
    _CTX_CLOSE_KEY="$(jq -r '.session.close_key // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    _CTX_CLOSE_VALIDATED="$(jq -r '.session.close_key_validated // false' "$CTX_FILE" 2> /dev/null || echo 'false')"
    if [ "$_CTX_CLOSE_VALIDATED" = "false" ] && [ -n "$_CTX_CLOSE_KEY" ]; then
        _CTX_SESSION_CLOSE_MSG="
🔐 SESSION close key: ${_CTX_CLOSE_KEY}
    Para encerrar SESSION: vscode_askQuestions (Template F) → usuário digita KEY → post-tool-use valida e executa session-close.sh"
    fi
    # ── Hardening v6.0: formato com distinção explícita SESSION/SECTION/TURN ──
    _CTX_MSG="$(build_context_system_message \
        "$_CTX_SECTION_TURN" \
        "$_CTX_TURN" \
        "$_CTX_SECTION" \
        "$_CTX_SECTION_NUM" \
        "$_CTX_ALTA" \
        "$_CTX_MEDIA" \
        "$_CTX_BACKLOG" \
        "$_CTX_NEXT_TASK" \
        "$_CTX_PUSH_MSG" \
        "$_CTX_VIOLATION_MSG" \
        "$_CTX_SESSION_CLOSE_MSG")"
    printf '%s\n' "{\"systemMessage\":$(printf '%s' "$_CTX_MSG" | jq -Rs .)}"
fi

# ── Auto-enrich: gera turnStart_enriched_auto se start-turn.sh não foi chamado ──
if [ "$TURN_INTENT_DECLARED" = "false" ] && [ "$TURN_NUMBER" -gt 0 ]; then
    AUTO_INTENT="(não declarada)"
    if [ -f "$CTX_FILE" ]; then
        # Usa as ferramentas do turno como proxy de intenção
        TOP_TOOLS="$(jq -r '.current_turn.tools_by_name | to_entries | sort_by(-.value) | .[0:3] | map(.key) | join(", ")' \
            "$CTX_FILE" 2> /dev/null || echo '')"
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
    if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
        _CONSEC_FOR_FLAG="$_CONSEC_NOW"
    else
        _CONSEC_FOR_FLAG="$((_CONSEC_NOW + 1))"
    fi
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
    jq --arg now "$NOW_ISO" \
        --arg summary "$SESSION_SUMMARY" \
        --arg auth_field "$AUTH_INCR_FIELD" \
        --argjson next_turn "$NEXT_TURN" \
        --arg section "$SECTION_NAME" \
        --arg sec_id "$SECTION_ID" \
        --arg turn_id_s "$TURN_ID" \
        --argjson turn_num "$TURN_NUMBER" \
        --argjson sec_turn "$SECTION_TURN" \
        --argjson dur_s "$TURN_DURATION_S" \
        --argjson tools_n "$TURN_TOOLS_COUNT" \
        --arg intent_s "$TURN_INTENT" \
        --arg auth_s "$AUTH_REQUESTED" \
        --argjson fail_n "$TURN_FAILURES_COUNT" \
        '.session_stats.turn_count    = (.session_stats.turn_count // 0) + 1
         | .session_stats[$auth_field] = (.session_stats[$auth_field] // 0) + 1
         | .session_stats.turns_since_askQuestions = (
             if $auth_s == "true" then 0
             else (.session_stats.turns_since_askQuestions // 0) + 1
             end)
         | .last_turn_ts              = $now
         | .session_summary           = $summary
         | .session_stats.turn_history = (
             (.session_stats.turn_history // []) + [{
                 number:       $turn_num,
                 section:      $section,
                 section_id:   (if $sec_id == "" then null else $sec_id end),
                 turn_id:      (if $turn_id_s == "" then null else $turn_id_s end),
                 section_turn: $sec_turn,
                 duration_s:   $dur_s,
                 tools_count:  $tools_n,
                 intent:       (if $intent_s == "" then null else $intent_s end),
                 auth:         ($auth_s == "true"),
                 failures:     $fail_n,
                 ts:           $now
             }]
             | if length > 20 then .[-20:] else . end)
         | .session_stats.recovery_hints.last_section = $section
         | .session_stats.recovery_hints.last_intent  = (
             if $intent_s != "" then $intent_s
             else (.session_stats.recovery_hints.last_intent // null)
             end)
         | .current_turn.number            = $next_turn
         | .current_turn.started_at        = $now
         | .current_turn.tools_count       = 0
         | .current_turn.tools_by_name     = {}
         | .current_turn.failures_count    = 0
         | .current_turn.auth_requested    = false
         | .current_turn.auth_requested_at = null
         | .current_turn.last_askquestions_response = null
         | .current_turn.block_count       = 0
         | .current_turn.section_name      = $section
         | .current_turn.intent_declared   = false
         | .current_turn.intent            = null
         | .current_turn.askquestions_api_error = false
         | .current_turn.askquestions_api_error_at = null
         | .current_turn.todo_created      = false
         | .current_turn.subagent_delegated = false' \
        "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
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
