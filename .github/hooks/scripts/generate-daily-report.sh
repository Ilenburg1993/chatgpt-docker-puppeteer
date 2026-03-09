#!/bin/bash
# generate-daily-report.sh — Gera relatório diário de atividade do sistema de hooks.
# Lê audit.jsonl e tool-metrics.jsonl e produz:
#   - Output rico no terminal (sumário)
#   - Arquivo Markdown em DOCUMENTAÇÃO/RELATORIOS/SESSIONS/daily-YYYYMMDD.md
#
# Uso: bash .github/hooks/scripts/generate-daily-report.sh [--quiet] [--no-file]
#   --quiet   : não imprime o sumário no terminal
#   --no-file : não grava o arquivo Markdown
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="$(cd "$HOOK_DIR/../.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
REPORTS_DIR="$PROJECT_DIR/DOCUMENTAÇÃO/RELATORIOS/SESSIONS"

QUIET=false
NO_FILE=false
for arg in "$@"; do
    case "$arg" in
        --quiet) QUIET=true ;;
        --no-file) NO_FILE=true ;;
    esac
done

AUDIT_FILE="$LOG_DIR/audit.jsonl"
METRICS_FILE="$LOG_DIR/tool-metrics.jsonl"
TASKS_FILE="$STATE_DIR/pending-tasks.md"
FINDINGS_FILE="$LOG_DIR/findings.jsonl"

TODAY="$(date -u '+%Y-%m-%d')"
TODAY_SHORT="$(date -u '+%Y%m%d')"
NOW="$(date -u '+%d/%m/%Y %H:%M UTC')"

# ── Contagem do backlog atual ────────────────────────────────────────────────
COUNT_ALTA=0
COUNT_MEDIA=0
COUNT_BACKLOG=0
COUNT_DONE=0

if [ -f "$TASKS_FILE" ]; then
    COUNT_ALTA="$(awk '/^## Alta Prioridade/{f=1} /^## / && !/^## Alta/{f=0} f && /^\- \[ \]/' "$TASKS_FILE" | wc -l | tr -d ' ')"
    COUNT_MEDIA="$(awk '/^## Média Prioridade/{f=1} /^## / && !/^## Média/{f=0} f && /^\- \[ \]/' "$TASKS_FILE" | wc -l | tr -d ' ')"
    COUNT_BACKLOG="$(awk '/^## Backlog/{f=1} /^## / && !/^## Backlog/{f=0} f && /^\- \[ \]/' "$TASKS_FILE" | wc -l | tr -d ' ')"
    COUNT_DONE="$(awk '/^\- \[x\]/{n++} END{print n+0}' "$TASKS_FILE" 2> /dev/null || echo 0)"
fi
TOTAL_OPEN=$((COUNT_ALTA + COUNT_MEDIA + COUNT_BACKLOG))

# ── Dados de hoje (a partir de audit.jsonl filtrando pelo timestamp do dia) ──
# Conta sessões hoje
SESSIONS_TODAY=0
TOOL_CALLS_TODAY=0
FAILURES_TODAY=0
SUBAGENTS_TODAY=0
COMPACTIONS_TODAY=0

if [ -f "$AUDIT_FILE" ] && [ -s "$AUDIT_FILE" ]; then
    # Filtra por prefixo ISO ("2026-03-15") — compatível com todos os eventos
    SESSIONS_TODAY="$(jq -r --arg d "$TODAY" \
        'select(.event == "sessionStart" and (.timestamp // "" | startswith($d))) | .session_id' \
        "$AUDIT_FILE" 2> /dev/null | sort -u | awk 'NF{n++} END{print n+0}' || echo 0)"

    TOOL_CALLS_TODAY="$(jq -r --arg d "$TODAY" \
        'select(.event == "preToolUse" and (.timestamp // "" | startswith($d)) and ((.tool_name // .toolName) // "") != "") | (.tool_name // .toolName)' \
        "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ' || echo 0)"

    # toolUseFailure = evento atual (tool-use-failure.sh); toolFailure = legado
    FAILURES_TODAY="$(jq -r --arg d "$TODAY" \
        'select((.event == "toolUseFailure" or .event == "toolFailure") and (.timestamp // "" | startswith($d))) | .event' \
        "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ' || echo 0)"

    # Subagentes iniciados hoje
    SUBAGENTS_TODAY="$(jq -r --arg d "$TODAY" \
        'select(.event == "subagentStart" and (.timestamp // "" | startswith($d))) | .event' \
        "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ' || echo 0)"

    # Compactações hoje
    COMPACTIONS_TODAY="$(jq -r --arg d "$TODAY" \
        'select(.event == "preCompact" and (.timestamp // "" | startswith($d))) | .event' \
        "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ' || echo 0)"
fi

# ── Dados históricos totais ──────────────────────────────────────────────────
TOTAL_SESSIONS=0
TOTAL_TOOL_CALLS=0
TOTAL_FAILURES=0

if [ -f "$AUDIT_FILE" ] && [ -s "$AUDIT_FILE" ]; then
    TOTAL_SESSIONS="$(jq -r '.session_id // empty' "$AUDIT_FILE" 2> /dev/null \
        | sort -u | awk 'NF{n++} END{print n+0}' || echo 0)"
    TOTAL_TOOL_CALLS="$(jq -r 'select(.event == "preToolUse" and ((.tool_name // .toolName) // "") != "") | (.tool_name // .toolName)' \
        "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ' || echo 0)"
    TOTAL_FAILURES="$(jq -r 'select(.event == "toolUseFailure" or .event == "toolFailure") | .event' \
        "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ' || echo 0)"
fi

ERROR_RATE="N/D"
if [ "$TOTAL_TOOL_CALLS" -gt 0 ] 2> /dev/null; then
    ERROR_RATE="$(echo "$TOTAL_FAILURES $TOTAL_TOOL_CALLS" \
        | awk '{printf "%.1f%%", ($1/$2)*100}')"
fi

# ── Top ferramentas (histórico) ──────────────────────────────────────────────
TOP_TOOLS_TABLE="| (nenhum dado ainda) | 0 |"
TOP_TOOLS_CHART=""
if [ -f "$AUDIT_FILE" ] && [ -s "$AUDIT_FILE" ]; then
    TOP_TOOLS_TABLE="$(jq -r 'select(.event == "preToolUse" and ((.tool_name // .toolName) // "") != "") | (.tool_name // .toolName)' \
        "$AUDIT_FILE" 2> /dev/null \
        | sort | uniq -c | sort -rn | head -8 \
        | awk '{printf "| `%-35s` | %5d |\n", $2, $1}' || true)"
    [ -z "$TOP_TOOLS_TABLE" ] && TOP_TOOLS_TABLE="| (nenhum dado ainda) | 0 |"

    # Gráfico de barras de texto (max 40 chars por barra)
    MAX_COUNT_LINE="$(jq -r 'select(.event == "preToolUse" and ((.tool_name // .toolName) // "") != "") | (.tool_name // .toolName)' \
        "$AUDIT_FILE" 2> /dev/null | sort | uniq -c | sort -rn | head -1 | awk '{print $1}' || echo 1)"
    [ "$MAX_COUNT_LINE" -eq 0 ] 2> /dev/null && MAX_COUNT_LINE=1

    TOP_TOOLS_CHART="$(jq -r 'select(.event == "preToolUse" and ((.tool_name // .toolName) // "") != "") | (.tool_name // .toolName)' \
        "$AUDIT_FILE" 2> /dev/null \
        | sort | uniq -c | sort -rn | head -8 \
        | awk -v max="$MAX_COUNT_LINE" '{
            bar_len = int(($1 / max) * 30);
            bar = "";
            for(i=0; i<bar_len; i++) bar = bar "█";
            printf "  %-30s %s %d\n", $2, bar, $1
        }' || true)"
    [ -z "$TOP_TOOLS_CHART" ] && TOP_TOOLS_CHART="  (nenhuma chamada de ferramenta registrada ainda)"
fi

# ── Performance por ferramenta ───────────────────────────────────────────────
PERF_TABLE="| (nenhum dado ainda) | — | 0 |"
PERF_CHART=""
if [ -f "$METRICS_FILE" ] && [ -s "$METRICS_FILE" ]; then
    PERF_TABLE="$(jq -r '(.tool_name // .toolName)' "$METRICS_FILE" 2> /dev/null \
        | sort -u \
        | while read -r tool; do
            AVG_MS="$(jq -r --arg t "$tool" \
                'select((.tool_name // .toolName) == $t) | .duration_ms' \
                "$METRICS_FILE" 2> /dev/null \
                | awk '{s+=$1; n++} END {if(n>0) printf "%.0f", s/n; else print "N/D"}')"
            COUNT_T="$(jq -r --arg t "$tool" \
                'select((.tool_name // .toolName) == $t) | (.tool_name // .toolName)' \
                "$METRICS_FILE" 2> /dev/null | wc -l | tr -d ' ')"
            printf "| \`%-35s\` | %6s ms | %4d |\n" "$tool" "$AVG_MS" "$COUNT_T"
        done \
        | sort -t'|' -k3 -rn | head -8 || true)"
    [ -z "$PERF_TABLE" ] && PERF_TABLE="| (nenhum dado ainda) | — | 0 |"

    MAX_AVG="$(jq -r '(.tool_name // .toolName)' "$METRICS_FILE" 2> /dev/null \
        | sort -u \
        | while read -r tool; do
            jq -r --arg t "$tool" \
                'select((.tool_name // .toolName) == $t) | .duration_ms' \
                "$METRICS_FILE" 2> /dev/null \
                | awk '{s+=$1; n++} END {if(n>0) printf "%.0f\n", s/n}'
        done | sort -n | tail -1 || echo 1)"
    [ -z "$MAX_AVG" ] || [ "$MAX_AVG" -eq 0 ] 2> /dev/null && MAX_AVG=1

    PERF_CHART="$(jq -r '(.tool_name // .toolName)' "$METRICS_FILE" 2> /dev/null \
        | sort -u \
        | while read -r tool; do
            AVG_MS="$(jq -r --arg t "$tool" \
                'select((.tool_name // .toolName) == $t) | .duration_ms' \
                "$METRICS_FILE" 2> /dev/null \
                | awk '{s+=$1; n++} END {if(n>0) printf "%.0f", s/n; else print "0"}')"
            echo "$AVG_MS $tool"
        done | sort -rn | head -8 \
        | awk -v max="$MAX_AVG" '{
            bar_len = int(($1 / max) * 30);
            bar = "";
            for(i=0; i<bar_len; i++) bar = bar "▓";
            printf "  %-30s %s %sms\n", $2, bar, $1
        }' || true)"
    [ -z "$PERF_CHART" ] && PERF_CHART="  (nenhuma métrica de performance ainda — execute uma sessão real para coletar)"
fi

# ── Findings ─────────────────────────────────────────────────────────────────
FINDINGS_TOTAL=0
FINDINGS_CRITICAL=0
FINDINGS_LIST="- (nenhum finding registrado)"
if [ -f "$FINDINGS_FILE" ] && [ -s "$FINDINGS_FILE" ]; then
    FINDINGS_TOTAL="$(wc -l < "$FINDINGS_FILE" | tr -d ' ')"
    FINDINGS_CRITICAL="$(jq -r 'select(.severity == "critical" or .severity == "high") | .severity' \
        "$FINDINGS_FILE" 2> /dev/null | wc -l | tr -d ' ' || echo 0)"
    FINDINGS_LIST="$(jq -r '"- [\(.severity | ascii_upcase)] `\(.module // "?")`: \(.description // "" | .[0:100])"' \
        "$FINDINGS_FILE" 2> /dev/null | tail -10 || echo '- (erro ao ler findings)')"
    [ -z "$FINDINGS_LIST" ] && FINDINGS_LIST="- (nenhum finding registrado)"
fi

# ── Compliance de autorização ─────────────────────────────────────────────────
AUTH_AUTHORIZED_TOTAL=0
AUTH_UNAUTHORIZED_TOTAL=0
AUTH_AUTHORIZED_TODAY=0
AUTH_UNAUTHORIZED_TODAY=0
AUTH_COMPLIANCE_RATE="N/D"

if [ -f "$AUDIT_FILE" ]; then
    AUTH_AUTHORIZED_TOTAL="$(jq -r 'select(.event == "turnEnd_authorized")' \
        "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ')"
    AUTH_UNAUTHORIZED_TOTAL="$(jq -r 'select(.event == "turnEnd_UNAUTHORIZED")' \
        "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ')"
    AUTH_AUTHORIZED_TODAY="$(jq -r --arg d "${TODAY}" \
        'select(.event == "turnEnd_authorized" and (.timestamp // "" | startswith($d)))' \
        "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ')"
    AUTH_UNAUTHORIZED_TODAY="$(jq -r --arg d "${TODAY}" \
        'select(.event == "turnEnd_UNAUTHORIZED" and (.timestamp // "" | startswith($d)))' \
        "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ')"
    AUTH_TOTAL=$((AUTH_AUTHORIZED_TOTAL + AUTH_UNAUTHORIZED_TOTAL))
    if [ "$AUTH_TOTAL" -gt 0 ]; then
        AUTH_COMPLIANCE_RATE="$(awk "BEGIN {printf \"%.0f%%\", ($AUTH_AUTHORIZED_TOTAL / $AUTH_TOTAL) * 100}")"
    fi
fi
AUTH_CONSECUTIVE="$(jq -r '.compliance.consecutive_unauthorized // 0' "$STATE_DIR/session-context.json" 2> /dev/null || echo 0)"
AUTH_FLAG_EXISTS="não"
[ -f "$STATE_DIR/UNAUTHORIZED_CLOSE.flag" ] && AUTH_FLAG_EXISTS="⚠️ SIM — última sessão não autorizada"

# ── Quality gates (da sessão mais recente) ────────────────────────────────────
QUALITY_GATES="- (nenhum gate registrado nesta sessão)"
CTX_FILE="$STATE_DIR/session-context.json"
if [ -f "$CTX_FILE" ]; then
    QUALITY_GATES="$(jq -r '
        .quality_gates // {} |
        to_entries[] |
        "- `\(.key | gsub("gate_"; "npm run ") | gsub("_"; ":"))`: \(.value.result)"
    ' "$CTX_FILE" 2> /dev/null || echo "- (nenhum gate registrado)")"
    [ -z "$QUALITY_GATES" ] && QUALITY_GATES="- (nenhum gate registrado nesta sessão)"
fi

# ── Output terminal ──────────────────────────────────────────────────────────
if [ "$QUIET" = false ]; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║          HOOKS STATUS — ${TODAY}                    ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "  BACKLOG                              HOJE              HISTÓRICO"
    echo "  ─────────────────────────────────    ────────────────  ─────────────────"
    printf "  🔴 Alta:      %-4s tarefas abertas    Sessões: %-6s   Total sessões: %s\n" "$COUNT_ALTA" "$SESSIONS_TODAY" "$TOTAL_SESSIONS"
    printf "  🟡 Média:     %-4s tarefas abertas    Ferramentas: %-4s Total chamadas: %s\n" "$COUNT_MEDIA" "$TOOL_CALLS_TODAY" "$TOTAL_TOOL_CALLS"
    printf "  🔵 Backlog:   %-4s tarefas abertas    Falhas: %-6s   Taxa falha: %s\n" "$COUNT_BACKLOG" "$FAILURES_TODAY" "$ERROR_RATE"
    printf "  ✅ Concluídas: %-4s                   Subagentes: %-4s Compactações: %s\n" "$COUNT_DONE" "$SUBAGENTS_TODAY" "$COMPACTIONS_TODAY"
    echo ""
    echo "  TOP FERRAMENTAS (chamadas, histór.)"
    echo "  ────────────────────────────────────────────────────────────"
    echo "$TOP_TOOLS_CHART"
    echo ""
    echo "  PERFORMANCE MÉDIA POR FERRAMENTA"
    echo "  ────────────────────────────────────────────────────────────"
    echo "$PERF_CHART"
    echo ""
fi

# ── Grava arquivo Markdown ───────────────────────────────────────────────────
if [ "$NO_FILE" = false ]; then
    mkdir -p "$REPORTS_DIR"
    REPORT_FILE="$REPORTS_DIR/daily-${TODAY_SHORT}.md"

    cat > "$REPORT_FILE" << REPORT_EOF
# Relatório Diário — ${TODAY}

> Gerado em: ${NOW}
> Fonte: \`.github/hooks/logs/audit.jsonl\` + \`tool-metrics.jsonl\`

---

## Estado do Backlog

| Prioridade | Tarefas abertas |
|---|---|
| 🔴 Alta | ${COUNT_ALTA} |
| 🟡 Média | ${COUNT_MEDIA} |
| 🔵 Backlog Livre | ${COUNT_BACKLOG} |
| ✅ Concluídas | ${COUNT_DONE} |
| **Total aberto** | **${TOTAL_OPEN}** |

---

## Atividade de Hoje

| Métrica | Valor |
|---|---|
| Sessões iniciadas | ${SESSIONS_TODAY} |
| Chamadas de ferramentas | ${TOOL_CALLS_TODAY} |
| Falhas de ferramentas | ${FAILURES_TODAY} |
| Erros do agente | ${ERRORS_TODAY} |

---

## Histórico Acumulado

| Métrica | Valor |
|---|---|
| Sessões totais | ${TOTAL_SESSIONS} |
| Chamadas de ferramentas (total) | ${TOTAL_TOOL_CALLS} |
| Taxa de falha global | ${ERROR_RATE} |
| Findings registrados | ${FINDINGS_TOTAL} |
| Findings críticos/high | ${FINDINGS_CRITICAL} |

---

## Top Ferramentas (histórico)

| Ferramenta | Chamadas |
|---|---|
${TOP_TOOLS_TABLE}

### Gráfico de uso

\`\`\`
${TOP_TOOLS_CHART}
\`\`\`

---

## Performance por Ferramenta

| Ferramenta | Média | Amostras |
|---|---|---|
${PERF_TABLE}

### Gráfico de latência média

\`\`\`
${PERF_CHART}
\`\`\`

---

## Conformidade de Autorização (vscode_askQuestions)

| Métrica | Hoje | Histórico |
|---|---|---|
| Turnos autorizados | ${AUTH_AUTHORIZED_TODAY} | ${AUTH_AUTHORIZED_TOTAL} |
| Violações (turnEnd_UNAUTHORIZED) | ${AUTH_UNAUTHORIZED_TODAY} | ${AUTH_UNAUTHORIZED_TOTAL} |
| Taxa de conformidade | — | ${AUTH_COMPLIANCE_RATE} |
| Violações consecutivas (agora) | — | ${AUTH_CONSECUTIVE} |
| Flag UNAUTHORIZED_CLOSE ativo | ${AUTH_FLAG_EXISTS} | — |

---

## Quality Gates (sessão mais recente)

${QUALITY_GATES}

---

## Findings Recentes

${FINDINGS_LIST}

---

*Gerado automaticamente por \`.github/hooks/scripts/generate-daily-report.sh\`*
REPORT_EOF

    echo "  📄 Relatório gravado: ${REPORT_FILE}"
fi

exit 0
