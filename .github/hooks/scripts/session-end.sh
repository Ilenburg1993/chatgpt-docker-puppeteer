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

mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"
mkdir -p "$STATE_DIR"
mkdir -p "$DOCS_SESSIONS_DIR"

CTX_FILE="$STATE_DIR/session-context.json"

# REV4-07: Lock exclusivo para prevenir race conditions em escritas de session-context.json.
# Mesmo esquema de agent-stop.sh, pre-tool-use.sh, post-tool-use.sh e log-prompt.sh.
_CTX_LOCK="${CTX_FILE}.lock"
exec 9> "$_CTX_LOCK"
if command -v flock > /dev/null 2>&1; then
    flock -x -w "${HOOKS_FLOCK_TIMEOUT:-5}" 9 2> /dev/null || true
fi

INPUT="$(cat 2> /dev/null || true)"

TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // 0' 2> /dev/null || echo 0)"
CWD="$(echo "$INPUT" | jq -r '.cwd // ""' 2> /dev/null || echo '')"
REASON="$(echo "$INPUT" | jq -r '.reason // "complete"' 2> /dev/null || echo 'complete')"
# GAP-S03 FIX: extrai session_id do payload (VS Code inclui em sessionEnd, como nos demais hooks).
SESSION_ID_PAYLOAD="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"
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
            >> "$LOG_DIR/audit.jsonl"
        echo "[heal] HEAL v1 aplicado em session-end.sh — session_id atualizado" >&2
    elif [ "$_CTX_SOURCE_SE" = "inline_restart" ]; then
        # inline_restart: CTX tem o session_id correto do VS Code (PREMISSA 1).
        # Payload pode estar stale. Adota CTX como verdade (sem modificar CTX).
        SESSION_ID_PAYLOAD="$SESSION_ID"
    fi
fi

# ── Fecha section ativa antes de encerrar sessão (Schema v4 — Fase C) ────────
# INVARIANTE: sempre deve haver SESSION+SECTION+TURN ativos.
# Antes de fechar a sessão, fechamos a section em andamento para emitir sectionEnd.
CLOSE_SECTION_NAME=""
CLOSE_SECTION_STARTED=""
CLOSE_SECTION_TURN_START=0
CLOSE_SECTION_NUMBER=0
CLOSE_TURN_COUNT=0

if [ -f "$CTX_FILE" ]; then
    CLOSE_SECTION_NAME="$(jq -r '.current_section.name // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    CLOSE_SECTION_STARTED="$(jq -r '.current_section.started_at // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    CLOSE_SECTION_TURN_START="$(jq -r '.current_section.turn_start // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    CLOSE_SECTION_NUMBER="$(jq -r '.current_section.section_number // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    CLOSE_TURN_COUNT="$(jq -r '.session_stats.turn_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    CLOSE_SECTION_ID="$(jq -r '.current_section.section_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
fi

if [ -n "$CLOSE_SECTION_NAME" ]; then
    CLOSE_NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    CLOSE_CURRENT_TURN=$((CLOSE_TURN_COUNT + 1))

    # Calcula duration_s da section via date -d (evita injeção de shell em subprocess Python)
    CLOSE_DURATION_S=0
    if [ -n "$CLOSE_SECTION_STARTED" ]; then
        _ep_start="$(date -d "$CLOSE_SECTION_STARTED" '+%s' 2> /dev/null || echo 0)"
        _ep_now="$(date -u '+%s' 2> /dev/null || echo 0)"
        if [ "$_ep_now" -gt "$_ep_start" ] 2> /dev/null; then
            CLOSE_DURATION_S=$((_ep_now - _ep_start))
        fi
    fi

    CLOSE_TURNS_COVERED=$((CLOSE_CURRENT_TURN - CLOSE_SECTION_TURN_START))
    if [ "$CLOSE_TURNS_COVERED" -lt 1 ]; then CLOSE_TURNS_COVERED=1; fi

    # Loga sectionEnd com reason=session_ended
    jq -cn \
        --arg event "sectionEnd" \
        --arg sid "$SESSION_ID" \
        --arg ts "$CLOSE_NOW_ISO" \
        --arg name "$CLOSE_SECTION_NAME" \
        --arg reason "session_ended" \
        --arg started_at "$CLOSE_SECTION_STARTED" \
        --arg section_id "${CLOSE_SECTION_ID:-}" \
        --argjson turn_start "$CLOSE_SECTION_TURN_START" \
        --argjson turn_end "$CLOSE_CURRENT_TURN" \
        --argjson turns_covered "$CLOSE_TURNS_COVERED" \
        --argjson duration_s "$CLOSE_DURATION_S" \
        --argjson section_number "$CLOSE_SECTION_NUMBER" \
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

    # Limpa current_section no contexto
    if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
        jq '.current_section = {name: null, started_at: null, turn_start: null, description: null, section_number: null, section_id: null}' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    fi
fi

# Calcula duração total da sessão (ISO → epoch → diff)
DURATION_S=0
START_EPOCH=0 # inicializado aqui para evitar unbound variable se START_ISO vazio
if [ -n "$START_ISO" ]; then
    START_EPOCH="$(date -d "$START_ISO" '+%s' 2> /dev/null || echo 0)"
    NOW_EPOCH="$(date -u '+%s' 2> /dev/null || echo 0)"
    if [ "$NOW_EPOCH" -gt "$START_EPOCH" ] 2> /dev/null; then
        DURATION_S=$((NOW_EPOCH - START_EPOCH))
    fi
fi

# Conta ferramentas e erros via audit.jsonl (defensivo)
TOOLS_COUNT=0
ERRORS_COUNT=0
AUDIT_FILE="$LOG_DIR/audit.jsonl"
if [ -f "$AUDIT_FILE" ]; then
    TOOLS_COUNT="$(jq -r --arg sid "$SESSION_ID" \
        'select(.session_id == $sid and .event == "preToolUse")' \
        "$AUDIT_FILE" 2> /dev/null | jq -s 'length' 2> /dev/null || echo 0)"
    ERRORS_COUNT="$(jq -r --arg sid "$SESSION_ID" \
        'select(.session_id == $sid and .event == "toolUseFailure")' \
        "$AUDIT_FILE" 2> /dev/null | jq -s 'length' 2> /dev/null || echo 0)"
fi

# Registra fim da sessão no session-context.json
if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
    jq --arg ts "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" --arg reason "$REASON" \
        '.session.ended_at = $ts | .session.end_reason = $reason' \
        "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
fi

# Append em audit.jsonl — evento de encerramento
jq -cn \
    --arg event "sessionEnd" \
    --arg sid "$SESSION_ID" \
    --arg ts "$NOW_MS" \
    --arg cwd "$CWD" \
    --arg reason "$REASON" \
    --argjson dur "$DURATION_S" \
    --argjson tools "$TOOLS_COUNT" \
    --argjson errors "$ERRORS_COUNT" \
    '{
        event:            $event,
        session_id:       $sid,
        timestamp:        $ts,
        cwd:              $cwd,
        reason:           $reason,
        duration_s:       $dur,
        tools_used_count: $tools,
        errors_count:     $errors
    }' >> "$AUDIT_FILE"

# ── Rotação do audit.jsonl (mantém últimas 5000 linhas) ──────────────────────
AUDIT_MAX_LINES=5000
if [ -f "$AUDIT_FILE" ]; then
    AUDIT_LINES="$(wc -l < "$AUDIT_FILE" | tr -d ' ')"
    if [ "$AUDIT_LINES" -gt "$AUDIT_MAX_LINES" ]; then
        AUDIT_ARCHIVE="$LOG_DIR/audit-archive-$(date -u '+%Y%m%d%H%M%S').jsonl"
        head -n $((AUDIT_LINES - AUDIT_MAX_LINES)) "$AUDIT_FILE" > "$AUDIT_ARCHIVE" 2> /dev/null || true
        tail -n "$AUDIT_MAX_LINES" "$AUDIT_FILE" | sponge "$AUDIT_FILE" 2> /dev/null || true
    fi
fi

# ── Gera o relatório Markdown via helper ─────────────────────────────────────
# generate-session-summary.sh espera START_TS em milissegundos (reutiliza START_EPOCH já computado)
START_TS_MS="$((START_EPOCH * 1000))"

SUMMARY_MD=""
SUMMARY_SCRIPT="$SCRIPTS_DIR/generate-session-summary.sh"
if [ -f "$SUMMARY_SCRIPT" ] && [ -x "$SUMMARY_SCRIPT" ]; then
    SUMMARY_MD="$(SESSION_ID="$SESSION_ID" \
        SESSION_DATE_SHORT="$SESSION_DATE_SHORT" \
        START_TS="$START_TS_MS" \
        END_TS="$NOW_MS" \
        SESSION_REASON="$REASON" \
        bash "$SUMMARY_SCRIPT" 2> /dev/null || echo '## Resumo indisponível (erro no helper)')"
fi

# Salva resumo local (gitignored)
if [ -n "$SUMMARY_MD" ]; then
    LOCAL_SUMMARY="$LOG_DIR/session-${SESSION_DATE_SHORT}.md"
    echo "# Relatório de Sessão" > "$LOCAL_SUMMARY"
    echo "" >> "$LOCAL_SUMMARY"
    echo "$SUMMARY_MD" >> "$LOCAL_SUMMARY"
fi

# Espelha resumo para DOCUMENTAÇÃO/RELATORIOS/SESSIONS/ (commitável)
DAILY_REPORT="$DOCS_SESSIONS_DIR/sessions-${SESSION_DATE_DAILY}.md"
if [ ! -f "$DAILY_REPORT" ]; then
    cat > "$DAILY_REPORT" << HEADER
# Sessões de ${SESSION_DATE_DAILY}

> Gerado automaticamente pelo hook \`sessionEnd\` do Copilot.
> Cada entrada abaixo representa uma sessão encerrada neste dia.

HEADER
fi

if [ -n "$SUMMARY_MD" ]; then
    echo "$SUMMARY_MD" >> "$DAILY_REPORT"
fi

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
        'select(.event == "turnEnd_UNAUTHORIZED" and .session_id == $sid)' \
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

# ── Valida SESSION CLOSE KEY ──────────────────────────────────────────────────
NO_KEY_FLAG_FILE="$STATE_DIR/SESSION_CLOSE_NO_KEY.flag"
TURN_COUNT_NOW="$(jq -r '.session_stats.turn_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
CLOSE_KEY_VALIDATED=false

if [ -f "$CTX_FILE" ]; then
    CLOSE_KEY_VALIDATED="$(jq -r '.session.close_key_validated // false' "$CTX_FILE" 2> /dev/null || echo false)"
fi

if [ "$CLOSE_KEY_VALIDATED" = "true" ]; then
    # Encerramento legítimo com chave validada
    rm -f "$NO_KEY_FLAG_FILE" 2> /dev/null || true
    jq -cn \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_MS" \
        --arg reason "$REASON" \
        '{event: "sessionEnd_authorized_with_key", session_id: $sid, timestamp: $ts, reason: $reason}' \
        >> "$AUDIT_FILE"
else
    # Encerramento SEM chave — acidental ou não autorizado
    jq -cn \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_MS" \
        --arg reason "$REASON" \
        --argjson turns "$TURN_COUNT_NOW" \
        '{
            event:       "sessionEnd_no_key",
            session_id:  $sid,
            timestamp:   $ts,
            reason:      $reason,
            turn_count:  $turns
        }' > "$NO_KEY_FLAG_FILE"
    # Também loga no audit.jsonl
    jq -cn \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_MS" \
        --arg reason "$REASON" \
        --argjson turns "$TURN_COUNT_NOW" \
        '{event: "sessionEnd_no_key", session_id: $sid, timestamp: $ts, reason: $reason, turn_count: $turns}' \
        >> "$AUDIT_FILE"
fi

# ── Atualiza pending-tasks.md com nota de sessão encerrada ───────────────────
TASKS_FILE="$STATE_DIR/pending-tasks.md"
if [ -f "$TASKS_FILE" ]; then
    SESSION_NOTE="<!-- session-end: ${SESSION_ID} | ${SESSION_DATE_DAILY} | ${REASON} | ${TOOLS_COUNT} tools -->"
    if ! grep -qF "$SESSION_ID" "$TASKS_FILE" 2> /dev/null; then
        echo "" >> "$TASKS_FILE"
        echo "$SESSION_NOTE" >> "$TASKS_FILE"
    fi
fi

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
