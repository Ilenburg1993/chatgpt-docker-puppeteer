#!/bin/bash
# smoke-close.sh — checks do domínio de fechamento (close/session-end).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh" "${1:-}"

SESSION_CLOSE="$SCRIPTS_DIR/session-close.sh"
SESSION_END="$SCRIPTS_DIR/session-end.sh"
POST_TOOL="$SCRIPTS_DIR/post-tool-use.sh"
AGENT_STOP_LIB="$HOOK_DIR/hooks-lib/agent-stop-lib.sh"

section "[close] Arquivos"
require_file "$SESSION_CLOSE" "session-close.sh"
require_file "$SESSION_END" "session-end.sh"
require_file "$POST_TOOL" "post-tool-use.sh"
require_file "$AGENT_STOP_LIB" "agent-stop-lib.sh"

section "[close] Contratos de validação"
require_grep 'close_key_validated' "$SESSION_CLOSE" "session-close valida/seta close_key_validated" "session-close sem close_key_validated"
require_grep 'sessionCloseAuthorized|sessionClose_REJECTED' "$SESSION_CLOSE" "session-close registra autorização/rejeição" "session-close sem eventos de autorização/rejeição"
require_grep '_ALREADY_VALIDATED|close_key_validated' "$POST_TOOL" "post-tool-use tem guard de idempotência" "post-tool-use sem guard de idempotência de fechamento"
require_grep 'enforce_level3_close_key_mandate|turn_close_key_missing_or_invalid' "$AGENT_STOP_LIB" "agent-stop-lib aplica hardening de close" "agent-stop-lib sem hardening de close"

summary_and_exit
