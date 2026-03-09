#!/bin/bash
# log-prompt.sh — Hook userPromptSubmitted do Copilot
# Executado quando o usuário submete um prompt ao agente.
# Input JSON (stdin): {timestamp, cwd, prompt}
# Output: ignorado pelo Copilot.
#
# PRIVACIDADE: o texto completo do prompt NÃO é logado.
# Apenas um hash SHA-256 truncado e o tamanho são registrados.
# Isso protege informações sensíveis que possam aparecer nos prompts.
#
# Schema v2: reseta current_turn.* (âmbito turno) no início de cada prompt.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
CTX_FILE="$HOOK_DIR/state/session-context.json"

mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"

INPUT="$(cat 2> /dev/null || true)"

TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // 0' 2> /dev/null || echo 0)"
CWD="$(echo "$INPUT" | jq -r '.cwd // ""' 2> /dev/null || echo '')"
PROMPT_RAW="$(echo "$INPUT" | jq -r '.prompt // ""' 2> /dev/null || echo '')"

# Obtém session_id do contexto persistido — fix B6: sem quebra de linha invisível
SESSION_ID=""
if [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session.id // ""' "$CTX_FILE" 2>/dev/null || echo '')"
fi

# Calcula hash SHA-256 truncado do prompt (jamais loga o texto completo)
PROMPT_HASH=""
PROMPT_LEN="${#PROMPT_RAW}"
if [ -n "$PROMPT_RAW" ] && command -v sha256sum &>/dev/null; then
    PROMPT_HASH="$(echo -n "$PROMPT_RAW" | sha256sum | cut -c1-16)"
elif [ -n "$PROMPT_RAW" ] && command -v shasum &>/dev/null; then
    PROMPT_HASH="$(echo -n "$PROMPT_RAW" | shasum -a 256 | cut -c1-16)"
fi

# Loga apenas metadados — sem o texto do prompt
jq -cn \
    --arg event "userPromptSubmitted" \
    --arg sid "$SESSION_ID" \
    --arg ts "$TIMESTAMP" \
    --arg cwd "$CWD" \
    --arg hash "$PROMPT_HASH" \
    --argjson len "$PROMPT_LEN" \
    '{
        event:       $event,
        session_id:  $sid,
        timestamp:   $ts,
        cwd:         $cwd,
        prompt_hash: $hash,
        prompt_len:  $len
    }' >> "$LOG_DIR/audit.jsonl"

# ── Reseta current_turn no início de cada novo turno do usuário ──────────────
# Belt-and-suspenders: agent-stop.sh também reseta ao final do turno anterior,
# mas se agentStop não disparar, este reset garante que o próximo turno
# não herde estado "fantasma" do turno anterior.
# current_turn.number = session_stats.turn_count + 1 (turno que está começando)
if [ -f "$CTX_FILE" ] && command -v sponge &>/dev/null; then
    NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo '')"
    jq --arg ts "${TIMESTAMP:-$NOW_ISO}" \
        '.current_turn.started_at     = $ts
         | .current_turn.tools_count    = 0
         | .current_turn.tools_by_name  = {}
         | .current_turn.failures_count = 0
         | .current_turn.auth_requested    = false
         | .current_turn.auth_requested_at = null
         | .current_turn.number = ((.session_stats.turn_count // 0) + 1)' \
        "$CTX_FILE" | sponge "$CTX_FILE" 2>/dev/null || true
fi

exit 0
