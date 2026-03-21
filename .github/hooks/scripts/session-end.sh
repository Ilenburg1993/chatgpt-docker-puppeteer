#!/usr/bin/env bash
# session-end.sh — Handler para o evento SessionEnd (GAP-60)
# GAP-ABRUPT-TURN-END: fecha turn/subturn ativos antes de registrar sessionEnd
# Thin wrapper: loga o evento de encerramento da sessão no audit.jsonl
set -euo pipefail

INPUT=$(cat)
HOOKS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LIB_DIR="$HOOKS_DIR/lib"

# shellcheck source=../lib/common.sh
source "$LIB_DIR/common.sh"
# shellcheck source=../lib/hook-payload-api.sh
source "$LIB_DIR/hook-payload-api.sh"

hook_api_parse "$INPUT" || true

export SESSION_ID="${HOOK_SESSION_ID:-unknown}"

# GAP-ABRUPT-TURN-END: se há um turn ativo (número > 0, ended_at = null),
# fecha o subturn e o turn antes de registrar sessionEnd.
# Isso garante que o audit trail seja completo mesmo em sessões interrompidas
# sem um evento Stop prévio.
if state_exists; then
    _turn_num=$(read_field ".current_turn.number" 2>/dev/null || printf '0')
    _turn_num="${_turn_num:-0}"
    _turn_ended=$(read_field ".current_turn.ended_at" 2>/dev/null || printf '')

    if [ "${_turn_num}" != "0" ] && [ "${_turn_num}" != "null" ] \
       && ([ -z "${_turn_ended}" ] || [ "${_turn_ended}" = "null" ]); then

        # 1) Fecha subturn ativo (se houver)
        _subturn_num=$(read_field ".current_subturn.number" 2>/dev/null || printf '0')
        _subturn_num="${_subturn_num:-0}"
        _subturn_ended=$(read_field ".current_subturn.ended_at" 2>/dev/null || printf '')
        if [ "${_subturn_num}" != "0" ] && [ "${_subturn_num}" != "null" ] \
           && ([ -z "${_subturn_ended}" ] || [ "${_subturn_ended}" = "null" ]); then
            _now=$(now_iso)
            update_nested_state "current_subturn.ended_at" "$_now"
            hook_log_audit "subturnEnd_abrupt" \
                "subturn" "${_subturn_num}" \
                "reason" "session_end_without_stop"
        fi

        # 2) Fecha o turn ativo
        _now=$(now_iso)
        update_nested_state "current_turn.ended_at" "$_now"
        hook_log_audit "turnEnd_abrupt" \
            "turn" "${_turn_num}" \
            "reason" "session_end_without_stop"
    fi
fi

hook_log_audit "sessionEnd_received" \
    "session_id" "${HOOK_SESSION_ID:-unknown}" \
    "event" "SessionEnd"

# Não emite output — SessionEnd é evento de notificação (read-only)
exit 0
