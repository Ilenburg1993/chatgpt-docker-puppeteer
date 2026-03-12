#!/bin/bash
# export-metrics.sh — Exporta tool-metrics.jsonl para CSV ou JSON com filtro de período
#
# Uso: bash .github/hooks/scripts/export-metrics.sh [csv|json] [data_inicio] [data_fim]
#
#   formato:     csv (padrão) | json
#   data_inicio: ISO date parcial (e.g. "2026-03-01"); filtra timestamps >= data_inicio
#   data_fim:    ISO date parcial (e.g. "2026-03-09"); filtra timestamps <= data_fim + 23:59:59
#
# Saída: stdout (redirecione para arquivo quando necessário)
#
# Exemplos:
#   bash .github/hooks/scripts/export-metrics.sh csv > metricas.csv
#   bash .github/hooks/scripts/export-metrics.sh csv 2026-03-01 2026-03-09 > metricas-marco.csv
#   bash .github/hooks/scripts/export-metrics.sh json 2026-03-09 > hoje.json
#
# CSV output: timestamp,session_id,tool_name,duration_ms,result_type
# JSON output: array de objetos com os mesmos campos
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
METRICS_FILE="$LOG_DIR/tool-metrics.jsonl"
AUDIT_FILE="$LOG_DIR/audit.jsonl"
# UPG-AUDIT-01 Fase 3: merge all per-session audit files for cross-session export
_SID_AUDIT_FILES=()
for _f in "$LOG_DIR"/audit-????????.jsonl; do [ -f "$_f" ] && _SID_AUDIT_FILES+=("$_f"); done
if [ ${#_SID_AUDIT_FILES[@]} -gt 0 ] && _MERGED_AUDIT="$(mktemp 2> /dev/null)"; then
    trap 'rm -f "${_MERGED_AUDIT:-}"' EXIT
    cat "${_SID_AUDIT_FILES[@]}" > "$_MERGED_AUDIT" 2> /dev/null || true
    AUDIT_FILE="$_MERGED_AUDIT"
fi

FORMAT="${1:-csv}"
DATE_START="${2:-}"
DATE_END="${3:-}"

if [ "$FORMAT" != "csv" ] && [ "$FORMAT" != "json" ]; then
    echo "Formato inválido: '$FORMAT'. Use csv ou json." >&2
    exit 1
fi

# Verifica disponibilidade de jq
if ! command -v jq > /dev/null 2>&1; then
    echo "Erro: jq não encontrado. Instale com: apt-get install jq" >&2
    exit 1
fi

# Monta filtro de período como condição jq
PERIOD_FILTER="."
if [ -n "$DATE_START" ] && [ -n "$DATE_END" ]; then
    PERIOD_FILTER="select(.timestamp >= \"${DATE_START}\" and .timestamp <= \"${DATE_END}T23:59:59Z\")"
elif [ -n "$DATE_START" ]; then
    PERIOD_FILTER="select(.timestamp >= \"${DATE_START}\")"
elif [ -n "$DATE_END" ]; then
    PERIOD_FILTER="select(.timestamp <= \"${DATE_END}T23:59:59Z\")"
fi

# ── Exportação de tool-metrics.jsonl ────────────────────────────────────────
export_metrics() {
    local src_file="$1"
    local label="$2" # "metrics" ou "compliance"

    if [ ! -f "$src_file" ]; then
        echo "# Aviso: $src_file não encontrado" >&2
        return 0
    fi

    if [ "$FORMAT" = "csv" ]; then
        jq -r \
            --arg filter "$label" \
            "
            $PERIOD_FILTER |
            select(.event == \"toolUse\" or .event == \"tool_use\" or .duration_ms != null) |
            [
                (.timestamp // \"\"),
                (.session_id // \"\"),
                (.tool_name // \"\"),
                (.duration_ms // 0 | tostring),
                (.result_type // \"unknown\")
            ] | @csv
            " "$src_file" 2> /dev/null || true
    else
        jq -s \
            "
            [ .[] |
              $PERIOD_FILTER |
              select(.event == \"toolUse\" or .event == \"tool_use\" or .duration_ms != null) |
              {
                timestamp:   (.timestamp // \"\"),
                session_id:  (.session_id // \"\"),
                tool_name:   (.tool_name // \"\"),
                duration_ms: (.duration_ms // 0),
                result_type: (.result_type // \"unknown\")
              }
            ]
            " "$src_file" 2> /dev/null || echo "[]"
    fi
}

# ── Exportação de compliance por sessão a partir de audit.jsonl ──────────────
export_compliance() {
    if [ ! -f "$AUDIT_FILE" ]; then
        return 0
    fi

    if [ "$FORMAT" = "csv" ]; then
        jq -r \
            "
            $PERIOD_FILTER |
            select(.event == \"turnEnd_UNAUTHORIZED\" or .event == \"turnEnd_authorized\") |
            [
                (.timestamp // \"\"),
                (.session_id // \"\"),
                \"compliance\",
                \"0\",
                (if .event == \"turnEnd_authorized\" then \"authorized\" else \"unauthorized\" end)
            ] | @csv
            " "$AUDIT_FILE" 2> /dev/null || true
    else
        jq -s \
            "
            [ .[] |
              $PERIOD_FILTER |
              select(.event == \"turnEnd_UNAUTHORIZED\" or .event == \"turnEnd_authorized\") |
              {
                timestamp:   (.timestamp // \"\"),
                session_id:  (.session_id // \"\"),
                event:       .event,
                authorized:  (if .event == \"turnEnd_authorized\" then true else false end)
              }
            ]
            " "$AUDIT_FILE" 2> /dev/null || echo "[]"
    fi
}

# ── Resumo de sessões (summary) ──────────────────────────────────────────────
export_session_summary() {
    if [ ! -f "$AUDIT_FILE" ]; then
        return 0
    fi

    if [ "$FORMAT" = "csv" ]; then
        # Contagens de eventos por sessão
        jq -r \
            "
            $PERIOD_FILTER |
            select(.event == \"sessionStart\") |
            [
                (.timestamp // \"\"),
                (.session_id // \"\"),
                \"session\",
                \"0\",
                \"start\"
            ] | @csv
            " "$AUDIT_FILE" 2> /dev/null || true
    fi
}

# ── Output principal ──────────────────────────────────────────────────────────
if [ "$FORMAT" = "csv" ]; then
    # Cabeçalho
    echo "timestamp,session_id,tool_name,duration_ms,result_type"
    # Dados de métricas
    export_metrics "$METRICS_FILE" "metrics"
    # Dados de compliance (como linhas extras com tool_name=compliance)
    export_compliance
else
    # JSON: objeto com seções separadas
    METRICS_JSON="$(export_metrics "$METRICS_FILE" "metrics")"
    COMPLIANCE_JSON="$(export_compliance)"

    jq -cn \
        --argjson metrics "${METRICS_JSON:-[]}" \
        --argjson compliance "${COMPLIANCE_JSON:-[]}" \
        --arg date_start "$DATE_START" \
        --arg date_end "$DATE_END" \
        --arg generated_at "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
        '{
            generated_at:    $generated_at,
            filters: {
                date_start: (if $date_start != "" then $date_start else null end),
                date_end:   (if $date_end != "" then $date_end else null end)
            },
            metrics:    $metrics,
            compliance: $compliance
        }'
fi

exit 0
