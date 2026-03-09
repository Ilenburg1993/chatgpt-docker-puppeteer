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

# ── B5: Salva checkpoint final antes de encerrar ─────────────────────────────
CHECKPOINT_SCRIPT="$SCRIPTS_DIR/session-checkpoint.sh"
if [ -f "$CHECKPOINT_SCRIPT" ] && [ -x "$CHECKPOINT_SCRIPT" ]; then
    bash "$CHECKPOINT_SCRIPT" 2> /dev/null || true
fi

# ── Obtém dados da sessão do contexto persistido (schema v2) ─────────────────
SESSION_ID="unknown"
START_ISO=""
CTX_FILE="$STATE_DIR/session-context.json"
if [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session.id // "unknown"' "$CTX_FILE" 2> /dev/null || echo 'unknown')"
    START_ISO="$(jq -r '.session.started_at // ""' "$CTX_FILE" 2> /dev/null || echo '')"
fi

# Calcula duração total da sessão (ISO → epoch → diff)
DURATION_S=0
START_EPOCH=0 # inicializado aqui para evitar unbound variable se START_ISO vazio
if [ -n "$START_ISO" ]; then
    START_EPOCH="$(date -d "$START_ISO" '+%s' 2> /dev/null || echo 0)"
    NOW_EPOCH="$(date -u '+%s' 2> /dev/null || echo 0)"
    if [ "$NOW_EPOCH" -gt "$START_EPOCH" ] 2> /dev/null; then
        DURATION_S=$((NOW_EPOCH - START_EPOCH))
    fi
fi

# Conta ferramentas e erros via audit.jsonl (defensivo)
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

# Registra fim da sessão no session-context.json
if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
    jq --arg ts "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" --arg reason "$REASON" \
        '.session.ended_at = $ts | .session.end_reason = $reason' \
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
AUDIT_MAX_LINES=5000
if [ -f "$AUDIT_FILE" ]; then
    AUDIT_LINES="$(wc -l < "$AUDIT_FILE" | tr -d ' ')"
    if [ "$AUDIT_LINES" -gt "$AUDIT_MAX_LINES" ]; then
        AUDIT_ARCHIVE="$LOG_DIR/audit-archive-$(date -u '+%Y%m%d%H%M%S').jsonl"
        head -n $((AUDIT_LINES - AUDIT_MAX_LINES)) "$AUDIT_FILE" > "$AUDIT_ARCHIVE" 2> /dev/null || true
        tail -n "$AUDIT_MAX_LINES" "$AUDIT_FILE" | sponge "$AUDIT_FILE" 2> /dev/null || true
    fi
fi

# ── Gera o relatório Markdown via helper ─────────────────────────────────────
# generate-session-summary.sh espera START_TS em milissegundos (reutiliza START_EPOCH já computado)
START_TS_MS="$((START_EPOCH * 1000))"

SUMMARY_MD=""
SUMMARY_SCRIPT="$SCRIPTS_DIR/generate-session-summary.sh"
if [ -f "$SUMMARY_SCRIPT" ] && [ -x "$SUMMARY_SCRIPT" ]; then
    SUMMARY_MD="$(SESSION_ID="$SESSION_ID" \
        SESSION_DATE_SHORT="$SESSION_DATE_SHORT" \
        START_TS="$START_TS_MS" \
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

# ── Verifica conformidade de autorização no encerramento da sessão ────────────
AUTH_FLAG_FILE="$STATE_DIR/UNAUTHORIZED_CLOSE.flag"
SESSION_AUTH_COMPLIANT=true

if [ -f "$AUTH_FLAG_FILE" ]; then
    SESSION_AUTH_COMPLIANT=false
fi

if [ "$SESSION_AUTH_COMPLIANT" = "true" ] && [ -f "$AUDIT_FILE" ]; then
    SESSION_AUTHORIZED_COUNT="$(jq -r --arg sid "$SESSION_ID" \
        'select(.event == "turnEnd_authorized" and .session_id == $sid)' \
        "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ')"
    SESSION_VIOLATION_COUNT="$(jq -r --arg sid "$SESSION_ID" \
        'select(.event == "turnEnd_UNAUTHORIZED" and .session_id == $sid)' \
        "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ')"
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

# ── Valida SESSION CLOSE KEY ──────────────────────────────────────────────────
NO_KEY_FLAG_FILE="$STATE_DIR/SESSION_CLOSE_NO_KEY.flag"
TURN_COUNT_NOW="$(jq -r '.session_stats.turn_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
CLOSE_KEY_VALIDATED=false

if [ -f "$CTX_FILE" ]; then
    CLOSE_KEY_VALIDATED="$(jq -r '.session.close_key_validated // false' "$CTX_FILE" 2>/dev/null || echo false)"
fi

if [ "$CLOSE_KEY_VALIDATED" = "true" ]; then
    # Encerramento legítimo com chave validada
    rm -f "$NO_KEY_FLAG_FILE" 2>/dev/null || true
    jq -cn \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_MS" \
        --arg reason "$REASON" \
        '{event: "sessionEnd_authorized_with_key", session_id: $sid, timestamp: $ts, reason: $reason}' \
        >> "$AUDIT_FILE"
else
    # Encerramento SEM chave — acidental ou não autorizado
    jq -cn \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_MS" \
        --arg reason "$REASON" \
        --argjson turns "$TURN_COUNT_NOW" \
        '{
            event:       "sessionEnd_no_key",
            session_id:  $sid,
            timestamp:   $ts,
            reason:      $reason,
            turn_count:  $turns
        }' > "$NO_KEY_FLAG_FILE"
    # Também loga no audit.jsonl
    jq -cn \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_MS" \
        --arg reason "$REASON" \
        --argjson turns "$TURN_COUNT_NOW" \
        '{event: "sessionEnd_no_key", session_id: $sid, timestamp: $ts, reason: $reason, turn_count: $turns}' \
        >> "$AUDIT_FILE"
fi

# ── Atualiza pending-tasks.md com nota de sessão encerrada ───────────────────
TASKS_FILE="$STATE_DIR/pending-tasks.md"
if [ -f "$TASKS_FILE" ]; then
    SESSION_NOTE="<!-- session-end: ${SESSION_ID} | ${SESSION_DATE_DAILY} | ${REASON} | ${TOOLS_COUNT} tools -->"
    if ! grep -qF "$SESSION_ID" "$TASKS_FILE" 2> /dev/null; then
        echo "" >> "$TASKS_FILE"
        echo "$SESSION_NOTE" >> "$TASKS_FILE"
    fi
fi

# ── Banner final ──────────────────────────────────────────────────────────────
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
