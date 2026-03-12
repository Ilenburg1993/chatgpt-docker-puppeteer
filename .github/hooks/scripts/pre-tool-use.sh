#!/bin/bash
# pre-tool-use.sh — Hook preToolUse do Copilot
# Executado ANTES de cada uso de ferramenta pelo agente.
# Input JSON (stdin): {timestamp, hook_event_name, session_id, transcript_path,
#                      tool_name, tool_input, tool_use_id, cwd}
# Schema verificado empiricamente em 2026-03-09 (vide raw-input.jsonl diagnóstico).
#
# PROTOCOLO SESSION PERSISTENTE (v8.0):
#   - session-close.sh NUNCA pode ser chamado diretamente pelo agente.
#   - Apenas post-tool-use.sh pode acionar session-close.sh (detectando KEY via vscode_askQuestions).
#   - Qualquer tentativa de run_in_terminal com session-close.sh → permissionDecision:deny.
#   - Isso previne o "Mechanism 5": agente hallucinar KEY e chamar o script diretamente.
#
# SEGURANÇA: credentials são redactados antes de qualquer log.
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
    source "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null \
        || echo "[warn] common.sh falhou ao carregar em pre-tool-use.sh" >&2
else
    echo "[warn] common.sh não encontrado (pre-tool-use.sh) — funções compartilhadas indisponíveis" >&2
fi

# CRÍTICO-1 FIX: lê stdin e resolve per-session ANTES de abrir o flock (fd 9)
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
# UPG-AUDIT-01: resolve per-session paths ANTES do flock (override CTX_FILE, AUDIT_FILE)
if command -v resolve_audit_file > /dev/null 2>&1 && [ -n "${SESSION_ID:-}" ]; then
    _SID_SHORT="${SESSION_ID:0:8}"
    CTX_FILE="$(resolve_ctx_file "$_SID_SHORT")"
    AUDIT_FILE="$(resolve_audit_file "$_SID_SHORT")"
    mkdir -p "$(dirname "$CTX_FILE")" "$(dirname "$AUDIT_FILE")" 2> /dev/null || true
fi

# G9-08/BUG-A.1: Lock exclusivo APÓS resolver CTX_FILE per-session
# Garante que pre-tool-use.sh não corre com agent-stop.sh, post-tool-use.sh ou log-prompt.sh.
_CTX_LOCK="${CTX_FILE}.lock"
exec 9> "$_CTX_LOCK"
if command -v flock > /dev/null 2>&1; then
    flock -x -w 3 9 2> /dev/null
fi

# Serializa tool_input (objeto JSON) para string redactável
TOOL_INPUT_RAW="$(echo "$INPUT" | jq -c '.tool_input // {}' 2> /dev/null || echo '{}')"

# G9-11 Camada 0: Redaction estrutural — remove chaves JSON sensíveis por denylist.
# Opera antes da redact_credentials (regex) para cobrir campos aninhados não pegáveis por regex.
if command -v strip_sensitive_json_keys > /dev/null 2>&1; then
    TOOL_INPUT_RAW="$(strip_sensitive_json_keys "$TOOL_INPUT_RAW")"
fi

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
    }' >> "$AUDIT_FILE"

# ── Auto-recovery: cria contexto mínimo se session-context.json estiver vazio ─
# Se sessionStart não disparou (bug conhecido), o sistema inteiro fica degradado.
# Detectamos isso aqui (preToolUse é o primeiro hook frequente) e criamos um
# contexto Schema v4 mínimo para restaurar funcionalidade dos guards e métricas.
if [ -n "$SESSION_ID" ] && { [ ! -f "$CTX_FILE" ] || [ ! -s "$CTX_FILE" ]; }; then
    NOW_RECOVERY="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo "$TIMESTAMP")"
    # Hardening v6.0: tenta recuperar a close_key do briefing de sessão antes de criar contexto vazio.
    # Isso evita a discrepância em que auto_recovery cria contexto sem close_key enquanto o
    # briefing exibe uma close_key diferente gerada pelo session-start.sh.
    _RECOVERY_CLOSE_KEY=""
    BRIEFING_FILE_RECOVERY="$STATE_DIR/session-briefing.md"
    if [ -f "$BRIEFING_FILE_RECOVERY" ]; then
        _RECOVERY_CLOSE_KEY="$(grep -oP 'ENCERRAR-[A-F0-9]{8}' "$BRIEFING_FILE_RECOVERY" 2> /dev/null | head -1 || echo '')"
    fi

    # BUG-75 FIX: Validar que close_key do briefing não é stale
    # Se uma cópia do CTX antigo ainda existe em um backup, comparar as chaves
    if [ -n "$_RECOVERY_CLOSE_KEY" ]; then
        _CTX_BACKUP_FILE="$STATE_DIR/session-context.json.bak"
        if [ -f "$_CTX_BACKUP_FILE" ] && [ -s "$_CTX_BACKUP_FILE" ]; then
            _BACKUP_CLOSE_KEY="$(jq -r '.session.close_key // ""' "$_CTX_BACKUP_FILE" 2> /dev/null || echo '')"
            if [ -n "$_BACKUP_CLOSE_KEY" ] && [ "$_RECOVERY_CLOSE_KEY" != "$_BACKUP_CLOSE_KEY" ]; then
                echo "[pre-tool-use] AVISO BUG-75: close_key na briefing (${_RECOVERY_CLOSE_KEY}) != backup CTX (${_BACKUP_CLOSE_KEY}) — pode ser stale" >&2
                # Usar chave do CTX backup como fonte da verdade (mais recente)
                _RECOVERY_CLOSE_KEY="$_BACKUP_CLOSE_KEY"
            fi
        fi
    fi

    # v8.1: herda close_key_validated do flag SESSION_CLOSE_AUTHORIZED se existir.
    # Evita perda do estado de autorização quando VS Code reinicia com mesmo session_id.
    _RECOVERY_KEY_VALIDATED="false"
    _AUTH_FLAG="$STATE_DIR/SESSION_CLOSE_AUTHORIZED.flag"
    if [ -f "$_AUTH_FLAG" ]; then
        _FLAG_SID="$(jq -r '.session_id // ""' "$_AUTH_FLAG" 2> /dev/null || echo '')"
        if [ "$_FLAG_SID" = "$SESSION_ID" ]; then
            _RECOVERY_KEY_VALIDATED="true"
        fi
    fi
    # EBH-M01: atomic write via mktemp; validação de mktemp adicionada (fix Haiku P3.1)
    # Se mktemp falhar (disco cheio, /tmp indisponível), recover é pulado com aviso
    if _RECOVERY_CTX_TMP="$(mktemp 2> /dev/null)"; then
        jq -cn \
            --arg sid "$SESSION_ID" \
            --arg now "$NOW_RECOVERY" \
            --arg close_key "${_RECOVERY_CLOSE_KEY}" \
            --argjson key_validated "$_RECOVERY_KEY_VALIDATED" \
            '{
            session: {
                id: $sid, started_at: $now, ended_at: null, end_reason: null,
                close_key: (if $close_key == "" then null else $close_key end),
                close_key_validated: $key_validated,
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
        }' 2> /dev/null > "$_RECOVERY_CTX_TMP" \
            && mv "$_RECOVERY_CTX_TMP" "$CTX_FILE" 2> /dev/null \
            || rm -f "$_RECOVERY_CTX_TMP" 2> /dev/null

    else
        echo "[warn] pre-tool-use: mktemp falhou; auto_recovery atômico pulado" >&2
    fi

    # Loga o evento de recovery no audit.jsonl
    jq -cn \
        --arg event "session_auto_recovery" \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_RECOVERY" \
        --arg trigger "preToolUse" \
        --arg close_key "${_RECOVERY_CLOSE_KEY}" \
        '{
            event:   $event,
            session_id: $sid,
            timestamp: $ts,
            trigger: $trigger,
            close_key_recovered: (if $close_key == "" then null else $close_key end),
            message: "session-context.json vazio — estado mínimo criado por auto-recovery (v6.0: close_key preservada do briefing)"
        }' >> "$AUDIT_FILE"

    echo "[recovery] session-context.json vazio — criado contexto mínimo para sessão $SESSION_ID" >&2
fi

# ── Guard: session_id deve corresponder ao contexto ativo ─────────────────────
# HARDENING v5: previne contaminação cruzada entre sessões.
# HEAL v1: quando CTX_FILE é de manual_recovery, adota session_id real do Copilot.
# FIX BUG-06: também trata inline_restart — CTX já tem o session_id correto do VS Code
# (BUG-02 garante isso); o payload está stale (sessão anterior). Per PREMISSA 1:
# adotamos SESSION_ID do CTX (VS Code) em vez de bloquear.
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
                    '.session.id = $real_sid | .session.vs_code_session_id = $real_sid | .session.source = "healed_from_real_session" | .session.healed_at = $ts' \
                    "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
            else
                _TMP_HEAL="$(mktemp)"
                if jq --arg real_sid "$SESSION_ID" --arg ts "$NOW_HEAL" \
                    '.session.id = $real_sid | .session.vs_code_session_id = $real_sid | .session.source = "healed_from_real_session" | .session.healed_at = $ts' \
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
                >> "$AUDIT_FILE"
            # SESSION_ID já tem o valor correto — continua
        elif [ "$CTX_SOURCE" = "inline_restart" ]; then
            # FIX BUG-06: inline_restart — CTX tem o session_id correto do VS Code (PREMISSA 1).
            # Payload está stale (compilado com contexto antigo). Adotamos CTX como verdade.
            # Não bloqueamos — apenas sincronizamos a variável local SESSION_ID ao CTX.
            SESSION_ID="$CTX_ACTIVE_SID"
            # GAP-O1: limita log de inline_restart para evitar ruído excessivo
            _SYNCS_INLINE="$(jq -r '.session_stats.session_id_syncs_inline // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
            if [ "$_SYNCS_INLINE" -lt 5 ]; then
                jq -cn \
                    --arg event "session_id_sync_inline_restart" \
                    --arg stale "$SESSION_ID" \
                    --arg adopted "$CTX_ACTIVE_SID" \
                    --arg source "pre-tool-use.sh" \
                    --arg tool "$TOOL_NAME" \
                    --arg ts "${TIMESTAMP:-}" \
                    '{event: $event, stale_payload_sid: $stale, adopted_ctx_sid: $adopted,
                      source: $source, tool: $tool, timestamp: $ts,
                      message: "inline_restart: payload stale — adotado session_id do CTX (VS Code, PREMISSA 1)"}' \
                    >> "$AUDIT_FILE"
            elif [ "$_SYNCS_INLINE" -eq 5 ]; then
                jq -cn --arg event "session_id_sync_inline_restart_cap" --arg source "pre-tool-use.sh" \
                    '{event: $event, source: $source, message: "inline_restart sync count reached cap (5) — logs suprimidos daqui em diante"}' \
                    >> "$AUDIT_FILE"
            fi
            # GAP-03: incrementa contador de syncs inline no CTX
            if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
                jq '.session_stats.session_id_syncs_inline = ((.session_stats.session_id_syncs_inline // 0) + 1)' \
                    "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
            fi
            # Continua normalmente — SESSION_ID agora reflete o CTX correto
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
                }' >> "$AUDIT_FILE"
            # GAP-03: incrementa contador de mismatches no CTX antes de sair
            if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
                jq '.session_stats.session_id_mismatches = ((.session_stats.session_id_mismatches // 0) + 1)' \
                    "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
            fi
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
    elif [ "$TOOL_NAME" = "runSubagent" ] || [ "$TOOL_NAME" = "search_subagent" ]; then
        # ── HARDENING: delegação ao subagente = autorização implícita ─────────
        # runSubagent e search_subagent (ambas ferramentas Core) disparam agentStop
        # no agente pai antes do subagente iniciar.
        # Sem este tratamento, o sistema marca o turno como UNAUTHORIZED — falso positivo.
        # Solução: setamos auth_requested=true E subagent_delegated=true no contexto,
        # e logamos evento "subagentStart" no audit.jsonl como sinal de autorização.
        # FIX BUG-03: search_subagent agora também é reconhecido (equivalente a runSubagent).
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
            }' >> "$AUDIT_FILE"
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
             # FIX BUG-04: subagent_calls NÃO incrementado aqui — subagent-start.sh é o local correto
             # (evita double-count: pre-tool-use.sh + subagent-start.sh = 2x por subagente)
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

# ── Hardening v8.0: BLOQUEIO do Mecanismo 5 — session-close.sh sem KEY ───────
# O agente NUNCA deve chamar session-close.sh diretamente via run_in_terminal.
# O único fluxo legítimo é:
#   (1) agente → vscode_askQuestions Template F (exibe close_key)
#   (2) usuário digita ENCERRAR-XXXXXXXX
#   (3) post-tool-use.sh detecta KEY na resposta → chama session-close.sh automaticamente
#
# Se o agente tentar chamar session-close.sh diretamente (com ou sem KEY), este
# guard NEGA a chamada e explica o fluxo correto. Isso previne:
#   - Hallucinations de KEY pelo agente
#   - Chamadas diretas acidentais ou intencionais ao script de encerramento
#
# EXCEÇÃO: se close_key_validated=true (post-tool-use.sh já detectou a KEY via
# vscode_askQuestions legítimo), permitimos a chamada — pois post-tool-use.sh
# pode executar o script automaticamente ou o agente pode fazê-lo como fallback.
if [ "$TOOL_NAME" = "run_in_terminal" ]; then
    _M5_CMD="$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2> /dev/null || echo '')"
    if echo "$_M5_CMD" | grep -q "session-close\.sh"; then
        _M5_VALIDATED=false
        if [ -f "$CTX_FILE" ]; then
            _M5_VALIDATED="$(jq -r '.session.close_key_validated // false' "$CTX_FILE" 2> /dev/null || echo 'false')"
        fi
        if [ "$_M5_VALIDATED" != "true" ]; then
            _M5_KEY="$(jq -r '.session.close_key // "N/A"' "$CTX_FILE" 2> /dev/null || echo 'N/A')"
            # Loga tentativa bloqueada
            jq -cn \
                --arg event "sessionClose_direct_blocked" \
                --arg sid "$SESSION_ID" \
                --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
                --arg cmd "$_M5_CMD" \
                --arg tool "$TOOL_NAME" \
                '{
                    event:      $event,
                    session_id: $sid,
                    timestamp:  $ts,
                    tool:       $tool,
                    command:    $cmd,
                    message:    "BLOQUEADO: agente tentou chamar session-close.sh diretamente sem KEY validada"
                }' >> "$AUDIT_FILE" 2> /dev/null || true
            # Nega a ferramenta com contexto explicativo
            jq -cn \
                --arg key "$_M5_KEY" \
                '{
                    permissionDecision: "deny",
                    additionalContext: (
                        "🚫 BLOQUEADO (v8.0 — Mechanism 5 Guard): session-close.sh NÃO pode ser chamado diretamente pelo agente.\n\n" +
                        "O fluxo CORRETO e ÚNICO para encerrar SESSION é:\n" +
                        "  (1) Chamar vscode_askQuestions com Template F (exibindo a close_key)\n" +
                        "  (2) Aguardar o usuário digitar " + $key + " na resposta\n" +
                        "  (3) post-tool-use.sh detecta automaticamente a KEY e executa session-close.sh\n\n" +
                        "O agente NUNCA deve chamar session-close.sh diretamente — nem mesmo com a KEY correta.\n" +
                        "SESSION end = EVENTO EXTREMAMENTE RARO. Apenas o usuário autoriza via Template F."
                    )
                }'
            exit 0
        fi
    fi
fi

# ── SESSION REMINDER por intervalo de ferramentas ────────────────────────────
# CONTEXTO: userPromptSubmitted dispara APENAS para mensagens digitadas na caixa
# de chat (não para respostas de vscode_askQuestions, que são tool results).
# Em sessões onde o usuário interage apenas via askQuestions, userPromptSubmitted
# dispara raramente. Por isso, o remineder de SESSION é injetado aqui (preToolUse),
# que dispara ANTES de cada ferramenta — o ponto mais confiável da sessão.
#
# Frequência: a cada HOOKS_SESSION_REMINDER_TOOL_INTERVAL ferramentas (padrão: 10)
# Condição: apenas quando close_key_validated=false (SESSION ainda aberta sem confirmação)
_SR_INTERVAL="${HOOKS_SESSION_REMINDER_TOOL_INTERVAL:-10}"
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ]; then
    _SR_TOOLS_TOTAL="$(jq -r '.session_stats.tools_total // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    _SR_CLOSE_VALIDATED="$(jq -r '.session.close_key_validated // false' "$CTX_FILE" 2> /dev/null || echo 'false')"
    _SR_CLOSE_KEY="$(jq -r '.session.close_key // "N/A"' "$CTX_FILE" 2> /dev/null || echo 'N/A')"
    # Dispara no intervalo configurado (excluindo tool#0 pois contexto pode não estar pronto)
    if [ "$_SR_TOOLS_TOTAL" -gt 0 ] && ((_SR_TOOLS_TOTAL % _SR_INTERVAL == 0)) && [ "$_SR_CLOSE_VALIDATED" = "false" ]; then
        # Loga reminder no audit antes de emitir systemMessage
        jq -cn \
            --arg sid "$SESSION_ID" \
            --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
            --argjson tool_num "$_SR_TOOLS_TOTAL" \
            --arg key "$_SR_CLOSE_KEY" \
            '{
                event:      "sessionReminder_preToolUse",
                session_id: $sid,
                timestamp:  $ts,
                tool_number: $tool_num,
                close_key:  $key,
                message:    "SESSION reminder emitido via preToolUse (intervalo de ferramentas)"
            }' >> "$AUDIT_FILE" 2> /dev/null || true
        # Emite systemMessage para o agente (SESSION reminder conciso)
        jq -cn \
            --arg key "$_SR_CLOSE_KEY" \
            --argjson n "$_SR_TOOLS_TOTAL" \
            --arg interval "$_SR_INTERVAL" \
            '{systemMessage: ("🔐 SESSION REMINDER [tool #" + ($n|tostring) + "] — SESSION≠SECTION≠TURN. Para encerrar esta SESSION: (1) vscode_askQuestions Template F exibindo a KEY (2) usuário digita " + $key + " (3) bash .github/hooks/scripts/session-close.sh \"" + $key + "\". Texto plano não conta — apenas tool call real. Próximo reminder em " + ($n + ($interval|tonumber) | tostring) + " ferramentas.")}' 2> /dev/null || true
        exit 0
    fi
fi

# NÃO emite JSON de decision — autonomia total do agente.
# Exit 0 garante que o agente nunca é bloqueado por este hook.
exit 0
