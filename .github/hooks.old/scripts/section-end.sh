#!/bin/bash
# section-end.sh — Encerra explicitamente uma Seção Temática (Schema v4)
#
# Complemento de start-section.sh para fechar o ciclo de vida de uma seção.
# Registra duração, número de turnos cobertos, section_number e o motivo do encerramento.
#
# INVARIANTE (Schema v4): sempre deve haver SESSION + SECTION + TURN ativos.
# Ao encerrar uma seção manualmente, a seção fica null (sem ativa) até que
# start-section.sh seja chamado novamente. Em session-end.sh a última seção
# é fechada automaticamente com reason="session_ended".
#
# Uso: bash section-end.sh ["<motivo>"]
# Exemplo: bash section-end.sh "implementação concluída"
#
# Se não houver seção ativa, o script avisa e encerra sem erro.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
AUDIT_FILE="$LOG_DIR/audit.jsonl"
STATE_DIR="$HOOK_DIR/state"
CTX_FILE="$STATE_DIR/session-context.json"
# UPG-AUDIT-01: resolve per-session paths from current-session-id.txt
_CSI_FILE="$STATE_DIR/current-session-id.txt"
if [ -f "$_CSI_FILE" ] && _CURR_SID="$(cat "$_CSI_FILE" 2> /dev/null)" && [ -n "$_CURR_SID" ]; then
    _SID_SHORT="${_CURR_SID:0:8}"
    CTX_FILE="$STATE_DIR/session-context-${_SID_SHORT}.json"
    AUDIT_FILE="$LOG_DIR/audit-${_SID_SHORT}.jsonl"
fi

mkdir -p "$LOG_DIR" "$STATE_DIR"

REASON="${1:-concluída}"
NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# Lê o contexto atual — especialmente a seção ativa
SESSION_ID="unknown"
SECTION_NAME=""
SECTION_STARTED_AT=""
SECTION_TURN_START=0
SECTION_NUMBER=0
TURN_COUNT=0
SECTION_ID=""

if [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session.id // "unknown"' "$CTX_FILE" 2> /dev/null || echo 'unknown')"
    SECTION_NAME="$(jq -r '.current_section.name // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    SECTION_STARTED_AT="$(jq -r '.current_section.started_at // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    SECTION_TURN_START="$(jq -r '.current_section.turn_start // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    SECTION_NUMBER="$(jq -r '.current_section.section_number // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    TURN_COUNT="$(jq -r '.session_stats.turn_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    SECTION_ID="$(jq -r '.current_section.section_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
fi

# Sem seção ativa — avisa e sai sem erro
if [ -z "$SECTION_NAME" ] || [ "$SECTION_NAME" = "null" ]; then
    echo "[seção] Nenhuma seção ativa para encerrar." >&2
    exit 0
fi

# Calcula duração da seção em segundos
# BUG-61 FIX: date -d é GNU-only; fallback para BSD (macOS)
DURATION_S=0
if [ -n "$SECTION_STARTED_AT" ] && [ "$SECTION_STARTED_AT" != "null" ]; then
    if date -d "$SECTION_STARTED_AT" '+%s' > /dev/null 2>&1; then
        SECTION_EPOCH="$(date -d "$SECTION_STARTED_AT" '+%s' 2> /dev/null || echo 0)"
    else
        SECTION_EPOCH="$(date -j -f '%Y-%m-%dT%H:%M:%SZ' "$SECTION_STARTED_AT" '+%s' 2> /dev/null || echo 0)"
    fi
    NOW_EPOCH="$(date -u '+%s' 2> /dev/null || echo 0)"
    if [ "$NOW_EPOCH" -gt "$SECTION_EPOCH" ]; then
        DURATION_S=$((NOW_EPOCH - SECTION_EPOCH))
    fi
fi

# Calcula turnos cobertos pela seção
CURRENT_TURN=$((TURN_COUNT + 1))
TURNS_COVERED=$((CURRENT_TURN - SECTION_TURN_START))
if [ "$TURNS_COVERED" -lt 0 ]; then
    TURNS_COVERED=0
fi

# GAP-S02 FIX: mantém dados de current_section mas marca como fechada com is_closed=true.
# Antes: anulava todos os campos → section_name=null em eventos intermediários.
# Agora: preserva name/started_at/etc. para audit log; agent-stop.sh detecta is_closed=true
# para acionar criação de seção "retomada" se necessário.
if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
    jq --arg ts "$NOW_ISO" \
        '.current_section.is_closed = true | .current_section.closed_at = $ts' \
        "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
elif [ -f "$CTX_FILE" ]; then
    TMP="$(mktemp)"
    jq --arg ts "$NOW_ISO" \
        '.current_section.is_closed = true | .current_section.closed_at = $ts' \
        "$CTX_FILE" > "$TMP" && mv "$TMP" "$CTX_FILE"
fi

# AVISO: invariante SESSION+SECTION+TURN em estado transitório.
# current_section.is_closed=true até próximo start-section.sh.
# agent-stop.sh detecta is_closed e cria seção "retomada" se necessário.
# Ferramentas chamadas nesse intervalo ainda registram o nome correto da seção anterior.
# AÇÃO RECOMENDADA: chame start-section.sh IMEDIATAMENTE após section-end.sh.
echo "[seção][AVISO] Seção \"${SECTION_NAME}\" marcada is_closed=true. Chame start-section.sh imediatamente." >&2

# Registra evento sectionEnd no audit.jsonl (Schema v4: inclui section_number)
jq -cn \
    --arg event "sectionEnd" \
    --arg sid "$SESSION_ID" \
    --arg ts "$NOW_ISO" \
    --arg name "$SECTION_NAME" \
    --arg reason "$REASON" \
    --arg started_at "$SECTION_STARTED_AT" \
    --arg section_id "${SECTION_ID:-}" \
    --argjson turn_start "$SECTION_TURN_START" \
    --argjson turn_end "$CURRENT_TURN" \
    --argjson turns_covered "$TURNS_COVERED" \
    --argjson duration_s "$DURATION_S" \
    --argjson section_number "$SECTION_NUMBER" \
    '{
        event:          $event,
        session_id:     $sid,
        timestamp:      $ts,
        section_name:   $name,
        section_number: $section_number,
        section_id:     (if $section_id == "" then null else $section_id end),
        reason:         $reason,
        started_at:     $started_at,
        turn_start:     $turn_start,
        turn_end:       $turn_end,
        turns_covered:  $turns_covered,
        duration_s:     $duration_s
    }' >> "$AUDIT_FILE"

echo "[seção] Encerrada: \"$SECTION_NAME\" (seção #${SECTION_NUMBER}, ${TURNS_COVERED} turno(s), ${DURATION_S}s) — $REASON" >&2
exit 0
