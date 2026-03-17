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
# UPG-AUDIT-01: resolve per-session paths from current-session-id.txt
_CSI_FILE="$STATE_DIR/current-session-id.txt"
if [ -f "$_CSI_FILE" ] && _CURR_SID="$(cat "$_CSI_FILE" 2> /dev/null)" && [ -n "$_CURR_SID" ]; then
    _SID_SHORT="${_CURR_SID:0:8}"
    CTX_FILE="$STATE_DIR/session-context-${_SID_SHORT}.json"
    AUDIT_FILE="$LOG_DIR/audit-${_SID_SHORT}.jsonl"
fi

# Limiares configuráveis (horas)
STALE_HOURS="${WATCHDOG_STALE_HOURS:-36}"
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
    SECTION_NAME_WD="$(jq -r '.current_section.name // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    SECTION_ID_WD="$(jq -r '.current_section.section_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    # Lê campos de close para distinguir close legítimo de stale
    _CTX_END_REASON="$(jq -r '.session.end_reason // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    _CTX_KEY_VALIDATED="$(jq -r '.session.close_key_validated // false' "$CTX_FILE" 2> /dev/null || echo 'false')"

    # FIX v9.0: auto_recovery com ended_at não-nulo pode indicar:
    #   (a) stale ended_at de fake sessionEnd pré-v8.1 → source=auto_recovery AND end_reason vazio
    #   (b) close legítimo no mesmo VS Code session → close_key_validated=true AND end_reason=authorized_close
    # FIX v9.1: distingue os dois casos para mensagem específica.
    _STALE_ENDED_AT_WARN=false
    _LEGITIMATE_CLOSE_WARN=false
    if [ -z "$ENDED_AT" ] || [ "$ENDED_AT" = "null" ]; then
        SESSION_ACTIVE=true
    elif [ "$_CTX_KEY_VALIDATED" = "true" ] && [ "$_CTX_END_REASON" = "authorized_close" ]; then
        # Close LEGÍTIMO: close_key_validated=true e end_reason=authorized_close.
        # Sessão foi encerrada corretamente pelo agente. Hooks ainda ativos (mesmo
        # VS Code session). Novo prompt irá gerar sessionStart_inline via log-prompt.sh.
        SESSION_ACTIVE=true
        _LEGITIMATE_CLOSE_WARN=true
    elif [ "$SESSION_SOURCE" = "auto_recovery" ] || [ "$SESSION_SOURCE" = "inline_restart" ]; then
        # auto_recovery ou inline_restart + ended_at não-nulo = stale ended_at residual
        # (gerado por session-close.sh pré-v8.1 ou por race condition no inline_restart)
        SESSION_ACTIVE=true
        _STALE_ENDED_AT_WARN=true
    fi

    # Emite aviso diferenciado conforme a causa do ended_at
    if [ "$_LEGITIMATE_CLOSE_WARN" = "true" ]; then
        alert_warn "SESSION_CLOSED_AWAITING_RESTART" \
            "Sessão encerrada legitimamente (end_reason=authorized_close). Nova sessão será iniciada automaticamente ao próximo prompt do usuário via sessionStart_inline. Sessão anterior encerrada em: ${ENDED_AT}"
    elif [ "$_STALE_ENDED_AT_WARN" = "true" ]; then
        alert_warn "STALE_ENDED_AT" \
            "session.ended_at contém valor residual de sessionEnd falso pré-v8.1 (source=auto_recovery). Sessão considerada ATIVA. Limpe ended_at no contexto para eliminar este aviso."
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
# 4. Detecta padrões de reconexão VS Code (session_id_mismatch / sessionReconnect)
# ─────────────────────────────────────────────────────────────────────────────
# Referência: DOCUMENTAÇÃO/HOOKS/ANALISE-SESSOES-ABRUPTAS.md §3.2
# Padrão anômalo: muitos reconnects indica instabilidade de conexão no cliente.
RECONNECT_WARN_THRESHOLD="${WATCHDOG_RECONNECT_WARN:-5}"
RECONNECT_CRITICAL_THRESHOLD="${WATCHDOG_RECONNECT_CRITICAL:-20}"

if [ -f "$AUDIT_FILE" ]; then
    # Conta eventos sessionReconnect na sessão atual (últimas 24h)
    RECONNECT_COUNT=0
    STALE_MISMATCH_COUNT=0

    if command -v jq > /dev/null 2>&1; then
        RECONNECT_COUNT="$(
            jq -r 'select(.event == "sessionReconnect") | .timestamp' "$AUDIT_FILE" 2> /dev/null \
                | tail -100 | wc -l | tr -d ' '
        )"
        # Mismatches recentes da sessão atual (últimas 6h, expected==SESSION_ID):
        # filtra ruído histórico pré-fix e mismatches de subagentes (subagent-stop.sh — esperado).
        _MISMATCH_CUTOFF="$(date -u -d '6 hours ago' '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null \
            || date -u -v -6H '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null \
            || echo '1970-01-01T00:00:00Z')"
        STALE_MISMATCH_COUNT="$(
            jq --arg sid "$SESSION_ID" --arg cutoff "$_MISMATCH_CUTOFF" -r \
                'select(.event == "session_id_mismatch"
                    and .expected == $sid
                    and (.source // "") != "subagent-stop.sh"
                    and .timestamp != null
                    and .timestamp > $cutoff) | .timestamp' "$AUDIT_FILE" 2> /dev/null \
                | tail -50 | wc -l | tr -d ' '
        )"
    fi

    RECONNECT_COUNT="${RECONNECT_COUNT:-0}"
    STALE_MISMATCH_COUNT="${STALE_MISMATCH_COUNT:-0}"

    if [ "$RECONNECT_COUNT" -ge "$RECONNECT_CRITICAL_THRESHOLD" ] 2> /dev/null; then
        alert_critical "HIGH_RECONNECT_RATE" \
            "${RECONNECT_COUNT} reconexões VS Code detectadas. Taxa crítica (≥${RECONNECT_CRITICAL_THRESHOLD}). Verifique estabilidade da rede e extensões."
    elif [ "$RECONNECT_COUNT" -ge "$RECONNECT_WARN_THRESHOLD" ] 2> /dev/null; then
        alert_warn "ELEVATED_RECONNECT_RATE" \
            "${RECONNECT_COUNT} reconexões VS Code detectadas. Taxa elevada (≥${RECONNECT_WARN_THRESHOLD}). Monitorar estabilidade da conexão."
    else
        alert_info "Reconexões VS Code: ${RECONNECT_COUNT} (ok, limiar aviso: ${RECONNECT_WARN_THRESHOLD})"
    fi

    if [ "$STALE_MISMATCH_COUNT" -gt 0 ] 2> /dev/null; then
        alert_warn "STALE_ID_MISMATCHES" \
            "${STALE_MISMATCH_COUNT} eventos session_id_mismatch antigos detectados (pre-fix). Monitorar se regridem."
    fi
fi
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
    --arg section_name "${SECTION_NAME_WD:-}" \
    --arg section_id "${SECTION_ID_WD:-}" \
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
            compaction_count: $compaction_count,
            section_name: (if $section_name == "" then null else $section_name end),
            section_id:   (if $section_id == "" then null else $section_id end)
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
