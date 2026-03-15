#!/bin/bash
# session-end.sh — Hook sessionEnd do Copilot
# Executado quando a sessão do agente é encerrada (completa, erro, abort, timeout, user_exit).
# Input JSON (stdin): {timestamp, cwd, reason}
# Output: ignorado pelo Copilot.
# Este é o hook mais complexo: gera resumo, atualiza estado, espelha para DOCUMENTAÇÃO/.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
# Suporte a override de diretórios (usado por smoke-test sandbox e session-close.sh)
LOG_DIR="${HOOKS_LOG_DIR:-$HOOK_DIR/logs}"
STATE_DIR="${HOOKS_STATE_DIR:-$HOOK_DIR/state}"
DOCS_SESSIONS_DIR="${HOOKS_DOCS_DIR:-$REPO_ROOT/DOCUMENTAÇÃO/RELATORIOS/SESSIONS}"
SCRIPTS_DIR="$HOOK_DIR/scripts"
# shellcheck source=../../.github/hooks/hooks-lib/common.sh
if [ -f "$HOOK_DIR/hooks-lib/common.sh" ]; then
    source "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null \
        || {
            echo "[session-end] WARN: common.sh não carregado" >&2
            true
        }
fi
# shellcheck source=../../.github/hooks/hooks-lib/session-end-core.sh
if [ -f "$HOOK_DIR/hooks-lib/session-end-core.sh" ]; then
    source "$HOOK_DIR/hooks-lib/session-end-core.sh" 2> /dev/null \
        || {
            echo "[session-end] WARN: session-end-core.sh não carregado" >&2
            true
        }
fi
# shellcheck source=../../.github/hooks/hooks-lib/session-end-aux.sh
if [ -f "$HOOK_DIR/hooks-lib/session-end-aux.sh" ]; then
    source "$HOOK_DIR/hooks-lib/session-end-aux.sh" 2> /dev/null \
        || {
            echo "[session-end] WARN: session-end-aux.sh não carregado" >&2
            true
        }
fi

mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"
mkdir -p "$STATE_DIR"
mkdir -p "$DOCS_SESSIONS_DIR"

CTX_FILE="$STATE_DIR/session-context.json"

# CRÍTICO-1 FIX: lê stdin e resolve per-session ANTES de abrir o flock (fd 9)
INPUT="$(cat 2> /dev/null || true)"

TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // 0' 2> /dev/null || echo 0)"
CWD="$(echo "$INPUT" | jq -r '.cwd // ""' 2> /dev/null || echo '')"
REASON="$(echo "$INPUT" | jq -r '.reason // "complete"' 2> /dev/null || echo 'complete')"
# GAP-S03 FIX: extrai session_id do payload (VS Code inclui em sessionEnd, como nos demais hooks).
SESSION_ID_PAYLOAD="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"
# UPG-AUDIT-01: resolve per-session paths ANTES do flock (override CTX_FILE, AUDIT_FILE, _CTX_LOCK)
if command -v resolve_audit_file > /dev/null 2>&1 && [ -n "${SESSION_ID_PAYLOAD:-}" ]; then
    _SID_SHORT="${SESSION_ID_PAYLOAD:0:8}"
    CTX_FILE="$(resolve_ctx_file "$_SID_SHORT")"
    AUDIT_FILE="$(resolve_audit_file "$_SID_SHORT")"
    mkdir -p "$(dirname "$CTX_FILE")" "$(dirname "$AUDIT_FILE")" 2> /dev/null || true
fi

# REV4-07: Lock exclusivo APÓS resolver CTX_FILE per-session
# Mesmo esquema de agent-stop.sh, pre-tool-use.sh, post-tool-use.sh e log-prompt.sh.
_CTX_LOCK="${CTX_FILE}.lock"
exec 9> "$_CTX_LOCK"
if command -v flock > /dev/null 2>&1; then
    flock -x -w "${HOOKS_FLOCK_TIMEOUT:-5}" 9 2> /dev/null || true
fi
NOW_MS="$(date +%s000 2> /dev/null || echo "$TIMESTAMP")"
SESSION_DATE_SHORT="$(date -u '+%Y%m%d_%H%M%S' 2> /dev/null || echo 'unknown')"
SESSION_DATE_DAILY="$(date -u '+%Y-%m-%d' 2> /dev/null || echo 'unknown')"

# ── B5: Salva checkpoint final antes de encerrar ─────────────────────────────
CHECKPOINT_SCRIPT="$SCRIPTS_DIR/session-checkpoint.sh"
if [ -f "$CHECKPOINT_SCRIPT" ] && [ -x "$CHECKPOINT_SCRIPT" ]; then
    bash "$CHECKPOINT_SCRIPT" 2> /dev/null || true
fi

# ── Obtém dados da sessão do contexto persistido (schema v4) ─────────────────
SESSION_ID="unknown"
START_ISO=""
if [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session.id // "unknown"' "$CTX_FILE" 2> /dev/null || echo 'unknown')"
    START_ISO="$(jq -r '.session.started_at // ""' "$CTX_FILE" 2> /dev/null || echo '')"
fi

# GAP-S03 FIX — HEAL v1: sincroniza session_id se payload difere do CTX.
# Contexto: session-end.sh era o único hook VS Code invocado sem HEAL.
# Padrão: igual ao pre-tool-use.sh e demais scripts com HEAL v1.
# Só aplica HEAL em fontes confiáveis (manual_recovery); inline_restart adota CTX.
if [ -n "$SESSION_ID_PAYLOAD" ] && [ "$SESSION_ID_PAYLOAD" != "$SESSION_ID" ] && [ "$SESSION_ID" != "unknown" ]; then
    _CTX_SOURCE_SE="$(jq -r '.session.source // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    if [ "$_CTX_SOURCE_SE" = "manual_recovery" ]; then
        _NOW_HEAL_SE="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
        if command -v sponge > /dev/null 2>&1; then
            jq --arg real_sid "$SESSION_ID_PAYLOAD" --arg ts "$_NOW_HEAL_SE" \
                '.session.id = $real_sid | .session.vs_code_session_id = $real_sid | .session.source = "healed_from_real_session" | .session.healed_at = $ts' \
                "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
        else
            _TMP_HEAL_SE="$(mktemp)"
            if jq --arg real_sid "$SESSION_ID_PAYLOAD" --arg ts "$_NOW_HEAL_SE" \
                '.session.id = $real_sid | .session.vs_code_session_id = $real_sid | .session.source = "healed_from_real_session" | .session.healed_at = $ts' \
                "$CTX_FILE" > "$_TMP_HEAL_SE" 2> /dev/null; then
                mv "$_TMP_HEAL_SE" "$CTX_FILE" 2> /dev/null || rm -f "$_TMP_HEAL_SE"
            else
                rm -f "$_TMP_HEAL_SE"
            fi
        fi
        SESSION_ID="$SESSION_ID_PAYLOAD"
        jq -cn \
            --arg event "session_id_healed" \
            --arg old "" \
            --arg new "$SESSION_ID" \
            --arg source "session-end.sh" \
            --arg ts "$_NOW_HEAL_SE" \
            '{event: $event, new_session_id: $new, source: $source, timestamp: $ts,
              message: "HEAL v1 em sessionEnd: manual_recovery adotou session_id do payload"}' \
            >> "$AUDIT_FILE"
        echo "[heal] HEAL v1 aplicado em session-end.sh — session_id atualizado" >&2
    elif [ "$_CTX_SOURCE_SE" = "inline_restart" ]; then
        # inline_restart: CTX tem o session_id correto do VS Code (PREMISSA 1).
        # Payload pode estar stale. Adota CTX como verdade (sem modificar CTX).
        SESSION_ID_PAYLOAD="$SESSION_ID"
    fi
fi

# Hardening adicional: persiste strict_turn_close_requires_key em contextos legados.
if command -v ensure_strict_turn_close_flag_default > /dev/null 2>&1; then
    ensure_strict_turn_close_flag_default "$CTX_FILE" > /dev/null 2>&1 || true
fi

# ── Fecha section ativa antes de encerrar sessão (Schema v4 — Fase C) ────────
# INVARIANTE: sempre deve haver SESSION+SECTION+TURN ativos.
session_end_close_active_section "$SESSION_ID" "$CTX_FILE" "$AUDIT_FILE" || true

# Calcula duração total da sessão (ISO → epoch → diff)
# BUG-60 FIX: date -d é GNU-only; fallback para BSD (macOS)
DURATION_S=0
START_EPOCH=0 # inicializado aqui para evitar unbound variable se START_ISO vazio
if [ -n "$START_ISO" ]; then
    if date -d "$START_ISO" '+%s' > /dev/null 2>&1; then
        START_EPOCH="$(date -d "$START_ISO" '+%s' 2> /dev/null || echo 0)"
    else
        START_EPOCH="$(date -j -f '%Y-%m-%dT%H:%M:%SZ' "$START_ISO" '+%s' 2> /dev/null || echo 0)"
    fi
    NOW_EPOCH="$(date -u '+%s' 2> /dev/null || echo 0)"
    if [ "$NOW_EPOCH" -gt "$START_EPOCH" ] 2> /dev/null; then
        DURATION_S=$((NOW_EPOCH - START_EPOCH))
    fi
fi

# Conta ferramentas e erros via audit.jsonl (defensivo)
TOOLS_COUNT=0
ERRORS_COUNT=0
if [ -f "$AUDIT_FILE" ]; then
    TOOLS_COUNT="$(jq -r --arg sid "$SESSION_ID" \
        'select(.session_id == $sid and .event == "preToolUse")' \
        "$AUDIT_FILE" 2> /dev/null | jq -s 'length' 2> /dev/null || echo 0)"
    ERRORS_COUNT="$(jq -r --arg sid "$SESSION_ID" \
        'select(.session_id == $sid and .event == "toolUseFailure")' \
        "$AUDIT_FILE" 2> /dev/null | jq -s 'length' 2> /dev/null || echo 0)"
fi

# Finalização crítica de sessão (estado, close_mode, eventos core e validação de close_key)
session_end_finalize_core_termination \
    "$SESSION_ID" \
    "$REASON" \
    "$CTX_FILE" \
    "$AUDIT_FILE" \
    "$NOW_MS" \
    "$CWD" \
    "$DURATION_S" \
    "$TOOLS_COUNT" \
    "$ERRORS_COUNT" \
    "$STATE_DIR" \
    || true

# ── Rotação do audit.jsonl (mantém últimas 5000 linhas) ──────────────────────
AUDIT_MAX_LINES=5000
if [ -f "$AUDIT_FILE" ]; then
    AUDIT_LINES="$(wc -l < "$AUDIT_FILE" | tr -d ' ')"
    if [ "$AUDIT_LINES" -gt "$AUDIT_MAX_LINES" ]; then
        AUDIT_ARCHIVE="$LOG_DIR/audit-archive-$(date -u '+%Y%m%d%H%M%S').jsonl"
        head -n $((AUDIT_LINES - AUDIT_MAX_LINES)) "$AUDIT_FILE" > "$AUDIT_ARCHIVE" 2> /dev/null || true
        # BUG-27 fix: cria backup antes do sponge para permitir restauração em caso de falha
        _AUDIT_BAK="${AUDIT_FILE}.bak"
        cp "$AUDIT_FILE" "$_AUDIT_BAK" 2> /dev/null || true
        if ! tail -n "$AUDIT_MAX_LINES" "$AUDIT_FILE" | sponge "$AUDIT_FILE" 2> /dev/null; then
            # Restaura backup se sponge falhou (evita perda total do audit.jsonl)
            mv "$_AUDIT_BAK" "$AUDIT_FILE" 2> /dev/null || true
        else
            rm -f "$_AUDIT_BAK" 2> /dev/null || true
        fi
    fi
fi

# ── Pós-processamento auxiliar (summary + espelho em DOCUMENTAÇÃO) ──────────
# generate-session-summary.sh espera START_TS em milissegundos.
START_TS_MS="$((START_EPOCH * 1000))"
run_aux_block "session-end:summary-mirror" "${HOOKS_AUX_TIMEOUT_S:-5}" \
    session_end_generate_and_mirror_summary \
    "$SESSION_ID" \
    "$SESSION_DATE_SHORT" \
    "$START_TS_MS" \
    "$NOW_MS" \
    "$REASON" \
    "$SCRIPTS_DIR" \
    "$LOG_DIR" \
    "$DOCS_SESSIONS_DIR" \
    "$SESSION_DATE_DAILY" \
    || true

# ── Verifica conformidade de autorização no encerramento da sessão ────────────
AUTH_FLAG_FILE="$STATE_DIR/UNAUTHORIZED_CLOSE.flag"
SESSION_AUTH_COMPLIANT=true

if [ -f "$AUTH_FLAG_FILE" ]; then
    SESSION_AUTH_COMPLIANT=false
fi

if [ "$SESSION_AUTH_COMPLIANT" = "true" ] && [ -f "$AUDIT_FILE" ]; then
    SESSION_AUTHORIZED_COUNT="$(jq -r --arg sid "$SESSION_ID" \
        'select(.event == "turnEnd_authorized" and .session_id == $sid)' \
        "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ')"
    SESSION_VIOLATION_COUNT="$(jq -r --arg sid "$SESSION_ID" \
        'select(.event == "turnEnd_no_askQuestions" and .session_id == $sid)' \
        "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ')"
    jq -cn \
        --arg event "sessionEnd_compliance" \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_MS" \
        --arg reason "$REASON" \
        --argjson authorized "$SESSION_AUTHORIZED_COUNT" \
        --argjson violations "$SESSION_VIOLATION_COUNT" \
        --argjson compliant "$SESSION_AUTH_COMPLIANT" \
        '{event: $event, session_id: $sid, timestamp: $ts, reason: $reason,
          authorized_turns: $authorized, violation_turns: $violations,
          fully_compliant: $compliant}' \
        >> "$AUDIT_FILE"
fi

# ── Pós-processamento auxiliar: nota em pending-tasks.md ─────────────────────
run_aux_block "session-end:pending-note" "${HOOKS_AUX_TIMEOUT_S:-5}" \
    session_end_append_pending_task_note \
    "$STATE_DIR" \
    "$SESSION_ID" \
    "$SESSION_DATE_DAILY" \
    "$REASON" \
    "$TOOLS_COUNT" \
    || true

# ── Banner final ──────────────────────────────────────────────────────────────
cat << EOF

╔══════════════════════════════════════════════════════════════════╗
║             SESSÃO ENCERRADA — ${REASON}
║  Session ID : ${SESSION_ID}
║  Duração    : $((DURATION_S / 60))m $((DURATION_S % 60))s
║  Ferramentas: ${TOOLS_COUNT} | Erros: ${ERRORS_COUNT}
║  Relatório  : DOCUMENTAÇÃO/RELATORIOS/SESSIONS/sessions-${SESSION_DATE_DAILY}.md
╚══════════════════════════════════════════════════════════════════╝
EOF

exit 0
