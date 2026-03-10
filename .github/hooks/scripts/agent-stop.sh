#!/bin/bash
# agent-stop.sh — Hook agentStop do Copilot (Stop event)
# Executado quando o agente termina de responder ao prompt (fim de turno).
# Input JSON (stdin): {timestamp, hook_event_name, session_id, stop_hook_active, ...}
# Output JSON (stdout): quando o turno não chamou vscode_askQuestions, emite
#   {"decision":"block","systemMessage":"..."} para forçar o agente a continuar.
#   Caso contrário, não emite nada (saída vazia → agente encerra normalmente).
#
# PROTOCOLO DE ENCERRAMENTO: detecta fins de turno e verifica autorização.
# O agente DEVE usar vscode_askQuestions antes de encerrar — este hook faz a
# verificação post-hoc e registra conformidade ou violação.
#
# HARDENING v5:
#   - decision:block quando agente tenta encerrar sem vscode_askQuestions
#   - Anti-recursão: respeita stop_hook_active e block_count (max 1 retry)
#   - Calcula turn_duration a partir de current_turn.started_at (fix B3)
#   - session_summary usa métricas DO TURNO, não da sessão (fix B4)
#   - Reseta current_turn.* e incrementa session_stats.* após cada turno
#   - compliance.* controla o estado de autorização
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
CTX_FILE="$STATE_DIR/session-context.json"
# shellcheck disable=SC1091
source "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null || true
mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"
# G9-08: Lock exclusivo para prevenir race conditions em escritas de session-context.json.
# flock -w 3: aguarda até 3s; se não conseguir, continua sem lock (degraded mode).
_CTX_LOCK="${CTX_FILE}.lock"
exec 9> "$_CTX_LOCK"
if command -v flock > /dev/null 2>&1; then
    flock -x -w 3 9 2> /dev/null
fi
INPUT="$(cat 2> /dev/null || true)"

# Extrai campos usando schema real
TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
SESSION_ID_PAYLOAD="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"
NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"

# stop_hook_active: true quando esta parada foi iniciada por um hook (prevenção de recursão).
# IMPORTANTE: não tentar bloquear (decision: block) quando stop_hook_active=true.
STOP_HOOK_ACTIVE="$(echo "$INPUT" | jq -r '.stop_hook_active // false' 2> /dev/null || echo 'false')"

# session_id: prioriza payload; fallback para contexto
SESSION_ID="$SESSION_ID_PAYLOAD"
if [ -z "$SESSION_ID" ] && [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
fi

# ── Guard: session_id deve corresponder ao contexto ativo ─────────────────────
# HARDENING v5: previne contaminação cruzada entre sessões.
# F0.3: detecta contexto vazio (sessionStart não disparou ou state foi limpo)
if [ -f "$CTX_FILE" ] && [ ! -s "$CTX_FILE" ]; then
    echo "[guard] session-context.json vazio — guard desabilitado (aguardando auto-recovery via preToolUse)" >&2
fi
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] && [ -n "$SESSION_ID_PAYLOAD" ]; then
    CTX_ACTIVE_SID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    if [ -n "$CTX_ACTIVE_SID" ] && [ "$SESSION_ID_PAYLOAD" != "$CTX_ACTIVE_SID" ]; then
        CTX_SOURCE="$(jq -r '.session.source // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        if [ "$CTX_SOURCE" = "manual_recovery" ]; then
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
                --arg source "agent-stop.sh" \
                --arg ts "${TIMESTAMP:-$NOW_HEAL}" \
                '{event: $event, old_session_id: $old, new_session_id: $new, source: $source, timestamp: $ts,
                  message: "CTX manual_recovery adotado: session_id atualizado para sessão real do Copilot"}' \
                >> "$LOG_DIR/audit.jsonl"
            SESSION_ID="$SESSION_ID_PAYLOAD" # continua com ID correto
        else
            # G9-04: HEAL v2 — rastreia mismatches consecutivos com o mesmo "got" session_id.
            # Após 3 ocorrências do mesmo "got", auto-heal (CTX provavelmente defasado).
            MISMATCH_TRACK_FILE="$STATE_DIR/.mismatch_track.json"
            PREV_GOT=""
            PREV_COUNT=0
            if [ -f "$MISMATCH_TRACK_FILE" ]; then
                PREV_GOT="$(jq -r '.got // ""' "$MISMATCH_TRACK_FILE" 2> /dev/null || echo '')"
                PREV_COUNT="$(jq -r '.count // 0' "$MISMATCH_TRACK_FILE" 2> /dev/null || echo 0)"
            fi
            if [ "$PREV_GOT" = "$SESSION_ID_PAYLOAD" ]; then
                NEW_COUNT=$((PREV_COUNT + 1))
            else
                NEW_COUNT=1
            fi
            jq -cn --arg got "$SESSION_ID_PAYLOAD" --argjson count "$NEW_COUNT" \
                '{got: $got, count: $count}' > "$MISMATCH_TRACK_FILE" 2> /dev/null || true

            if [ "$NEW_COUNT" -ge 3 ]; then
                # HEAL v2: ID recorrente → trust como real e sanar o contexto
                NOW_HEAL="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
                if command -v sponge &> /dev/null; then
                    jq --arg real_sid "$SESSION_ID_PAYLOAD" --arg ts "$NOW_HEAL" \
                        '.session.id = $real_sid | .session.source = "healed_from_consecutive_mismatch" | .session.healed_at = $ts' \
                        "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
                else
                    _TMP_HEAL="$(mktemp)"
                    if jq --arg real_sid "$SESSION_ID_PAYLOAD" --arg ts "$NOW_HEAL" \
                        '.session.id = $real_sid | .session.source = "healed_from_consecutive_mismatch" | .session.healed_at = $ts' \
                        "$CTX_FILE" > "$_TMP_HEAL" 2> /dev/null; then
                        mv "$_TMP_HEAL" "$CTX_FILE" 2> /dev/null || rm -f "$_TMP_HEAL"
                    else
                        rm -f "$_TMP_HEAL"
                    fi
                fi
                rm -f "$MISMATCH_TRACK_FILE" 2> /dev/null || true
                jq -cn \
                    --arg event "session_id_healed" \
                    --arg old "$CTX_ACTIVE_SID" \
                    --arg new "$SESSION_ID_PAYLOAD" \
                    --arg source "agent-stop.sh:heal_v2" \
                    --arg ts "${TIMESTAMP:-$NOW_HEAL}" \
                    --argjson count "$NEW_COUNT" \
                    '{event: $event, old_session_id: $old, new_session_id: $new, source: $source,
                      timestamp: $ts, consecutive_mismatches: $count,
                      message: "HEAL v2: mismatch consecutivo (3x) — session_id sanado para ID recorrente"}' \
                    >> "$LOG_DIR/audit.jsonl"
                SESSION_ID="$SESSION_ID_PAYLOAD"
            else
                jq -cn \
                    --arg event "session_id_mismatch" \
                    --arg expected "$CTX_ACTIVE_SID" \
                    --arg got "$SESSION_ID_PAYLOAD" \
                    --arg source "agent-stop.sh" \
                    --arg ts "${TIMESTAMP:-}" \
                    --argjson count "$NEW_COUNT" \
                    '{
                        event:   $event,
                        expected: $expected,
                        got:      $got,
                        source:   $source,
                        timestamp: $ts,
                        consecutive_count: $count,
                        message:  "Payload session_id diferente do contexto ativo — state write bloqueado"
                    }' >> "$LOG_DIR/audit.jsonl"
                exit 0
            fi
        fi
    fi
fi

# ── Calcula duração do turno — fix B3 ────────────────────────────────────────
# Usa current_turn.started_at (timestamp de userPromptSubmitted) em vez de
# last_tool_ts, que apenas reflete o último tool call (impreciso para o turno todo).
TURN_DURATION_S=0
TURN_STARTED_AT=""
if [ -f "$CTX_FILE" ]; then
    TURN_STARTED_AT="$(jq -r '.current_turn.started_at // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    if [ -n "$TURN_STARTED_AT" ] && [ -n "$NOW_ISO" ]; then
        TURN_START_S="$(date -d "$TURN_STARTED_AT" '+%s' 2> /dev/null || echo 0)"
        NOW_S="$(date -d "$NOW_ISO" '+%s' 2> /dev/null || echo 0)"
        if [ "$NOW_S" -gt "$TURN_START_S" ] 2> /dev/null; then
            TURN_DURATION_S=$((NOW_S - TURN_START_S))
        fi
    fi
fi

# ── Lê metadados do turno atual para enriquecimento de todos os eventos ───────
TURN_NUMBER=1
SECTION_TURN=1
SECTION_NAME=""
SECTION_ID=""
TURN_INTENT=""
TURN_INTENT_DECLARED=false
TURN_ID=""
TURN_TOOLS_COUNT=0
TURN_FAILURES_COUNT=0
TURN_BLOCK_COUNT=0
if [ -f "$CTX_FILE" ]; then
    TURN_NUMBER="$(jq -r '.current_turn.number // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
    SECTION_TURN="$(jq -r '.current_turn.section_turn // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
    SECTION_NAME="$(jq -r '.current_section.name // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    SECTION_ID="$(jq -r '.current_section.section_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    TURN_INTENT="$(jq -r '.current_turn.intent // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    TURN_INTENT_DECLARED="$(jq -r '.current_turn.intent_declared // false' "$CTX_FILE" 2> /dev/null || echo false)"
    TURN_ID="$(jq -r '.current_turn.turn_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    TURN_TOOLS_COUNT="$(jq -r '.current_turn.tools_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    TURN_FAILURES_COUNT="$(jq -r '.current_turn.failures_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    TURN_BLOCK_COUNT="$(jq -r '.current_turn.block_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
fi

# ── REV-09: contador cumulativo de invocações de agentStop por turno ─────────
# REV4-01: operação atômica via jq (read+increment+write em uma única expressão).
# Elimina race condition de leitura-modificação-escrita em 3 passos separados.
AGENTST_INVOCATIONS=1
if [ -f "$CTX_FILE" ]; then
    if command -v sponge &> /dev/null; then
        AGENTST_INVOCATIONS="$(jq '.current_turn.agentStop_invocations = ((.current_turn.agentStop_invocations // 0) + 1)
            | .current_turn.agentStop_invocations' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || echo 1)"
    else
        _TMP_INV="$(mktemp)"
        AGENTST_INVOCATIONS="$(jq '.current_turn.agentStop_invocations = ((.current_turn.agentStop_invocations // 0) + 1)
            | .current_turn.agentStop_invocations' \
            "$CTX_FILE" > "$_TMP_INV" && mv "$_TMP_INV" "$CTX_FILE" \
            && jq -r '.current_turn.agentStop_invocations // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
    fi
fi

# Append em audit.jsonl — registra o fim do turno
jq -cn \
    --arg event "agentStop" \
    --arg sid "$SESSION_ID" \
    --arg ts "${TIMESTAMP:-$NOW_ISO}" \
    --argjson dur "$TURN_DURATION_S" \
    --argjson stop_hook_active "$STOP_HOOK_ACTIVE" \
    --argjson turn_number "$TURN_NUMBER" \
    --argjson section_turn "$SECTION_TURN" \
    --arg section_name "$SECTION_NAME" \
    --arg section_id "$SECTION_ID" \
    --arg turn_id "$TURN_ID" \
    --arg intent "$TURN_INTENT" \
    --argjson intent_declared "${TURN_INTENT_DECLARED:-false}" \
    --argjson tools_count "$TURN_TOOLS_COUNT" \
    --argjson failures_count "$TURN_FAILURES_COUNT" \
    --argjson block_count "$TURN_BLOCK_COUNT" \
    --argjson agentStop_invocations "$AGENTST_INVOCATIONS" \
    '{
        event:                  $event,
        session_id:             $sid,
        timestamp:              $ts,
        turn_duration_s:        $dur,
        stop_hook_active:       $stop_hook_active,
        turn_number:            $turn_number,
        section_turn:           $section_turn,
        section_name:           (if $section_name == "" then null else $section_name end),
        section_id:             (if $section_id == "" then null else $section_id end),
        turn_id:                (if $turn_id == "" then null else $turn_id end),
        intent:                 (if $intent == "" then null else $intent end),
        intent_declared:        $intent_declared,
        tools_count:            $tools_count,
        failures_count:         $failures_count,
        block_count:            $block_count,
        agentStop_invocations:  $agentStop_invocations
    }' >> "$LOG_DIR/audit.jsonl"

# ── Detecção de autorização ───────────────────────────────────────────────────
# Estratégia em camadas (do mais preciso ao mais tolerante):
#   1. Fronteira por userPromptSubmitted (preciso): busca após o último prompt
#   2. Fallback por recência (últimas 150 linhas): quando userPromptSubmitted ausente
#   3. Fallback de contexto: lê current_turn.auth_requested do session-context.json
AUTH_FLAG_FILE="$STATE_DIR/UNAUTHORIZED_CLOSE.flag"
AUTHORIZED_FLAG_FILE="$STATE_DIR/AUTHORIZED_CLOSE.flag"
AUTH_REQUESTED=false
AUDIT_FILE="$LOG_DIR/audit.jsonl"

if [ -f "$AUDIT_FILE" ]; then
    # Estratégia 1: fronteira por userPromptSubmitted
    LAST_PROMPT_LINE="$(awk '/"userPromptSubmitted"/{last=NR} END{print last+0}' "$AUDIT_FILE")"
    TOTAL_LINES="$(wc -l < "$AUDIT_FILE")"

    if [ "$LAST_PROMPT_LINE" -gt 0 ] && [ "$TOTAL_LINES" -gt "$LAST_PROMPT_LINE" ]; then
        LINES_SINCE_PROMPT=$((TOTAL_LINES - LAST_PROMPT_LINE))
        # Hardening defensivo: garante LINES_SINCE_PROMPT > 0 antes de chamar tail -n 0
        # (matematicamente redundante dado a condição acima, mas previne tail -n 0 acidental)
        if [ "$LINES_SINCE_PROMPT" -gt 0 ]; then
            if tail -n "$LINES_SINCE_PROMPT" "$AUDIT_FILE" \
                | jq -re 'select(.tool_name == "vscode_askQuestions" or .event == "subagentStart")' > /dev/null 2>&1; then
                AUTH_REQUESTED=true
            fi
        fi
    fi

    # Estratégia 2 (fallback): userPromptSubmitted ausente — verifica últimas 150 linhas
    if [ "$AUTH_REQUESTED" = "false" ] && [ "$LAST_PROMPT_LINE" -eq 0 ]; then
        RECENT_LINES=150
        if [ "$TOTAL_LINES" -lt "$RECENT_LINES" ]; then RECENT_LINES="$TOTAL_LINES"; fi
        if tail -n "$RECENT_LINES" "$AUDIT_FILE" \
            | jq -re 'select(.tool_name == "vscode_askQuestions" or .event == "subagentStart")' > /dev/null 2>&1; then
            AUTH_REQUESTED=true
        fi
    fi
fi

# Estratégia 3 (fallback de contexto): lê flag do session-context.json
# Schema v2: current_turn.auth_requested; legado: auth_requested_this_turn
if [ "$AUTH_REQUESTED" = "false" ] && [ -f "$CTX_FILE" ]; then
    CTX_FLAG="$(jq -r '
        .current_turn.auth_requested //
        .auth_requested_this_turn //
        false' "$CTX_FILE" 2> /dev/null || echo false)"
    if [ "$CTX_FLAG" = "true" ]; then AUTH_REQUESTED=true; fi
fi

# Estratégia 4: delegação ao subagente = autorização implícita
# runSubagent dispara agentStop no agente pai antes do subagente iniciar.
# pre-tool-use.sh seta subagent_delegated=true quando detecta a chamada.
# Esta estratégia captura o caso em que o contexto foi atualizado mas o audit.jsonl
# ainda não tinha o evento (race window mínima mas possível).
if [ "$AUTH_REQUESTED" = "false" ] && [ -f "$CTX_FILE" ]; then
    SUBAGENT_DELEGATED="$(jq -r '.current_turn.subagent_delegated // false' "$CTX_FILE" 2> /dev/null || echo false)"
    if [ "$SUBAGENT_DELEGATED" = "true" ]; then
        AUTH_REQUESTED=true
        jq -cn \
            --arg event "auth_via_subagent_delegation" \
            --arg sid "$SESSION_ID" \
            --arg ts "$NOW_ISO" \
            --arg turn_id "$TURN_ID" \
            '{
                event:      $event,
                session_id: $sid,
                timestamp:  $ts,
                turn_id:    (if $turn_id == "" then null else $turn_id end),
                message:    "Autorização concedida via delegação ao subagente (runSubagent)"
            }' >> "$LOG_DIR/audit.jsonl"
    fi
fi

# ── HARDENING: decision:block para turnos não autorizados ─────────────────────
# Quando o agente tenta encerrar sem vscode_askQuestions:
#   1. stop_hook_active=true → hook iniciou esta parada, não bloquear (anti-recursão)
#   2. block_count >= 1 → já tentamos, safety valve — permitir encerramento
#   3. Caso contrário → emitir {"decision":"block"} no stdout forçando continuação
if [ "$AUTH_REQUESTED" = "false" ] && [ "$STOP_HOOK_ACTIVE" != "true" ]; then
    BLOCK_COUNT=0
    if [ -f "$CTX_FILE" ]; then
        BLOCK_COUNT="$(jq -r '.current_turn.block_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    fi
    if [ "$BLOCK_COUNT" -lt 1 ]; then
        # Incrementa block_count (safety valve: na próxima vez permite encerrar)
        if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
            jq '.current_turn.block_count = (.current_turn.block_count // 0) + 1' \
                "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
        elif [ -f "$CTX_FILE" ]; then
            _TMP_BC="$(mktemp)"
            if jq '.current_turn.block_count = (.current_turn.block_count // 0) + 1' \
                "$CTX_FILE" > "$_TMP_BC" 2> /dev/null; then
                mv "$_TMP_BC" "$CTX_FILE" 2> /dev/null || rm -f "$_TMP_BC"
            else
                rm -f "$_TMP_BC"
            fi
        fi
        # Registra bloqueio no audit
        jq -cn \
            --arg event "turnEnd_BLOCKED" \
            --arg sid "$SESSION_ID" \
            --arg ts "$NOW_ISO" \
            --argjson bc "$((BLOCK_COUNT + 1))" \
            --arg section_id "$SECTION_ID" \
            --arg turn_id "$TURN_ID" \
            '{
                event:       $event,
                session_id:  $sid,
                timestamp:   $ts,
                block_count: $bc,
                section_id:  (if $section_id == "" then null else $section_id end),
                turn_id:     (if $turn_id == "" then null else $turn_id end),
                message:     "Agente tentou encerrar sem askQuestions — bloqueado para retry"
            }' >> "$LOG_DIR/audit.jsonl"

        # ── Monta systemMessage rico com estado contextualizado ───────────────
        _RICH_SECTION="$(jq -r '.current_section.name // "(nenhuma)"' "$CTX_FILE" 2> /dev/null || echo '(nenhuma)')"
        _RICH_SECTION_NUM="$(jq -r '.current_section.section_number // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
        _RICH_TURN="$(jq -r '.current_turn.number // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
        _RICH_SECTION_TURN="$(jq -r '.current_turn.section_turn // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
        _RICH_TOOLS="$(jq -r '.current_turn.tools_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
        _RICH_CONSEC="$(jq -r '.compliance.consecutive_unauthorized // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
        _RICH_PUSH_PENDING="$(jq -r '.session_stats.pending_section_after_push // false' "$CTX_FILE" 2> /dev/null || echo 'false')"
        _RICH_PUSH_COUNT="$(jq -r '.session_stats.push_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
        _RICH_ALTA=0
        _RICH_MEDIA=0
        _RICH_BACKLOG=0
        _RICH_NEXT_TASK="(sem tarefas)"
        TASKS_FILE_RT="$STATE_DIR/pending-tasks.md"
        if [ -f "$TASKS_FILE_RT" ]; then
            _RICH_ALTA="$(grep -c '^- \[ \].*\[alta\]' "$TASKS_FILE_RT" 2> /dev/null || echo 0)"
            _RICH_MEDIA="$(grep -c '^- \[ \].*\[media\]' "$TASKS_FILE_RT" 2> /dev/null || echo 0)"
            _RICH_BACKLOG="$(grep -c '^- \[ \].*\[backlog\]' "$TASKS_FILE_RT" 2> /dev/null || echo 0)"
            _RICH_NEXT_TASK="$(grep '^- \[ \].*\[alta\]' "$TASKS_FILE_RT" 2> /dev/null | head -1 | sed 's/^- \[ \] //' || echo '(sem tarefas alta)')"
        fi
        _CONSEC_MSG=""
        if [ "$_RICH_CONSEC" -gt 1 ] 2> /dev/null; then
            _CONSEC_MSG="⚠ ATENÇÃO: ${_RICH_CONSEC} violações consecutivas detectadas nesta sessão. "
        fi
        _PUSH_MSG=""
        if [ "$_RICH_PUSH_PENDING" = "true" ] 2> /dev/null; then
            _PUSH_MSG="

🔀 GIT PUSH DETECTADO (push #${_RICH_PUSH_COUNT}) — AÇÃO OBRIGATÓRIA:
  Execute UMA das opções abaixo usando run_in_terminal ANTES de prosseguir:
  → Declarar nova fase:  bash .github/hooks/scripts/start-section.sh \"nome-da-fase\"
  → Continuar na seção atual:  npm run hooks:continue-section
  Sem declarar/confirmar a seção, esta exigência reaparecerá nos próximos TURNs bloqueados."
        fi
        _RICH_MSG="⛔ BLOQUEIO — ENCERRAMENTO NÃO AUTORIZADO

Você tentou encerrar este turno sem chamar vscode_askQuestions.
${_CONSEC_MSG}
📍 ESTADO ATUAL:
  • Seção: \"${_RICH_SECTION}\" (#${_RICH_SECTION_NUM}) | TURN: ${_RICH_SECTION_TURN}/${_RICH_TURN} (local/global)
  • Ferramentas usadas: ${_RICH_TOOLS}
  • Backlog: ${_RICH_ALTA} alta | ${_RICH_MEDIA} média | ${_RICH_BACKLOG} backlog
  • Próxima tarefa: ${_RICH_NEXT_TASK}${_PUSH_MSG}

✅ AÇÃO OBRIGATÓRIA:
  1. Chame a ferramenta vscode_askQuestions (tool call real, não texto)
  2. Use Template A se concluiu uma tarefa
  3. Use Template F (com close_key) se quer encerrar a sessão
  4. Use Template E se está retomando após inatividade

📖 Templates completos em .github/AGENTS.md — seção \"Protocolo vscode_askQuestions\""

        # Emite decision:block no stdout — formato oficial VS Code Copilot Hooks
        # Conforme spec: hookSpecificOutput.decision="block" é lido pelo VS Code.
        # systemMessage é exibido ao usuário (common output format, complementar).
        # Referência: code.visualstudio.com/docs/copilot/customization/hooks
        printf '%s\n' "{\"hookSpecificOutput\":{\"hookEventName\":\"Stop\",\"decision\":\"block\",\"reason\":\"Turno não autorizado — vscode_askQuestions não foi chamado\"},\"systemMessage\":$(printf '%s' "$_RICH_MSG" | jq -Rs .)}"
        exit 0
    fi
fi

# ── Auto-enrich: gera turnStart_enriched_auto se start-turn.sh não foi chamado ──
if [ "$TURN_INTENT_DECLARED" = "false" ] && [ "$TURN_NUMBER" -gt 0 ]; then
    AUTO_INTENT="(não declarada)"
    if [ -f "$CTX_FILE" ]; then
        # Usa as ferramentas do turno como proxy de intenção
        TOP_TOOLS="$(jq -r '.current_turn.tools_by_name | to_entries | sort_by(-.value) | .[0:3] | map(.key) | join(", ")' \
            "$CTX_FILE" 2> /dev/null || echo '')"
        [ -n "$TOP_TOOLS" ] && AUTO_INTENT="ferramentas: ${TOP_TOOLS}"
    fi
    jq -cn \
        --arg event "turnStart_enriched_auto" \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_ISO" \
        --argjson turn_number "$TURN_NUMBER" \
        --arg section_name "$SECTION_NAME" \
        --arg section_id "$SECTION_ID" \
        --arg turn_id "$TURN_ID" \
        --arg intent "$AUTO_INTENT" \
        '{
            event:          $event,
            session_id:     $sid,
            timestamp:      $ts,
            turn_number:    $turn_number,
            section_name:   (if $section_name == "" then null else $section_name end),
            section_id:     (if $section_id == "" then null else $section_id end),
            turn_id:        (if $turn_id == "" then null else $turn_id end),
            intent:         $intent,
            auto_generated: true
        }' >> "$LOG_DIR/audit.jsonl"
fi

# ── Registra resultado do turno e atualiza compliance ────────────────────────
if [ "$AUTH_REQUESTED" = "true" ]; then
    rm -f "$AUTH_FLAG_FILE" 2> /dev/null || true
    # Cria flag de autorização (simétrico ao UNAUTHORIZED_CLOSE.flag para auditoria bidirecional)
    TURN_COUNT_NOW="$(jq -r '.session_stats.turn_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    jq -cn \
        --arg ts "$NOW_ISO" \
        --arg sid "$SESSION_ID" \
        --argjson turn "$TURN_COUNT_NOW" \
        '{
            timestamp:  $ts,
            session_id: $sid,
            turn_count: $turn,
            authorized: true
        }' > "$AUTHORIZED_FLAG_FILE"
    if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
        jq '.compliance.last_turn_authorized     = true
             | .compliance.consecutive_unauthorized = 0
             | .compliance.flag_file_exists        = false' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    fi
    jq -cn \
        --arg event "turnEnd_authorized" \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_ISO" \
        --argjson turn_number "$TURN_NUMBER" \
        --argjson section_turn "$SECTION_TURN" \
        --arg section_name "$SECTION_NAME" \
        --arg section_id "$SECTION_ID" \
        --arg turn_id "$TURN_ID" \
        --argjson dur "$TURN_DURATION_S" \
        --argjson tools "$TURN_TOOLS_COUNT" \
        --arg intent "$TURN_INTENT" \
        --argjson failures "$TURN_FAILURES_COUNT" \
        --argjson push_pending "$(jq -r '.session_stats.pending_section_after_push // false' "$CTX_FILE" 2> /dev/null || echo 'false')" \
        '{event: $event, session_id: $sid, timestamp: $ts,
          turn_number: $turn_number, section_turn: $section_turn,
          section_name: (if $section_name == "" then null else $section_name end),
          section_id:   (if $section_id == "" then null else $section_id end),
          turn_id:      (if $turn_id == "" then null else $turn_id end),
          turn_duration_s: $dur, tools_count: $tools,
          intent: (if $intent == "" then null else $intent end),
          failures_count: $failures, push_pending: $push_pending}' \
        >> "$LOG_DIR/audit.jsonl"
else
    TURN_COUNT_NOW="$(jq -r '.session_stats.turn_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    rm -f "$AUTHORIZED_FLAG_FILE" 2> /dev/null || true # remove flag de autorização caso exista
    jq -cn \
        --arg ts "$NOW_ISO" \
        --arg sid "$SESSION_ID" \
        --argjson turn "$TURN_COUNT_NOW" \
        '{
            timestamp:  $ts,
            session_id: $sid,
            turn_count: $turn,
            violation:  "Turno encerrado sem chamar vscode_askQuestions",
            severity:   "critical"
        }' > "$AUTH_FLAG_FILE"
    if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
        jq '.compliance.last_turn_authorized = false
             | .compliance.consecutive_unauthorized = (.compliance.consecutive_unauthorized // 0) + 1
             | .compliance.flag_file_exists = true' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    fi
    jq -cn \
        --arg event "turnEnd_UNAUTHORIZED" \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_ISO" \
        --argjson turn_number "$TURN_NUMBER" \
        --argjson section_turn "$SECTION_TURN" \
        --arg section_name "$SECTION_NAME" \
        --arg section_id "$SECTION_ID" \
        --arg turn_id "$TURN_ID" \
        --argjson dur "$TURN_DURATION_S" \
        --argjson tools "$TURN_TOOLS_COUNT" \
        --arg intent "$TURN_INTENT" \
        --argjson failures "$TURN_FAILURES_COUNT" \
        --arg msg "VIOLAÇÃO: turno encerrado sem vscode_askQuestions. Flag gravada em UNAUTHORIZED_CLOSE.flag" \
        '{event: $event, session_id: $sid, timestamp: $ts, message: $msg,
          turn_number: $turn_number, section_turn: $section_turn,
          section_name: (if $section_name == "" then null else $section_name end),
          section_id:   (if $section_id == "" then null else $section_id end),
          turn_id:      (if $turn_id == "" then null else $turn_id end),
          turn_duration_s: $dur, tools_count: $tools,
          intent: (if $intent == "" then null else $intent end),
          failures_count: $failures}' \
        >> "$LOG_DIR/audit.jsonl"
fi

# ── Incrementa session_stats, constrói session_summary e reseta current_turn ──
# CRÍTICO: reseta current_turn.auth_requested para false APÓS processamento.
# Sem este reset, a Estratégia 3 produziria falsos positivos no turno seguinte.
# session_summary usa métricas DO TURNO ATUAL (fix B4), não totais da sessão.
# Schema v7: appenda turn_history (cap 20) e atualiza recovery_hints.
if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
    SESSION_SUMMARY="turn=${TURN_NUMBER} dur=${TURN_DURATION_S}s tools=${TURN_TOOLS_COUNT}"
    AUTH_INCR_FIELD="$([ "$AUTH_REQUESTED" = "true" ] && echo 'turn_authorized' || echo 'turn_unauthorized')"
    NEXT_TURN=$((TURN_NUMBER + 1))
    jq --arg now "$NOW_ISO" \
        --arg summary "$SESSION_SUMMARY" \
        --arg auth_field "$AUTH_INCR_FIELD" \
        --argjson next_turn "$NEXT_TURN" \
        --arg section "$SECTION_NAME" \
        --arg sec_id "$SECTION_ID" \
        --arg turn_id_s "$TURN_ID" \
        --argjson turn_num "$TURN_NUMBER" \
        --argjson sec_turn "$SECTION_TURN" \
        --argjson dur_s "$TURN_DURATION_S" \
        --argjson tools_n "$TURN_TOOLS_COUNT" \
        --arg intent_s "$TURN_INTENT" \
        --arg auth_s "$AUTH_REQUESTED" \
        --argjson fail_n "$TURN_FAILURES_COUNT" \
        '.session_stats.turn_count    = (.session_stats.turn_count // 0) + 1
         | .session_stats[$auth_field] = (.session_stats[$auth_field] // 0) + 1
         | .last_turn_ts              = $now
         | .session_summary           = $summary
         | .session_stats.turn_history = (
             (.session_stats.turn_history // []) + [{
                 number:       $turn_num,
                 section:      $section,
                 section_id:   (if $sec_id == "" then null else $sec_id end),
                 turn_id:      (if $turn_id_s == "" then null else $turn_id_s end),
                 section_turn: $sec_turn,
                 duration_s:   $dur_s,
                 tools_count:  $tools_n,
                 intent:       (if $intent_s == "" then null else $intent_s end),
                 auth:         ($auth_s == "true"),
                 failures:     $fail_n,
                 ts:           $now
             }]
             | if length > 20 then .[-20:] else . end)
         | .session_stats.recovery_hints.last_section = $section
         | .session_stats.recovery_hints.last_intent  = (
             if $intent_s != "" then $intent_s
             else (.session_stats.recovery_hints.last_intent // null)
             end)
         | .current_turn.number            = $next_turn
         | .current_turn.started_at        = $now
         | .current_turn.tools_count       = 0
         | .current_turn.tools_by_name     = {}
         | .current_turn.failures_count    = 0
         | .current_turn.auth_requested    = false
         | .current_turn.auth_requested_at = null
         | .current_turn.last_askquestions_response = null
         | .current_turn.block_count       = 0
         | .current_turn.section_name      = $section
         | .current_turn.intent_declared   = false
         | .current_turn.intent            = null' \
        "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
fi

# ── Invariante SESSION+SECTION+TURN: auto-cria seção 'retomada' se null ──────
# Garante que a invariante nunca seja violada mesmo após section-end.sh manual.
# A seção auto-criada recebe auto_open:true no evento sectionStart no audit.jsonl.
CURR_SECTION_CHECK=""
if [ -f "$CTX_FILE" ]; then
    CURR_SECTION_CHECK="$(jq -r '.current_section.name // ""' "$CTX_FILE" 2> /dev/null || echo '')"
fi
if [ -z "$CURR_SECTION_CHECK" ] || [ "$CURR_SECTION_CHECK" = "null" ]; then
    _AUTO_SECTION_NOW="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    _AUTO_SECTION_ID="$(uuidgen 2> /dev/null || printf 'sect_%s_%s' "$(date +%s)" "$$")"
    _NEXT_SECTION_NUM=1
    _NEXT_TURN_AUTO=1
    if [ -f "$CTX_FILE" ]; then
        _NEXT_SECTION_NUM="$(jq -r '(.session_stats.section_count // 0) + 1' "$CTX_FILE" 2> /dev/null || echo 1)"
        _NEXT_TURN_AUTO="$(jq -r '(.session_stats.turn_count // 0) + 1' "$CTX_FILE" 2> /dev/null || echo 1)"
        jq --arg ts "$_AUTO_SECTION_NOW" \
            --arg auto_section_id "$_AUTO_SECTION_ID" \
            --argjson snum "$_NEXT_SECTION_NUM" \
            --argjson tnum "${_NEXT_TURN_AUTO:-1}" \
            '.current_section = {name: "retomada", section_id: $auto_section_id, started_at: $ts, turn_start: $tnum, description: "Seção automática criada pela invariante SESSION+SECTION+TURN", section_number: $snum, push_count: 0, tools_by_name: {}, intent_history: [], failures_count: 0, blocked_turns: 0}
             | .session_stats.section_count = $snum
             | .session_stats.section_names += ["retomada"]
             | .session_stats.section_history = ((.session_stats.section_history // []) + [{name: "retomada", section_id: $auto_section_id, section_number: $snum, started_at: $ts}] | if length > 50 then .[-50:] else . end)
             | .current_turn.section_turn = 1
             | .current_turn.agentStop_invocations = 0' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    fi
    jq -cn \
        --arg event "sectionStart" \
        --arg sid "$SESSION_ID" \
        --arg ts "$_AUTO_SECTION_NOW" \
        --arg auto_section_id "$_AUTO_SECTION_ID" \
        --argjson section_num "$_NEXT_SECTION_NUM" \
        '{
            event:          $event,
            session_id:     $sid,
            timestamp:      $ts,
            section_name:   "retomada",
            section_id:     $auto_section_id,
            section_number: $section_num,
            description:    "Seção automática criada pela invariante SESSION+SECTION+TURN",
            auto_open:      true
        }' >> "$LOG_DIR/audit.jsonl"
    echo "[invariante] Seção 'retomada' auto-criada para garantir SESSION+SECTION+TURN ativo" >&2
fi

# ── Checkpoint de estado do turno ────────────────────────────────────────────
CHECKPOINT_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/session-checkpoint.sh"
if [ -f "$CHECKPOINT_SCRIPT" ]; then
    bash "$CHECKPOINT_SCRIPT" 2> /dev/null || true
fi

# ── Sync automático de tarefas para DOCUMENTACAO/ (a cada 5 turnos) ──────────
TURN_COUNT_SYNC="$(jq -r '.session_stats.turn_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
SYNC_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/sync-tasks-to-docs.sh"
if [ -f "$SYNC_SCRIPT" ] && [ $((TURN_COUNT_SYNC % 5)) -eq 0 ] && [ "$TURN_COUNT_SYNC" -gt 0 ]; then
    bash "$SYNC_SCRIPT" 2> /dev/null || true
fi
