#!/bin/bash
# continue-section.sh — Confirma continuação na section atual após um git push.
#
# Limpa o flag `pending_section_after_push` sem criar uma nova section.
# Use quando o agente decide que o push não justifica mudança de fase.
#
# Uso:
#   bash .github/hooks/scripts/continue-section.sh ["motivo opcional"]
#   npm run hooks:continue-section
#
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$(cd "$SCRIPTS_DIR/.." && pwd)"
STATE_DIR="$HOOKS_DIR/state"
LOG_DIR="$HOOKS_DIR/logs"
AUDIT_FILE="$LOG_DIR/audit.jsonl"
CTX_FILE="$STATE_DIR/session-context.json"
# UPG-AUDIT-01: resolve per-session paths from current-session-id.txt
_CSI_FILE="$STATE_DIR/current-session-id.txt"
if [ -f "$_CSI_FILE" ] && _CURR_SID="$(cat "$_CSI_FILE" 2> /dev/null)" && [ -n "$_CURR_SID" ]; then
    _SID_SHORT="${_CURR_SID:0:8}"
    CTX_FILE="$STATE_DIR/session-context-${_SID_SHORT}.json"
    AUDIT_FILE="$LOG_DIR/audit-${_SID_SHORT}.jsonl"
fi

REASON="${1:-continuar na section atual}"

# ── Lê state ─────────────────────────────────────────────────────────────────
SESSION_ID=""
SECTION_NAME=""
SECTION_ID=""
TURN_COUNT=0

if [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    SECTION_NAME="$(jq -r '.current_section.name // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    SECTION_ID="$(jq -r '.current_section.section_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    TURN_COUNT="$(jq -r '.session_stats.turn_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
fi

if [ -z "$SESSION_ID" ]; then
    echo "[continue-section] Nenhuma SESSION ativa — nada a fazer." >&2
    exit 0
fi

NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
CURRENT_TURN=$((TURN_COUNT + 1))

# Verifica se o flag está ativo
PENDING="$(jq -r '.session_stats.pending_section_after_push // false' "$CTX_FILE" 2> /dev/null || echo 'false')"
if [ "$PENDING" != "true" ]; then
    echo "[continue-section] Flag pending_section_after_push não estava ativo — sem ação necessária." >&2
    exit 0
fi

# ── Limpa o flag ─────────────────────────────────────────────────────────────
if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
    # Captura output do jq separadamente: evita sponge gravar arquivo vazio se jq falhar
    UPDATED="$(jq '.session_stats.pending_section_after_push = false' "$CTX_FILE" 2> /dev/null)" || {
        echo "[continue-section] ERRO: jq falhou — state intacto" >&2
        exit 1
    }
    printf '%s\n' "$UPDATED" | sponge "$CTX_FILE" || {
        echo "[continue-section] ERRO: sponge falhou ao gravar — state pode estar corrompido!" >&2
        exit 1
    }
elif [ -f "$CTX_FILE" ]; then
    TMP="$(mktemp)" || exit 1
    jq '.session_stats.pending_section_after_push = false' "$CTX_FILE" > "$TMP" || {
        rm -f "$TMP"
        echo "[continue-section] ERRO: jq falhou — state intacto" >&2
        exit 1
    }
    mv "$TMP" "$CTX_FILE" || {
        echo "[continue-section] ERRO: mv falhou — state intacto" >&2
        exit 2
    }
fi

# ── Loga evento sectionContinued ──────────────────────────────────────────────
mkdir -p "$LOG_DIR"
jq -cn \
    --arg event "sectionContinued" \
    --arg sid "$SESSION_ID" \
    --arg ts "$NOW_ISO" \
    --argjson turn "$CURRENT_TURN" \
    --arg section_name "$SECTION_NAME" \
    --arg section_id "${SECTION_ID:-}" \
    --arg reason "$REASON" \
    '{
        event:        $event,
        session_id:   $sid,
        timestamp:    $ts,
        turn_number:  $turn,
        section_name: (if $section_name == "" then null else $section_name end),
        section_id:   (if $section_id == "" then null else $section_id end),
        reason:       $reason
    }' >> "$AUDIT_FILE"

echo "[continue-section] Section \"${SECTION_NAME}\" continuada após push — flag limpo." >&2
exit 0
