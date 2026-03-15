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
CONTRACT_REGISTRY="$HOOK_DIR/contracts/contract-registry.json"
STOP_DECISION_SCHEMA="$HOOK_DIR/contracts/stop-decision.schema.json"

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

section "[policy] F8.2 — Cobertura contratual"
require_file "$CONTRACT_REGISTRY" "contract-registry.json"
require_file "$STOP_DECISION_SCHEMA" "stop-decision.schema.json"

if jq empty "$CONTRACT_REGISTRY" 2> /dev/null; then
	pass "contract-registry.json é JSON válido"
else
	fail "contract-registry.json é JSON inválido"
fi

if jq empty "$STOP_DECISION_SCHEMA" 2> /dev/null; then
	pass "stop-decision.schema.json é JSON válido"
else
	fail "stop-decision.schema.json é JSON inválido"
fi

if jq -e '.contracts | any(.id == "stop-decision-output" and .path == "contracts/stop-decision.schema.json")' "$CONTRACT_REGISTRY" > /dev/null 2>&1; then
	pass "contract-registry referencia stop-decision-output"
else
	fail "contract-registry sem entrada stop-decision-output"
fi

if jq -e '.required | index("decision") and index("reason") and index("hookSpecificOutput")' "$STOP_DECISION_SCHEMA" > /dev/null 2>&1; then
	pass "schema exige decision/reason/hookSpecificOutput"
else
	fail "schema não exige todos os campos mínimos obrigatórios"
fi

for reason_code in \
	strict_context_missing \
	askquestions_not_last_tool \
	askquestions_api_error \
	askquestions_skipped_or_empty \
	auto_audit_required_not_started \
	required_docs_not_read \
	non_template_f_continuation_mandatory \
	askquestions_missing_template_f_option \
	template_f_called_without_prior_request \
	turn_close_requires_template_f \
	turn_close_key_missing_or_invalid \
	turn_auth_context_invalid; do
	require_grep "${reason_code}" "$AGENT_STOP_LIB" "reason code obrigatório presente: ${reason_code}" "reason code obrigatório ausente: ${reason_code}"
done

require_grep 'decision:[[:space:]]*"block"' "$AGENT_STOP_LIB" "payload stop inclui decision=block" "payload stop sem decision=block"
require_grep 'decisionReason:[[:space:]]*\$reason' "$AGENT_STOP_LIB" "payload stop inclui decisionReason legado" "payload stop sem decisionReason legado"
require_grep 'reason:[[:space:]]*\$reason' "$AGENT_STOP_LIB" "payload stop inclui reason canônico" "payload stop sem reason canônico"
require_grep 'hookSpecificOutput:[[:space:]]*\{' "$AGENT_STOP_LIB" "payload stop inclui hookSpecificOutput" "payload stop sem hookSpecificOutput"
require_grep 'hookEventName:[[:space:]]*"Stop"' "$AGENT_STOP_LIB" "payload stop inclui hookEventName=Stop" "payload stop sem hookEventName=Stop"
require_grep 'systemMessage:[[:space:]]*\$system_message' "$AGENT_STOP_LIB" "payload stop inclui systemMessage" "payload stop sem systemMessage"

summary_and_exit
