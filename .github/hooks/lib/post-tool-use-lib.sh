#!/usr/bin/env bash
# post-tool-use-lib.sh — Lógica do PostToolUse hook
# Responsabilidades:
#   - Detecta resposta de vscode_askQuestions → seta ask_questions_called=true
#   - Detecta close_key na resposta → seta pending_session_close=true
#   - Fecha current_subturn
# Sourceado por scripts/post-tool-use.sh

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
# shellcheck source=hook-payload-api.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hook-payload-api.sh"

# ---------------------------------------------------------------------------
# main — entrada principal para o PostToolUse hook
# $1 = conteúdo do stdin (JSON completo enviado pelo VS Code)
# ---------------------------------------------------------------------------
post_tool_use_main() {
    local input="$1"
    maybe_capture_debug "$input"

    # Popula HOOK_* vars a partir do payload (tolera parse parcial)
    hook_api_parse "$input" || true

    export SESSION_ID="${HOOK_SESSION_ID:-unknown}"

    local turn_num=0
    if state_exists; then
        turn_num=$(read_field ".current_turn.number")
        turn_num="${turn_num:-0}"
    fi

    if state_exists; then
        # GAP-07: sempre fechar o subturn, independente do tipo de ferramenta
        # GAP-14: registra ended_at além de response_at
        local _now_ts
        _now_ts="$(now_iso)"
        update_nested_state "current_subturn.response_at" "$_now_ts"
        update_nested_state "current_subturn.ended_at" "$_now_ts"

        # UP-04: calcula e acumula duração do subturn em ms (se started_at disponível)
        local _st_ms _et_ms _dur_ms _prev_total _prev_count _new_total
        _st_ms=$(read_field '.current_subturn.started_at' 2> /dev/null)
        if [ -n "$_st_ms" ] && [ "$_st_ms" != "null" ]; then
            # usa _iso_to_epoch (portável, UP-07) + transforma em ms via multiplicação
            _st_ms_epoch=$(_iso_to_epoch "$_st_ms" 2> /dev/null || printf '0')
            _et_ms_epoch=$(_iso_to_epoch "$_now_ts" 2> /dev/null || printf '0')
            _dur_ms=$(((_et_ms_epoch - _st_ms_epoch) * 1000))
            if [ "$_dur_ms" -ge 0 ] 2> /dev/null; then
                _prev_total=$(read_field '.session_stats.subturn_duration_total_ms' 2> /dev/null || printf '0')
                _prev_count=$(read_field '.session_stats.subturn_total' 2> /dev/null || printf '1')
                _prev_total="${_prev_total:-0}"
                _prev_count="${_prev_count:-1}"
                _new_total=$((_prev_total + _dur_ms))
                update_nested_state "session_stats.subturn_duration_total_ms" "$_new_total"
                update_nested_state "current_subturn.duration_ms" "$_dur_ms"
            fi
        fi

        # NEW-M: sincroniza pending-tasks.md quando manage_todo_list é chamado
        hook_sync_pending_tasks 2> /dev/null || true

        # --- UP-H2: injetar reminder após git push/commit (operações de fechamento) ---
        # Detecta run_in_terminal com padrões de ciclo de trabalho encerrado e
        # injeta additionalContext lembrando o LLM de chamar vscode_askQuestions.
        if [ "${HOOK_TOOL_NAME:-}" = "run_in_terminal" ]; then
            local _h2_aq _h2_input
            _h2_aq=$(read_field '.current_turn.ask_questions_called' 2> /dev/null || printf 'false')
            _h2_input="${HOOK_TOOL_INPUT:-}"
            if [ "${_h2_aq:-false}" != "true" ]; then
                if printf '%s' "$_h2_input" | grep -qiE '(git\s+push|git\s+commit|git\s+push\s+origin)'; then
                    hook_log_audit "postToolUse_git_closure_reminder" \
                        "tool" "run_in_terminal" "pattern" "git_push_or_commit"
                    hook_out_post_context \
                        "⚠️ PROTOCOLO TODO v9.0 — AÇÃO OBRIGATÓRIA AGORA: Você executou git push/commit. Antes de chamar task_complete ou encerrar o turno, DEVE chamar vscode_askQuestions. Use Template A (tarefa concluída) ou Template G (pré-autorização). AVISO: task_complete sem vscode_askQuestions está bloqueado pelo PreToolUse hook."
                    exit 0
                fi
            fi
        fi

        if hook_is_ask_questions; then
            # UP-11: registra posição (tools_count) em que ask_questions foi chamado neste turno
            local _turn_tool_pos
            _turn_tool_pos=$(read_field '.current_turn.tools_count' 2> /dev/null || printf '0')
            update_nested_state "current_turn.ask_questions_turn_pos" "${_turn_tool_pos:-0}"

            # Seta ask_questions_called = true (pós-resposta, não no PreToolUse)
            update_nested_state "current_turn.ask_questions_called" "true"

            # UP-H1b: reseta contador de tools chamadas após este vscode_askQuestions
            # Permite detectar se task_complete está sendo chamado sem ser o próximo ato
            update_nested_state "current_turn.tools_after_ask_questions" "0"
            update_nested_state "current_turn.last_tool_after_ask_questions" ""

            hook_log_audit "subturnEnd" "turn" "$turn_num"
            hook_log_audit "askQuestions_responded" "turn" "$turn_num" "turn_pos" "${_turn_tool_pos:-0}"

            # --- Detecta close_key na resposta (via API — elimina parse manual) ---
            if hook_close_key_in_response; then
                hook_log_audit "sessionCloseAuthorized" "turn" "$turn_num"
                update_state_bool "pending_session_close" "true"
            fi
        else
            # Ferramenta regular: apenas fecha o subturn
            hook_log_audit "subturnEnd" "turn" "$turn_num"

            # UP-H1b: incrementa contador de tools chamadas após último vscode_askQuestions
            # Ferramentas bookkeeping (manage_todo_list, task_complete) são isentas —
            # são passos do protocolo e não indicam "trabalho novo" após askQ.
            local _h1b_exempt=false
            case "${HOOK_TOOL_NAME:-}" in
                manage_todo_list | task_complete) _h1b_exempt=true ;;
            esac
            if [ "${_h1b_exempt}" = "false" ]; then
                local _h1b_taaq
                _h1b_taaq=$(read_field '.current_turn.tools_after_ask_questions' 2> /dev/null || printf '0')
                _h1b_taaq=$((_h1b_taaq + 1))
                update_nested_state "current_turn.tools_after_ask_questions" "${_h1b_taaq}"
                update_nested_state "current_turn.last_tool_after_ask_questions" "${HOOK_TOOL_NAME:-unknown}"
            fi
        fi
    fi

    exit 0
}

main() { post_tool_use_main "$1"; }
