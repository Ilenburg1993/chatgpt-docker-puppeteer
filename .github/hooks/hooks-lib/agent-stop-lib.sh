#!/bin/bash
# hooks-lib/agent-stop-lib.sh — Helpers estruturais do agent-stop.sh
#
# Objetivo: concentrar utilitários de bloqueio/validação do Stop hook em um
# módulo reutilizável e mais testável.

_AGENT_STOP_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_POLICY_LIB_PATH="${HOOK_DIR:-$(cd "${_AGENT_STOP_LIB_DIR}/.." && pwd)}/hooks-lib/policy.sh"
# shellcheck disable=SC1090
if [ -f "$_POLICY_LIB_PATH" ]; then
    source "$_POLICY_LIB_PATH" 2> /dev/null || true
fi

# Emite payload de bloqueio canônico para Stop.
# Mantém campos legados top-level (decision/decisionReason) por compatibilidade.
emit_stop_block() {
    local reason="$1"
    local system_message="$2"
    local reason_code="${3:-unknown_block_reason}"
    local decision_trace_json="${4:-}"
    local concise_reason="$reason"
    local concise_system_message="⛔ FECHAMENTO DO TURN BLOQUEADO (agente continua): ${system_message}"

    # Compatibilidade operacional: payload mínimo do hook Stop.
    # Em algumas execuções, payloads extensos do block podem ser ignorados pelo runtime.
    # Mantemos apenas o núcleo documentado + limites de tamanho para reduzir truncation.
    # Contrato operacional: reason <= 280 chars e systemMessage <= 900 chars.
    [ ${#concise_reason} -gt 280 ] && concise_reason="${concise_reason:0:277}..."
    [ ${#concise_system_message} -gt 900 ] && concise_system_message="${concise_system_message:0:897}..."
    [ -n "$reason_code" ] && concise_reason="[$reason_code] $concise_reason"
    [ -n "$decision_trace_json" ] && :

    jq -cn \
        --arg reason "$concise_reason" \
        --arg system_message "$concise_system_message" \
        '{
            decision: "block",
            decisionReason: $reason,
            reason: $reason,
            hookSpecificOutput: {
                hookEventName: "Stop",
                decision: "block",
                reason: $reason
            },
            systemMessage: $system_message
        }'
}

# Constrói decision trace canônico para blocks do Stop.
build_decision_trace_json() {
    local rule_id="$1"
    local auth_strategy="$2"
    local invalid_reason="$3"
    local strict_mode="$4"
    local stop_hook_active="$5"
    local block_count="$6"

    jq -cn \
        --arg rule_id "$rule_id" \
        --arg auth_strategy "$auth_strategy" \
        --arg invalid_reason "$invalid_reason" \
        --arg strict_mode "$strict_mode" \
        --arg stop_hook_active "$stop_hook_active" \
        --argjson block_count "$(sanitize_nonnegative_int "$block_count")" \
        '{
            rule_id: $rule_id,
            auth_strategy: $auth_strategy,
            invalid_reason: (if $invalid_reason == "" then null else $invalid_reason end),
            strict_mode: ($strict_mode == "true"),
            stop_hook_active: ($stop_hook_active == "true"),
            block_count: $block_count
        }'
}

# Escreve flag de bloqueio em schema JSON canônico.
write_turn_block_flag_json() {
    local flag_file="$1"
    local ts="$2"
    local sid="$3"
    local turn="$4"
    local consec="$5"
    local reason="$6"
    local message="$7"

    jq -cn \
        --arg ts "$ts" \
        --arg sid "$sid" \
        --argjson turn "${turn:-0}" \
        --argjson consec "${consec:-0}" \
        --arg reason "$reason" \
        --arg message "$message" \
        '{
            timestamp:                $ts,
            session_id:               $sid,
            turn_count:               $turn,
            consecutive_unauthorized: $consec,
            reason:                   $reason,
            message:                  $message
        }' > "$flag_file" 2> /dev/null || true
}

# Retorna a última tool não-bookkeeping após o último userPromptSubmitted.
last_non_bookkeeping_tool_since_prompt() {
    local audit_file="$1"
    [ -f "$audit_file" ] || {
        echo ""
        return 0
    }

    local last_prompt_line total_lines lines_since_prompt
    last_prompt_line="$(awk '/"userPromptSubmitted"/{last=NR} END{print last+0}' "$audit_file" 2> /dev/null || echo 0)"
    total_lines="$(wc -l < "$audit_file" 2> /dev/null || echo 0)"

    if [ "$last_prompt_line" -le 0 ] || [ "$total_lines" -le "$last_prompt_line" ]; then
        echo ""
        return 0
    fi

    lines_since_prompt=$((total_lines - last_prompt_line))
    if [ "$lines_since_prompt" -le 0 ]; then
        echo ""
        return 0
    fi

    tail -n "$lines_since_prompt" "$audit_file" \
        | jq -r 'select(.event == "postToolUse" and (.tool_name // "") != "manage_todo_list") | .tool_name // empty' 2> /dev/null \
        | tail -1
}

# Verifica se a resposta de vscode_askQuestions contém resposta válida do usuário.
askquestions_has_user_answer() {
    local response_json="$1"
    if command -v policy_askquestions_has_user_answer > /dev/null 2>&1; then
        policy_askquestions_has_user_answer "$response_json"
        return $?
    fi
    [ -n "$response_json" ] || return 1
    printf '%s\n' "$response_json" | jq -e '
        ((.answers? // {}) | to_entries | map(.value))
        | if length == 0 then false else
            any(
                if type == "object" then
                    ((.skipped // false) == false)
                    and (((.freeText // "") != "") or ((.selected // []) | length > 0) or (has("selected") | not))
                elif type == "string" then
                    (. != "")
                else
                    false
                end
            )
          end
    ' > /dev/null 2>&1
}

# Sanitiza inteiro não-negativo; fallback para 0 quando inválido.
sanitize_nonnegative_int() {
    local value="${1:-0}"
    if [[ "$value" =~ ^[0-9]+$ ]]; then
        echo "$value"
    else
        echo 0
    fi
}

# Lê campo via jq com fallback para valor padrão (sem falhar o script).
safe_jq_read() {
    local file_path="$1"
    local jq_query="$2"
    local default_value="$3"

    if [ ! -f "$file_path" ]; then
        printf '%s\n' "$default_value"
        return 0
    fi

    local value
    value="$(jq -r "$jq_query // \"\"" "$file_path" 2> /dev/null || echo '')"
    if [ -z "$value" ]; then
        printf '%s\n' "$default_value"
    else
        printf '%s\n' "$value"
    fi
}

# Lê campo numérico via jq + sanitização não-negativa.
safe_jq_read_int() {
    local file_path="$1"
    local jq_query="$2"
    local default_value="$3"
    local raw
    raw="$(safe_jq_read "$file_path" "$jq_query" "$default_value")"
    sanitize_nonnegative_int "$raw"
}

# Carrega metadados canônicos de TURN/SubTurn para o fluxo de agent-stop.
# Retorna os campos em stdout (TSV), na ordem:
# TURN_NUMBER, SECTION_TURN, SECTION_NAME, SECTION_ID, TURN_INTENT,
# TURN_INTENT_DECLARED, TURN_ID, TURN_TOOLS_COUNT, TURN_FAILURES_COUNT,
# TURN_BLOCK_COUNT, SUBTURN_ID, SUBTURN_NUMBER, SUBTURN_STATE,
# SUBTURN_REASON, SUBTURN_STARTED_AT, SUBTURN_PARENT_TURN_ID.
populate_agent_stop_metadata_from_ctx() {
    local ctx_file="$1"

    local turn_number=1
    local section_turn=1
    local section_name=""
    local section_id=""
    local turn_intent=""
    local turn_intent_declared=false
    local turn_id=""
    local turn_tools_count=0
    local turn_failures_count=0
    local turn_block_count=0
    local subturn_id=""
    local subturn_number=1
    local subturn_state="active"
    local subturn_reason="turn_runtime"
    local subturn_started_at=""
    local subturn_parent_turn_id=""

    if [ -f "$ctx_file" ]; then
        turn_number="$(safe_jq_read_int "$ctx_file" '.current_turn.number' 1)"
        section_turn="$(safe_jq_read_int "$ctx_file" '.current_turn.section_turn' 1)"
        section_name="$(safe_jq_read "$ctx_file" '.current_section.name' '')"
        section_id="$(safe_jq_read "$ctx_file" '.current_section.section_id' '')"
        turn_intent="$(safe_jq_read "$ctx_file" '.current_turn.intent' '')"
        turn_intent_declared="$(safe_jq_read "$ctx_file" '.current_turn.intent_declared' 'false')"
        turn_id="$(safe_jq_read "$ctx_file" '.current_turn.turn_id' '')"
        turn_tools_count="$(safe_jq_read_int "$ctx_file" '.current_turn.tools_count' 0)"
        turn_failures_count="$(safe_jq_read_int "$ctx_file" '.current_turn.failures_count' 0)"
        turn_block_count="$(safe_jq_read_int "$ctx_file" '.current_turn.block_count' 0)"
        subturn_id="$(safe_jq_read "$ctx_file" '.current_turn.subturn.subturn_id' '')"
        subturn_number="$(safe_jq_read_int "$ctx_file" '.current_turn.subturn.number' 1)"
        subturn_state="$(safe_jq_read "$ctx_file" '.current_turn.subturn.state' 'active')"
        subturn_reason="$(safe_jq_read "$ctx_file" '.current_turn.subturn.reason' 'turn_runtime')"
        subturn_started_at="$(safe_jq_read "$ctx_file" '.current_turn.subturn.started_at' '')"
        subturn_parent_turn_id="$(safe_jq_read "$ctx_file" '.current_turn.subturn.parent_turn_id' '')"
    fi

    printf '%s\037%s\037%s\037%s\037%s\037%s\037%s\037%s\037%s\037%s\037%s\037%s\037%s\037%s\037%s\037%s\n' \
        "$turn_number" \
        "$section_turn" \
        "$section_name" \
        "$section_id" \
        "$turn_intent" \
        "$turn_intent_declared" \
        "$turn_id" \
        "$turn_tools_count" \
        "$turn_failures_count" \
        "$turn_block_count" \
        "$subturn_id" \
        "$subturn_number" \
        "$subturn_state" \
        "$subturn_reason" \
        "$subturn_started_at" \
        "$subturn_parent_turn_id"
}

# Normaliza vínculo do SubTurn ao TURN ativo e calcula duração do SubTurn.
# Retorna em stdout (TSV): subturn_id, subturn_number, subturn_parent_turn_id, subturn_duration_ms.
normalize_agent_stop_subturn_state() {
    local ctx_file="$1"
    local audit_file="$2"
    local session_id="$3"
    local now_iso="$4"
    local agentstop_invocations="$5"
    local turn_id="$6"
    local subturn_id_in="$7"
    local subturn_number_in="$8"
    local subturn_state_in="$9"
    local subturn_reason_in="${10}"
    local subturn_started_at_in="${11}"
    local subturn_parent_turn_id_in="${12}"

    local subturn_id="$subturn_id_in"
    local subturn_number="$subturn_number_in"
    local subturn_state="$subturn_state_in"
    local subturn_reason="$subturn_reason_in"
    local subturn_started_at="$subturn_started_at_in"
    local subturn_parent_turn_id="$subturn_parent_turn_id_in"
    local subturn_duration_ms="null"

    if [ -z "$subturn_id" ]; then
        subturn_id="${turn_id:-turn_unknown}_st${agentstop_invocations:-1}"
    fi

    if [ -z "$subturn_number" ] || [ "${subturn_number:-0}" -le 0 ] 2> /dev/null; then
        subturn_number="${agentstop_invocations:-1}"
    fi

    if [ -n "$turn_id" ] && { [ -z "$subturn_parent_turn_id" ] || [ "$subturn_parent_turn_id" != "$turn_id" ]; }; then
        subturn_parent_turn_id="$turn_id"
        if [ -f "$ctx_file" ]; then
            if command -v bind_current_subturn_parent_turn_id > /dev/null 2>&1; then
                bind_current_subturn_parent_turn_id "$now_iso" > /dev/null 2>&1 || true
            else
                local tmp_subturn_bind
                tmp_subturn_bind="$(mktemp 2> /dev/null || true)"
                if [ -n "$tmp_subturn_bind" ] \
                    && jq --arg turn_id "$turn_id" --arg ts "$now_iso" \
                        '.current_turn.subturn = ((.current_turn.subturn // {}) + {
                            parent_turn_id: $turn_id,
                            last_transition_at: $ts
                         })' \
                        "$ctx_file" > "$tmp_subturn_bind" 2> /dev/null; then
                    mv "$tmp_subturn_bind" "$ctx_file" 2> /dev/null || rm -f "$tmp_subturn_bind"
                else
                    [ -n "$tmp_subturn_bind" ] && rm -f "$tmp_subturn_bind"
                fi
            fi
        fi

        if command -v emit_subturn_transition_event > /dev/null 2>&1; then
            emit_subturn_transition_event \
                "$audit_file" \
                "$session_id" \
                "$now_iso" \
                "$turn_id" \
                "$subturn_id" \
                "${subturn_number:-1}" \
                "${subturn_state:-active}" \
                "${subturn_state:-active}" \
                "subturn_rebound_to_current_turn" \
                "agentStop"
        fi
    fi

    if [ -n "$subturn_started_at" ] && [ -n "$now_iso" ]; then
        local subturn_start_epoch subturn_now_epoch
        subturn_start_epoch="$(iso_to_epoch_utc "$subturn_started_at")"
        subturn_now_epoch="$(iso_to_epoch_utc "$now_iso")"
        if [ "$subturn_now_epoch" -ge "$subturn_start_epoch" ] 2> /dev/null; then
            subturn_duration_ms="$(((subturn_now_epoch - subturn_start_epoch) * 1000))"
        fi
    fi

    printf '%s\037%s\037%s\037%s\n' \
        "$subturn_id" \
        "$subturn_number" \
        "$subturn_parent_turn_id" \
        "$subturn_duration_ms"
}

# Converte ISO UTC para epoch seconds (GNU/BSD fallback). Retorna 0 se inválido.
iso_to_epoch_utc() {
    local iso_ts="$1"
    if [ -z "$iso_ts" ]; then
        printf '0\n'
        return 0
    fi

    if date -d "$iso_ts" '+%s' > /dev/null 2>&1; then
        date -d "$iso_ts" '+%s' 2> /dev/null || printf '0\n'
    else
        date -j -f '%Y-%m-%dT%H:%M:%SZ' "$iso_ts" '+%s' 2> /dev/null || printf '0\n'
    fi
}

# Calcula duração de turno em segundos a partir de dois timestamps ISO UTC.
compute_turn_duration_seconds() {
    local started_at="$1"
    local now_iso="$2"
    local start_epoch now_epoch

    start_epoch="$(iso_to_epoch_utc "$started_at")"
    now_epoch="$(iso_to_epoch_utc "$now_iso")"

    if [ "$now_epoch" -gt "$start_epoch" ] 2> /dev/null; then
        printf '%s\n' "$((now_epoch - start_epoch))"
    else
        printf '0\n'
    fi
}

# Calcula consecutive_unauthorized para escrita de flag no fim do turno.
compute_consecutive_for_unauthorized_flag() {
    local stop_hook_active="$1"
    local consecutive_now="$2"
    local consecutive_sanitized
    consecutive_sanitized="$(sanitize_nonnegative_int "$consecutive_now")"

    if [ "$stop_hook_active" = "true" ]; then
        printf '%s\n' "$consecutive_sanitized"
    else
        printf '%s\n' "$((consecutive_sanitized + 1))"
    fi
}

# Extrai top ferramentas do turno para auto-intent (fallback textual).
build_auto_intent_from_turn_tools() {
    local ctx_file="$1"
    if [ ! -f "$ctx_file" ]; then
        printf '%s\n' ""
        return 0
    fi
    jq -r '.current_turn.tools_by_name | to_entries | sort_by(-.value) | .[0:3] | map(.key) | join(", ")' \
        "$ctx_file" 2> /dev/null || printf '%s\n' ""
}

# Incrementa current_turn.agentStop_invocations no contexto e retorna o valor atualizado.
# Retorna 1 quando arquivo/contexto indisponível.
increment_agentstop_invocations_in_context() {
    local ctx_file="$1"
    local count=1

    if [ ! -f "$ctx_file" ]; then
        printf '1\n'
        return 0
    fi

    if command -v sponge > /dev/null 2>&1; then
        jq '.current_turn.agentStop_invocations = ((.current_turn.agentStop_invocations // 0) + 1)' \
            "$ctx_file" | sponge "$ctx_file" 2> /dev/null || true
        count="$(jq -r '.current_turn.agentStop_invocations // 1' "$ctx_file" 2> /dev/null || echo 1)"
    else
        local tmp_inv
        if tmp_inv="$(mktemp 2> /dev/null)"; then
            if jq '.current_turn.agentStop_invocations = ((.current_turn.agentStop_invocations // 0) + 1)' \
                "$ctx_file" > "$tmp_inv" 2> /dev/null; then
                mv "$tmp_inv" "$ctx_file" 2> /dev/null || rm -f "$tmp_inv"
            else
                rm -f "$tmp_inv"
            fi
        fi
        count="$(jq -r '.current_turn.agentStop_invocations // 1' "$ctx_file" 2> /dev/null || echo 1)"
    fi

    if ! [[ "$count" =~ ^[0-9]+$ ]]; then
        count=1
    fi
    printf '%s\n' "$count"
}

# Extrai resumo de backlog de pending-tasks.md no formato: alta|media|backlog|next_task
extract_pending_tasks_summary() {
    local tasks_file="$1"
    local alta=0
    local media=0
    local backlog=0
    local next_task="(sem tarefas)"

    if [ -f "$tasks_file" ]; then
        alta="$(grep -c '^- \[ \].*\[alta\]' "$tasks_file" 2> /dev/null || echo 0)"
        media="$(grep -c '^- \[ \].*\[media\]' "$tasks_file" 2> /dev/null || echo 0)"
        backlog="$(grep -c '^- \[ \].*\[backlog\]' "$tasks_file" 2> /dev/null || echo 0)"
        next_task="$(grep '^- \[ \].*\[alta\]' "$tasks_file" 2> /dev/null | head -1 | sed 's/^- \[ \] //' || echo '(sem tarefas alta)')"
    fi

    printf '%s|%s|%s|%s\n' "$alta" "$media" "$backlog" "$next_task"
}

# Mensagem de push pendente no nudge contextual.
build_push_pending_message() {
    local push_pending="$1"
    local push_count="$2"
    if [ "$push_pending" = "true" ]; then
        printf '%s' "
🔀 GIT PUSH DETECTADO (push #${push_count}):
  → Declarar nova fase:  bash .github/hooks/scripts/start-section.sh \"nome-da-fase\"
  → Continuar na seção:  npm run hooks:continue-section"
    else
        printf '%s' ""
    fi
}

# Mensagem de violação de protocolo no nudge contextual.
build_violation_message() {
    local auth_requested="$1"
    local consecutive_unauth="$2"
    local turns_since_ask="$3"

    if [ "$auth_requested" = "false" ]; then
        if { [ "$consecutive_unauth" -ge 3 ] 2> /dev/null; }; then
            printf '%s' "
🚨 CRÍTICO: ${consecutive_unauth} TURNs CONSECUTIVOS sem vscode_askQuestions!
  ⛔ SESSION em risco de encerramento não-autorizado.
  → Chame vscode_askQuestions AGORA (Template A, D, ou C conforme o contexto)"
            return 0
        fi
        if { [ "$consecutive_unauth" -ge 2 ] 2> /dev/null; }; then
            printf '%s' "
⛔ ALERTA: ${consecutive_unauth} TURNs CONSECUTIVOS sem vscode_askQuestions!
  Esta violação será registrada no briefing da próxima sessão.
  → Template A (tarefa concluída) | Template D (checkpoint) | Template C (proposta)"
            return 0
        fi
        if { [ "$consecutive_unauth" -ge 1 ] 2> /dev/null; } || { [ "$turns_since_ask" -ge 3 ] 2> /dev/null; }; then
            printf '%s' "
⚠ Turno encerrado sem vscode_askQuestions (${turns_since_ask} desde o último).
  → Template A se concluiu tarefa | Template D para checkpoint periódico"
            return 0
        fi
    fi

    printf '%s' ""
}

# Mensagem de close key para SESSION ativa no nudge contextual.
build_session_close_nudge_message() {
    local close_validated="$1"
    local close_key="$2"
    if [ "$close_validated" = "false" ] && [ -n "$close_key" ]; then
        printf '%s' "
🔐 SESSION close key: ${close_key}
    Para encerrar SESSION: vscode_askQuestions (Template F) → usuário digita KEY → post-tool-use valida e executa session-close.sh"
    else
        printf '%s' ""
    fi
}

# Informa se a delegação de subagente é imediata no último tool do turno.
is_immediate_subagent_delegation() {
    local delegated="${1:-false}"
    local last_tool_name="${2:-}"
    if command -v policy_is_immediate_subagent_delegation > /dev/null 2>&1; then
        policy_is_immediate_subagent_delegation "$delegated" "$last_tool_name"
        return $?
    fi
    if [ "$delegated" = "true" ] \
        && { [ "$last_tool_name" = "runSubagent" ] || [ "$last_tool_name" = "search_subagent" ]; }; then
        return 0
    fi
    return 1
}

# Exceção de bookkeeping permitida no fechamento v9.1:
# vscode_askQuestions -> manage_todo_list
is_bookkeeping_after_askquestions() {
    local last_tool_name="${1:-}"
    local last_non_bookkeeping_tool="${2:-}"
    if command -v policy_is_bookkeeping_after_askquestions > /dev/null 2>&1; then
        policy_is_bookkeeping_after_askquestions "$last_tool_name" "$last_non_bookkeeping_tool"
        return $?
    fi
    [ "$last_tool_name" = "manage_todo_list" ] && [ "$last_non_bookkeeping_tool" = "vscode_askQuestions" ]
}

# Constrói sufixo opcional com instruções de encerramento de SESSION (Template F).
build_session_close_hint() {
    local close_validated="${1:-false}"
    local close_key="${2:-N/A}"
    if [ "$close_validated" != "true" ] && [ "$close_key" != "N/A" ]; then
        printf '%s' " Para encerrar esta SESSION ao terminar: (1) chame vscode_askQuestions com Template F exibindo a close_key [${close_key}], (2) aguarde o usuário digitar a chave, (3) post-tool-use.sh validará a KEY e executará session-close.sh automaticamente."
    else
        printf '%s' ""
    fi
}

# Retorna reason|systemMessage para block do TURN (v9.0/v9.1).
build_turn_block_payload() {
    local todo_created="${1:-false}"
    local auth_invalid_reason="${2:-}"
    local session_hint="${3:-}"
    local strict_turn_close_requires_key="${4:-true}"

    if command -v policy_normalize_auth_invalid_reason > /dev/null 2>&1; then
        auth_invalid_reason="$(policy_normalize_auth_invalid_reason "$auth_invalid_reason")"
    fi

    local reason=""
    local system_message=""
    local reason_code=""
    local required_turn_close_action="vscode_askQuestions de continuidade (Template A/D/E)"

    if [ "$auth_invalid_reason" = "strict_context_missing" ]; then
        reason_code="strict_context_missing"
        reason="Política estrita de sessão/turno: sem session-context válido não existe autorização legítima para encerrar TURN. Fechamento exige chamada válida de vscode_askQuestions.${session_hint}"
        system_message="🚫 TURN BLOQUEADO: contexto ausente/inválido para validar autorização do TURN."
    elif [ "$todo_created" != "true" ]; then
        reason_code="double_protocol_violation"
        reason="🚨 DUPLA VIOLAÇÃO DO PROTOCOLO v9.0: (1) manage_todo_list NÃO foi chamado neste turno — toda resposta DEVE começar com manage_todo_list criando/atualizando a lista de tarefas. (2) vscode_askQuestions NÃO foi chamado — todo turno DEVE terminar com vscode_askQuestions. AÇÕES OBRIGATÓRIAS NESTA ORDEM: chame PRIMEIRO manage_todo_list (criar TODOs com último item = 'Chamar vscode_askQuestions'), depois execute as tarefas, e ao FINAL chame vscode_askQuestions (${required_turn_close_action}).${session_hint}"
        system_message="🚨 DUPLA VIOLAÇÃO (v9.0): (1) manage_todo_list NÃO chamado. (2) vscode_askQuestions NÃO chamado. Protocolo obrigatório: COMECE com manage_todo_list → execute tarefas → TERMINE com vscode_askQuestions (${required_turn_close_action})."
    elif [ "$auth_invalid_reason" = "todo_last_item_not_continuation" ]; then
        reason_code="todo_last_item_not_continuation"
        reason="Protocolo de SubTurn/TODO: o último item do checklist deve ser uma chamada de vscode_askQuestions de continuação do TURN (Template A/D/E). Ajuste o manage_todo_list para fechar com esse item e execute novamente o fluxo final.${session_hint}"
        system_message="🚫 TURN BLOQUEADO: último TODO não é askQuestions de continuação. Refaça o checklist e finalize com vscode_askQuestions."
    elif [ "$auth_invalid_reason" = "askquestions_todo_refresh_pending" ]; then
        reason_code="askquestions_todo_refresh_pending"
        reason="Protocolo TODO hardening: após chamar vscode_askQuestions, o refresh imediato via manage_todo_list é obrigatório. Este TURN não pode encerrar enquanto o checklist não for atualizado. Depois do refresh, se houver nova ferramenta de trabalho, um novo vscode_askQuestions final será obrigatório.${session_hint}"
        system_message="🚫 TURN BLOQUEADO: pendência de refresh de TODO após askQuestions. Execute manage_todo_list agora."
    elif [ "$auth_invalid_reason" = "askquestions_not_last_tool" ]; then
        reason_code="askquestions_not_last_tool"
        reason="Protocolo v9.1: vscode_askQuestions até foi chamado, porém não ficou como último passo válido do TURN. Regra: último passo deve ser vscode_askQuestions; exceção única permitida é manage_todo_list imediatamente após askQuestions para fechamento de checklist.${session_hint}"
        system_message="🚫 TURN BLOQUEADO (v9.1): sequência final inválida. Refaça vscode_askQuestions como último passo válido (${required_turn_close_action})."
    elif [ "$auth_invalid_reason" = "askquestions_api_error" ]; then
        reason_code="askquestions_api_error"
        reason="Protocolo v9.1: a chamada de vscode_askQuestions falhou na API (sem choices), então o turno não está autorizado. Repita vscode_askQuestions e finalize somente após resposta válida do usuário.${session_hint}"
        system_message="🚫 TURN BLOQUEADO (v9.1): falha de API em vscode_askQuestions. Refaça a chamada e finalize com resposta válida."
    elif [ "$auth_invalid_reason" = "askquestions_skipped_or_empty" ]; then
        reason_code="askquestions_skipped_or_empty"
        reason="Protocolo v9.1: vscode_askQuestions foi chamado, mas não houve resposta válida do usuário (skip/vazio). O TURN só pode encerrar com autorização explícita do usuário.${session_hint}"
        system_message="🚫 TURN BLOQUEADO (v9.1): resposta de autorização ausente/inválida. Refaça vscode_askQuestions e aguarde resposta válida."
    elif [ "$auth_invalid_reason" = "auto_audit_required_not_started" ]; then
        reason_code="auto_audit_required_not_started"
        reason="Fluxo de continuidade com resposta ambígua exige auto-auditoria obrigatória antes de seguir para edição/novo fechamento. Inicie auditoria com leitura/busca/diagnóstico e só depois continue o TURN.${session_hint}"
        system_message="🚫 TURN BLOQUEADO: auto-auditoria obrigatória ainda não iniciada após continuidade ambígua."
    elif [ "$auth_invalid_reason" = "required_docs_not_read" ]; then
        reason_code="required_docs_not_read"
        reason="Protocolo de início/retomada: ainda faltam leituras obrigatórias desta sessão (session-briefing.md, pending-tasks.md e session-context.json). Leia os documentos pendentes com read_file e finalize novamente com vscode_askQuestions.${session_hint}"
        system_message="🚫 TURN BLOQUEADO: documentos obrigatórios de início/retomada não foram lidos."
    elif [ "$auth_invalid_reason" = "non_template_f_continuation_mandatory" ]; then
        reason_code="non_template_f_continuation_mandatory"
        reason="Resposta ao vscode_askQuestions em modo de continuidade (Template A/D/E) NÃO autoriza encerramento. Política de hardening: após askQuestions não-Template F, o TURN/SSESSION deve obrigatoriamente continuar e é proibido tentar encerramento nesta etapa. Continue a execução de trabalho; use Template F apenas quando houver solicitação explícita do usuário para fechamento de SESSION.${session_hint}"
        system_message="🚫 CONTINUAÇÃO OBRIGATÓRIA: askQuestions não-Template F não permite encerrar TURN/SESSION. Continue o trabalho."
    elif [ "$auth_invalid_reason" = "askquestions_missing_template_f_option" ]; then
        reason_code="askquestions_missing_template_f_option"
        reason="Upgrade de governança do askQuestions: toda chamada deve oferecer opção explícita para solicitar escalonamento ao Template F no próximo passo. Sem essa opção, o TURN não pode encerrar.${session_hint}"
        system_message="🚫 TURN BLOQUEADO: askQuestions sem opção de escalonar para Template F. Refaça a pergunta incluindo essa opção."
    elif [ "$auth_invalid_reason" = "template_f_called_without_prior_request" ]; then
        reason_code="template_f_called_without_prior_request"
        reason="Upgrade de governança do Template F: o Template F só pode ser chamado quando uma resposta de askQuestions anterior tiver solicitado esse escalonamento. Faça um askQuestions intermediário, obtenha solicitação explícita do usuário e só então chame Template F.${session_hint}"
        system_message="🚫 TURN BLOQUEADO: Template F chamado sem solicitação prévia registrada no askQuestions anterior."
    elif [ "$auth_invalid_reason" = "turn_close_requires_template_f" ]; then
        reason_code="turn_close_requires_template_f"
        reason="Hardening estrito de TURN: fechamento requer vscode_askQuestions válido no último ato do turno. Template F permanece reservado para fechamento de SESSION.${session_hint}"
        system_message="🚫 TURN BLOQUEADO (strict): use vscode_askQuestions válido para encerrar o turno."
    elif [ "$auth_invalid_reason" = "turn_close_key_missing_or_invalid" ]; then
        reason_code="turn_close_key_missing_or_invalid"
        reason="Fluxo de SESSION Close inválido: close_key ausente/inválida quando houve tentativa de fechamento de sessão com Template F.${session_hint}"
        system_message="🚫 TURN BLOQUEADO (strict): KEY ausente/inválida no fluxo de SESSION Close."
    elif [ "$auth_invalid_reason" = "subagent_chain_invalid" ]; then
        reason_code="subagent_chain_invalid"
        reason="Delegação de subagente detectada sem cadeia auditável íntegra (subagentStart/parent_turn). Sem proveniência válida, a delegação não autoriza fechamento.${session_hint}"
        system_message="🚫 TURN BLOQUEADO: delegação de subagente sem trilha auditável válida."
    elif [ "$auth_invalid_reason" = "session_close_key_missing_or_invalid" ]; then
        reason_code="session_close_key_missing_or_invalid"
        reason="Protocolo de fechamento de SESSION: Template F foi usado com intenção de encerrar, mas a close_key está ausente ou inválida. Encerramento exige chave correta digitada pelo usuário e validação automática via post-tool-use/session-close.${session_hint}"
        system_message="🚫 TURN BLOQUEADO: fluxo de SESSION Close inválido (KEY ausente/inválida). Refaça Template F e aguarde a KEY correta."
    elif [ "$auth_invalid_reason" = "session_close_validation_not_confirmed" ]; then
        reason_code="session_close_validation_not_confirmed"
        reason="Protocolo de fechamento de SESSION: a key foi informada, porém a validação final (close_key_validated=true) não foi confirmada no contexto. O TURN não pode encerrar até confirmação do fluxo completo.${session_hint}"
        system_message="🚫 TURN BLOQUEADO: validação final de fechamento não confirmada. Refaça Template F ou verifique sessão antes de encerrar."
    elif [ "$auth_invalid_reason" = "turn_auth_context_invalid" ]; then
        reason_code="turn_auth_context_invalid"
        reason="Contrato executável de autorização do TURN inválido: payload de contexto de autorização está ausente/corrompido. Sem contrato válido, o fechamento não é permitido.${session_hint}"
        system_message="🚫 TURN BLOQUEADO: contrato de autorização inválido. Refaça o fluxo final com vscode_askQuestions e tente novamente."
    else
        reason_code="askquestions_not_called"
        reason="Protocolo v9.0: este TURN encerrou sem chamar vscode_askQuestions. manage_todo_list foi chamado (correto), mas o último TODO (vscode_askQuestions) foi pulado. Ação obrigatória AGORA: chame vscode_askQuestions. Fechamento legítimo deste TURN exige ${required_turn_close_action}. vscode_askQuestions é o canal primário de comunicação — texto plano no chatbox NÃO é suficiente.${session_hint}"
        system_message="🚨 TURN BLOQUEADO (v9.0): manage_todo_list foi chamado (✓) mas vscode_askQuestions NÃO foi chamado. Chame agora (${required_turn_close_action}) antes de encerrar."
    fi

    printf '%s|%s|%s\n' "$reason" "$system_message" "$reason_code"
}

# Atualiza tracker de mismatch (HEAL v2) e retorna a contagem consecutiva.
update_mismatch_tracker() {
    local track_file="$1"
    local got_sid="$2"
    local prev_got=""
    local prev_count=0
    local new_count=1

    if [ -f "$track_file" ]; then
        prev_got="$(jq -r '.got // ""' "$track_file" 2> /dev/null || echo '')"
        prev_count="$(jq -r '.count // 0' "$track_file" 2> /dev/null || echo 0)"
    fi

    if [ "$prev_got" = "$got_sid" ]; then
        new_count=$((prev_count + 1))
    fi

    jq -cn --arg got "$got_sid" --argjson count "$new_count" \
        '{got: $got, count: $count}' > "$track_file" 2> /dev/null || true

    printf '%s\n' "$new_count"
}

# Reconciliador de session_id específico do agent-stop.
# Retornos:
#   0  => segue fluxo normal; stdout = session_id reconciliado
#   10 => mismatch não saneado (block já emitido quando aplicável)
reconcile_session_id_guard_stop() {
    local ctx_file="$1"
    local audit_file="$2"
    local state_dir="$3"
    local session_id_payload="$4"
    local current_session_id="$5"
    local stop_hook_active="$6"
    local timestamp="$7"
    local now_iso="$8"

    if [ ! -f "$ctx_file" ] || [ ! -s "$ctx_file" ] || [ -z "$session_id_payload" ]; then
        printf '%s\n' "$current_session_id"
        return 0
    fi

    local ctx_active_sid
    ctx_active_sid="$(jq -r '.session.id // ""' "$ctx_file" 2> /dev/null || echo '')"
    if [ -z "$ctx_active_sid" ] || [ "$session_id_payload" = "$ctx_active_sid" ]; then
        printf '%s\n' "$current_session_id"
        return 0
    fi

    local ctx_source
    ctx_source="$(jq -r '.session.source // ""' "$ctx_file" 2> /dev/null || echo '')"

    if [ "$ctx_source" = "manual_recovery" ]; then
        local now_heal
        now_heal="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo "$now_iso")"
        write_session_identity_in_context "$ctx_file" "$session_id_payload" "healed_from_real_session" "$now_heal"
        log_session_id_healed_event \
            "$audit_file" \
            "$ctx_active_sid" \
            "$session_id_payload" \
            "agent-stop.sh" \
            "${timestamp:-$now_heal}" \
            "CTX manual_recovery adotado: session_id atualizado para sessão real do Copilot"
        printf '%s\n' "$session_id_payload"
        return 0
    fi

    if [ "$ctx_source" = "inline_restart" ]; then
        log_session_id_sync_inline_restart_event \
            "$audit_file" \
            "$session_id_payload" \
            "$ctx_active_sid" \
            "agent-stop.sh" \
            "${timestamp:-}" \
            "inline_restart: payload stale — adotado session_id do CTX (VS Code, PREMISSA 1)"
        printf '%s\n' "$ctx_active_sid"
        return 0
    fi

    local mismatch_track_file new_count
    mismatch_track_file="$state_dir/.mismatch_track.json"
    new_count="$(update_mismatch_tracker "$mismatch_track_file" "$session_id_payload")"

    if [ "$new_count" -ge 3 ]; then
        local now_heal
        now_heal="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo "$now_iso")"
        write_session_identity_in_context "$ctx_file" "$session_id_payload" "healed_from_consecutive_mismatch" "$now_heal"
        rm -f "$mismatch_track_file" 2> /dev/null || true
        log_session_id_healed_event \
            "$audit_file" \
            "$ctx_active_sid" \
            "$session_id_payload" \
            "agent-stop.sh:heal_v2" \
            "${timestamp:-$now_heal}" \
            "HEAL v2: mismatch consecutivo (3x) — session_id sanado para ID recorrente" \
            "$new_count"
        printf '%s\n' "$session_id_payload"
        return 0
    fi

    log_session_id_mismatch_event \
        "$audit_file" \
        "$ctx_active_sid" \
        "$session_id_payload" \
        "agent-stop.sh" \
        "${timestamp:-}" \
        "$new_count" \
        "Payload session_id diferente do contexto ativo — state write bloqueado"

    if [ "$stop_hook_active" != "true" ]; then
        emit_unresolved_session_mismatch_block "$ctx_active_sid" "$session_id_payload" "$new_count"
    fi

    return 10
}

# Decide se deve emitir systemMessage contextual no fim do TURN.
should_emit_context_nudge() {
    local push_pending="${1:-false}"
    local turns_since_ask="${2:-0}"
    local consecutive_unauth="${3:-0}"
    local auth_requested="${4:-false}"

    if [ "$push_pending" = "true" ]; then
        return 0
    fi
    if [ "$auth_requested" = "false" ] && [ "$turns_since_ask" -ge 3 ] 2> /dev/null; then
        return 0
    fi
    if [ "$auth_requested" = "false" ] && [ "$consecutive_unauth" -ge 1 ] 2> /dev/null; then
        return 0
    fi
    return 1
}

# Gera resumo canônico do turno para session_summary.
build_turn_session_summary() {
    local turn_number="${1:-0}"
    local duration_s="${2:-0}"
    local tools_count="${3:-0}"
    printf 'turn=%s dur=%ss tools=%s\n' "$turn_number" "$duration_s" "$tools_count"
}

# Seleciona o contador de autorização a ser incrementado no fim do turno.
select_auth_increment_field() {
    local auth_requested="${1:-false}"
    if [ "$auth_requested" = "true" ]; then
        printf '%s\n' 'turn_authorized'
    else
        printf '%s\n' 'turn_no_askQuestions'
    fi
}

# Define se deve sincronizar tasks para documentação neste turno.
should_sync_tasks_to_docs_every_five_turns() {
    local turn_count
    turn_count="$(sanitize_nonnegative_int "${1:-0}")"
    if [ "$turn_count" -gt 0 ] 2> /dev/null && [ $((turn_count % 5)) -eq 0 ]; then
        return 0
    fi
    return 1
}

# Finaliza estado do turno no session-context (incrementa stats + reset current_turn).
finalize_turn_context_state() {
    local ctx_file="$1"
    local now_iso="$2"
    local session_summary="$3"
    local auth_incr_field="$4"
    local next_turn="$5"
    local section_name="$6"
    local section_id="$7"
    local turn_id="$8"
    local turn_number="$9"
    local section_turn="${10}"
    local turn_duration_s="${11}"
    local turn_tools_count="${12}"
    local turn_intent="${13}"
    local auth_requested="${14}"
    local turn_failures_count="${15}"

    if [ ! -f "$ctx_file" ] || ! command -v sponge > /dev/null 2>&1; then
        return 0
    fi

    jq --arg now "$now_iso" \
        --arg summary "$session_summary" \
        --arg auth_field "$auth_incr_field" \
        --argjson next_turn "$next_turn" \
        --arg section "$section_name" \
        --arg sec_id "$section_id" \
        --arg turn_id_s "$turn_id" \
        --argjson turn_num "$turn_number" \
        --argjson sec_turn "$section_turn" \
        --argjson dur_s "$turn_duration_s" \
        --argjson tools_n "$turn_tools_count" \
        --arg intent_s "$turn_intent" \
        --arg auth_s "$auth_requested" \
        --argjson fail_n "$turn_failures_count" \
        '.session_stats.turn_count    = (.session_stats.turn_count // 0) + 1
         | .session_stats[$auth_field] = (.session_stats[$auth_field] // 0) + 1
         | .session_stats.turns_since_askQuestions = (
             if $auth_s == "true" then 0
             else (.session_stats.turns_since_askQuestions // 0) + 1
             end)
         | .session_stats.subturn_count = (.session_stats.subturn_count // 0)
         | .session_stats.subturn_blocked = (.session_stats.subturn_blocked // 0)
         | .session_stats.subturn_resumed = (.session_stats.subturn_resumed // 0)
         | .session_stats.subturn_via_subagent = (.session_stats.subturn_via_subagent // 0)
         | .session_stats.subturn_via_askquestions = (.session_stats.subturn_via_askquestions // 0)
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
         | .current_turn.todo_refresh_required = false
         | .current_turn.todo_refresh_required_at = null
         | .current_turn.todo_refresh_done_at = null
         | .current_turn.subagent_delegated = false
         | .current_turn.last_non_bookkeeping_tool = null
         | .current_turn.last_askquestions_template = null
         | .current_turn.last_askquestions_close_action = null
         | .current_turn.last_askquestions_close_key_found = false
         | .current_turn.last_askquestions_has_template_f_option = true
         | .current_turn.template_f_called_without_prior_request = false
         | .current_turn.todo_last_item_label = null
         | .current_turn.todo_last_item_is_askquestions_continuation = false
         | .current_turn.todo_last_item_checked_at = null
         | .current_turn.todo_protocol_version = null
         | .current_turn.continuation_instruction_clear = null
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
         | .current_turn.continuation_mandatory = false
         | .current_turn.continuation_mandatory_at = null
         | .current_turn.continuation_mandatory_reason = null
         | .current_turn.subturn = null
         | .current_turn.subturn_history = []' \
        "$ctx_file" | sponge "$ctx_file" 2> /dev/null || true
}

# Executa script opcional sem propagar erro.
run_optional_hook_script() {
    local script_path="$1"
    [ -f "$script_path" ] || return 0
    bash "$script_path" 2> /dev/null || true
}

# Garante a invariante SESSION+SECTION+TURN; cria seção 'retomada' quando
# current_section está ausente/vazia/fechada.
ensure_section_invariant_retomada() {
    local ctx_file="$1"
    local audit_file="$2"
    local session_id="$3"

    [ -f "$ctx_file" ] || return 0

    local curr_section_name curr_section_closed
    curr_section_name="$(jq -r '.current_section.name // ""' "$ctx_file" 2> /dev/null || echo '')"
    curr_section_closed="$(jq -r '.current_section.is_closed // false' "$ctx_file" 2> /dev/null || echo false)"

    if [ -n "$curr_section_name" ] && [ "$curr_section_name" != "null" ] && [ "$curr_section_closed" != "true" ]; then
        return 0
    fi

    local auto_section_now auto_section_id next_section_num next_turn_auto
    auto_section_now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    auto_section_id="$(uuidgen 2> /dev/null || printf 'sect_%s_%s' "$(date +%s)" "$$")"
    next_section_num=1
    next_turn_auto=1

    next_section_num="$(jq -r '(.session_stats.section_count // 0) + 1' "$ctx_file" 2> /dev/null || echo 1)"
    next_turn_auto="$(jq -r '(.session_stats.turn_count // 0) + 1' "$ctx_file" 2> /dev/null || echo 1)"

    if command -v sponge > /dev/null 2>&1; then
        jq --arg ts "$auto_section_now" \
            --arg auto_section_id "$auto_section_id" \
            --argjson snum "$next_section_num" \
            --argjson tnum "${next_turn_auto:-1}" \
            '.current_section = {name: "retomada", section_id: $auto_section_id, started_at: $ts, turn_start: $tnum, local_turn: 0, description: "Seção automática criada pela invariante SESSION+SECTION+TURN", section_number: $snum, push_count: 0, tools_by_name: {}, intent_history: [], failures_count: 0, blocked_turns: 0}
             | .session_stats.section_count = $snum
             | .session_stats.section_names += ["retomada"]
             | .session_stats.section_history = ((.session_stats.section_history // []) + [{name: "retomada", section_id: $auto_section_id, section_number: $snum, started_at: $ts}] | if length > 50 then .[-50:] else . end)
             | .current_turn.section_turn = 1
             | .current_turn.agentStop_invocations = 0' \
            "$ctx_file" | sponge "$ctx_file" 2> /dev/null || true
    else
        local tmp_inv
        tmp_inv="$(mktemp)"
        if jq --arg ts "$auto_section_now" \
            --arg auto_section_id "$auto_section_id" \
            --argjson snum "$next_section_num" \
            --argjson tnum "${next_turn_auto:-1}" \
            '.current_section = {name: "retomada", section_id: $auto_section_id, started_at: $ts, turn_start: $tnum, local_turn: 0, description: "Seção automática criada pela invariante SESSION+SECTION+TURN", section_number: $snum, push_count: 0, tools_by_name: {}, intent_history: [], failures_count: 0, blocked_turns: 0}
             | .session_stats.section_count = $snum
             | .session_stats.section_names += ["retomada"]
             | .session_stats.section_history = ((.session_stats.section_history // []) + [{name: "retomada", section_id: $auto_section_id, section_number: $snum, started_at: $ts}] | if length > 50 then .[-50:] else . end)
             | .current_turn.section_turn = 1
             | .current_turn.agentStop_invocations = 0' \
            "$ctx_file" > "$tmp_inv" 2> /dev/null; then
            mv "$tmp_inv" "$ctx_file" 2> /dev/null || rm -f "$tmp_inv"
        else
            rm -f "$tmp_inv"
        fi
    fi

    jq -cn \
        --arg event "sectionStart" \
        --arg sid "$session_id" \
        --arg ts "$auto_section_now" \
        --arg auto_section_id "$auto_section_id" \
        --argjson section_num "$next_section_num" \
        '{
            event:          $event,
            session_id:     $sid,
            timestamp:      $ts,
            section_name:   "retomada",
            section_id:     $auto_section_id,
            section_number: $section_num,
            description:    "Seção automática criada pela invariante SESSION+SECTION+TURN",
            auto_open:      true
        }' >> "$audit_file"
    echo "[invariante] Seção 'retomada' auto-criada para garantir SESSION+SECTION+TURN ativo" >&2
}

# Loga evento base de agentStop no audit.jsonl.
log_agent_stop_event() {
    local audit_file="$1"
    local sid="$2"
    local ts="$3"
    local dur="$4"
    local stop_hook_active="$5"
    local turn_number="$6"
    local section_turn="$7"
    local section_name="$8"
    local section_id="$9"
    local turn_id="${10}"
    local intent="${11}"
    local intent_declared="${12}"
    local tools_count="${13}"
    local failures_count="${14}"
    local block_count="${15}"
    local agentstop_invocations="${16}"

    jq -cn \
        --arg event "agentStop" \
        --arg sid "$sid" \
        --arg ts "$ts" \
        --argjson dur "$dur" \
        --argjson stop_hook_active "$stop_hook_active" \
        --argjson turn_number "$turn_number" \
        --argjson section_turn "$section_turn" \
        --arg section_name "$section_name" \
        --arg section_id "$section_id" \
        --arg turn_id "$turn_id" \
        --arg intent "$intent" \
        --argjson intent_declared "$intent_declared" \
        --argjson tools_count "$tools_count" \
        --argjson failures_count "$failures_count" \
        --argjson block_count "$block_count" \
        --argjson agentStop_invocations "$agentstop_invocations" \
        '{
            event:                  $event,
            session_id:             $sid,
            timestamp:              $ts,
            turn_duration_s:        $dur,
            stop_hook_active:       $stop_hook_active,
            turn_number:            $turn_number,
            section_turn:           $section_turn,
            section_name:           (if $section_name == "" then null else $section_name end),
            section_id:             (if $section_id == "" then null else $section_id end),
            turn_id:                (if $turn_id == "" then null else $turn_id end),
            intent:                 (if $intent == "" then null else $intent end),
            intent_declared:        $intent_declared,
            tools_count:            $tools_count,
            failures_count:         $failures_count,
            block_count:            $block_count,
            agentStop_invocations:  $agentStop_invocations
        }' >> "$audit_file"
}

# Loga invalidação de autorização do turno (v9.1).
log_turn_auth_invalidated_event() {
    local audit_file="$1"
    local sid="$2"
    local ts="$3"
    local reason="$4"
    local last_tool="$5"
    local last_non_bookkeeping_tool="$6"
    local turn_id="$7"

    jq -cn \
        --arg event "turnAuth_invalidated" \
        --arg sid "$sid" \
        --arg ts "$ts" \
        --arg reason "$reason" \
        --arg last_tool "$last_tool" \
        --arg last_non_bookkeeping_tool "$last_non_bookkeeping_tool" \
        --arg turn_id "$turn_id" \
        '{
            event: $event,
            session_id: $sid,
            timestamp: $ts,
            reason: $reason,
            last_tool: (if $last_tool == "" then null else $last_tool end),
            last_non_bookkeeping_tool: (if $last_non_bookkeeping_tool == "" then null else $last_non_bookkeeping_tool end),
            turn_id: (if $turn_id == "" then null else $turn_id end),
            message: "Autorização do turno invalidada por não cumprir regra de último ato (v9.1)"
        }' >> "$audit_file"
}

# Constrói contexto canônico de autorização do TURN (P7.3).
build_turn_authorization_context_json() {
    local ctx_file="$1"
    local session_id="$2"
    local turn_id="$3"
    local auth_requested="$4"
    local auth_invalid_reason="$5"
    local stop_hook_active="$6"
    local timestamp_iso="$7"

    local last_tool_name=""
    local last_non_bookkeeping_tool=""
    local ask_template=""
    local ask_close_action=""
    local ask_close_key_found="false"
    local ask_response_present="false"
    local close_key_validated="false"
    local strict_mode="true"

    if [ -f "$ctx_file" ]; then
        last_tool_name="$(jq -r '.last_tool.name // ""' "$ctx_file" 2> /dev/null || echo '')"
        last_non_bookkeeping_tool="$(jq -r '.current_turn.last_non_bookkeeping_tool // ""' "$ctx_file" 2> /dev/null || echo '')"
        ask_template="$(jq -r '.current_turn.last_askquestions_template // ""' "$ctx_file" 2> /dev/null || echo '')"
        ask_close_action="$(jq -r '.current_turn.last_askquestions_close_action // ""' "$ctx_file" 2> /dev/null || echo '')"
        ask_close_key_found="$(jq -r '.current_turn.last_askquestions_close_key_found // false' "$ctx_file" 2> /dev/null || echo 'false')"
        close_key_validated="$(jq -r '.session.close_key_validated // false' "$ctx_file" 2> /dev/null || echo 'false')"
        strict_mode="$(jq -r '(.session.strict_turn_close_requires_key | if . == null then true else . end)' "$ctx_file" 2> /dev/null || echo 'true')"

        if [ "$(jq -r '.current_turn.last_askquestions_response // ""' "$ctx_file" 2> /dev/null || echo '')" != "" ]; then
            ask_response_present="true"
        fi
    fi

    jq -cn \
        --arg schema_version "1.0.0" \
        --arg sid "$session_id" \
        --arg turn_id "$turn_id" \
        --arg ts "$timestamp_iso" \
        --arg last_tool_name "$last_tool_name" \
        --arg last_non_bookkeeping_tool "$last_non_bookkeeping_tool" \
        --arg auth_requested "$auth_requested" \
        --arg auth_invalid_reason "$auth_invalid_reason" \
        --arg ask_template "$ask_template" \
        --arg ask_close_action "$ask_close_action" \
        --arg ask_close_key_found "$ask_close_key_found" \
        --arg ask_response_present "$ask_response_present" \
        --arg close_key_validated "$close_key_validated" \
        --arg strict_mode "$strict_mode" \
        --arg stop_hook_active "$stop_hook_active" \
        '{
            schema_version: $schema_version,
            session_id: $sid,
            turn_id: (if $turn_id == "" then null else $turn_id end),
            timestamp: $ts,
            last_tool_name: (if $last_tool_name == "" then null else $last_tool_name end),
            last_non_bookkeeping_tool: (if $last_non_bookkeeping_tool == "" then null else $last_non_bookkeeping_tool end),
            auth_requested: ($auth_requested == "true"),
            auth_invalid_reason: (if $auth_invalid_reason == "" then null else $auth_invalid_reason end),
            askquestions: {
                response_present: ($ask_response_present == "true"),
                template: (if $ask_template == "" then null else $ask_template end),
                close_action: (if $ask_close_action == "" then null else $ask_close_action end),
                close_key_found: ($ask_close_key_found == "true")
            },
            strict_mode: ($strict_mode == "true"),
            session_close_key_validated: ($close_key_validated == "true"),
            stop_hook_active: ($stop_hook_active == "true")
        }'
}

# Valida contrato mínimo do contexto de autorização do TURN (P7.3).
validate_turn_authorization_context_json() {
    local context_json="$1"
    printf '%s\n' "$context_json" | jq -e '
        (.schema_version == "1.0.0")
        and (.session_id | type == "string" and length > 0)
        and (.timestamp | type == "string" and length > 0)
        and (.auth_requested | type == "boolean")
        and (.strict_mode | type == "boolean")
        and (.session_close_key_validated | type == "boolean")
        and (.stop_hook_active | type == "boolean")
        and (.askquestions | type == "object")
        and (.askquestions.response_present | type == "boolean")
        and (.askquestions.close_key_found | type == "boolean")
    ' > /dev/null 2>&1
}

# Loga evento quando contrato executável de autorização está inválido.
log_turn_auth_context_invalid_event() {
    local audit_file="$1"
    local sid="$2"
    local ts="$3"
    local turn_id="$4"

    jq -cn \
        --arg event "turnAuth_context_invalid" \
        --arg sid "$sid" \
        --arg ts "$ts" \
        --arg turn_id "$turn_id" \
        '{
            event: $event,
            session_id: $sid,
            timestamp: $ts,
            turn_id: (if $turn_id == "" then null else $turn_id end),
            message: "Contrato de contexto de autorização inválido; fechamento do TURN forçado para block"
        }' >> "$audit_file"
}

# Aplica guard do contrato executável de autorização do TURN (P7.3/M4).
# Escreve snapshot em state/turn-authorization-context.json e retorna
# stdout no formato: "<auth_requested>|<auth_invalid_reason>".
apply_turn_authorization_contract_guard() {
    local ctx_file="$1"
    local audit_file="$2"
    local state_dir="$3"
    local session_id="$4"
    local turn_id="$5"
    local now_iso="$6"
    local stop_hook_active="$7"
    local auth_requested_in="$8"
    local auth_invalid_reason_in="$9"

    local auth_requested="$auth_requested_in"
    local auth_invalid_reason="$auth_invalid_reason_in"
    local context_file="$state_dir/turn-authorization-context.json"
    local context_json

    context_json="$(build_turn_authorization_context_json \
        "$ctx_file" \
        "$session_id" \
        "$turn_id" \
        "$auth_requested" \
        "$auth_invalid_reason" \
        "$stop_hook_active" \
        "$now_iso")"
    printf '%s\n' "$context_json" > "$context_file" 2> /dev/null || true

    if ! validate_turn_authorization_context_json "$context_json"; then
        auth_requested="false"
        auth_invalid_reason="turn_auth_context_invalid"
        log_turn_auth_context_invalid_event "$audit_file" "$session_id" "$now_iso" "$turn_id"
    fi

    printf '%s|%s\n' "$auth_requested" "$auth_invalid_reason"
}

# Loga evento de fechamento autorizado do turno.
log_turn_end_authorized_event() {
    local audit_file="$1"
    local sid="$2"
    local ts="$3"
    local turn_number="$4"
    local section_turn="$5"
    local section_name="$6"
    local section_id="$7"
    local turn_id="$8"
    local dur="$9"
    local tools_count="${10}"
    local intent="${11}"
    local failures_count="${12}"
    local push_pending="${13}"

    jq -cn \
        --arg event "turnEnd_authorized" \
        --arg sid "$sid" \
        --arg ts "$ts" \
        --argjson turn_number "$turn_number" \
        --argjson section_turn "$section_turn" \
        --arg section_name "$section_name" \
        --arg section_id "$section_id" \
        --arg turn_id "$turn_id" \
        --argjson dur "$dur" \
        --argjson tools "$tools_count" \
        --arg intent "$intent" \
        --argjson failures "$failures_count" \
        --argjson push_pending "$push_pending" \
        '{event: $event, session_id: $sid, timestamp: $ts,
          turn_number: $turn_number, section_turn: $section_turn,
          section_name: (if $section_name == "" then null else $section_name end),
          section_id:   (if $section_id == "" then null else $section_id end),
          turn_id:      (if $turn_id == "" then null else $turn_id end),
          turn_duration_s: $dur, tools_count: $tools,
          intent: (if $intent == "" then null else $intent end),
          failures_count: $failures, push_pending: $push_pending}' \
        >> "$audit_file"
}

# Loga autorização implícita via delegação imediata ao subagente.
log_auth_via_subagent_delegation_event() {
    local audit_file="$1"
    local sid="$2"
    local ts="$3"
    local turn_id="$4"

    jq -cn \
        --arg event "auth_via_subagent_delegation" \
        --arg sid "$sid" \
        --arg ts "$ts" \
        --arg turn_id "$turn_id" \
        '{
            event:      $event,
            session_id: $sid,
            timestamp:  $ts,
            turn_id:    (if $turn_id == "" then null else $turn_id end),
            message:    "Autorização concedida via delegação imediata ao subagente"
        }' >> "$audit_file"
}

# Loga auditoria informativa de turno sem vscode_askQuestions.
log_turn_end_no_askquestions_event() {
    local audit_file="$1"
    local sid="$2"
    local ts="$3"
    local section_id="$4"
    local turn_id="$5"

    jq -cn \
        --arg event "turnEnd_no_askQuestions" \
        --arg sid "$sid" \
        --arg ts "$ts" \
        --arg section_id "$section_id" \
        --arg turn_id "$turn_id" \
        '{
            event:      $event,
            session_id: $sid,
            timestamp:  $ts,
            section_id: (if $section_id == "" then null else $section_id end),
            turn_id:    (if $turn_id == "" then null else $turn_id end),
            message:    "Turno sem vscode_askQuestions — avaliando bloqueio v7.0"
        }' >> "$audit_file"
}

# Loga auditoria informativa de turno com askQuestions inválido (ex.: KEY ausente no modo estrito).
log_turn_end_invalid_authorization_event() {
    local audit_file="$1"
    local sid="$2"
    local ts="$3"
    local section_id="$4"
    local turn_id="$5"
    local reason="$6"

    jq -cn \
        --arg event "turnEnd_invalid_authorization" \
        --arg sid "$sid" \
        --arg ts "$ts" \
        --arg section_id "$section_id" \
        --arg turn_id "$turn_id" \
        --arg reason "$reason" \
        '{
            event:      $event,
            session_id: $sid,
            timestamp:  $ts,
            section_id: (if $section_id == "" then null else $section_id end),
            turn_id:    (if $turn_id == "" then null else $turn_id end),
            reason:     (if $reason == "" then null else $reason end),
            message:    "Turno com tentativa de autorizacao invalida — vscode_askQuestions presente, mas fluxo de fechamento rejeitado"
        }' >> "$audit_file"
}

# Loga evento de bloqueio principal do Stop (v9.0).
log_agent_stop_blocked_event() {
    local audit_file="$1"
    local sid="$2"
    local ts="$3"
    local turn_id="$4"
    local consecutive_unauthorized="$5"
    local todo_created="$6"
    local block_count="$7"
    local auth_invalid_reason="${8:-}"
    local block_reason="no_askquestions"
    local message="TURN bloqueado por hardening v9.0: vscode_askQuestions não chamado"

    if [ -n "$auth_invalid_reason" ]; then
        block_reason="invalid_authorization"
        message="TURN bloqueado por hardening v9.2: vscode_askQuestions presente, mas autorização inválida"
    fi

    jq -cn \
        --arg event "agentStop_blocked" \
        --arg sid "$sid" \
        --arg ts "$ts" \
        --arg turn_id "$turn_id" \
        --argjson consec "$consecutive_unauthorized" \
        --argjson todo "$todo_created" \
        --argjson block_count "$block_count" \
        --arg block_reason "$block_reason" \
        --arg invalid_reason "$auth_invalid_reason" \
        --arg message "$message" \
        '{
            event:      $event,
            session_id: $sid,
            timestamp:  $ts,
            turn_id:    (if $turn_id == "" then null else $turn_id end),
            consecutive_unauthorized: $consec,
            todo_created: $todo,
            block_count: $block_count,
            block_reason: $block_reason,
            invalid_reason: (if $invalid_reason == "" then null else $invalid_reason end),
            turn_authorized: false,
            session_closed: false,
            requires_user_action: true,
            message:    $message
        }' >> "$audit_file"
}

# Loga evento canônico de duplo lock (P7.1): bloqueio por lock de preToolUse/Stop.
log_turn_close_prevented_dual_lock_event() {
    local audit_file="$1"
    local sid="$2"
    local ts="$3"
    local lock_stage="$4"
    local turn_id="$5"
    local reason="$6"

    jq -cn \
        --arg event "turnClose_prevented_dual_lock" \
        --arg sid "$sid" \
        --arg ts "$ts" \
        --arg lock_stage "$lock_stage" \
        --arg turn_id "$turn_id" \
        --arg reason "$reason" \
        '{
            event: $event,
            session_id: $sid,
            timestamp: $ts,
            lock_stage: $lock_stage,
            turn_id: (if $turn_id == "" then null else $turn_id end),
            reason: (if $reason == "" then null else $reason end),
            message: "Fechamento de turno/sessão prevenido por duplo lock (PreToolUse + Stop)"
        }' >> "$audit_file"
}

# Loga evento adicional quando manage_todo_list não foi chamado (violação dupla).
log_agent_stop_blocked_no_todo_event() {
    local audit_file="$1"
    local sid="$2"
    local ts="$3"
    local turn_id="$4"
    local consecutive_unauthorized="$5"

    jq -cn \
        --arg event "agentStop_blocked_no_todo" \
        --arg sid "$sid" \
        --arg ts "$ts" \
        --arg turn_id "$turn_id" \
        --argjson consec "$consecutive_unauthorized" \
        '{
            event:      $event,
            session_id: $sid,
            timestamp:  $ts,
            turn_id:    (if $turn_id == "" then null else $turn_id end),
            consecutive_unauthorized: $consec,
            message:    "manage_todo_list NÃO chamado neste turno — violação dupla do Protocolo v9.0"
        }' >> "$audit_file"
}

# Loga auto-enrich de intenção quando start-turn.sh não foi chamado.
log_turn_start_enriched_auto_event() {
    local audit_file="$1"
    local sid="$2"
    local ts="$3"
    local turn_number="$4"
    local section_name="$5"
    local section_id="$6"
    local turn_id="$7"
    local intent="$8"

    jq -cn \
        --arg event "turnStart_enriched_auto" \
        --arg sid "$sid" \
        --arg ts "$ts" \
        --argjson turn_number "$turn_number" \
        --arg section_name "$section_name" \
        --arg section_id "$section_id" \
        --arg turn_id "$turn_id" \
        --arg intent "$intent" \
        '{
            event:          $event,
            session_id:     $sid,
            timestamp:      $ts,
            turn_number:    $turn_number,
            section_name:   (if $section_name == "" then null else $section_name end),
            section_id:     (if $section_id == "" then null else $section_id end),
            turn_id:        (if $turn_id == "" then null else $turn_id end),
            intent:         $intent,
            auto_generated: true
        }' >> "$audit_file"
}

# Escreve AUTHORIZED_CLOSE.flag no schema JSON canônico.
write_authorized_close_flag() {
    local flag_file="$1"
    local ts="$2"
    local sid="$3"
    local turn_count="$4"

    jq -cn \
        --arg ts "$ts" \
        --arg sid "$sid" \
        --argjson turn "$turn_count" \
        '{
            timestamp:  $ts,
            session_id: $sid,
            turn_count: $turn,
            authorized: true
        }' > "$flag_file"
}

# Escreve UNAUTHORIZED_CLOSE.flag no schema JSON canônico.
write_unauthorized_close_flag() {
    local flag_file="$1"
    local ts="$2"
    local sid="$3"
    local turn_count="$4"
    local consecutive_unauthorized="$5"
    local intent="$6"

    jq -cn \
        --arg ts "$ts" \
        --arg sid "$sid" \
        --argjson turn "${turn_count:-0}" \
        --argjson consec "${consecutive_unauthorized:-0}" \
        --arg intent "$intent" \
        '{
            timestamp:                $ts,
            session_id:               $sid,
            turn_count:               $turn,
            consecutive_unauthorized: $consec,
            intent:                   (if $intent == "" then null else $intent end),
            message:                  "Turno encerrado sem vscode_askQuestions — hardening v5.1"
        }' > "$flag_file"
}

# Atualiza identidade de sessão no contexto, com fallback sem sponge.
write_session_identity_in_context() {
    local ctx_file="$1"
    local real_sid="$2"
    local source="$3"
    local ts="$4"

    if [ ! -f "$ctx_file" ]; then
        return 1
    fi

    if command -v sponge > /dev/null 2>&1; then
        jq --arg real_sid "$real_sid" --arg src "$source" --arg ts "$ts" \
            '.session.id = $real_sid
             | .session.vs_code_session_id = $real_sid
             | .session.source = $src
             | .session.healed_at = $ts' \
            "$ctx_file" | sponge "$ctx_file" 2> /dev/null || true
    else
        local tmp_ctx
        if tmp_ctx="$(mktemp 2> /dev/null)"; then
            jq --arg real_sid "$real_sid" --arg src "$source" --arg ts "$ts" \
                '.session.id = $real_sid
                 | .session.vs_code_session_id = $real_sid
                 | .session.source = $src
                 | .session.healed_at = $ts' \
                "$ctx_file" > "$tmp_ctx" 2> /dev/null \
                && mv "$tmp_ctx" "$ctx_file" \
                || rm -f "$tmp_ctx" 2> /dev/null
        fi
    fi
}

# Loga evento session_id_healed, com contador opcional.
log_session_id_healed_event() {
    local audit_file="$1"
    local old_sid="$2"
    local new_sid="$3"
    local source="$4"
    local ts="$5"
    local message="$6"
    local consecutive_count="${7:-}"

    if [ -n "$consecutive_count" ]; then
        jq -cn \
            --arg event "session_id_healed" \
            --arg old "$old_sid" \
            --arg new "$new_sid" \
            --arg source "$source" \
            --arg ts "$ts" \
            --argjson count "$consecutive_count" \
            --arg message "$message" \
            '{event: $event, old_session_id: $old, new_session_id: $new, source: $source,
              timestamp: $ts, consecutive_mismatches: $count, message: $message}' >> "$audit_file"
    else
        jq -cn \
            --arg event "session_id_healed" \
            --arg old "$old_sid" \
            --arg new "$new_sid" \
            --arg source "$source" \
            --arg ts "$ts" \
            --arg message "$message" \
            '{event: $event, old_session_id: $old, new_session_id: $new, source: $source,
              timestamp: $ts, message: $message}' >> "$audit_file"
    fi
}

# Loga sincronização de payload stale em inline_restart.
log_session_id_sync_inline_restart_event() {
    local audit_file="$1"
    local stale_sid="$2"
    local adopted_sid="$3"
    local source="$4"
    local ts="$5"
    local message="$6"

    jq -cn \
        --arg event "session_id_sync_inline_restart" \
        --arg stale "$stale_sid" \
        --arg adopted "$adopted_sid" \
        --arg source "$source" \
        --arg ts "$ts" \
        --arg message "$message" \
        '{event: $event, stale_payload_sid: $stale, adopted_ctx_sid: $adopted,
          source: $source, timestamp: $ts, message: $message}' >> "$audit_file"
}

# Loga mismatch entre payload e contexto ativo.
log_session_id_mismatch_event() {
    local audit_file="$1"
    local expected_sid="$2"
    local got_sid="$3"
    local source="$4"
    local ts="$5"
    local consecutive_count="$6"
    local message="$7"

    jq -cn \
        --arg event "session_id_mismatch" \
        --arg expected "$expected_sid" \
        --arg got "$got_sid" \
        --arg source "$source" \
        --arg ts "$ts" \
        --argjson count "$consecutive_count" \
        --arg message "$message" \
        '{
            event:   $event,
            expected: $expected,
            got:      $got,
            source:   $source,
            timestamp: $ts,
            consecutive_count: $count,
            message:  $message
        }' >> "$audit_file"
}

# Atualiza contexto ao bloquear um TURN por ausência de autorização.
update_blocked_turn_context() {
    local ctx_file="$1"
    local new_consecutive_unauthorized="$2"
    local new_block_count="$3"
    local now_iso="$4"

    local tmp_ctx
    if ! tmp_ctx="$(mktemp 2> /dev/null)"; then
        return 1
    fi

    jq --argjson c "$new_consecutive_unauthorized" \
        --argjson bc "$new_block_count" \
        --arg now "$now_iso" \
        '.compliance.consecutive_unauthorized = $c
         | .compliance.last_turn_authorized = false
         | .last_turn_ts = $now
         | .current_turn.block_count = $bc' \
        "$ctx_file" > "$tmp_ctx" 2> /dev/null \
        && mv "$tmp_ctx" "$ctx_file" \
        || rm -f "$tmp_ctx" 2> /dev/null
}

# Registra subturn bloqueado no histórico e agenda próximo subturn de resume.
record_blocked_subturn_and_schedule_resume() {
    local ctx_file="$1"
    local now_iso="$2"
    local subturn_id="$3"
    local subturn_number="$4"
    local next_subturn_id="$5"
    local next_subturn="$6"
    local subturn_duration_ms="$7"

    [ -f "$ctx_file" ] || return 0

    if command -v sponge > /dev/null 2>&1; then
        jq --arg ts "$now_iso" \
            --arg subturn_id "$subturn_id" \
            --argjson subturn_number "${subturn_number:-1}" \
            --arg next_subturn_id "$next_subturn_id" \
            --argjson next_subturn "$next_subturn" \
            --argjson duration_ms "$subturn_duration_ms" \
            '.current_turn.subturn_history = ((.current_turn.subturn_history // []) + [{
                number: $subturn_number,
                subturn_id: $subturn_id,
                parent_turn_id: (.current_turn.turn_id // null),
                state: "blocked",
                reason: "stop_blocked",
                started_at: (.current_turn.subturn.started_at // null),
                ended_at: $ts,
                duration_ms: $duration_ms
             }] | if length > 20 then .[-20:] else . end)
             | .current_turn.subturn = {
                number: $next_subturn,
                subturn_id: $next_subturn_id,
                state: "blocked",
                reason: "stop_block_resume_pending",
                started_at: $ts,
                last_transition_at: $ts,
                parent_turn_id: (.current_turn.turn_id // null),
                expected_window_minutes: 15,
                stop_hook_active: false,
                requires_user_action: true,
                authorization_snapshot: {
                    auth_requested: (.current_turn.auth_requested // false),
                    ask_template: (.current_turn.last_askquestions_template // null),
                    close_key_found: (.current_turn.last_askquestions_close_key_found // false),
                    close_key_validated: (.session.close_key_validated // false)
                }
             }
             | .session_stats.subturn_blocked = ((.session_stats.subturn_blocked // 0) + 1)
             | .session_stats.subturn_count = ((.session_stats.subturn_count // 0) + 1)' \
            "$ctx_file" | sponge "$ctx_file" 2> /dev/null || true
        return 0
    fi

    local tmp_subturn_block
    if tmp_subturn_block="$(mktemp 2> /dev/null)"; then
        if jq --arg ts "$now_iso" \
            --arg subturn_id "$subturn_id" \
            --argjson subturn_number "${subturn_number:-1}" \
            --arg next_subturn_id "$next_subturn_id" \
            --argjson next_subturn "$next_subturn" \
            --argjson duration_ms "$subturn_duration_ms" \
            '.current_turn.subturn_history = ((.current_turn.subturn_history // []) + [{
                number: $subturn_number,
                subturn_id: $subturn_id,
                parent_turn_id: (.current_turn.turn_id // null),
                state: "blocked",
                reason: "stop_blocked",
                started_at: (.current_turn.subturn.started_at // null),
                ended_at: $ts,
                duration_ms: $duration_ms
             }] | if length > 20 then .[-20:] else . end)
             | .current_turn.subturn = {
                number: $next_subturn,
                subturn_id: $next_subturn_id,
                state: "blocked",
                reason: "stop_block_resume_pending",
                started_at: $ts,
                last_transition_at: $ts,
                parent_turn_id: (.current_turn.turn_id // null),
                expected_window_minutes: 15,
                stop_hook_active: false,
                requires_user_action: true,
                authorization_snapshot: {
                    auth_requested: (.current_turn.auth_requested // false),
                    ask_template: (.current_turn.last_askquestions_template // null),
                    close_key_found: (.current_turn.last_askquestions_close_key_found // false),
                    close_key_validated: (.session.close_key_validated // false)
                }
             }
             | .session_stats.subturn_blocked = ((.session_stats.subturn_blocked // 0) + 1)
             | .session_stats.subturn_count = ((.session_stats.subturn_count // 0) + 1)' \
            "$ctx_file" > "$tmp_subturn_block" 2> /dev/null; then
            mv "$tmp_subturn_block" "$ctx_file" 2> /dev/null || rm -f "$tmp_subturn_block"
        else
            rm -f "$tmp_subturn_block"
        fi
    fi
}

# Marca o contexto como autorizado ao final do TURN.
mark_turn_authorized_in_context() {
    local ctx_file="$1"
    if [ ! -f "$ctx_file" ]; then
        return 0
    fi

    if command -v sponge > /dev/null 2>&1; then
        jq '.compliance.last_turn_authorized = true
             | .compliance.consecutive_unauthorized = 0
             | .compliance.flag_file_exists = false' \
            "$ctx_file" | sponge "$ctx_file" 2> /dev/null || true
    else
        local tmp_ctx
        if tmp_ctx="$(mktemp 2> /dev/null)"; then
            jq '.compliance.last_turn_authorized = true
                 | .compliance.consecutive_unauthorized = 0
                 | .compliance.flag_file_exists = false' \
                "$ctx_file" > "$tmp_ctx" 2> /dev/null \
                && mv "$tmp_ctx" "$ctx_file" \
                || rm -f "$tmp_ctx" 2> /dev/null
        fi
    fi
}

# Marca o contexto como não autorizado ao final do TURN.
mark_turn_unauthorized_in_context() {
    local ctx_file="$1"
    local stop_hook_active="$2"
    if [ ! -f "$ctx_file" ]; then
        return 0
    fi

    if command -v sponge > /dev/null 2>&1; then
        jq --arg stop_hook "$stop_hook_active" \
            '.compliance.last_turn_authorized = false
             | .compliance.consecutive_unauthorized = (
                 if $stop_hook == "true" then (.compliance.consecutive_unauthorized // 0)
                 else (.compliance.consecutive_unauthorized // 0) + 1
                 end)
             | .compliance.flag_file_exists = true' \
            "$ctx_file" | sponge "$ctx_file" 2> /dev/null || true
    else
        local tmp_ctx
        if tmp_ctx="$(mktemp 2> /dev/null)"; then
            jq --arg stop_hook "$stop_hook_active" \
                '.compliance.last_turn_authorized = false
                 | .compliance.consecutive_unauthorized = (
                     if $stop_hook == "true" then (.compliance.consecutive_unauthorized // 0)
                     else (.compliance.consecutive_unauthorized // 0) + 1
                     end)
                 | .compliance.flag_file_exists = true' \
                "$ctx_file" > "$tmp_ctx" 2> /dev/null \
                && mv "$tmp_ctx" "$ctx_file" \
                || rm -f "$tmp_ctx" 2> /dev/null
        fi
    fi
}

# Trata o ramo stop_hook_active=true (resume/reblock suprimido) do agent-stop.
# Retornos:
#   0  => fluxo concluído sem novo block
#   10 => block emitido (script chamador deve encerrar com exit 0)
handle_stop_hook_active_branch() {
    local ctx_file="$1"
    local audit_file="$2"
    local session_id="$3"
    local now_iso="$4"
    local turn_id="$5"
    local subturn_id="$6"
    local subturn_number="$7"
    local subturn_state="$8"
    local subturn_reason="$9"
    local subturn_duration_ms="${10}"
    local stop_hook_active="${11}"
    local auth_requested="${12}"

    if [ "$stop_hook_active" != "true" ]; then
        return 0
    fi

    if command -v emit_subturn_resume_event > /dev/null 2>&1; then
        emit_subturn_resume_event \
            "$audit_file" \
            "$session_id" \
            "$now_iso" \
            "$turn_id" \
            "$subturn_id" \
            "${subturn_number:-1}" \
            "stop_hook_active_resume" \
            "agentStop"
    fi

    if [ -f "$ctx_file" ]; then
        if command -v write_current_subturn_state > /dev/null 2>&1; then
            write_current_subturn_state \
                "$now_iso" \
                "resumed" \
                "stop_hook_active_resume" \
                "true" \
                "false"
        fi

        if command -v sponge > /dev/null 2>&1; then
            jq '.session_stats.subturn_resumed = ((.session_stats.subturn_resumed // 0) + 1)' \
                "$ctx_file" | sponge "$ctx_file" 2> /dev/null || true
        else
            local tmp_subturn_resume
            tmp_subturn_resume="$(mktemp 2> /dev/null || true)"
            if [ -n "$tmp_subturn_resume" ] && jq \
                '.session_stats.subturn_resumed = ((.session_stats.subturn_resumed // 0) + 1)' \
                "$ctx_file" > "$tmp_subturn_resume" 2> /dev/null; then
                mv "$tmp_subturn_resume" "$ctx_file" 2> /dev/null || rm -f "$tmp_subturn_resume"
            else
                [ -n "$tmp_subturn_resume" ] && rm -f "$tmp_subturn_resume"
            fi
        fi
    fi

    if [ "$auth_requested" = "true" ]; then
        log_unblocked_complied_event "$audit_file" "$session_id" "$now_iso" "$turn_id"
        return 0
    fi

    local reblock_count_curr_raw
    local reblock_count_curr
    local reblock_last_tool_name
    local reblock_budget_max_raw
    local reblock_budget_max

    reblock_count_curr_raw="$(jq -r '.current_turn.block_count // 0' "$ctx_file" 2> /dev/null || echo 0)"
    reblock_count_curr="$(sanitize_nonnegative_int "$reblock_count_curr_raw")"
    reblock_last_tool_name="$(jq -r '.last_tool.name // ""' "$ctx_file" 2> /dev/null || echo '')"
    reblock_budget_max_raw="$(jq -r '.session.stop_block_budget_max // 2' "$ctx_file" 2> /dev/null || echo 2)"
    reblock_budget_max="$(sanitize_nonnegative_int "$reblock_budget_max_raw")"
    if [ "$reblock_budget_max" -lt 1 ] 2> /dev/null; then
        reblock_budget_max=1
    fi

    # Hotfix operacional: suprime reblock em stop_hook_active=true para evitar
    # loops de bloqueio recorrente (reblock_no_authorization/stop_block_budget_exceeded)
    # que interrompem a continuidade de turnos.
    jq -cn \
        --arg event "agentStop_reblock_suppressed_no_authorization" \
        --arg sid "$session_id" \
        --arg ts "$now_iso" \
        --arg turn_id "$turn_id" \
        --arg last_tool "$reblock_last_tool_name" \
        --argjson block_count "$reblock_count_curr" \
        --argjson budget_max "$reblock_budget_max" \
        '{
            event: $event,
            session_id: $sid,
            timestamp: $ts,
            turn_id: (if $turn_id == "" then null else $turn_id end),
            last_tool: (if $last_tool == "" then null else $last_tool end),
            block_count: $block_count,
            budget_max: $budget_max,
            message: "Reblock suprimido em stop_hook_active=true para evitar bloqueio recorrente"
        }' >> "$audit_file"

    return 0
}

# Trata o bloco principal de hardening do Stop:
# AUTH_REQUESTED=false && stop_hook_active!=true => emite decision:block.
# Retornos:
#   0  => sem block emitido
#   10 => block emitido (script chamador deve encerrar com exit 0)
handle_main_stop_block_branch() {
    local ctx_file="$1"
    local audit_file="$2"
    local state_dir="$3"
    local session_id="$4"
    local now_iso="$5"
    local turn_id="$6"
    local subturn_id="$7"
    local subturn_number="$8"
    local subturn_state="$9"
    local subturn_reason="${10}"
    local subturn_duration_ms="${11}"
    local auth_invalid_reason="${12}"
    local auth_requested="${13}"
    local stop_hook_active="${14}"

    if [ "$auth_requested" != "false" ] || [ "$stop_hook_active" = "true" ]; then
        return 0
    fi

    local auth_flag_file="$state_dir/UNAUTHORIZED_CLOSE.flag"
    local block_close_key
    local block_close_validated
    local block_strict_mode
    local block_consecutive_raw
    local block_todo_created
    local block_count_curr_raw
    local block_consecutive
    local block_count_curr
    local new_consec
    local new_block_count
    local block_flag_reason="turn_blocked_no_askquestions"
    local block_flag_message="Turno bloqueado em agent-stop por ausência de autorização válida"

    block_close_key="$(jq -r '.session.close_key // "N/A"' "$ctx_file" 2> /dev/null || echo 'N/A')"
    block_close_validated="$(jq -r '.session.close_key_validated // false' "$ctx_file" 2> /dev/null || echo 'false')"
    block_strict_mode="$(jq -r '(.session.strict_turn_close_requires_key | if . == null then true else . end)' "$ctx_file" 2> /dev/null || echo 'true')"
    block_consecutive_raw="$(safe_jq_read_int "$ctx_file" '.compliance.consecutive_unauthorized' 0)"
    block_todo_created="$(jq -r '.current_turn.todo_created // false' "$ctx_file" 2> /dev/null || echo false)"
    block_count_curr_raw="$(safe_jq_read_int "$ctx_file" '.current_turn.block_count' 0)"
    block_consecutive="$(sanitize_nonnegative_int "$block_consecutive_raw")"
    block_count_curr="$(sanitize_nonnegative_int "$block_count_curr_raw")"
    new_consec=$((block_consecutive + 1))
    new_block_count=$((block_count_curr + 1))

    if [ -n "$auth_invalid_reason" ]; then
        block_flag_reason="turn_blocked_invalid_authorization"
        block_flag_message="Turno bloqueado em agent-stop por autorização inválida: $auth_invalid_reason"
    fi

    log_agent_stop_blocked_event \
        "$audit_file" \
        "$session_id" \
        "$now_iso" \
        "$turn_id" \
        "$new_consec" \
        "$block_todo_created" \
        "$new_block_count" \
        "$auth_invalid_reason"

    log_turn_close_prevented_dual_lock_event \
        "$audit_file" \
        "$session_id" \
        "$now_iso" \
        "stop_dual_lock_main" \
        "$turn_id" \
        "${auth_invalid_reason:-askquestions_not_called}"

    if command -v emit_subturn_end_event > /dev/null 2>&1; then
        emit_subturn_end_event \
            "$audit_file" \
            "$session_id" \
            "$now_iso" \
            "$turn_id" \
            "$subturn_id" \
            "${subturn_number:-1}" \
            "$subturn_state" \
            "$subturn_reason" \
            "stop_blocked" \
            "blocked" \
            "$subturn_duration_ms"
    fi

    if [ "$block_todo_created" != "true" ]; then
        log_agent_stop_blocked_no_todo_event \
            "$audit_file" \
            "$session_id" \
            "$now_iso" \
            "$turn_id" \
            "$new_consec"
    fi

    if ! update_blocked_turn_context "$ctx_file" "$new_consec" "$new_block_count" "$now_iso"; then
        echo "[warn] agent-stop: mktemp falhou; consecutive_unauthorized não atualizado" >&2
    fi

    local next_subturn=$((subturn_number + 1))
    local next_subturn_id="${turn_id:-turn_unknown}_st${next_subturn}"
    record_blocked_subturn_and_schedule_resume \
        "$ctx_file" \
        "$now_iso" \
        "$subturn_id" \
        "${subturn_number:-1}" \
        "$next_subturn_id" \
        "$next_subturn" \
        "$subturn_duration_ms"

    if command -v emit_subturn_start_event > /dev/null 2>&1; then
        emit_subturn_start_event \
            "$audit_file" \
            "$session_id" \
            "$now_iso" \
            "$turn_id" \
            "$next_subturn_id" \
            "$next_subturn" \
            "stop_block_resume_pending" \
            "blocked" \
            "agentStop"
    fi

    local block_turn_now
    block_turn_now="$(jq -r '.session_stats.turn_count // 0' "$ctx_file" 2> /dev/null || echo 0)"
    write_turn_block_flag_json \
        "$auth_flag_file" \
        "$now_iso" \
        "$session_id" \
        "${block_turn_now:-0}" \
        "${new_consec:-0}" \
        "$block_flag_reason" \
        "$block_flag_message"

    local block_session_info
    block_session_info="$(build_session_close_hint "$block_close_validated" "$block_close_key")"
    local block_payload
    block_payload="$(build_turn_block_payload "$block_todo_created" "$auth_invalid_reason" "$block_session_info" "$block_strict_mode")"
    local block_reason="${block_payload%%|*}"
    local block_rest="${block_payload#*|}"
    local block_sys_msg="${block_rest%%|*}"
    local block_reason_code="${block_rest#*|}"
    if [ -z "$block_reason_code" ] || [ "$block_reason_code" = "$block_rest" ]; then
        block_reason_code="unknown_block_reason"
    fi

    local block_decision_trace
    block_decision_trace="$(build_decision_trace_json \
        "stop_dual_lock_main" \
        "multi_strategy_v9_1" \
        "${auth_invalid_reason:-askquestions_not_called}" \
        "$block_strict_mode" \
        "$stop_hook_active" \
        "$new_block_count")"

    emit_stop_block "$block_reason" "$block_sys_msg" "$block_reason_code" "$block_decision_trace"
    return 10
}

# Estratégia 1: detecta sinal de autorização no audit após último userPromptSubmitted.
audit_has_turn_auth_signal() {
    local audit_file="$1"
    [ -f "$audit_file" ] || return 1

    local last_prompt_line last_turn_end_line total_lines lines_since_boundary boundary_line
    last_prompt_line="$(awk '/"userPromptSubmitted"/{last=NR} END{print last+0}' "$audit_file" 2> /dev/null || echo 0)"
    last_turn_end_line="$(awk '/"turnEnd_authorized"|"turnEnd_no_askQuestions"|"turnEnd_invalid_authorization"/{last=NR} END{print last+0}' "$audit_file" 2> /dev/null || echo 0)"
    total_lines="$(wc -l < "$audit_file" 2> /dev/null || echo 0)"
    boundary_line=0

    if [ "$last_prompt_line" -gt "$boundary_line" ] 2> /dev/null; then
        boundary_line="$last_prompt_line"
    fi
    if [ "$last_turn_end_line" -gt "$boundary_line" ] 2> /dev/null; then
        boundary_line="$last_turn_end_line"
    fi

    if [ "$boundary_line" -gt 0 ] && [ "$total_lines" -gt "$boundary_line" ]; then
        lines_since_boundary=$((total_lines - boundary_line))
        if [ "$lines_since_boundary" -gt 0 ] && tail -n "$lines_since_boundary" "$audit_file" \
            | jq -re 'select((.event == "postToolUse" and (.tool_name // "") == "vscode_askQuestions") or .event == "askQuestions_response" or .event == "subagentStart")' > /dev/null 2>&1; then
            return 0
        fi
    fi

    # Fallback defensivo para sessões sem userPromptSubmitted no audit corrente
    # (ex.: fluxo predominantemente via askQuestions/tool results).
    if [ "$boundary_line" -le 0 ] && [ "$total_lines" -gt 0 ]; then
        local window_lines=200
        if [ "$total_lines" -lt "$window_lines" ] 2> /dev/null; then
            window_lines="$total_lines"
        fi
        if [ "$window_lines" -gt 0 ] && tail -n "$window_lines" "$audit_file" \
            | jq -re 'select((.event == "postToolUse" and (.tool_name // "") == "vscode_askQuestions") or .event == "askQuestions_response" or .event == "subagentStart")' > /dev/null 2>&1; then
            return 0
        fi
    fi

    return 1
}

# Verifica existência de subagentStart após o último userPromptSubmitted.
audit_has_subagent_start_since_prompt() {
    local audit_file="$1"
    [ -f "$audit_file" ] || return 1

    local last_prompt_line last_turn_end_line total_lines lines_since_boundary boundary_line
    last_prompt_line="$(awk '/"userPromptSubmitted"/{last=NR} END{print last+0}' "$audit_file" 2> /dev/null || echo 0)"
    last_turn_end_line="$(awk '/"turnEnd_authorized"|"turnEnd_no_askQuestions"|"turnEnd_invalid_authorization"/{last=NR} END{print last+0}' "$audit_file" 2> /dev/null || echo 0)"
    total_lines="$(wc -l < "$audit_file" 2> /dev/null || echo 0)"
    boundary_line=0

    if [ "$last_prompt_line" -gt "$boundary_line" ] 2> /dev/null; then
        boundary_line="$last_prompt_line"
    fi
    if [ "$last_turn_end_line" -gt "$boundary_line" ] 2> /dev/null; then
        boundary_line="$last_turn_end_line"
    fi

    if [ "$boundary_line" -gt 0 ] && [ "$total_lines" -gt "$boundary_line" ]; then
        lines_since_boundary=$((total_lines - boundary_line))
        if [ "$lines_since_boundary" -gt 0 ] && tail -n "$lines_since_boundary" "$audit_file" \
            | jq -re 'select(.event == "subagentStart")' > /dev/null 2>&1; then
            return 0
        fi
    fi

    if [ "$boundary_line" -le 0 ] && [ "$total_lines" -gt 0 ]; then
        local window_lines=200
        if [ "$total_lines" -lt "$window_lines" ] 2> /dev/null; then
            window_lines="$total_lines"
        fi
        if [ "$window_lines" -gt 0 ] && tail -n "$window_lines" "$audit_file" \
            | jq -re 'select(.event == "subagentStart")' > /dev/null 2>&1; then
            return 0
        fi
    fi

    return 1
}

# Estratégia 3 (fallback): auth flag no contexto do turno atual.
context_turn_auth_requested() {
    local ctx_file="$1"
    [ -f "$ctx_file" ] || return 1
    local ctx_flag
    ctx_flag="$(jq -r '
        .current_turn.auth_requested //
        .auth_requested_this_turn //
        false' "$ctx_file" 2> /dev/null || echo false)"
    [ "$ctx_flag" = "true" ]
}

# Avalia autorização do TURN (estratégias 1/3/4 + invalidação v9.1).
# Saída (stdout): "<auth_requested>|<auth_invalid_reason>"
evaluate_turn_authorization() {
    local audit_file="$1"
    local ctx_file="$2"
    local session_id="$3"
    local now_iso="$4"
    local turn_id="$5"

    local auth_requested="false"
    local auth_invalid_reason=""

    if [ -f "$audit_file" ] && audit_has_turn_auth_signal "$audit_file"; then
        auth_requested="true"
    fi

    if [ "$auth_requested" = "false" ] && [ -f "$ctx_file" ] && context_turn_auth_requested "$ctx_file"; then
        auth_requested="true"
    fi

    if [ "$auth_requested" = "false" ] && [ -f "$ctx_file" ]; then
        local subagent_delegated subagent_last_tool subagent_last_non_bookkeeping_tool
        local subagent_parent_turn_id subagent_chain_valid subagent_chain_claimed
        subagent_delegated="$(jq -r '.current_turn.subagent_delegated // false' "$ctx_file" 2> /dev/null || echo false)"
        if [ "$subagent_delegated" = "true" ]; then
            subagent_last_tool="$(jq -r '.last_tool.name // ""' "$ctx_file" 2> /dev/null || echo '')"
            subagent_last_non_bookkeeping_tool="$(jq -r '.current_turn.last_non_bookkeeping_tool // ""' "$ctx_file" 2> /dev/null || echo '')"
            subagent_parent_turn_id="$(jq -r '.current_turn.subturn.parent_turn_id // ""' "$ctx_file" 2> /dev/null || echo '')"
            subagent_chain_valid="false"
            subagent_chain_claimed="false"

            if [ "$subagent_last_tool" = "runSubagent" ] || [ "$subagent_last_tool" = "search_subagent" ] \
                || [ "$subagent_last_non_bookkeeping_tool" = "runSubagent" ] || [ "$subagent_last_non_bookkeeping_tool" = "search_subagent" ]; then
                subagent_chain_claimed="true"
            fi

            if [ -n "$turn_id" ] \
                && [ "$subagent_parent_turn_id" = "$turn_id" ] \
                && audit_has_subagent_start_since_prompt "$audit_file"; then
                subagent_chain_valid="true"
            fi

            if [ "$subagent_chain_claimed" = "true" ] \
                && [ "$subagent_chain_valid" = "true" ]; then
                auth_requested="true"
                log_auth_via_subagent_delegation_event "$audit_file" "$session_id" "$now_iso" "$turn_id"
            elif [ "$subagent_chain_claimed" = "true" ] \
                && [ "$subagent_chain_valid" != "true" ] \
                && [ -n "$turn_id" ]; then
                auth_invalid_reason="subagent_chain_invalid"
            fi
        fi
    fi

    if [ "$auth_requested" = "true" ] && [ -f "$ctx_file" ]; then
        local auth_last_tool_name auth_subagent_delegated auth_ask_api_error auth_last_response
        local auth_last_non_bookkeeping_tool_ctx auth_last_ask_template auth_last_ask_close_action
        local auth_last_ask_close_key_found auth_last_ask_has_template_f_option auth_template_f_pending
        local auth_session_close_key_validated auth_strict_key_mode auth_template_f_called_without_request
        local auth_todo_last_item_is_continuation auth_auto_audit_required auth_auto_audit_started
        local auth_todo_refresh_required
        local auth_required_docs_pending_count
        local auth_last_non_bookkeeping_tool_aud auth_last_non_bookkeeping_tool

        auth_last_tool_name="$(jq -r '.last_tool.name // ""' "$ctx_file" 2> /dev/null || echo '')"
        auth_subagent_delegated="$(jq -r '.current_turn.subagent_delegated // false' "$ctx_file" 2> /dev/null || echo false)"
        auth_ask_api_error="$(jq -r '.current_turn.askquestions_api_error // false' "$ctx_file" 2> /dev/null || echo false)"
        auth_last_response="$(jq -r '.current_turn.last_askquestions_response // ""' "$ctx_file" 2> /dev/null || echo '')"
        auth_last_non_bookkeeping_tool_ctx="$(jq -r '.current_turn.last_non_bookkeeping_tool // ""' "$ctx_file" 2> /dev/null || echo '')"
        auth_last_ask_template="$(jq -r '.current_turn.last_askquestions_template // ""' "$ctx_file" 2> /dev/null || echo '')"
        auth_last_ask_close_action="$(jq -r '.current_turn.last_askquestions_close_action // ""' "$ctx_file" 2> /dev/null || echo '')"
        auth_last_ask_close_key_found="$(jq -r '.current_turn.last_askquestions_close_key_found // false' "$ctx_file" 2> /dev/null || echo false)"
        auth_last_ask_has_template_f_option="$(jq -r '(.current_turn.last_askquestions_has_template_f_option | if . == null then true else . end)' "$ctx_file" 2> /dev/null || echo true)"
        auth_template_f_pending="$(jq -r '.session.template_f_request_pending // false' "$ctx_file" 2> /dev/null || echo false)"
        auth_session_close_key_validated="$(jq -r '.session.close_key_validated // false' "$ctx_file" 2> /dev/null || echo false)"
        auth_strict_key_mode="$(jq -r '(.session.strict_turn_close_requires_key | if . == null then true else . end)' "$ctx_file" 2> /dev/null || echo true)"
        auth_todo_last_item_is_continuation="$(jq -r '.current_turn.todo_last_item_is_askquestions_continuation // false' "$ctx_file" 2> /dev/null || echo false)"
        auth_todo_refresh_required="$(jq -r '.current_turn.todo_refresh_required // false' "$ctx_file" 2> /dev/null || echo false)"
        auth_auto_audit_required="$(jq -r '.current_turn.auto_audit_required // false' "$ctx_file" 2> /dev/null || echo false)"
        auth_auto_audit_started="$(jq -r '.current_turn.auto_audit_started // false' "$ctx_file" 2> /dev/null || echo false)"
        auth_required_docs_pending_count="$(jq -r '(.current_turn.required_docs_pending // []) | length' "$ctx_file" 2> /dev/null || echo 0)"
        auth_template_f_called_without_request="false"
        auth_last_non_bookkeeping_tool_aud=""
        auth_last_non_bookkeeping_tool=""

        auth_last_non_bookkeeping_tool_aud="$(last_non_bookkeeping_tool_since_prompt "$audit_file")"
        if [ -n "$auth_last_non_bookkeeping_tool_ctx" ]; then
            auth_last_non_bookkeeping_tool="$auth_last_non_bookkeeping_tool_ctx"
        else
            auth_last_non_bookkeeping_tool="$auth_last_non_bookkeeping_tool_aud"
        fi

        if [ -z "$auth_last_non_bookkeeping_tool" ] \
            && [ "$auth_last_tool_name" = "manage_todo_list" ] \
            && askquestions_has_user_answer "$auth_last_response"; then
            auth_last_non_bookkeeping_tool="vscode_askQuestions"
        fi

        if [ "$auth_last_ask_template" = "template_f" ] && [ "$auth_template_f_pending" != "true" ]; then
            auth_template_f_called_without_request="true"
        fi

        if [ "$auth_strict_key_mode" != "true" ] && [ "$auth_strict_key_mode" != "false" ]; then
            auth_strict_key_mode="true"
        fi

        if [ "$auth_strict_key_mode" = "true" ]; then
            auth_strict_key_mode="true"
        else
            auth_strict_key_mode="false"
        fi

        auth_invalid_reason="$(determine_turn_auth_invalid_reason \
            "$auth_last_tool_name" \
            "$auth_subagent_delegated" \
            "$auth_ask_api_error" \
            "$auth_last_response" \
            "$auth_last_non_bookkeeping_tool" \
            "$auth_last_ask_template" \
            "$auth_last_ask_close_action" \
            "$auth_last_ask_close_key_found" \
            "$auth_session_close_key_validated" \
            "$auth_strict_key_mode" \
            "$auth_last_ask_has_template_f_option" \
            "$auth_template_f_called_without_request" \
            "$auth_todo_last_item_is_continuation" \
            "$auth_auto_audit_required" \
            "$auth_auto_audit_started" \
            "$auth_todo_refresh_required")"

        if [ "${auth_required_docs_pending_count:-0}" -gt 0 ] 2> /dev/null; then
            auth_invalid_reason="required_docs_not_read"
        fi

        if [ -n "$auth_invalid_reason" ] && command -v policy_normalize_auth_invalid_reason > /dev/null 2>&1; then
            auth_invalid_reason="$(policy_normalize_auth_invalid_reason "$auth_invalid_reason")"
        fi

        if [ -n "$auth_invalid_reason" ]; then
            auth_requested="false"
            log_turn_auth_invalidated_event \
                "$audit_file" \
                "$session_id" \
                "$now_iso" \
                "$auth_invalid_reason" \
                "$auth_last_tool_name" \
                "$auth_last_non_bookkeeping_tool" \
                "$turn_id"
        fi
    fi

    if [ "$auth_requested" = "true" ] && [ ! -f "$ctx_file" ]; then
        auth_requested="false"
        auth_invalid_reason="strict_context_missing"
        log_turn_auth_invalidated_event \
            "$audit_file" \
            "$session_id" \
            "$now_iso" \
            "$auth_invalid_reason" \
            "(ctx_missing)" \
            "(ctx_missing)" \
            "$turn_id"
    fi

    printf '%s|%s\n' "$auth_requested" "$auth_invalid_reason"
}

# Avalia invalidação v9.1 e retorna reason vazio quando auth continua válida.
determine_turn_auth_invalid_reason() {
    local last_tool_name="$1"
    local subagent_delegated="$2"
    local ask_api_error="$3"
    local last_response_json="$4"
    local last_non_bookkeeping_tool="$5"
    local ask_template="$6"
    local ask_close_action="$7"
    local ask_close_key_found="$8"
    local session_close_key_validated="$9"
    local strict_turn_close_requires_key="${10:-true}"
    local ask_has_template_f_option="${11:-true}"
    local template_f_called_without_request="${12:-false}"
    local todo_last_item_is_continuation="${13:-false}"
    local auto_audit_required="${14:-false}"
    local auto_audit_started="${15:-false}"
    local todo_refresh_required="${16:-false}"

    if command -v policy_determine_turn_auth_invalid_reason > /dev/null 2>&1; then
        policy_determine_turn_auth_invalid_reason \
            "$last_tool_name" \
            "$subagent_delegated" \
            "$ask_api_error" \
            "$last_response_json" \
            "$last_non_bookkeeping_tool" \
            "$ask_template" \
            "$ask_close_action" \
            "$ask_close_key_found" \
            "$session_close_key_validated" \
            "$strict_turn_close_requires_key" \
            "$ask_has_template_f_option" \
            "$template_f_called_without_request" \
            "$todo_last_item_is_continuation" \
            "$auto_audit_required" \
            "$auto_audit_started" \
            "$todo_refresh_required"
        return 0
    fi

    local effective_last_tool_name="$last_tool_name"

    if [ "$strict_turn_close_requires_key" != "true" ] && is_immediate_subagent_delegation "$subagent_delegated" "$last_tool_name"; then
        printf '%s\n' ""
        return 0
    fi

    if [ "$ask_api_error" = "true" ]; then
        printf '%s\n' "askquestions_api_error"
        return 0
    fi

    if is_bookkeeping_after_askquestions "$last_tool_name" "$last_non_bookkeeping_tool"; then
        effective_last_tool_name="vscode_askQuestions"
    fi

    if [ "$effective_last_tool_name" != "vscode_askQuestions" ]; then
        printf '%s\n' "askquestions_not_last_tool"
        return 0
    fi

    if ! askquestions_has_user_answer "$last_response_json"; then
        printf '%s\n' "askquestions_skipped_or_empty"
        return 0
    fi

    if [ "$todo_last_item_is_continuation" != "true" ]; then
        printf '%s\n' "todo_last_item_not_continuation"
        return 0
    fi

    if [ "$todo_refresh_required" = "true" ]; then
        printf '%s\n' "askquestions_todo_refresh_pending"
        return 0
    fi

    if [ "$auto_audit_required" = "true" ] && [ "$auto_audit_started" != "true" ]; then
        printf '%s\n' "auto_audit_required_not_started"
        return 0
    fi

    # Governança de escalonamento: templates de continuidade devem permitir
    # escalar para Template F; chamar Template F sem solicitação prévia invalida.
    if [ "$ask_template" != "template_f" ] && [ "$ask_has_template_f_option" != "true" ]; then
        printf '%s\n' "askquestions_missing_template_f_option"
        return 0
    fi

    # Turn close padrão: askQuestions de continuidade (A/D/E) é válido para
    # encerrar o TURN. Template F é reservado para fechamento de SESSION.
    if [ "$ask_template" != "template_f" ]; then
        printf '%s\n' ""
        return 0
    fi

    if [ "$ask_template" = "template_f" ] && [ "$template_f_called_without_request" = "true" ]; then
        printf '%s\n' "template_f_called_without_prior_request"
        return 0
    fi

    # Se Template F foi usado, validar fluxo de key (encerramento de sessão).
    if [ "$ask_template" = "template_f" ]; then
        if [ "$ask_close_action" = "close_without_valid_key" ] \
            || { [ "$ask_close_action" = "close_with_key" ] && [ "$ask_close_key_found" != "true" ]; }; then
            printf '%s\n' "session_close_key_missing_or_invalid"
            return 0
        fi

        if [ "$ask_close_action" = "close_with_key" ] && [ "$session_close_key_validated" != "true" ]; then
            printf '%s\n' "session_close_validation_not_confirmed"
            return 0
        fi
    fi

    printf '%s\n' ""
}

# BUG-79 guard: bloqueia fluxo quando session.ended_at existe sem
# session.closure_authorized_at.
enforce_session_closure_authorization_guard() {
    local ctx_file="$1"
    local audit_file="$2"
    local state_dir="$3"
    local session_id="$4"
    local now_iso="$5"

    [ -f "$ctx_file" ] || return 0

    local session_ended_at closure_authorized_at
    session_ended_at="$(jq -r '.session.ended_at // ""' "$ctx_file" 2> /dev/null || echo '')"
    if [ -z "$session_ended_at" ]; then
        return 0
    fi

    closure_authorized_at="$(jq -r '.session.closure_authorized_at // ""' "$ctx_file" 2> /dev/null || echo '')"
    if [ -n "$closure_authorized_at" ]; then
        return 0
    fi

    echo "[ERROR] SESSION CLOSURE VIOLATION (BUG-79 Guard)" >&2
    echo "  Session.ended_at: $session_ended_at" >&2
    echo "  Closure_authorized_at: (empty/missing)" >&2
    echo "  Protocolo violado: encerramento SEM Template F + close_key validation" >&2
    echo "  Requerido: vscode_askQuestions Template F com resposta contendo close_key" >&2

    jq -cn \
        --arg sid "$session_id" \
        --arg ts "$now_iso" \
        --arg ended_at "$session_ended_at" \
        '{
            event:      "sessionClose_VIOLATION_unauthorized",
            session_id: $sid,
            timestamp:  $ts,
            session_ended_at: $ended_at,
            closure_authorized_at: null,
            bug:        "BUG-79",
            message:    "Tentativa de encerrar sessão sem autorização via vscode_askQuestions Template F"
        }' >> "$audit_file"

    jq -cn \
        --arg sid "$session_id" \
        --arg ts "$now_iso" \
        '{
            session_id:        $sid,
            violation_detected_at: $ts,
            violation_type:    "unauthorized_session_close",
            requires_investigation: true,
            bug_reference:     "BUG-79"
        }' > "$state_dir/SESSION_CLOSE_VIOLATION.flag"

    return 1
}

# Nível 3 (MANDATE): opcionalmente exige close_key_validated=true no Stop.
# Retornos:
#   0 => segue fluxo normal
#   10 => bloqueio emitido (caller deve encerrar com exit 0)
enforce_level3_close_key_mandate() {
    local ctx_file="$1"
    local audit_file="$2"
    local session_id="$3"
    local stop_hook_active="$4"
    local now_iso="$5"

    if [ "$stop_hook_active" = "true" ] || [ ! -f "$ctx_file" ] || [ ! -s "$ctx_file" ]; then
        return 0
    fi

    local n3_enforce_on_stop n3_close_validated n3_close_key n3_recovery_close_mode
    n3_enforce_on_stop="$(jq -r '.session.enforce_close_key_on_stop // false' "$ctx_file" 2> /dev/null || echo 'false')"
    n3_close_validated="$(jq -r '.session.close_key_validated // false' "$ctx_file" 2> /dev/null || echo 'false')"
    n3_close_key="$(jq -r '.session.close_key // "N/A"' "$ctx_file" 2> /dev/null || echo 'N/A')"
    n3_recovery_close_mode="$(jq -r '.recovery.close_mode // ""' "$ctx_file" 2> /dev/null || echo '')"

    local n3_allow_unsafe_close="false"
    if [ "$n3_recovery_close_mode" = "abrupt_no_key" ]; then
        local n3_recovery_acknowledged
        n3_recovery_acknowledged="$(jq -r '.recovery.recovery_acknowledged // false' "$ctx_file" 2> /dev/null || echo 'false')"
        if [ "$n3_recovery_acknowledged" = "true" ]; then
            n3_allow_unsafe_close="true"
        fi
    fi

    if [ "$n3_enforce_on_stop" = "true" ] && [ "$n3_close_validated" != "true" ] && [ "$n3_allow_unsafe_close" != "true" ]; then
        echo "[BLOCK] Agent-stop bloqueado: Nível 3 (MANDATE) — close_key_validated=false" >&2

        jq -cn \
            --arg event "agentStop_blocked_close_key_required" \
            --arg sid "$session_id" \
            --arg ts "$now_iso" \
            --arg key "$n3_close_key" \
            '{
                event:      $event,
                session_id: $sid,
                timestamp:  $ts,
                close_key:  $key,
                severity:   "CRITICAL",
                message:    "Agent-stop foi bloqueado (Nível 3) — Session close_key_validated=false. Agente deve invocar Template F."
            }' >> "$audit_file" 2> /dev/null || true

        local n3_block_reason n3_block_message
        n3_block_reason="Session closure authorization required"
        n3_block_message="🛑 AGENT-STOP BLOQUEADO (Nível 3 — MANDATE):

Sua execução foi bloqueada — você DEVE invocar vscode_askQuestions Template F (Session Close) ANTES de poder encerrar esta SESSION.

Protocolo:
  (1) Chame vscode_askQuestions com Template F
  (2) Template exibirá a close_key: ${n3_close_key}
  (3) Digite ${n3_close_key} no campo de resposta
  (4) post-tool-use.sh detectará a KEY e executará session-close.sh automaticamente
  (5) Sessão encerrará com segurança

Se NÃO quer encerrar: simplesmente não invoque Template F — continue trabalhando."

        emit_stop_block "$n3_block_reason" "$n3_block_message"
        return 10
    fi

    return 0
}

# Emite block para mismatch de session_id não saneado (v9.2).
emit_unresolved_session_mismatch_block() {
    local expected_sid="$1"
    local got_sid="$2"
    local mismatch_count="$3"
    local reason="Session ID mismatch unresolved"
    local message="🚫 TURN BLOQUEADO (v9.2): session_id mismatch ainda não saneado. expected=${expected_sid} got=${got_sid} (count=${mismatch_count}). Não é seguro encerrar o TURN com contexto inconsistente."
    emit_stop_block "$reason" "$message" "unresolved_session_mismatch"
}

# Loga reblock quando agente não cumpre autorização após stop_hook_active=true.
log_reblocked_no_comply_event() {
    local audit_file="$1"
    local sid="$2"
    local ts="$3"
    local turn_id="$4"
    local block_count="$5"

    jq -cn \
        --arg event "agentStop_reblocked_no_comply" \
        --arg sid "$sid" \
        --arg ts "$ts" \
        --arg turn_id "$turn_id" \
        --argjson block_count "$block_count" \
        '{event: $event, session_id: $sid, timestamp: $ts, turn_id: (if $turn_id == "" then null else $turn_id end), block_count: $block_count, message: "Agente não cumpriu autorização após block — reblock aplicado para impedir fechamento ilegítimo"}' \
        >> "$audit_file"
}

# Emite block padrão de reblock pós stop_hook_active.
emit_reblock_stop_block() {
    local reason="${1:-Turno ainda sem autorização válida. Encerramento legítimo exige chamada final de vscode_askQuestions com resposta válida do usuário.}"
    local system_message="${2:-🚫 Encerramento ilegítimo bloqueado novamente: finalize com vscode_askQuestions. Use Template F somente se o objetivo for encerrar a SESSION.}"
    local reason_code="${3:-reblock_no_authorization}"
    local decision_trace_json="${4:-}"
    emit_stop_block "$reason" "$system_message" "$reason_code" "$decision_trace_json"
}

# Loga conformidade após unblock (stop_hook_active=true e auth válida).
log_unblocked_complied_event() {
    local audit_file="$1"
    local sid="$2"
    local ts="$3"
    local turn_id="$4"

    jq -cn \
        --arg event "agentStop_unblocked_complied" \
        --arg sid "$sid" \
        --arg ts "$ts" \
        --arg turn_id "$turn_id" \
        '{event: $event, session_id: $sid, timestamp: $ts, turn_id: (if $turn_id == "" then null else $turn_id end), message: "Agente chamou vscode_askQuestions após block — TURNO AUTORIZADO"}' \
        >> "$audit_file"
}

# Monta systemMessage contextual canônico do agent-stop.
build_context_system_message() {
    local section_turn="$1"
    local turn_number="$2"
    local section_name="$3"
    local section_number="$4"
    local alta="$5"
    local media="$6"
    local backlog="$7"
    local next_task="$8"
    local push_msg="$9"
    local violation_msg="${10}"
    local session_close_msg="${11}"

    printf '%s' "━━━ TURN ${section_turn}/${turn_number} | SECTION: \"${section_name}\" (#${section_number}) ━━━
    Backlog: ${alta} alta | ${media} média | ${backlog} backlog | Próxima: ${next_task}
─────────────────────────────────────────────────────────────────────────────
        TURN encerra → SOMENTE com vscode_askQuestions (autorização obrigatória)
    SECTION muda  → autônomo: bash start-section.sh \"nome\"
        SESSION fecha → SOMENTE: Template F + KEY digitada + execução automática de session-close.sh
─────────────────────────────────────────────────────────────────────────────${push_msg}${violation_msg}${session_close_msg}"
}

# Monta nudge contextual completo do agent-stop quando aplicável.
# Retorna string vazia quando não há necessidade de emitir systemMessage.
build_context_nudge_message() {
    local ctx_file="$1"
    local state_dir="$2"
    local auth_requested="$3"

    [ -f "$ctx_file" ] || {
        printf '%s\n' ""
        return 0
    }

    local push_pending turns_since_ask consecutive_unauth
    push_pending="$(safe_jq_read "$ctx_file" '.session_stats.pending_section_after_push' 'false')"
    turns_since_ask="$(safe_jq_read_int "$ctx_file" '.session_stats.turns_since_askQuestions' 0)"
    consecutive_unauth="$(safe_jq_read_int "$ctx_file" '.compliance.consecutive_unauthorized' 0)"

    if ! should_emit_context_nudge "$push_pending" "$turns_since_ask" "$consecutive_unauth" "$auth_requested"; then
        printf '%s\n' ""
        return 0
    fi

    local section section_num turn_num section_turn push_count
    section="$(safe_jq_read "$ctx_file" '.current_section.name' '(nenhuma)')"
    section_num="$(safe_jq_read_int "$ctx_file" '.current_section.section_number' 1)"
    turn_num="$(safe_jq_read_int "$ctx_file" '.current_turn.number' 1)"
    section_turn="$(safe_jq_read_int "$ctx_file" '.current_turn.section_turn' 1)"
    push_count="$(safe_jq_read_int "$ctx_file" '.session_stats.push_count' 0)"

    local tasks_file tasks_summary alta media backlog next_task
    tasks_file="$state_dir/pending-tasks.md"
    tasks_summary="$(extract_pending_tasks_summary "$tasks_file")"
    alta="${tasks_summary%%|*}"
    tasks_summary="${tasks_summary#*|}"
    media="${tasks_summary%%|*}"
    tasks_summary="${tasks_summary#*|}"
    backlog="${tasks_summary%%|*}"
    next_task="${tasks_summary#*|}"

    local push_msg violation_msg close_msg close_key close_validated
    push_msg="$(build_push_pending_message "$push_pending" "$push_count")"
    violation_msg="$(build_violation_message "$auth_requested" "$consecutive_unauth" "$turns_since_ask")"
    close_key="$(safe_jq_read "$ctx_file" '.session.close_key' '')"
    close_validated="$(safe_jq_read "$ctx_file" '.session.close_key_validated' 'false')"
    close_msg="$(build_session_close_nudge_message "$close_validated" "$close_key")"

    build_context_system_message \
        "$section_turn" \
        "$turn_num" \
        "$section" \
        "$section_num" \
        "$alta" \
        "$media" \
        "$backlog" \
        "$next_task" \
        "$push_msg" \
        "$violation_msg" \
        "$close_msg"
}
