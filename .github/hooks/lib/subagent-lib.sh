#!/usr/bin/env bash
# subagent-lib.sh — Lógica compartilhada para SubagentStart e SubagentStop hooks
#
# Responsabilidades:
#   SubagentStart:
#     1. Registrar início de execução de subagente no audit.jsonl
#     2. Incrementar contador de subagentes ativos
#   SubagentStop:
#     1. Registrar término do subagente
#     2. Decrementar contador de subagentes ativos
#     3. (Futuro) Verificar se subagente violou protocolo — DESATIVADO por ora
#
# Sourceado por scripts/subagent-start.sh e scripts/subagent-stop.sh
# O caller deve definir SUBAGENT_EVENT="start"|"stop" antes de chamar main()

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
# shellcheck source=hook-payload-api.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hook-payload-api.sh"

export_lang_utf8

# ---------------------------------------------------------------------------
# Contadores de subagentes na sessão
# ---------------------------------------------------------------------------

# Incrementa subagents_active e subagents_total no state
# Retorna o novo valor de subagents_active
subagent_start_counters() {
    # Garante que os campos existem (cria com 0 se ausente)
    local current_active
    current_active=$(read_field ".session_stats.subagents_active")
    [ -z "$current_active" ] || [ "$current_active" = "null" ] && current_active=0

    local new_active
    new_active=$((current_active + 1))
    update_nested_state "session_stats.subagents_active" "$new_active"

    # Total acumulado (nunca decrementa)
    local total
    total=$(read_field ".session_stats.subagents_total")
    [ -z "$total" ] || [ "$total" = "null" ] && total=0
    update_nested_state "session_stats.subagents_total" "$((total + 1))"

    printf '%d' "$new_active"
}

# Decrementa subagents_active (floor 0)
# Retorna o novo valor de subagents_active
subagent_stop_counters() {
    local current_active
    current_active=$(read_field ".session_stats.subagents_active")
    [ -z "$current_active" ] || [ "$current_active" = "null" ] && current_active=0

    local new_active
    new_active=$((current_active > 0 ? current_active - 1 : 0))
    update_nested_state "session_stats.subagents_active" "$new_active"

    printf '%d' "$new_active"
}

# ---------------------------------------------------------------------------
# Extração de metadados do subagente
# ---------------------------------------------------------------------------

# Extrai informações de identificação do subagente a partir do payload
# $1 = input JSON
extract_subagent_meta() {
    local input="$1"
    # Campos oficiais confirmados (doc VS Code mar/2026): agent_id, agent_type
    # Fallbacks defensivos para compatibilidade com variações de implementação
    SUBAGENT_ID=$(jq_field "$input" ".agent_id // .subagentId // .id // \"unknown\"")
    SUBAGENT_TYPE=$(jq_field "$input" ".agent_type // .subagentType // .type // \"unknown\"")
    SUBAGENT_PROMPT=$(jq_field "$input" ".prompt // .description // \"\"" | head -c80)
    export SUBAGENT_ID SUBAGENT_TYPE SUBAGENT_PROMPT
}

# ---------------------------------------------------------------------------
# SubagentStart
# ---------------------------------------------------------------------------
subagent_start_main() {
    local input="$1"
    maybe_capture_debug "$input"
    extract_subagent_meta "$input"
    hook_api_parse "$input" # popula HOOK_SESSION_ID

    [ -z "${SESSION_ID:-}" ] && export SESSION_ID="${HOOK_SESSION_ID:-unknown}"

    if ! state_exists; then
        exit 0 # Sem state → não há nada a rastrear
    fi

    local turn_num
    turn_num=$(read_field ".current_turn.number")
    local active_count
    active_count=$(subagent_start_counters)

    log_audit "subagentStart" \
        "subagent_id" "${SUBAGENT_ID:-unknown}" \
        "subagent_type" "${SUBAGENT_TYPE:-unknown}" \
        "turn" "${turn_num:-0}" \
        "active_count" "${active_count:-1}"

    exit 0
}

# ---------------------------------------------------------------------------
# SubagentStop
# ---------------------------------------------------------------------------
subagent_stop_main() {
    local input="$1"
    maybe_capture_debug "$input"
    extract_subagent_meta "$input"
    hook_api_parse "$input" # popula HOOK_SESSION_ID

    [ -z "${SESSION_ID:-}" ] && export SESSION_ID="${HOOK_SESSION_ID:-unknown}"

    if ! state_exists; then
        exit 0
    fi

    local turn_num
    turn_num=$(read_field ".current_turn.number")
    local active_count
    active_count=$(subagent_stop_counters)

    log_audit "subagentStop" \
        "subagent_id" "${SUBAGENT_ID:-unknown}" \
        "subagent_type" "${SUBAGENT_TYPE:-unknown}" \
        "turn" "${turn_num:-0}" \
        "active_count" "${active_count:-0}"

    # NOTE: SubagentStop NÃO emite block — enforcement desativado por ora.
    # Futuro: verificar se o subagente seguiu protocolo antes de permitir retorno.

    exit 0
}

# O script wrapper define SUBAGENT_EVENT antes de chamar main()
main() {
    case "${SUBAGENT_EVENT:-start}" in
        start) subagent_start_main "$1" ;;
        stop) subagent_stop_main "$1" ;;
        *) subagent_start_main "$1" ;;
    esac
}
