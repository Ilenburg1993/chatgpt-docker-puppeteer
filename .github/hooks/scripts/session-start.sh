#!/bin/bash
# session-start.sh — Hook sessionStart do Copilot (Schema v8)
# Executado quando o hook sessionStart dispara (tipicamente nova sessão/painel).
# Retomadas de chat existente normalmente geram novo TURN via userPromptSubmitted.
# Input JSON (stdin): {timestamp, cwd, source, initialPrompt}
# Output (stdout, fd 3): {"hookSpecificOutput": {"hookEventName": "SessionStart",
#   "additionalContext": "..."}} — injeta session-briefing.md condensado no LLM.
#
# Gera automaticamente .github/hooks/state/session-briefing.md com:
#   - Contagem de tarefas por prioridade
#   - Findings não resolvidos da sessão anterior
#   - Seção ativa, ID da sessão, close key
#   - Tendências históricas, saúde do sistema
# O briefing é injetado via additionalContext (acima) E disponível para leitura manual.
# Schema v8: section_id UUID na secão inicial, turn_id UUID no current_turn;
# Schema v7: turn_history[], recovery_hints{}, commit_history[], current_section.tools_by_name{},
#             current_section.intent_history[], current_section.failures_count, blocked_turns;
#             current_turn.intent_declared, current_turn.intent adicionados.
set -euo pipefail
# Redireciona stdout → stderr para output visual (banner, logs ao dev).
# O stdout original é preservado em fd 3 para a resposta JSON do hook
# (hookSpecificOutput.additionalContext — injetado automaticamente no LLM).
exec 3>&1 1>&2

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"

# Garante que os diretórios existem com permissões restritas
mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"
mkdir -p "$STATE_DIR"

# UPG-AUDIT-01: carrega helpers per-session de common.sh
# shellcheck disable=SC1091
if [ -f "$HOOK_DIR/hooks-lib/common.sh" ]; then
    source "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null || true
fi

# Núcleo crítico de lifecycle (F3.1)
# shellcheck disable=SC1091
if [ -f "$HOOK_DIR/hooks-lib/session-start-core.sh" ]; then
    source "$HOOK_DIR/hooks-lib/session-start-core.sh" 2> /dev/null || true
fi

# Blocos auxiliares de session-start (briefing/backlog/health/trends) em modo fail-open (F3.2)
# shellcheck disable=SC1091
if [ -f "$HOOK_DIR/hooks-lib/session-start-aux.sh" ]; then
    source "$HOOK_DIR/hooks-lib/session-start-aux.sh" 2> /dev/null || true
fi

# Lê runtime input de forma canônica (com fallback local)
if command -v resolve_hook_runtime_input > /dev/null 2>&1; then
    resolve_hook_runtime_input
else
    INPUT="$(cat 2> /dev/null || true)"
    TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
    SESSION_ID_PAYLOAD="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"
fi

# Extrai campos com fallback seguro
CWD="$(echo "$INPUT" | jq -r '.cwd // ""' 2> /dev/null || echo '')"
SOURCE="$(echo "$INPUT" | jq -r '.source // "new"' 2> /dev/null || echo 'new')"

# Classificação explícita do gatilho de sessionStart para auditoria posterior.
# Importante: sessionStart é evento de ciclo de sessão do Copilot (não evento de TURN).
SESSIONSTART_TRIGGER_KIND="new_chat_or_panel_activation"
case "$SOURCE" in
    inline_restart)
        SESSIONSTART_TRIGGER_KIND="inline_restart_same_logical_session"
        ;;
    reconnect_rollover)
        SESSIONSTART_TRIGGER_KIND="reconnect_rollover_or_heal"
        ;;
    manual_recovery)
        SESSIONSTART_TRIGGER_KIND="manual_recovery"
        ;;
esac

# session_id: usa o UUID real enviado pelo Copilot; fallback para timestamp-based
SESSION_ID_RAW="${SESSION_ID_PAYLOAD:-}"
if [ -z "$SESSION_ID_RAW" ]; then
    SESSION_ID_RAW="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"
fi
if [ -n "$SESSION_ID_RAW" ]; then
    SESSION_ID="$SESSION_ID_RAW"
else
    TS_NORM="$(echo "$TIMESTAMP" | sed 's/[^0-9]//g' | head -c 13)"
    SESSION_ID="sess_${TS_NORM:-$(date +%s%3N)}"
fi

SESSION_DATE="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo 'unknown')"
SESSION_DATE_SHORT="$(date -u '+%Y%m%d_%H%M%S' 2> /dev/null || echo 'unknown')"
: "${SESSION_DATE_SHORT}"

ctx_apply_expr_file() {
    local target_file="${1:-}"
    local expr="${2:-}"
    shift 2 || true

    [ -n "$target_file" ] || return 1
    [ -n "$expr" ] || return 1
    [ -f "$target_file" ] || return 1

    local _ctx_prev="${CTX_FILE:-}"
    CTX_FILE="$target_file"

    if command -v ctx_apply_jq_expr_best_effort > /dev/null 2>&1; then
        ctx_apply_jq_expr_best_effort "$expr" "$@" > /dev/null 2>&1 || true
    elif command -v sponge > /dev/null 2>&1; then
        jq "$@" "$expr" "$target_file" | sponge "$target_file" 2> /dev/null || true
    else
        local _tmp_ctx
        if _tmp_ctx="$(mktemp 2> /dev/null)"; then
            if jq "$@" "$expr" "$target_file" > "$_tmp_ctx" 2> /dev/null; then
                mv "$_tmp_ctx" "$target_file" 2> /dev/null || rm -f "$_tmp_ctx"
            else
                rm -f "$_tmp_ctx"
            fi
        fi
    fi

    CTX_FILE="$_ctx_prev"
    return 0
}

# UPG-AUDIT-01: caminhos per-session (calculados logo que SESSION_ID é conhecido)
SID_SHORT="${SESSION_ID:0:8}"
PER_CTX_FILE="${STATE_DIR}/session-context-${SID_SHORT}.json"
PER_AUDIT_FILE="${LOG_DIR}/audit-${SID_SHORT}.jsonl"

# ── Lê valores de conformidade da sessão anterior ANTES de sobrescrever ──────
# CRÍTICO: session-context.json é sobrescrito logo abaixo; precisamos dos dados
# anteriores *agora* para preservar o contador de violações consecutivas.
PREV_CONSEC_UNAUTH=0
# Hardening v5.1: captura dados da sessão anterior ANTES de sobrescrever o contexto.
# Estes dados são usados como fallback para o alerta de violação quando o flag file não existe
# (caso em que v5.0 silenciava o encerramento incorreto sem nenhuma informação ao usuário).
PREV_SESSION_ID_FROM_CTX=""
PREV_LAST_TURN_TS_FROM_CTX=""
PREV_TURN_NUMBER_FROM_CTX=0
if [ -f "$STATE_DIR/session-context.json" ] && [ -s "$STATE_DIR/session-context.json" ]; then
    # Suporta schema v2 (.compliance.consecutive_unauthorized) e legado
    # -s verifica se o arquivo tem conteúdo (não é vazio / 0 bytes)
    _raw="$(jq -r '
        .compliance.consecutive_unauthorized //
        .consecutive_unauthorized_closes //
        0' "$STATE_DIR/session-context.json" 2> /dev/null || echo 0)"
    # Garante que o valor é numérico; fallback para 0 se vazio ou inválido
    if [[ "$_raw" =~ ^[0-9]+$ ]]; then
        PREV_CONSEC_UNAUTH="$_raw"
    fi
    # Captura identificadores da sessão anterior (para alerta de violação sem flag file)
    PREV_SESSION_ID_FROM_CTX="$(jq -r '.session.id // ""' "$STATE_DIR/session-context.json" 2> /dev/null || echo '')"
    PREV_LAST_TURN_TS_FROM_CTX="$(jq -r '.last_turn_ts // ""' "$STATE_DIR/session-context.json" 2> /dev/null || echo '')"
    PREV_TURN_NUMBER_FROM_CTX="$(jq -r '.current_turn.number // 0' "$STATE_DIR/session-context.json" 2> /dev/null || echo 0)"
fi

# ── Watchdog: verifica estado anterior antes de sobrescrever ─────────────────
# Detecta sessões estagnadas, flags órfãos e context corrompido.
# Roda em modo silencioso (só salva watchdog-report.json); output vai p/ stderr.
if [ -x "$HOOK_DIR/scripts/watchdog.sh" ]; then
    bash "$HOOK_DIR/scripts/watchdog.sh" --quiet 2> /dev/null || true
fi

# ── Auto-rotação de audit.jsonl (antes de queries) ───────────────────────────
# Rotaciona automaticamente se audit.jsonl ultrapassar 5000 linhas.
# Preserva as últimas 500 linhas no arquivo ativo para queries de sessão atual.
# Arquivo histórico salvo em logs/audit-YYYYMMDD_HHMMSS.jsonl.
if [ -x "$HOOK_DIR/scripts/rotate-audit.sh" ]; then
    bash "$HOOK_DIR/scripts/rotate-audit.sh" 2> /dev/null || true
fi

# ── Gera SESSION CLOSE KEY — Schema v3 ───────────────────────────────────────
# Chave dinâmica por sessão: ENCERRAR-XXXXXXXX (8 hex maiúsculos aleatórios)
# O usuário DEVE digitar esta chave ao encerrar a sessão (vscode_askQuestions).
# Detectada por post-tool-use.sh; validada por session-end.sh.
# BUG-35 fix: fallback usa PID+nanosegundos para unicidade (evita colisão same-second)
CLOSE_KEY="ENCERRAR-$(openssl rand -hex 4 2> /dev/null | tr '[:lower:]' '[:upper:]' || printf '%s%s' "$(date +%s%N 2> /dev/null || date +%s)" "$$" | sha256sum | head -c 8 | tr '[:lower:]' '[:upper:]')"

# Inicializa variáveis de Nível 1 (DETECT) que serão calculas após Recovery
PREV_CLOSE_MODE="ok"
PREV_RECONNECT_COUNT=0
PREV_SESSION_ID=""
PREV_CHECKPOINT_TS=""
RECOVERY_ALERTS=()
RECOVERY_ALERTS_REQUIRE_KICKOFF="false"
_ALERTS_JSON="[]"

# Gera IDs UUID para a secão e turno iniciais
INITIAL_SECTION_ID="$(uuidgen 2> /dev/null || printf 'sect_%s_%s' "$(date +%s)" "$$")"
INITIAL_TURN_ID="$(uuidgen 2> /dev/null || printf 'turn_%s_%s' "$(date +%s)" "$$")"
: "${INITIAL_TURN_ID}"

# UPG-01: Calcula o número da sessão lógica
# logical_session_number increments on every "new" sessionStart (not inline_restart).
# Preserved as-is on inline_restart since that is a continuation of the same logical session.
if ! session_start_compute_logical_session_number "$STATE_DIR" "$SOURCE"; then
    LOGICAL_SESSION_NUMBER=1
fi

# ── Persiste contexto inicial — Schema v4 (layered) ──────────────────────────
# Estrutura em 6 blocos separados por âmbito:
#   session       → imutável após sessionStart (identidade da sessão)
#   session_stats → acumuladores agregados ao longo de todos os turnos
#   current_turn  → estado do turno ATUAL (resetado a cada agentStop)
#   current_section → seção temática ativa (sempre >= 1 ativa — invariante Schema v4)
#   last_tool     → metadados do último tool call (sobrescrito a cada preToolUse)
#   compliance    → estado do protocolo de autorização
session_start_persist_initial_context || true

# UPG-AUDIT-01: garante que CTX_FILE e AUDIT_FILE apontam para os per-session files
CTX_FILE="$PER_CTX_FILE"
AUDIT_FILE="$PER_AUDIT_FILE"
touch "$AUDIT_FILE" 2> /dev/null || true

# BUG-A.2: Limpa contador de mismatches de sessões anteriores (HEAL v2).
# .mismatch_track.json contém estado do contador de sessão id mismatch.
# Não limpar causaria que o HEAL v2 herde contagem de sessão anterior,
# podendo disparar ou suprimir heals incorretamente na nova sessão.
rm -f "$STATE_DIR/.mismatch_track.json" 2> /dev/null || true

# ── Recovery: detecta sessão anterior via último checkpoint ─────────────────
CHECKPOINT_DIR="$HOOK_DIR/checkpoints"
PREV_CHECKPOINT=""
PREV_SESSION_ID=""
PREV_TURN_COUNT=0
PREV_TASKS_OPEN=0

# Busca o checkpoint mais recente de qualquer sessão anterior.
# P0-HOOKS: ignora artefatos sintéticos de teste e checkpoints com timestamp
# no futuro para evitar falsos positivos de recovery (abrupt_no_key indevido).
if [ -d "$CHECKPOINT_DIR" ]; then
    while IFS= read -r _CP_FILE; do
        [ -z "$_CP_FILE" ] && continue

        _CP_BASENAME="$(basename "$_CP_FILE" 2> /dev/null || echo '')"
        _CP_SESSION_ID="$(jq -r '.session_id // ""' "$_CP_FILE" 2> /dev/null || echo '')"
        _CP_CHECKPOINT_TS="$(jq -r '.checkpoint_ts // ""' "$_CP_FILE" 2> /dev/null || echo '')"
        _CP_SKIP_REASON=""

        # Artefato sintético de testes (ex.: sess_test123_turn10.json)
        case "$_CP_BASENAME" in
            sess_test*) _CP_SKIP_REASON="synthetic_test_checkpoint" ;;
        esac

        # Segurança: checkpoint sem session_id válido não participa do recovery
        if [ -z "$_CP_SKIP_REASON" ] && [ -z "$_CP_SESSION_ID" ]; then
            _CP_SKIP_REASON="missing_session_id"
        fi

        # Segurança: ignora checkpoint datado no futuro (clock skew/fixture)
        if [ -z "$_CP_SKIP_REASON" ] && [ -n "$_CP_CHECKPOINT_TS" ]; then
            _NOW_EPOCH="$(date -u +%s 2> /dev/null || echo 0)"
            _CP_EPOCH="$(date -u -d "$_CP_CHECKPOINT_TS" +%s 2> /dev/null || echo '')"
            if [ -n "$_CP_EPOCH" ] && [ "$_CP_EPOCH" -gt $((_NOW_EPOCH + 300)) ]; then
                _CP_SKIP_REASON="future_checkpoint_ts"
            fi
        fi

        if [ -n "$_CP_SKIP_REASON" ]; then
            jq -cn \
                --arg event "recovery_checkpoint_ignored" \
                --arg sid "$SESSION_ID" \
                --arg ts "${TIMESTAMP:-$SESSION_DATE}" \
                --arg file "$_CP_BASENAME" \
                --arg reason "$_CP_SKIP_REASON" \
                --arg prev_sid "$_CP_SESSION_ID" \
                '{
                    event: $event,
                    session_id: $sid,
                    timestamp: $ts,
                    checkpoint_file: $file,
                    reason: $reason,
                    ignored_session_id: $prev_sid
                }' >> "$AUDIT_FILE" 2> /dev/null || true
            continue
        fi

        PREV_CHECKPOINT="$_CP_FILE"
        break
    done < <(find "$CHECKPOINT_DIR" -maxdepth 1 -name 'sess_*_turn*.json' -printf '%T@ %p\n' 2> /dev/null | sort -rn | cut -d' ' -f2-)
fi

if [ -n "$PREV_CHECKPOINT" ] && [ -f "$PREV_CHECKPOINT" ]; then
    PREV_SESSION_ID="$(jq -r '.session_id // ""' "$PREV_CHECKPOINT" 2> /dev/null || echo '')"
    PREV_TURN_COUNT="$(jq -r '.turn_count // 0' "$PREV_CHECKPOINT" 2> /dev/null || echo 0)"
    PREV_TASKS_OPEN="$(jq -r '.tasks.open_total // 0' "$PREV_CHECKPOINT" 2> /dev/null || echo 0)"
    PREV_CHECKPOINT_TS="$(jq -r '.checkpoint_ts // ""' "$PREV_CHECKPOINT" 2> /dev/null || echo '')"
    # Lê close_key_validated do checkpoint para categorização de encerramento
    PREV_CLOSE_KEY_VALIDATED="$(jq -r '.session.close_key_validated // false' "$PREV_CHECKPOINT" 2> /dev/null || echo false)"
fi

# Detecção de encerramento abrupto: sessão anterior sem sessionEnd nem sessionCloseAuthorized
# Nota: o evento `sessionEnd` da plataforma VS Code Copilot não dispara quando a
# sessão termina abruptamente (crash/restart/timeout). O mecanismo correto de
# encerramento é o fluxo automático via post-tool-use após validação da KEY no
# vscode_askQuestions (Template F), que aciona session-close.sh e session-end.sh.
# Encerramento limpo = `sessionEnd` OR `sessionCloseAuthorized` com o session_id correto.
PREV_ABRUPT_CLOSE=false
if [ -n "$PREV_SESSION_ID" ] && [ "$PREV_SESSION_ID" != "$SESSION_ID" ]; then
    # UPG-AUDIT-01: usa arquivo per-session da sessão anterior (não o symlink atualizado)
    _PREV_SID_SHORT="${PREV_SESSION_ID:0:8}"
    _AUDIT_TMP="${LOG_DIR}/audit-${_PREV_SID_SHORT}.jsonl"
    [ -f "$_AUDIT_TMP" ] || _AUDIT_TMP="$LOG_DIR/audit.jsonl"
    _FOUND_SESSION_END=false
    # Verifica arquivo per-session da sessão anterior
    if [ -f "$_AUDIT_TMP" ] && jq -s -e --arg sid "$PREV_SESSION_ID" \
        'any(.[]; ((.event == "sessionEnd" or .event == "sessionCloseAuthorized") and ((.session_id // "") == $sid)))' \
        "$_AUDIT_TMP" > /dev/null 2> /dev/null; then
        _FOUND_SESSION_END=true
    fi
    # Se não encontrou, verifica outros arquivos per-session excluindo o atual (após rotação)
    if [ "$_FOUND_SESSION_END" = "false" ]; then
        _LATEST_ARCHIVE="$(find "$LOG_DIR" -maxdepth 1 -name 'audit-????????.jsonl' \
            ! -name "audit-${SID_SHORT}.jsonl" \
            -printf '%T@ %p\n' 2> /dev/null | sort -rn | head -1 | cut -d' ' -f2- || true)"
        if [ -n "$_LATEST_ARCHIVE" ] && [ -f "$_LATEST_ARCHIVE" ] \
            && jq -s -e --arg sid "$PREV_SESSION_ID" \
                'any(.[]; ((.event == "sessionEnd" or .event == "sessionCloseAuthorized") and ((.session_id // "") == $sid)))' \
                "$_LATEST_ARCHIVE" > /dev/null 2> /dev/null; then
            _FOUND_SESSION_END=true
        fi
    fi
    # Verifica também SESSION_CLOSE_AUTHORIZED.flag (gerado por session-close.sh)
    _AUTH_FLAG="$STATE_DIR/SESSION_CLOSE_AUTHORIZED.flag"
    if [ "$_FOUND_SESSION_END" = "false" ] && [ -f "$_AUTH_FLAG" ]; then
        _FLAG_SID="$(jq -r '.session_id // ""' "$_AUTH_FLAG" 2> /dev/null || echo '')"
        if [ "$_FLAG_SID" = "$PREV_SESSION_ID" ]; then
            _FOUND_SESSION_END=true
        fi
    fi
    [ "$_FOUND_SESSION_END" = "false" ] && PREV_ABRUPT_CLOSE=true
fi
# Categoriza o modo de encerramento da sessão anterior:
#   clean             → sessionCloseAuthorized encontrado OU SESSION_CLOSE_AUTHORIZED.flag OK
#   key_validated     → close_key_validated=true no checkpoint mas session-close.sh não executado
#   abrupt_no_key     → encerramento sem KEY (crash/timeout/restart)
#   abrupt_reconnect  → sessionEnd sintético gerado por rollover de reconexão (log-prompt.sh)
#   ok                → nenhuma sessão anterior detectada
PREV_CLOSE_MODE="ok"
PREV_RECONNECT_COUNT=0
if [ "$PREV_ABRUPT_CLOSE" = "true" ]; then
    if [ "$PREV_CLOSE_KEY_VALIDATED" = "true" ]; then
        PREV_CLOSE_MODE="key_validated"
    else
        PREV_CLOSE_MODE="abrupt_no_key"
    fi
elif [ -n "$PREV_SESSION_ID" ] && [ "$PREV_SESSION_ID" != "$SESSION_ID" ]; then
    PREV_CLOSE_MODE="clean"
    # RECONNECT-01: verifica se o encerramento foi via rollover de reconexão
    # (sessionEnd sintético com close_mode:abrupt_reconnect gerado por log-prompt.sh)
    # UPG-AUDIT-01: usa arquivo per-session da sessão anterior (não symlink atualizado)
    _AUDIT_TMP="${LOG_DIR}/audit-${_PREV_SID_SHORT:-${PREV_SESSION_ID:0:8}}.jsonl"
    [ -f "$_AUDIT_TMP" ] || _AUDIT_TMP="$LOG_DIR/audit.jsonl"
    if [ -f "$_AUDIT_TMP" ] && grep -q '"sessionReconnect"' "$_AUDIT_TMP" 2> /dev/null \
        && grep '"sessionReconnect"' "$_AUDIT_TMP" 2> /dev/null | grep -q "$PREV_SESSION_ID"; then
        PREV_CLOSE_MODE="abrupt_reconnect"
        # Conta quantas reconexões ocorreram na sessão anterior
        PREV_RECONNECT_COUNT="$(grep '"sessionReconnect"' "$_AUDIT_TMP" 2> /dev/null \
            | grep "$PREV_SESSION_ID" | wc -l | tr -d ' ' || echo 0)"
    fi
fi
# Remove flag de autorização após leitura (evita falsos negativos em sessões futuras)
if [ -f "$STATE_DIR/SESSION_CLOSE_AUTHORIZED.flag" ]; then
    _AUTH_SID="$(jq -r '.session_id // ""' "$STATE_DIR/SESSION_CLOSE_AUTHORIZED.flag" 2> /dev/null || echo '')"
    if [ -n "$_AUTH_SID" ] && [ "$_AUTH_SID" != "$SESSION_ID" ]; then
        rm -f "$STATE_DIR/SESSION_CLOSE_AUTHORIZED.flag" 2> /dev/null || true
    fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Nível 1 (DETECT): Anomaly Detection — gera alerts baseado no close_mode
# ─────────────────────────────────────────────────────────────────────────────
# PREV_CLOSE_MODE foi determinado na seção "Recovery" acima. Agora criamos os
# arrays de alertas correspondentes para o contexto de sessão.
RECOVERY_ALERTS=()
RECOVERY_ALERTS_REQUIRE_KICKOFF="false"

case "$PREV_CLOSE_MODE" in
    abrupt_no_key)
        RECOVERY_ALERTS+=("🚨 ANOMALY DETECTED: Previous session ended WITHOUT close-key authorization")
        RECOVERY_ALERTS+=("REASON: Either crash, timeout, or unauthorized closure attempt (BUG-79 pattern)")
        RECOVERY_ALERTS+=("IMPACT: Agent cannot resume from exact previous state; some context may be lost")
        RECOVERY_ALERTS+=("ACTION: Will require Template E+ (Multi-Decision Checkpoint) before proceeding")
        RECOVERY_ALERTS_REQUIRE_KICKOFF="true"
        ;;
    key_validated)
        RECOVERY_ALERTS+=("⚠️  WARNING: Previous session had close_key validated but session-close.sh incomplete")
        RECOVERY_ALERTS+=("REASON: BUG-80 pattern — key validation ordered incorrectly")
        RECOVERY_ALERTS+=("IMPACT: Session may have been marked authorized but final shutdown did not occur")
        RECOVERY_ALERTS+=("ACTION: Proceeding normally but monitoring for re-occurrence")
        RECOVERY_ALERTS_REQUIRE_KICKOFF="false"
        ;;
    abrupt_reconnect)
        RECOVERY_ALERTS+=("ℹ️   INFO: Previous session ended via network reconnection (${PREV_RECONNECT_COUNT} reconnects detected)")
        RECOVERY_ALERTS+=("REASON: Normal expected behavior during VS Code connection loss")
        RECOVERY_ALERTS+=("IMPACT: Context preserved automatically by inline_restart mechanism")
        RECOVERY_ALERTS+=("ACTION: No special action required — informational only")
        RECOVERY_ALERTS_REQUIRE_KICKOFF="false"
        ;;
    clean)
        # Clean closure — no alerts needed
        RECOVERY_ALERTS_REQUIRE_KICKOFF="false"
        ;;
    ok)
        # No previous session detected
        RECOVERY_ALERTS_REQUIRE_KICKOFF="false"
        ;;
esac

# Converte array bash em JSON array para jq
_ALERTS_JSON="[]"
if [ ${#RECOVERY_ALERTS[@]} -gt 0 ]; then
    _ALERTS_JSON="$(printf '%s\n' "${RECOVERY_ALERTS[@]}" \
        | jq -R '.' | jq -s '.' 2> /dev/null || echo '[]')"
fi

# Persistência tardia do bloco recovery:
# o contexto-base é criado antes da etapa de Recovery por motivos históricos,
# portanto atualizamos o objeto .recovery aqui com os valores efetivamente detectados.
_RECOVERY_TARGET_FILE="$PER_CTX_FILE"
if [ -f "$_RECOVERY_TARGET_FILE" ] && command -v jq &> /dev/null; then
    _RECOVERY_TS="${TIMESTAMP:-$SESSION_DATE}"
    if ctx_apply_expr_file \
        "$_RECOVERY_TARGET_FILE" \
        '.recovery = ((.recovery // {}) + {
            close_mode: $close_mode,
            prev_session_id: $prev_sid,
            prev_session_ts: $prev_ts,
            alerts: $alerts,
            alerts_require_kickoff: ($alerts_req == "true"),
            detected_at: $detected_at
        })' \
        --arg close_mode "${PREV_CLOSE_MODE:-ok}" \
        --arg prev_sid "${PREV_SESSION_ID:-}" \
        --arg prev_ts "${PREV_CHECKPOINT_TS:-}" \
        --arg detected_at "$_RECOVERY_TS" \
        --arg alerts_req "$RECOVERY_ALERTS_REQUIRE_KICKOFF" \
        --argjson alerts "$_ALERTS_JSON"; then
        :
    fi
fi

# ── Loga sessionStart canônico + sectionStart inicial ────────────────────────
jq -cn \
    --arg event "sessionStart" \
    --arg sid "$SESSION_ID" \
    --arg ts "${TIMESTAMP:-$SESSION_DATE}" \
    --arg source "$SOURCE" \
    --arg trigger_kind "$SESSIONSTART_TRIGGER_KIND" \
    --arg cwd "$CWD" \
    --arg close_key "$CLOSE_KEY" \
    --arg section_id "$INITIAL_SECTION_ID" \
    --argjson logical_num "$LOGICAL_SESSION_NUMBER" \
    '{
        event: $event,
        session_id: $sid,
        timestamp: $ts,
        source: $source,
        trigger_kind: $trigger_kind,
        semantic_note: "sessionStart representa abertura/reativacao de sessao, nao inicio de TURN",
        cwd: $cwd,
        close_key: $close_key,
        section_id: $section_id,
        logical_session_number: $logical_num,
        message: "Hook sessionStart processado — sessão inicializada"
    }' >> "$AUDIT_FILE"

# ── Loga sectionStart da section padrão "início" (Schema v4 — invariante) ────
jq -cn \
    --arg event "sectionStart" \
    --arg sid "$SESSION_ID" \
    --arg ts "$TIMESTAMP" \
    --arg name "início" \
    --arg section_id "$INITIAL_SECTION_ID" \
    '{event: $event, session_id: $sid, timestamp: $ts, section_name: $name,
      section_id: $section_id,
      section_number: 1, turn_number: 1, description: null, prev_section: null,
      auto_open: true}' \
    >> "$AUDIT_FILE"

# ─────────────────────────────────────────────────────────────
# Gera session-briefing.md — lido pelo LLM no início da sessão
# ─────────────────────────────────────────────────────────────
TASKS_FILE="$STATE_DIR/pending-tasks.md"
FINDINGS_FILE="$LOG_DIR/findings.jsonl"
BRIEFING_FILE="$STATE_DIR/session-briefing.md"

# Conta tarefas/findings (bloco auxiliar, fail-open)
COUNT_ALTA=0
COUNT_MEDIA=0
COUNT_BACKLOG=0
NEXT_TASK=""
OPEN_FINDINGS=0
CRITICAL_FINDINGS=0
TOTAL_OPEN=0
run_aux_block "session-start:backlog-findings" "${HOOKS_AUX_TIMEOUT_S:-5}" \
    session_start_collect_backlog_and_findings "$TASKS_FILE" "$FINDINGS_FILE" > /dev/null 2>&1 || true

# ─────────────────────────────────────────────────────────────
# Análise de tendências históricas (bloco auxiliar, fail-open)
# ─────────────────────────────────────────────────────────────
TREND_SESSIONS="N/D"
TREND_TOTAL_TOOLS="N/D"
TREND_ERROR_RATE="N/D"
TREND_TOP_TOOLS_TABLE=""
TREND_TOP_FAILURES="- (nenhuma falha registrada)"
TREND_PERF_TABLE=""
run_aux_block "session-start:trends" "${HOOKS_AUX_TIMEOUT_S:-5}" \
    session_start_compute_trends > /dev/null 2>&1 || true

# ── UP3: Health check do ambiente (bloco auxiliar, fail-open) ──────────────
HEALTH_CRITICAL=""
HEALTH_WARNINGS=""
HEALTH_STATUS="✅ Sistema operacional"
NET_CHECK_HOST="${HEALTH_CHECK_HOST:-140.82.112.22}"
NET_OK=false
RECENT_RECONNECT_COUNT=0
run_aux_block "session-start:health" "${HOOKS_AUX_TIMEOUT_S:-5}" \
    session_start_compute_health > /dev/null 2>&1 || true

# ── Verifica violação de autorização da sessão anterior ────────────────────
# G9-03: Flag de sessão diferente (obsoleto) é removido automaticamente com audit.
AUTH_FLAG_FILE="$STATE_DIR/UNAUTHORIZED_CLOSE.flag"
PREV_UNAUTH_CLOSE=false
PREV_UNAUTH_FLAG_STALE=false
PREV_UNAUTH_TS=""
PREV_UNAUTH_SID=""
PREV_UNAUTH_TURN=0
CONSECUTIVE_VIOLATIONS=0

if [ -f "$AUTH_FLAG_FILE" ]; then
    PREV_UNAUTH_TS="$(jq -r '.timestamp // ""' "$AUTH_FLAG_FILE" 2> /dev/null || echo '')"
    PREV_UNAUTH_SID="$(jq -r '.session_id // ""' "$AUTH_FLAG_FILE" 2> /dev/null || echo '')"
    PREV_UNAUTH_TURN="$(jq -r '.turn_count // 0' "$AUTH_FLAG_FILE" 2> /dev/null || echo 0)"

    # G9-03: Se o flag é de uma sessão diferente da atual, é obsoleto (stale).
    # Remove-o imediatamente com auditoria e não propaga o contador de violações.
    if [ -n "$PREV_UNAUTH_SID" ] && [ "$PREV_UNAUTH_SID" != "$SESSION_ID" ]; then
        PREV_UNAUTH_FLAG_STALE=true
        PREV_UNAUTH_CLOSE=true # ainda exibe informação leve no briefing
        rm -f "$AUTH_FLAG_FILE" 2> /dev/null || true
        jq -cn \
            --arg event "authViolation_stale_cleared" \
            --arg new_sid "$SESSION_ID" \
            --arg old_sid "$PREV_UNAUTH_SID" \
            --arg ts "${TIMESTAMP:-$SESSION_DATE}" \
            --arg flag_ts "$PREV_UNAUTH_TS" \
            '{
                event:       $event,
                session_id:  $new_sid,
                timestamp:   $ts,
                old_session_id: $old_sid,
                flag_timestamp: $flag_ts,
                message:     "Flag UNAUTHORIZED_CLOSE de sessão diferente removido automaticamente"
            }' >> "$AUDIT_FILE" 2> /dev/null || true
        # Stale: não acumula consecutive_unauthorized na nova sessão
        PREV_CONSEC_UNAUTH=0
    else
        PREV_UNAUTH_CLOSE=true
    fi
fi

# ── Hardening v5.1: fallback de violação quando não há UNAUTHORIZED_CLOSE.flag ────
# Em v5.0, o flag era removido silenciosamente no TURN não-autorizado.
# Este fallback garante que mesmo sem o flag, o alerta de violação aparece no briefing
# se compliance.consecutive_unauthorized > 0 foi carregado da sessão anterior.
if [ "$PREV_UNAUTH_CLOSE" = "false" ] && [ "${PREV_CONSEC_UNAUTH:-0}" -gt 0 ]; then
    PREV_UNAUTH_CLOSE=true
    PREV_UNAUTH_FLAG_STALE=false
    # Usa dados capturados antes da sobrescrita do contexto
    PREV_UNAUTH_SID="${PREV_SESSION_ID_FROM_CTX:-${PREV_SESSION_ID:-sessão anterior}}"
    PREV_UNAUTH_TS="${PREV_LAST_TURN_TS_FROM_CTX:-desconhecido}"
    PREV_UNAUTH_TURN="${PREV_TURN_NUMBER_FROM_CTX:-0}"
    jq -cn \
        --arg event "authViolation_detected_ctx_fallback" \
        --arg new_sid "$SESSION_ID" \
        --arg old_sid "$PREV_UNAUTH_SID" \
        --arg ts "${TIMESTAMP:-$SESSION_DATE}" \
        --argjson consec "${PREV_CONSEC_UNAUTH:-0}" \
        '{
            event:                    $event,
            session_id:               $new_sid,
            timestamp:                $ts,
            old_session_id:           $old_sid,
            consecutive_unauthorized: $consec,
            message:                  "Violação detectada via ctx fallback (sem flag file) — hardening v5.1"
        }' >> "$AUDIT_FILE" 2> /dev/null || true
fi

# ── Verifica encerramento sem SESSION CLOSE KEY ─────────────────────────────
NO_KEY_FLAG_FILE="$STATE_DIR/SESSION_CLOSE_NO_KEY.flag"
PREV_NO_KEY_CLOSE=false
PREV_NO_KEY_TS=""
PREV_NO_KEY_SID=""
PREV_NO_KEY_TURNS=0
PREV_NO_KEY_FLAG_STALE=false

if [ -f "$NO_KEY_FLAG_FILE" ]; then
    PREV_NO_KEY_CLOSE=true
    PREV_NO_KEY_TS="$(jq -r '.timestamp // ""' "$NO_KEY_FLAG_FILE" 2> /dev/null || echo '')"
    PREV_NO_KEY_SID="$(jq -r '.session_id // ""' "$NO_KEY_FLAG_FILE" 2> /dev/null || echo '')"
    PREV_NO_KEY_TURNS="$(jq -r '.turn_count // 0' "$NO_KEY_FLAG_FILE" 2> /dev/null || echo 0)"

    # Hardening: ignora artefatos sintéticos e remove flag stale automaticamente.
    case "$PREV_NO_KEY_SID" in
        "")
            PREV_NO_KEY_FLAG_STALE=true
            ;;
        sess_test*)
            PREV_NO_KEY_FLAG_STALE=true
            ;;
    esac

    if [ "$PREV_NO_KEY_FLAG_STALE" = "true" ]; then
        PREV_NO_KEY_CLOSE=false
        jq -cn \
            --arg event "session_no_key_flag_stale_cleared" \
            --arg sid "$SESSION_ID" \
            --arg ts "${TIMESTAMP:-$SESSION_DATE}" \
            --arg old_sid "$PREV_NO_KEY_SID" \
            --arg flag_ts "$PREV_NO_KEY_TS" \
            '{
                event: $event,
                session_id: $sid,
                timestamp: $ts,
                stale_session_id: $old_sid,
                stale_flag_timestamp: $flag_ts,
                message: "SESSION_CLOSE_NO_KEY.flag sintético/stale removido automaticamente"
            }' >> "$AUDIT_FILE" 2> /dev/null || true
        rm -f "$NO_KEY_FLAG_FILE" 2> /dev/null || true
    else
        # One-shot: consome a flag após leitura para evitar vazamento de alerta
        # em sessões futuras não relacionadas.
        jq -cn \
            --arg event "session_no_key_flag_consumed" \
            --arg sid "$SESSION_ID" \
            --arg ts "${TIMESTAMP:-$SESSION_DATE}" \
            --arg old_sid "$PREV_NO_KEY_SID" \
            --arg flag_ts "$PREV_NO_KEY_TS" \
            ' {
                event: $event,
                session_id: $sid,
                timestamp: $ts,
                previous_session_id: $old_sid,
                previous_timestamp: $flag_ts,
                message: "SESSION_CLOSE_NO_KEY.flag consumido (one-shot)"
            }' >> "$AUDIT_FILE" 2> /dev/null || true
        rm -f "$NO_KEY_FLAG_FILE" 2> /dev/null || true
    fi
fi

# Conta violações consecutivas — preservado da sessão anterior em PREV_CONSEC_UNAUTH
# e já gravado em compliance.consecutive_unauthorized do novo session-context.json.
CONSECUTIVE_VIOLATIONS="$PREV_CONSEC_UNAUTH"

# M3: escalona nível de alerta com base em violações consecutivas acumuladas
if [ "${CONSECUTIVE_VIOLATIONS}" -ge 3 ] 2> /dev/null; then
    VIOLATION_EMOJIS="⛔⛔⛔"
    VIOLATION_LEVEL="VIOLAÇÃO CRÍTICA REITERADA (${CONSECUTIVE_VIOLATIONS}x consecutivas)"
elif [ "${CONSECUTIVE_VIOLATIONS}" -ge 2 ] 2> /dev/null; then
    VIOLATION_EMOJIS="⛔⛔"
    VIOLATION_LEVEL="SEGUNDA VIOLAÇÃO CONSECUTIVA"
else
    VIOLATION_EMOJIS="⛔"
    VIOLATION_LEVEL="AVISO DE VIOLAÇÃO"
fi

# Escreve o briefing
cat > "$BRIEFING_FILE" << BRIEFING_EOF
# Briefing de Sessão — ${SESSION_DATE}

> **Para o agente de IA:** Este arquivo é gerado automaticamente pelo hook \`sessionStart\`.
> Leia-o como primeiro ato de toda sessão, antes de qualquer ação.
> Após lê-lo, **invoque \`vscode_askQuestions\`** com o Template E (Session Kickoff)
> para definir com o usuário o rumo desta sessão.

---

## ╔══ PROTOCOLO DE ENCERRAMENTO — LEITURA OBRIGATÓRIA ══╗

> **SESSION ≠ SECTION ≠ TURN — distinção crítica para o agente LLM**

| Conceito    | Encerra como?                           | Autorização    |
|-------------|------------------------------------------|----------------|
| **TURN**    | Com \`vscode_askQuestions\` como último ato | **OBRIGATÓRIA** |
| **SECTION** | \`bash start-section.sh "nome"\` (autônomo)| **Nenhuma**    |
| **SESSION** | Template F + KEY digitada + execução automática de \`session-close.sh\` | **OBRIGATÓRIA**|

> ⚠️ **Terminar de escrever uma resposta = encerrar um TURN, NÃO a SESSION.**
> A SESSION só encerra quando o usuário explicitamente digita a chave abaixo.

---

## 🚨 INSTRUÇÕES CRÍTICAS PARA O AGENTE COPILOT (BUG-79 Hardening)

### ❌ **NUNCA faça isto:**
- Tentar encerrar a SESSION diretamente (sem Template F)
- Assumir que pode fechar porque tem acesso ao close_key abaixo
- Contornar o protocolo de encerramento por qualquer motivo (token budget baixo, etc)
- Resumir e "encerrar conversa" implicitamente

### ✅ **FAÇA isto quando a SESSION deve encerrar:**

1. **Invoque \`vscode_askQuestions\`** com **TEMPLATE F** (Session Close)
   - Não use outro template
   - Inclua instrução clara: "Digite a chave de encerramento:"

2. **Aguarde a resposta do usuário**
   - O usuário digitará a chave 16 hex abaixo (ENCERRAR-XXXXXXXX)

3. **Deixe post-tool-use.sh executar session-close.sh** automaticamente
   - Não tente chamar session-close.sh você mesmo (hooks fazem isto)

4. **Apenas após tudo isto: a SESSION encerrará**
   - Nunca antes. Sempre com autorização do usuário

### 💡 **Se o token budget ficar baixo:**
- **NÃO encerre a SESSION**
- Invoque Template D (Checkpoint) para avisar o usuário
- Deixe o usuário decidir se continua ou se encerra a SESSION
- O agente não toma decisões autônomas de encerramento

### 📋 **Referência rápida:**
- **Encerrar SESSION**: \`vscode_askQuestions\` Template F + KEY + execução automática em \`post-tool-use.sh\`
- **Avisar sobre token budget**: \`vscode_askQuestions\` Template D (Checkpoint)
- **Trocar de fase**: \`bash start-section.sh "nome-nova-fase"\`
- **Terminar TURN**: obrigatório chamar \`vscode_askQuestions\` como último ato do turno

---


### 🔐 Chave desta SESSION (mostrar no Template F):
\`\`\`
${CLOSE_KEY}
\`\`\`

### Fluxo de encerramento de SESSION (3 etapas obrigatórias):
1. Agente chama \`vscode_askQuestions\` com **Template F** (exibe a chave acima)
2. Usuário digita a chave \`${CLOSE_KEY}\` no campo livre
3. \`post-tool-use.sh\` valida a chave e executa \`session-close.sh\` automaticamente

---

BRIEFING_EOF

# Injeta aviso de violação NO TOPO do briefing, se houver (nível escalona com CONSECUTIVE_VIOLATIONS)
if [ "$PREV_UNAUTH_CLOSE" = "true" ]; then
    if [ "$PREV_UNAUTH_FLAG_STALE" = "true" ]; then
        # G9-03: Flag obsoleto (de outra sessão) — apenas informativo; flag já foi removido
        cat >> "$BRIEFING_FILE" << STALE_VIOLATION_EOF

---

## ℹ️ Nota informativa — Violação registrada em sessão anterior

> A sessão **\`${PREV_UNAUTH_SID}\`** encerrou sem autorização (\`vscode_askQuestions\` ausente).
> O flag foi **removido automaticamente** pois pertence a uma sessão diferente.
> Esta sessão começa com contador de violações zerado.
>
> - **Sessão violadora**: \`${PREV_UNAUTH_SID}\`
> - **Horário**: \`${PREV_UNAUTH_TS}\`
> - **Turno**: \`${PREV_UNAUTH_TURN}\`

---

STALE_VIOLATION_EOF
    else
        # Flag da sessão atual (raro, mas possível): alerta crítico completo
        cat >> "$BRIEFING_FILE" << VIOLATION_EOF

---

## ${VIOLATION_EMOJIS} ${VIOLATION_LEVEL} — AÇÃO OBRIGATÓRIA IMEDIATA ${VIOLATION_EMOJIS}

> **A sessão anterior encerrou SEM autorização do usuário.**
> O agente não chamou \`vscode_askQuestions\` antes de finalizar o turno.
>
> - **Sessão violadora**: \`${PREV_UNAUTH_SID}\`
> - **Horário da violação**: \`${PREV_UNAUTH_TS}\`
> - **Turno**: \`${PREV_UNAUTH_TURN}\`
> - **Violações consecutivas**: \`${CONSECUTIVE_VIOLATIONS}\`
>
> **PRIMEIRA AÇÃO DESTA SESSÃO (antes de qualquer outra coisa):**
>
> 1. Informar o usuário sobre esta violação
> 2. Pedir desculpas explicitamente
> 3. Invocar \`vscode_askQuestions\` para recuperar a autorização
>
> **Esta violação será registrada no audit.jsonl e rastreada.**
> O arquivo \`.github/hooks/state/UNAUTHORIZED_CLOSE.flag\` SÓ é removido
> quando o agente chama \`vscode_askQuestions\` corretamente.

---

VIOLATION_EOF
    fi
fi

# Injeta alerta de SESSION_CLOSE_NO_KEY se a sessão anterior fechou sem chave
if [ "$PREV_NO_KEY_CLOSE" = "true" ]; then
    cat >> "$BRIEFING_FILE" << NO_KEY_EOF

---

## 🔐 ALERTA — SESSÃO ANTERIOR ENCERROU SEM CHAVE DE AUTORIZAÇÃO 🔐

> A sessão anterior foi encerrada **sem que a SESSION CLOSE KEY fosse fornecida**.
> Isso indica encerramento acidental (crash, timeout, fechamento direto da janela).
>
> - **Sessão afetada**: \`${PREV_NO_KEY_SID}\`
> - **Horário**: \`${PREV_NO_KEY_TS}\`
> - **Turnos executados**: \`${PREV_NO_KEY_TURNS}\`
>
> **Ação recomendada**: revisar o que estava sendo feito e verificar se algo ficou
> em estado inconsistente (commits pendentes, arquivos abertos, etc.).

---

NO_KEY_EOF
fi

# Injeta aviso de encerramento abrupto se sessão anterior não teve sessionEnd
if [ "$PREV_ABRUPT_CLOSE" = "true" ]; then
    if [ "$PREV_CLOSE_MODE" = "key_validated" ]; then
        cat >> "$BRIEFING_FILE" << ABRUPT_EOF

---

## ⚠️ AVISO — KEY VALIDADA MAS \`session-close.sh\` NÃO FOI EXECUTADO

> **A sessão anterior validou a close_key (Template F), mas \`session-close.sh\` não foi chamado.**
> O evento \`sessionCloseAuthorized\` não foi registrado — encerramento parcialmente auditado.
>
> - **Sessão afetada**: \`${PREV_SESSION_ID}\`
> - A KEY foi fornecida corretamente via \`vscode_askQuestions\`, mas o script de close não executou.
> - Possível causa: Copilot encerrou abruptamente após o usuário digitar a KEY, antes de \`session-close.sh\`.
>
> **Ação recomendada**: verificar se havia trabalho pendente; o \`post-tool-use.sh\` tenta
> auto-invocar \`session-close.sh\`, mas falhou ou não foi acionado desta vez.

---

ABRUPT_EOF
    else
        cat >> "$BRIEFING_FILE" << ABRUPT_EOF

---

## ⚡ AVISO — ENCERRAMENTO ABRUPTO SEM KEY (\`session-close.sh\` não executado)

> **A sessão anterior encerrou sem registrar \`sessionEnd\` nem \`sessionCloseAuthorized\`.**
> Isso ocorre quando o VS Code / Copilot é fechado abruptamente
> (timeout, crash, reinicialização ou fechamento direto da janela).
>
> - **Sessão afetada**: \`${PREV_SESSION_ID}\`
> - A \`close_key\` **não foi validada** — encerramento não auditado pelo sistema.
> - Causas comuns: inatividade prolongada, restart do container, crash do processo.
>
> **Para evitar encerramentos abruptos**:
> - Mantenha o turno ativo respondendo ao agente regularmente
> - Antes de encerrar, solicite ao agente para executar o Template F
> - Não feche a janela do VS Code sem confirmar o encerramento da sessão
>
> **Ação recomendada**: verificar se havia trabalho pendente e se algo ficou
> em estado inconsistente (commits, arquivos abertos, locks, etc.).

---

ABRUPT_EOF
    fi
fi

# Injeta aviso de reconexão se a sessão anterior encerrou via rollover (RECONNECT-01)
if [ "$PREV_CLOSE_MODE" = "abrupt_reconnect" ]; then
    cat >> "$BRIEFING_FILE" << RECONNECT_EOF

---

## 🔄 INFORMAÇÃO — SESSÃO ANTERIOR ENCERROU POR RECONEXÃO DO CLIENTE

> O VS Code Client (lado Windows) desconectou e reconectou durante a sessão anterior,
> gerando um novo session_id sem disparar o evento \`sessionStart\`.
> Esta sessão agora começa com identificação limpa.
>
> - **Sessão afetada**: \`${PREV_SESSION_ID}\`
> - **Reconexões detectadas**: ${PREV_RECONNECT_COUNT}
> - **Causas comuns**: Windows sleep/hibernação, VS Code restart, WSL2 network reset.
>
> **Recomendações para sessões mais estáveis**:
> - Evitar hibernate/sleep do Windows durante sessões ativas
> - SSH keepalive configurado (ServerAliveInterval=60) para evitar silent drops
> - Não fechar a janela do VS Code sem encerrar a sessão via Template F

---

RECONNECT_EOF
fi

# Continuação do briefing — Seção da close_key (reforço — já exibida no topo)
# Hardening v6.0: mantemos referência secundária para garantir visibilidade mesmo
# após o agente scrollar além do topo do briefing.
cat >> "$BRIEFING_FILE" << CLOSE_KEY_EOF

---

## 🔐 CHAVE DE ENCERRAMENTO (referência rápida)

\`\`\`
${CLOSE_KEY}
\`\`\`

> SESSION fecha com: **Template F** → usuário digita KEY → execução automática de \`session-close.sh\`.
> TURN fecha com \`vscode_askQuestions\` (obrigatório) e **não pode ser retomado** após fechamento.
> A SESSION pode ser retomada com novo prompt no mesmo chat.

---

CLOSE_KEY_EOF

# ── Hardening 4: Alertar sobre falhas de API do vscode_askQuestions na sessão anterior ──
# BUG-33 fix: lê do CTX da sessão ANTERIOR (não do CTX da sessão nova que acabou de ser criado)
_PREV_ASK_API_FAILURES=0
if [ -n "$PREV_SESSION_ID_FROM_CTX" ]; then
    _PREV_SID_SHORT_H4="${PREV_SESSION_ID_FROM_CTX:0:8}"
    _PREV_CTX_H4="$STATE_DIR/session-context-${_PREV_SID_SHORT_H4}.json"
    [ -f "$_PREV_CTX_H4" ] || _PREV_CTX_H4="$STATE_DIR/session-context.json"
    _PREV_ASK_API_FAILURES="$(jq -r '.session_stats.askquestions_api_failures // 0' "$_PREV_CTX_H4" 2> /dev/null || echo 0)"
fi
if [ "${_PREV_ASK_API_FAILURES:-0}" -gt 0 ] 2> /dev/null; then
    _PREV_ASK_ERROR_AT="$(jq -r '.current_turn.askquestions_api_error_at // "desconhecido"' "$CTX_FILE" 2> /dev/null || echo 'desconhecido')"
    cat >> "$BRIEFING_FILE" << ASK_FAIL_EOF

---

## ⚠️ ALERTA — Falha de API do \`vscode_askQuestions\` na sessão anterior

> O \`vscode_askQuestions\` falhou **${_PREV_ASK_API_FAILURES}x** com erro **"Response contained no choices"**.
>
> Este erro ocorre quando:
> - O contexto acumulado excede o limite do modelo (mais comum)
> - A API do Copilot está sobrecarregada/indisponível
> - O timeout (~4 min) é atingido antes da resposta
>
> **Última falha registrada**: \`${_PREV_ASK_ERROR_AT}\`
>
> **Sintoma para o usuário**: A UI do VS Code exibe o esquema das perguntas + o erro inline,
> o que pode parecer "corrupção" em arquivos abertos — **é um artefato visual, não corrupcão real**.
>
> **Ações recomendadas**:
> 1. Mantenha as perguntas do \`vscode_askQuestions\` curtas (< 200 chars cada)
> 2. Se a sessão estiver longa, prefira respostas inline ao invés de \`vscode_askQuestions\`
> 3. Não interprete o artefato visual como corrupção — verifique o arquivo diretamente

---

ASK_FAIL_EOF
fi
# ─────────────────────────────────────────────────────────────────────────────

# ── Injeta alertas do watchdog no briefing (se houver problemas detectados) ──
WD_REPORT="$STATE_DIR/watchdog-report.json"
if [ -f "$WD_REPORT" ] && jq empty "$WD_REPORT" 2> /dev/null; then
    WD_STATUS="$(jq -r '.status // "healthy"' "$WD_REPORT" 2> /dev/null || echo 'healthy')"
    if [ "$WD_STATUS" != "healthy" ]; then
        WD_CRITICAL="$(jq -r '.summary.critical // 0' "$WD_REPORT" 2> /dev/null || echo 0)"
        WD_WARN="$(jq -r '.summary.warnings // 0' "$WD_REPORT" 2> /dev/null || echo 0)"
        WD_EMOJI="⚠️"
        [ "$WD_STATUS" = "critical" ] && WD_EMOJI="🚨"
        WD_ALERTS_MD="$(jq -r '.alerts[] | "- **[\(.level | ascii_upcase)]** `\(.code)`: \(.message)"' \
            "$WD_REPORT" 2> /dev/null || echo '- (detalhes não disponíveis)')"
        [ -z "$WD_ALERTS_MD" ] && WD_ALERTS_MD="- (detalhes não disponíveis)"
        cat >> "$BRIEFING_FILE" << WD_EOF

---

## ${WD_EMOJI} Watchdog — ${WD_STATUS^^} (${WD_CRITICAL} crítico(s), ${WD_WARN} aviso(s))

> O watchdog detectou anomalias no início desta sessão.
> Veja o relatório completo em \`state/watchdog-report.json\`.

${WD_ALERTS_MD}

---

WD_EOF
    fi
fi

# UPG-03: Calcula origem e estado de preservação de estatísticas para o briefing
case "$SOURCE" in
    "new")
        _SESSION_ORIGEM="🆕 \`new\` — sessão fresca (VS Code abriu nova janela de chat)"
        _SESSION_STATS_NOTE="Estatísticas zeradas (sessão nova)"
        ;;
    "inline_restart")
        _SESSION_ORIGEM="🔄 \`inline_restart\` — VS Code reconectou a mesma conversa"
        _SESSION_STATS_NOTE="⚠️ Estatísticas **preservadas** da sessão anterior (CTX não zerado)"
        ;;
    "reconnect_rollover")
        _SESSION_ORIGEM="🔃 \`reconnect_rollover\` — reconexão do cliente VS Code (HEAL aplicado)"
        _SESSION_STATS_NOTE="Estatísticas da sessão anterior recuperadas via HEAL"
        ;;
    "healed_from_real_session" | "healed_from_consecutive_mismatch")
        _SESSION_ORIGEM="🩹 \`${SOURCE}\` — sessão recuperada por HEAL automático"
        _SESSION_STATS_NOTE="Estatísticas parcialmente recuperadas do CTX anterior"
        ;;
    "manual_recovery")
        _SESSION_ORIGEM="🛠️ \`manual_recovery\` — recuperação manual de emergência"
        _SESSION_STATS_NOTE="Estatísticas limitadas (CTX criado manualmente)"
        ;;
    *)
        _SESSION_ORIGEM="\`${SOURCE}\`"
        _SESSION_STATS_NOTE="(origem desconhecida)"
        ;;
esac

# Continuação do briefing — Estado Ativo (SESSION → SECTION → TURN) proeminente
cat >> "$BRIEFING_FILE" << ACTIVE_STATE_EOF

---

## 📍 Estado Ativo — SESSION → SECTION → TURN

| Dimensão | Valor |
|----------|-------|
| **ID da Sessão** | \`${SESSION_ID}\` |
| **Sessão lógica** | #${LOGICAL_SESSION_NUMBER} |
| **Origem da sessão** | ${_SESSION_ORIGEM} |
| **Estatísticas** | ${_SESSION_STATS_NOTE} |
| **Turno** | #1 (primeiro turno desta sessão) |
| **Seção ativa** | \`"início"\` — seção 1 |
| **Seção iniciada em** | ${SESSION_DATE} |

> **Invariante**: sempre deve haver uma SESSION, uma SECTION e um TURN ativos.
> A seção \`"início"\` é criada automaticamente em toda nova sessão.
> Use \`bash .github/hooks/scripts/start-section.sh "nome"\` para abrir uma nova seção
> (a seção anterior será encerrada automaticamente com \`sectionEnd\`).

---

ACTIVE_STATE_EOF

# Continuação do briefing
cat >> "$BRIEFING_FILE" << BRIEFING_BODY_EOF

## Estado do Backlog

| Prioridade      | Tarefas abertas |
|-----------------|-----------------|
| 🔴 Alta          | ${COUNT_ALTA}  |
| 🟡 Média         | ${COUNT_MEDIA} |
| 🔵 Backlog Livre | ${COUNT_BACKLOG} |
| **Total**       | **${TOTAL_OPEN}** |

## Próxima tarefa sugerida (Alta Prioridade)

${NEXT_TASK}

## Findings pendentes

- Total registrado em \`logs/findings.jsonl\`: **${OPEN_FINDINGS}**
- Findings críticos/high: **${CRITICAL_FINDINGS}**

> Se \`CRITICAL_FINDINGS > 0\`, considere priorizar a resolução desses findings
> antes de selecionar uma nova tarefa do backlog.

## Saúde do Sistema

**Status**: ${HEALTH_STATUS}
**Rede**: $([ "$NET_OK" = "true" ] && echo "✅ OK (ping ${NET_CHECK_HOST})" || echo "⛔ FALHA (sem resposta de ${NET_CHECK_HOST})")
**Reconexões VS Code (histórico)**: ${RECENT_RECONNECT_COUNT} $([ "${RECENT_RECONNECT_COUNT:-0}" -ge 20 ] && echo "⛔ CRÍTICO" || ([ "${RECENT_RECONNECT_COUNT:-0}" -ge 5 ] && echo "⚠️ ELEVADO" || echo "✅ ok"))

$(if [ -n "$HEALTH_CRITICAL" ]; then printf '%s\n' "$HEALTH_CRITICAL"; fi)
$(if [ -n "$HEALTH_WARNINGS" ]; then printf '%s\n' "$HEALTH_WARNINGS"; fi)

## Tendências históricas

| Métrica | Valor |
|---|---|
| Sessões registradas | ${TREND_SESSIONS} |
| Total de chamadas de ferramenta | ${TREND_TOTAL_TOOLS} |
| Taxa de falha de ferramentas | ${TREND_ERROR_RATE} |

### Top ferramentas (todas as sessões)

| Ferramenta | Chamadas |
|---|---|
${TREND_TOP_TOOLS_TABLE}

### Ferramentas com mais falhas

${TREND_TOP_FAILURES}

## Performance por ferramenta (médias históricas)

| Ferramenta | Média | Amostras |
|---|---|---|
${TREND_PERF_TABLE}

## Sessão atual

- **ID**: ${SESSION_ID}
- **Início**: ${SESSION_DATE}
- **Origem**: ${SOURCE}
- **Workspace**: ${CWD}

## Continuidade — Sessão Anterior

$(if [ -n "$PREV_SESSION_ID" ] && [ "$PREV_SESSION_ID" != "$SESSION_ID" ]; then
    echo "> **Recovery ativo.** Dados recuperados do último checkpoint da sessão anterior."
    echo ""
    echo "- **Sessão anterior**: \`${PREV_SESSION_ID}\`"
    echo "- **Checkpoint**: \`${PREV_CHECKPOINT_TS:-N/D}\`"
    echo "- **Turnos concluídos**: ${PREV_TURN_COUNT}"
    echo "- **Tarefas abertas**: ${PREV_TASKS_OPEN}"
    echo ""
    echo "> Verifique \`.github/hooks/state/pending-tasks.md\` para retomar de onde parou."
else
    echo "> Nenhuma sessão anterior identificada, ou sessão continuando (\`source=${SOURCE}\`)."
fi)

## Ação imediata recomendada

1. **SE** \`initialPrompt\` está vazio → invocar \`vscode_askQuestions\` com Template E (Session Kickoff)
2. **SE** há findings críticos → apresentá-los ao usuário antes de prosseguir
3. **SE** a sessão tem prompt explícito → executar o prompt e, ao concluir, invocar Template A
4. **SE** sessão anterior detectada → confirmar com usuário se deseja retomar tarefas abertas

---
*Gerado automaticamente. Não editar manualmente.*
BRIEFING_BODY_EOF

# Banner visível ao desenvolvedor no terminal
cat << 'EOF'
╔══════════════════════════════════════════════════════════════════╗
║           COPILOT — SESSÃO INICIADA — MODO ARQUITETO             ║
║  • Todos os prompts e ferramentas são auditados localmente        ║
║  • preToolUse: logging-only (nunca bloqueia)                      ║
║  • Briefing: .github/hooks/state/session-briefing.md             ║
╚══════════════════════════════════════════════════════════════════╝
EOF

# Exibe resumo de tarefas ao desenvolvedor no terminal
if [ -f "$TASKS_FILE" ]; then
    echo ""
    echo "=== BACKLOG: ${COUNT_ALTA} alta | ${COUNT_MEDIA} média | ${COUNT_BACKLOG} backlog (total: ${TOTAL_OPEN}) ==="
    if [ -n "$NEXT_TASK" ]; then
        echo "→ Próxima (Alta): $NEXT_TASK" | head -c 120
        echo ""
    fi
    echo "=== session-briefing.md gerado — LLM deve lê-lo como primeiro ato ==="
    echo ""
fi

# ── SessionStart: emite hookSpecificOutput.additionalContext ─────────────────
# Injeta o briefing gerado diretamente no contexto do LLM, eliminando a
# dependência de o agente ler manualmente session-briefing.md.
# Formato oficial VS Code: {"hookSpecificOutput": {"hookEventName": "SessionStart",
#   "additionalContext": "..."}}
# Referência: code.visualstudio.com/docs/copilot/customization/hooks
#
# Envia versão condensada do briefing (primeiras 80 linhas sem separadores vazios)
# para fd 3 (stdout original preservado acima via "exec 3>&1 1>&2").
if [ -f "$BRIEFING_FILE" ] && command -v jq &> /dev/null; then
    BRIEFING_CONDENSED="$(grep -v '^---$' "$BRIEFING_FILE" 2> /dev/null \
        | grep -v '^$' \
        | head -150 \
        | grep -v 'Gerado automaticamente' || true)"
    if [ -n "$BRIEFING_CONDENSED" ]; then
        printf '%s\n' \
            "{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":$(printf '%s' "$BRIEFING_CONDENSED" | jq -Rs .)}}" \
            >&3
    fi
fi

exit 0
