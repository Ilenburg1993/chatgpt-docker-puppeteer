#!/bin/bash
# log-prompt.sh — Hook userPromptSubmitted do Copilot
# Executado quando o usuário submete um prompt ao agente.
# Input JSON (stdin): {timestamp, cwd, prompt}
# Output: ignorado pelo Copilot.
#
# PRIVACIDADE: o texto completo do prompt NÃO é logado.
# Apenas um hash SHA-256 truncado e o tamanho são registrados.
# Isso protege informações sensíveis que possam aparecer nos prompts.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"

mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"

INPUT="$(cat 2>/dev/null || true)"

TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // 0'   2>/dev/null || echo 0)"
CWD="$(echo "$INPUT"       | jq -r '.cwd // ""'         2>/dev/null || echo '')"
PROMPT_RAW="$(echo "$INPUT" | jq -r '.prompt // ""'     2>/dev/null || echo '')"

# Obtém session_id do contexto persistido (se existir)
SESSION_ID=""
CTX_FILE="$HOOK_DIR/state/session-context.json"
if [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session_id // ""' "$CTX_FILE" 2>/dev/null || echo '')"
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
        event:      $event,
        session_id: $sid,
        timestamp:  $ts,
        cwd:        $cwd,
        prompt_hash: $hash,
        prompt_len:  $len
    }' >> "$LOG_DIR/audit.jsonl"

exit 0
