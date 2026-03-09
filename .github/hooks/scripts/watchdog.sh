#!/bin/bash
# watchdog.sh — Monitora saúde do sistema de hooks; detecta e reporta anomalias.
#
# Detecta:
#   1. Sessão estagnada (started_at > STALE_HOURS h atrás sem atividade recente)
#   2. Flags órfãos (UNAUTHORIZED_CLOSE.flag / SESSION_CLOSE_NO_KEY.flag sem sessão ativa)
#   3. session-context.json corrompido/vazio
#   4. TURNs não-autorizados consecutivos (compliance.consecutive_unauthorized > 0)
#   5. Compactações excessivas (session_stats.compaction_count > COMPACT_WARN)
#
# Saída:
#   - Relatório JSON em state/watchdog-report.json (sempre)
#   - Stdout: sumário human-readable (suprimível com --quiet)
#   - Exit 0 se saudável, exit 1 se há alertas críticos (--strict) ou sempre 0 (padrão)
#
# Uso:
#   bash .github/hooks/scripts/watchdog.sh
#   bash .github/hooks/scripts/watchdog.sh --quiet
#   bash .github/hooks/scripts/watchdog.sh --strict   (exit 1 em alertas críticos)
#   bash .github/hooks/scripts/watchdog.sh --auto-fix (limpa flags órfãos automaticamente)
#   bash .github/hooks/scripts/watchdog.sh --json     (apenas JSON no stdout, sem sumário)
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
CTX_FILE="$STATE_DIR/session-context.json"
REPORT_FILE="$STATE_DIR/watchdog-report.json"
AUDIT_FILE="$LOG_DIR/audit.jsonl"

# Limiares configuráveis (horas)
STALE_HOURS="${WATCHDOG_STALE_HOURS:-8}"
TURN_IDLE_HOURS="${WATCHDOG_TURN_IDLE_HOURS:-2}"
COMPACT_WARN="${WATCHDOG_COMPACT_WARN:-5}"

QUIET=false
STRICT=false
AUTO_FIX=false
JSON_ONLY=false

for arg in "$@"; do
    case "${arg:-}" in
        --quiet) QUIET=true ;;
        --strict) STRICT=true ;;
        --auto-fix) AUTO_FIX=true ;;
        --json)
            JSON_ONLY=true
            QUIET=true
            ;;
        --help)
            sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# //'
            exit 0
            ;;
    esac
done

mkdir -p "$LOG_DIR" "$STATE_DIR"

NOW_EPOCH="$(date +%s 2> /dev/null || echo 0)"
NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
ALERTS=()
INFOS=()
FIXES=()
CRITICAL_COUNT=0
WARN_COUNT=0

alert_critical() {
    ALERTS+=("{\"level\":\"critical\",\"code\":\"$1\",\"message\":$(printf '%s' "$2" | jq -Rs .)}")
    CRITICAL_COUNT=$((CRITICAL_COUNT + 1))
}
alert_warn() {
    ALERTS+=("{\"level\":\"warn\",\"code\":\"$1\",\"message\":$(printf '%s' "$2" | jq -Rs .)}")
    WARN_COUNT=$((WARN_COUNT + 1))
}
alert_info() {
    INFOS+=("$1")
}
record_fix() {
    FIXES+=("{\"action\":$(printf '%s' "$1" | jq -Rs .),\"timestamp\":\"$NOW_ISO\"}")
}

# Converte ISO datetime para epoch (compatível com Linux e macOS)
iso_to_epoch() {
    local iso="$1"
    if [ -z "$iso" ] || [ "$iso" = "null" ]; then
        echo 0
        return
    fi
    # Remove sub-segundos e sufixo Z
    local normalized
    normalized="$(echo "$iso" | sed 's/\.[0-9]*Z$/Z/' | sed 's/Z$//')"
    date -u -d "${normalized}Z" '+%s' 2> /dev/null \
        || date -u -j -f '%Y-%m-%dT%H:%M:%S' "$normalized" '+%s' 2> /dev/null \
        || echo 0
}

hours_since() {
    local epoch="$1"
    if [ "$epoch" -eq 0 ] 2> /dev/null; then
        echo 99999
        return
    fi
    echo $(((NOW_EPOCH - epoch) / 3600))
}

# ─────────────────────────────────────────────────────────────────────────────
# 1. Verifica session-context.json
# ─────────────────────────────────────────────────────────────────────────────
SESSION_ID=""
SESSION_ACTIVE=false
STARTED_AT_EPOCH=0
LAST_TURN_EPOCH=0
TURN_COUNT=0
CONSEC_UNAUTH=0
COMPACTION_COUNT=0
SESSION_SOURCE=""

if [ ! -f "$CTX_FILE" ]; then
    alert_info "session-context.json não encontrado — nenhuma sessão registrada"
elif [ ! -s "$CTX_FILE" ]; then
    alert_critical "CTX_EMPTY" "session-context.json está vazio (0 bytes) — estado corrompido ou ausente"
elif ! jq empty "$CTX_FILE" 2> /dev/null; then
    alert_critical "CTX_INVALID_JSON" "session-context.json contém JSON inválido — estado corrompido"
else
    # Lê campos do contexto
    SESSION_ID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    ENDED_AT="$(jq -r '.session.ended_at // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    STARTED_AT="$(jq -r '.session.started_at // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    LAST_TURN_TS="$(jq -r '.last_turn_ts // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    TURN_COUNT="$(jq -r '.session_stats.turn_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    CONSEC_UNAUTH="$(jq -r '.compliance.consecutive_unauthorized // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    COMPACTION_COUNT="$(jq -r '.session_stats.compaction_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    SESSION_SOURCE="$(jq -r '.session.source // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    # SESSION_SOURCE disponível para expansão futura (ex: "manual_recovery" indica auto-recovery)
    : "${SESSION_SOURCE}"

    # Sessão está ativa se ended_at é null/vazio
    if [ -z "$ENDED_AT" ] || [ "$ENDED_AT" = "null" ]; then
        SESSION_ACTIVE=true
    fi

    # Calcula epoch dos timestamps relevantes
    STARTED_AT_EPOCH="$(iso_to_epoch "$STARTED_AT")"
    LAST_TURN_EPOCH="$(iso_to_epoch "$LAST_TURN_TS")"

    # ── Check 1.a: sessão estagnada ──
    if [ "$SESSION_ACTIVE" = "true" ] && [ "$STARTED_AT_EPOCH" -gt 0 ] 2> /dev/null; then
        HOURS_OLD="$(hours_since "$STARTED_AT_EPOCH")"
        if [ "$HOURS_OLD" -ge "$STALE_HOURS" ] 2> /dev/null; then
            alert_critical "SESSION_STALE" \
                "Sessão ativa há ${HOURS_OLD}h (limiar: ${STALE_HOURS}h). Pode ser estado órfão de sessão anterior. ID: ${SESSION_ID}"
        fi
    fi

    # ── Check 1.b: último turn muito antigo ──
    if [ "$SESSION_ACTIVE" = "true" ] && [ "$LAST_TURN_EPOCH" -gt 0 ] 2> /dev/null; then
        HOURS_IDLE="$(hours_since "$LAST_TURN_EPOCH")"
        if [ "$HOURS_IDLE" -ge "$TURN_IDLE_HOURS" ] 2> /dev/null; then
            alert_warn "TURN_IDLE" \
                "Último TURN há ${HOURS_IDLE}h sem atividade (limiar: ${TURN_IDLE_HOURS}h)."
        fi
    fi

    # ── Check 1.c: TURNs não autorizados ──
    if [ "$CONSEC_UNAUTH" -gt 0 ] 2> /dev/null; then
        alert_warn "CONSEC_UNAUTH" \
            "${CONSEC_UNAUTH} TURN(s) não-autorizado(s) consecutivos detectados na sessão atual."
    fi

    # ── Check 1.d: compactações excessivas ──
    if [ "$COMPACTION_COUNT" -gt "$COMPACT_WARN" ] 2> /dev/null; then
        alert_warn "HIGH_COMPACTION" \
            "${COMPACTION_COUNT} compactações nesta sessão (limiar: ${COMPACT_WARN}). Contexto pode estar sobrecarregado."
    fi

    # ── Info positivo: sessão normal ──
    if [ "$SESSION_ACTIVE" = "true" ] && [ ${#ALERTS[@]} -eq 0 ]; then
        alert_info "Sessão ativa e saudável: ID=${SESSION_ID}, turns=${TURN_COUNT}"
    fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 2. Verifica flags de compliance
# ─────────────────────────────────────────────────────────────────────────────
AUTH_FLAG="$STATE_DIR/UNAUTHORIZED_CLOSE.flag"
NO_KEY_FLAG="$STATE_DIR/SESSION_CLOSE_NO_KEY.flag"

if [ -f "$AUTH_FLAG" ]; then
    FLAG_AGE_SECS=0
    if command -v stat > /dev/null 2>&1; then
        FLAG_MTIME="$(stat -c '%Y' "$AUTH_FLAG" 2> /dev/null || stat -f '%m' "$AUTH_FLAG" 2> /dev/null || echo 0)"
        FLAG_AGE_SECS=$((NOW_EPOCH - FLAG_MTIME))
    fi
    FLAG_AGE_H=$((FLAG_AGE_SECS / 3600))

    if [ "$SESSION_ACTIVE" = "false" ] && [ "$FLAG_AGE_H" -ge 24 ] 2> /dev/null; then
        alert_warn "ORPHAN_AUTH_FLAG" \
            "UNAUTHORIZED_CLOSE.flag órfão (${FLAG_AGE_H}h, sem sessão ativa). Será limpo com --auto-fix."
        if [ "$AUTO_FIX" = "true" ]; then
            rm -f "$AUTH_FLAG"
            record_fix "Removido UNAUTHORIZED_CLOSE.flag órfão (${FLAG_AGE_H}h sem sessão)"
        fi
    else
        alert_warn "AUTH_FLAG_EXISTS" \
            "UNAUTHORIZED_CLOSE.flag presente — houve encerramento não-autorizado anterior."
    fi
fi

if [ -f "$NO_KEY_FLAG" ]; then
    alert_warn "NO_KEY_FLAG_EXISTS" \
        "SESSION_CLOSE_NO_KEY.flag presente — sessão anterior encerrada sem digitar a chave ENCERRAR-XXXXXXXX."
fi

# ─────────────────────────────────────────────────────────────────────────────
# 3. Verifica integridade de audit.jsonl
# ─────────────────────────────────────────────────────────────────────────────
if [ -f "$AUDIT_FILE" ]; then
    AUDIT_LINES="$(wc -l < "$AUDIT_FILE" | tr -d ' ' 2> /dev/null || echo 0)"
    AUDIT_SIZE="$(wc -c < "$AUDIT_FILE" | tr -d ' ' 2> /dev/null || echo 0)"
    if [ "$AUDIT_SIZE" -gt 10485760 ] 2> /dev/null; then # > 10 MB
        alert_warn "AUDIT_LARGE" \
            "audit.jsonl é grande (${AUDIT_SIZE} bytes / ${AUDIT_LINES} linhas). Considere rotação."
    else
        alert_info "audit.jsonl: ${AUDIT_LINES} linhas, ${AUDIT_SIZE} bytes"
    fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 4. Gera relatório JSON
# ─────────────────────────────────────────────────────────────────────────────
# Serializa arrays para JSON
ALERTS_JSON="[]"
if [ ${#ALERTS[@]} -gt 0 ]; then
    ALERTS_JSON="[$(
        IFS=','
        echo "${ALERTS[*]}"
    )]"
fi
FIXES_JSON="[]"
if [ ${#FIXES[@]} -gt 0 ]; then
    FIXES_JSON="[$(
        IFS=','
        echo "${FIXES[*]}"
    )]"
fi
INFOS_JSON="$(printf '%s\n' "${INFOS[@]:-}" | jq -Rs 'split("\n") | map(select(. != ""))')"

STATUS="healthy"
if [ "$CRITICAL_COUNT" -gt 0 ]; then
    STATUS="critical"
elif [ "$WARN_COUNT" -gt 0 ]; then
    STATUS="warning"
fi

REPORT="$(jq -cn \
    --arg generated_at "$NOW_ISO" \
    --arg status "$STATUS" \
    --argjson critical "$CRITICAL_COUNT" \
    --argjson warnings "$WARN_COUNT" \
    --arg session_id "${SESSION_ID:-}" \
    --argjson session_active "$SESSION_ACTIVE" \
    --argjson turn_count "$TURN_COUNT" \
    --argjson consec_unauth "$CONSEC_UNAUTH" \
    --argjson compaction_count "$COMPACTION_COUNT" \
    --argjson alerts "$ALERTS_JSON" \
    --argjson fixes "$FIXES_JSON" \
    --argjson infos "$INFOS_JSON" \
    '{
        generated_at:     $generated_at,
        status:           $status,
        summary: {
            critical:     $critical,
            warnings:     $warnings
        },
        session: {
            id:           $session_id,
            active:       $session_active,
            turn_count:   $turn_count,
            consec_unauth: $consec_unauth,
            compaction_count: $compaction_count
        },
        alerts: $alerts,
        fixes:  $fixes,
        infos:  $infos
    }')"

# Salva relatório
printf '%s\n' "$REPORT" > "$REPORT_FILE"

# Loga em audit.jsonl
jq -cn \
    --arg event "watchdogRun" \
    --arg status "$STATUS" \
    --argjson critical "$CRITICAL_COUNT" \
    --argjson warnings "$WARN_COUNT" \
    --arg ts "$NOW_ISO" \
    '{event: $event, status: $status, critical: $critical, warnings: $warnings, timestamp: $ts}' \
    >> "$AUDIT_FILE" 2> /dev/null || true

# ─────────────────────────────────────────────────────────────────────────────
# 5. Output
# ─────────────────────────────────────────────────────────────────────────────
if [ "$JSON_ONLY" = "true" ]; then
    printf '%s\n' "$REPORT"
elif [ "$QUIET" = "false" ]; then
    echo ""
    echo "══════════════════════════════════════════════════"
    echo "  Watchdog — Copilot Hooks: $STATUS"
    echo "══════════════════════════════════════════════════"
    if [ ${#ALERTS[@]} -gt 0 ]; then
        for a in "${ALERTS[@]}"; do
            level="$(echo "$a" | jq -r '.level')"
            code="$(echo "$a" | jq -r '.code')"
            msg="$(echo "$a" | jq -r '.message')"
            if [ "$level" = "critical" ]; then
                echo "  ✗ [CRÍTICO] $code: $msg"
            else
                echo "  ⚠ [AVISO]   $code: $msg"
            fi
        done
    fi
    for info in "${INFOS[@]:-}"; do
        [ -n "$info" ] && echo "  ✓ $info"
    done
    if [ ${#FIXES[@]} -gt 0 ]; then
        echo ""
        echo "  Correções automáticas aplicadas:"
        for f in "${FIXES[@]}"; do
            echo "    • $(echo "$f" | jq -r '.action')"
        done
    fi
    echo "  Relatório salvo: state/watchdog-report.json"
    echo "══════════════════════════════════════════════════"
    echo ""
fi

# Exit code
if [ "$STRICT" = "true" ] && [ "$CRITICAL_COUNT" -gt 0 ]; then
    exit 1
fi
exit 0
