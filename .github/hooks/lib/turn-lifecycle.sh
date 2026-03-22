#!/usr/bin/env bash
# turn-lifecycle.sh — Lifecycle de TURNs e SUBTURNs
# Extraído de common.sh (R-06: split de módulos)
# Requer: STATE_DIR, STATE_FILE definidos (via common.sh header)
# Requer: state-crud.sh e utils.sh já sourceados
# Não usar set -euo pipefail (é sourceado, não executado)

# Guard de re-source
[[ -n "${_TURN_LIFECYCLE_LOADED:-}" ]] && return 0
_TURN_LIFECYCLE_LOADED=1

# ---------------------------------------------------------------------------
# Detecção de close_key
# [LEGADO — DEPRECADO] Use hook_close_key_detect_in_text() de 10-close-key.sh
# ---------------------------------------------------------------------------

# @deprecated Use hook_close_key_detect_in_text() de api/10-close-key.sh
# Verifica se a close_key da sessão aparece no texto fornecido.
# Retorna 0 se encontrar, 1 se não encontrar ou close_key ausente no state.
detect_close_key_in_text() {
    local text="$1"
    local close_key
    close_key=$(read_field ".close_key")
    [[ -z "$close_key" ]] || [[ "$close_key" = "null" ]] && return 1
    printf '%s' "$text" | grep -qF "$close_key"
}

# ---------------------------------------------------------------------------
# Detecção de turno órfão
# [LEGADO — DEPRECADO] Use hook_turn_is_orphaned() de api/16-lifecycle.sh
# ---------------------------------------------------------------------------

# @deprecated Use hook_turn_is_orphaned() de api/16-lifecycle.sh
# Retorna 0 se o turno atual é órfão (iniciou mas não encerrou em threshold segundos)
turn_is_orphaned() {
    local threshold="${1:-300}" # default: 5 minutos
    local started_at now_epoch started_epoch delta

    started_at=$(read_field ".current_turn.started_at")
    [[ -z "$started_at" ]] || [[ "$started_at" = "null" ]] && return 1

    # Converte ISO 8601 para epoch via date (portável em Linux)
    started_epoch=$(date -d "$started_at" +%s 2> /dev/null) || return 1
    now_epoch=$(date -u +%s)
    delta=$((now_epoch - started_epoch))

    [[ "$delta" -gt "$threshold" ]]
}

# @deprecated Use hook_heal_orphaned_turn() de api/16-lifecycle.sh
# Fecha turno órfão e registra evento de healing no audit.jsonl
heal_orphaned_turn() {
    local turn_num turn_id
    turn_num=$(read_field ".current_turn.number")
    turn_id=$(read_field ".current_turn.turn_id")

    update_nested_state "current_turn.ask_questions_called" "false"
    update_nested_state "current_turn.started_at" "null"     # GAP-04: evita re-heal na próxima UserPromptSubmit
    update_nested_state "current_turn.ended_at" "$(now_iso)" # GAP-10: registra temporalmente quando terminou
    # R-08: migrado de log_audit() para hook_log_audit() (API canônica)
    hook_log_audit "turnEnd_orphan_healed" "turn" "${turn_num:-0}" "turn_id" "${turn_id:-unknown}"
}

# ---------------------------------------------------------------------------
# Lifecycle de TURN (userPromptSubmit)
# ---------------------------------------------------------------------------

# Abre novo TURN: incrementa contador, gera turn_id, seta started_at, reseta flags.
# Retorna o novo número de turno via stdout.
# Uso: turn_num=$(open_new_turn [source])
open_new_turn() {
    local turn_source="${1:-userPromptSubmit}"
    local turn_num turn_id now
    now=$(now_iso)
    turn_id=$(uuidgen_safe)

    # Incrementa turn_count e turn_number
    turn_num=$(increment_field ".session_stats.turn_count")
    update_nested_state "current_turn.number" "$turn_num"
    update_nested_state "current_turn.turn_id" "$turn_id"
    update_nested_state "current_turn.started_at" "$now"
    update_nested_state "current_turn.ended_at" "null"
    update_nested_state "current_turn.source" "$turn_source"
    update_nested_state "current_turn.ask_questions_called" "false"
    update_nested_state "current_turn.ask_questions_turn_pos" "0"
    update_nested_state "current_turn.last_template" ""
    update_nested_state "current_turn.subturn_count" "0"
    update_nested_state "current_turn.tools_count" "0"
    update_nested_state "current_turn.intent" ""
    update_nested_state "current_turn.subagents_started" "0"
    # UP-H1b: reseta contadores de tools pós-askQ no início de cada turno.
    # Sem este reset, valores do turno anterior propagavam para o próximo
    # causando falsos positivos no UP-H1b (task_complete bloqueado indevidamente).
    update_nested_state "current_turn.tools_after_ask_questions" "0"
    update_nested_state "current_turn.last_tool_after_ask_questions" ""

    # GAP-SUBTURN-RESET: limpa current_subturn ao abrir novo turno para evitar
    # que dados residuais do subturn anterior (de turno encerrado abruptamente)
    # contaminem leituras antes do primeiro preToolUse do novo turno.
    update_nested_state "current_subturn.number" "0"
    update_nested_state "current_subturn.subturn_id" "null"
    update_nested_state "current_subturn.started_at" "null"
    update_nested_state "current_subturn.ended_at" "null"
    update_nested_state "current_subturn.response_at" "null"

    printf '%d' "$turn_num"
}

# R-07: versão batch de open_new_turn() — executa um único jq para todos os campos
# Performance: -80% I/O vs open_new_turn() que faz ~15 invocações jq separadas.
# Interface idêntica a open_new_turn(): retorna novo número de turno via stdout.
# Uso: turn_num=$(open_new_turn_batch [source])
open_new_turn_batch() {
    local turn_source="${1:-userPromptSubmit}"
    local now turn_id current_count turn_num tmp

    now=$(now_iso)
    turn_id=$(uuidgen_safe)

    # Lê turn_count atual para calcular o próximo número (uma única leitura)
    current_count=$(read_field ".session_stats.turn_count")
    turn_num=$((${current_count:-0} + 1))

    tmp="$(mktemp "$STATE_DIR/.state.XXXXXX")"
    jq \
        --argjson turn_num "$turn_num" \
        --arg turn_id "$turn_id" \
        --arg now "$now" \
        --arg src "$turn_source" \
        '
        .session_stats.turn_count = $turn_num |
        .current_turn.number = $turn_num |
        .current_turn.turn_id = $turn_id |
        .current_turn.started_at = $now |
        .current_turn.ended_at = null |
        .current_turn.source = $src |
        .current_turn.ask_questions_called = false |
        .current_turn.ask_questions_turn_pos = 0 |
        .current_turn.last_template = "" |
        .current_turn.subturn_count = 0 |
        .current_turn.tools_count = 0 |
        .current_turn.intent = "" |
        .current_turn.subagents_started = 0 |
        .current_turn.tools_after_ask_questions = 0 |
        .current_turn.last_tool_after_ask_questions = "" |
        .current_subturn.number = 0 |
        .current_subturn.subturn_id = null |
        .current_subturn.started_at = null |
        .current_subturn.ended_at = null |
        .current_subturn.response_at = null
        ' "$STATE_FILE" > "$tmp" || {
        rm -f "$tmp"
        return 1
    }
    mv -f "$tmp" "$STATE_FILE" || {
        rm -f "$tmp"
        return 1
    }

    printf '%d' "$turn_num"
}

# ---------------------------------------------------------------------------
# Lifecycle de SUBTURN (preToolUse)
# ---------------------------------------------------------------------------

# Abre novo SUBTURN: incrementa contadores, gera subturn_id, seta started_at.
# Retorna o novo número de subturn via stdout.
# Uso: subturn_num=$(open_new_subturn)
open_new_subturn() {
    # GAP-21: guard — sem turno ativo, não abre subturn
    local _guard_turn
    _guard_turn=$(read_field '.current_turn.number')
    if [[ -z "$_guard_turn" ]] || [[ "$_guard_turn" = 'null' ]] || [[ "${_guard_turn:-0}" -eq 0 ]] 2> /dev/null; then
        printf '0'
        return 0
    fi

    local subturn_id now
    now=$(now_iso)
    subturn_id=$(uuidgen_safe)

    # Incrementa subturn global e local
    increment_field ".session_stats.subturn_total" > /dev/null
    local local_count
    local_count=$(increment_field ".current_turn.subturn_count")

    update_nested_state "current_subturn.number" "$local_count"
    update_nested_state "current_subturn.subturn_id" "$subturn_id"
    update_nested_state "current_subturn.started_at" "$now"
    update_nested_state "current_subturn.ended_at" "null" # GAP-14
    update_nested_state "current_subturn.response_at" "null"

    printf '%d' "$local_count"
}

# increment_tools_by_type — UP-01: incrementa contador por tipo de ferramenta
# Uso: increment_tools_by_type "read_file"
increment_tools_by_type() {
    local tool_name="${1:-unknown}"
    # Sanitiza: mantém apenas [a-zA-Z0-9_-] para evitar injeção de chaves jq
    local safe_name
    safe_name=$(printf '%s' "$tool_name" | tr -cd 'a-zA-Z0-9_-' | cut -c1-64)
    [[ -n "$safe_name" ]] || safe_name="unknown"
    local current new_val tmp
    current=$(jq -r ".session_stats.tools_by_type[\"${safe_name}\"] // 0" "$STATE_FILE" 2> /dev/null || printf '0')
    new_val=$((${current:-0} + 1))
    tmp="$(mktemp "$STATE_DIR/.state.XXXXXX")"
    jq --arg k "$safe_name" --argjson v "$new_val" \
        '.session_stats.tools_by_type[$k] = $v' "$STATE_FILE" > "$tmp" || {
        rm -f "$tmp"
        return 0 # falha silenciosa — não crítico
    }
    mv -f "$tmp" "$STATE_FILE" || {
        rm -f "$tmp"
        return 0
    }
}

# _increment_template_usage — UP-02: incrementa contador de uso por template (A-G)
# Uso: _increment_template_usage "A"
_increment_template_usage() {
    local tmpl="${1:-}"
    # Aceita apenas letras A-G
    case "$tmpl" in
        A | B | C | D | E | F | G) ;;
        *) return 0 ;;
    esac
    local current new_val tmp
    current=$(jq -r ".compliance.template_usage[\"${tmpl}\"] // 0" "$STATE_FILE" 2> /dev/null || printf '0')
    new_val=$((${current:-0} + 1))
    tmp="$(mktemp "$STATE_DIR/.state.XXXXXX")"
    jq --arg k "$tmpl" --argjson v "$new_val" \
        '.compliance.template_usage[$k] = $v' "$STATE_FILE" > "$tmp" || {
        rm -f "$tmp"
        return 0
    }
    mv -f "$tmp" "$STATE_FILE" || {
        rm -f "$tmp"
        return 0
    }
}

# Incrementa tools_count do turno atual e tools_total da sessão.
# Retorna o total de ferramentas do turno atual.
# Uso: tool_num=$(count_tool_use)
count_tool_use() {
    increment_field ".session_stats.tools_total" > /dev/null
    # UP-01: rastreia contagem por tipo de ferramenta (HOOK_TOOL_NAME do payload)
    if [[ -n "${HOOK_TOOL_NAME:-}" ]]; then
        increment_tools_by_type "$HOOK_TOOL_NAME" > /dev/null
    fi
    increment_field ".current_turn.tools_count"
}
