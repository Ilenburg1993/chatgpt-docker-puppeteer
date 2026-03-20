#!/usr/bin/env bash
# session-summary.sh — Resumo condensado da sessão em uma linha (UP-13)
#
# Uso: bash .github/hooks/scripts/session-summary.sh
#
# Saída: uma linha no formato:
#   SESSION | T:5(A:4/U:1) | Tools:32(blk:0) | Subturns:18 | Dur:12m | CK:ENCERRAR-XXXXXXXX
# Exit code: 0 sempre

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib/common.sh
source "$HOOK_DIR/lib/common.sh"

if ! state_exists; then
    printf 'SESSION | sem state ativo\n'
    exit 0
fi

turn_count=$(read_field '.session_stats.turn_count' 2> /dev/null || printf '0')
turn_auth=$(read_field '.session_stats.turn_authorized' 2> /dev/null || printf '0')
turn_unauth=$(read_field '.session_stats.turn_unauthorized' 2> /dev/null || printf '0')
tools_total=$(read_field '.session_stats.tools_total' 2> /dev/null || printf '0')
tools_blocked=$(read_field '.session_stats.tools_blocked' 2> /dev/null || printf '0')
subturn=$(read_field '.session_stats.subturn_total' 2> /dev/null || printf '0')
consecutive=$(read_field '.compliance.consecutive_unauthorized' 2> /dev/null || printf '0')
close_key=$(read_field '.close_key' 2> /dev/null || printf 'N/A')

# Lê started_at e calcula duração se disponível
started_at=$(read_field '.started_at' 2> /dev/null || printf '')
dur_m='?'
if [ -n "$started_at" ] && [ "$started_at" != "null" ]; then
    now=$(date +%s 2> /dev/null || printf '0')
    epoch_start=$(date -d "$started_at" +%s 2> /dev/null \
        || date -j -f '%Y-%m-%dT%H:%M:%SZ' "$started_at" +%s 2> /dev/null \
        || printf "$now")
    dur_s=$((now - epoch_start))
    dur_m=$((dur_s / 60))
fi

compliance_tag=""
[ "${consecutive:-0}" -gt 0 ] && compliance_tag=" ⚠️U:${consecutive}"

printf 'SESSION | T:%s(A:%s/U:%s)%s | Tools:%s(blk:%s) | Subturns:%s | Dur:%sm | CK:%s\n' \
    "${turn_count:-0}" "${turn_auth:-0}" "${turn_unauth:-0}" \
    "$compliance_tag" \
    "${tools_total:-0}" "${tools_blocked:-0}" \
    "${subturn:-0}" \
    "${dur_m}" \
    "${close_key:-N/A}"
