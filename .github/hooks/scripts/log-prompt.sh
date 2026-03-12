#!/bin/bash
# log-prompt.sh — Hook userPromptSubmitted do Copilot
# Executado quando o usuário submete um prompt ao agente.
# Input JSON (stdin): {timestamp, cwd, prompt}
# Output JSON (stdout): systemMessage com SESSION reminder obrigatório em cada TURN.
#
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  HARDENING v6.0 — SESSION REMINDER NO INÍCIO DE CADA TURN              ║
# ║                                                                          ║
# ║  SESSION  ≠  SECTION  ≠  TURN                                           ║
# ║  ─────────────────────────────────────────────────────────────────────   ║
# ║  TURN    → encerra LIVREMENTE (sem autorização)                         ║
# ║  SECTION → agente decide autonomamente via start-section.sh             ║
# ║  SESSION → SOMENTE com Template F + KEY digitada + session-close.sh KEY  ║
# ╚══════════════════════════════════════════════════════════════════════════╝
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
# shellcheck disable=SC1091
if [ -f "$HOOK_DIR/hooks-lib/common.sh" ]; then
    source "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null \
        || echo "[warn] common.sh falhou ao carregar em log-prompt.sh" >&2
else
    echo "[warn] common.sh não encontrado (log-prompt.sh) — heal_v1/ctx functions indisponíveis" >&2
fi
mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"
# CRÍTICO-1 FIX: lê stdin e resolve per-session ANTES de abrir o flock (fd 9)
INPUT="$(cat 2> /dev/null || true)"

TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
_LOCAL_TS="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
CWD="$(echo "$INPUT" | jq -r '.cwd // ""' 2> /dev/null || echo '')"
PROMPT_RAW="$(echo "$INPUT" | jq -r '.prompt // ""' 2> /dev/null || echo '')"
SESSION_ID_PAYLOAD="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"
# UPG-AUDIT-01: resolve per-session files ANTES do flock (override CTX_FILE, AUDIT_FILE, _CTX_LOCK)
apply_per_session_paths "${SESSION_ID_PAYLOAD:-}" 2> /dev/null || true

# G9-08: Lock exclusivo APÓS resolver CTX_FILE per-session
_CTX_LOCK="${CTX_FILE}.lock"
exec 9> "$_CTX_LOCK"
if command -v flock > /dev/null 2>&1; then
    flock -x -w 3 9 2> /dev/null
fi

# Obtém session_id e section_id do contexto persistido — fix B6: sem quebra de linha invisível
SESSION_ID=""
SECTION_ID_PRE=""
if [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    SECTION_ID_PRE="$(jq -r '.current_section.section_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
fi

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 0 — SESSION_ID RECONCILIATION (GAP-01, PREMISSA-1)
# ══════════════════════════════════════════════════════════════════════════════
# Esta fase DEVE ser executada ANTES de qualquer outra leitura ou escrita no CTX.
# Princípio: o session_id do VS Code (SESSION_ID_PAYLOAD) é SEMPRE a fonte da
# verdade. Nunca geramos um novo UUID nem bloqueamos state writes por mismatch.
#
# Casos tratados:
#   HEAL v1  — CTX source=manual_recovery → adota SESSION_ID_PAYLOAD imediatamente
#   HEAL v1b — CTX source=inline_restart  → idem (BUG-06 FIX)
#   RECONNECT-01 — VS Code reconectou (novo session_id, sessionStart não disparou)
#                  → rollover controlado, sessionEnd sintético, source=reconnect_rollover
#   RECONNECT-02 — CTX com ended_at != null mas hooks ainda ativos
#                  → reinício inline (source=inline_restart), nova close_key
#
# GAP-03: contadores session_id_mismatches e session_id_syncs_inline em session_stats
# GAP-02: campo session.vs_code_session_id atualizado em todos os paths abaixo
# ══════════════════════════════════════════════════════════════════════════════

# ── Guard: session_id deve corresponder ao contexto ativo ─────────────────────
# F0.3: detecta contexto vazio
if [ -f "$CTX_FILE" ] && [ ! -s "$CTX_FILE" ]; then
    echo "[guard] session-context.json vazio — guard desabilitado (aguardando auto-recovery)" >&2
fi
# HARDENING v5: previne contaminação cruzada entre SESSIONs.
# HEAL v1: quando CTX_FILE é de manual_recovery ou inline_restart, adota session_id real do Copilot.
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
                >> "$AUDIT_FILE"
            SESSION_ID="$SESSION_ID_PAYLOAD" # continua com o ID correto
        else
            # ── Rollover de reconexão (RECONNECT-01) ──────────────────────────────────
            # O cliente VS Code desconectou e reconectou, gerando novo session_id.
            # O evento sessionStart NÃO é disparado pelo Copilot em reconexões.
            # Comportamento anterior: bloquear state write → 395 mismatches por sessão.
            # Comportamento novo: detectar como reconexão legítima e atualizar contexto.
            NOW_RECONNECT="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
            # 1) Logar evento de reconexão
            jq -cn \
                --arg event "sessionReconnect" \
                --arg old "$CTX_ACTIVE_SID" \
                --arg new "$SESSION_ID_PAYLOAD" \
                --arg source "log-prompt.sh" \
                --arg ts "${TIMESTAMP:-$NOW_RECONNECT}" \
                '{event: $event, old_session_id: $old, new_session_id: $new,
                  source: $source, timestamp: $ts,
                  message: "Reconexão do cliente VS Code detectada — rollover para novo session_id"}' \
                >> "$AUDIT_FILE"
            # Detectar se o rollover pode ser causado por compactação inline (inline conversation summary)
            # Distinção crítica: inline_compact_summary ≠ preCompact hook event
            # Evidência: compaction_count=0 após rollover indica que preCompact nunca disparou
            _COMPACT_COUNT_CHK="$(jq -r '.session_stats.compaction_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
            if [ "$_COMPACT_COUNT_CHK" = "0" ] || [ "$_COMPACT_COUNT_CHK" = "null" ]; then
                jq -cn \
                    --arg event "inlineCompact_suspected" \
                    --arg sid "$CTX_ACTIVE_SID" \
                    --arg ts "${TIMESTAMP:-$NOW_RECONNECT}" \
                    '{event: $event, session_id: $sid, timestamp: $ts,
                      source: "log-prompt.sh",
                      message: "Rollover com compaction_count=0 sugere reinicio inline por orcamento de tokens (nao preCompact)",
                      note: "inline_conversation_summary != preCompact_hook — ver GUIA-HOOKS-COPILOT.md secao 16.9"}' \
                    >> "$AUDIT_FILE"
            fi
            # 2) Gerar sessionEnd sintético para a sessão anterior
            jq -cn \
                --arg event "sessionEnd" \
                --arg sid "$CTX_ACTIVE_SID" \
                --arg ts "${TIMESTAMP:-$NOW_RECONNECT}" \
                --arg mode "abrupt_reconnect" \
                '{event: $event, session_id: $sid, timestamp: $ts, close_mode: $mode,
                  message: "sessionEnd sintético gerado por log-prompt.sh (rollover de reconexão)"}' \
                >> "$AUDIT_FILE"
            # 3) Atualizar contexto para o novo session_id (não bloquear state write)
            if command -v sponge &> /dev/null; then
                jq --arg new_sid "$SESSION_ID_PAYLOAD" --arg ts "$NOW_RECONNECT" \
                    '.session.id = $new_sid
                     | .session.vs_code_session_id = $new_sid
                     | .session.reconnect_at = $ts
                     | .session.source = "reconnect_rollover"' \
                    "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
            else
                _TMP_RC="$(mktemp)"
                if jq --arg new_sid "$SESSION_ID_PAYLOAD" --arg ts "$NOW_RECONNECT" \
                    '.session.id = $new_sid
                     | .session.vs_code_session_id = $new_sid
                     | .session.reconnect_at = $ts
                     | .session.source = "reconnect_rollover"' \
                    "$CTX_FILE" > "$_TMP_RC" 2> /dev/null; then
                    mv "$_TMP_RC" "$CTX_FILE" 2> /dev/null || rm -f "$_TMP_RC"
                else
                    rm -f "$_TMP_RC"
                fi
            fi
            SESSION_ID="$SESSION_ID_PAYLOAD" # prossegue com o novo ID
        fi
    fi
fi

# ── Post-Close Recovery (RECONNECT-02) ───────────────────────────────────────
# Detecta "orphan session": sessão encerrada (ended_at != null) mas hooks ainda
# ativos (mesmo session_id do VS Code → sessão real não reiniciou).
# Causa: session-close.sh registra ended_at, mas VS Code não dispara sessionStart
# novamente para o mesmo painel. Resultado: hooks continuam com contexto morto.
# Fix: ao receber novo prompt com sessão encerrada, inicia sessão inline.
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ]; then
    _ENDED_AT_RC="$(jq -r '.session.ended_at // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    if [ -n "$_ENDED_AT_RC" ] && [ "$_ENDED_AT_RC" != "null" ]; then
        NOW_RESTART="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
        _PREV_SID="$(jq -r '.session.id // "unknown"' "$CTX_FILE" 2> /dev/null || echo 'unknown')"
        _PREV_END_REASON="$(jq -r '.session.end_reason // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        _PREV_ENDED_AT="$_ENDED_AT_RC"
        _PREV_LOGICAL_NUM="$(jq -r '.session.logical_session_number // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
        _NEW_LOGICAL_NUM=$((${_PREV_LOGICAL_NUM:-1} + 1))
        # FIX BUG-01: usa session_id real do VS Code (Premissa-1: VS Code é a fonte da verdade).
        # O VS Code continuará enviando SESSION_ID_PAYLOAD em todos os hooks futuros —
        # gerar UUID aqui causaria mismatch permanente em pre-tool-use.sh e post-tool-use.sh.
        # A distinção "nova sessão lógica" é capturada por: source="inline_restart",
        # started_at (novo timestamp) e prev_session_id.
        if [ -n "$SESSION_ID_PAYLOAD" ]; then
            _NEW_SID="$SESSION_ID_PAYLOAD"
        elif [ -f /proc/sys/kernel/random/uuid ]; then
            # Fallback apenas quando VS Code não enviou session_id (caso improvável)
            _NEW_SID="$(cat /proc/sys/kernel/random/uuid)"
        else
            _NEW_SID="sess_$(date +%s%N 2> /dev/null | sha256sum | head -c 32 || date +%s | head -c 32)"
        fi
        # Gera novo close_key
        _NEW_KEY="ENCERRAR-$(head -c 4 /dev/urandom 2> /dev/null | xxd -p -u 2> /dev/null | head -c 8 \
            || date +%s | sha256sum | head -c 8 | tr '[:lower:]' '[:upper:]')"
        # Atualiza contexto: nova sessão inline
        if command -v sponge &> /dev/null; then
            jq --arg sid "$_NEW_SID" --arg key "$_NEW_KEY" --arg ts "$NOW_RESTART" \
                --arg prev_sid "$_PREV_SID" --arg prev_ended "$_PREV_ENDED_AT" \
                --arg prev_reason "$_PREV_END_REASON" \
                --argjson new_logical_num "$_NEW_LOGICAL_NUM" \
                '.session.id                  = $sid
                 | .session.vs_code_session_id = $sid
                 | .session.close_key         = $key
                 | .session.close_key_validated = false
                 | .session.started_at        = $ts
                 | .session.ended_at          = null
                 | .session.end_reason        = null
                 | .session.source            = "inline_restart"
                 | .session.prev_session_id   = $prev_sid
                 | .session.prev_ended_at     = $prev_ended
                 | .session.prev_end_reason   = $prev_reason
                 | .session_stats.turn_count  = 0
                 | .session_stats.failures_detected = 0
                 | .session_stats.turns_since_askQuestions = 0
                 | .session_stats.prev_turn_authorized = (.session_stats.turn_authorized // 0)
                 | .session_stats.prev_turn_no_askQuestions = (.session_stats.turn_no_askQuestions // 0)
                 | .session_stats.turn_authorized = 0
                 | .session_stats.turn_no_askQuestions = 0
                 | .compliance.consecutive_unauthorized = 0
                 | .compliance.last_turn_authorized = true
                 | .current_turn = {number: 0, section_turn: 0, todo_created: false,
                     tools_count: 0, auth_requested: false, intent: null, intent_declared: false}
                 | .session.logical_session_number             = $new_logical_num
                 | .session_stats.prev_section_count           = (.session_stats.section_count // 0)
                 | .session_stats.prev_section_names           = (.session_stats.section_names // [])
                 | .session_stats.section_count               = 0
                 | .session_stats.section_names               = []' \
                "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
        else
            _TMP_RESTART="$(mktemp)"
            if jq --arg sid "$_NEW_SID" --arg key "$_NEW_KEY" --arg ts "$NOW_RESTART" \
                --arg prev_sid "$_PREV_SID" --arg prev_ended "$_PREV_ENDED_AT" \
                --arg prev_reason "$_PREV_END_REASON" \
                --argjson new_logical_num "$_NEW_LOGICAL_NUM" \
                '.session.id                  = $sid
                 | .session.vs_code_session_id = $sid
                 | .session.close_key         = $key
                 | .session.close_key_validated = false
                 | .session.started_at        = $ts
                 | .session.ended_at          = null
                 | .session.end_reason        = null
                 | .session.source            = "inline_restart"
                 | .session.prev_session_id   = $prev_sid
                 | .session.prev_ended_at     = $prev_ended
                 | .session.prev_end_reason   = $prev_reason
                 | .session_stats.turn_count  = 0
                 | .session_stats.failures_detected = 0
                 | .session_stats.turns_since_askQuestions = 0
                 | .session_stats.prev_turn_authorized = (.session_stats.turn_authorized // 0)
                 | .session_stats.prev_turn_no_askQuestions = (.session_stats.turn_no_askQuestions // 0)
                 | .session_stats.turn_authorized = 0
                 | .session_stats.turn_no_askQuestions = 0
                 | .compliance.consecutive_unauthorized = 0
                 | .compliance.last_turn_authorized = true
                 | .current_turn = {number: 0, section_turn: 0, todo_created: false,
                     tools_count: 0, auth_requested: false, intent: null, intent_declared: false}
                 | .session.logical_session_number             = $new_logical_num
                 | .session_stats.prev_section_count           = (.session_stats.section_count // 0)
                 | .session_stats.prev_section_names           = (.session_stats.section_names // [])
                 | .session_stats.section_count               = 0
                 | .session_stats.section_names               = []' \
                "$CTX_FILE" > "$_TMP_RESTART" 2> /dev/null; then
                mv "$_TMP_RESTART" "$CTX_FILE" 2> /dev/null || rm -f "$_TMP_RESTART"
            else
                rm -f "$_TMP_RESTART"
            fi
        fi
        # Log do evento sessionStart_inline
        jq -cn \
            --arg sid "$_NEW_SID" --arg prev_sid "$_PREV_SID" --arg ts "$NOW_RESTART" \
            --arg key "$_NEW_KEY" --arg prev_ended "$_PREV_ENDED_AT" \
            --arg prev_reason "$_PREV_END_REASON" \
            --argjson new_logical_num "$_NEW_LOGICAL_NUM" \
            --argjson prev_logical_num "$_PREV_LOGICAL_NUM" \
            '{
                event:                       "sessionStart_inline",
                session_id:                  $sid,
                prev_session_id:             $prev_sid,
                timestamp:                   $ts,
                close_key:                   $key,
                prev_ended_at:               $prev_ended,
                prev_end_reason:             $prev_reason,
                logical_session_number:      $new_logical_num,
                prev_logical_session_number: $prev_logical_num,
                source:                      "log-prompt.sh",
                message:                     "Nova sessão inline após fechamento da sessão anterior"
            }' >> "$AUDIT_FILE"
        SESSION_ID="$_NEW_SID"
        echo "[log-prompt] Sessão anterior encerrada (${_PREV_ENDED_AT}). Nova sessão inline: ${_NEW_SID} | close_key: ${_NEW_KEY}" >&2
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
    --arg sid_payload "$SESSION_ID_PAYLOAD" \
    --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
    --arg cwd "$CWD" \
    --arg hash "$PROMPT_HASH" \
    --arg section_id "$SECTION_ID_PRE" \
    --argjson len "$PROMPT_LEN" \
    '{
        event:               $event,
        session_id:          $sid,
        session_id_in_payload: (if $sid_payload == "" then false else true end),
        timestamp:           $ts,
        cwd:                 $cwd,
        prompt_hash:         $hash,
        prompt_len:          $len,
        section_id:  (if $section_id == "" then null else $section_id end)
    }' >> "$AUDIT_FILE"

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
         | .current_turn.block_count               = 0
         | .current_turn.agentStop_invocations     = 0
         | .current_turn.todo_created              = false
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
         | .current_turn.block_count               = 0
         | .current_turn.agentStop_invocations     = 0
         | .current_turn.todo_created              = false
         | .current_section.local_turn             = ((.current_section.local_turn // 0) + 1)
         | .current_turn.section_turn              = (.current_section.local_turn // 1)' \
        "$CTX_FILE" > "$TMP" && mv "$TMP" "$CTX_FILE"

    TURN_NUMBER="$(jq -r '.current_turn.number // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
    SECTION_TURN="$(jq -r '.current_turn.section_turn // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
    SECTION_NAME="$(jq -r '.current_section.name // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    SECTION_ID="$(jq -r '.current_section.section_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
fi

# Loga evento turnStart (automático — complementado por start-turn.sh para intenção)
LOGICAL_NUM="$(jq -r '.session.logical_session_number // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
jq -cn \
    --arg event "turnStart" \
    --arg sid "$SESSION_ID" \
    --arg ts "${TIMESTAMP:-$NOW_ISO}" \
    --arg turn_id "$TURN_ID" \
    --argjson turn_number "$TURN_NUMBER" \
    --argjson section_turn "${SECTION_TURN:-1}" \
    --arg section_name "$SECTION_NAME" \
    --arg section_id "$SECTION_ID" \
    --argjson logical_num "$LOGICAL_NUM" \
    '{
        event:                  $event,
        session_id:             $sid,
        timestamp:              $ts,
        turn_id:                $turn_id,
        turn_number:            $turn_number,
        section_turn:           $section_turn,
        section_name:           (if $section_name == "" then null else $section_name end),
        section_id:             (if $section_id == "" then null else $section_id end),
        logical_session_number: $logical_num
    }' >> "$AUDIT_FILE"

# ── Hardening v6.0: systemMessage SESSION REMINDER em CADA TURN ──────────────
# CRÍTICO: Este é o único ponto onde o agente recebe lembrete ANTES de gerar sua
# resposta. Todos os outros lembretes (agent-stop.sh) são POST-HOC e chegam tarde.
#
# SESSION ≠ SECTION ≠ TURN:
#   TURN    → encerra LIVREMENTE (agentStop automático)
#   SECTION → agente decide mudança via start-section.sh (autônomo)
#   SESSION → SOMENTE com vscode_askQuestions Template F + KEY + bash session-close.sh KEY
_SESSION_REMINDER_MSG=""
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ]; then
    _SR_CLOSE_KEY="$(jq -r '.session.close_key // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    _SR_CLOSE_VALIDATED="$(jq -r '.session.close_key_validated // false' "$CTX_FILE" 2> /dev/null || echo 'false')"
    _SR_SECTION="$(jq -r '.current_section.name // "(sem section)"' "$CTX_FILE" 2> /dev/null || echo '(sem section)')"
    _SR_CONSEC="$(jq -r '.compliance.consecutive_unauthorized // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    _SR_TURNS_SINCE="$(jq -r '.session_stats.turns_since_askQuestions // 0' "$CTX_FILE" 2> /dev/null || echo 0)"

    # Determina severidade do lembrete
    _SR_SEVERITY="INFO"
    if { [ "$_SR_CONSEC" -ge 2 ] 2> /dev/null; }; then
        _SR_SEVERITY="CRITICO"
    elif { [ "$_SR_CONSEC" -ge 1 ] 2> /dev/null; } || { [ "$_SR_TURNS_SINCE" -ge 3 ] 2> /dev/null; }; then
        _SR_SEVERITY="ALERTA"
    fi

    # Emoji de severidade
    _SR_ICON="📍"
    [ "$_SR_SEVERITY" = "ALERTA" ] && _SR_ICON="⚠️"
    [ "$_SR_SEVERITY" = "CRITICO" ] && _SR_ICON="🚨"

    # Linha de violação (se houver)
    _SR_VIOLATION=""
    if { [ "$_SR_CONSEC" -ge 1 ] 2> /dev/null; }; then
        _SR_VIOLATION="
⛔ VIOLAÇÃO: ${_SR_CONSEC} TURN(s) SEM vscode_askQuestions | ${_SR_TURNS_SINCE} desde o último"
    fi

    # Linha de SESSION close (sempre visível)
    _SR_SESSION_LINE="🔐 SESSION ATIVA"
    if [ "$_SR_CLOSE_VALIDATED" = "true" ]; then
        _SR_SESSION_LINE="✅ SESSION: close_key validada"
    elif [ -n "$_SR_CLOSE_KEY" ]; then
        _SR_SESSION_LINE="🔐 SESSION: chave = ${_SR_CLOSE_KEY} (ainda NÃO encerrada)"
    fi

    _SESSION_REMINDER_MSG="${_SR_ICON} TURN INICIADO | SECTION: \"${_SR_SECTION}\" | ${_SR_SESSION_LINE}${_SR_VIOLATION}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  TURN    → encerra LIVREMENTE (sem autorização necessária)
  SECTION → muda via: bash .github/hooks/scripts/start-section.sh \"nome\" (autônomo)
  SESSION → fecha SOMENTE com: vscode_askQuestions (Template F) + usuário digita KEY
                               + bash .github/hooks/scripts/session-close.sh KEY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Ao CONCLUIR esta resposta: chame vscode_askQuestions para comunicar o resultado."
fi

if [ -n "$_SESSION_REMINDER_MSG" ]; then
    printf '%s\n' "{\"systemMessage\":$(printf '%s' "$_SESSION_REMINDER_MSG" | jq -Rs .)}"
fi

exit 0
