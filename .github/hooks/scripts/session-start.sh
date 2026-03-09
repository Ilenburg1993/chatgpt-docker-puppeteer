#!/bin/bash
# session-start.sh — Hook sessionStart do Copilot
# Executado quando uma nova sessão inicia ou é retomada.
# Input JSON (stdin): {timestamp, cwd, source, initialPrompt}
# Output: ignorado pelo Copilot — serve apenas para log e exibição ao dev.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"

# Garante que os diretórios existem com permissões restritas
mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"
mkdir -p "$STATE_DIR"

# Lê o JSON de entrada de forma defensiva
INPUT="$(cat 2>/dev/null || true)"

# Extrai campos com fallback seguro
TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // 0' 2>/dev/null || echo 0)"
CWD="$(echo "$INPUT"       | jq -r '.cwd // ""'       2>/dev/null || echo '')"
SOURCE="$(echo "$INPUT"    | jq -r '.source // "new"' 2>/dev/null || echo 'new')"
INITIAL_PROMPT="$(echo "$INPUT" | jq -r '.initialPrompt // ""' 2>/dev/null || echo '')"

# Gera um session_id único baseado no timestamp
SESSION_ID="sess_${TIMESTAMP}"
SESSION_DATE="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo 'unknown')"
SESSION_DATE_SHORT="$(date -u '+%Y%m%d_%H%M%S' 2>/dev/null || echo 'unknown')"

# Persiste contexto inicial da sessão
jq -cn \
    --arg sid "$SESSION_ID" \
    --arg ts "$TIMESTAMP" \
    --arg date "$SESSION_DATE" \
    --arg date_short "$SESSION_DATE_SHORT" \
    --arg source "$SOURCE" \
    --arg cwd "$CWD" \
    '{
        session_id:   $sid,
        start_ts:     $ts,
        start_date:   $date,
        date_short:   $date_short,
        source:       $source,
        cwd:          $cwd,
        last_tool_ts: $ts,
        last_tool:    "",
        tools_used:   [],
        failure_count: 0,
        error_count:  0,
        turn_count:   0
    }' > "$STATE_DIR/session-context.json"

# Append em audit.jsonl
jq -cn \
    --arg event "sessionStart" \
    --arg sid "$SESSION_ID" \
    --arg ts "$TIMESTAMP" \
    --arg date "$SESSION_DATE" \
    --arg source "$SOURCE" \
    --arg cwd "$CWD" \
    '{event: $event, session_id: $sid, timestamp: $ts, date: $date, source: $source, cwd: $cwd}' \
    >> "$LOG_DIR/audit.jsonl"

# Banner visível ao desenvolvedor no terminal
cat << 'EOF'
╔══════════════════════════════════════════════════════════════════╗
║           COPILOT — SESSÃO INICIADA — MODO ARQUITETO             ║
║  • Todos os prompts e ferramentas são auditados localmente        ║
║  • preToolUse: logging-only (nunca bloqueia)                      ║
║  • Estado da sessão: .github/hooks/state/session-context.json    ║
╚══════════════════════════════════════════════════════════════════╝
EOF

# Exibe tarefas de Alta Prioridade se não houver prompt inicial
if [ -z "$INITIAL_PROMPT" ] || [ "$SOURCE" = "resume" ]; then
    TASKS_FILE="$STATE_DIR/pending-tasks.md"
    if [ -f "$TASKS_FILE" ]; then
        echo ""
        echo "=== MODO ARQUITETO — Tarefas de Alta Prioridade pendentes ==="
        # Extrai linhas de tarefas não concluídas (marcador [ ]) da seção Alta Prioridade
        awk '
            /^## Alta Prioridade/ { in_section=1; next }
            /^## / && in_section  { in_section=0 }
            in_section && /^\- \[ \]/ { print NR": "$0 }
        ' "$TASKS_FILE" | head -10
        echo "=== Arquivo completo: $TASKS_FILE ==="
        echo ""
    fi
fi

exit 0
