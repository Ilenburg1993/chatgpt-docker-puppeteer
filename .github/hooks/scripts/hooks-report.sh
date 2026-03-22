#!/usr/bin/env bash
# hooks-report.sh — Relatório analítico da sessão de hooks (UP-05)
#
# Uso: bash .github/hooks/scripts/hooks-report.sh [--json]
#
# Sem --json: saída markdown legível por humanos
# Com --json: saída JSON estruturada para automação
# Exit code: 0 sempre

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib/common.sh
source "$HOOK_DIR/lib/common.sh"
# shellcheck source=../lib/hook-payload-api.sh
source "$HOOK_DIR/lib/hook-payload-api.sh"

JSON_MODE=0
[ "${1:-}" = "--json" ] && JSON_MODE=1

# ---------------------------------------------------------------------------
# Coleta de dados
# ---------------------------------------------------------------------------

collect_stats() {
    if ! state_exists; then
        echo '{"error":"state_not_found"}'
        return 1
    fi

    # Métricas básicas
    local turn_count turn_auth turn_unauth subturn tools_total tools_blocked
    local consecutive subagents_total close_key schema_ver start_at
    local tools_by_type template_usage last_template duration_s

    turn_count=$(read_field '.session_stats.turn_count' 2> /dev/null || printf '0')
    turn_auth=$(read_field '.session_stats.turn_authorized' 2> /dev/null || printf '0')
    turn_unauth=$(read_field '.session_stats.turn_unauthorized' 2> /dev/null || printf '0')
    subturn=$(read_field '.session_stats.subturn_total' 2> /dev/null || printf '0')
    tools_total=$(read_field '.session_stats.tools_total' 2> /dev/null || printf '0')
    tools_blocked=$(read_field '.session_stats.tools_blocked' 2> /dev/null || printf '0')
    consecutive=$(read_field '.compliance.consecutive_unauthorized' 2> /dev/null || printf '0')
    subagents_total=$(read_field '.session_stats.subagents_total' 2> /dev/null || printf '0')
    close_key=$(read_field '.close_key' 2> /dev/null || printf '')
    schema_ver=$(read_field '.state_schema_version' 2> /dev/null || printf '0')
    start_at=$(read_field '.started_at' 2> /dev/null || printf '')
    tools_by_type=$(read_field '.session_stats.tools_by_type' 2> /dev/null || printf '{}')
    template_usage=$(read_field '.compliance.template_usage' 2> /dev/null || printf '{}')
    last_template=$(read_field '.compliance.last_template' 2> /dev/null || printf '')
    duration_s=$(hook_stat_session_duration_seconds 2> /dev/null || printf '0')

    printf '%s' "$turn_count $turn_auth $turn_unauth $subturn $tools_total $tools_blocked $consecutive $subagents_total $duration_s" > /dev/null

    if [ "$JSON_MODE" -eq 1 ]; then
        jq -n \
            --arg schema_ver "$schema_ver" \
            --arg start_at "$start_at" \
            --argjson duration_s "${duration_s:-0}" \
            --argjson turn_count "${turn_count:-0}" \
            --argjson turn_auth "${turn_auth:-0}" \
            --argjson turn_unauth "${turn_unauth:-0}" \
            --argjson subturn "${subturn:-0}" \
            --argjson tools_total "${tools_total:-0}" \
            --argjson tools_blocked "${tools_blocked:-0}" \
            --argjson consecutive "${consecutive:-0}" \
            --argjson subagents_total "${subagents_total:-0}" \
            --arg close_key "$close_key" \
            --arg last_template "$last_template" \
            --argjson tools_by_type "${tools_by_type:-{}}" \
            --argjson template_usage "${template_usage:-{}}" \
            '{
                schema_version: $schema_ver,
                started_at: $start_at,
                duration_seconds: $duration_s,
                turns: {total: $turn_count, authorized: $turn_auth, unauthorized: $turn_unauth},
                subturns: $subturn,
                tools: {total: $tools_total, blocked: $tools_blocked, by_type: $tools_by_type},
                compliance: {consecutive_unauthorized: $consecutive, template_usage: $template_usage, last_template: $last_template},
                subagents_total: $subagents_total,
                close_key: $close_key
            }'
    else
        _print_md_report "$turn_count" "$turn_auth" "$turn_unauth" "$subturn" \
            "$tools_total" "$tools_blocked" "$consecutive" "$subagents_total" \
            "$duration_s" "$close_key" "$start_at" "$schema_ver" \
            "$tools_by_type" "$template_usage" "$last_template"
    fi
}

_print_md_report() {
    local turn_count="$1" turn_auth="$2" turn_unauth="$3" subturn="$4"
    local tools_total="$5" tools_blocked="$6" consecutive="$7" subagents="$8"
    local duration_s="$9" close_key="${10}" start_at="${11}" schema_ver="${12}"
    local tools_by_type="${13}" template_usage="${14}" last_template="${15}"

    local duration_min=$((${duration_s:-0} / 60))
    local duration_sec=$((${duration_s:-0} % 60))
    local compliance_icon
    [ "${consecutive:-0}" -gt 0 ] && compliance_icon="⚠️" || compliance_icon="✅"

    printf '# Hooks Session Report\n'
    printf 'Gerado em: %s | Schema v%s\n\n' "$(now_iso)" "${schema_ver:-?}"

    printf '## Visão Geral\n'
    printf -- '| Campo | Valor |\n|---|---|\n'
    printf -- '| Inicio | %s |\n' "${start_at:-N/A}"
    printf -- '| Duração | %dm %ds |\n' "$duration_min" "$duration_sec"
    # shellcheck disable=SC2016 # backticks são markdown literal no formato printf — não são subshell
    printf -- '| Chave de encerramento | `%s` |\n\n' "${close_key:-N/A}"

    printf '## Turnos\n'
    printf -- '| Total | Autorizados | Não Autorizados | Compliance |\n|---|---|---|---|\n'
    printf -- '| %s | %s | %s | %s %s consecutivos |\n\n' \
        "${turn_count:-0}" "${turn_auth:-0}" "${turn_unauth:-0}" \
        "$compliance_icon" "${consecutive:-0}"

    printf '## Ferramentas\n'
    printf -- '- Total de chamadas: **%s** (bloqueadas: %s)\n' "${tools_total:-0}" "${tools_blocked:-0}"
    printf -- '- Subturns acumulados: **%s**\n' "${subturn:-0}"
    printf -- '- Subagentes despachados: **%s**\n\n' "${subagents:-0}"

    if [ -n "$tools_by_type" ] && [ "$tools_by_type" != "{}" ] && [ "$tools_by_type" != "null" ]; then
        printf '### Top Ferramentas (por chamadas)\n'
        printf '%s' "$tools_by_type" \
            | jq -r 'to_entries | sort_by(-.value) | .[:10] | .[] | "| \(.key) | \(.value) |"' 2> /dev/null \
            | {
                printf '| Ferramenta | Chamadas |\n|---|---|\n'
                cat
            }
        printf '\n'
    fi

    if [ -n "$template_usage" ] && [ "$template_usage" != "{}" ] && [ "$template_usage" != "null" ]; then
        printf '## Templates vscode_askQuestions\n'
        printf -- '- Último template usado: **%s**\n' "${last_template:-N/A}"
        printf '%s' "$template_usage" \
            | jq -r 'to_entries | sort_by(-.value) | .[] | "- Template \(.key): \(.value)x"' 2> /dev/null || true
        printf '\n'
    fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
collect_stats || exit 0
