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
TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
CWD="$(echo "$INPUT" | jq -r '.cwd // ""' 2> /dev/null || echo '')"
SOURCE="$(echo "$INPUT" | jq -r '.source // "new"' 2> /dev/null || echo 'new')"

# session_id: usa o UUID real enviado pelo Copilot; fallback para timestamp-based
SESSION_ID_RAW="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"
if [ -n "$SESSION_ID_RAW" ]; then
    SESSION_ID="$SESSION_ID_RAW"
else
    TS_NORM="$(echo "$TIMESTAMP" | sed 's/[^0-9]//g' | head -c 13)"
    SESSION_ID="sess_${TS_NORM:-$(date +%s%3N)}"
fi

SESSION_DATE="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo 'unknown')"
SESSION_DATE_SHORT="$(date -u '+%Y%m%d_%H%M%S' 2> /dev/null || echo 'unknown')"

# ── Lê valores de conformidade da sessão anterior ANTES de sobrescrever ──────
# CRÍTICO: session-context.json é sobrescrito logo abaixo; precisamos dos dados
# anteriores *agora* para preservar o contador de violações consecutivas.
PREV_CONSEC_UNAUTH=0
if [ -f "$STATE_DIR/session-context.json" ]; then
    # Suporta schema v2 (.compliance.consecutive_unauthorized) e legado
    PREV_CONSEC_UNAUTH="$(jq -r '
        .compliance.consecutive_unauthorized //
        .consecutive_unauthorized_closes //
        0' "$STATE_DIR/session-context.json" 2> /dev/null || echo 0)"
fi

# ── Persiste contexto inicial — Schema v2 (layered) ──────────────────────────
# Estrutura em 6 blocos separados por âmbito:
#   session       → imutável após sessionStart (identidade da sessão)
#   session_stats → acumuladores agregados ao longo de todos os turnos
#   current_turn  → estado do turno ATUAL (resetado a cada agentStop)
#   current_section → seção temática declarada pelo agente (opcional)
#   last_tool     → metadados do último tool call (sobrescrito a cada preToolUse)
#   compliance    → estado do protocolo de autorização
jq -cn \
    --arg sid "$SESSION_ID" \
    --arg ts "$TIMESTAMP" \
    --arg date "$SESSION_DATE" \
    --arg date_short "$SESSION_DATE_SHORT" \
    --arg source "$SOURCE" \
    --arg cwd "$CWD" \
    --argjson consec "$PREV_CONSEC_UNAUTH" \
    '{
        "session": {
            "id":         $sid,
            "started_at": $date,
            "date_short": $date_short,
            "ended_at":   null,
            "end_reason": null,
            "source":     $source,
            "cwd":        $cwd
        },
        "session_stats": {
            "turn_count":         0,
            "turn_authorized":    0,
            "turn_unauthorized":  0,
            "tools_total":        0,
            "tools_by_name":      {},
            "failures_detected":  0,
            "errors_total":       0,
            "subagent_calls":     0
        },
        "current_turn": {
            "number":            1,
            "started_at":        $date,
            "tools_count":       0,
            "tools_by_name":     {},
            "failures_count":    0,
            "auth_requested":    false,
            "auth_requested_at": null
        },
        "current_section": {
            "name":        null,
            "started_at":  null,
            "turn_start":  null,
            "description": null
        },
        "last_tool": {
            "name":   null,
            "ts":     $ts,
            "use_id": null,
            "result": null
        },
        "compliance": {
            "last_turn_authorized":     null,
            "consecutive_unauthorized": $consec,
            "flag_file_exists":         false
        },
        "quality_gates":   {},
        "session_summary": null,
        "last_turn_ts":    null
    }' > "$STATE_DIR/session-context.json"

# ── Recovery: detecta sessão anterior via último checkpoint ─────────────────
CHECKPOINT_DIR="$HOOK_DIR/checkpoints"
PREV_CHECKPOINT=""
PREV_SESSION_ID=""
PREV_TURN_COUNT=0
PREV_TASKS_OPEN=0

# Busca o checkpoint mais recente de qualquer sessão anterior
if [ -d "$CHECKPOINT_DIR" ]; then
    PREV_CHECKPOINT="$(find "$CHECKPOINT_DIR" -maxdepth 1 -name 'sess_*_turn*.json' -printf '%T@ %p\n' 2> /dev/null | sort -rn | head -1 | cut -d' ' -f2- || true)"
fi

if [ -n "$PREV_CHECKPOINT" ] && [ -f "$PREV_CHECKPOINT" ]; then
    PREV_SESSION_ID="$(jq -r '.session_id // ""' "$PREV_CHECKPOINT" 2> /dev/null || echo '')"
    PREV_TURN_COUNT="$(jq -r '.turn_count // 0' "$PREV_CHECKPOINT" 2> /dev/null || echo 0)"
    PREV_TASKS_OPEN="$(jq -r '.tasks.open_total // 0' "$PREV_CHECKPOINT" 2> /dev/null || echo 0)"
    PREV_CHECKPOINT_TS="$(jq -r '.checkpoint_ts // ""' "$PREV_CHECKPOINT" 2> /dev/null || echo '')"
fi

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
    OPEN_FINDINGS="$(wc -l < "$FINDINGS_FILE" 2> /dev/null | tr -d ' ')"
    CRITICAL_FINDINGS="$(jq -r 'select(.severity == "critical" or .severity == "high")' "$FINDINGS_FILE" 2> /dev/null | jq -s 'length' 2> /dev/null || echo 0)"
fi

TOTAL_OPEN=$((COUNT_ALTA + COUNT_MEDIA + COUNT_BACKLOG))

# ─────────────────────────────────────────────────────────────
# Análise de tendências históricas (audit.jsonl + tool-metrics.jsonl)
# ─────────────────────────────────────────────────────────────
AUDIT_FILE="$LOG_DIR/audit.jsonl"
METRICS_FILE="$LOG_DIR/tool-metrics.jsonl"

TREND_SESSIONS="N/D"
TREND_TOTAL_TOOLS="N/D"
TREND_ERROR_RATE="N/D"
TREND_TOP_TOOLS_TABLE=""
TREND_TOP_FAILURES="- (nenhuma falha registrada)"
TREND_PERF_TABLE=""

if [ -f "$AUDIT_FILE" ] && [ -s "$AUDIT_FILE" ]; then
    TREND_SESSIONS="$(jq -r '.session_id // empty' "$AUDIT_FILE" 2> /dev/null \
        | sort -u | awk 'NF{n++} END{print n+0}' || echo 'N/D')"

    TREND_TOTAL_TOOLS="$(jq -r 'select(.event == "preToolUse" and ((.tool_name // .toolName) // "") != "") | (.tool_name // .toolName)' "$AUDIT_FILE" 2> /dev/null \
        | wc -l | tr -d ' ' || echo '0')"

    TOTAL_FAILURES="$(jq -r 'select(.event == "toolFailure" and ((.tool_name // .toolName) // "") != "") | (.tool_name // .toolName)' "$AUDIT_FILE" 2> /dev/null \
        | wc -l | tr -d ' ' || echo '0')"

    if [ "$TREND_TOTAL_TOOLS" -gt 0 ] 2> /dev/null; then
        TREND_ERROR_RATE="$(echo "$TOTAL_FAILURES $TREND_TOTAL_TOOLS" \
            | awk '{printf "%.1f%% (%d/%d)", ($1/$2)*100, $1, $2}')"
    fi

    TREND_TOP_TOOLS_TABLE="$(jq -r 'select(.event == "preToolUse" and ((.tool_name // .toolName) // "") != "") | (.tool_name // .toolName)' "$AUDIT_FILE" 2> /dev/null \
        | sort | uniq -c | sort -rn | head -6 \
        | awk '{printf "| `%-35s` | %5d |\n", $2, $1}' || true)"
    [ -z "$TREND_TOP_TOOLS_TABLE" ] && TREND_TOP_TOOLS_TABLE="| N/D | 0 |"

    TREND_TOP_FAILURES="$(jq -r 'select(.event == "toolFailure" and ((.tool_name // .toolName) // "") != "") | (.tool_name // .toolName)' \
        "$AUDIT_FILE" 2> /dev/null \
        | sort | uniq -c | sort -rn | head -3 \
        | awk '{printf "- `%s`: %d falha(s)\n", $2, $1}' || true)"
    [ -z "$TREND_TOP_FAILURES" ] && TREND_TOP_FAILURES="- (nenhuma falha registrada)"
fi

if [ -f "$METRICS_FILE" ] && [ -s "$METRICS_FILE" ]; then
    TREND_PERF_TABLE="$(jq -r '(.tool_name // .toolName)' "$METRICS_FILE" 2> /dev/null \
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
    [ -z "$TREND_PERF_TABLE" ] && TREND_PERF_TABLE="| N/D | - | 0 |"
fi

# ── UP3: Health check do ambiente ─────────────────────────────────────────
HEALTH_CRITICAL=""
HEALTH_WARNINGS=""

# sponge é crítico: sem ele nenhuma atualização do session-context.json funciona
if ! command -v sponge &> /dev/null; then
    HEALTH_CRITICAL="${HEALTH_CRITICAL}
- ⛔ **sponge não instalado** — instale com \`sudo apt install moreutils\`. Atualizações de estado da sessão inoperantes."
fi

# jq é crítico: sem ele nenhum hook funciona
if ! command -v jq &> /dev/null; then
    HEALTH_CRITICAL="${HEALTH_CRITICAL}
- ⛔ **jq não instalado** — instale com \`sudo apt install jq\`. Sistema de hooks completamente inoperante."
fi

# audit.jsonl: rotação automática ocorre em 5000 linhas (session-end.sh)
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

# session-context.json: verifica permissão de escrita
if [ -f "$STATE_DIR/session-context.json" ] && [ ! -w "$STATE_DIR/session-context.json" ]; then
    HEALTH_CRITICAL="${HEALTH_CRITICAL}
- ⛔ **session-context.json sem permissão de escrita** — estado da sessão não pode ser atualizado."
fi

# Findings críticos/high abertos requerem atenção antes de nova tarefa
if [ "${CRITICAL_FINDINGS:-0}" -gt 0 ] 2> /dev/null; then
    HEALTH_WARNINGS="${HEALTH_WARNINGS}
- ⚠️ **${CRITICAL_FINDINGS} finding(s) crítico/high abertos** — verifique \`logs/findings.jsonl\` antes de iniciar nova tarefa."
fi

HEALTH_STATUS="✅ Sistema operacional"
if [ -n "$HEALTH_CRITICAL" ]; then
    HEALTH_STATUS="⛔ CRÍTICO — verificação imediata necessária"
elif [ -n "$HEALTH_WARNINGS" ]; then
    HEALTH_STATUS="⚠️ Avisos presentes"
fi

# ── Verifica violação de autorização da sessão anterior ────────────────────
AUTH_FLAG_FILE="$STATE_DIR/UNAUTHORIZED_CLOSE.flag"
PREV_UNAUTH_CLOSE=false
PREV_UNAUTH_TS=""
PREV_UNAUTH_SID=""
PREV_UNAUTH_TURN=0
CONSECUTIVE_VIOLATIONS=0

if [ -f "$AUTH_FLAG_FILE" ]; then
    PREV_UNAUTH_CLOSE=true
    PREV_UNAUTH_TS="$(jq -r '.timestamp // ""' "$AUTH_FLAG_FILE" 2> /dev/null || echo '')"
    PREV_UNAUTH_SID="$(jq -r '.session_id // ""' "$AUTH_FLAG_FILE" 2> /dev/null || echo '')"
    PREV_UNAUTH_TURN="$(jq -r '.turn_count // 0' "$AUTH_FLAG_FILE" 2> /dev/null || echo 0)"
fi

# Conta violações consecutivas — preservado da sessão anterior em PREV_CONSEC_UNAUTH
# e já gravado em compliance.consecutive_unauthorized do novo session-context.json.
CONSECUTIVE_VIOLATIONS="$PREV_CONSEC_UNAUTH"

# M3: escalona nível de alerta com base em violações consecutivas acumuladas
if [ "${CONSECUTIVE_VIOLATIONS}" -ge 3 ] 2> /dev/null; then
    VIOLATION_EMOJIS="⛔⛔⛔"
    VIOLATION_LEVEL="VIOLAÇÃO CRÍTICA REITERADA (${CONSECUTIVE_VIOLATIONS}x consecutivas)"
elif [ "${CONSECUTIVE_VIOLATIONS}" -ge 2 ] 2> /dev/null; then
    VIOLATION_EMOJIS="⛔⛔"
    VIOLATION_LEVEL="SEGUNDA VIOLAÇÃO CONSECUTIVA"
else
    VIOLATION_EMOJIS="⛔"
    VIOLATION_LEVEL="AVISO DE VIOLAÇÃO"
fi

# Escreve o briefing
cat > "$BRIEFING_FILE" << BRIEFING_EOF
# Briefing de Sessão — ${SESSION_DATE}

> **Para o agente de IA:** Este arquivo é gerado automaticamente pelo hook \`sessionStart\`.
> Leia-o como primeiro ato de toda sessão, antes de qualquer ação.
> Após lê-lo, **invoque \`vscode_askQuestions\`** com o Template E (Session Kickoff)
> para definir com o usuário o rumo desta sessão.
BRIEFING_EOF

# Injeta aviso de violação NO TOPO do briefing, se houver (nível escalona com CONSECUTIVE_VIOLATIONS)
if [ "$PREV_UNAUTH_CLOSE" = "true" ]; then
    cat >> "$BRIEFING_FILE" << VIOLATION_EOF

---

## ${VIOLATION_EMOJIS} ${VIOLATION_LEVEL} — AÇÃO OBRIGATÓRIA IMEDIATA ${VIOLATION_EMOJIS}

> **A sessão anterior encerrou SEM autorização do usuário.**
> O agente não chamou \`vscode_askQuestions\` antes de finalizar o turno.
>
> - **Sessão violadora**: \`${PREV_UNAUTH_SID}\`
> - **Horário da violação**: \`${PREV_UNAUTH_TS}\`
> - **Turno**: \`${PREV_UNAUTH_TURN}\`
> - **Violações consecutivas**: \`${CONSECUTIVE_VIOLATIONS}\`
>
> **PRIMEIRA AÇÃO DESTA SESSÃO (antes de qualquer outra coisa):**
>
> 1. Informar o usuário sobre esta violação
> 2. Pedir desculpas explicitamente
> 3. Invocar \`vscode_askQuestions\` para recuperar a autorização
>
> **Esta violação será registrada no audit.jsonl e rastreada.**
> O arquivo \`.github/hooks/state/UNAUTHORIZED_CLOSE.flag\` SÓ é removido
> quando o agente chama \`vscode_askQuestions\` corretamente.

---

VIOLATION_EOF
fi

# Continuação do briefing
cat >> "$BRIEFING_FILE" << BRIEFING_BODY_EOF

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

## Saúde do Sistema

**Status**: ${HEALTH_STATUS}

$([ -n "$HEALTH_CRITICAL" ] && printf '%s\n' "$HEALTH_CRITICAL" || true)
$([ -n "$HEALTH_WARNINGS" ] && printf '%s\n' "$HEALTH_WARNINGS" || true)

## Tendências históricas

| Métrica | Valor |
|---|---|
| Sessões registradas | ${TREND_SESSIONS} |
| Total de chamadas de ferramenta | ${TREND_TOTAL_TOOLS} |
| Taxa de falha de ferramentas | ${TREND_ERROR_RATE} |

### Top ferramentas (todas as sessões)

| Ferramenta | Chamadas |
|---|---|
${TREND_TOP_TOOLS_TABLE}

### Ferramentas com mais falhas

${TREND_TOP_FAILURES}

## Performance por ferramenta (médias históricas)

| Ferramenta | Média | Amostras |
|---|---|---|
${TREND_PERF_TABLE}

## Sessão atual

- **ID**: ${SESSION_ID}
- **Início**: ${SESSION_DATE}
- **Origem**: ${SOURCE}
- **Workspace**: ${CWD}

## Continuidade — Sessão Anterior

$(if [ -n "$PREV_SESSION_ID" ] && [ "$PREV_SESSION_ID" != "$SESSION_ID" ]; then
    echo "> **Recovery ativo.** Dados recuperados do último checkpoint da sessão anterior."
    echo ""
    echo "- **Sessão anterior**: \`${PREV_SESSION_ID}\`"
    echo "- **Checkpoint**: \`${PREV_CHECKPOINT_TS:-N/D}\`"
    echo "- **Turnos concluídos**: ${PREV_TURN_COUNT}"
    echo "- **Tarefas abertas**: ${PREV_TASKS_OPEN}"
    echo ""
    echo "> Verifique \`.github/hooks/state/pending-tasks.md\` para retomar de onde parou."
else
    echo "> Nenhuma sessão anterior identificada, ou sessão continuando (\`source=${SOURCE}\`)."
fi)

## Ação imediata recomendada

1. **SE** \`initialPrompt\` está vazio → invocar \`vscode_askQuestions\` com Template E (Session Kickoff)
2. **SE** há findings críticos → apresentá-los ao usuário antes de prosseguir
3. **SE** a sessão tem prompt explícito → executar o prompt e, ao concluir, invocar Template A
4. **SE** sessão anterior detectada → confirmar com usuário se deseja retomar tarefas abertas

---
*Gerado automaticamente. Não editar manualmente.*
BRIEFING_BODY_EOF

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
