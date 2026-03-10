#!/bin/bash
# pre-tool-use.sh — Hook preToolUse do Copilot
# Executado ANTES de cada uso de ferramenta pelo agente.
# Input JSON (stdin): {timestamp, hook_event_name, session_id, transcript_path,
#                      tool_name, tool_input, tool_use_id, cwd}
# Schema verificado empiricamente em 2026-03-09 (vide raw-input.jsonl diagnóstico).
# Output: NÃO emite {"permissionDecision":"deny"} — logging-only por decisão de projeto.
#
# SEGURANÇA: credentials são redactados antes de qualquer log.
# O agente tem autonomia total — este hook nunca bloqueia.
#
# Schema v2: atualiza current_turn.*, session_stats.* e last_tool.* separadamente.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
CTX_FILE="$STATE_DIR/session-context.json"

mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"

# G9-11/GAP-C.1: Carrega biblioteca de funções compartilhadas (redact_credentials, iso_now, etc.)
# shellcheck disable=SC1091
if [ -f "$HOOK_DIR/hooks-lib/common.sh" ]; then
    source "$HOOK_DIR/hooks-lib/common.sh"
fi

# G9-08/BUG-A.1: Lock exclusivo para escritas em session-context.json
# Garante que pre-tool-use.sh não corre com agent-stop.sh, post-tool-use.sh ou log-prompt.sh.
_CTX_LOCK="${CTX_FILE}.lock"
exec 9> "$_CTX_LOCK"
if command -v flock > /dev/null 2>&1; then
    flock -x -w 3 9 2> /dev/null
fi

INPUT="$(cat 2> /dev/null || true)"

# Extrai campos usando o schema real (snake_case, não camelCase)
TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
_LOCAL_TS="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
CWD="$(echo "$INPUT" | jq -r '.cwd // ""' 2> /dev/null || echo '')"
TOOL_NAME="$(echo "$INPUT" | jq -r '.tool_name // ""' 2> /dev/null || echo '')"
TOOL_USE_ID="$(echo "$INPUT" | jq -r '.tool_use_id // ""' 2> /dev/null || echo '')"

# session_id vem diretamente do payload (UUID real do Copilot)
SESSION_ID="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"
# REV-06: fallback ao contexto ativo se payload não traz session_id
if [ -z "$SESSION_ID" ] && [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
fi

# Serializa tool_input (objeto JSON) para string redactável
TOOL_INPUT_RAW="$(echo "$INPUT" | jq -c '.tool_input // {}' 2> /dev/null || echo '{}')"

# G9-11: Redaction estrutural — usa redact_credentials de common.sh se disponível,
# com fallback para pipeline inline caso common.sh não esteja carregado.
# Inclui: GitHub PAT (ghp_, gho_, ghu_, ghs_, ghr_, github_pat_), GitLab (glpat-),
# AWS (AKIA*), OpenAI (sk-), Anthropic (sk-ant-), JWT, URLs com creds, query params,
# Bearer tokens, flags --password/--token/-p, JSON fields (password, api_key, secret).
if command -v redact_credentials > /dev/null 2>&1; then
    REDACTED_ARGS="$(echo "$TOOL_INPUT_RAW" | redact_credentials)"
else
    REDACTED_ARGS="$(echo "$TOOL_INPUT_RAW" \
        | sed -E 's/ghp_[A-Za-z0-9]{20,}/[REDACTED_GHP]/g' \
        | sed -E 's/gho_[A-Za-z0-9]{20,}/[REDACTED_GHO]/g' \
        | sed -E 's/ghu_[A-Za-z0-9]{20,}/[REDACTED_GHU]/g' \
        | sed -E 's/ghs_[A-Za-z0-9]{20,}/[REDACTED_GHS]/g' \
        | sed -E 's/ghr_[A-Za-z0-9]{20,}/[REDACTED_GHR]/g' \
        | sed -E 's/github_pat_[A-Za-z0-9_]{20,}/[REDACTED_GITHUB_PAT]/g' \
        | sed -E 's/glpat-[A-Za-z0-9_-]{10,}/[REDACTED_GITLAB_PAT]/g' \
        | sed -E 's/AKIA[0-9A-Z]{16}/[REDACTED_AWS_KEY]/g' \
        | sed -E 's/sk-[A-Za-z0-9_\-]{20,}/[REDACTED_OPENAI_KEY]/g' \
        | sed -E 's/sk-ant-[A-Za-z0-9_\-]{20,}/[REDACTED_ANTHROPIC_KEY]/g' \
        | sed -E 's/eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/[REDACTED_JWT]/g' \
        | sed -E 's|https?://[^/@]+:[^@]+@[^"[:space:]]+|[REDACTED_URL_WITH_CREDS]|g' \
        | sed -E 's/[?&]token=[^&"[:space:]]*/\&token=[REDACTED]/g' \
        | sed -E 's/[?&]api_key=[^&"[:space:]]*/\&api_key=[REDACTED]/g' \
        | sed -E 's/Bearer [A-Za-z0-9_\-\.]+/Bearer [REDACTED]/g' \
        | sed -E 's/--password[=[:space:]][^[:space:]"]+/--password=[REDACTED]/g' \
        | sed -E 's/--token[=[:space:]][^[:space:]"]+/--token=[REDACTED]/g' \
        | sed -E 's/-p [A-Za-z0-9!@#$%^&*]{6,}/-p [REDACTED]/g' \
        | sed -E 's/"password"[[:space:]]*:[[:space:]]*"[^"]+"/\"password\":\"[REDACTED]\"/gi' \
        | sed -E 's/"api_key"[[:space:]]*:[[:space:]]*"[^"]+"/\"api_key\":\"[REDACTED]\"/gi' \
        | sed -E 's/"secret"[[:space:]]*:[[:space:]]*"[^"]+"/\"secret\":\"[REDACTED]\"/gi' \
        | sed -E 's/(PASSWORD|TOKEN|SECRET|API_KEY)=([^[:space:]"]{4,})/\1=[REDACTED]/g')"
fi

# Camada 2: truncation de payloads muito grandes (>2000 chars → primeiros 500 + tag)
_ARGS_LEN="${#REDACTED_ARGS}"
if [ "$_ARGS_LEN" -gt 2000 ]; then
    REDACTED_ARGS="${REDACTED_ARGS:0:500}[...TRUNCATED ${_ARGS_LEN} chars]"
fi

# Append em audit.jsonl com toolArgs redactados
jq -cn \
    --arg event "preToolUse" \
    --arg sid "$SESSION_ID" \
    --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
    --arg cwd "$CWD" \
    --arg tool "$TOOL_NAME" \
    --arg tool_use_id "$TOOL_USE_ID" \
    --arg args "$REDACTED_ARGS" \
    '{
        event:       $event,
        session_id:  $sid,
        timestamp:   $ts,
        cwd:         $cwd,
        tool_name:   $tool,
        tool_use_id: $tool_use_id,
        tool_args:   $args
    }' >> "$LOG_DIR/audit.jsonl"

# ── Auto-recovery: cria contexto mínimo se session-context.json estiver vazio ─
# Se sessionStart não disparou (bug conhecido), o sistema inteiro fica degradado.
# Detectamos isso aqui (preToolUse é o primeiro hook frequente) e criamos um
# contexto Schema v4 mínimo para restaurar funcionalidade dos guards e métricas.
if [ -n "$SESSION_ID" ] && { [ ! -f "$CTX_FILE" ] || [ ! -s "$CTX_FILE" ]; }; then
    NOW_RECOVERY="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo "$TIMESTAMP")"
    jq -cn \
        --arg sid "$SESSION_ID" \
        --arg now "$NOW_RECOVERY" \
        '{
            session: {
                id: $sid, started_at: $now, ended_at: null, end_reason: null,
                close_key: null, close_key_validated: false,
                source: "auto_recovery", cwd: null
            },
            session_stats: {
                turn_count: 0, turn_authorized: 0, turn_unauthorized: 0,
                tools_total: 0, tools_by_name: {}, failures_detected: 0,
                errors_total: 0, subagent_calls: 0, section_count: 1,
                section_names: ["recovery"],
                section_history: [], turn_history: [],
                push_count: 0, commit_history: [],
                pending_section_after_push: false,
                recovery_hints: {last_intent: null, last_section: null, last_commit_sha: null, last_commit_ts: null}
            },
            current_turn: {
                number: 1, started_at: $now, tools_count: 0, tools_by_name: {},
                failures_count: 0, auth_requested: false, auth_requested_at: null,
                last_askquestions_response: null, section_name: "recovery",
                turn_id: null, section_turn: 1, block_count: 0,
                intent_declared: false, intent: null
            },
            current_section: {
                name: "recovery", started_at: $now, turn_start: 1,
                description: "Seção criada por auto-recovery (sessionStart não disparou)",
                section_number: 1, section_id: null, local_turn: 0,
                push_count: 0, tools_by_name: {}, intent_history: [],
                failures_count: 0, blocked_turns: 0
            },
            last_tool: { name: null, ts: $now, use_id: null, result: null },
            compliance: {
                last_turn_authorized: null, consecutive_unauthorized: 0,
                flag_file_exists: false
            }
        }' > "$CTX_FILE" 2> /dev/null || true

    # Loga o evento de recovery no audit.jsonl
    jq -cn \
        --arg event "session_auto_recovery" \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_RECOVERY" \
        --arg trigger "preToolUse" \
        '{
            event:   $event,
            session_id: $sid,
            timestamp: $ts,
            trigger: $trigger,
            message: "session-context.json vazio — estado mínimo criado por auto-recovery"
        }' >> "$LOG_DIR/audit.jsonl"

    echo "[recovery] session-context.json vazio — criado contexto mínimo para sessão $SESSION_ID" >&2
fi

# ── Guard: session_id deve corresponder ao contexto ativo ─────────────────────
# HARDENING v5: previne contaminação cruzada entre sessões.
# HEAL v1: quando CTX_FILE é de manual_recovery, adota session_id real do Copilot.
# Se o payload carrega session_id diferente do contexto ativo,
# ainda loga no audit.jsonl (read-append), mas NÃO modifica session-context.json.
if [ -f "$CTX_FILE" ] && [ -n "$SESSION_ID" ]; then
    CTX_ACTIVE_SID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    if [ -n "$CTX_ACTIVE_SID" ] && [ "$SESSION_ID" != "$CTX_ACTIVE_SID" ]; then
        CTX_SOURCE="$(jq -r '.session.source // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        if [ "$CTX_SOURCE" = "manual_recovery" ]; then
            NOW_HEAL="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
            if command -v sponge &> /dev/null; then
                jq --arg real_sid "$SESSION_ID" --arg ts "$NOW_HEAL" \
                    '.session.id = $real_sid | .session.source = "healed_from_real_session" | .session.healed_at = $ts' \
                    "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
            else
                _TMP_HEAL="$(mktemp)"
                if jq --arg real_sid "$SESSION_ID" --arg ts "$NOW_HEAL" \
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
                --arg new "$SESSION_ID" \
                --arg source "pre-tool-use.sh" \
                --arg tool "$TOOL_NAME" \
                --arg ts "${TIMESTAMP:-$NOW_HEAL}" \
                '{event: $event, old_session_id: $old, new_session_id: $new, source: $source, tool: $tool, timestamp: $ts,
                  message: "CTX manual_recovery adotado: session_id atualizado para sessão real do Copilot"}' \
                >> "$LOG_DIR/audit.jsonl"
            # SESSION_ID já tem o valor correto — continua
        else
            jq -cn \
                --arg event "session_id_mismatch" \
                --arg expected "$CTX_ACTIVE_SID" \
                --arg got "$SESSION_ID" \
                --arg source "pre-tool-use.sh" \
                --arg tool "$TOOL_NAME" \
                --arg ts "${TIMESTAMP:-}" \
                '{
                    event:   $event,
                    expected: $expected,
                    got:      $got,
                    source:   $source,
                    tool:     $tool,
                    timestamp: $ts,
                    message:  "Payload session_id diferente do contexto ativo — state write bloqueado"
                }' >> "$LOG_DIR/audit.jsonl"
            exit 0
        fi
    fi
fi

# ── Atualiza contexto — Schema v2 ────────────────────────────────────────────
# Atualiza 3 blocos separados:
#   last_tool.*       → sobrescrito a cada chamada (âmbito: chamada)
#   current_turn.*    → acumula até agentStop (âmbito: turno)
#   session_stats.*   → acumula até sessionEnd (âmbito: sessão)
# Quando vscode_askQuestions: seta current_turn.auth_requested = true
# NOTA: NÃO sobrescreve .session.id (removido no HARDENING v5 — session_id é
#       definido apenas por session-start.sh; sobrescrever aqui causava contaminação).
if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
    if [ "$TOOL_NAME" = "vscode_askQuestions" ]; then
        jq --arg ts "$TIMESTAMP" \
            --arg tool "$TOOL_NAME" --arg id "$TOOL_USE_ID" \
            '.last_tool.name   = $tool
             | .last_tool.ts     = $ts
             | .last_tool.use_id = $id
             | .last_tool.result = null
             | .current_turn.auth_requested    = true
             | .current_turn.auth_requested_at = $ts
             | .current_turn.tools_count   = ((.current_turn.tools_count // 0) + 1)
             | .current_turn.tools_by_name = ((.current_turn.tools_by_name // {}) | .[$tool] = ((. // {})[$tool] // 0) + 1)
             | .session_stats.tools_total   = ((.session_stats.tools_total // 0) + 1)
             | .session_stats.tools_by_name = ((.session_stats.tools_by_name // {}) | .[$tool] = ((. // {})[$tool] // 0) + 1)
             | .current_section.tools_by_name = ((.current_section.tools_by_name // {}) | .[$tool] = ((. // {})[$tool] // 0) + 1)' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    elif [ "$TOOL_NAME" = "runSubagent" ]; then
        # ── HARDENING: delegação ao subagente = autorização implícita ─────────
        # runSubagent dispara agentStop no agente pai antes do subagente iniciar.
        # Sem este tratamento, o sistema marca o turno como UNAUTHORIZED — falso positivo.
        # Solução: setamos auth_requested=true E subagent_delegated=true no contexto,
        # e logamos evento "subagentStart" no audit.jsonl como sinal de autorização.
        _SUBAGENT_DESCRIPTION="$(echo "$INPUT" | jq -r '.tool_input.description // .tool_input.prompt // "(sem descrição)"' 2> /dev/null | head -c 200 || echo '(sem descrição)')"
        jq -cn \
            --arg event "subagentStart" \
            --arg sid "$SESSION_ID" \
            --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
            --arg description "$_SUBAGENT_DESCRIPTION" \
            --arg tool_use_id "$TOOL_USE_ID" \
            '{
                event:          $event,
                session_id:     $sid,
                timestamp:      $ts,
                tool_use_id:    $tool_use_id,
                description:    $description,
                auth_implicit:  true,
                message:        "runSubagent chamado — delegação legítima de trabalho (autorização implícita)"
            }' >> "$LOG_DIR/audit.jsonl"
        jq --arg ts "$TIMESTAMP" \
            --arg tool "$TOOL_NAME" --arg id "$TOOL_USE_ID" \
            --arg desc "$_SUBAGENT_DESCRIPTION" \
            '.last_tool.name   = $tool
             | .last_tool.ts     = $ts
             | .last_tool.use_id = $id
             | .last_tool.result = null
             | .current_turn.auth_requested       = true
             | .current_turn.auth_requested_at    = $ts
             | .current_turn.subagent_delegated   = true
             | .current_turn.subagent_description = $desc
             | .current_turn.tools_count   = ((.current_turn.tools_count // 0) + 1)
             | .current_turn.tools_by_name = ((.current_turn.tools_by_name // {}) | .[$tool] = ((. // {})[$tool] // 0) + 1)
             | .session_stats.tools_total   = ((.session_stats.tools_total // 0) + 1)
             | .session_stats.subagent_calls = ((.session_stats.subagent_calls // 0) + 1)
             | .session_stats.tools_by_name = ((.session_stats.tools_by_name // {}) | .[$tool] = ((. // {})[$tool] // 0) + 1)
             | .current_section.tools_by_name = ((.current_section.tools_by_name // {}) | .[$tool] = ((. // {})[$tool] // 0) + 1)' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    else
        jq --arg ts "$TIMESTAMP" \
            --arg tool "$TOOL_NAME" --arg id "$TOOL_USE_ID" \
            '.last_tool.name   = $tool
             | .last_tool.ts     = $ts
             | .last_tool.use_id = $id
             | .last_tool.result = null
             | .current_turn.tools_count   = ((.current_turn.tools_count // 0) + 1)
             | .current_turn.tools_by_name = ((.current_turn.tools_by_name // {}) | .[$tool] = ((. // {})[$tool] // 0) + 1)
             | .session_stats.tools_total   = ((.session_stats.tools_total // 0) + 1)
             | .session_stats.tools_by_name = ((.session_stats.tools_by_name // {}) | .[$tool] = ((. // {})[$tool] // 0) + 1)
             | .current_section.tools_by_name = ((.current_section.tools_by_name // {}) | .[$tool] = ((. // {})[$tool] // 0) + 1)' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    fi
fi

# NÃO emite JSON de decision — autonomia total do agente.
# Exit 0 garante que o agente nunca é bloqueado por este hook.
exit 0
