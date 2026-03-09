#!/bin/bash
# generate-session-summary.sh — Helper chamado por session-end.sh
# Analisa audit.jsonl e gera um relatório Markdown da sessão.
# Requer: SESSION_ID, SESSION_DATE_SHORT, START_TS como variáveis de ambiente.
# Saída: imprime o Markdown do relatório em stdout.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"

SESSION_ID="${SESSION_ID:-unknown}"
SESSION_DATE_SHORT="${SESSION_DATE_SHORT:-$(date -u '+%Y%m%d_%H%M%S')}"
START_TS="${START_TS:-0}"
END_TS="${END_TS:-0}"
SESSION_REASON="${SESSION_REASON:-complete}"

AUDIT_FILE="$LOG_DIR/audit.jsonl"

# Calcula duração em minutos
DURATION_MIN=0
if [ "$START_TS" != "0" ] && [ "$END_TS" != "0" ]; then
    DIFF_S="$(((END_TS - START_TS) / 1000))"
    DURATION_MIN="$((DIFF_S / 60))"
fi

# Conta eventos por tipo nesta sessão
count_event() {
    local event_type="$1"
    if [ -f "$AUDIT_FILE" ]; then
        jq -r --arg sid "$SESSION_ID" --arg ev "$event_type" \
            'select(.session_id == $sid and .event == $ev)' \
            "$AUDIT_FILE" 2> /dev/null | jq -s 'length' 2> /dev/null || echo 0
    else
        echo 0
    fi
}

PROMPTS_COUNT="$(count_event userPromptSubmitted)"
TOOL_USE_COUNT="$(count_event preToolUse)"
AGENT_STOP_COUNT="$(count_event agentStop)"
ERROR_COUNT="$(count_event errorOccurred)"
# dual-read: cobre evento legado (toolFailure) e atual (toolUseFailure)
FAILURE_COUNT="$(if [ -f "$AUDIT_FILE" ]; then
    jq -r --arg sid "$SESSION_ID" \
        'select(.session_id == $sid and (.event == "toolUseFailure" or .event == "toolFailure")) | .event' \
        "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ' || echo 0
else echo 0; fi)"

# Top 5 ferramentas usadas nesta sessão
TOP_TOOLS=""
if [ -f "$AUDIT_FILE" ]; then
    TOP_TOOLS="$(jq -r --arg sid "$SESSION_ID" \
        'select(.session_id == $sid and .event == "preToolUse") | (.tool_name // .toolName)' \
        "$AUDIT_FILE" 2> /dev/null | sort | uniq -c | sort -rn | head -5 \
        | awk '{print "  - `"$2"`: "$1" chamada(s)"}' || echo "  - (sem dados)")"
fi
[ -z "$TOP_TOOLS" ] && TOP_TOOLS="  - (sem dados)"

# Quality gates da sessão
QUALITY_GATES=""
CTX_FILE="$STATE_DIR/session-context.json"
if [ -f "$CTX_FILE" ]; then
    QUALITY_GATES="$(jq -r '
        .quality_gates // {} |
        to_entries[] |
        "  - `\(.key | gsub("gate_"; "npm run "))`: \(.value.result)"
    ' "$CTX_FILE" 2> /dev/null || echo "  - (nenhum gate registrado)")"
fi
[ -z "$QUALITY_GATES" ] && QUALITY_GATES="  - (nenhum gate registrado)"

# Erros registrados nesta sessão
ERRORS_SUMMARY=""
ERRORS_FILE="$LOG_DIR/errors.jsonl"
if [ -f "$ERRORS_FILE" ]; then
    ERRORS_SUMMARY="$(jq -r --arg sid "$SESSION_ID" \
        'select(.session_id == $sid) | "  - [\(.errorName // .event)]: \(.errorMsg // .resultText // "" | .[0:120])"' \
        "$ERRORS_FILE" 2> /dev/null | head -10 || echo "  - (sem erros)")"
fi
[ -z "$ERRORS_SUMMARY" ] && ERRORS_SUMMARY="  - (sem erros)"

# Próximas tarefas pendentes (Alta Prioridade)
NEXT_TASKS=""
TASKS_FILE="$STATE_DIR/pending-tasks.md"
if [ -f "$TASKS_FILE" ]; then
    NEXT_TASKS="$(awk '
        /^## Alta Prioridade/ { in_section=1; next }
        /^## / && in_section  { in_section=0 }
        in_section && /^\- \[ \]/ { print "  "$0 }
    ' "$TASKS_FILE" 2> /dev/null | head -5 || echo "  - (ver pending-tasks.md)")"
fi
[ -z "$NEXT_TASKS" ] && NEXT_TASKS="  - (ver .github/hooks/state/pending-tasks.md)"

# Gera o Markdown do relatório
SESSION_FULL_DATE="$(date -u '+%d/%m/%Y %H:%M UTC' 2> /dev/null || echo "$SESSION_DATE_SHORT")"

cat << MARKDOWN
## Sessão: ${SESSION_ID} — ${SESSION_FULL_DATE}

> **Motivo de encerramento**: \`${SESSION_REASON}\`
> **Duração**: ~${DURATION_MIN} min | **Turnos do agente**: ${AGENT_STOP_COUNT}

### Resumo de atividade

| Métrica | Valor |
|---|---|
| Prompts do usuário | ${PROMPTS_COUNT} |
| Ferramentas invocadas | ${TOOL_USE_COUNT} |
| Erros do agente | ${ERROR_COUNT} |
| Falhas de ferramenta | ${FAILURE_COUNT} |

### Ferramentas mais usadas

${TOP_TOOLS}

### Quality gates executados

${QUALITY_GATES}

### Erros e falhas

${ERRORS_SUMMARY}

### Próximas tarefas pendentes (Alta Prioridade)

${NEXT_TASKS}

---
MARKDOWN

exit 0
