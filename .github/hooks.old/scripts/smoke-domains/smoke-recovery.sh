#!/bin/bash
# smoke-recovery.sh — checks de recuperação e reconciliação de sessão.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh" "${1:-}"

AGENT_STOP_LIB="$HOOK_DIR/hooks-lib/agent-stop-lib.sh"
WATCHDOG_SCRIPT="$SCRIPTS_DIR/watchdog.sh"

section "[recovery] Session ID guards"
for s in agent-stop.sh pre-tool-use.sh post-tool-use.sh log-prompt.sh subagent-start.sh subagent-stop.sh; do
    require_file "$SCRIPTS_DIR/$s" "$s"
    require_grep 'session_id_mismatch|reconcile_session_id_guard|sessionReconnect|handle_manual_recovery_session_id' "$SCRIPTS_DIR/$s" \
        "$s contém guard/reconciliação de session_id" \
        "$s sem guard/reconciliação de session_id"
done

section "[recovery] HEAL v2"
require_file "$AGENT_STOP_LIB" "agent-stop-lib.sh"
require_grep 'HEAL v2|mismatch_track|healed_from_consecutive_mismatch' "$AGENT_STOP_LIB" "HEAL v2 presente no agent-stop-lib" "HEAL v2 ausente no agent-stop-lib"

section "[recovery] Watchdog"
require_file "$WATCHDOG_SCRIPT" "watchdog.sh"
require_grep 'STALE_ENDED_AT|WATCHDOG_STALE_HOURS|auto_recovery' "$WATCHDOG_SCRIPT" "watchdog cobre sinais de recuperação/stale" "watchdog sem sinais de recuperação/stale"

summary_and_exit
