#!/bin/bash
# on-git-push.sh — Processador de evento git push bem-sucedido.
#
# Disparado pelo git hook .git/hooks/post-push (instalado via install-git-hooks.sh).
#
# Responsabilidades:
#   1. Loga evento `gitPush` em audit.jsonl com metadados do push
#   2. Incrementa session_stats.push_count
#   3. Registra session_stats.last_push_at e last_push_turn
#   4. Define session_stats.pending_section_after_push = true
#      → agent-stop.sh exige que o agente declare nova section ou continue
#
# Uso direto (teste):
#   bash .github/hooks/scripts/on-git-push.sh [--branch BRANCH] [--remote REMOTE]
#
# Uso via git hook (automático):
#   Chamado por .git/hooks/post-push com $1=remote $2+=refs
#
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$(cd "$SCRIPTS_DIR/.." && pwd)"
STATE_DIR="$HOOKS_DIR/state"
LOG_DIR="$HOOKS_DIR/logs"
CTX_FILE="$STATE_DIR/session-context.json"

# ── Parâmetros ────────────────────────────────────────────────────────────────
# Quando chamado pelo git hook: $1=remote, restante=<local-ref> <local-sha1> <remote-ref> <remote-sha1>
# Quando chamado diretamente: aceita --branch e --remote flags
REMOTE="${1:-origin}"
BRANCH=""
# shellcheck disable=SC2034
LOCAL_SHA=""

if [ "${1:-}" = "--branch" ]; then
    BRANCH="${2:-}"
    REMOTE="${4:-origin}"
elif [ $# -ge 4 ]; then
    # git hook format: post-push recebe linhas via stdin, não argumentos diretos
    # Cada linha: <local-ref> <local-sha1> <remote-ref> <remote-sha1>
    read -r _LOCAL_REF LOCAL_SHA REMOTE_REF _REMOTE_SHA < /dev/stdin 2> /dev/null || true
    BRANCH="${REMOTE_REF##*/}"
fi

# ── Lê state do session-context.json ─────────────────────────────────────────
SESSION_ID=""
TURN_COUNT=0
PUSH_COUNT=0
SECTION_NAME=""
SECTION_TURN=1

if [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    TURN_COUNT="$(jq -r '.session_stats.turn_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    PUSH_COUNT="$(jq -r '(.session_stats.push_count // 0)' "$CTX_FILE" 2> /dev/null || echo 0)"
    SECTION_NAME="$(jq -r '.current_section.name // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    SECTION_TURN="$(jq -r '.current_turn.section_turn // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
fi

# Sem SESSION ativa — registra aviso mas não aborta (post-push não cancela push já realizado)
if [ -z "$SESSION_ID" ]; then
    mkdir -p "$LOG_DIR"
    jq -cn --arg msg "on-git-push.sh: SESSION_ID inválido ou jq indisponível — push não registrado" \
        '{event:"gitPushRejected", error: $msg}' >> "$LOG_DIR/audit.jsonl" 2> /dev/null || true
    echo "[on-git-push] AVISO: SESSION_ID vazio — push NÃO registrado no sistema de hooks (sessão inativa)." >&2
    exit 0
fi

NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
CURRENT_TURN=$((TURN_COUNT + 1))
NEW_PUSH_COUNT=$((PUSH_COUNT + 1))

# Se BRANCH não foi detectado, tenta obter do git
if [ -z "$BRANCH" ]; then
    BRANCH="$(git rev-parse --abbrev-ref HEAD 2> /dev/null || echo '')"
fi
if [ -z "$LOCAL_SHA" ]; then
    LOCAL_SHA="$(git rev-parse HEAD 2> /dev/null | cut -c1-8 || echo '')"
fi

# ── Atualiza session-context.json ────────────────────────────────────────────
# shellcheck disable=SC2016
_JQ_FILTER='.session_stats.push_count                  = $push_count
           | .session_stats.last_push_at               = $ts
           | .session_stats.last_push_turn             = $turn
           | .session_stats.pending_section_after_push = true
           | .current_section.push_count              = ((.current_section.push_count // 0) + 1)'

if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
    jq --argjson push_count "$NEW_PUSH_COUNT" \
        --arg ts "$NOW_ISO" \
        --argjson turn "$CURRENT_TURN" \
        "$_JQ_FILTER" "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || {
        echo "[on-git-push] ERRO: falha ao atualizar session-context.json via sponge — push_count e pending_section não atualizados!" >&2
        exit 1
    }
elif [ -f "$CTX_FILE" ]; then
    TMP="$(mktemp)" || exit 1
    jq --argjson push_count "$NEW_PUSH_COUNT" \
        --arg ts "$NOW_ISO" \
        --argjson turn "$CURRENT_TURN" \
        "$_JQ_FILTER" "$CTX_FILE" > "$TMP" || {
        rm -f "$TMP"
        echo "[on-git-push] ERRO: jq falhou ao atualizar session-context.json — state intacto" >&2
        exit 1
    }
    mv "$TMP" "$CTX_FILE" || {
        echo "[on-git-push] ERRO: mv falhou — state intacto" >&2
        exit 1
    }
fi

# ── Loga evento gitPush em audit.jsonl ───────────────────────────────────────
mkdir -p "$LOG_DIR"
jq -cn \
    --arg event "gitPush" \
    --arg sid "$SESSION_ID" \
    --arg ts "$NOW_ISO" \
    --argjson turn "$CURRENT_TURN" \
    --argjson section_turn "$SECTION_TURN" \
    --arg section_name "$SECTION_NAME" \
    --arg remote "$REMOTE" \
    --arg branch "$BRANCH" \
    --arg sha "$LOCAL_SHA" \
    --argjson push_num "$NEW_PUSH_COUNT" \
    '{
        event:        $event,
        session_id:   $sid,
        timestamp:    $ts,
        turn_number:  $turn,
        section_turn: $section_turn,
        section_name: (if $section_name == "" then null else $section_name end),
        remote:       (if $remote == "" then null else $remote end),
        branch:       (if $branch == "" then null else $branch end),
        sha:          (if $sha == "" then null else $sha end),
        push_number:  $push_num
    }' >> "$LOG_DIR/audit.jsonl"

echo "[git-push] Push #${NEW_PUSH_COUNT} registrado (turno ~${CURRENT_TURN}, section: \"${SECTION_NAME}\") — agent-stop exigirá declaração de seção." >&2
exit 0
