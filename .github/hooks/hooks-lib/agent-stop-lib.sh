#!/bin/bash
# hooks-lib/agent-stop-lib.sh — Helpers estruturais do agent-stop.sh
#
# Objetivo: concentrar utilitários de bloqueio/validação do Stop hook em um
# módulo reutilizável e mais testável.

# Emite payload de bloqueio canônico para Stop.
# Mantém campos legados top-level (decision/decisionReason) por compatibilidade.
emit_stop_block() {
    local reason="$1"
    local system_message="$2"
    jq -cn \
        --arg reason "$reason" \
        --arg system_message "$system_message" \
        '{
            decision: "block",
            decisionReason: $reason,
            hookSpecificOutput: {
                hookEventName: "Stop",
                decision: "block",
                reason: $reason
            },
            systemMessage: $system_message
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

# Informa se a delegação de subagente é imediata no último tool do turno.
is_immediate_subagent_delegation() {
    local delegated="${1:-false}"
    local last_tool_name="${2:-}"
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
    local reason=""
    local system_message=""

    if [ "$todo_created" != "true" ]; then
        reason="🚨 DUPLA VIOLAÇÃO DO PROTOCOLO v9.0: (1) manage_todo_list NÃO foi chamado neste turno — toda resposta DEVE começar com manage_todo_list criando/atualizando a lista de tarefas. (2) vscode_askQuestions NÃO foi chamado — todo turno DEVE terminar com vscode_askQuestions. AÇÕES OBRIGATÓRIAS NESTA ORDEM: chame PRIMEIRO manage_todo_list (criar TODOs com último item = 'Chamar vscode_askQuestions'), depois execute as tarefas, e ao FINAL chame vscode_askQuestions (Template A ou D).${session_hint}"
        system_message="🚨 DUPLA VIOLAÇÃO (v9.0): (1) manage_todo_list NÃO chamado. (2) vscode_askQuestions NÃO chamado. Protocolo obrigatório: COMECE com manage_todo_list → execute tarefas → TERMINE com vscode_askQuestions (Template A ou D)."
    elif [ "$auth_invalid_reason" = "askquestions_not_last_tool" ]; then
        reason="Protocolo v9.1: vscode_askQuestions até foi chamado, porém não ficou como último passo válido do TURN. Regra: último passo deve ser vscode_askQuestions; exceção única permitida é manage_todo_list imediatamente após askQuestions para fechamento de checklist.${session_hint}"
        system_message="🚫 TURN BLOQUEADO (v9.1): sequência final inválida. Refaça vscode_askQuestions como último passo válido (Template A ou D)."
    elif [ "$auth_invalid_reason" = "askquestions_api_error" ]; then
        reason="Protocolo v9.1: a chamada de vscode_askQuestions falhou na API (sem choices), então o turno não está autorizado. Repita vscode_askQuestions e finalize somente após resposta válida do usuário.${session_hint}"
        system_message="🚫 TURN BLOQUEADO (v9.1): falha de API em vscode_askQuestions. Refaça a chamada e finalize com resposta válida."
    elif [ "$auth_invalid_reason" = "askquestions_skipped_or_empty" ]; then
        reason="Protocolo v9.1: vscode_askQuestions foi chamado, mas não houve resposta válida do usuário (skip/vazio). O TURN só pode encerrar com autorização explícita do usuário.${session_hint}"
        system_message="🚫 TURN BLOQUEADO (v9.1): resposta de autorização ausente/inválida. Refaça vscode_askQuestions e aguarde resposta válida."
    else
        reason="Protocolo v9.0: este TURN encerrou sem chamar vscode_askQuestions. manage_todo_list foi chamado (correto), mas o último TODO (vscode_askQuestions) foi pulado. Ação obrigatória AGORA: chame vscode_askQuestions. Use Template A (tarefa concluída) ou Template D (checkpoint). vscode_askQuestions é o canal primário de comunicação — texto plano no chatbox NÃO é suficiente.${session_hint}"
        system_message="🚨 TURN BLOQUEADO (v9.0): manage_todo_list foi chamado (✓) mas vscode_askQuestions NÃO foi chamado. Chame agora (Template A ou D) antes de encerrar."
    fi

    printf '%s|%s\n' "$reason" "$system_message"
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

# Loga evento de bloqueio principal do Stop (v9.0).
log_agent_stop_blocked_event() {
    local audit_file="$1"
    local sid="$2"
    local ts="$3"
    local turn_id="$4"
    local consecutive_unauthorized="$5"
    local todo_created="$6"
    local block_count="$7"

    jq -cn \
        --arg event "agentStop_blocked" \
        --arg sid "$sid" \
        --arg ts "$ts" \
        --arg turn_id "$turn_id" \
        --argjson consec "$consecutive_unauthorized" \
        --argjson todo "$todo_created" \
        --argjson block_count "$block_count" \
        '{
            event:      $event,
            session_id: $sid,
            timestamp:  $ts,
            turn_id:    (if $turn_id == "" then null else $turn_id end),
            consecutive_unauthorized: $consec,
            todo_created: $todo,
            block_count: $block_count,
            message:    "TURN bloqueado por hardening v9.0: vscode_askQuestions não chamado"
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

# Estratégia 1: detecta sinal de autorização no audit após último userPromptSubmitted.
audit_has_turn_auth_signal() {
    local audit_file="$1"
    [ -f "$audit_file" ] || return 1

    local last_prompt_line total_lines lines_since_prompt
    last_prompt_line="$(awk '/"userPromptSubmitted"/{last=NR} END{print last+0}' "$audit_file" 2> /dev/null || echo 0)"
    total_lines="$(wc -l < "$audit_file" 2> /dev/null || echo 0)"

    if [ "$last_prompt_line" -gt 0 ] && [ "$total_lines" -gt "$last_prompt_line" ]; then
        lines_since_prompt=$((total_lines - last_prompt_line))
        if [ "$lines_since_prompt" -gt 0 ] && tail -n "$lines_since_prompt" "$audit_file" \
            | jq -re 'select(.tool_name == "vscode_askQuestions" or .event == "subagentStart")' > /dev/null 2>&1; then
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

# Avalia invalidação v9.1 e retorna reason vazio quando auth continua válida.
determine_turn_auth_invalid_reason() {
    local last_tool_name="$1"
    local subagent_delegated="$2"
    local ask_api_error="$3"
    local last_response_json="$4"
    local last_non_bookkeeping_tool="$5"

    if is_immediate_subagent_delegation "$subagent_delegated" "$last_tool_name"; then
        printf '%s\n' ""
        return 0
    fi

    if [ "$ask_api_error" = "true" ]; then
        printf '%s\n' "askquestions_api_error"
        return 0
    fi

    if is_bookkeeping_after_askquestions "$last_tool_name" "$last_non_bookkeeping_tool"; then
        printf '%s\n' ""
        return 0
    fi

    if [ "$last_tool_name" != "vscode_askQuestions" ]; then
        printf '%s\n' "askquestions_not_last_tool"
        return 0
    fi

    if ! askquestions_has_user_answer "$last_response_json"; then
        printf '%s\n' "askquestions_skipped_or_empty"
        return 0
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
    local now_iso="$6"

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
    emit_stop_block "$reason" "$message"
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
    emit_stop_block \
        "Turno ainda sem autorização válida. É obrigatório chamar vscode_askQuestions antes de encerrar." \
        "🚫 Encerramento ilegítimo bloqueado novamente: chame vscode_askQuestions agora para autorizar o fim do TURN."
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
