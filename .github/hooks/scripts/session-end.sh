#!/bin/bash
# session-end.sh — Hook sessionEnd do Copilot
# Executado quando a sessão do agente é encerrada (completa, erro, abort, timeout, user_exit).
# Input JSON (stdin): {timestamp, cwd, reason}
# Output: ignorado pelo Copilot.
# Este é o hook mais complexo: gera resumo, atualiza estado, espelha para DOCUMENTAÇÃO/.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
DOCS_SESSIONS_DIR="$REPO_ROOT/DOCUMENTAÇÃO/RELATORIOS/SESSIONS"
SCRIPTS_DIR="$HOOK_DIR/scripts"

mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"
mkdir -p "$STATE_DIR"
mkdir -p "$DOCS_SESSIONS_DIR"

INPUT="$(cat 2> /dev/null || true)"

TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // 0' 2> /dev/null || echo 0)"
CWD="$(echo "$INPUT" | jq -r '.cwd // ""' 2> /dev/null || echo '')"
REASON="$(echo "$INPUT" | jq -r '.reason // "complete"' 2> /dev/null || echo 'complete')"
NOW_MS="$(date +%s000 2> /dev/null || echo "$TIMESTAMP")"
SESSION_DATE_SHORT="$(date -u '+%Y%m%d_%H%M%S' 2> /dev/null || echo 'unknown')"
SESSION_DATE_DAILY="$(date -u '+%Y-%m-%d' 2> /dev/null || echo 'unknown')"

# Obtém dados da sessão do contexto persistido
SESSION_ID="unknown"
START_TS="0"
CTX_FILE="$STATE_DIR/session-context.json"
if [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session_id // "unknown"' "$CTX_FILE" 2> /dev/null || echo 'unknown')"
    START_TS="$(jq -r '.start_ts // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
fi

# Calcula duração total da sessão
DURATION_S=0
if [ "$START_TS" != "0" ] && [ "$NOW_MS" -gt "$START_TS" ] 2> /dev/null; then
    DURATION_S="$(((NOW_MS - START_TS) / 1000))"
fi

# Conta ferramentas e erros (defensivo se audit.jsonl não existir)
TOOLS_COUNT=0
ERRORS_COUNT=0
AUDIT_FILE="$LOG_DIR/audit.jsonl"
if [ -f "$AUDIT_FILE" ]; then
    TOOLS_COUNT="$(jq -r --arg sid "$SESSION_ID" \
        'select(.session_id == $sid and .event == "preToolUse")' \
        "$AUDIT_FILE" 2> /dev/null | jq -s 'length' 2> /dev/null || echo 0)"
    ERRORS_COUNT="$(jq -r --arg sid "$SESSION_ID" \
        'select(.session_id == $sid and .event == "errorOccurred")' \
        "$AUDIT_FILE" 2> /dev/null | jq -s 'length' 2> /dev/null || echo 0)"
fi

# Finaliza o session-context.json
if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
    jq --arg ts "$NOW_MS" --arg reason "$REASON" \
        '.end_ts = $ts | .end_reason = $reason' \
        "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
fi

# Append em audit.jsonl — evento de encerramento
jq -cn \
    --arg event "sessionEnd" \
    --arg sid "$SESSION_ID" \
    --arg ts "$NOW_MS" \
    --arg cwd "$CWD" \
    --arg reason "$REASON" \
    --argjson dur "$DURATION_S" \
    --argjson tools "$TOOLS_COUNT" \
    --argjson errors "$ERRORS_COUNT" \
    '{
        event:            $event,
        session_id:       $sid,
        timestamp:        $ts,
        cwd:              $cwd,
        reason:           $reason,
        duration_s:       $dur,
        tools_used_count: $tools,
        errors_count:     $errors
    }' >> "$AUDIT_FILE"

# ── Rotação do audit.jsonl (mantém últimas 5000 linhas) ──────────────────────
# Executado a cada session-end para evitar crescimento ilimitado do log.
AUDIT_MAX_LINES=5000
if [ -f "$AUDIT_FILE" ]; then
    AUDIT_LINES="$(wc -l < "$AUDIT_FILE" | tr -d ' ')"
    if [ "$AUDIT_LINES" -gt "$AUDIT_MAX_LINES" ]; then
        AUDIT_ARCHIVE="$LOG_DIR/audit-archive-$(date -u '+%Y%m%d%H%M%S').jsonl"
        head -n $((AUDIT_LINES - AUDIT_MAX_LINES)) "$AUDIT_FILE" > "$AUDIT_ARCHIVE" 2>/dev/null || true
        tail -n "$AUDIT_MAX_LINES" "$AUDIT_FILE" | sponge "$AUDIT_FILE" 2>/dev/null || true
    fi
fi

# Gera o relatório Markdown via helper
SUMMARY_MD=""
SUMMARY_SCRIPT="$SCRIPTS_DIR/generate-session-summary.sh"
if [ -f "$SUMMARY_SCRIPT" ] && [ -x "$SUMMARY_SCRIPT" ]; then
    SUMMARY_MD="$(SESSION_ID="$SESSION_ID" \
        SESSION_DATE_SHORT="$SESSION_DATE_SHORT" \
        START_TS="$START_TS" \
        END_TS="$NOW_MS" \
        SESSION_REASON="$REASON" \
        bash "$SUMMARY_SCRIPT" 2> /dev/null || echo '## Resumo indisponível (erro no helper)')"
fi

# Salva resumo local (gitignored)
if [ -n "$SUMMARY_MD" ]; then
    LOCAL_SUMMARY="$LOG_DIR/session-${SESSION_DATE_SHORT}.md"
    echo "# Relatório de Sessão" > "$LOCAL_SUMMARY"
    echo "" >> "$LOCAL_SUMMARY"
    echo "$SUMMARY_MD" >> "$LOCAL_SUMMARY"
fi

# Espelha resumo para DOCUMENTAÇÃO/RELATORIOS/SESSIONS/ (commitável)
# Acumula sessões do mesmo dia num único arquivo diário (append)
DAILY_REPORT="$DOCS_SESSIONS_DIR/sessions-${SESSION_DATE_DAILY}.md"
if [ ! -f "$DAILY_REPORT" ]; then
    cat > "$DAILY_REPORT" << HEADER
# Sessões de ${SESSION_DATE_DAILY}

> Gerado automaticamente pelo hook \`sessionEnd\` do Copilot.
> Cada entrada abaixo representa uma sessão encerrada neste dia.

HEADER
fi

if [ -n "$SUMMARY_MD" ]; then
    echo "$SUMMARY_MD" >> "$DAILY_REPORT"
fi

# ── Verifica conformidade de autorização no encerramento da sessão ─────────────
# session-end é disparado quando a sessão fecha (explícito ou timeout).
# agentStop já verifica turno a turno; session-end verifica o fechamento da sessão inteira.
AUTH_FLAG_FILE="$STATE_DIR/UNAUTHORIZED_CLOSE.flag"
AUDIT_FILE="$LOG_DIR/audit.jsonl"
SESSION_AUTH_COMPLIANT=true

# Verifica se já existe um flag de violação não resolvido
if [ -f "$AUTH_FLAG_FILE" ]; then
    SESSION_AUTH_COMPLIANT=false
fi

# Se não há flag mas também não há nenhum turnEnd_authorized nesta sessão,
# verifica no audit se houve vscode_askQuestions recente
if [ "$SESSION_AUTH_COMPLIANT" = "true" ] && [ -f "$AUDIT_FILE" ]; then
    SESSION_AUTHORIZED_COUNT="$(jq -r --arg sid "$SESSION_ID" \
        'select(.event == "turnEnd_authorized" and .session_id == $sid)' \
        "$AUDIT_FILE" 2>/dev/null | wc -l | tr -d ' ')"
    SESSION_VIOLATION_COUNT="$(jq -r --arg sid "$SESSION_ID" \
        'select(.event == "turnEnd_UNAUTHORIZED" and .session_id == $sid)' \
        "$AUDIT_FILE" 2>/dev/null | wc -l | tr -d ' ')"
    # Loga o resumo de conformidade desta sessão no audit.jsonl
    jq -cn \
        --arg event "sessionEnd_compliance" \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_MS" \
        --arg reason "$REASON" \
        --argjson authorized "$SESSION_AUTHORIZED_COUNT" \
        --argjson violations "$SESSION_VIOLATION_COUNT" \
        --argjson compliant "$SESSION_AUTH_COMPLIANT" \
        '{event: $event, session_id: $sid, timestamp: $ts, reason: $reason,
          authorized_turns: $authorized, violation_turns: $violations,
          fully_compliant: $compliant}' \
        >> "$AUDIT_FILE"
fi

# Atualiza pending-tasks.md — marca tarefas concluídas com base nos eventos do audit.jsonl
# Estratégia conservadora: o agente deve marcar explicitamente as tarefas concluídas.
# Este hook apenas adiciona um comentário de sessão ao final da seção de Alta Prioridade.
TASKS_FILE="$STATE_DIR/pending-tasks.md"
if [ -f "$TASKS_FILE" ] && command -v sponge &> /dev/null; then
    # Adiciona nota de sessão encerrada no rodapé do arquivo (não altera checkboxes)
    SESSION_NOTE="<!-- session-end: ${SESSION_ID} | ${SESSION_DATE_DAILY} | ${REASON} | ${TOOLS_COUNT} tools -->"

    # Verifica se nota desta sessão já existe (idempotente)
    if ! grep -qF "$SESSION_ID" "$TASKS_FILE" 2> /dev/null; then
        echo "" >> "$TASKS_FILE"
        echo "$SESSION_NOTE" >> "$TASKS_FILE"
    fi
fi

# Banner final visível ao desenvolvedor
cat << EOF

╔══════════════════════════════════════════════════════════════════╗
║             SESSÃO ENCERRADA — ${REASON}
║  Session ID : ${SESSION_ID}
║  Duração    : $((DURATION_S / 60))m $((DURATION_S % 60))s
║  Ferramentas: ${TOOLS_COUNT} | Erros: ${ERRORS_COUNT}
║  Relatório  : DOCUMENTAÇÃO/RELATORIOS/SESSIONS/sessions-${SESSION_DATE_DAILY}.md
╚══════════════════════════════════════════════════════════════════╝
EOF

exit 0
