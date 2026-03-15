#!/bin/bash

# F7.7 shim canônico: root delega para lifecycle/session-start-aux.sh.
if [[ "${HOOKS_LIB_BYPASS_SESSION_START_AUX_SHIM:-0}" != "1" ]]; then
    _hooks_lib_root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    # shellcheck disable=SC1091
    source "${_hooks_lib_root_dir}/lifecycle/session-start-aux.sh"
    return 0
fi

# shellcheck shell=bash
# session-start-aux.sh — blocos auxiliares (fail-open) de session-start
#
# Responsabilidades não-críticas para inicialização mínima de sessão:
# - coleta de backlog/findings
# - análise de tendências históricas
# - health check operacional

session_start_collect_backlog_and_findings() {
    local tasks_file="${1:-}"
    local findings_file="${2:-}"

    COUNT_ALTA=0
    COUNT_MEDIA=0
    COUNT_BACKLOG=0
    NEXT_TASK=""

    if [ -n "$tasks_file" ] && [ -f "$tasks_file" ]; then
        COUNT_ALTA="$(awk '/^## Alta Prioridade/{f=1} /^## / && !/^## Alta/{f=0} f && /^\- \[ \]/' "$tasks_file" | wc -l | tr -d ' ')"
        COUNT_MEDIA="$(awk '/^## Média Prioridade/{f=1} /^## / && !/^## Média/{f=0} f && /^\- \[ \]/' "$tasks_file" | wc -l | tr -d ' ')"
        COUNT_BACKLOG="$(awk '/^## Backlog/{f=1} /^## / && !/^## Backlog/{f=0} f && /^\- \[ \]/' "$tasks_file" | wc -l | tr -d ' ')"
        NEXT_TASK="$(awk '/^## Alta Prioridade/{f=1} /^## / && !/^## Alta/{f=0} f && /^\- \[ \]/{print; exit}' "$tasks_file" | sed 's/^- \[ \] //')"
        [ -z "$NEXT_TASK" ] && NEXT_TASK="(nenhuma tarefa de Alta Prioridade — verificar Média Prioridade)"
    fi

    OPEN_FINDINGS=0
    CRITICAL_FINDINGS=0
    if [ -n "$findings_file" ] && [ -f "$findings_file" ]; then
        OPEN_FINDINGS="$(wc -l < "$findings_file" 2> /dev/null | tr -d ' ')"
        CRITICAL_FINDINGS="$(jq -r 'select(.severity == "critical" or .severity == "high")' "$findings_file" 2> /dev/null | jq -s 'length' 2> /dev/null || echo 0)"
    fi

    TOTAL_OPEN=$((COUNT_ALTA + COUNT_MEDIA + COUNT_BACKLOG))
    export COUNT_ALTA COUNT_MEDIA COUNT_BACKLOG NEXT_TASK OPEN_FINDINGS CRITICAL_FINDINGS TOTAL_OPEN
    return 0
}

session_start_compute_trends() {
    TREND_SESSIONS="N/D"
    TREND_TOTAL_TOOLS="N/D"
    TREND_ERROR_RATE="N/D"
    TREND_TOP_TOOLS_TABLE=""
    TREND_TOP_FAILURES="- (nenhuma falha registrada)"
    TREND_PERF_TABLE=""

    local trend_audit_file_bkp="${AUDIT_FILE:-}"
    local trend_merged=""
    local metrics_file="${LOG_DIR}/tool-metrics.jsonl"
    local trend_files=()

    while IFS= read -r -d '' _tf; do
        trend_files+=("$_tf")
    done < <(find "$LOG_DIR" -maxdepth 1 -name 'audit-????????.jsonl' -print0 2> /dev/null | sort -z)

    if [ ${#trend_files[@]} -gt 0 ] && trend_merged="$(mktemp 2> /dev/null)"; then
        cat "${trend_files[@]}" > "$trend_merged" 2> /dev/null || true
        AUDIT_FILE="$trend_merged"
    else
        AUDIT_FILE="$LOG_DIR/audit.jsonl"
    fi

    if [ -f "$AUDIT_FILE" ] && [ -s "$AUDIT_FILE" ]; then
        TREND_SESSIONS="$(jq -r '.session_id // empty' "$AUDIT_FILE" 2> /dev/null | sort -u | awk 'NF{n++} END{print n+0}' || echo 'N/D')"

        TREND_TOTAL_TOOLS="$(jq -r 'select(.event == "preToolUse" and ((.tool_name // .toolName) // "") != "") | (.tool_name // .toolName)' "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ' || echo '0')"

        local total_failures
        total_failures="$(jq -r 'select((.event == "toolFailure" or .event == "toolUseFailure") and ((.tool_name // .toolName) // "") != "") | (.tool_name // .toolName)' "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ' || echo '0')"

        if [ "$TREND_TOTAL_TOOLS" -gt 0 ] 2> /dev/null; then
            TREND_ERROR_RATE="$(echo "$total_failures $TREND_TOTAL_TOOLS" | awk '{printf "%.1f%% (%d/%d)", ($1/$2)*100, $1, $2}')"
        fi

        TREND_TOP_TOOLS_TABLE="$(jq -r 'select(.event == "preToolUse" and ((.tool_name // .toolName) // "") != "") | (.tool_name // .toolName)' "$AUDIT_FILE" 2> /dev/null | sort | uniq -c | sort -rn | head -6 | awk '{printf "| `%-35s` | %5d |\n", $2, $1}' || true)"
        [ -z "$TREND_TOP_TOOLS_TABLE" ] && TREND_TOP_TOOLS_TABLE="| N/D | 0 |"

        TREND_TOP_FAILURES="$(jq -r 'select((.event == "toolFailure" or .event == "toolUseFailure") and ((.tool_name // .toolName) // "") != "") | (.tool_name // .toolName)' "$AUDIT_FILE" 2> /dev/null | sort | uniq -c | sort -rn | head -3 | awk '{printf "- `%s`: %d falha(s)\n", $2, $1}' || true)"
        [ -z "$TREND_TOP_FAILURES" ] && TREND_TOP_FAILURES="- (nenhuma falha registrada)"
    fi

    if [ -f "$metrics_file" ] && [ -s "$metrics_file" ]; then
        TREND_PERF_TABLE="$(jq -r '(.tool_name // .toolName)' "$metrics_file" 2> /dev/null | sort -u | while read -r tool; do
            AVG_MS="$(jq -r --arg t "$tool" 'select((.tool_name // .toolName) == $t) | .duration_ms' "$metrics_file" 2> /dev/null | awk '{s+=$1; n++} END {if(n>0) printf "%.0f", s/n; else print "N/D"}')"
            COUNT_T="$(jq -r --arg t "$tool" 'select((.tool_name // .toolName) == $t) | (.tool_name // .toolName)' "$metrics_file" 2> /dev/null | wc -l | tr -d ' ')"
            printf "| \`%-35s\` | %6s ms | %4d |\n" "$tool" "$AVG_MS" "$COUNT_T"
        done | sort -t'|' -k3 -rn | head -8 || true)"
        [ -z "$TREND_PERF_TABLE" ] && TREND_PERF_TABLE="| N/D | - | 0 |"
    fi

    AUDIT_FILE="$trend_audit_file_bkp"
    [ -n "$trend_merged" ] && rm -f "$trend_merged" 2> /dev/null || true

    export TREND_SESSIONS TREND_TOTAL_TOOLS TREND_ERROR_RATE TREND_TOP_TOOLS_TABLE TREND_TOP_FAILURES TREND_PERF_TABLE
    return 0
}

session_start_compute_health() {
    HEALTH_CRITICAL=""
    HEALTH_WARNINGS=""

    if ! command -v sponge > /dev/null 2>&1; then
        HEALTH_CRITICAL="${HEALTH_CRITICAL}
- ⛔ **sponge não instalado** — instale com \`sudo apt install moreutils\`. Atualizações de estado da sessão inoperantes."
    fi

    if ! command -v jq > /dev/null 2>&1; then
        HEALTH_CRITICAL="${HEALTH_CRITICAL}
- ⛔ **jq não instalado** — instale com \`sudo apt install jq\`. Sistema de hooks completamente inoperante."
    fi

    AUDIT_LINES=0
    if [ -f "$AUDIT_FILE" ]; then
        AUDIT_LINES="$(wc -l < "$AUDIT_FILE" | tr -d ' ')"
        if [ "${AUDIT_LINES}" -gt 4500 ] 2> /dev/null; then
            HEALTH_CRITICAL="${HEALTH_CRITICAL}
- ⛔ **audit.jsonl crítico** (${AUDIT_LINES}/5000 linhas). Rotação iminente — arquive logs antigos urgentemente."
        elif [ "${AUDIT_LINES}" -gt 3000 ] 2> /dev/null; then
            HEALTH_WARNINGS="${HEALTH_WARNINGS}
- ⚠️ **audit.jsonl crescendo** (${AUDIT_LINES}/5000 linhas). Rotação automática em breve."
        fi
    fi

    if [ -f "$STATE_DIR/session-context.json" ] && [ ! -w "$STATE_DIR/session-context.json" ]; then
        HEALTH_CRITICAL="${HEALTH_CRITICAL}
- ⛔ **session-context.json sem permissão de escrita** — estado da sessão não pode ser atualizado."
    fi

    if [ "${CRITICAL_FINDINGS:-0}" -gt 0 ] 2> /dev/null; then
        HEALTH_WARNINGS="${HEALTH_WARNINGS}
- ⚠️ **${CRITICAL_FINDINGS} finding(s) crítico/high abertos** — verifique \`logs/findings.jsonl\` antes de iniciar nova tarefa."
    fi

    NET_CHECK_HOST="${HEALTH_CHECK_HOST:-140.82.112.22}"
    NET_TIMEOUT=3
    NET_OK=false
    if ping -c 1 -W "$NET_TIMEOUT" "$NET_CHECK_HOST" > /dev/null 2>&1; then
        NET_OK=true
    fi

    RECENT_RECONNECT_COUNT=0
    if [ -f "$AUDIT_FILE" ] && command -v jq > /dev/null 2>&1; then
        RECENT_RECONNECT_COUNT="$((\
            $(jq -r 'select(.event == "sessionReconnect") | .timestamp' "$AUDIT_FILE" 2> /dev/null | tail -50 | wc -l | tr -d ' ')))"
    fi
    RECENT_RECONNECT_COUNT="${RECENT_RECONNECT_COUNT:-0}"

    if [ "$NET_OK" = "false" ]; then
        HEALTH_CRITICAL="${HEALTH_CRITICAL}
- ⛔ **Sem conectividade de rede** (ping ${NET_CHECK_HOST} falhou). VS Code pode desconectar. Verifique WSL2/Docker network."
    fi

    if [ "${RECENT_RECONNECT_COUNT}" -ge 20 ] 2> /dev/null; then
        HEALTH_CRITICAL="${HEALTH_CRITICAL}
- ⛔ **Taxa crítica de reconexões VS Code** (${RECENT_RECONNECT_COUNT} reconexões detectadas). Instabilidade de conexão severa."
    elif [ "${RECENT_RECONNECT_COUNT}" -ge 5 ] 2> /dev/null; then
        HEALTH_WARNINGS="${HEALTH_WARNINGS}
- ⚠️ **Taxa elevada de reconexões VS Code** (${RECENT_RECONNECT_COUNT} reconexões). Verifique: extensões auto-update, rede/DNS, sleep do host."
    fi

    HEALTH_STATUS="✅ Sistema operacional"
    if [ -n "$HEALTH_CRITICAL" ]; then
        HEALTH_STATUS="⛔ CRÍTICO — verificação imediata necessária"
    elif [ -n "$HEALTH_WARNINGS" ]; then
        HEALTH_STATUS="⚠️ Avisos presentes"
    fi

    export HEALTH_CRITICAL HEALTH_WARNINGS HEALTH_STATUS AUDIT_LINES NET_CHECK_HOST NET_OK RECENT_RECONNECT_COUNT
    return 0
}
