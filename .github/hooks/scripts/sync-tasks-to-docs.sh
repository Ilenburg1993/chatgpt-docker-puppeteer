#!/bin/bash
# sync-tasks-to-docs.sh — Exporta snapshot de tarefas para DOCUMENTAÇÃO/RELATORIOS/
#
# Gera um relatório Markdown com:
#   - Tarefas pendentes por prioridade (com links para findings vinculados)
#   - Tarefas concluídas com referência a findings resolvidos
#   - Tabela de correlação finding_id ↔ tarefa
#
# Uso: bash .github/hooks/scripts/sync-tasks-to-docs.sh [--output <arquivo>]
#
#   --output <arquivo>: caminho de saída (padrão: DOCUMENTAÇÃO/RELATORIOS/tasks-YYYYMMDD.md)
#
# Executa sem efeito colateral se findings.jsonl não existir (avisa e continua).
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
TASKS_FILE="$HOOK_DIR/state/pending-tasks.md"
FINDINGS_FILE="$HOOK_DIR/logs/findings.jsonl"
DOCS_DIR="$REPO_ROOT/DOCUMENTAÇÃO/RELATORIOS"
DATE_STAMP="$(date -u '+%Y%m%d')"
DATE_HUMAN="$(date -u '+%Y-%m-%d %H:%M UTC')"

OUTPUT_FILE=""
while [ $# -gt 0 ]; do
    case "${1:-}" in
        --output)
            shift
            OUTPUT_FILE="${1:-}"
            ;;
    esac
    shift
done

[ -z "$OUTPUT_FILE" ] && OUTPUT_FILE="$DOCS_DIR/tasks-${DATE_STAMP}.md"

if [ ! -f "$TASKS_FILE" ]; then
    echo "Erro: pending-tasks.md não encontrado em $TASKS_FILE" >&2
    exit 1
fi

mkdir -p "$(dirname "$OUTPUT_FILE")"

# ────────────────────────────────────────────────────────────────────────────
# Coleta findings do findings.jsonl (se existir)
# Mapeia finding_id → severity/type/description/status
# ────────────────────────────────────────────────────────────────────────────
FINDINGS_MAP=""
RESOLVED_IDS=""
HAS_FINDINGS=false

if [ -f "$FINDINGS_FILE" ] && command -v jq > /dev/null 2>&1; then
    HAS_FINDINGS=true

    # IDs resolvidos
    RESOLVED_IDS="$(jq -r 'select(.event=="findingResolved") | .finding_id // empty' \
        "$FINDINGS_FILE" 2> /dev/null | sort -u || echo '')"

    # Mapa de findings (apenas eventos "finding", sem resolved)
    FINDINGS_MAP="$(jq -r '
        select(.event=="finding" and .finding_id != null and .finding_id != "") |
        [.finding_id, .severity, .type, (.description // "" | .[0:60])] | @tsv
    ' "$FINDINGS_FILE" 2> /dev/null || echo '')"
fi

# Verifica se um finding_id está resolvido
is_resolved() {
    local fid="$1"
    echo "$RESOLVED_IDS" | grep -qxF "$fid"
}

# Obtém info de um finding por id (retorna "severity|type|description" ou "")
get_finding_info() {
    local fid="$1"
    echo "$FINDINGS_MAP" | awk -F'\t' -v id="$fid" '$1==id {print $2"|"$3"|"$4; exit}'
}

# ────────────────────────────────────────────────────────────────────────────
# Analisa pending-tasks.md linha a linha para extrair tarefas + finding_id
# ────────────────────────────────────────────────────────────────────────────
declare -a OPEN_ALTA=()
declare -a OPEN_MEDIA=()
declare -a OPEN_BACKLOG=()
declare -a DONE_TASKS=()
declare -a XREF_ROWS=()    # Correlação finding ↔ tarefa

CURRENT_SECTION=""
while IFS= read -r line; do
    case "$line" in
        "## Alta Prioridade"*)  CURRENT_SECTION="alta" ;;
        "## Média Prioridade"*) CURRENT_SECTION="media" ;;
        "## Backlog Livre"*)    CURRENT_SECTION="backlog" ;;
        "## "*)                 CURRENT_SECTION="other" ;;
    esac

    # Extrai tarefa aberta: "- [ ] ..."
    if [[ "$line" =~ ^"- [ ] " ]]; then
        task_text="${line#- \[ \] }"
        # Extrai finding_id se presente: <!-- auto:... finding:f_xxx -->
        fid=""
        if [[ "$task_text" =~ finding:([^[:space:]]+)[[:space:]]*--\> ]]; then
            fid="${BASH_REMATCH[1]}"
        fi

        case "$CURRENT_SECTION" in
            alta)    OPEN_ALTA+=("$fid|$task_text") ;;
            media)   OPEN_MEDIA+=("$fid|$task_text") ;;
            backlog) OPEN_BACKLOG+=("$fid|$task_text") ;;
        esac

        # Acumula referência cruzada se tem finding
        if [ -n "$fid" ]; then
            status_tag="pendente"
            $HAS_FINDINGS && is_resolved "$fid" && status_tag="finding resolvido"
            XREF_ROWS+=("$fid|${CURRENT_SECTION}|$status_tag|$task_text")
        fi
    fi

    # Extrai tarefa concluída: "- [x] ..."
    if [[ "$line" =~ ^"- [x] " ]]; then
        task_text="${line#- \[x\] }"
        fid=""
        if [[ "$task_text" =~ finding:([^[:space:]]+)[[:space:]]*--\> ]]; then
            fid="${BASH_REMATCH[1]}"
        fi
        DONE_TASKS+=("$fid|$task_text")
        if [ -n "$fid" ]; then
            status_tag="concluída"
            XREF_ROWS+=("$fid|done|$status_tag|$task_text")
        fi
    fi
done < "$TASKS_FILE"

# ────────────────────────────────────────────────────────────────────────────
# Render helpers
# ────────────────────────────────────────────────────────────────────────────

render_task_item() {
    local fid="$1"
    local task_text="$2"
    if [ -n "$fid" ] && $HAS_FINDINGS; then
        local info
        info="$(get_finding_info "$fid")"
        if [ -n "$info" ]; then
            local sev type desc
            sev="${info%%|*}"
            desc_part="${info#*|}"
            type="${desc_part%%|*}"
            desc="${desc_part#*|}"
            local resolved_mark=""
            is_resolved "$fid" 2> /dev/null && resolved_mark=" ✅"
            echo "- [ ] $task_text"
            echo "  > Finding: \`$fid\` [\`$sev/$type\`] $desc$resolved_mark"
        else
            echo "- [ ] $task_text"
        fi
    else
        echo "- [ ] $task_text"
    fi
}

# ────────────────────────────────────────────────────────────────────────────
# Geração do relatório
# ────────────────────────────────────────────────────────────────────────────
{
    echo "# Snapshot de Tarefas — $DATE_HUMAN"
    echo ""
    echo "> Gerado por \`sync-tasks-to-docs.sh\` a partir de \`state/pending-tasks.md\`."
    echo "> Fonte de findings: \`logs/findings.jsonl\`$([ "$HAS_FINDINGS" = false ] && echo ' (não encontrado)')"
    echo ""

    # ── Alta Prioridade ─────────────────────────────────────────────────────
    echo "## Alta Prioridade (${#OPEN_ALTA[@]} abertas)"
    echo ""
    if [ ${#OPEN_ALTA[@]} -eq 0 ]; then
        echo "_Nenhuma tarefa de alta prioridade pendente._"
    else
        for entry in "${OPEN_ALTA[@]}"; do
            fid="${entry%%|*}"
            task_text="${entry#*|}"
            render_task_item "$fid" "$task_text"
        done
    fi
    echo ""

    # ── Média Prioridade ────────────────────────────────────────────────────
    echo "## Média Prioridade (${#OPEN_MEDIA[@]} abertas)"
    echo ""
    if [ ${#OPEN_MEDIA[@]} -eq 0 ]; then
        echo "_Nenhuma tarefa de média prioridade pendente._"
    else
        for entry in "${OPEN_MEDIA[@]}"; do
            fid="${entry%%|*}"
            task_text="${entry#*|}"
            render_task_item "$fid" "$task_text"
        done
    fi
    echo ""

    # ── Backlog ─────────────────────────────────────────────────────────────
    echo "## Backlog (${#OPEN_BACKLOG[@]} abertas)"
    echo ""
    if [ ${#OPEN_BACKLOG[@]} -eq 0 ]; then
        echo "_Backlog vazio._"
    else
        for entry in "${OPEN_BACKLOG[@]}"; do
            fid="${entry%%|*}"
            task_text="${entry#*|}"
            render_task_item "$fid" "$task_text"
        done
    fi
    echo ""

    # ── Concluídas ──────────────────────────────────────────────────────────
    echo "## Concluídas Recentes (${#DONE_TASKS[@]} total)"
    echo ""
    if [ ${#DONE_TASKS[@]} -eq 0 ]; then
        echo "_Nenhuma tarefa marcada como concluída._"
    else
        for entry in "${DONE_TASKS[@]}"; do
            fid="${entry%%|*}"
            task_text="${entry#*|}"
            if [ -n "$fid" ]; then
                echo "- [x] $task_text (\`$fid\`)"
            else
                echo "- [x] $task_text"
            fi
        done
    fi
    echo ""

    # ── Referência Cruzada Finding ↔ Tarefa ─────────────────────────────────
    if [ ${#XREF_ROWS[@]} -gt 0 ]; then
        echo "## Referência Cruzada Finding ↔ Tarefa"
        echo ""
        echo "| finding_id | prioridade | status | tarefa |"
        echo "|------------|------------|--------|--------|"
        for row in "${XREF_ROWS[@]}"; do
            fid="${row%%|*}"
            rest="${row#*|}"
            prio="${rest%%|*}"
            rest2="${rest#*|}"
            status="${rest2%%|*}"
            task_text="${rest2#*|}"
            # Trunca task_text para caber na tabela
            short_task="${task_text:0:60}"
            [ ${#task_text} -gt 60 ] && short_task="${short_task}..."
            echo "| \`$fid\` | $prio | $status | $short_task |"
        done
        echo ""
    fi

    echo "---"
    echo "_Arquivo gerado automaticamente. Não editar manualmente._"

} > "$OUTPUT_FILE"

echo "✓ Relatório gerado: $OUTPUT_FILE"
echo "  Alta: ${#OPEN_ALTA[@]} | Média: ${#OPEN_MEDIA[@]} | Backlog: ${#OPEN_BACKLOG[@]} | Concluídas: ${#DONE_TASKS[@]} | Cross-ref: ${#XREF_ROWS[@]}"
exit 0
