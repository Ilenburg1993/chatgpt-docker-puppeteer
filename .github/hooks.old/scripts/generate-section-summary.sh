#!/bin/bash
# generate-section-summary.sh — Gera sumário estruturado de uma seção fechada.
#
# Chamado por start-section.sh ao fechar uma seção anterior.
# Gera um arquivo Markdown mínimo (shell template, sem LLM) com as métricas
# da seção que acabou de encerrar.
#
# Uso (chamado por start-section.sh — não invocar diretamente):
#   bash generate-section-summary.sh "$NAME" "$NUM" "$DURATION_S" "$TURNS" "$PUSH_COUNT"
#
# Argumentos:
#   $1 = nome da seção (ex: "implementação")
#   $2 = número da seção (ex: 3)
#   $3 = duration_s (ex: 1823)
#   $4 = turns_covered (ex: 5)
#   $5 = push_count nesta seção (ex: 1 — calculado externamente)
#   $6 = section_id UUID da seção (opcional; lido de CTX_FILE como fallback)
#
# Saída:
#   .github/hooks/state/section-summaries/section-{N}-{slug}-{date}.md
#   (zero se arquivo já existe ou se diretório não puder ser criado)
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
CTX_FILE="$STATE_DIR/session-context.json"
SUMMARIES_DIR="$STATE_DIR/section-summaries"
# shellcheck disable=SC1091
source "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null || true
# UPG-AUDIT-01: resolve per-session paths from current-session-id.txt
_CSI_FILE="$STATE_DIR/current-session-id.txt"
if [ -f "$_CSI_FILE" ] && _CURR_SID="$(cat "$_CSI_FILE" 2> /dev/null)" && [ -n "$_CURR_SID" ]; then
    _SID_SHORT="${_CURR_SID:0:8}"
    CTX_FILE="$STATE_DIR/session-context-${_SID_SHORT}.json"
    AUDIT_FILE="$LOG_DIR/audit-${_SID_SHORT}.jsonl"
fi

mkdir -p "$SUMMARIES_DIR"

SECTION_NAME="${1:-}"
SECTION_NUM="${2:-0}"
DURATION_S="${3:-0}"
TURNS_COVERED="${4:-0}"
PUSH_COUNT_SECTION="${5:-0}"
SECTION_ID="${6:-}"

if [ -z "$SECTION_NAME" ]; then
    # Fallback: lê da seção atual do session-context.json (caso seja chamado isoladamente)
    if [ -f "$CTX_FILE" ]; then
        SECTION_NAME="$(jq -r '.current_section.name // "desconhecida"' "$CTX_FILE" 2> /dev/null || echo 'desconhecida')"
        SECTION_NUM="$(jq -r '.current_section.section_number // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
        [ -z "$SECTION_ID" ] && SECTION_ID="$(jq -r '.current_section.section_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    else
        SECTION_NAME="desconhecida"
    fi
fi

NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
NOW_SHORT="$(date -u '+%Y%m%d_%H%M%S')"
SESSION_ID="unknown"
if [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session.id // "unknown"' "$CTX_FILE" 2> /dev/null || echo 'unknown')"
fi

# Slug do nome da seção (apenas alfanum e hifens, lowercase)
SECTION_SLUG="$(echo "$SECTION_NAME" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/-$//')"
[ -z "$SECTION_SLUG" ] && SECTION_SLUG="secao"

# Nome do arquivo de saída
SUMMARY_FILE="$SUMMARIES_DIR/section-${SECTION_NUM}-${SECTION_SLUG}-${NOW_SHORT}.md"

# ── Coleta métricas das ferramentas usadas nesta seção via audit.jsonl ────────
# AUDIT_FILE já definido pelo bloco per-session no topo (não sobrescrever)
TOOLS_SUMMARY="(sem dados de audit.jsonl)"
TOOLS_TOTAL=0
TOOLS_TOP=""

if [ -f "$AUDIT_FILE" ] && [ -s "$AUDIT_FILE" ]; then
    # M-002 FIX: usa current_section.tools_by_name do CTX (contagem por seção via pre-tool-use.sh)
    # em vez de filtrar audit.jsonl por session_id (que conta TODA a sessão, não só a seção).
    # O fallback para audit.jsonl usa filtragem por session_id como aproximação quando CTX indisponível.
    if [ -f "$CTX_FILE" ]; then
        TOOLS_TOTAL="$(jq '(.current_section.tools_by_name // {}) | values | add // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
        TOOLS_TOP="$(jq -r '
            (.current_section.tools_by_name // {})
            | to_entries
            | sort_by(-.value)
            | .[:5]
            | .[] | "  - `\(.key)`: \(.value)"
        ' "$CTX_FILE" 2> /dev/null || true)"
    else
        # Fallback: contagem por session_id (aproximação — inclui outras seções da sessão)
        TOOLS_TOTAL="$(jq -r --arg sid "$SESSION_ID" \
            'select(.event == "preToolUse" and .session_id == $sid) | (.tool_name // .toolName // "")' \
            "$AUDIT_FILE" 2> /dev/null | grep -cv '^$' | tr -d ' ' || echo 0)"
        TOOLS_TOP="$(jq -r --arg sid "$SESSION_ID" \
            'select(.event == "preToolUse" and .session_id == $sid) | (.tool_name // .toolName // "")' \
            "$AUDIT_FILE" 2> /dev/null \
            | grep -v '^$' | sort | uniq -c | sort -rn | head -5 \
            | awk '{printf "  - `%s`: %d\n", $2, $1}' || true)"
    fi

    [ -n "$TOOLS_TOP" ] && TOOLS_SUMMARY="$TOOLS_TOP" || TOOLS_SUMMARY="  - (nenhuma registrada)"
fi

# ── Coleta tools_by_name da seção atual (Schema v7) ───────────────────────────
SECTION_TOOLS_BY_NAME=""
if [ -f "$CTX_FILE" ]; then
    SECTION_TOOLS_BY_NAME="$(jq -r '
        (.current_section.tools_by_name // {})
        | to_entries
        | sort_by(-.value)
        | .[:10]
        | .[] | "  - `\(.key)`: \(.value)"
    ' "$CTX_FILE" 2> /dev/null || true)"
fi
[ -z "$SECTION_TOOLS_BY_NAME" ] && SECTION_TOOLS_BY_NAME="  - (sem dados de ferramentas por seção)"

# ── Coleta contagem de tasks da seção (se pending-tasks.md existir) ───────────
TASKS_FILE="$STATE_DIR/pending-tasks.md"
TASKS_OPEN_ALTA=0
TASKS_OPEN_MEDIA=0
TASKS_OPEN_BACKLOG=0

if [ -f "$TASKS_FILE" ]; then
    TASKS_OPEN_ALTA="$(awk '/^## Alta Prioridade/{f=1} /^## / && !/^## Alta/{f=0} f && /^\- \[ \]/' "$TASKS_FILE" | wc -l | tr -d ' ')"
    TASKS_OPEN_MEDIA="$(awk '/^## Média Prioridade/{f=1} /^## / && !/^## Média/{f=0} f && /^\- \[ \]/' "$TASKS_FILE" | wc -l | tr -d ' ')"
    TASKS_OPEN_BACKLOG="$(awk '/^## Backlog/{f=1} /^## / && !/^## Backlog/{f=0} f && /^\- \[ \]/' "$TASKS_FILE" | wc -l | tr -d ' ')"
fi

# ── Verifica se a seção foi encerrada com autorização ─────────────────────────
COMPLIANCE_STATUS="desconhecido"
if [ -f "$CTX_FILE" ]; then
    CONSEC_UNAUTH="$(jq -r '.compliance.consecutive_unauthorized // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    if [ "${CONSEC_UNAUTH}" -eq 0 ] 2> /dev/null; then
        COMPLIANCE_STATUS="✅ sem violações"
    else
        COMPLIANCE_STATUS="⚠️ ${CONSEC_UNAUTH} violação(ões)"
    fi
fi

# ── Formata duração humana ─────────────────────────────────────────────────────
DURATION_HUMAN="${DURATION_S}s"
if [ "${DURATION_S}" -ge 3600 ] 2> /dev/null; then
    H=$((DURATION_S / 3600))
    M=$(((DURATION_S % 3600) / 60))
    S=$((DURATION_S % 60))
    DURATION_HUMAN="${H}h${M}m${S}s"
elif [ "${DURATION_S}" -ge 60 ] 2> /dev/null; then
    M=$((DURATION_S / 60))
    S=$((DURATION_S % 60))
    DURATION_HUMAN="${M}m${S}s"
fi

# ── Escreve o arquivo de sumário ───────────────────────────────────────────────
cat > "$SUMMARY_FILE" << SUMMARY_EOF
# Seção "${SECTION_NAME}" — #${SECTION_NUM} — Sumário

> Gerado automaticamente em ${NOW_ISO} por generate-section-summary.sh (shell template).
> Para sumário narrativo rico, use \`runSubagent\` após mudança de seção (Abordagem C).

## Métricas

| Campo             | Valor                        |
| ----------------- | ---------------------------- |
| Sessão            | \`${SESSION_ID}\`            |
| Número da seção   | \`#${SECTION_NUM}\`          |
| Nome              | \`${SECTION_NAME}\`          |
| ID (UUID)         | \`${SECTION_ID:-N/A}\`       |
| Encerrada em      | \`${NOW_ISO}\`               |
| Duração           | ${DURATION_HUMAN}            |
| Turnos cobertos   | ${TURNS_COVERED}             |
| Git pushes        | ${PUSH_COUNT_SECTION}        |
| Ferramentas (total) | ${TOOLS_TOTAL}             |
| Conformidade      | ${COMPLIANCE_STATUS}         |

## Top ferramentas usadas nesta sessão

${TOOLS_SUMMARY}

## Top ferramentas usadas nesta seção (Schema v7)

${SECTION_TOOLS_BY_NAME}

## Backlog atual (ao fechar a seção)

| Prioridade | Abertas |
| ---------- | ------- |
| Alta       | ${TASKS_OPEN_ALTA}    |
| Média      | ${TASKS_OPEN_MEDIA}   |
| Backlog    | ${TASKS_OPEN_BACKLOG} |

## Narrativa

> ⚠️ Sumário narrativo não gerado (shell template apenas).
> Para adicionar narrativa, o agente deve escrever manualmente abaixo ou chamar \`runSubagent\`.

---
*Arquivo: section-${SECTION_NUM}-${SECTION_SLUG}-${NOW_SHORT}.md*
SUMMARY_EOF

# Atualiza session-context.json com section_history (Schema v6)
# Apenas se sponge disponível (atomic write)
# Filtro jq: atualiza entrada existente em section_history (match por section_id ou number+name)
# se não houver entrada correspondente, appenda nova. Cap: 50 entradas.
# Isso previne duplicatas: start-section.sh cria entrada mínima ao ABRIR;
# generate-section-summary.sh ENRIQUECE a mesma entrada ao FECHAR.
# shellcheck disable=SC2016  # $section_id/$num/$name são variáveis jq, não shell
_JQ_HISTORY_FILTER='
    .session_stats.section_history =
        ((.session_stats.section_history // [])
         | if (map(select(
                   ($section_id != "" and .section_id == $section_id) or
                   ($section_id == "" and .section_number == $num and .name == $name)
               )) | length) > 0
           then map(
               if ($section_id != "" and .section_id == $section_id) or
                  ($section_id == "" and .section_number == $num and .name == $name)
               then . + {turns: $turns, duration_s: $dur, pushes: $pushes,
                          summary_file: $summary_file, closed_at: $ts}
               else . end)
           else . + [{
               name:           $name,
               section_number: $num,
               section_id:     (if $section_id == "" then null else $section_id end),
               turns:        $turns,
               duration_s:   $dur,
               pushes:       $pushes,
               summary_file: $summary_file,
               closed_at:    $ts
           }]
           end
         | if length > $cap then .[-($cap):] else . end)'

_HISTORY_CAP="${HOOKS_SECTION_HISTORY_CAP:-50}"
if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
    jq \
        --arg name "$SECTION_NAME" \
        --argjson num "$SECTION_NUM" \
        --argjson turns "$TURNS_COVERED" \
        --argjson dur "$DURATION_S" \
        --argjson pushes "$PUSH_COUNT_SECTION" \
        --arg section_id "${SECTION_ID:-}" \
        --arg ts "$NOW_ISO" \
        --argjson cap "$_HISTORY_CAP" \
        --arg summary_file "section-summaries/section-${SECTION_NUM}-${SECTION_SLUG}-${NOW_SHORT}.md" \
        "$_JQ_HISTORY_FILTER" "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || {
        echo "[section-summary] ⚠️ Falha ao persistir section_history (sponge) — context.json não atualizado" >&2
    }
elif [ -f "$CTX_FILE" ]; then
    TMP="$(mktemp)"
    jq \
        --arg name "$SECTION_NAME" \
        --argjson num "$SECTION_NUM" \
        --argjson turns "$TURNS_COVERED" \
        --argjson dur "$DURATION_S" \
        --argjson pushes "$PUSH_COUNT_SECTION" \
        --arg section_id "${SECTION_ID:-}" \
        --arg ts "$NOW_ISO" \
        --argjson cap "$_HISTORY_CAP" \
        --arg summary_file "section-summaries/section-${SECTION_NUM}-${SECTION_SLUG}-${NOW_SHORT}.md" \
        "$_JQ_HISTORY_FILTER" "$CTX_FILE" > "$TMP" 2> /dev/null
    if mv "$TMP" "$CTX_FILE" 2> /dev/null; then
        : # persistido com sucesso
    else
        rm -f "$TMP" 2> /dev/null || true
        echo "[section-summary] Falha ao persistir section_history (mv) -- context.json nao atualizado" >&2
    fi
fi

echo "[section-summary] Gerado: $SUMMARY_FILE (${DURATION_HUMAN}, ${TURNS_COVERED} turnos, ${TOOLS_TOTAL} ferramentas)" >&2
exit 0
