#!/bin/bash
# start-section.sh — Declara início de uma Seção Temática (Schema v4)
#
# Uma Seção Temática é uma fase lógica nomeada dentro de uma sessão Copilot,
# declarada pelo próprio agente para marcar mudanças de contexto de trabalho.
# Exemplos: "planejamento", "implementação", "revisão", "debugging", "testes".
#
# INVARIANTE (Schema v4): sempre deve haver SESSION + SECTION + TURN ativos.
# Se uma seção estiver ativa ao chamar este script, ela é encerrada automaticamente
# com os procedimentos completos de sectionEnd antes da nova ser aberta.
#
# Uso: bash start-section.sh "<nome da seção>" ["<descrição opcional>"]
# Exemplo: bash start-section.sh "implementação" "Fase de codificação das fases A-C"
#
# Armazena em session-context.json:
#   current_section.{name, started_at, turn_start, description, section_number}
#   session_stats.{section_count, section_names}
# Logs em audit.jsonl: sectionEnd (se havia ativa) + sectionStart
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
CTX_FILE="$STATE_DIR/session-context.json"

mkdir -p "$LOG_DIR" "$STATE_DIR"

SECTION_NAME="${1:-}"
SECTION_DESC="${2:-}"

if [ -z "$SECTION_NAME" ]; then
    echo "Uso: bash start-section.sh \"<nome da seção>\" [\"<descrição opcional>\"]" >&2
    echo "Exemplo: bash start-section.sh \"implementação\" \"Fase de codificação\"" >&2
    exit 1
fi

NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# Lê contexto atual
SESSION_ID="unknown"
TURN_NUMBER=0
PREV_SECTION_NAME=""
PREV_SECTION_STARTED=""
PREV_SECTION_TURN_START=0
PREV_SECTION_NUMBER=0
CURRENT_SECTION_COUNT=0
PREV_SECTION_PUSH_COUNT=0
PREV_SECTION_ID=""

if [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session.id // "unknown"' "$CTX_FILE" 2> /dev/null || echo 'unknown')"
    TURN_NUMBER="$(jq -r '.session_stats.turn_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    PREV_SECTION_NAME="$(jq -r '.current_section.name // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    PREV_SECTION_STARTED="$(jq -r '.current_section.started_at // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    PREV_SECTION_TURN_START="$(jq -r '.current_section.turn_start // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    PREV_SECTION_NUMBER="$(jq -r '.current_section.section_number // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    CURRENT_SECTION_COUNT="$(jq -r '.session_stats.section_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    PREV_SECTION_PUSH_COUNT="$(jq -r '.current_section.push_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    PREV_SECTION_ID="$(jq -r '.current_section.section_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
fi
CURRENT_TURN=$((TURN_NUMBER + 1))

# ── Se há uma seção ativa: encerra-a com sectionEnd completo ─────────────────
AUTO_CLOSED_PREV=""
if [ -n "$PREV_SECTION_NAME" ]; then
    AUTO_CLOSED_PREV="$PREV_SECTION_NAME"

    # Calcula duration_s da seção anterior (bash puro — sem dependência de python3)
    PREV_DURATION_S=0
    if [ -n "$PREV_SECTION_STARTED" ]; then
        START_S="$(date -d "$PREV_SECTION_STARTED" '+%s' 2> /dev/null || echo 0)"
        NOW_S="$(date -d "$NOW_ISO" '+%s' 2> /dev/null || echo 0)"
        if [ "$NOW_S" -gt "$START_S" ] 2> /dev/null; then
            PREV_DURATION_S=$((NOW_S - START_S))
        fi
    fi

    # Calcula turns_covered
    PREV_TURNS_COVERED=$((CURRENT_TURN - PREV_SECTION_TURN_START))
    if [ "$PREV_TURNS_COVERED" -lt 1 ]; then PREV_TURNS_COVERED=1; fi

    # Loga sectionEnd da seção anterior no audit.jsonl
    jq -cn \
        --arg event "sectionEnd" \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_ISO" \
        --arg name "$PREV_SECTION_NAME" \
        --arg reason "auto_closed_by_new_section" \
        --arg started_at "$PREV_SECTION_STARTED" \
        --arg section_id "${PREV_SECTION_ID:-}" \
        --argjson turn_start "$PREV_SECTION_TURN_START" \
        --argjson turn_end "$CURRENT_TURN" \
        --argjson turns_covered "$PREV_TURNS_COVERED" \
        --argjson duration_s "$PREV_DURATION_S" \
        --argjson section_number "$PREV_SECTION_NUMBER" \
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
        }' >> "$LOG_DIR/audit.jsonl"

    echo "[seção] Encerrando automaticamente: \"$PREV_SECTION_NAME\" (${PREV_DURATION_S}s, ${PREV_TURNS_COVERED} turno(s))" >&2

    # ── Gera sumário da seção encerrada (Schema v6 — section_history) ────────
    # Lê push_count da seção para passar ao gerador de sumário.
    # Passa o push_count da seção (rastreado por current_section.push_count)
    if [ -x "$(dirname "${BASH_SOURCE[0]}")/generate-section-summary.sh" ]; then
        bash "$(dirname "${BASH_SOURCE[0]}")/generate-section-summary.sh" \
            "$PREV_SECTION_NAME" \
            "$PREV_SECTION_NUMBER" \
            "$PREV_DURATION_S" \
            "$PREV_TURNS_COVERED" \
            "$PREV_SECTION_PUSH_COUNT" \
            "${PREV_SECTION_ID:-}" \
            2>&2 || true # nunca falha — sumário é opcional
    fi
fi

# ── Calcula número da nova seção e gera section_id UUID ─────────────────────
NEW_SECTION_NUMBER=$((CURRENT_SECTION_COUNT + 1))
NEW_SECTION_ID="$(uuidgen 2> /dev/null || printf 'sect_%s_%s' "$(date +%s)" "$$")"

# ── Atualiza session-context.json com nova seção + session_stats ──────────────
_JQ_ARGS=(
    --arg name "$SECTION_NAME"
    --arg ts "$NOW_ISO"
    --argjson turn "$CURRENT_TURN"
    --argjson section_num "$NEW_SECTION_NUMBER"
    --arg section_id "$NEW_SECTION_ID"
)
if [ -n "$SECTION_DESC" ]; then
    _JQ_ARGS+=(--arg desc "$SECTION_DESC")
    # shellcheck disable=SC2016
    _JQ_FILTER='.current_section = {name: $name, section_id: $section_id, started_at: $ts, turn_start: $turn, local_turn: 0, description: $desc, section_number: $section_num, push_count: 0, tools_by_name: {}, intent_history: [], failures_count: 0, blocked_turns: 0}
                | .session_stats.section_count = $section_num
                | .session_stats.section_names += [$name]
                | .session_stats.section_history = ((.session_stats.section_history // []) + [{name: $name, section_id: $section_id, section_number: $section_num, started_at: $ts}] | if length > 50 then .[-50:] else . end)'
else
    # shellcheck disable=SC2016
    _JQ_FILTER='.current_section = {name: $name, section_id: $section_id, started_at: $ts, turn_start: $turn, local_turn: 0, description: null, section_number: $section_num, push_count: 0, tools_by_name: {}, intent_history: [], failures_count: 0, blocked_turns: 0}
                | .session_stats.section_count = $section_num
                | .session_stats.section_names += [$name]
                | .session_stats.section_history = ((.session_stats.section_history // []) + [{name: $name, section_id: $section_id, section_number: $section_num, started_at: $ts}] | if length > 50 then .[-50:] else . end)'
fi

if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
    jq "${_JQ_ARGS[@]}" "$_JQ_FILTER" "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null
elif [ -f "$CTX_FILE" ]; then
    TMP="$(mktemp)"
    jq "${_JQ_ARGS[@]}" "$_JQ_FILTER" "$CTX_FILE" > "$TMP" && mv "$TMP" "$CTX_FILE"
fi

# ── Loga sectionStart no audit.jsonl ─────────────────────────────────────────
jq -cn \
    --arg event "sectionStart" \
    --arg sid "$SESSION_ID" \
    --arg ts "$NOW_ISO" \
    --arg name "$SECTION_NAME" \
    --arg section_id "$NEW_SECTION_ID" \
    --argjson turn "$CURRENT_TURN" \
    --argjson section_num "$NEW_SECTION_NUMBER" \
    --arg prev_section "${AUTO_CLOSED_PREV}" \
    --arg desc "${SECTION_DESC}" \
    '{
        event:          $event,
        session_id:     $sid,
        timestamp:      $ts,
        section_name:   $name,
        section_id:     $section_id,
        section_number: $section_num,
        turn_number:    $turn,
        description:    (if $desc == "" then null else $desc end),
        prev_section:   (if $prev_section == "" then null else $prev_section end),
        auto_open:      false
    }' >> "$LOG_DIR/audit.jsonl"

if [ -n "$AUTO_CLOSED_PREV" ]; then
    echo "[seção] Iniciando: \"$SECTION_NAME\" (seção #${NEW_SECTION_NUMBER}, turno ~$CURRENT_TURN) — anterior encerrada automaticamente" >&2
else
    echo "[seção] Iniciando: \"$SECTION_NAME\" (seção #${NEW_SECTION_NUMBER}, turno ~$CURRENT_TURN)" >&2
fi
exit 0
