#!/bin/bash
# shellcheck shell=bash
# session-start-core.sh — núcleo crítico de lifecycle do session-start
#
# Contém apenas operações de estado mínimo obrigatório:
# - cálculo de logical_session_number
# - persistência do contexto inicial (inline_restart/new)
#
# Observação: funções usam variáveis globais já preparadas por session-start.sh.

session_start_compute_logical_session_number() {
    local state_dir="${1:-}"
    local source="${2:-new}"

    if [ -z "$state_dir" ]; then
        return 1
    fi

    local prev_logical_num=0
    if [ -f "$state_dir/session-context.json" ] && command -v jq > /dev/null 2>&1; then
        prev_logical_num="$(jq -r '.session.logical_session_number // 0' "$state_dir/session-context.json" 2> /dev/null || echo 0)"
        prev_logical_num="${prev_logical_num:-0}"
    fi

    if [ "$source" = "inline_restart" ]; then
        if [ "${prev_logical_num:-0}" -gt 0 ] 2> /dev/null; then
            LOGICAL_SESSION_NUMBER="$prev_logical_num"
        else
            LOGICAL_SESSION_NUMBER=1
        fi
    else
        LOGICAL_SESSION_NUMBER=$((prev_logical_num + 1))
    fi

    export LOGICAL_SESSION_NUMBER
    return 0
}

session_start_persist_initial_context() {
    if [ "$SOURCE" = "inline_restart" ] \
        && [ -f "$STATE_DIR/session-context.json" ] \
        && [ -s "$STATE_DIR/session-context.json" ]; then
        local _ctx_tmp
        _ctx_tmp="$(mktemp)"
        if jq \
            --arg sid "$SESSION_ID" \
            --arg date "$SESSION_DATE" \
            --arg date_short "$SESSION_DATE_SHORT" \
            --arg source "$SOURCE" \
            --arg cwd "$CWD" \
            --arg close_key "$CLOSE_KEY" \
            --arg ts "$TIMESTAMP" \
            '.session.id                    = $sid
             | .session.vs_code_session_id  = $sid
             | .session.started_at          = $date
             | .session.date_short          = $date_short
             | .session.ended_at            = null
             | .session.end_reason          = null
             | .session.close_key           = $close_key
            | .session.close_key_validated = false
            | .session.strict_turn_close_requires_key = true
             | .session.source              = $source
             | .session.cwd                 = $cwd
             | .last_tool.ts                = $ts
             | .session_stats.pending_section_after_push = false
             | .session_stats.push_count    = 0
             | .session_stats.last_push_at  = null
             | .session_stats.last_push_turn = null
             | .session_stats.session_id_mismatches = 0
             | .session_stats.session_id_syncs_inline = 0
             | .hook_observability = ((.hook_observability // {}) + {
                 sessionStart_count: ((.hook_observability.sessionStart_count // 0) + 1),
                 userPromptSubmitted_count: (.hook_observability.userPromptSubmitted_count // 0),
                 last_sessionStart_at: $ts,
                 last_sessionStart_source: $source,
                 last_userPromptSubmitted_at: (.hook_observability.last_userPromptSubmitted_at // null),
                 last_userPromptSubmitted_hash: (.hook_observability.last_userPromptSubmitted_hash // null)
             })' \
            "$STATE_DIR/session-context.json" > "$_ctx_tmp" 2> /dev/null; then
            local _per_ctx_real
            _per_ctx_real="${STATE_DIR}/session-context-${SID_SHORT}.json"
            mv "$_ctx_tmp" "$_per_ctx_real" 2> /dev/null \
                || {
                    cp "$_ctx_tmp" "$_per_ctx_real" 2> /dev/null
                    rm -f "$_ctx_tmp"
                }
            if [ -n "${SID_SHORT:-}" ]; then
                update_compat_symlinks "$SID_SHORT" 2> /dev/null || true
                set_current_session_id "$SESSION_ID" 2> /dev/null || true
            fi
        else
            rm -f "$_ctx_tmp"
            echo "[session-start] WARN: CTX corrompido em inline_restart — fallback para reset completo" >&2
            SOURCE="new"
        fi
    fi

    if [ "$SOURCE" != "inline_restart" ]; then
        jq -cn \
            --arg sid "$SESSION_ID" \
            --arg ts "$TIMESTAMP" \
            --arg date "$SESSION_DATE" \
            --arg date_short "$SESSION_DATE_SHORT" \
            --arg source "$SOURCE" \
            --arg cwd "$CWD" \
            --arg close_key "$CLOSE_KEY" \
            --arg initial_section_id "$INITIAL_SECTION_ID" \
            --arg initial_turn_id "$INITIAL_TURN_ID" \
            --argjson consec "$PREV_CONSEC_UNAUTH" \
            --argjson logical_num "$LOGICAL_SESSION_NUMBER" \
            --arg close_mode "${PREV_CLOSE_MODE:-ok}" \
            --arg prev_sid "${PREV_SESSION_ID:-}" \
            --arg prev_ts "${PREV_CHECKPOINT_TS:-}" \
            --argjson alerts "$_ALERTS_JSON" \
            --arg alerts_req "$RECOVERY_ALERTS_REQUIRE_KICKOFF" \
            '{
            "session": {
                "id":                    $sid,
                "vs_code_session_id":    $sid,
                "logical_session_number": $logical_num,
                "logical_restart_at":    $ts,
                "started_at":            $date,
                "date_short":            $date_short,
                "ended_at":              null,
                "end_reason":            null,
                "close_key":             $close_key,
                "close_key_validated":   false,
                "strict_turn_close_requires_key": true,
                "source":                $source,
                "cwd":                   $cwd
            },
            "session_stats": {
                "turn_count":         0,
                "turn_authorized":    0,
                "turn_unauthorized":  0,
                "resume_count":       0,
                "tools_total":        0,
                "tools_by_name":      {},
                "failures_detected":        0,
                "errors_total":             0,
                "subagent_calls":           0,
                "subagent_completions":     0,
                "askquestions_api_failures": 0,
                "section_count":      1,
                "section_names":      ["início"],
                "section_history":    [{"name": "início", "section_id": $initial_section_id, "section_number": 1, "started_at": $date}],
                "turn_history":       [],
                "push_count":         0,
                "last_push_at":       null,
                "last_push_turn":     null,
                "pending_section_after_push": false,
                "commit_history":     [],
                "session_id_mismatches": 0,
                "session_id_syncs_inline": 0,
                "recovery_hints": {
                    "last_intent":      null,
                    "last_section":     null,
                    "last_commit_sha":  null,
                    "last_commit_ts":   null
                }
            },
            "current_turn": {
                "number":                      1,
                "started_at":                  $date,
                "tools_count":                 0,
                "tools_by_name":               {},
                "failures_count":              0,
                "auth_requested":              false,
                "auth_requested_at":           null,
                "last_askquestions_response":  null,
                "section_name":                "início",
                "section_turn":                1,
                "intent_declared":             false,
                "intent":                      null,
                "todo_created":                false,
                "block_count":                 0,
                "agentStop_invocations":       0,
                "subagent_delegated":          false,
                "last_non_bookkeeping_tool":   null,
                "last_askquestions_template":  null,
                "last_askquestions_close_action": null,
                "last_askquestions_close_key_found": false,
                "required_docs_pending":       ["session-briefing.md", "pending-tasks.md", "session-context.json"],
                "required_docs_read_log":      [],
                "required_docs_obligation":    "session_start_or_resume",
                "required_docs_status":        "pending",
                "turn_id":                     $initial_turn_id
            },
            "current_section": {
                "name":           "início",
                "started_at":     $date,
                "turn_start":     1,
                "local_turn":     0,
                "description":    null,
                "section_number": 1,
                "section_id":     $initial_section_id,
                "push_count":     0,
                "tools_by_name":  {},
                "intent_history": [],
                "failures_count": 0,
                "blocked_turns":  0
            },
            "last_tool": {
                "name":   null,
                "ts":     $ts,
                "use_id": null,
                "result": null
            },
            "compliance": {
                "last_turn_authorized":     null,
                "consecutive_unauthorized": $consec,
                "flag_file_exists":         false
            },
            "recovery": {
                "close_mode":           $close_mode,
                "prev_session_id":      $prev_sid,
                "prev_session_ts":      $prev_ts,
                "alerts":               $alerts,
                "alerts_require_kickoff": ($alerts_req == "true"),
                "detected_at":          $ts
            },
            "hook_observability": {
                "sessionStart_count": 1,
                "userPromptSubmitted_count": 0,
                "last_sessionStart_at": $ts,
                "last_sessionStart_source": $source,
                "last_userPromptSubmitted_at": null,
                "last_userPromptSubmitted_hash": null
            },
            "quality_gates":   {},
            "session_summary": null,
            "last_turn_ts":    null
        }' > "$PER_CTX_FILE"

        update_compat_symlinks "$SID_SHORT" 2> /dev/null || true
        set_current_session_id "$SESSION_ID" 2> /dev/null || true
    fi

    return 0
}
