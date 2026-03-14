#!/bin/bash
# analytics.sh — Relatório de análise cross-session do sistema de hooks
#
# Lê audit.jsonl, tool-metrics.jsonl e findings.jsonl para produzir um relatório
# Markdown con métricas agregadas por sessão, top ferramentas, compliance e findings.
#
# Uso:
#   bash .github/hooks/scripts/analytics.sh
#   bash .github/hooks/scripts/analytics.sh --output relatorio.md
#   bash .github/hooks/scripts/analytics.sh --json      (saída JSON em vez de Markdown)
#
# Opções:
#   --output <arquivo>  Salva o relatório no arquivo especificado (padrão: stdout)
#   --json              Saída em JSON (útil para automação e pipelines)
#
# Exemplos:
#   bash .github/hooks/scripts/analytics.sh
#   bash .github/hooks/scripts/analytics.sh --output DOCUMENTAÇÃO/HOOKS/analytics-$(date +%Y%m%d).md
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"

AUDIT_FILE="$LOG_DIR/audit.jsonl"
METRICS_FILE="$LOG_DIR/tool-metrics.jsonl"
FINDINGS_FILE="$LOG_DIR/findings.jsonl"
# UPG-AUDIT-01 Fase 3: merge all per-session audit files for cross-session analytics
# Pattern audit-????????.jsonl matches SID_SHORT (8 hex chars), not archive files (contain '_')
_SID_AUDIT_FILES=()
for _f in "$LOG_DIR"/audit-????????.jsonl; do [ -f "$_f" ] && _SID_AUDIT_FILES+=("$_f"); done
if [ ${#_SID_AUDIT_FILES[@]} -gt 0 ] && _MERGED_AUDIT="$(mktemp 2> /dev/null)"; then
    trap 'rm -f "${_MERGED_AUDIT:-}"' EXIT
    cat "${_SID_AUDIT_FILES[@]}" > "$_MERGED_AUDIT" 2> /dev/null || true
    AUDIT_FILE="$_MERGED_AUDIT"
fi

OUTPUT_FILE=""
OUTPUT_JSON=false

while [ $# -gt 0 ]; do
    case "${1:-}" in
        --output)
            shift
            OUTPUT_FILE="${1:-}"
            ;;
        --json)
            OUTPUT_JSON=true
            ;;
        *)
            echo "Opção desconhecida: '${1}'. Use --output <arquivo> ou --json." >&2
            exit 1
            ;;
    esac
    shift
done

NOW="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo 'unknown')"
AUDIT_LINES=0
[ -f "$AUDIT_FILE" ] && AUDIT_LINES="$(wc -l < "$AUDIT_FILE" | tr -d ' ')"

# ─────────────────────────────────────────────────────────────────────────────
# Computa métricas globais
# ─────────────────────────────────────────────────────────────────────────────
TOTAL_SESSIONS=0
TOTAL_TOOLS=0
TOTAL_ERRORS=0
TOTAL_AUTH=0
TOTAL_UNAUTH=0

if [ -f "$AUDIT_FILE" ] && [ -s "$AUDIT_FILE" ]; then
    TOTAL_SESSIONS="$(jq -r '.session_id // empty' "$AUDIT_FILE" 2> /dev/null | sort -u | wc -l | tr -d ' ')"
    TOTAL_TOOLS="$(jq -r 'select(.event == "preToolUse") | .event' "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ')"
    TOTAL_ERRORS="$(jq -r 'select(.event == "toolUseFailure") | .event' "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ')"
    TOTAL_AUTH="$(jq -r 'select(.event == "turnEnd_authorized") | .event' "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ')"
    TOTAL_UNAUTH="$(jq -r 'select(.event == "turnEnd_no_askQuestions") | .event' "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ')"
fi

TOTAL_TURNS=$((TOTAL_AUTH + TOTAL_UNAUTH))
COMPLIANCE_PCT="N/D"
if [ "$TOTAL_TURNS" -gt 0 ] 2> /dev/null; then
    COMPLIANCE_PCT="$(echo "$TOTAL_AUTH $TOTAL_TURNS" | awk '{printf "%.1f%%", ($1/$2)*100}')"
fi

# Findings
TOTAL_FINDINGS=0
RESOLVED_FINDINGS=0
OPEN_FINDINGS=0
if [ -f "$FINDINGS_FILE" ] && [ -s "$FINDINGS_FILE" ]; then
    TOTAL_FINDINGS="$(jq -r 'select(.event == "finding") | .event' "$FINDINGS_FILE" 2> /dev/null | wc -l | tr -d ' ')"
    RESOLVED_FINDINGS="$(jq -r 'select(.event == "findingResolved") | .event' "$FINDINGS_FILE" 2> /dev/null | wc -l | tr -d ' ')"
    OPEN_FINDINGS=$((TOTAL_FINDINGS - RESOLVED_FINDINGS))
fi

# ─────────────────────────────────────────────────────────────────────────────
# Saída JSON (modo--json)
# ─────────────────────────────────────────────────────────────────────────────
if [ "$OUTPUT_JSON" = "true" ]; then
    jq -cn \
        --arg ts "$NOW" \
        --argjson sessions "$TOTAL_SESSIONS" \
        --argjson tools "$TOTAL_TOOLS" \
        --argjson errors "$TOTAL_ERRORS" \
        --argjson auth "$TOTAL_AUTH" \
        --argjson unauth "$TOTAL_UNAUTH" \
        --argjson turns "$TOTAL_TURNS" \
        --arg compliance "$COMPLIANCE_PCT" \
        --argjson audit_lines "$AUDIT_LINES" \
        --argjson findings_total "$TOTAL_FINDINGS" \
        --argjson findings_resolved "$RESOLVED_FINDINGS" \
        --argjson findings_open "$OPEN_FINDINGS" \
        '{
            generated_at:      $ts,
            sessions:          $sessions,
            tools_total:       $tools,
            errors_total:      $errors,
            turns_authorized:  $auth,
            turns_unauthorized: $unauth,
            turns_total:       $turns,
            compliance_pct:    $compliance,
            audit_lines:       $audit_lines,
            findings: {
                total:    $findings_total,
                resolved: $findings_resolved,
                open:     $findings_open
            }
        }'
    exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Gerador de relatório Markdown
# ─────────────────────────────────────────────────────────────────────────────
generate_report() {
    echo "# Analytics Cross-Session — Sistema de Hooks"
    echo ""
    echo "> Gerado em \`${NOW}\` — lê \`audit.jsonl\` (${AUDIT_LINES} linhas), \`tool-metrics.jsonl\` e \`findings.jsonl\`."
    echo ""

    if [ ! -f "$AUDIT_FILE" ] || [ ! -s "$AUDIT_FILE" ]; then
        echo "Sem dados de auditoria disponíveis. O arquivo \`audit.jsonl\` está vazio ou não existe."
        return
    fi

    # ── Resumo Global ────────────────────────────────────────────────────────
    echo "## Resumo Global"
    echo ""
    echo "| Métrica | Valor |"
    echo "|---|---|"
    echo "| Sessões únicas | ${TOTAL_SESSIONS} |"
    echo "| Total de chamadas de ferramenta | ${TOTAL_TOOLS} |"
    echo "| Total de erros registrados | ${TOTAL_ERRORS} |"
    echo "| Turnos totais | ${TOTAL_TURNS} |"
    echo "| Turnos autorizados | ${TOTAL_AUTH} |"
    echo "| Turnos NÃO autorizados | ${TOTAL_UNAUTH} |"
    echo "| **Taxa de compliance** | **${COMPLIANCE_PCT}** |"
    echo "| Linhas em audit.jsonl | ${AUDIT_LINES} |"
    echo ""

    # ── Top 10 Ferramentas ───────────────────────────────────────────────────
    echo "## Top 10 Ferramentas (all-time)"
    echo ""
    echo "| # | Ferramenta | Chamadas | % do total |"
    echo "|---|---|---|---|"
    jq -r 'select(.event == "preToolUse") | .tool_name // "desconhecida"' \
        "$AUDIT_FILE" 2> /dev/null \
        | sort | uniq -c | sort -rn | head -10 \
        | awk -v total="${TOTAL_TOOLS:-1}" \
            'BEGIN{n=0} {n++; pct=($1/total)*100; printf "| %2d | `%-40s` | %5d | %5.1f%% |\n", n, $2, $1, pct}'
    echo ""

    # ── Performance por ferramenta ───────────────────────────────────────────
    if [ -f "$METRICS_FILE" ] && [ -s "$METRICS_FILE" ]; then
        echo "## Performance por Ferramenta (médias históricas)"
        echo ""
        echo "| Ferramenta | Avg (ms) | P50 (ms) | P95 (ms) | Amostras |"
        echo "|---|---|---|---|---|"
        jq -r '.tool_name // "desconhecida"' "$METRICS_FILE" 2> /dev/null | sort -u \
            | while IFS= read -r tool; do
                VALS="$(jq -r --arg t "$tool" \
                    'select(.tool_name == $t) | .duration_ms' \
                    "$METRICS_FILE" 2> /dev/null | sort -n)"
                N="$(echo "$VALS" | grep -c '^[0-9]' 2> /dev/null | tr -d ' ' || echo 0)"
                if [ "${N}" -lt 1 ] 2> /dev/null; then continue; fi
                AVG="$(echo "$VALS" | awk '{s+=$1;n++} END{if(n>0) printf "%.0f", s/n; else print "—"}')"
                P50="$(echo "$VALS" | awk -v n="$N" 'NR==int(n/2)+1{print; exit}' | head -1)"
                P95_IDX="$(echo "$N" | awk '{printf "%d", int($1*0.95)+1}')"
                P95="$(echo "$VALS" | sed -n "${P95_IDX}p" | head -1)"
                printf "| \`%-40s\` | %8s | %8s | %8s | %6d |\n" \
                    "$tool" "${AVG:-—}" "${P50:-—}" "${P95:-—}" "$N"
            done | sort -t'|' -k3 -rn | head -12
        echo ""
    fi

    # ── Compliance por sessão ────────────────────────────────────────────────
    echo "## Compliance por Sessão"
    echo ""
    echo "| Status | Session ID | Turnos | Autorizados | Não-autorizados | Taxa |"
    echo "|---|---|---|---|---|---|"
    jq -r '.session_id // empty' "$AUDIT_FILE" 2> /dev/null | sort -u \
        | while IFS= read -r sid; do
            [ -z "$sid" ] && continue
            SID_SHORT="${sid:0:8}..."
            S_AUTH="$(jq -r --arg sid "$sid" \
                'select(.event == "turnEnd_authorized" and .session_id == $sid) | .event' \
                "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ')"
            S_UNAUTH="$(jq -r --arg sid "$sid" \
                'select(.event == "turnEnd_no_askQuestions" and .session_id == $sid) | .event' \
                "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ')"
            S_TOTAL=$((S_AUTH + S_UNAUTH))
            [ "$S_TOTAL" -eq 0 ] 2> /dev/null && continue
            S_PCT="$(echo "$S_AUTH $S_TOTAL" | awk '{printf "%.0f%%", ($1/$2)*100}')"
            if [ "${S_UNAUTH}" -gt 0 ] 2> /dev/null; then
                ICON="⚠️"
            else
                ICON="✅"
            fi
            printf "| %s | \`%s\` | %d | %d | %d | %s |\n" \
                "$ICON" "$SID_SHORT" "$S_TOTAL" "$S_AUTH" "$S_UNAUTH" "$S_PCT"
        done
    echo ""

    # ── Findings ─────────────────────────────────────────────────────────────
    if [ -f "$FINDINGS_FILE" ] && [ -s "$FINDINGS_FILE" ]; then
        echo "## Findings"
        echo ""
        echo "| Status | Count |"
        echo "|---|---|"
        echo "| Total registrado | ${TOTAL_FINDINGS} |"
        echo "| Resolvidos | ${RESOLVED_FINDINGS} |"
        echo "| **Abertos** | **${OPEN_FINDINGS}** |"
        echo ""

        echo "### Por Severidade"
        echo ""
        echo "| Severidade | Ícone | Total | Resolvidos | Abertos |"
        echo "|---|---|---|---|---|"
        for SEV in critical high medium low info; do
            case "$SEV" in
                critical) ICON="🔴" ;;
                high) ICON="🟠" ;;
                medium) ICON="🟡" ;;
                low) ICON="🔵" ;;
                info) ICON="⚪" ;;
            esac
            SEV_TOTAL="$(jq -r --arg s "$SEV" \
                'select(.event == "finding" and .severity == $s) | .event' \
                "$FINDINGS_FILE" 2> /dev/null | wc -l | tr -d ' ')"
            [ "${SEV_TOTAL}" -eq 0 ] 2> /dev/null && continue
            # Resolvidos nesta severidade: conta IDs com resolução correspondente
            SEV_IDS="$(jq -r --arg s "$SEV" \
                'select(.event == "finding" and .severity == $s) | .finding_id // empty' \
                "$FINDINGS_FILE" 2> /dev/null)"
            SEV_RESOLVED=0
            if [ -n "$SEV_IDS" ]; then
                SEV_RESOLVED="$(
                    while IFS= read -r fid; do
                        [ -z "$fid" ] && continue
                        jq -r --arg id "$fid" \
                            'select(.event == "findingResolved" and .finding_id == $id) | .event' \
                            "$FINDINGS_FILE" 2> /dev/null
                    done <<< "$SEV_IDS" | wc -l | tr -d ' '
                )"
            fi
            SEV_OPEN=$((SEV_TOTAL - SEV_RESOLVED))
            printf "| %-8s | %s | %5d | %10d | %6d |\n" "$SEV" "$ICON" "$SEV_TOTAL" "$SEV_RESOLVED" "$SEV_OPEN"
        done
        echo ""

        # Lista findings abertos mais recentes
        OPEN_LIST="$(jq -rs '
            [ .[] | select(.event == "finding") ] as $findings |
            [ .[] | select(.event == "findingResolved") | .finding_id ] as $resolved |
            $findings | map(select(.finding_id as $id | ($resolved | index($id)) == null))
            | sort_by(.timestamp) | reverse | .[0:10]
            | .[] | "- [\(.severity)] `\(.finding_id // "—")` **\(.module)**: \(.description[:80])"
        ' "$FINDINGS_FILE" 2> /dev/null || true)"

        if [ -n "$OPEN_LIST" ]; then
            echo "### Findings Abertos Mais Recentes (máx. 10)"
            echo ""
            echo "$OPEN_LIST"
            echo ""
        fi
    fi

    # ── Actividade por dia ───────────────────────────────────────────────────
    echo "## Atividade por Dia"
    echo ""
    echo "| Data | Chamadas de ferramenta | Sessões |"
    echo "|---|---|---|"
    jq -r 'select(.event == "preToolUse") | .timestamp // empty | split("T") | .[0]' \
        "$AUDIT_FILE" 2> /dev/null \
        | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' \
        | sort | uniq -c | sort -rn | head -14 \
        | while read -r cnt day; do
            SESS_DAY="$(jq -r --arg d "$day" \
                'select(.event == "sessionStart") | .timestamp // empty | split("T") | .[0] | select(. == $d)' \
                "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ')"
            printf "| %s | %5d | %4d |\n" "$day" "$cnt" "$SESS_DAY"
        done
    echo ""

    echo "---"
    echo "*Relatório gerado por analytics.sh — ${NOW}*"
}

if [ -n "$OUTPUT_FILE" ]; then
    generate_report > "$OUTPUT_FILE"
    echo "Relatório salvo em: ${OUTPUT_FILE}" >&2
else
    generate_report
fi

exit 0
