#!/bin/bash
# session-close.sh — Encerramento autorizado de SESSION pelo agente (chamada manual)
# ────────────────────────────────────────────────────────────────────────────────
# Uso: bash .github/hooks/scripts/session-close.sh "ENCERRAR-XXXXXXXX"
#
# Propósito:
#   O evento `sessionEnd` da plataforma VS Code Copilot não dispara de forma
#   confiável (sessões terminam abruptamente). Este script é o mecanismo MANUAL
#   que o agente DEVE invocar após receber a close_key do usuário via Template F
#   (vscode_askQuestions). Substitui a dependência no evento automático.
#
# Protocolo de encerramento de SESSION:
#   1. Agente invoca vscode_askQuestions com Template F (exibe close_key)
#   2. Usuário digita a KEY no campo de resposta
#   3. Agente extrai a KEY da resposta do usuário
#   4. Agente chama: bash .github/hooks/scripts/session-close.sh "ENCERRAR-XXXX"
#   5. Script valida a KEY, loga sessionCloseAuthorized, chama session-end.sh
#   6. Apenas após sucesso: agente encerra o turno
#
# Exit codes:
#   0 — KEY válida, sessionEnd registrado com sucesso
#   1 — KEY ausente ou inválida (encerramento BLOQUEADO — deve ser reportado ao usuário)
# ────────────────────────────────────────────────────────────────────────────────
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${HOOKS_STATE_DIR:-$HOOK_DIR/state}"
LOG_DIR="${HOOKS_LOG_DIR:-$HOOK_DIR/logs}"
SCRIPTS_DIR="$HOOK_DIR/scripts"

CTX_FILE="$STATE_DIR/session-context.json"
AUDIT_FILE="$LOG_DIR/audit.jsonl"
# UPG-AUDIT-01: resolve per-session paths from current-session-id.txt
_CSI_FILE="$STATE_DIR/current-session-id.txt"
if [ -f "$_CSI_FILE" ] && _CURR_SID="$(cat "$_CSI_FILE" 2> /dev/null)" && [ -n "$_CURR_SID" ]; then
    _SID_SHORT="${_CURR_SID:0:8}"
    CTX_FILE="$STATE_DIR/session-context-${_SID_SHORT}.json"
    AUDIT_FILE="$LOG_DIR/audit-${_SID_SHORT}.jsonl"
fi

mkdir -p "$LOG_DIR" "$STATE_DIR"

# ── Lock para evitar race conditions ─────────────────────────────────────────
_CTX_LOCK="${CTX_FILE}.lock"
exec 9> "$_CTX_LOCK"
if command -v flock > /dev/null 2>&1; then
    flock -x -w "${HOOKS_FLOCK_TIMEOUT:-5}" 9 2> /dev/null || true
fi

# ── KEY fornecida pelo agente ─────────────────────────────────────────────────
PROVIDED_KEY="${1:-}"
NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# ── Lê contexto da sessão ─────────────────────────────────────────────────────
SESSION_ID="unknown"
STORED_KEY=""
if [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session.id // "unknown"' "$CTX_FILE" 2> /dev/null || echo 'unknown')"
    STORED_KEY="$(jq -r '.session.close_key // ""' "$CTX_FILE" 2> /dev/null || echo '')"
fi

# ── Validação: KEY ausente ────────────────────────────────────────────────────
if [ -z "$PROVIDED_KEY" ]; then
    echo "❌ ERRO: close_key não fornecida." >&2
    echo "   Uso: bash session-close.sh \"ENCERRAR-XXXXXXXX\"" >&2
    echo "   A close_key da sessão atual é exibida no session-briefing.md" >&2
    jq -cn \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_ISO" \
        '{
            event:      "sessionClose_REJECTED",
            session_id: $sid,
            timestamp:  $ts,
            reason:     "no_key_provided"
        }' >> "$AUDIT_FILE"
    exit 1
fi

# ── Validação: KEY incorreta ──────────────────────────────────────────────────
if [ -z "$STORED_KEY" ]; then
    echo "❌ ERRO: close_key não encontrada no session-context.json." >&2
    echo "   A sessão pode não ter sido inicializada corretamente." >&2
    jq -cn \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_ISO" \
        --arg provided "$PROVIDED_KEY" \
        '{
            event:        "sessionClose_REJECTED",
            session_id:   $sid,
            timestamp:    $ts,
            reason:       "no_stored_key",
            provided_key: $provided
        }' >> "$AUDIT_FILE"
    exit 1
fi

if [ "$PROVIDED_KEY" != "$STORED_KEY" ]; then
    echo "❌ ERRO: close_key INVÁLIDA. Encerramento NEGADO." >&2
    echo "   Fornecida: $PROVIDED_KEY" >&2
    echo "   Esperada:  $STORED_KEY (ver session-briefing.md)" >&2
    jq -cn \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_ISO" \
        --arg provided "$PROVIDED_KEY" \
        --arg expected "$STORED_KEY" \
        '{
            event:         "sessionClose_REJECTED",
            session_id:    $sid,
            timestamp:     $ts,
            reason:        "wrong_key",
            provided_key:  $provided,
            expected_hint: "see_session_briefing"
        }' >> "$AUDIT_FILE"
    exit 1
fi

# ── KEY CORRETA: autoriza encerramento ────────────────────────────────────────
echo "✅ close_key validada. Encerrando SESSION com autorização: $STORED_KEY"

# Seta close_key_validated=true no contexto
if [ -f "$CTX_FILE" ]; then
    if command -v sponge > /dev/null 2>&1; then
        jq --arg ts "$NOW_ISO" \
            '.session.close_key_validated = true
             | .session.ended_at = $ts
             | .session.end_reason = "authorized_close"' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    else
        _TMP="$(mktemp)"
        jq --arg ts "$NOW_ISO" \
            '.session.close_key_validated = true
             | .session.ended_at = $ts
             | .session.end_reason = "authorized_close"' \
            "$CTX_FILE" > "$_TMP" && mv "$_TMP" "$CTX_FILE"
    fi
fi

# Loga sessionCloseAuthorized em audit.jsonl
jq -cn \
    --arg sid "$SESSION_ID" \
    --arg ts "$NOW_ISO" \
    --arg key "$STORED_KEY" \
    '{
        event:      "sessionCloseAuthorized",
        session_id: $sid,
        timestamp:  $ts,
        close_key:  $key,
        method:     "manual_agent_call"
    }' >> "$AUDIT_FILE"

# Cria flag de encerramento autorizado (lido por session-start.sh na próxima sessão)
SESSION_AUTHORIZED_FLAG="$STATE_DIR/SESSION_CLOSE_AUTHORIZED.flag"
jq -cn \
    --arg sid "$SESSION_ID" \
    --arg ts "$NOW_ISO" \
    --arg key "$STORED_KEY" \
    '{
        session_id:  $sid,
        closed_at:   $ts,
        close_key:   $key,
        method:      "manual_agent_call"
    }' > "$SESSION_AUTHORIZED_FLAG"

# Remove flag de encerramento SEM key (se existir)
rm -f "$STATE_DIR/SESSION_CLOSE_NO_KEY.flag" 2> /dev/null || true

# v8.1: NÃO chama session-end.sh aqui. O hook nativo sessionEnd do VS Code é o
# único mecanismo responsável por disparar session-end.sh. Chamar session-end.sh
# aqui gerava eventos sessionEnd ANTES do VS Code encerrar a sessão, criando logs
# falsos que pareciam indicar encerramento prematuro da SESSION.
# O session-close.sh apenas: valida KEY, seta close_key_validated=true, loga
# sessionCloseAuthorized, e prepara flag SESSION_CLOSE_AUTHORIZED.flag.
# Quando o VS Code encerrar a sessão de fato, o hook sessionEnd chamará
# session-end.sh e gerará o relatório final com close_key_validated=true.

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  SESSION autorizada para encerramento."
echo "  close_key: $STORED_KEY"
echo "  session_id: $SESSION_ID"
echo "  O relatório final será gerado quando o VS Code encerrar."
echo "══════════════════════════════════════════════════════════"
