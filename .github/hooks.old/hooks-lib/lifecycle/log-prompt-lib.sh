#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail

# Lógica de domínio do hook userPromptSubmitted (log-prompt).
# Pré-requisito: common.sh carregado pelo script entrypoint.
run_log_prompt_hook() {
    local HOOK_DIR="${1:-}"
    [ -n "$HOOK_DIR" ] || HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

    local LOG_DIR="$HOOK_DIR/logs"
    local STATE_DIR="$HOOK_DIR/state"
    local CTX_FILE="$HOOK_DIR/state/session-context.json"
    local AUDIT_FILE="$HOOK_DIR/logs/audit.jsonl"

    mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"
    mkdir -p "$STATE_DIR" && chmod 700 "$STATE_DIR"

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

    _LOCAL_TS="${NOW_ISO:-$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')}"
    CWD="$(echo "$INPUT" | jq -r '.cwd // ""' 2> /dev/null || echo '')"
    PROMPT_RAW="$(echo "$INPUT" | jq -r '.prompt // ""' 2> /dev/null || echo '')"

    # G9-08: Lock exclusivo APÓS resolver CTX_FILE per-session
    _CTX_LOCK="${CTX_FILE}.lock"
    exec 9> "$_CTX_LOCK"
    if command -v flock > /dev/null 2>&1; then
        flock -x -w 3 9 2> /dev/null
    fi

    ctx_apply_expr() {
        local expr="${1:-}"
        shift || true

        [ -n "$expr" ] || return 1
        [ -f "$CTX_FILE" ] || return 1

        if command -v ctx_apply_jq_expr_best_effort > /dev/null 2>&1; then
            ctx_apply_jq_expr_best_effort "$expr" "$@" > /dev/null 2>&1 || true
            return 0
        fi

        if command -v sponge > /dev/null 2>&1; then
            jq "$@" "$expr" "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
        else
            local _tmp_ctx
            if _tmp_ctx="$(mktemp 2> /dev/null)"; then
                if jq "$@" "$expr" "$CTX_FILE" > "$_tmp_ctx" 2> /dev/null; then
                    mv "$_tmp_ctx" "$CTX_FILE" 2> /dev/null || rm -f "$_tmp_ctx"
                else
                    rm -f "$_tmp_ctx"
                fi
            fi
        fi

        return 0
    }

    # ── Auto-recovery no próprio userPromptSubmitted ─────────────────────────────
    # sessionStart pode não disparar em retomadas/reconexões. Quando isso ocorre,
    # o primeiro sinal confiável é userPromptSubmitted; criamos contexto mínimo aqui
    # para preservar semântica de TURN/SESSION desde o início.
    if [ -n "$SESSION_ID_PAYLOAD" ] && { [ ! -f "$CTX_FILE" ] || [ ! -s "$CTX_FILE" ]; }; then
        NOW_PROMPT_RECOVERY="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo "${TIMESTAMP:-}")"
        PROMPT_RECOVERY_CLOSE_KEY=""
        if [ -f "$STATE_DIR/session-briefing.md" ]; then
            PROMPT_RECOVERY_CLOSE_KEY="$(grep -oE 'ENCERRAR-[A-F0-9]{8}' "$STATE_DIR/session-briefing.md" 2> /dev/null | head -1 || echo '')"
        fi
        if [ -z "$PROMPT_RECOVERY_CLOSE_KEY" ]; then
            PROMPT_RECOVERY_CLOSE_KEY="ENCERRAR-$(date +%s%N 2> /dev/null | sha256sum | head -c 8 | tr '[:lower:]' '[:upper:]')"
        fi

        _PROMPT_RECOVERY_TMP="$(mktemp 2> /dev/null || echo '')"
        if [ -n "$_PROMPT_RECOVERY_TMP" ]; then
            if jq -cn \
                --arg sid "$SESSION_ID_PAYLOAD" \
                --arg now "$NOW_PROMPT_RECOVERY" \
                --arg close_key "$PROMPT_RECOVERY_CLOSE_KEY" \
                '{
                    session: {
                        id: $sid,
                        vs_code_session_id: $sid,
                        started_at: $now,
                        ended_at: null,
                        end_reason: null,
                        close_key: $close_key,
                        close_key_validated: false,
                        strict_turn_close_requires_key: true,
                        source: "prompt_auto_recovery",
                        cwd: null
                    },
                    session_stats: {
                        turn_count: 0,
                        turn_authorized: 0,
                        turn_unauthorized: 0,
                        resume_count: 0,
                        tools_total: 0,
                        tools_by_name: {},
                        failures_detected: 0,
                        errors_total: 0,
                        subagent_calls: 0,
                        section_count: 1,
                        section_names: ["recovery"],
                        section_history: [],
                        turn_history: [],
                        push_count: 0,
                        commit_history: [],
                        pending_section_after_push: false,
                        recovery_hints: {
                            last_intent: null,
                            last_section: null,
                            last_commit_sha: null,
                            last_commit_ts: null
                        }
                    },
                    current_turn: {
                        number: 1,
                        started_at: $now,
                        tools_count: 0,
                        tools_by_name: {},
                        failures_count: 0,
                        auth_requested: false,
                        auth_requested_at: null,
                        last_askquestions_response: null,
                        section_name: "recovery",
                        turn_id: null,
                        section_turn: 1,
                        block_count: 0,
                        intent_declared: false,
                        intent: null,
                        todo_created: false,
                        agentStop_invocations: 0,
                        subagent_delegated: false,
                        last_non_bookkeeping_tool: null,
                        last_askquestions_template: null,
                        last_askquestions_close_action: null,
                        last_askquestions_close_key_found: false,
                        todo_last_item_label: null,
                        todo_last_item_is_askquestions_continuation: false,
                        todo_last_item_checked_at: null,
                        todo_protocol_version: null,
                        continuation_instruction_clear: null,
                        continuation_mandatory: false,
                        continuation_mandatory_at: null,
                        continuation_mandatory_reason: null,
                        auto_audit_required: false,
                        auto_audit_required_at: null,
                        auto_audit_reason: null,
                        auto_audit_started: false,
                        auto_audit_started_at: null,
                        auto_audit_started_tool: null
                    },
                    current_section: {
                        name: "recovery",
                        started_at: $now,
                        turn_start: 1,
                        description: "Seção criada por auto-recovery em userPromptSubmitted",
                        section_number: 1,
                        section_id: null,
                        local_turn: 0,
                        push_count: 0,
                        tools_by_name: {},
                        intent_history: [],
                        failures_count: 0,
                        blocked_turns: 0
                    },
                    last_tool: {
                        name: null,
                        ts: $now,
                        use_id: null,
                        result: null
                    },
                    compliance: {
                        last_turn_authorized: null,
                        consecutive_unauthorized: 0,
                        flag_file_exists: false
                    },
                    hook_observability: {
                        sessionStart_count: 0,
                        userPromptSubmitted_count: 1,
                        last_sessionStart_at: null,
                        last_sessionStart_source: null,
                        last_userPromptSubmitted_at: $now,
                        last_userPromptSubmitted_hash: null
                    },
                    quality_gates: {}
                }' > "$_PROMPT_RECOVERY_TMP" 2> /dev/null; then
                mv "$_PROMPT_RECOVERY_TMP" "$CTX_FILE" 2> /dev/null || rm -f "$_PROMPT_RECOVERY_TMP"
                jq -cn \
                    --arg event "session_auto_recovery_prompt" \
                    --arg sid "$SESSION_ID_PAYLOAD" \
                    --arg ts "${TIMESTAMP:-$NOW_PROMPT_RECOVERY}" \
                    --arg key "$PROMPT_RECOVERY_CLOSE_KEY" \
                    '{
                        event: $event,
                        session_id: $sid,
                        timestamp: $ts,
                        close_key: $key,
                        source: "log-prompt.sh",
                        message: "sessionStart ausente — contexto mínimo criado no userPromptSubmitted"
                    }' >> "$AUDIT_FILE"
            else
                rm -f "$_PROMPT_RECOVERY_TMP"
            fi
        fi
    fi

    # Obtém session_id e section_id do contexto persistido — fix B6: sem quebra de linha invisível
    SESSION_ID=""
    SECTION_ID_PRE=""
    PREV_TURN_COUNT=0
    PREV_LAST_TURN_TS=""
    if [ -f "$CTX_FILE" ]; then
        SESSION_ID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        SECTION_ID_PRE="$(jq -r '.current_section.section_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        PREV_TURN_COUNT="$(jq -r '.session_stats.turn_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
        PREV_LAST_TURN_TS="$(jq -r '.last_turn_ts // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    fi

    # ══════════════════════════════════════════════════════════════════════════════
    # PHASE 0 — SESSION_ID RECONCILIATION (GAP-01, PREMISSA-1)
    # ══════════════════════════════════════════════════════════════════════════════
    # Esta fase DEVE ser executada ANTES de qualquer outra leitura ou escrita no CTX.
    # Princípio: o session_id do VS Code (SESSION_ID_PAYLOAD) é SEMPRE a fonte da
    # verdade. Nunca geramos um novo UUID nem bloqueamos state writes por mismatch.
    #
    # Casos tratados:
    #   HEAL v1  — CTX source=manual_recovery → adota SESSION_ID_PAYLOAD imediatamente
    #   HEAL v1b — CTX source=inline_restart  → idem (BUG-06 FIX)
    #   RECONNECT-01 — VS Code reconectou (novo session_id, sessionStart não disparou)
    #                  → rollover controlado, sessionEnd sintético, source=reconnect_rollover
    #   RECONNECT-02 — CTX com ended_at != null mas hooks ainda ativos
    #                  → reinício inline (source=inline_restart), nova close_key
    #
    # GAP-03: contadores session_id_mismatches e session_id_syncs_inline em session_stats
    # GAP-02: campo session.vs_code_session_id atualizado em todos os paths abaixo
    # ══════════════════════════════════════════════════════════════════════════════

    # ── Guard: session_id deve corresponder ao contexto ativo ─────────────────────
    # F0.3: detecta contexto vazio
    if [ -f "$CTX_FILE" ] && [ ! -s "$CTX_FILE" ]; then
        echo "[guard] session-context.json vazio — guard desabilitado (aguardando auto-recovery)" >&2
    fi
    # HARDENING v5: previne contaminação cruzada entre SESSIONs.
    # HEAL v1: quando CTX_FILE é de manual_recovery ou inline_restart, adota session_id real do Copilot.
    if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] && [ -n "$SESSION_ID_PAYLOAD" ]; then
        CTX_ACTIVE_SID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        if [ -n "$CTX_ACTIVE_SID" ] && [ "$SESSION_ID_PAYLOAD" != "$CTX_ACTIVE_SID" ]; then
            CTX_SOURCE="$(jq -r '.session.source // ""' "$CTX_FILE" 2> /dev/null || echo '')"
            if [ "$CTX_SOURCE" = "manual_recovery" ]; then
                # Auto-heal: sessão real do Copilot detectada após init manual — usa helper canônico.
                _HEALED_SID="$(handle_manual_recovery_session_id "$SESSION_ID_PAYLOAD" "userPromptSubmitted" "${TIMESTAMP:-$NOW_ISO}" "log-prompt.sh" 2> /dev/null || true)"
                if [ -n "$_HEALED_SID" ]; then
                    SESSION_ID="$_HEALED_SID"
                else
                    SESSION_ID="$SESSION_ID_PAYLOAD"
                fi
            else
                # ── Rollover de reconexão (RECONNECT-01) ──────────────────────────────────
                # O cliente VS Code desconectou e reconectou, gerando novo session_id.
                # O evento sessionStart NÃO é disparado pelo Copilot em reconexões.
                # Comportamento anterior: bloquear state write → 395 mismatches por sessão.
                # Comportamento novo: detectar como reconexão legítima e atualizar contexto.
                NOW_RECONNECT="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
                # 1) Logar evento de reconexão
                jq -cn \
                    --arg event "sessionReconnect" \
                    --arg old "$CTX_ACTIVE_SID" \
                    --arg new "$SESSION_ID_PAYLOAD" \
                    --arg source "log-prompt.sh" \
                    --arg ts "${TIMESTAMP:-$NOW_RECONNECT}" \
                    '{event: $event, old_session_id: $old, new_session_id: $new,
                      source: $source, timestamp: $ts,
                      message: "Reconexão do cliente VS Code detectada — rollover para novo session_id"}' \
                    >> "$AUDIT_FILE"
                # Detectar se o rollover pode ser causado por compactação inline (inline conversation summary)
                # Distinção crítica: inline_compact_summary ≠ preCompact hook event
                # Evidência: compaction_count=0 após rollover indica que preCompact nunca disparou
                _COMPACT_COUNT_CHK="$(jq -r '.session_stats.compaction_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
                if [ "$_COMPACT_COUNT_CHK" = "0" ] || [ "$_COMPACT_COUNT_CHK" = "null" ]; then
                    jq -cn \
                        --arg event "inlineCompact_suspected" \
                        --arg sid "$CTX_ACTIVE_SID" \
                        --arg ts "${TIMESTAMP:-$NOW_RECONNECT}" \
                        '{event: $event, session_id: $sid, timestamp: $ts,
                          source: "log-prompt.sh",
                          message: "Rollover com compaction_count=0 sugere reinicio inline por orcamento de tokens (nao preCompact)",
                          note: "inline_conversation_summary != preCompact_hook — ver GUIA-HOOKS-COPILOT.md secao 16.9"}' \
                        >> "$AUDIT_FILE"
                fi
                # 2) Gerar sessionEnd sintético para a sessão anterior
                jq -cn \
                    --arg event "sessionEnd" \
                    --arg sid "$CTX_ACTIVE_SID" \
                    --arg ts "${TIMESTAMP:-$NOW_RECONNECT}" \
                    --arg mode "abrupt_reconnect" \
                    '{event: $event, session_id: $sid, timestamp: $ts, close_mode: $mode,
                      message: "sessionEnd sintético gerado por log-prompt.sh (rollover de reconexão)"}' \
                    >> "$AUDIT_FILE"
                # 3) Atualizar contexto para o novo session_id (não bloquear state write)
                if command -v sponge &> /dev/null; then
                    jq --arg new_sid "$SESSION_ID_PAYLOAD" --arg ts "$NOW_RECONNECT" \
                        '.session.id = $new_sid
                         | .session.vs_code_session_id = $new_sid
                         | .session.strict_turn_close_requires_key = (if (.session.strict_turn_close_requires_key == null) then true else .session.strict_turn_close_requires_key end)
                         | .session.reconnect_at = $ts
                         | .session.source = "reconnect_rollover"' \
                        "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
                else
                    _TMP_RC="$(mktemp)"
                    if jq --arg new_sid "$SESSION_ID_PAYLOAD" --arg ts "$NOW_RECONNECT" \
                        '.session.id = $new_sid
                         | .session.vs_code_session_id = $new_sid
                         | .session.strict_turn_close_requires_key = (if (.session.strict_turn_close_requires_key == null) then true else .session.strict_turn_close_requires_key end)
                         | .session.reconnect_at = $ts
                         | .session.source = "reconnect_rollover"' \
                        "$CTX_FILE" > "$_TMP_RC" 2> /dev/null; then
                        mv "$_TMP_RC" "$CTX_FILE" 2> /dev/null || rm -f "$_TMP_RC"
                    else
                        rm -f "$_TMP_RC"
                    fi
                fi
                SESSION_ID="$SESSION_ID_PAYLOAD" # prossegue com o novo ID
            fi
        fi
    fi

    # ── Post-Close Recovery (RECONNECT-02) ───────────────────────────────────────
    # Detecta "orphan session": sessão encerrada (ended_at != null) mas hooks ainda
    # ativos (mesmo session_id do VS Code → sessão real não reiniciou).
    # Causa: session-close.sh registra ended_at, mas VS Code não dispara sessionStart
    # novamente para o mesmo painel. Resultado: hooks continuam com contexto morto.
    # Fix: ao receber novo prompt com sessão encerrada, inicia sessão inline.
    if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ]; then
        _ENDED_AT_RC="$(jq -r '.session.ended_at // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        if [ -n "$_ENDED_AT_RC" ] && [ "$_ENDED_AT_RC" != "null" ]; then
            NOW_RESTART="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
            _PREV_SID="$(jq -r '.session.id // "unknown"' "$CTX_FILE" 2> /dev/null || echo 'unknown')"
            _PREV_END_REASON="$(jq -r '.session.end_reason // ""' "$CTX_FILE" 2> /dev/null || echo '')"
            _PREV_ENDED_AT="$_ENDED_AT_RC"
            _PREV_LOGICAL_NUM="$(jq -r '.session.logical_session_number // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
            _NEW_LOGICAL_NUM=$((${_PREV_LOGICAL_NUM:-1} + 1))
            # FIX BUG-01: usa session_id real do VS Code (Premissa-1: VS Code é a fonte da verdade).
            # O VS Code continuará enviando SESSION_ID_PAYLOAD em todos os hooks futuros —
            # gerar UUID aqui causaria mismatch permanente em pre-tool-use.sh e post-tool-use.sh.
            # A distinção "nova sessão lógica" é capturada por: source="inline_restart",
            # started_at (novo timestamp) e prev_session_id.
            if [ -n "$SESSION_ID_PAYLOAD" ]; then
                _NEW_SID="$SESSION_ID_PAYLOAD"
            elif [ -f /proc/sys/kernel/random/uuid ]; then
                # Fallback apenas quando VS Code não enviou session_id (caso improvável)
                _NEW_SID="$(cat /proc/sys/kernel/random/uuid)"
            else
                _NEW_SID="sess_$(date +%s%N 2> /dev/null | sha256sum | head -c 32 || date +%s | head -c 32)"
            fi
            # Gera novo close_key (portável — sem xxd, usa sha256sum)
            _NEW_KEY="ENCERRAR-$(date +%s%N 2> /dev/null | sha256sum | head -c 8 | tr '[:lower:]' '[:upper:]' \
                || date +%s | sha256sum | head -c 8 | tr '[:lower:]' '[:upper:]')"
            # Atualiza contexto: nova sessão inline
            if command -v sponge &> /dev/null; then
                jq --arg sid "$_NEW_SID" --arg key "$_NEW_KEY" --arg ts "$NOW_RESTART" \
                    --arg prev_sid "$_PREV_SID" --arg prev_ended "$_PREV_ENDED_AT" \
                    --arg prev_reason "$_PREV_END_REASON" \
                    --argjson new_logical_num "$_NEW_LOGICAL_NUM" \
                    '.session.id                  = $sid
                     | .session.vs_code_session_id = $sid
                     | .session.close_key         = $key
                     | .session.close_key_validated = false
                     | .session.strict_turn_close_requires_key = true
                     | .session.started_at        = $ts
                     | .session.ended_at          = null
                     | .session.end_reason        = null
                     | .session.source            = "inline_restart"
                     | .session.prev_session_id   = $prev_sid
                     | .session.prev_ended_at     = $prev_ended
                     | .session.prev_end_reason   = $prev_reason
                     | .session_stats.turn_count  = 0
                     | .session_stats.failures_detected = 0
                     | .session_stats.turns_since_askQuestions = 0
                     | .session_stats.prev_turn_authorized = (.session_stats.turn_authorized // 0)
                     | .session_stats.prev_turn_no_askQuestions = (.session_stats.turn_no_askQuestions // 0)
                     | .session_stats.turn_authorized = 0
                     | .session_stats.turn_no_askQuestions = 0
                     | .session_stats.pending_section_after_push = false
                     | .session_stats.session_id_mismatches = 0
                     | .session_stats.push_count = 0
                     | .session_stats.last_push_at = null
                     | .session_stats.last_push_turn = null
                     | .compliance.consecutive_unauthorized = 0
                     | .compliance.last_turn_authorized = true
                     | .current_turn = {number: 0, section_turn: 0, todo_created: false,
                         tools_count: 0, auth_requested: false, intent: null, intent_declared: false,
                         last_non_bookkeeping_tool: null,
                         last_askquestions_template: null,
                         last_askquestions_close_action: null,
                         last_askquestions_close_key_found: false,
                         todo_last_item_label: null,
                         todo_last_item_is_askquestions_continuation: false,
                         todo_last_item_checked_at: null,
                         todo_protocol_version: null,
                         continuation_instruction_clear: null,
                         continuation_mandatory: false,
                         continuation_mandatory_at: null,
                         continuation_mandatory_reason: null,
                         auto_audit_required: false,
                         auto_audit_required_at: null,
                         auto_audit_reason: null,
                         auto_audit_started: false,
                         auto_audit_started_at: null,
                         auto_audit_started_tool: null}
                     | .session.logical_session_number             = $new_logical_num
                     | .session_stats.prev_section_count           = (.session_stats.section_count // 0)
                     | .session_stats.prev_section_names           = (.session_stats.section_names // [])
                     | .session_stats.section_count               = 0
                     | .session_stats.section_names               = []' \
                    "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
            else
                _TMP_RESTART="$(mktemp)"
                if jq --arg sid "$_NEW_SID" --arg key "$_NEW_KEY" --arg ts "$NOW_RESTART" \
                    --arg prev_sid "$_PREV_SID" --arg prev_ended "$_PREV_ENDED_AT" \
                    --arg prev_reason "$_PREV_END_REASON" \
                    --argjson new_logical_num "$_NEW_LOGICAL_NUM" \
                    '.session.id                  = $sid
                     | .session.vs_code_session_id = $sid
                     | .session.close_key         = $key
                     | .session.close_key_validated = false
                     | .session.strict_turn_close_requires_key = true
                     | .session.started_at        = $ts
                     | .session.ended_at          = null
                     | .session.end_reason        = null
                     | .session.source            = "inline_restart"
                     | .session.prev_session_id   = $prev_sid
                     | .session.prev_ended_at     = $prev_ended
                     | .session.prev_end_reason   = $prev_reason
                     | .session_stats.turn_count  = 0
                     | .session_stats.failures_detected = 0
                     | .session_stats.turns_since_askQuestions = 0
                     | .session_stats.prev_turn_authorized = (.session_stats.turn_authorized // 0)
                     | .session_stats.prev_turn_no_askQuestions = (.session_stats.turn_no_askQuestions // 0)
                     | .session_stats.turn_authorized = 0
                     | .session_stats.turn_no_askQuestions = 0
                     | .session_stats.pending_section_after_push = false
                     | .session_stats.session_id_mismatches = 0
                     | .session_stats.push_count = 0
                     | .session_stats.last_push_at = null
                     | .session_stats.last_push_turn = null
                     | .compliance.consecutive_unauthorized = 0
                     | .compliance.last_turn_authorized = true
                     | .current_turn = {number: 0, section_turn: 0, todo_created: false,
                         tools_count: 0, auth_requested: false, intent: null, intent_declared: false,
                         last_non_bookkeeping_tool: null,
                         last_askquestions_template: null,
                         last_askquestions_close_action: null,
                         last_askquestions_close_key_found: false,
                         todo_last_item_label: null,
                         todo_last_item_is_askquestions_continuation: false,
                         todo_last_item_checked_at: null,
                         todo_protocol_version: null,
                         continuation_instruction_clear: null,
                         continuation_mandatory: false,
                         continuation_mandatory_at: null,
                         continuation_mandatory_reason: null,
                         auto_audit_required: false,
                         auto_audit_required_at: null,
                         auto_audit_reason: null,
                         auto_audit_started: false,
                         auto_audit_started_at: null,
                         auto_audit_started_tool: null}
                     | .session.logical_session_number             = $new_logical_num
                     | .session_stats.prev_section_count           = (.session_stats.section_count // 0)
                     | .session_stats.prev_section_names           = (.session_stats.section_names // [])
                     | .session_stats.section_count               = 0
                     | .session_stats.section_names               = []' \
                    "$CTX_FILE" > "$_TMP_RESTART" 2> /dev/null; then
                    mv "$_TMP_RESTART" "$CTX_FILE" 2> /dev/null || rm -f "$_TMP_RESTART"
                else
                    rm -f "$_TMP_RESTART"
                fi
            fi
            # Log do evento sessionStart_inline
            jq -cn \
                --arg sid "$_NEW_SID" --arg prev_sid "$_PREV_SID" --arg ts "$NOW_RESTART" \
                --arg key "$_NEW_KEY" --arg prev_ended "$_PREV_ENDED_AT" \
                --arg prev_reason "$_PREV_END_REASON" \
                --argjson new_logical_num "$_NEW_LOGICAL_NUM" \
                --argjson prev_logical_num "$_PREV_LOGICAL_NUM" \
                '{
                    event:                       "sessionStart_inline",
                    session_id:                  $sid,
                    prev_session_id:             $prev_sid,
                    timestamp:                   $ts,
                    close_key:                   $key,
                    prev_ended_at:               $prev_ended,
                    prev_end_reason:             $prev_reason,
                    logical_session_number:      $new_logical_num,
                    prev_logical_session_number: $prev_logical_num,
                    source:                      "log-prompt.sh",
                    message:                     "Nova sessão inline após fechamento da sessão anterior"
                }' >> "$AUDIT_FILE"
            SESSION_ID="$_NEW_SID"
            echo "[log-prompt] Sessão anterior encerrada (${_PREV_ENDED_AT}). Nova sessão inline: ${_NEW_SID} | close_key: ${_NEW_KEY}" >&2

            # BUG-74 FIX: Atualizar session-briefing.md com a nova close_key
            # (RECONNECT-02 gera nova chave, briefing precisa refletir isso)
            if [ -f "$STATE_DIR/session-briefing.md" ]; then
                # Estratégia robusta: regenera a seção de close_key com awk/sed portável
                # Localiza "### 🔐 CHAVE DE ENCERRAMENTO" e substitui bloco até próxima seção
                if command -v sponge > /dev/null 2>&1; then
                    awk -v new_key="$_NEW_KEY" '
                        /^### 🔐 CHAVE DE ENCERRAMENTO DA SESSÃO/ {
                            print $0
                            print ""
                            print "```"
                            print new_key
                            print "```"
                            print ""
                            # Pula linhas até próxima seção (^##)
                            found=1
                            next
                        }
                        found && /^##/ { found=0 }
                        !found { print }
                    ' "$STATE_DIR/session-briefing.md" | sponge "$STATE_DIR/session-briefing.md" 2> /dev/null || true
                else
                    # Fallback sem sponge: cria arquivo temporário
                    tmp_briefing="$(mktemp)" || true
                    [ -z "$tmp_briefing" ] && tmp_briefing="${STATE_DIR}/session-briefing.md.tmp"
                    awk -v new_key="$_NEW_KEY" '
                        /^### 🔐 CHAVE DE ENCERRAMENTO DA SESSÃO/ {
                            print $0
                            print ""
                            print "```"
                            print new_key
                            print "```"
                            print ""
                            found=1
                            next
                        }
                        found && /^##/ { found=0 }
                        !found { print }
                    ' "$STATE_DIR/session-briefing.md" > "$tmp_briefing" 2> /dev/null \
                        && mv "$tmp_briefing" "$STATE_DIR/session-briefing.md" 2> /dev/null || true
                fi
            fi
        fi
    fi

    # ── P1: Sincroniza ponteiro da sessão ativa (current-session-id) ────────────
    # Mantém watchdog e ferramentas de diagnóstico alinhados ao session_id reconciliado
    # no início do TURN. Evita split-brain entre ponteiro ativo e arquivos per-session.
    if [ -n "$SESSION_ID" ]; then
        if command -v set_current_session_id > /dev/null 2>&1; then
            set_current_session_id "$SESSION_ID" 2> /dev/null || true
        fi
    fi

    # ── Backfill canônico da flag strict de fechamento de TURN ──────────────────
    # Mantém coerência em retomadas/reconexões e contextos legados sem esse campo.
    if command -v ensure_strict_turn_close_flag_default > /dev/null 2>&1; then
        ensure_strict_turn_close_flag_default "$CTX_FILE" > /dev/null 2>&1 || true
    fi

    # Calcula hash SHA-256 truncado do prompt (jamais loga o texto completo)
    PROMPT_HASH=""
    PROMPT_LEN="${#PROMPT_RAW}"
    if [ -n "$PROMPT_RAW" ] && command -v sha256sum &> /dev/null; then
        PROMPT_HASH="$(echo -n "$PROMPT_RAW" | sha256sum | cut -c1-16)"
    elif [ -n "$PROMPT_RAW" ] && command -v shasum &> /dev/null; then
        PROMPT_HASH="$(echo -n "$PROMPT_RAW" | shasum -a 256 | cut -c1-16)"
    fi

    # Loga apenas metadados — sem o texto do prompt
    jq -cn \
        --arg event "userPromptSubmitted" \
        --arg sid "$SESSION_ID" \
        --arg sid_payload "$SESSION_ID_PAYLOAD" \
        --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
        --arg cwd "$CWD" \
        --arg hash "$PROMPT_HASH" \
        --arg section_id "$SECTION_ID_PRE" \
        --argjson len "$PROMPT_LEN" \
        '{
            event:               $event,
            session_id:          $sid,
            session_id_in_payload: (if $sid_payload == "" then false else true end),
            timestamp:           $ts,
            cwd:                 $cwd,
            prompt_hash:         $hash,
            prompt_len:          $len,
            section_id:  (if $section_id == "" then null else $section_id end)
        }' >> "$AUDIT_FILE"

    # Evento explícito de classificação do gatilho do hook para auditoria semântica.
    # userPromptSubmitted é disparado por prompt no chat box (não por respostas de askQuestions).
    _TURN_CLASSIFICATION="new_session_first_prompt"
    if [[ "${PREV_TURN_COUNT:-0}" =~ ^[0-9]+$ ]] && [ "${PREV_TURN_COUNT:-0}" -gt 0 ]; then
        _TURN_CLASSIFICATION="session_resume_or_continuation"
    fi
    jq -cn \
        --arg event "hookInvocation_userPromptSubmitted" \
        --arg sid "$SESSION_ID" \
        --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
        --arg classification "$_TURN_CLASSIFICATION" \
        --argjson prev_turn_count "${PREV_TURN_COUNT:-0}" \
        '{
            event: $event,
            session_id: $sid,
            timestamp: $ts,
            classification: $classification,
            previous_turn_count: $prev_turn_count,
            semantic_note: "Dispara ao enviar prompt na caixa de chat; respostas de askQuestions sao postToolUse",
            evidence_scope: "hook_runtime_classification"
        }' >> "$AUDIT_FILE"

    # ── Session resume semantics (evidência operacional) ─────────────────────────
    # userPromptSubmitted é o sinal mais confiável de retomada de chat existente
    # (novo TURN dentro de SESSION já ativa). sessionStart pode não disparar em
    # retomadas/reconexões do painel.
    _IS_SESSION_RESUME=false
    if [[ "${PREV_TURN_COUNT:-0}" =~ ^[0-9]+$ ]] && [ "${PREV_TURN_COUNT:-0}" -gt 0 ]; then
        _IS_SESSION_RESUME=true
        _RESUME_GAP_S=null
        if [ -n "$PREV_LAST_TURN_TS" ]; then
            _NOW_EPOCH="$(date -u -d "${TIMESTAMP:-$_LOCAL_TS}" +%s 2> /dev/null || echo '')"
            _PREV_EPOCH="$(date -u -d "$PREV_LAST_TURN_TS" +%s 2> /dev/null || echo '')"
            if [ -n "$_NOW_EPOCH" ] && [ -n "$_PREV_EPOCH" ] && [ "$_NOW_EPOCH" -ge "$_PREV_EPOCH" ] 2> /dev/null; then
                _RESUME_GAP_S=$((_NOW_EPOCH - _PREV_EPOCH))
            fi
        fi

        jq -cn \
            --arg event "sessionResumeDetected" \
            --arg sid "$SESSION_ID" \
            --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
            --arg prev_turn_ts "$PREV_LAST_TURN_TS" \
            --argjson prev_turn_count "${PREV_TURN_COUNT:-0}" \
            --argjson gap_s "${_RESUME_GAP_S}" \
            ' {
                event: $event,
                session_id: $sid,
                timestamp: $ts,
                previous_turn_count: $prev_turn_count,
                previous_turn_ts: (if $prev_turn_ts == "" then null else $prev_turn_ts end),
                resume_gap_s: $gap_s,
                detected_by: "userPromptSubmitted",
                message: "Retomada de chat existente detectada (novo TURN em SESSION ativa)"
            }' >> "$AUDIT_FILE"
    fi

    # ── Reseta current_turn no início de cada novo turno do usuário ──────────────
    # Belt-and-suspenders: agent-stop.sh também reseta ao final do turno anterior,
    # mas se agentStop não disparar, este reset garante que o próximo turno
    # não herde estado "fantasma" do turno anterior.
    # current_turn.number = session_stats.turn_count + 1 (turno que está começando)
    # Schema v4: section_name capturado da section ativa; last_askquestions_response resetado.
    NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
    TURN_NUMBER=1
    SECTION_TURN=1
    SECTION_NAME=""
    SECTION_ID=""
    # Gera turn_id UUID para rastreio único deste turno
    TURN_ID="$(uuidgen 2> /dev/null || printf 'turn_%s_%s' "$(date +%s)" "$$")"
    SUBTURN_ID="${TURN_ID}_st1"
    SUBTURN_NUMBER=1

    if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
        jq --arg ts "${TIMESTAMP:-$NOW_ISO}" \
            --arg turn_id "$TURN_ID" \
            --arg subturn_id "$SUBTURN_ID" \
            --arg hash "$PROMPT_HASH" \
            --argjson is_resume "$_IS_SESSION_RESUME" \
            '.current_turn.started_at                = $ts
             | .current_turn.turn_id                  = $turn_id
             | .current_turn.tools_count               = 0
             | .current_turn.tools_by_name             = {}
             | .current_turn.failures_count            = 0
             | .current_turn.auth_requested            = false
             | .current_turn.auth_requested_at         = null
             | .current_turn.last_askquestions_response = null
             | .current_turn.number                    = ((.session_stats.turn_count // 0) + 1)
             | .current_turn.section_name              = .current_section.name
             | .current_turn.section_id               = .current_section.section_id
             | .current_turn.intent_declared           = false
             | .current_turn.intent                    = null
             | .current_turn.block_count               = 0
             | .current_turn.agentStop_invocations     = 0
             | .current_turn.todo_created              = false
             | .current_turn.last_non_bookkeeping_tool = null
             | .current_turn.last_askquestions_template = null
             | .current_turn.last_askquestions_close_action = null
             | .current_turn.last_askquestions_close_key_found = false
             | .current_turn.todo_last_item_label = null
             | .current_turn.todo_last_item_is_askquestions_continuation = false
             | .current_turn.todo_last_item_checked_at = null
             | .current_turn.todo_protocol_version = null
             | .current_turn.continuation_instruction_clear = null
             | .current_turn.continuation_mandatory = false
             | .current_turn.continuation_mandatory_at = null
             | .current_turn.continuation_mandatory_reason = null
             | .current_turn.auto_audit_required = false
             | .current_turn.auto_audit_required_at = null
             | .current_turn.auto_audit_reason = null
             | .current_turn.auto_audit_started = false
             | .current_turn.auto_audit_started_at = null
             | .current_turn.auto_audit_started_tool = null
             | .current_turn.required_docs_pending = []
             | .current_turn.required_docs_read_log = []
             | .current_turn.required_docs_obligation = null
             | .current_turn.required_docs_status = "not_required"
             | .current_turn.subturn = {
                 number: 1,
                 subturn_id: $subturn_id,
                 state: "active",
                 reason: "turn_start",
                 started_at: $ts,
                 last_transition_at: $ts,
                 parent_turn_id: $turn_id,
                 expected_window_minutes: 15,
                 stop_hook_active: false,
                 requires_user_action: false,
                 authorization_snapshot: {
                     auth_requested: false,
                     ask_template: null,
                     close_key_found: false,
                     close_key_validated: false
                 }
             }
             | .current_turn.subturn_history = []
             | .session_stats.resume_count             = ((.session_stats.resume_count // 0) + (if $is_resume then 1 else 0 end))
             | .session_stats.subturn_count            = ((.session_stats.subturn_count // 0) + 1)
             | .session_stats.subturn_blocked          = (.session_stats.subturn_blocked // 0)
             | .session_stats.subturn_resumed          = (.session_stats.subturn_resumed // 0)
             | .session_stats.subturn_via_subagent     = (.session_stats.subturn_via_subagent // 0)
             | .session_stats.subturn_via_askquestions = (.session_stats.subturn_via_askquestions // 0)
             | .hook_observability = ((.hook_observability // {}) + {
                 sessionStart_count: (.hook_observability.sessionStart_count // 0),
                 userPromptSubmitted_count: ((.hook_observability.userPromptSubmitted_count // 0) + 1),
                 last_sessionStart_at: (.hook_observability.last_sessionStart_at // null),
                 last_sessionStart_source: (.hook_observability.last_sessionStart_source // null),
                 last_userPromptSubmitted_at: $ts,
                 last_userPromptSubmitted_hash: (if $hash == "" then null else $hash end)
             })
             | .current_section.local_turn             = ((.current_section.local_turn // 0) + 1)
             | .current_turn.section_turn              = (.current_section.local_turn // 1)' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true

        # Lê valores pós-reset para logar turnStart
        TURN_NUMBER="$(jq -r '.current_turn.number // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
        SECTION_TURN="$(jq -r '.current_turn.section_turn // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
        SECTION_NAME="$(jq -r '.current_section.name // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        SECTION_ID="$(jq -r '.current_section.section_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        SUBTURN_NUMBER="$(jq -r '.current_turn.subturn.number // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
    elif [ -f "$CTX_FILE" ]; then
        TMP="$(mktemp)"
        jq --arg ts "${TIMESTAMP:-$NOW_ISO}" \
            --arg turn_id "$TURN_ID" \
            --arg subturn_id "$SUBTURN_ID" \
            --arg hash "$PROMPT_HASH" \
            --argjson is_resume "$_IS_SESSION_RESUME" \
            '.current_turn.started_at                = $ts
             | .current_turn.turn_id                  = $turn_id
             | .current_turn.tools_count               = 0
             | .current_turn.tools_by_name             = {}
             | .current_turn.failures_count            = 0
             | .current_turn.auth_requested            = false
             | .current_turn.auth_requested_at         = null
             | .current_turn.last_askquestions_response = null
             | .current_turn.number                    = ((.session_stats.turn_count // 0) + 1)
             | .current_turn.section_name              = .current_section.name
             | .current_turn.section_id               = .current_section.section_id
             | .current_turn.intent_declared           = false
             | .current_turn.intent                    = null
             | .current_turn.block_count               = 0
             | .current_turn.agentStop_invocations     = 0
             | .current_turn.todo_created              = false
             | .current_turn.last_non_bookkeeping_tool = null
             | .current_turn.last_askquestions_template = null
             | .current_turn.last_askquestions_close_action = null
             | .current_turn.last_askquestions_close_key_found = false
             | .current_turn.todo_last_item_label = null
             | .current_turn.todo_last_item_is_askquestions_continuation = false
             | .current_turn.todo_last_item_checked_at = null
             | .current_turn.todo_protocol_version = null
             | .current_turn.continuation_instruction_clear = null
             | .current_turn.continuation_mandatory = false
             | .current_turn.continuation_mandatory_at = null
             | .current_turn.continuation_mandatory_reason = null
             | .current_turn.auto_audit_required = false
             | .current_turn.auto_audit_required_at = null
             | .current_turn.auto_audit_reason = null
             | .current_turn.auto_audit_started = false
             | .current_turn.auto_audit_started_at = null
             | .current_turn.auto_audit_started_tool = null
             | .current_turn.required_docs_pending = []
             | .current_turn.required_docs_read_log = []
             | .current_turn.required_docs_obligation = null
             | .current_turn.required_docs_status = "not_required"
             | .current_turn.subturn = {
                 number: 1,
                 subturn_id: $subturn_id,
                 state: "active",
                 reason: "turn_start",
                 started_at: $ts,
                 last_transition_at: $ts,
                 parent_turn_id: $turn_id,
                 expected_window_minutes: 15,
                 stop_hook_active: false,
                 requires_user_action: false,
                 authorization_snapshot: {
                     auth_requested: false,
                     ask_template: null,
                     close_key_found: false,
                     close_key_validated: false
                 }
             }
             | .current_turn.subturn_history = []
             | .session_stats.resume_count             = ((.session_stats.resume_count // 0) + (if $is_resume then 1 else 0 end))
             | .session_stats.subturn_count            = ((.session_stats.subturn_count // 0) + 1)
             | .session_stats.subturn_blocked          = (.session_stats.subturn_blocked // 0)
             | .session_stats.subturn_resumed          = (.session_stats.subturn_resumed // 0)
             | .session_stats.subturn_via_subagent     = (.session_stats.subturn_via_subagent // 0)
             | .session_stats.subturn_via_askquestions = (.session_stats.subturn_via_askquestions // 0)
             | .hook_observability = ((.hook_observability // {}) + {
                 sessionStart_count: (.hook_observability.sessionStart_count // 0),
                 userPromptSubmitted_count: ((.hook_observability.userPromptSubmitted_count // 0) + 1),
                 last_sessionStart_at: (.hook_observability.last_sessionStart_at // null),
                 last_sessionStart_source: (.hook_observability.last_sessionStart_source // null),
                 last_userPromptSubmitted_at: $ts,
                 last_userPromptSubmitted_hash: (if $hash == "" then null else $hash end)
             })
             | .current_section.local_turn             = ((.current_section.local_turn // 0) + 1)
             | .current_turn.section_turn              = (.current_section.local_turn // 1)' \
            "$CTX_FILE" > "$TMP" && mv "$TMP" "$CTX_FILE"

        TURN_NUMBER="$(jq -r '.current_turn.number // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
        SECTION_TURN="$(jq -r '.current_turn.section_turn // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
        SECTION_NAME="$(jq -r '.current_section.name // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        SECTION_ID="$(jq -r '.current_section.section_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        SUBTURN_NUMBER="$(jq -r '.current_turn.subturn.number // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
    fi

    # No primeiro turno da sessão (inclui starts e retomadas inline), exige releitura
    # dos documentos-base para garantir contexto canônico atualizado.
    if [ -f "$CTX_FILE" ] && [ "${TURN_NUMBER:-0}" -eq 1 ] 2> /dev/null; then
        ctx_apply_expr \
            '.current_turn.required_docs_pending = ["session-briefing.md", "pending-tasks.md", "session-context.json"]
             | .current_turn.required_docs_obligation = "session_start_or_resume"
             | .current_turn.required_docs_status = "pending"
             | .current_turn.required_docs_read_log = []
             | .current_turn.required_docs_set_at = $ts' \
            --arg ts "${TIMESTAMP:-$NOW_ISO}"

        jq -cn \
            --arg event "requiredDocs_obligation_set" \
            --arg sid "$SESSION_ID" \
            --arg ts "${TIMESTAMP:-$NOW_ISO}" \
            --arg turn_id "$TURN_ID" \
            '{
                event: $event,
                session_id: $sid,
                timestamp: $ts,
                turn_id: (if $turn_id == "" then null else $turn_id end),
                required_docs: ["session-briefing.md", "pending-tasks.md", "session-context.json"],
                message: "Checklist de leitura obrigatória ativado para início/retomada"
            }' >> "$AUDIT_FILE" 2> /dev/null || true
    fi

    # Loga evento turnStart (automático — complementado por start-turn.sh para intenção)
    LOGICAL_NUM="$(jq -r '.session.logical_session_number // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
    jq -cn \
        --arg event "turnStart" \
        --arg sid "$SESSION_ID" \
        --arg ts "${TIMESTAMP:-$NOW_ISO}" \
        --arg turn_id "$TURN_ID" \
        --argjson turn_number "$TURN_NUMBER" \
        --argjson section_turn "${SECTION_TURN:-1}" \
        --arg section_name "$SECTION_NAME" \
        --arg section_id "$SECTION_ID" \
        --argjson logical_num "$LOGICAL_NUM" \
        '{
            event:                  $event,
            session_id:             $sid,
            timestamp:              $ts,
            turn_id:                $turn_id,
            turn_number:            $turn_number,
            section_turn:           $section_turn,
            section_name:           (if $section_name == "" then null else $section_name end),
            section_id:             (if $section_id == "" then null else $section_id end),
            logical_session_number: $logical_num
        }' >> "$AUDIT_FILE"

    if command -v emit_subturn_start_event > /dev/null 2>&1; then
        emit_subturn_start_event \
            "$AUDIT_FILE" \
            "$SESSION_ID" \
            "${TIMESTAMP:-$NOW_ISO}" \
            "$TURN_ID" \
            "$SUBTURN_ID" \
            "${SUBTURN_NUMBER:-1}" \
            "turn_start" \
            "active" \
            "userPromptSubmitted"
    fi

    # ── Hardening v6.0: systemMessage SESSION REMINDER em CADA TURN ──────────────
    # CRÍTICO: Este é o único ponto onde o agente recebe lembrete ANTES de gerar sua
    # resposta. Todos os outros lembretes (agent-stop.sh) são POST-HOC e chegam tarde.
    #
    # SESSION ≠ SECTION ≠ TURN:
    #   TURN    → encerra com autorização via vscode_askQuestions
    #   SECTION → agente decide mudança via start-section.sh (autônomo)
    #   SESSION → SOMENTE com vscode_askQuestions Template F + KEY (close automático)
    _SESSION_REMINDER_MSG=""
    if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ]; then
        _SR_CLOSE_KEY="$(jq -r '.session.close_key // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        _SR_CLOSE_VALIDATED="$(jq -r '.session.close_key_validated // false' "$CTX_FILE" 2> /dev/null || echo 'false')"
        _SR_SECTION="$(jq -r '.current_section.name // "(sem section)"' "$CTX_FILE" 2> /dev/null || echo '(sem section)')"
        _SR_CONSEC="$(jq -r '.compliance.consecutive_unauthorized // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
        _SR_TURNS_SINCE="$(jq -r '.session_stats.turns_since_askQuestions // 0' "$CTX_FILE" 2> /dev/null || echo 0)"

        # Determina severidade do lembrete
        _SR_SEVERITY="INFO"
        if { [ "$_SR_CONSEC" -ge 2 ] 2> /dev/null; }; then
            _SR_SEVERITY="CRITICO"
        elif { [ "$_SR_CONSEC" -ge 1 ] 2> /dev/null; } || { [ "$_SR_TURNS_SINCE" -ge 3 ] 2> /dev/null; }; then
            _SR_SEVERITY="ALERTA"
        fi

        # Emoji de severidade
        _SR_ICON="📍"
        [ "$_SR_SEVERITY" = "ALERTA" ] && _SR_ICON="⚠️"
        [ "$_SR_SEVERITY" = "CRITICO" ] && _SR_ICON="🚨"

        # Linha de violação (se houver)
        _SR_VIOLATION=""
        if { [ "$_SR_CONSEC" -ge 1 ] 2> /dev/null; }; then
            _SR_VIOLATION="
⛔ VIOLAÇÃO: ${_SR_CONSEC} TURN(s) SEM vscode_askQuestions | ${_SR_TURNS_SINCE} desde o último"
        fi

        # Linha de SESSION close (sempre visível)
        _SR_SESSION_LINE="🔐 SESSION ATIVA"
        if [ "$_SR_CLOSE_VALIDATED" = "true" ]; then
            _SR_SESSION_LINE="✅ SESSION: close_key validada"
        elif [ -n "$_SR_CLOSE_KEY" ]; then
            _SR_SESSION_LINE="🔐 SESSION: chave = ${_SR_CLOSE_KEY} (ainda NÃO encerrada)"
        fi

        _SESSION_REMINDER_MSG="${_SR_ICON} TURN INICIADO | SECTION: \"${_SR_SECTION}\" | ${_SR_SESSION_LINE}${_SR_VIOLATION}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    TURN    → encerra com vscode_askQuestions (obrigatório)
  SECTION → muda via: bash .github/hooks/scripts/start-section.sh \"nome\" (autônomo)
  SESSION → fecha SOMENTE com: vscode_askQuestions (Template F) + usuário digita KEY
                                                             + post-tool-use valida e executa session-close.sh
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Ao CONCLUIR esta resposta: chame vscode_askQuestions para comunicar o resultado."
    fi

    if [ -n "$_SESSION_REMINDER_MSG" ]; then
        printf '%s\n' "{\"systemMessage\":$(printf '%s' "$_SESSION_REMINDER_MSG" | jq -Rs .)}"
    fi

    return 0
}
