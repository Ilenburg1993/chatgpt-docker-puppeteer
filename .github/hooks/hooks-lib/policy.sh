#!/bin/bash
# hooks-lib/policy.sh — Núcleo canônico de policy de autorização/continuidade.
#
# Este módulo concentra funções de classificação/validação usadas por:
# - pre-tool-use.sh
# - post-tool-use.sh
# - agent-stop-lib.sh
#
# Objetivo: reduzir drift semântico entre hooks sem alterar contratos externos.

# Verifica se a resposta de vscode_askQuestions contém resposta válida do usuário.
policy_askquestions_has_user_answer() {
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

# Informa se a delegação de subagente é imediata no último tool do turno.
policy_is_immediate_subagent_delegation() {
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
policy_is_bookkeeping_after_askquestions() {
    local last_tool_name="${1:-}"
    local last_non_bookkeeping_tool="${2:-}"
    [ "$last_tool_name" = "manage_todo_list" ] && [ "$last_non_bookkeeping_tool" = "vscode_askQuestions" ]
}

# Normaliza reason codes legados para o conjunto canônico atual.
policy_normalize_auth_invalid_reason() {
    local reason="${1:-}"
    case "$reason" in
        turn_close_requires_template_f)
            printf '%s\n' "non_template_f_continuation_mandatory"
            ;;
        turn_close_key_missing_or_invalid)
            printf '%s\n' "session_close_key_missing_or_invalid"
            ;;
        *)
            printf '%s\n' "$reason"
            ;;
    esac
}

# Detecta se o payload do askQuestions corresponde ao Template F.
policy_input_is_template_f() {
    local input_json="${1:-}"
    [ -n "$input_json" ] || return 1
    printf '%s\n' "$input_json" | jq -e '
        [
            (.tool_input.questions? // [])[]?
            | ((.header // "") + " " + (.question // ""))
        ]
        | any(test("template f|encerrar session|encerrar sessão|session close|close key"; "i"))
    ' > /dev/null 2>&1
}

# Detecta se o payload do askQuestions expõe opção de escalonamento para Template F.
policy_input_has_template_f_option() {
    local input_json="${1:-}"
    [ -n "$input_json" ] || return 1

    if policy_input_is_template_f "$input_json"; then
        return 0
    fi

    printf '%s\n' "$input_json" | jq -e '
        [
            (.tool_input.questions? // [])[]?
            | (.options? // [])[]?
            | ((.label // "") + " " + (.description // ""))
        ]
        | any(test("template f|encerrar sess(ã|a)o|session close|close key|escalar"; "i"))
    ' > /dev/null 2>&1
}

# Detecta se a resposta do usuário solicitou escalonamento para Template F.
policy_response_requests_template_f() {
    local response_json="${1:-}"
    [ -n "$response_json" ] || return 1
    printf '%s\n' "$response_json" | jq -e '
        [
            (.answers? // {})
            | to_entries[]?
            | .value
            | if type == "object" then
                    (([.freeText?] + (.selected? // [])))
                elif type == "string" then
                    [.]
                else
                    []
                end
            | .[]
            | select(type == "string")
        ]
        | any(test("template f|session close|encerrar sess(ã|a)o|escalar"; "i"))
    ' > /dev/null 2>&1
}

# Verifica se a resposta contém a close_key em selected/freeText (ou fallback legado).
policy_response_contains_close_key() {
    local response_json="${1:-}"
    local close_key="${2:-}"
    [ -n "$response_json" ] || return 1
    [ -n "$close_key" ] || return 1

    if printf '%s\n' "$response_json" | jq -e --arg key "$close_key" '
        [
            (.answers? // {})
            | to_entries[]?
            | .value
            | if type == "object" then
                    (([.freeText?] + (.selected? // [])))
                elif type == "string" then
                    [.]
                else
                    []
                end
            | .[]
            | select(type == "string")
        ]
        | any(. == $key)
    ' > /dev/null 2>&1; then
        return 0
    fi

    [ "$(printf '%s' "$response_json" | tr -d '\r\n')" = "$close_key" ]
}

# Detecta intenção explícita de encerramento em selected options.
policy_response_has_close_intent() {
    local response_json="${1:-}"
    [ -n "$response_json" ] || return 1
    printf '%s\n' "$response_json" | jq -e '
        [
            (.answers? // {})
            | to_entries[]?
            | .value
            | if type == "object" then
                    ((.selected? // []))
                elif type == "string" then
                    [.]
                else
                    []
                end
            | .[]
            | select(type == "string")
        ]
        | any(test("encerrar|fechar|close"; "i"))
    ' > /dev/null 2>&1
}

# Detecta intenção explícita de continuar/cancelar em selected options.
policy_response_has_cancel_intent() {
    local response_json="${1:-}"
    [ -n "$response_json" ] || return 1
    printf '%s\n' "$response_json" | jq -e '
        [
            (.answers? // {})
            | to_entries[]?
            | .value
            | if type == "object" then
                    ((.selected? // []))
                elif type == "string" then
                    [.]
                else
                    []
                end
            | .[]
            | select(type == "string")
        ]
        | any(test("cancelar|continuar|manter"; "i"))
    ' > /dev/null 2>&1
}

# Detecta presença de freeText não vazio em respostas de askQuestions.
policy_response_has_free_text() {
    local response_json="${1:-}"
    [ -n "$response_json" ] || return 1
    printf '%s\n' "$response_json" | jq -e '
        [
            (.answers? // {})
            | to_entries[]?
            | .value
            | .freeText? // empty
            | select(type == "string" and length > 0)
        ]
        | length > 0
    ' > /dev/null 2>&1
}

# Avalia invalidação v9.1 e retorna reason vazio quando auth continua válida.
policy_determine_turn_auth_invalid_reason() {
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
    local effective_last_tool_name="$last_tool_name"

    ask_template="$(policy_normalize_auth_invalid_reason "$ask_template")"

    if [ "$strict_turn_close_requires_key" != "true" ] \
        && policy_is_immediate_subagent_delegation "$subagent_delegated" "$last_tool_name"; then
        printf '%s\n' ""
        return 0
    fi

    if [ "$ask_api_error" = "true" ]; then
        printf '%s\n' "askquestions_api_error"
        return 0
    fi

    if policy_is_bookkeeping_after_askquestions "$last_tool_name" "$last_non_bookkeeping_tool"; then
        effective_last_tool_name="vscode_askQuestions"
    fi

    if [ "$effective_last_tool_name" != "vscode_askQuestions" ]; then
        printf '%s\n' "askquestions_not_last_tool"
        return 0
    fi

    if ! policy_askquestions_has_user_answer "$last_response_json"; then
        printf '%s\n' "askquestions_skipped_or_empty"
        return 0
    fi

    if [ "$todo_last_item_is_continuation" != "true" ]; then
        printf '%s\n' "todo_last_item_not_continuation"
        return 0
    fi

    if [ "$auto_audit_required" = "true" ] && [ "$auto_audit_started" != "true" ]; then
        printf '%s\n' "auto_audit_required_not_started"
        return 0
    fi

    if [ "$ask_template" != "template_f" ] && [ "$ask_has_template_f_option" != "true" ]; then
        printf '%s\n' "askquestions_missing_template_f_option"
        return 0
    fi

    if [ "$ask_template" != "template_f" ]; then
        printf '%s\n' "non_template_f_continuation_mandatory"
        return 0
    fi

    if [ "$ask_template" = "template_f" ] && [ "$template_f_called_without_request" = "true" ]; then
        printf '%s\n' "template_f_called_without_prior_request"
        return 0
    fi

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
