#!/usr/bin/env bash
# subagent-lib.sh — Lógica compartilhada para SubagentStart e SubagentStop hooks
#
# Responsabilidades:
#   SubagentStart:
#     1. Verificar budget e depth limit (UP-SUBAGENT-U9A)
#     2. Registrar início de execução de subagente no audit.jsonl
#     3. Incrementar contador de subagentes ativos
#     4. Injetar contexto enriquecido por agent_type (UP-CONTEXT-RICH)
#   SubagentStop:
#     1. Registrar término do subagente
#     2. Verificar compliance do subagente (UP-COMPLIANCE)
#     3. Decrementar contador de subagentes ativos
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
# Também incrementa current_turn.subagents_started (UP-U: campo antes nunca populado)
# Retorna o novo valor de subagents_active
# NEW-I: refatorado para usar increment_field (atômico, consistente com common.sh)
subagent_start_counters() {
    local new_active
    new_active=$(increment_field '.session_stats.subagents_active')
    increment_field '.session_stats.subagents_total' > /dev/null
    # UP-U: incrementa contador de subagentes por turno (alimenta hook_subagent_count_turn)
    increment_field '.current_turn.subagents_started' > /dev/null 2>&1 || true
    printf '%d' "${new_active:-1}"
}

# Decrementa subagents_active (floor 0)
# Retorna o novo valor de subagents_active
# NEW-I: refatorado para usar decrement_field_floor0 (atômico, consistente com common.sh)
subagent_stop_counters() {
    local new_active
    new_active=$(decrement_field_floor0 '.session_stats.subagents_active')
    printf '%d' "${new_active:-0}"
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
    SUBAGENT_PROMPT=$(jq_field "$input" ".prompt // .description // \"\"" | cut -c1-80) # GAP-12: cut preserva fronteiras UTF-8
    export SUBAGENT_ID SUBAGENT_TYPE SUBAGENT_PROMPT
}

# ---------------------------------------------------------------------------
# UP-CONTEXT-RICH (U9-B): contexto enriquecido por agent_type no SubagentStart
# ---------------------------------------------------------------------------

# Monta contexto de instruções específico para o agent_type
# Retorna string para ser passada a hook_out_subagent_start_context
# $1 = session_id, $2 = turn_num, $3 = depth, $4 = close_key
_subagent_build_context() {
    local _session_id="$1" _turn_num="$2" _depth="$3" _close_key="$4"
    local _base _type_rules _limit_remaining

    _limit_remaining=$(hook_subagent_depth_remaining 2> /dev/null || printf '%d' "$((${HOOK_SUBAGENT_DEPTH_LIMIT:-3} - _depth))")

    _base="SESSÃO=${_session_id:-?} TURNO=${_turn_num:-0} PROFUNDIDADE=${_depth}/${HOOK_SUBAGENT_DEPTH_LIMIT:-3} (restam ${_limit_remaining} níveis). Protocolo de hooks ativo. CLOSE_KEY=${_close_key:-N/A}. Briefing: .github/hooks/state/session-briefing.md."

    local _type="${SUBAGENT_TYPE:-}"
    case "$_type" in
        Plan)
            _type_rules="PAPEL=Plan: foco em planejamento e estruturação. Crie ou atualize manage_todo_list antes de trabalhar. Ao final, chame vscode_askQuestions com plano de execução para o coordenador."
            ;;
        SWE)
            _type_rules="PAPEL=SWE: foco em implementação de código. Execute get_errors após edições. Ao final, chame vscode_askQuestions com resumo das mudanças implementadas."
            ;;
        Explore)
            _type_rules="PAPEL=Explore: foco em pesquisa e análise de código. Priorize read_file, grep_search, semantic_search. Ao final, chame vscode_askQuestions com os achados."
            ;;
        QA)
            _type_rules="PAPEL=QA: foco em testes e validação. Execute run_in_terminal para rodar testes. Ao final, chame vscode_askQuestions com resultado dos testes."
            ;;
        RUG)
            _type_rules="PAPEL=RUG: foco em atualização de documentação. Ao final, chame vscode_askQuestions com documentação atualizada."
            ;;
        *)
            _type_rules="PAPEL=${_type:-desconhecido}: siga o protocolo de hooks. Ao final do trabalho, OBRIGATÓRIO chamar vscode_askQuestions antes de encerrar."
            ;;
    esac

    printf '%s %s' "$_base" "$_type_rules"
}

# ---------------------------------------------------------------------------
# UP-COMPLIANCE (U9-C): verificação de protocolo do subagente no SubagentStop
# ---------------------------------------------------------------------------

# Verifica se o subagente chamou vscode_askQuestions durante sua execução
# Retorna 0 (compliant) ou 1 (violação de protocolo)
# Lógica: se ask_questions_called=false no state, o subagente não cumpriu protocolo
_subagent_check_compliance() {
    local ask_called
    ask_called=$(read_field ".current_turn.ask_questions_called // false" 2> /dev/null || printf 'unknown')
    # Se o campo retornar "unknown" (erro de leitura), assumir compliant para evitar falso positivo
    [ "$ask_called" = "unknown" ] && return 0
    # Se ask_questions_called = true → compliant
    [ "$ask_called" = "true" ] && return 0
    # Se ask_questions_called = false → violação
    return 1
}

# Emite output de compliance violation conforme configuração de enforcement
# $1 = enforcement level (none|soft|hard)
# $2 = subagent_id
_subagent_emit_compliance_violation() {
    local enforcement="$1" subagent_id="$2"
    local reason="Subagente ${subagent_id} encerrou sem chamar vscode_askQuestions (protocolo de hooks violado)."

    case "$enforcement" in
        hard)
            if ! hook_is_stop_active 2> /dev/null; then
                hook_out_subagent_stop_block "$reason"
            fi
            ;;
        soft)
            hook_out_system_message "Aviso (UP-COMPLIANCE): ${reason} Resultados podem estar incompletos. Chame vscode_askQuestions no próximo turno."
            ;;
        none | *)
            # Only audited — no output
            ;;
    esac
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

    # GAP-24: carregar variáveis do módulo 12-subagent.sh e verificar budget
    hook_subagent_load
    if ! hook_subagent_budget_ok; then
        hook_log_audit "subagentStart_budget_exceeded" \
            "subagent_id" "${SUBAGENT_ID:-unknown}" \
            "limit" "${HOOK_SUBAGENT_BUDGET_LIMIT:-50}" \
            "count" "$(hook_subagent_count_session)"
        # UP-BUDGET: hard enforcement via HOOK_SUBAGENT_HARD_ENFORCEMENT=true
        if [ "${HOOK_SUBAGENT_HARD_ENFORCEMENT:-false}" = "true" ]; then
            hook_out_subagent_start_block \
                "Limite de subagentes da sessão atingido (${HOOK_SUBAGENT_BUDGET_LIMIT:-50}). Subagente bloqueado." \
                "Reduza o uso de runSubagent ou aumente HOOK_SUBAGENT_BUDGET_LIMIT."
            exit 0
        else
            # Soft enforcement (padrão): notifica sem bloquear
            hook_out_system_message "Atenção: limite de subagentes da sessão atingido (${HOOK_SUBAGENT_BUDGET_LIMIT:-50}). Evite lançar novos subagentes."
        fi
    fi

    # UP-DEPTH-LIMIT (U9-A): bloquear subagente se ultrapassa profundidade máxima
    if ! hook_subagent_depth_ok; then
        local _depth _limit
        _depth=$(hook_subagent_depth)
        _limit="${HOOK_SUBAGENT_DEPTH_LIMIT:-3}"
        hook_log_audit "subagentStart_depth_exceeded" \
            "subagent_id" "${SUBAGENT_ID:-unknown}" \
            "subagent_type" "${SUBAGENT_TYPE:-unknown}" \
            "depth" "$_depth" \
            "limit" "$_limit"
        hook_out_subagent_start_block \
            "Profundidade máxima de subagentes atingida (depth=${_depth}, limit=${_limit}). Não é permitido lançar subagentes aninhados além do limite." \
            "Para aumentar o limite: HOOK_SUBAGENT_DEPTH_LIMIT=${_limit} (default: 3)."
        exit 0
    fi

    local turn_num
    turn_num=$(read_field ".current_turn.number")
    local active_count
    active_count=$(subagent_start_counters)

    hook_log_audit "subagentStart" \
        "subagent_id" "${SUBAGENT_ID:-unknown}" \
        "subagent_type" "${SUBAGENT_TYPE:-unknown}" \
        "turn" "${turn_num:-0}" \
        "active_count" "${active_count:-1}"

    # UP-CONTEXT-RICH (U9-B) / GAP-29: injetar contexto enriquecido por agent_type
    local _session_id _close_key _turn_num _depth _ctx
    _session_id=$(read_field ".session_id")
    _close_key=$(read_field ".close_key")
    _turn_num=$(read_field ".current_turn.number")
    _depth=$(hook_subagent_depth)

    if [ "${HOOK_SUBAGENT_CONTEXT_RICH:-true}" = "true" ]; then
        _ctx=$(_subagent_build_context "$_session_id" "$_turn_num" "$_depth" "$_close_key")
    else
        # Fallback legado: contexto genérico
        _ctx="Sessão: ${_session_id:-?}. Turno: ${_turn_num:-0}. Profundidade de subagente: ${_depth}. Protocolo de hooks ativo. Briefing em .github/hooks/state/session-briefing.md."
    fi
    hook_out_subagent_start_context "$_ctx"

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

    # UP-SUBAGENT-STOP (U7): verificar coerência antes de decrementar
    local active_before
    active_before=$(read_field ".session_stats.subagents_active // 0")

    local active_count
    active_count=$(subagent_stop_counters)

    local enforcement="${HOOK_SUBAGENT_STOP_ENFORCEMENT:-soft}"

    # Detectar stop órfão: se antes do decremento já era 0, não há start correspondente
    if [ "${active_before:-0}" -le 0 ] 2> /dev/null; then
        hook_log_audit "subagentStop_orphan" \
            "subagent_id" "${SUBAGENT_ID:-unknown}" \
            "subagent_type" "${SUBAGENT_TYPE:-unknown}" \
            "turn" "${turn_num:-0}" \
            "enforcement" "$enforcement"
        case "$enforcement" in
            hard)
                # hard: bloqueia retorno do subagente
                if ! hook_is_stop_active 2> /dev/null; then
                    hook_out_subagent_stop_block \
                        "SubagentStop órfão detectado (subagents_active=0). Subagente ${SUBAGENT_ID:-unknown} não tinha SubagentStart correspondente."
                fi
                exit 0
                ;;
            soft)
                # soft: notifica e deixa passar
                hook_out_system_message \
                    "Aviso: SubagentStop órfão detectado (subagents_active=0). Subagente ${SUBAGENT_ID:-unknown} finalizou sem SubagentStart correspondente."
                ;;
            none | *)
                # none: só auditado — sem output
                ;;
        esac
    fi

    # UP-COMPLIANCE (U9-C): verificar se o subagente cumpriu o protocolo de hooks
    # (chamou vscode_askQuestions antes de encerrar)
    local compliance_enforcement="${HOOK_SUBAGENT_COMPLIANCE_ENFORCEMENT:-soft}"
    if [ "$compliance_enforcement" != "none" ]; then
        if ! _subagent_check_compliance; then
            hook_log_audit "subagentStop_protocol_violation" \
                "subagent_id" "${SUBAGENT_ID:-unknown}" \
                "subagent_type" "${SUBAGENT_TYPE:-unknown}" \
                "turn" "${turn_num:-0}" \
                "violation" "ask_questions_not_called" \
                "enforcement" "$compliance_enforcement"
            _subagent_emit_compliance_violation "$compliance_enforcement" "${SUBAGENT_ID:-unknown}"
            # hard: retorna imediatamente após bloquear (evita duplo output)
            [ "$compliance_enforcement" = "hard" ] && exit 0
        fi
    fi

    hook_log_audit "subagentStop" \
        "subagent_id" "${SUBAGENT_ID:-unknown}" \
        "subagent_type" "${SUBAGENT_TYPE:-unknown}" \
        "turn" "${turn_num:-0}" \
        "active_count" "${active_count:-0}"

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
