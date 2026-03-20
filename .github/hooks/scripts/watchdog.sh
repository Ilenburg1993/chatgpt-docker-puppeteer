#!/usr/bin/env bash
# watchdog.sh — Verifica saúde do sistema de hooks
#
# Uso: bash .github/hooks/scripts/watchdog.sh [--json]
#
# Sem --json: saída legível por humanos
# Com --json: saída JSON (para automação)
# Exit code: 0 = saudável, 1 = problemas encontrados

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib/common.sh
source "$HOOK_DIR/lib/common.sh"

JSON_MODE=0
[ "${1:-}" = "--json" ] && JSON_MODE=1

ISSUES=()
WARNINGS=()

# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

check_jq() {
    command -v jq > /dev/null 2>&1 && return 0
    ISSUES+=("jq não encontrado — dependência crítica ausente")
    return 1
}

check_state_file() {
    if [ ! -f "$STATE_FILE" ]; then
        WARNINGS+=("session.json não existe — sessão ainda não iniciada")
        return 1
    fi
    if ! jq -e . "$STATE_FILE" > /dev/null 2>&1; then
        ISSUES+=("session.json inválido ou corrompido: $STATE_FILE")
        return 1
    fi
    return 0
}

check_scripts_executable() {
    local script ok=1
    for script in "$HOOK_DIR/scripts"/*.sh; do
        if [ ! -x "$script" ]; then
            ISSUES+=("Script não executável: $(basename "$script")")
            ok=0
        fi
    done
    return $((1 - ok))
}

check_audit_writable() {
    if [ -f "$AUDIT_FILE" ] && [ ! -w "$AUDIT_FILE" ]; then
        ISSUES+=("audit.jsonl não é gravável: $AUDIT_FILE")
        return 1
    fi
    # Verifica que o diretório é gravável para criar o arquivo
    if [ ! -w "$(dirname "$AUDIT_FILE")" ]; then
        ISSUES+=("Diretório de state não é gravável: $(dirname "$AUDIT_FILE")")
        return 1
    fi
    return 0
}

check_hooks_json() {
    local hooks_json="$HOOK_DIR/hooks.json"
    if [ ! -f "$hooks_json" ]; then
        ISSUES+=("hooks.json não encontrado: $hooks_json")
        return 1
    fi
    if ! jq -e . "$hooks_json" > /dev/null 2>&1; then
        ISSUES+=("hooks.json inválido: $hooks_json")
        return 1
    fi
    return 0
}

# GAP-53: verifica que cada comando referenciado em hooks.json existe e é executável
check_hook_commands() {
    local hooks_json="$HOOK_DIR/hooks.json"
    [ -f "$hooks_json" ] || return 0                   # check_hooks_json já reportou
    jq -e . "$hooks_json" > /dev/null 2>&1 || return 0 # JSON inválido já reportado

    local cmd resolved
    while IFS= read -r cmd; do
        [ -z "$cmd" ] || [ "$cmd" = "null" ] && continue
        # Resolve caminho relativo ao HOOK_DIR se não for absoluto
        if [[ "$cmd" != /* ]]; then
            resolved="$HOOK_DIR/$cmd"
        else
            resolved="$cmd"
        fi
        # Extrai apenas o executável (primeiro token antes de espaço)
        local exe
        exe="${resolved%% *}"
        if [ ! -f "$exe" ]; then
            ISSUES+=("Comando do hooks.json não encontrado: $exe")
        elif [ ! -x "$exe" ]; then
            ISSUES+=("Comando do hooks.json não é executável: $exe")
        fi
    done < <(jq -r '.[].hooks[].command // empty' "$hooks_json" 2> /dev/null)
}

check_pending_session_close() {
    if ! state_exists; then return 0; fi
    local pending
    pending=$(read_field ".pending_session_close")
    if [ "$pending" = "true" ]; then
        WARNINGS+=("pending_session_close=true — sessão aguardando encerramento")
    fi
}

check_consecutive_violations() {
    if ! state_exists; then return 0; fi
    local consec threshold=5
    consec=$(read_field ".compliance.consecutive_unauthorized")
    if [ -n "$consec" ] && [ "$consec" != "null" ] && [ "$consec" -ge "$threshold" ] 2> /dev/null; then
        WARNINGS+=("$consec turnos consecutivos sem askQuestions (threshold: $threshold)")
    fi
}

# ---------------------------------------------------------------------------
# Executar checks (|| true para não abortar em set -e quando encontra issues)
# ---------------------------------------------------------------------------
check_jq || true
check_state_file || true
check_scripts_executable || true
check_audit_writable || true
check_hooks_json || true
check_hook_commands || true
check_pending_session_close || true
check_consecutive_violations || true

HEALTHY=1
[ "${#ISSUES[@]}" -gt 0 ] && HEALTHY=0

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
if [ "$JSON_MODE" -eq 1 ]; then
    # Output JSON — constrói arrays de forma segura para bash com set -nounset
    local_issues=''
    local_warnings=''
    if [ "${#ISSUES[@]}" -gt 0 ]; then
        local_issues=$(printf '%s\n' "${ISSUES[@]}" | jq -R . | jq -s .)
    else
        local_issues='[]'
    fi
    if [ "${#WARNINGS[@]}" -gt 0 ]; then
        local_warnings=$(printf '%s\n' "${WARNINGS[@]}" | jq -R . | jq -s .)
    else
        local_warnings='[]'
    fi
    jq -n \
        --argjson healthy "$([ "$HEALTHY" -eq 1 ] && echo true || echo false)" \
        --argjson issues "$local_issues" \
        --argjson warnings "$local_warnings" \
        --arg ts "$(now_iso)" \
        '{healthy: $healthy, issues: $issues, warnings: $warnings, checked_at: $ts}'
else
    # Output legível
    printf '\n[watchdog] Status do sistema de hooks (%s)\n\n' "$(now_iso)"

    if [ "$HEALTHY" -eq 1 ] && [ "${#WARNINGS[@]}" -eq 0 ]; then
        printf '✅ Sistema saudável — nenhum problema encontrado\n'
    fi

    if [ "${#ISSUES[@]}" -gt 0 ]; then
        printf '🔴 PROBLEMAS (%d):\n' "${#ISSUES[@]}"
        for issue in "${ISSUES[@]}"; do
            printf '   • %s\n' "$issue"
        done
    fi

    if [ "${#WARNINGS[@]}" -gt 0 ]; then
        printf '⚠️  AVISOS (%d):\n' "${#WARNINGS[@]}"
        for warn in "${WARNINGS[@]}"; do
            printf '   • %s\n' "$warn"
        done
    fi

    printf '\nHooks dir : %s\n' "$HOOK_DIR"
    printf 'State     : %s\n' "$STATE_FILE"
    printf 'Audit     : %s\n' "$AUDIT_FILE"
    printf '\n'
fi

exit $((1 - HEALTHY))
