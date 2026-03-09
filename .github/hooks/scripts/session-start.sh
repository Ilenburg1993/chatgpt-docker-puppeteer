#!/bin/bash
# session-start.sh — Hook sessionStart do Copilot
# Executado quando uma nova sessão inicia ou é retomada.
# Input JSON (stdin): {timestamp, cwd, source, initialPrompt}
# Output: ignorado pelo Copilot — serve para log, exibição ao dev e geração de session-briefing.md.
#
# Gera automaticamente .github/hooks/state/session-briefing.md com:
#   - Contagem de tarefas por prioridade
#   - Findings não resolvidos da sessão anterior
#   - Sugestão de primeiro passo
# O LLM é instruído (via AGENTS.md) a ler este arquivo no início de cada sessão.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"

# Garante que os diretórios existem com permissões restritas
mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"
mkdir -p "$STATE_DIR"

# Lê o JSON de entrada de forma defensiva
INPUT="$(cat 2> /dev/null || true)"

# Extrai campos com fallback seguro
TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // 0' 2> /dev/null || echo 0)"
CWD="$(echo "$INPUT" | jq -r '.cwd // ""' 2> /dev/null || echo '')"
SOURCE="$(echo "$INPUT" | jq -r '.source // "new"' 2> /dev/null || echo 'new')"

# Gera um session_id único baseado no timestamp
SESSION_ID="sess_${TIMESTAMP}"
SESSION_DATE="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo 'unknown')"
SESSION_DATE_SHORT="$(date -u '+%Y%m%d_%H%M%S' 2> /dev/null || echo 'unknown')"

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

# ─────────────────────────────────────────────────────────────
# Gera session-briefing.md — lido pelo LLM no início da sessão
# ─────────────────────────────────────────────────────────────
TASKS_FILE="$STATE_DIR/pending-tasks.md"
FINDINGS_FILE="$LOG_DIR/findings.jsonl"
BRIEFING_FILE="$STATE_DIR/session-briefing.md"

# Conta tarefas por prioridade
COUNT_ALTA=0
COUNT_MEDIA=0
COUNT_BACKLOG=0
NEXT_TASK=""

if [ -f "$TASKS_FILE" ]; then
    # Contagens por seção
    COUNT_ALTA="$(awk '/^## Alta Prioridade/{f=1} /^## / && !/^## Alta/{f=0} f && /^\- \[ \]/' "$TASKS_FILE" | wc -l | tr -d ' ')"
    COUNT_MEDIA="$(awk '/^## Média Prioridade/{f=1} /^## / && !/^## Média/{f=0} f && /^\- \[ \]/' "$TASKS_FILE" | wc -l | tr -d ' ')"
    COUNT_BACKLOG="$(awk '/^## Backlog/{f=1} /^## / && !/^## Backlog/{f=0} f && /^\- \[ \]/' "$TASKS_FILE" | wc -l | tr -d ' ')"
    # Próxima tarefa sugerida (primeira não concluída de Alta Prioridade)
    NEXT_TASK="$(awk '/^## Alta Prioridade/{f=1} /^## / && !/^## Alta/{f=0} f && /^\- \[ \]/{print; exit}' "$TASKS_FILE" | sed 's/^- \[ \] //')"
    [ -z "$NEXT_TASK" ] && NEXT_TASK="(nenhuma tarefa de Alta Prioridade — verificar Média Prioridade)"
fi

# Conta findings não resolvidos (da sessão atual ou anteriores)
OPEN_FINDINGS=0
CRITICAL_FINDINGS=0
if [ -f "$FINDINGS_FILE" ]; then
    OPEN_FINDINGS="$(wc -l < "$FINDINGS_FILE" 2>/dev/null | tr -d ' ')"
    CRITICAL_FINDINGS="$(jq -r 'select(.severity == "critical" or .severity == "high")' "$FINDINGS_FILE" 2>/dev/null | jq -s 'length' 2>/dev/null || echo 0)"
fi

TOTAL_OPEN=$((COUNT_ALTA + COUNT_MEDIA + COUNT_BACKLOG))

# Escreve o briefing
cat > "$BRIEFING_FILE" << BRIEFING_EOF
# Briefing de Sessão — ${SESSION_DATE}

> **Para o agente de IA:** Este arquivo é gerado automaticamente pelo hook \`sessionStart\`.
> Leia-o como primeiro ato de toda sessão, antes de qualquer ação.
> Após lê-lo, **invoque \`vscode_askQuestions\`** com o Template E (Session Kickoff)
> para definir com o usuário o rumo desta sessão.

## Estado do Backlog

| Prioridade      | Tarefas abertas |
|-----------------|-----------------|
| 🔴 Alta          | ${COUNT_ALTA}  |
| 🟡 Média         | ${COUNT_MEDIA} |
| 🔵 Backlog Livre | ${COUNT_BACKLOG} |
| **Total**       | **${TOTAL_OPEN}** |

## Próxima tarefa sugerida (Alta Prioridade)

${NEXT_TASK}

## Findings pendentes

- Total registrado em \`logs/findings.jsonl\`: **${OPEN_FINDINGS}**
- Findings críticos/high: **${CRITICAL_FINDINGS}**

> Se \`CRITICAL_FINDINGS > 0\`, considere priorizar a resolução desses findings
> antes de selecionar uma nova tarefa do backlog.

## Sessão atual

- **ID**: ${SESSION_ID}
- **Início**: ${SESSION_DATE}
- **Origem**: ${SOURCE}
- **Workspace**: ${CWD}

## Ação imediata recomendada

1. **SE** \`initialPrompt\` está vazio → invocar \`vscode_askQuestions\` com Template E (Session Kickoff)
2. **SE** há findings críticos → apresentá-los ao usuário antes de prosseguir
3. **SE** a sessão tem prompt explícito → executar o prompt e, ao concluir, invocar Template A

---
*Gerado automaticamente. Não editar manualmente.*
BRIEFING_EOF

# Banner visível ao desenvolvedor no terminal
cat << 'EOF'
╔══════════════════════════════════════════════════════════════════╗
║           COPILOT — SESSÃO INICIADA — MODO ARQUITETO             ║
║  • Todos os prompts e ferramentas são auditados localmente        ║
║  • preToolUse: logging-only (nunca bloqueia)                      ║
║  • Briefing: .github/hooks/state/session-briefing.md             ║
╚══════════════════════════════════════════════════════════════════╝
EOF

# Exibe resumo de tarefas ao desenvolvedor no terminal
if [ -f "$TASKS_FILE" ]; then
    echo ""
    echo "=== BACKLOG: ${COUNT_ALTA} alta | ${COUNT_MEDIA} média | ${COUNT_BACKLOG} backlog (total: ${TOTAL_OPEN}) ==="
    if [ -n "$NEXT_TASK" ]; then
        echo "→ Próxima (Alta): $NEXT_TASK" | head -c 120
        echo ""
    fi
    echo "=== session-briefing.md gerado — LLM deve lê-lo como primeiro ato ==="
    echo ""
fi

exit 0
