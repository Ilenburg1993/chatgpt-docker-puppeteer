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
# Schema v4: reseta current_turn.* (âmbito turno) no início de cada prompt.
# Campos v4 adicionados: current_turn.section_name, reset last_askquestions_response.
# Loga evento turnStart (automático) além de userPromptSubmitted.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
CTX_FILE="$HOOK_DIR/state/session-context.json"

mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"

INPUT="$(cat 2> /dev/null || true)"

TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
_LOCAL_TS="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
CWD="$(echo "$INPUT" | jq -r '.cwd // ""' 2> /dev/null || echo '')"
PROMPT_RAW="$(echo "$INPUT" | jq -r '.prompt // ""' 2> /dev/null || echo '')"
SESSION_ID_PAYLOAD="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"

# Obtém session_id e section_id do contexto persistido — fix B6: sem quebra de linha invisível
SESSION_ID=""
SECTION_ID_PRE=""
if [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    SECTION_ID_PRE="$(jq -r '.current_section.section_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
fi

# ── Guard: session_id deve corresponder ao contexto ativo ─────────────────────
# F0.3: detecta contexto vazio
if [ -f "$CTX_FILE" ] && [ ! -s "$CTX_FILE" ]; then
    echo "[guard] session-context.json vazio — guard desabilitado (aguardando auto-recovery)" >&2
fi
# HARDENING v5: previne contaminação cruzada entre SESSIONs.
# HEAL v1: quando CTX_FILE é de manual_recovery, adota session_id real do Copilot.
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] && [ -n "$SESSION_ID_PAYLOAD" ]; then
    CTX_ACTIVE_SID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    if [ -n "$CTX_ACTIVE_SID" ] && [ "$SESSION_ID_PAYLOAD" != "$CTX_ACTIVE_SID" ]; then
        CTX_SOURCE="$(jq -r '.session.source // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        if [ "$CTX_SOURCE" = "manual_recovery" ]; then
            # Auto-heal: sessão real do Copilot detectada após init manual — adota o novo ID
            NOW_HEAL="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
            if command -v sponge &> /dev/null; then
                jq --arg real_sid "$SESSION_ID_PAYLOAD" --arg ts "$NOW_HEAL" \
                    '.session.id = $real_sid | .session.source = "healed_from_real_session" | .session.healed_at = $ts' \
                    "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
            else
                _TMP_HEAL="$(mktemp)"
                if jq --arg real_sid "$SESSION_ID_PAYLOAD" --arg ts "$NOW_HEAL" \
                    '.session.id = $real_sid | .session.source = "healed_from_real_session" | .session.healed_at = $ts' \
                    "$CTX_FILE" > "$_TMP_HEAL" 2> /dev/null; then
                    mv "$_TMP_HEAL" "$CTX_FILE" 2> /dev/null || rm -f "$_TMP_HEAL"
                else
                    rm -f "$_TMP_HEAL"
                fi
            fi
            jq -cn \
                --arg event "session_id_healed" \
                --arg old "$CTX_ACTIVE_SID" \
                --arg new "$SESSION_ID_PAYLOAD" \
                --arg source "log-prompt.sh" \
                --arg ts "${TIMESTAMP:-$NOW_HEAL}" \
                '{event: $event, old_session_id: $old, new_session_id: $new, source: $source, timestamp: $ts,
                  message: "CTX manual_recovery adotado: session_id atualizado para sessão real do Copilot"}' \
                >> "$LOG_DIR/audit.jsonl"
            SESSION_ID="$SESSION_ID_PAYLOAD" # continua com o ID correto
        else
            jq -cn \
                --arg event "session_id_mismatch" \
                --arg expected "$CTX_ACTIVE_SID" \
                --arg got "$SESSION_ID_PAYLOAD" \
                --arg source "log-prompt.sh" \
                --arg ts "${TIMESTAMP:-}" \
                '{
                    event:   $event,
                    expected: $expected,
                    got:      $got,
                    source:   $source,
                    timestamp: $ts,
                    message:  "Payload session_id diferente do contexto ativo — state write bloqueado"
                }' >> "$LOG_DIR/audit.jsonl"
            exit 0
        fi
    fi
fi

# Calcula hash SHA-256 truncado do prompt (jamais loga o texto completo)
PROMPT_HASH=""
PROMPT_LEN="${#PROMPT_RAW}"
if [ -n "$PROMPT_RAW" ] && command -v sha256sum &> /dev/null; then
    PROMPT_HASH="$(echo -n "$PROMPT_RAW" | sha256sum | cut -c1-16)"
elif [ -n "$PROMPT_RAW" ] && command -v shasum &> /dev/null; then
    PROMPT_HASH="$(echo -n "$PROMPT_RAW" | shasum -a 256 | cut -c1-16)"
fi

# Loga apenas metadados — sem o texto do prompt
jq -cn \
    --arg event "userPromptSubmitted" \
    --arg sid "$SESSION_ID" \
    --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
    --arg cwd "$CWD" \
    --arg hash "$PROMPT_HASH" \
    --arg section_id "$SECTION_ID_PRE" \
    --argjson len "$PROMPT_LEN" \
    '{
        event:       $event,
        session_id:  $sid,
        timestamp:   $ts,
        cwd:         $cwd,
        prompt_hash: $hash,
        prompt_len:  $len,
        section_id:  (if $section_id == "" then null else $section_id end)
    }' >> "$LOG_DIR/audit.jsonl"

# ── Reseta current_turn no início de cada novo turno do usuário ──────────────
# Belt-and-suspenders: agent-stop.sh também reseta ao final do turno anterior,
# mas se agentStop não disparar, este reset garante que o próximo turno
# não herde estado "fantasma" do turno anterior.
# current_turn.number = session_stats.turn_count + 1 (turno que está começando)
# Schema v4: section_name capturado da section ativa; last_askquestions_response resetado.
NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
TURN_NUMBER=1
SECTION_TURN=1
SECTION_NAME=""
SECTION_ID=""
# Gera turn_id UUID para rastreio único deste turno
TURN_ID="$(uuidgen 2> /dev/null || printf 'turn_%s_%s' "$(date +%s)" "$$")"

if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
    jq --arg ts "${TIMESTAMP:-$NOW_ISO}" \
        --arg turn_id "$TURN_ID" \
        '.current_turn.started_at                = $ts
         | .current_turn.turn_id                  = $turn_id
         | .current_turn.tools_count               = 0
         | .current_turn.tools_by_name             = {}
         | .current_turn.failures_count            = 0
         | .current_turn.auth_requested            = false
         | .current_turn.auth_requested_at         = null
         | .current_turn.last_askquestions_response = null
         | .current_turn.number                    = ((.session_stats.turn_count // 0) + 1)
         | .current_turn.section_name              = .current_section.name
         | .current_turn.section_id               = .current_section.section_id
         | .current_turn.intent_declared           = false
         | .current_turn.intent                    = null
         | .current_section.local_turn             = ((.current_section.local_turn // 0) + 1)
         | .current_turn.section_turn              = (.current_section.local_turn // 1)' \
        "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true

    # Lê valores pós-reset para logar turnStart
    TURN_NUMBER="$(jq -r '.current_turn.number // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
    SECTION_TURN="$(jq -r '.current_turn.section_turn // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
    SECTION_NAME="$(jq -r '.current_section.name // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    SECTION_ID="$(jq -r '.current_section.section_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
elif [ -f "$CTX_FILE" ]; then
    TMP="$(mktemp)"
    jq --arg ts "${TIMESTAMP:-$NOW_ISO}" \
        --arg turn_id "$TURN_ID" \
        '.current_turn.started_at                = $ts
         | .current_turn.turn_id                  = $turn_id
         | .current_turn.tools_count               = 0
         | .current_turn.tools_by_name             = {}
         | .current_turn.failures_count            = 0
         | .current_turn.auth_requested            = false
         | .current_turn.auth_requested_at         = null
         | .current_turn.last_askquestions_response = null
         | .current_turn.number                    = ((.session_stats.turn_count // 0) + 1)
         | .current_turn.section_name              = .current_section.name
         | .current_turn.section_id               = .current_section.section_id
         | .current_turn.intent_declared           = false
         | .current_turn.intent                    = null
         | .current_section.local_turn             = ((.current_section.local_turn // 0) + 1)
         | .current_turn.section_turn              = (.current_section.local_turn // 1)' \
        "$CTX_FILE" > "$TMP" && mv "$TMP" "$CTX_FILE"

    TURN_NUMBER="$(jq -r '.current_turn.number // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
    SECTION_TURN="$(jq -r '.current_turn.section_turn // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
    SECTION_NAME="$(jq -r '.current_section.name // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    SECTION_ID="$(jq -r '.current_section.section_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
fi

# Loga evento turnStart (automático — complementado por start-turn.sh para intenção)
jq -cn \
    --arg event "turnStart" \
    --arg sid "$SESSION_ID" \
    --arg ts "${TIMESTAMP:-$NOW_ISO}" \
    --arg turn_id "$TURN_ID" \
    --argjson turn_number "$TURN_NUMBER" \
    --argjson section_turn "${SECTION_TURN:-1}" \
    --arg section_name "$SECTION_NAME" \
    --arg section_id "$SECTION_ID" \
    '{
        event:        $event,
        session_id:   $sid,
        timestamp:    $ts,
        turn_id:      $turn_id,
        turn_number:  $turn_number,
        section_turn: $section_turn,
        section_name: (if $section_name == "" then null else $section_name end),
        section_id:   (if $section_id == "" then null else $section_id end)
    }' >> "$LOG_DIR/audit.jsonl"

exit 0
