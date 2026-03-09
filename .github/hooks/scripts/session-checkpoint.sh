#!/bin/bash
# session-checkpoint.sh — Snapshot incremental de estado de sessão
#
# Cria um ponto de controle persistente em checkpoints/ após cada turno.
# Permite recuperar o estado de sessões anteriores e rastrear progresso ao longo
# de múltiplas sessões. É chamado pelo agent-stop.sh automaticamente, mas pode
# ser invocado manualmente pelo agente para forçar um checkpoint imediato.
#
# Uso: bash session-checkpoint.sh [--force]
#   --force  Salva mesmo se o contexto está incompleto
#
# Gera: .github/hooks/checkpoints/sess_{session_id}_{timestamp}.json
# Prune: mantém os últimos $MAX_CHECKPOINTS (padrão 30) por sessão.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
CHECKPOINT_DIR="$HOOK_DIR/checkpoints"
CTX_FILE="$STATE_DIR/session-context.json"
TASKS_FILE="$STATE_DIR/pending-tasks.md"
FINDINGS_FILE="$LOG_DIR/findings.jsonl"
METRICS_FILE="$LOG_DIR/tool-metrics.jsonl"

MAX_CHECKPOINTS="${MAX_CHECKPOINTS:-30}"
NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
NOW_SHORT="$(date -u '+%Y%m%d_%H%M%S')"

mkdir -p "$CHECKPOINT_DIR"

# ── Lê contexto atual (schema v2) ────────────────────────────────────────────
if [ ! -f "$CTX_FILE" ]; then
    echo "[checkpoint] AVISO: session-context.json não encontrado — abortando." >&2
    exit 0
fi

SESSION_ID="$(jq -r '.session.id // "unknown"' "$CTX_FILE" 2>/dev/null || echo 'unknown')"
TURN_COUNT="$(jq -r '.session_stats.turn_count // 0' "$CTX_FILE" 2>/dev/null || echo 0)"
TOOLS_TOTAL="$(jq -r '.session_stats.tools_total // 0' "$CTX_FILE" 2>/dev/null || echo 0)"
FAILURES_TOTAL="$(jq -r '.session_stats.failures_detected // 0' "$CTX_FILE" 2>/dev/null || echo 0)"
LAST_TOOL_NAME="$(jq -r '.last_tool.name // ""' "$CTX_FILE" 2>/dev/null || echo '')"
LAST_TOOL_TS="$(jq -r '.last_tool.ts // ""' "$CTX_FILE" 2>/dev/null || echo '')"
SESSION_STARTED="$(jq -r '.session.started_at // ""' "$CTX_FILE" 2>/dev/null || echo '')"
TOOLS_BY_NAME="$(jq -c '.session_stats.tools_by_name // {}' "$CTX_FILE" 2>/dev/null || echo '{}')"
CURRENT_SECTION="$(jq -c '.current_section // null' "$CTX_FILE" 2>/dev/null || echo 'null')"
CONSECUTIVE_VIOLATIONS="$(jq -r '.compliance.consecutive_unauthorized // 0' "$CTX_FILE" 2>/dev/null || echo 0)"

# ── Conta tarefas abertas por prioridade ────────────────────────────────────
TASKS_ALTA=0
TASKS_MEDIA=0
TASKS_BACKLOG=0
TASKS_DONE=0

if [ -f "$TASKS_FILE" ]; then
    TASKS_ALTA="$(awk '/^## Alta Prioridade/{f=1} /^## / && !/^## Alta/{f=0} f && /^\- \[ \]/' "$TASKS_FILE" | wc -l | tr -d ' ')"
    TASKS_MEDIA="$(awk '/^## Média Prioridade/{f=1} /^## / && !/^## Média/{f=0} f && /^\- \[ \]/' "$TASKS_FILE" | wc -l | tr -d ' ')"
    TASKS_BACKLOG="$(awk '/^## Backlog/{f=1} /^## / && !/^## Backlog/{f=0} f && /^\- \[ \]/' "$TASKS_FILE" | wc -l | tr -d ' ')"
    TASKS_DONE="$(grep -c '^\- \[x\]' "$TASKS_FILE" 2>/dev/null | tr -d ' \n' || echo 0)"
fi

TASKS_OPEN=$((TASKS_ALTA + TASKS_MEDIA + TASKS_BACKLOG))

# ── Hash do pending-tasks.md para detectar mudanças entre checkpoints ─────
TASKS_HASH=""
TASKS_CHANGED=false
PREV_CHECKPOINT_TASKS_HASH=""

if [ -f "$TASKS_FILE" ] && command -v sha256sum >/dev/null 2>&1; then
    TASKS_HASH="$(sha256sum "$TASKS_FILE" | awk '{print $1}')"
fi

# Compara com checkpoint anterior desta sessão (se existir)
LATEST_LINK="$CHECKPOINT_DIR/sess_${SESSION_ID}_latest.json"
if [ -f "$LATEST_LINK" ]; then
    PREV_CHECKPOINT_TASKS_HASH="$(jq -r '.tasks.hash // ""' "$LATEST_LINK" 2>/dev/null || echo '')"
    if [ -n "$TASKS_HASH" ] && [ -n "$PREV_CHECKPOINT_TASKS_HASH" ] \
        && [ "$TASKS_HASH" != "$PREV_CHECKPOINT_TASKS_HASH" ]; then
        TASKS_CHANGED=true
    fi
fi

# ── Conta findings abertos ────────────────────────────────────────────────────
FINDINGS_TOTAL=0
FINDINGS_CRITICAL=0
FINDINGS_HIGH=0
if [ -f "$FINDINGS_FILE" ]; then
    FINDINGS_TOTAL="$(wc -l < "$FINDINGS_FILE" | tr -d ' ')"
    FINDINGS_CRITICAL="$(jq -rs '[.[] | select(.severity == "critical")] | length' "$FINDINGS_FILE" 2>/dev/null || echo 0)"
    FINDINGS_HIGH="$(jq -rs '[.[] | select(.severity == "high")] | length' "$FINDINGS_FILE" 2>/dev/null || echo 0)"
fi

# ── Métricas acumuladas de tool-metrics.jsonl ────────────────────────────────
TOOLS_SUCCESS=0
AVG_DURATION_MS=0
if [ -f "$METRICS_FILE" ]; then
    TOOLS_SUCCESS="$(jq -rs '[.[] | select(.result_type == "success")] | length' "$METRICS_FILE" 2>/dev/null || echo 0)"
    AVG_DURATION_MS="$(jq -rs 'if length > 0 then ([.[].duration_ms] | add / length | floor) else 0 end' "$METRICS_FILE" 2>/dev/null || echo 0)"
fi

# ── Monta o snapshot ─────────────────────────────────────────────────────────
CHECKPOINT_FILE="$CHECKPOINT_DIR/sess_${SESSION_ID}_turn${TURN_COUNT}_${NOW_SHORT}.json"

jq -cn \
    --arg checkpoint_ts "$NOW_ISO" \
    --arg session_id "$SESSION_ID" \
    --arg session_started "$SESSION_STARTED" \
    --arg last_tool_name "$LAST_TOOL_NAME" \
    --arg last_tool_ts "$LAST_TOOL_TS" \
    --argjson turn_count "$TURN_COUNT" \
    --argjson tools_total "$TOOLS_TOTAL" \
    --argjson failures_detected "$FAILURES_TOTAL" \
    --argjson consecutive_violations "$CONSECUTIVE_VIOLATIONS" \
    --argjson tools_by_name "$TOOLS_BY_NAME" \
    --argjson current_section "$CURRENT_SECTION" \
    --argjson tasks_alta "$TASKS_ALTA" \
    --argjson tasks_media "$TASKS_MEDIA" \
    --argjson tasks_backlog "$TASKS_BACKLOG" \
    --argjson tasks_open "$TASKS_OPEN" \
    --argjson tasks_done "$TASKS_DONE" \
    --arg tasks_hash "$TASKS_HASH" \
    --argjson tasks_changed "$TASKS_CHANGED" \
    --argjson findings_total "$FINDINGS_TOTAL" \
    --argjson findings_critical "$FINDINGS_CRITICAL" \
    --argjson findings_high "$FINDINGS_HIGH" \
    --argjson tools_success "$TOOLS_SUCCESS" \
    --argjson avg_duration_ms "$AVG_DURATION_MS" \
    '{
        checkpoint_ts:    $checkpoint_ts,
        session_id:       $session_id,
        session_started:  $session_started,
        turn_count:       $turn_count,
        last_tool: {
            name:         $last_tool_name,
            ts:           $last_tool_ts
        },
        session_stats: {
            tools_total:         $tools_total,
            tools_success:       $tools_success,
            failures_detected:   $failures_detected,
            avg_duration_ms:     $avg_duration_ms,
            tools_by_name:       $tools_by_name,
            consecutive_violations: $consecutive_violations
        },
        current_section:  $current_section,
        tasks: {
            alta:          $tasks_alta,
            media:         $tasks_media,
            backlog:       $tasks_backlog,
            open_total:    $tasks_open,
            done_total:    $tasks_done,
            hash:          $tasks_hash,
            changed:       $tasks_changed
        },
        findings: {
            total:         $findings_total,
            critical:      $findings_critical,
            high:          $findings_high
        }
    }' > "$CHECKPOINT_FILE"

# Atualiza link simbólico "latest" para o checkpoint mais recente desta sessão
ln -sf "$CHECKPOINT_FILE" "$LATEST_LINK" 2>/dev/null || cp "$CHECKPOINT_FILE" "$LATEST_LINK"

# ── Prune: remove checkpoints antigos mantendo MAX_CHECKPOINTS por sessão ────
mapfile -t SESS_FILES < <(compgen -G "$CHECKPOINT_DIR/sess_${SESSION_ID}_turn*.json" 2>/dev/null || true)
FILE_COUNT="${#SESS_FILES[@]}"

if [ "$FILE_COUNT" -gt "$MAX_CHECKPOINTS" ]; then
    REMOVE_COUNT=$((FILE_COUNT - MAX_CHECKPOINTS))
    for old_file in "${SESS_FILES[@]:0:$REMOVE_COUNT}"; do
        rm -f "$old_file" 2>/dev/null || true
    done
fi

# Registra o checkpoint no audit.jsonl
jq -cn \
    --arg event "sessionCheckpoint" \
    --arg sid "$SESSION_ID" \
    --arg ts "$NOW_ISO" \
    --arg file "$CHECKPOINT_FILE" \
    --argjson turn "$TURN_COUNT" \
    --argjson tasks_open "$TASKS_OPEN" \
    '{
        event:           $event,
        session_id:      $sid,
        timestamp:       $ts,
        turn_count:      $turn,
        tasks_open:      $tasks_open,
        checkpoint_file: $file
    }' >> "$LOG_DIR/audit.jsonl"

echo "[checkpoint] Snapshot turno $TURN_COUNT salvo: $CHECKPOINT_FILE" >&2
exit 0
