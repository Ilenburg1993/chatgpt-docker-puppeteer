#!/bin/bash
# session-start.sh — Hook sessionStart do Copilot (Schema v8)
# Executado quando uma nova sessão inicia ou é retomada.
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

# Lê o JSON de entrada de forma defensiva
INPUT="$(cat 2> /dev/null || true)"

# Extrai campos com fallback seguro
TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
CWD="$(echo "$INPUT" | jq -r '.cwd // ""' 2> /dev/null || echo '')"
SOURCE="$(echo "$INPUT" | jq -r '.source // "new"' 2> /dev/null || echo 'new')"

# session_id: usa o UUID real enviado pelo Copilot; fallback para timestamp-based
SESSION_ID_RAW="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"
if [ -n "$SESSION_ID_RAW" ]; then
    SESSION_ID="$SESSION_ID_RAW"
else
    TS_NORM="$(echo "$TIMESTAMP" | sed 's/[^0-9]//g' | head -c 13)"
    SESSION_ID="sess_${TS_NORM:-$(date +%s%3N)}"
fi

SESSION_DATE="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo 'unknown')"
SESSION_DATE_SHORT="$(date -u '+%Y%m%d_%H%M%S' 2> /dev/null || echo 'unknown')"

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
CLOSE_KEY="ENCERRAR-$(openssl rand -hex 4 2> /dev/null | tr '[:lower:]' '[:upper:]' || date +%s | sha256sum | head -c 8 | tr '[:lower:]' '[:upper:]')"

# Gera IDs UUID para a secão e turno iniciais
INITIAL_SECTION_ID="$(uuidgen 2> /dev/null || printf 'sect_%s_%s' "$(date +%s)" "$$")"
INITIAL_TURN_ID="$(uuidgen 2> /dev/null || printf 'turn_%s_%s' "$(date +%s)" "$$")"

# UPG-01: Calcula o número da sessão lógica
# logical_session_number increments on every "new" sessionStart (not inline_restart).
# Preserved as-is on inline_restart since that is a continuation of the same logical session.
_PREV_LOGICAL_NUM=0
if [ -f "$STATE_DIR/session-context.json" ] && command -v jq &> /dev/null; then
    _PREV_LOGICAL_NUM="$(jq -r '.session.logical_session_number // 0' "$STATE_DIR/session-context.json" 2> /dev/null || echo 0)"
    _PREV_LOGICAL_NUM="${_PREV_LOGICAL_NUM:-0}"
fi
if [ "$SOURCE" = "inline_restart" ]; then
    # Preserva o número atual — mesma sessão lógica
    # EBH-M03: guard contra 0 quando CTX estava inexistente antes do inline_restart
    if [ "${_PREV_LOGICAL_NUM:-0}" -gt 0 ] 2> /dev/null; then
        LOGICAL_SESSION_NUMBER="$_PREV_LOGICAL_NUM"
    else
        LOGICAL_SESSION_NUMBER=1
    fi
else
    # Nova sessão lógica: incrementa
    LOGICAL_SESSION_NUMBER=$((_PREV_LOGICAL_NUM + 1))
fi

# ── Persiste contexto inicial — Schema v4 (layered) ──────────────────────────
# Estrutura em 6 blocos separados por âmbito:
#   session       → imutável após sessionStart (identidade da sessão)
#   session_stats → acumuladores agregados ao longo de todos os turnos
#   current_turn  → estado do turno ATUAL (resetado a cada agentStop)
#   current_section → seção temática ativa (sempre >= 1 ativa — invariante Schema v4)
#   last_tool     → metadados do último tool call (sobrescrito a cada preToolUse)
#   compliance    → estado do protocolo de autorização
#
# FIX BUG-02 (PREMISSA 1): Para source=inline_restart, NÃO zeramos o CTX.
# O VS Code reconectou a mesma conversa lógica — preservar estatísticas acumuladas
# (turn_count, tools_total, section_count, etc.) garante continuidade.
# Apenas os campos da session (id, timestamps, close_key) são atualizados.
if [ "$SOURCE" = "inline_restart" ] \
    && [ -f "$STATE_DIR/session-context.json" ] \
    && [ -s "$STATE_DIR/session-context.json" ]; then
    # Atualização parcial: apenas campos de identidade da sessão.
    # Estatísticas, seções, histórico de turnos e compliance são PRESERVADOS.
    _CTX_TMP="$(mktemp)"
    if jq \
        --arg sid "$SESSION_ID" \
        --arg date "$SESSION_DATE" \
        --arg date_short "$SESSION_DATE_SHORT" \
        --arg source "$SOURCE" \
        --arg cwd "$CWD" \
        --arg close_key "$CLOSE_KEY" \
        --arg ts "$TIMESTAMP" \
        '.session.id                    = $sid
         | .session.vs_code_session_id  = $sid
         | .session.started_at          = $date
         | .session.date_short          = $date_short
         | .session.ended_at            = null
         | .session.end_reason          = null
         | .session.close_key           = $close_key
         | .session.close_key_validated = false
         | .session.source              = $source
         | .session.cwd                 = $cwd
         | .last_tool.ts                = $ts' \
        "$STATE_DIR/session-context.json" > "$_CTX_TMP" 2> /dev/null; then
        # UPG-AUDIT-01: escreve no per-session file e recria symlink
        _PER_CTX_REAL="${STATE_DIR}/session-context-${SID_SHORT}.json"
        mv "$_CTX_TMP" "$_PER_CTX_REAL" 2> /dev/null \
            || {
                cp "$_CTX_TMP" "$_PER_CTX_REAL" 2> /dev/null
                rm -f "$_CTX_TMP"
            }
        # Atualiza symlink de compatibilidade retroativa
        if [ -n "${SID_SHORT:-}" ]; then
            update_compat_symlinks "$SID_SHORT" 2> /dev/null || true
            set_current_session_id "$SESSION_ID" 2> /dev/null || true
        fi
    else
        rm -f "$_CTX_TMP"
        # Fallback: se a atualização parcial falhar (CTX corrompido), faz reset completo
        echo "[session-start] WARN: CTX corrompido em inline_restart — fallback para reset completo" >&2
        SOURCE="new" # força o branch de reset abaixo
    fi
fi

if [ "$SOURCE" != "inline_restart" ]; then
    jq -cn \
        --arg sid "$SESSION_ID" \
        --arg ts "$TIMESTAMP" \
        --arg date "$SESSION_DATE" \
        --arg date_short "$SESSION_DATE_SHORT" \
        --arg source "$SOURCE" \
        --arg cwd "$CWD" \
        --arg close_key "$CLOSE_KEY" \
        --arg initial_section_id "$INITIAL_SECTION_ID" \
        --arg initial_turn_id "$INITIAL_TURN_ID" \
        --argjson consec "$PREV_CONSEC_UNAUTH" \
        --argjson logical_num "$LOGICAL_SESSION_NUMBER" \
        '{
        "session": {
            "id":                    $sid,
            "vs_code_session_id":    $sid,
            "logical_session_number": $logical_num,
            "logical_restart_at":    $ts,
            "started_at":            $date,
            "date_short":            $date_short,
            "ended_at":              null,
            "end_reason":            null,
            "close_key":             $close_key,
            "close_key_validated":   false,
            "source":                $source,
            "cwd":                   $cwd
        },
        "session_stats": {
            "turn_count":         0,
            "turn_authorized":    0,
            "turn_unauthorized":  0,
            "tools_total":        0,
            "tools_by_name":      {},
            "failures_detected":        0,
            "errors_total":             0,
            "subagent_calls":           0,
            "subagent_completions":     0,
            "askquestions_api_failures": 0,
            "section_count":      1,
            "section_names":      ["início"],
            "section_history":    [{"name": "início", "section_id": $initial_section_id, "section_number": 1, "started_at": $date}],
            "turn_history":       [],
            "push_count":         0,
            "last_push_at":       null,
            "last_push_turn":     null,
            "pending_section_after_push": false,
            "commit_history":     [],
            "session_id_mismatches": 0,
            "session_id_syncs_inline": 0,
            "recovery_hints": {
                "last_intent":      null,
                "last_section":     null,
                "last_commit_sha":  null,
                "last_commit_ts":   null
            }
        },
        "current_turn": {
            "number":                      1,
            "started_at":                  $date,
            "tools_count":                 0,
            "tools_by_name":               {},
            "failures_count":              0,
            "auth_requested":              false,
            "auth_requested_at":           null,
            "last_askquestions_response":  null,
            "section_name":                "início",
            "section_turn":                1,
            "intent_declared":             false,
            "intent":                      null,
            "todo_created":                false,
            "block_count":                 0,
            "agentStop_invocations":       0,
            "subagent_delegated":          false,
            "turn_id":                     $initial_turn_id
        },
        "current_section": {
            "name":           "início",
            "started_at":     $date,
            "turn_start":     1,
            "local_turn":     0,
            "description":    null,
            "section_number": 1,
            "section_id":     $initial_section_id,
            "push_count":     0,
            "tools_by_name":  {},
            "intent_history": [],
            "failures_count": 0,
            "blocked_turns":  0
        },
        "last_tool": {
            "name":   null,
            "ts":     $ts,
            "use_id": null,
            "result": null
        },
        "compliance": {
            "last_turn_authorized":     null,
            "consecutive_unauthorized": $consec,
            "flag_file_exists":         false
        },
        "quality_gates":   {},
        "session_summary": null,
        "last_turn_ts":    null
    }' > "$PER_CTX_FILE"
    # UPG-AUDIT-01: após criar o per-session CTX, atualiza symlinks e current-session-id.txt
    update_compat_symlinks "$SID_SHORT" 2> /dev/null || true
    set_current_session_id "$SESSION_ID" 2> /dev/null || true
fi

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

# Busca o checkpoint mais recente de qualquer sessão anterior
if [ -d "$CHECKPOINT_DIR" ]; then
    PREV_CHECKPOINT="$(find "$CHECKPOINT_DIR" -maxdepth 1 -name 'sess_*_turn*.json' -printf '%T@ %p\n' 2> /dev/null | sort -rn | head -1 | cut -d' ' -f2- || true)"
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
# encerramento é o agente chamar session-close.sh manualmente após validar a KEY,
# o que gera o evento `sessionCloseAuthorized` E depois chama session-end.sh.
# Encerramento limpo = `sessionEnd` OR `sessionCloseAuthorized` com o session_id correto.
PREV_ABRUPT_CLOSE=false
if [ -n "$PREV_SESSION_ID" ] && [ "$PREV_SESSION_ID" != "$SESSION_ID" ]; then
    # UPG-AUDIT-01: usa arquivo per-session da sessão anterior (não o symlink atualizado)
    _PREV_SID_SHORT="${PREV_SESSION_ID:0:8}"
    _AUDIT_TMP="${LOG_DIR}/audit-${_PREV_SID_SHORT}.jsonl"
    [ -f "$_AUDIT_TMP" ] || _AUDIT_TMP="$LOG_DIR/audit.jsonl"
    _FOUND_SESSION_END=false
    # Padrão de grep: qualquer um dos dois eventos de encerramento limpo
    _CLEAN_CLOSE_PATTERN='"sessionEnd"\|"sessionCloseAuthorized"'
    # Verifica arquivo per-session da sessão anterior
    if [ -f "$_AUDIT_TMP" ] && grep -q "$_CLEAN_CLOSE_PATTERN" "$_AUDIT_TMP" 2> /dev/null \
        && grep "$_CLEAN_CLOSE_PATTERN" "$_AUDIT_TMP" 2> /dev/null | grep -q "$PREV_SESSION_ID"; then
        _FOUND_SESSION_END=true
    fi
    # Se não encontrou, verifica outros arquivos per-session excluindo o atual (após rotação)
    if [ "$_FOUND_SESSION_END" = "false" ]; then
        _LATEST_ARCHIVE="$(find "$LOG_DIR" -maxdepth 1 -name 'audit-????????.jsonl' \
            ! -name "audit-${SID_SHORT}.jsonl" \
            -printf '%T@ %p\n' 2> /dev/null | sort -rn | head -1 | cut -d' ' -f2- || true)"
        if [ -n "$_LATEST_ARCHIVE" ] && [ -f "$_LATEST_ARCHIVE" ] \
            && grep -q "$_CLEAN_CLOSE_PATTERN" "$_LATEST_ARCHIVE" 2> /dev/null \
            && grep "$_CLEAN_CLOSE_PATTERN" "$_LATEST_ARCHIVE" 2> /dev/null | grep -q "$PREV_SESSION_ID"; then
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
jq -cn \
    --arg event "sessionStart" \
    --arg sid "$SESSION_ID" \
    --arg ts "$TIMESTAMP" \
    --arg date "$SESSION_DATE" \
    --arg source "$SOURCE" \
    --arg cwd "$CWD" \
    '{event: $event, session_id: $sid, timestamp: $ts, date: $date, source: $source, cwd: $cwd}' \
    >> "$AUDIT_FILE"

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

# Conta tarefas por prioridade
COUNT_ALTA=0
COUNT_MEDIA=0
COUNT_BACKLOG=0
NEXT_TASK=""

if [ -f "$TASKS_FILE" ]; then
    # Contagens por seção
    COUNT_ALTA="$(awk '/^## Alta Prioridade/{f=1} /^## / && !/^## Alta/{f=0} f && /^\- \[ \]/' "$TASKS_FILE" | wc -l | tr -d ' ')"
    COUNT_MEDIA="$(awk '/^## Média Prioridade/{f=1} /^## / && !/^## Média/{f=0} f && /^\- \[ \]/' "$TASKS_FILE" | wc -l | tr -d ' ')"
    COUNT_BACKLOG="$(awk '/^## Backlog/{f=1} /^## / && !/^## Backlog/{f=0} f && /^\- \[ \]/' "$TASKS_FILE" | wc -l | tr -d ' ')"
    # Próxima tarefa sugerida (primeira não concluída de Alta Prioridade)
    NEXT_TASK="$(awk '/^## Alta Prioridade/{f=1} /^## / && !/^## Alta/{f=0} f && /^\- \[ \]/{print; exit}' "$TASKS_FILE" | sed 's/^- \[ \] //')"
    [ -z "$NEXT_TASK" ] && NEXT_TASK="(nenhuma tarefa de Alta Prioridade — verificar Média Prioridade)"
fi

# Conta findings não resolvidos (da sessão atual ou anteriores)
OPEN_FINDINGS=0
CRITICAL_FINDINGS=0
if [ -f "$FINDINGS_FILE" ]; then
    OPEN_FINDINGS="$(wc -l < "$FINDINGS_FILE" 2> /dev/null | tr -d ' ')"
    CRITICAL_FINDINGS="$(jq -r 'select(.severity == "critical" or .severity == "high")' "$FINDINGS_FILE" 2> /dev/null | jq -s 'length' 2> /dev/null || echo 0)"
fi

TOTAL_OPEN=$((COUNT_ALTA + COUNT_MEDIA + COUNT_BACKLOG))

# ─────────────────────────────────────────────────────────────
# Análise de tendências históricas (audit*.jsonl + tool-metrics.jsonl)
# UPG-AUDIT-01: merge cross-session para leitura histórica correta
# ─────────────────────────────────────────────────────────────
_TREND_AUDIT_FILE_BKP="$AUDIT_FILE" # salva arquivo per-session atual
_TREND_MERGED=""
# Merge de todos os per-session audits para análise cross-session
_TREND_SID_FILES=()
while IFS= read -r -d '' _tf; do _TREND_SID_FILES+=("$_tf"); done \
    < <(find "$LOG_DIR" -maxdepth 1 -name 'audit-????????.jsonl' -print0 2> /dev/null | sort -z)
if [ ${#_TREND_SID_FILES[@]} -gt 0 ] && _TREND_MERGED="$(mktemp 2> /dev/null)"; then
    trap 'rm -f "${_TREND_MERGED:-}"' EXIT
    cat "${_TREND_SID_FILES[@]}" > "$_TREND_MERGED" 2> /dev/null || true
    AUDIT_FILE="$_TREND_MERGED"
else
    AUDIT_FILE="$LOG_DIR/audit.jsonl"
fi
METRICS_FILE="$LOG_DIR/tool-metrics.jsonl"

TREND_SESSIONS="N/D"
TREND_TOTAL_TOOLS="N/D"
TREND_ERROR_RATE="N/D"
TREND_TOP_TOOLS_TABLE=""
TREND_TOP_FAILURES="- (nenhuma falha registrada)"
TREND_PERF_TABLE=""

if [ -f "$AUDIT_FILE" ] && [ -s "$AUDIT_FILE" ]; then
    TREND_SESSIONS="$(jq -r '.session_id // empty' "$AUDIT_FILE" 2> /dev/null \
        | sort -u | awk 'NF{n++} END{print n+0}' || echo 'N/D')"

    TREND_TOTAL_TOOLS="$(jq -r 'select(.event == "preToolUse" and ((.tool_name // .toolName) // "") != "") | (.tool_name // .toolName)' "$AUDIT_FILE" 2> /dev/null \
        | wc -l | tr -d ' ' || echo '0')"

    TOTAL_FAILURES="$(jq -r 'select((.event == "toolFailure" or .event == "toolUseFailure") and ((.tool_name // .toolName) // "") != "") | (.tool_name // .toolName)' "$AUDIT_FILE" 2> /dev/null \
        | wc -l | tr -d ' ' || echo '0')"

    if [ "$TREND_TOTAL_TOOLS" -gt 0 ] 2> /dev/null; then
        TREND_ERROR_RATE="$(echo "$TOTAL_FAILURES $TREND_TOTAL_TOOLS" \
            | awk '{printf "%.1f%% (%d/%d)", ($1/$2)*100, $1, $2}')"
    fi

    TREND_TOP_TOOLS_TABLE="$(jq -r 'select(.event == "preToolUse" and ((.tool_name // .toolName) // "") != "") | (.tool_name // .toolName)' "$AUDIT_FILE" 2> /dev/null \
        | sort | uniq -c | sort -rn | head -6 \
        | awk '{printf "| `%-35s` | %5d |\n", $2, $1}' || true)"
    [ -z "$TREND_TOP_TOOLS_TABLE" ] && TREND_TOP_TOOLS_TABLE="| N/D | 0 |"

    TREND_TOP_FAILURES="$(jq -r 'select((.event == "toolFailure" or .event == "toolUseFailure") and ((.tool_name // .toolName) // "") != "") | (.tool_name // .toolName)' \
        "$AUDIT_FILE" 2> /dev/null \
        | sort | uniq -c | sort -rn | head -3 \
        | awk '{printf "- `%s`: %d falha(s)\n", $2, $1}' || true)"
    [ -z "$TREND_TOP_FAILURES" ] && TREND_TOP_FAILURES="- (nenhuma falha registrada)"
fi

if [ -f "$METRICS_FILE" ] && [ -s "$METRICS_FILE" ]; then
    TREND_PERF_TABLE="$(jq -r '(.tool_name // .toolName)' "$METRICS_FILE" 2> /dev/null \
        | sort -u \
        | while read -r tool; do
            AVG_MS="$(jq -r --arg t "$tool" \
                'select((.tool_name // .toolName) == $t) | .duration_ms' \
                "$METRICS_FILE" 2> /dev/null \
                | awk '{s+=$1; n++} END {if(n>0) printf "%.0f", s/n; else print "N/D"}')"
            COUNT_T="$(jq -r --arg t "$tool" \
                'select((.tool_name // .toolName) == $t) | (.tool_name // .toolName)' \
                "$METRICS_FILE" 2> /dev/null | wc -l | tr -d ' ')"
            printf "| \`%-35s\` | %6s ms | %4d |\n" "$tool" "$AVG_MS" "$COUNT_T"
        done \
        | sort -t'|' -k3 -rn | head -8 || true)"
    [ -z "$TREND_PERF_TABLE" ] && TREND_PERF_TABLE="| N/D | - | 0 |"
fi

AUDIT_FILE="$_TREND_AUDIT_FILE_BKP" # UPG-AUDIT-01: restaura audit per-session após análise histórica

# ── UP3: Health check do ambiente ─────────────────────────────────────────
HEALTH_CRITICAL=""
HEALTH_WARNINGS=""

# sponge é crítico: sem ele nenhuma atualização do session-context.json funciona
if ! command -v sponge &> /dev/null; then
    HEALTH_CRITICAL="${HEALTH_CRITICAL}
- ⛔ **sponge não instalado** — instale com \`sudo apt install moreutils\`. Atualizações de estado da sessão inoperantes."
fi

# jq é crítico: sem ele nenhum hook funciona
if ! command -v jq &> /dev/null; then
    HEALTH_CRITICAL="${HEALTH_CRITICAL}
- ⛔ **jq não instalado** — instale com \`sudo apt install jq\`. Sistema de hooks completamente inoperante."
fi

# audit.jsonl: rotação automática ocorre em 5000 linhas (rotate-audit.sh, chamado por session-start.sh)
AUDIT_LINES=0
if [ -f "$AUDIT_FILE" ]; then
    AUDIT_LINES="$(wc -l < "$AUDIT_FILE" | tr -d ' ')"
    if [ "${AUDIT_LINES}" -gt 4500 ] 2> /dev/null; then
        HEALTH_CRITICAL="${HEALTH_CRITICAL}
- ⛔ **audit.jsonl crítico** (${AUDIT_LINES}/5000 linhas). Rotação iminente — arquive logs antigos urgentemente."
    elif [ "${AUDIT_LINES}" -gt 3000 ] 2> /dev/null; then
        HEALTH_WARNINGS="${HEALTH_WARNINGS}
- ⚠️ **audit.jsonl crescendo** (${AUDIT_LINES}/5000 linhas). Rotação automática em breve."
    fi
fi

# session-context.json: verifica permissão de escrita
if [ -f "$STATE_DIR/session-context.json" ] && [ ! -w "$STATE_DIR/session-context.json" ]; then
    HEALTH_CRITICAL="${HEALTH_CRITICAL}
- ⛔ **session-context.json sem permissão de escrita** — estado da sessão não pode ser atualizado."
fi

# Findings críticos/high abertos requerem atenção antes de nova tarefa
if [ "${CRITICAL_FINDINGS:-0}" -gt 0 ] 2> /dev/null; then
    HEALTH_WARNINGS="${HEALTH_WARNINGS}
- ⚠️ **${CRITICAL_FINDINGS} finding(s) crítico/high abertos** — verifique \`logs/findings.jsonl\` antes de iniciar nova tarefa."
fi

# ── Health check de REDE (v5.5 — Session Robustness) ──────────────────────
# Detecta problemas de conectividade que causam desconexões/reconexões VS Code.
# Referência: DOCUMENTAÇÃO/HOOKS/ANALISE-SESSOES-ABRUPTAS.md §5.5
NET_CHECK_HOST="${HEALTH_CHECK_HOST:-140.82.112.22}" # GitHub (IPs estáticos)
NET_TIMEOUT=3
NET_OK=false
if ping -c 1 -W "$NET_TIMEOUT" "$NET_CHECK_HOST" &> /dev/null 2>&1; then
    NET_OK=true
fi

# Verifica taxa de reconexões recentes (sessionReconnect no audit.jsonl)
RECENT_RECONNECT_COUNT=0
if [ -f "$AUDIT_FILE" ] && command -v jq &> /dev/null; then
    RECENT_RECONNECT_COUNT="$(
        jq -r 'select(.event == "sessionReconnect") | .timestamp' "$AUDIT_FILE" 2> /dev/null \
            | tail -50 | wc -l | tr -d ' '
    )"
fi
RECENT_RECONNECT_COUNT="${RECENT_RECONNECT_COUNT:-0}"

if [ "$NET_OK" = "false" ]; then
    HEALTH_CRITICAL="${HEALTH_CRITICAL}
- ⛔ **Sem conectividade de rede** (ping ${NET_CHECK_HOST} falhou). VS Code pode desconectar. Verifique WSL2/Docker network."
fi

if [ "${RECENT_RECONNECT_COUNT}" -ge 20 ] 2> /dev/null; then
    HEALTH_CRITICAL="${HEALTH_CRITICAL}
- ⛔ **Taxa crítica de reconexões VS Code** (${RECENT_RECONNECT_COUNT} reconexões detectadas). Instabilidade de conexão severa."
elif [ "${RECENT_RECONNECT_COUNT}" -ge 5 ] 2> /dev/null; then
    HEALTH_WARNINGS="${HEALTH_WARNINGS}
- ⚠️ **Taxa elevada de reconexões VS Code** (${RECENT_RECONNECT_COUNT} reconexões). Verifique: extensões auto-update, rede/DNS, sleep do host."
fi

HEALTH_STATUS="✅ Sistema operacional"
if [ -n "$HEALTH_CRITICAL" ]; then
    HEALTH_STATUS="⛔ CRÍTICO — verificação imediata necessária"
elif [ -n "$HEALTH_WARNINGS" ]; then
    HEALTH_STATUS="⚠️ Avisos presentes"
fi

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

if [ -f "$NO_KEY_FLAG_FILE" ]; then
    PREV_NO_KEY_CLOSE=true
    PREV_NO_KEY_TS="$(jq -r '.timestamp // ""' "$NO_KEY_FLAG_FILE" 2> /dev/null || echo '')"
    PREV_NO_KEY_SID="$(jq -r '.session_id // ""' "$NO_KEY_FLAG_FILE" 2> /dev/null || echo '')"
    PREV_NO_KEY_TURNS="$(jq -r '.turn_count // 0' "$NO_KEY_FLAG_FILE" 2> /dev/null || echo 0)"
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
| **TURN**    | Livremente ao terminar a resposta        | **Nenhuma**    |
| **SECTION** | \`bash start-section.sh "nome"\` (autônomo)| **Nenhuma**    |
| **SESSION** | Template F + KEY digitada + \`bash session-close.sh KEY\` | **OBRIGATÓRIA**|

> ⚠️ **Terminar de escrever uma resposta = encerrar um TURN, NÃO a SESSION.**
> A SESSION só encerra quando o usuário explicitamente digita a chave abaixo.

### 🔐 Chave desta SESSION (mostrar no Template F):
\`\`\`
${CLOSE_KEY}
\`\`\`

### Fluxo de encerramento de SESSION (3 etapas obrigatórias):
1. Agente chama \`vscode_askQuestions\` com **Template F** (exibe a chave acima)
2. Usuário digita a chave \`${CLOSE_KEY}\` no campo livre
3. Agente executa: \`bash .github/hooks/scripts/session-close.sh "${CLOSE_KEY}"\`

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

> SESSION fecha com: **Template F** → usuário digita KEY → \`bash session-close.sh "${CLOSE_KEY}"\`
> TURN encerra livremente. SECTION muda via \`start-section.sh\` (autônomo).

---

CLOSE_KEY_EOF

# ── Hardening 4: Alertar sobre falhas de API do vscode_askQuestions na sessão anterior ──
# Lê session-context.json para verificar se houve falhas de askQuestions na sessão anterior.
# Isso detecta o padrão "FAILED: Response contained no choices" e avisa o agente.
_PREV_ASK_API_FAILURES=0
_PREV_ASK_API_FAILURES="$(jq -r '.session_stats.askquestions_api_failures // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
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
        | head -80 \
        | grep -v 'Gerado automaticamente' || true)"
    if [ -n "$BRIEFING_CONDENSED" ]; then
        printf '%s\n' \
            "{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":$(printf '%s' "$BRIEFING_CONDENSED" | jq -Rs .)}}" \
            >&3
    fi
fi

exit 0
