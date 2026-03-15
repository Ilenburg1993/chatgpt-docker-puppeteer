#!/bin/bash
# smoke-policy.sh — checks do domínio de policy/autorização.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh" "${1:-}"

POLICY_FILE="$HOOK_DIR/hooks-lib/policy.sh"
AGENT_STOP_LIB="$HOOK_DIR/hooks-lib/agent-stop-lib.sh"
PRE_TOOL="$SCRIPTS_DIR/pre-tool-use.sh"
POST_TOOL="$SCRIPTS_DIR/post-tool-use.sh"

section "[policy] Arquivos"
require_file "$POLICY_FILE" "policy.sh"
require_file "$AGENT_STOP_LIB" "agent-stop-lib.sh"
require_file "$PRE_TOOL" "pre-tool-use.sh"
require_file "$POST_TOOL" "post-tool-use.sh"

section "[policy] Integração"
require_grep 'source .*policy\.sh|source "\$_POLICY_LIB_PATH"|_POLICY_LIB_PATH=.*policy\.sh' "$AGENT_STOP_LIB" "agent-stop-lib carrega policy.sh" "agent-stop-lib não carrega policy.sh"
require_grep 'policy_' "$PRE_TOOL" "pre-tool-use usa helpers policy_*" "pre-tool-use sem uso de policy_*"
require_grep 'policy_' "$POST_TOOL" "post-tool-use usa helpers policy_*" "post-tool-use sem uso de policy_*"

section "[policy] Regras críticas"
require_grep 'askquestions_missing_template_f_option' "$AGENT_STOP_LIB" "reason code de Template F option presente" "reason code askquestions_missing_template_f_option ausente"
require_grep 'template_f_called_without_prior_request' "$AGENT_STOP_LIB" "reason code de Template F sem request presente" "reason code template_f_called_without_prior_request ausente"
require_grep 'todo_last_item_is_askquestions_continuation' "$AGENT_STOP_LIB" "checagem de último TODO presente" "checagem de último TODO ausente"
require_grep 'auto_audit_required_not_started' "$AGENT_STOP_LIB" "checagem de auto-auditoria presente" "checagem de auto-auditoria ausente"

summary_and_exit
