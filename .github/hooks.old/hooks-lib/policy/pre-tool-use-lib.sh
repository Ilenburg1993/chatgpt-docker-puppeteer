#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail

run_pre_tool_use_hook() {
    local HOOK_DIR="${1:-}"
    if [ -z "$HOOK_DIR" ]; then
        HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
    fi

    (
        LOG_DIR="$HOOK_DIR/logs"
        STATE_DIR="$HOOK_DIR/state"
        CTX_FILE="$STATE_DIR/session-context.json"

        mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"

        # G9-11/GAP-C.1: Carrega biblioteca de funções compartilhadas (redact_credentials, iso_now, etc.)
        # shellcheck disable=SC1090,SC1091
        if [ -f "$HOOK_DIR/hooks-lib/common.sh" ]; then
            source "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null \
                || echo "[warn] common.sh falhou ao carregar em pre-tool-use.sh" >&2
        else
            echo "[warn] common.sh não encontrado (pre-tool-use.sh) — funções compartilhadas indisponíveis" >&2
        fi

        # shellcheck disable=SC1090,SC1091
        if [ -f "$HOOK_DIR/hooks-lib/policy.sh" ]; then
            source "$HOOK_DIR/hooks-lib/policy.sh" 2> /dev/null \
                || echo "[warn] policy.sh falhou ao carregar em pre-tool-use.sh" >&2
        else
            echo "[warn] policy.sh não encontrado (pre-tool-use.sh) — helpers de policy indisponíveis" >&2
        fi

        # CRÍTICO-1 FIX: lê stdin e resolve per-session ANTES de abrir o flock (fd 9)
        if command -v resolve_hook_runtime_input > /dev/null 2>&1; then
            resolve_hook_runtime_input
        else
            INPUT="$(cat 2> /dev/null || true)"
            TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
            SESSION_ID_PAYLOAD="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"
            NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
            apply_per_session_paths "${SESSION_ID_PAYLOAD:-}" 2> /dev/null || true
        fi

        # Extrai campos usando o schema real (snake_case, não camelCase)
        _LOCAL_TS="${NOW_ISO:-$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')}"
        CWD="$(echo "$INPUT" | jq -r '.cwd // ""' 2> /dev/null || echo '')"
        TOOL_NAME="$(echo "$INPUT" | jq -r '.tool_name // ""' 2> /dev/null || echo '')"
        TOOL_USE_ID="$(echo "$INPUT" | jq -r '.tool_use_id // ""' 2> /dev/null || echo '')"

        # session_id vem diretamente do payload (UUID real do Copilot)
        SESSION_ID="${SESSION_ID_PAYLOAD:-}"
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

        ctx_apply_expr() {
            local expr="${1:-}"
            shift || true

            [ -n "$expr" ] || return 1
            [ -f "$CTX_FILE" ] || return 1

            if command -v ctx_apply_jq_expr_best_effort > /dev/null 2>&1; then
                ctx_apply_jq_expr_best_effort "$expr" "$@" > /dev/null 2>&1 || true
                return 0
            fi

            if command -v sponge > /dev/null 2>&1; then
                jq "$@" "$expr" "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
            else
                local _tmp_ctx
                if _tmp_ctx="$(mktemp 2> /dev/null)"; then
                    if jq "$@" "$expr" "$CTX_FILE" > "$_tmp_ctx" 2> /dev/null; then
                        mv "$_tmp_ctx" "$CTX_FILE" 2> /dev/null || rm -f "$_tmp_ctx"
                    else
                        rm -f "$_tmp_ctx"
                    fi
                fi
            fi

            return 0
        }

        # Serializa tool_input (objeto JSON) para string redactável
        TOOL_INPUT_RAW="$(echo "$INPUT" | jq -c '.tool_input // {}' 2> /dev/null || echo '{}')"

        # ── Hardening: askQuestions exige refresh imediato de TODO ─────────────────
        # Regra: após qualquer vscode_askQuestions, a próxima ferramenta deve ser
        # manage_todo_list para atualização imediata do checklist.
        TODO_REFRESH_REQUIRED="false"
        TODO_REFRESH_REQUIRED_AT=""
        if [ -f "$CTX_FILE" ]; then
            TODO_REFRESH_REQUIRED="$(jq -r '.current_turn.todo_refresh_required // false' "$CTX_FILE" 2> /dev/null || echo false)"
            TODO_REFRESH_REQUIRED_AT="$(jq -r '.current_turn.todo_refresh_required_at // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        fi

        if [ "$TODO_REFRESH_REQUIRED" = "true" ] && [ "$TOOL_NAME" != "manage_todo_list" ]; then
            jq -cn \
                --arg event "todo_refresh_required_pretool_deny" \
                --arg sid "$SESSION_ID" \
                --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
                --arg tool "$TOOL_NAME" \
                --arg tool_use_id "$TOOL_USE_ID" \
                --arg required_at "$TODO_REFRESH_REQUIRED_AT" \
                '{
                    event: $event,
                    session_id: $sid,
                    timestamp: $ts,
                    tool_name: $tool,
                    tool_use_id: $tool_use_id,
                    required_since: (if $required_at == "" then null else $required_at end),
                    message: "Bloqueado no preToolUse: após askQuestions, refresh imediato de TODO é obrigatório"
                }' >> "$AUDIT_FILE" 2> /dev/null || true

            jq -cn \
                '{
                    permissionDecision: "deny",
                    additionalContext: "Protocolo TODO hardening: após chamar vscode_askQuestions, execute imediatamente manage_todo_list para atualizar o checklist. Só depois retome outras ferramentas."
                }'
            exit 0
        fi

        # ── Hardening anti-loop (fallback): snapshot do stop_hook_active sem auth válida ──
        # Em alguns cenários de recovery, o subturn pode não estar sincronizado no contexto,
        # mas o contrato de autorização já sinaliza stop_hook_active=true + auth_requested=false.
        # Neste caso, bloquear qualquer ferramenta não-bookkeeping para evitar cascata de reblock.
        TURN_AUTH_CTX_FILE="$STATE_DIR/turn-authorization-context.json"
        if [ -f "$TURN_AUTH_CTX_FILE" ] && [ -f "$CTX_FILE" ]; then
            _TA_SID="$(jq -r '.session_id // ""' "$TURN_AUTH_CTX_FILE" 2> /dev/null || echo '')"
            _TA_STOP_ACTIVE="$(jq -r '.stop_hook_active // false' "$TURN_AUTH_CTX_FILE" 2> /dev/null || echo false)"
            _TA_AUTH_REQUESTED="$(jq -r '.auth_requested // false' "$TURN_AUTH_CTX_FILE" 2> /dev/null || echo false)"
            _TA_TS="$(jq -r '.timestamp // ""' "$TURN_AUTH_CTX_FILE" 2> /dev/null || echo '')"
            _TURN_STARTED_AT="$(jq -r '.current_turn.started_at // ""' "$CTX_FILE" 2> /dev/null || echo '')"

            _TA_IS_FRESH="false"
            if [ -n "$_TA_TS" ] && [ -n "$_TURN_STARTED_AT" ]; then
                if [[ "$_TA_TS" > "$_TURN_STARTED_AT" || "$_TA_TS" == "$_TURN_STARTED_AT" ]]; then
                    _TA_IS_FRESH="true"
                fi
            fi

            if [ -n "$SESSION_ID" ] \
                && [ "$_TA_SID" = "$SESSION_ID" ] \
                && [ "$_TA_STOP_ACTIVE" = "true" ] \
                && [ "$_TA_IS_FRESH" = "true" ] \
                && [ "$_TA_AUTH_REQUESTED" != "true" ] \
                && [ "$TOOL_NAME" != "vscode_askQuestions" ] \
                && [ "$TOOL_NAME" != "manage_todo_list" ]; then
                jq -cn \
                    --arg event "stop_hook_active_pending_pretool_deny" \
                    --arg sid "$SESSION_ID" \
                    --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
                    --arg tool "$TOOL_NAME" \
                    --arg tool_use_id "$TOOL_USE_ID" \
                    --arg snapshot_ts "$_TA_TS" \
                    --arg turn_started_at "$_TURN_STARTED_AT" \
                    ' {
                        event: $event,
                        session_id: $sid,
                        timestamp: $ts,
                        tool_name: $tool,
                        tool_use_id: $tool_use_id,
                        snapshot_ts: (if $snapshot_ts == "" then null else $snapshot_ts end),
                        turn_started_at: (if $turn_started_at == "" then null else $turn_started_at end),
                        message: "Ferramenta bloqueada: snapshot de stop_hook_active pendente sem autorização"
                    }' >> "$AUDIT_FILE" 2> /dev/null || true

                jq -cn \
                    '{
                        permissionDecision: "deny",
                        additionalContext: "TURN segue em estado pendente de desbloqueio (stop_hook_active sem autorização válida). Antes de qualquer outra ferramenta de trabalho, regularize via vscode_askQuestions e, se necessário, manage_todo_list."
                    }'
                exit 0
            fi
        fi

        # ── Hardening anti-loop: turno bloqueado exige askQuestions antes de novo trabalho ──
        # Quando agent-stop marca subturn como `blocked/stop_block_resume_pending`,
        # somente manage_todo_list e vscode_askQuestions são permitidos.
        if [ -f "$CTX_FILE" ]; then
            _SB_STATE="$(jq -r '.current_turn.subturn.state // ""' "$CTX_FILE" 2> /dev/null || echo '')"
            _SB_REASON="$(jq -r '.current_turn.subturn.reason // ""' "$CTX_FILE" 2> /dev/null || echo '')"
            if [ "$_SB_STATE" = "blocked" ] && [ "$_SB_REASON" = "stop_block_resume_pending" ] \
                && [ "$TOOL_NAME" != "vscode_askQuestions" ] \
                && [ "$TOOL_NAME" != "manage_todo_list" ]; then
                jq -cn \
                    --arg event "stop_block_resume_pending_pretool_deny" \
                    --arg sid "$SESSION_ID" \
                    --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
                    --arg tool "$TOOL_NAME" \
                    --arg tool_use_id "$TOOL_USE_ID" \
                    '{
                        event: $event,
                        session_id: $sid,
                        timestamp: $ts,
                        tool_name: $tool,
                        tool_use_id: $tool_use_id,
                        message: "Ferramenta bloqueada: turno está em stop_block_resume_pending aguardando askQuestions"
                    }' >> "$AUDIT_FILE" 2> /dev/null || true

                jq -cn \
                    '{
                        permissionDecision: "deny",
                        additionalContext: "TURN está bloqueado aguardando regularização. Antes de qualquer outra ferramenta de trabalho, chame vscode_askQuestions (e, se necessário, atualize manage_todo_list) para destravar o fluxo."
                    }'
                exit 0
            fi
        fi

        # ── Compliance de leitura obrigatória (início/retomada de sessão) ──────────
        # Marca documentos obrigatórios como lidos quando o agente usa read_file
        # em session-briefing.md, pending-tasks.md e session-context.json.
        if [ "$TOOL_NAME" = "read_file" ] && [ -f "$CTX_FILE" ]; then
            READ_FILE_PATH="$(echo "$INPUT" | jq -r '.tool_input.filePath // ""' 2> /dev/null || echo '')"
            REQUIRED_DOC_KEY=""
            case "$READ_FILE_PATH" in
                */.github/hooks/state/session-briefing.md)
                    REQUIRED_DOC_KEY="session-briefing.md"
                    ;;
                */.github/hooks/state/pending-tasks.md)
                    REQUIRED_DOC_KEY="pending-tasks.md"
                    ;;
                */.github/hooks/state/session-context.json)
                    REQUIRED_DOC_KEY="session-context.json"
                    ;;
            esac

            if [ -n "$REQUIRED_DOC_KEY" ]; then
                ctx_apply_expr \
                    '.current_turn.required_docs_pending = ((.current_turn.required_docs_pending // []) | map(select(. != $doc)))
                     | .current_turn.required_docs_read_log = ((.current_turn.required_docs_read_log // []) + [{doc: $doc, path: $path, ts: $ts}] | if length > 20 then .[-20:] else . end)
                     | .current_turn.required_docs_last_read_at = $ts
                     | .current_turn.required_docs_status = (if ((.current_turn.required_docs_pending // []) | length) == 0 then "completed" else "pending" end)' \
                    --arg doc "$REQUIRED_DOC_KEY" \
                    --arg path "$READ_FILE_PATH" \
                    --arg ts "${TIMESTAMP:-$_LOCAL_TS}"

                jq -cn \
                    --arg event "requiredDoc_read" \
                    --arg sid "$SESSION_ID" \
                    --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
                    --arg doc "$REQUIRED_DOC_KEY" \
                    --arg path "$READ_FILE_PATH" \
                    --arg tool_use_id "$TOOL_USE_ID" \
                    '{
                        event: $event,
                        session_id: $sid,
                        timestamp: $ts,
                        required_doc: $doc,
                        file_path: $path,
                        tool_use_id: $tool_use_id,
                        message: "Documento obrigatório de sessão lido"
                    }' >> "$AUDIT_FILE" 2> /dev/null || true
            fi
        fi

        TODO_LAST_ITEM_LABEL=""
        TODO_LAST_ITEM_IS_CONTINUATION="false"
        TODO_LAST_ITEM_IS_ASKQUESTIONS="false"
        if [ "$TOOL_NAME" = "manage_todo_list" ]; then
            TODO_LAST_ITEM_LABEL="$(echo "$INPUT" | jq -r '.tool_input.todoList[-1].title // ""' 2> /dev/null || echo '')"
            if printf '%s\n' "$TODO_LAST_ITEM_LABEL" | grep -qiE 'vscode_askQuestions'; then
                TODO_LAST_ITEM_IS_ASKQUESTIONS="true"
            fi
            if [ "$TODO_LAST_ITEM_IS_ASKQUESTIONS" = "true" ] \
                && printf '%s\n' "$TODO_LAST_ITEM_LABEL" | grep -qiE 'continua|continuacao|template[[:space:]]*(a|d|e)|next[[:space:]]*step|checkpoint'; then
                TODO_LAST_ITEM_IS_CONTINUATION="true"
            fi
        fi

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

        if [ "$TOOL_NAME" = "manage_todo_list" ]; then
            jq -cn \
                --arg event "todoProtocol_checked" \
                --arg sid "$SESSION_ID" \
                --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
                --arg tool_use_id "$TOOL_USE_ID" \
                --arg last_item "$TODO_LAST_ITEM_LABEL" \
                --argjson compliant "$TODO_LAST_ITEM_IS_CONTINUATION" \
                '{
                    event: $event,
                    session_id: $sid,
                    timestamp: $ts,
                    tool_use_id: $tool_use_id,
                    last_item: (if $last_item == "" then null else $last_item end),
                    compliant: $compliant,
                    message: "Checklist de TODO validado: último item deve ser askQuestions de continuação"
                }' >> "$AUDIT_FILE" 2> /dev/null || true

            if [ "$TODO_LAST_ITEM_IS_CONTINUATION" != "true" ]; then
                jq -cn \
                    --arg event "todoProtocol_violation_last_item" \
                    --arg sid "$SESSION_ID" \
                    --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
                    --arg tool_use_id "$TOOL_USE_ID" \
                    --arg last_item "$TODO_LAST_ITEM_LABEL" \
                    '{
                        event: $event,
                        session_id: $sid,
                        timestamp: $ts,
                        tool_use_id: $tool_use_id,
                        last_item: (if $last_item == "" then null else $last_item end),
                        message: "Violação do template de TODO: último item não é askQuestions de continuação"
                    }' >> "$AUDIT_FILE" 2> /dev/null || true

                jq -cn \
                    --arg event "todoProtocol_pretool_deny_last_item" \
                    --arg sid "$SESSION_ID" \
                    --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
                    --arg tool_use_id "$TOOL_USE_ID" \
                    --arg last_item "$TODO_LAST_ITEM_LABEL" \
                    '{
                        event: $event,
                        session_id: $sid,
                        timestamp: $ts,
                        tool_use_id: $tool_use_id,
                        last_item: (if $last_item == "" then null else $last_item end),
                        message: "Bloqueado no preToolUse: último TODO precisa ser askQuestions de continuação"
                    }' >> "$AUDIT_FILE" 2> /dev/null || true

                jq -cn \
                    '{
                        permissionDecision: "deny",
                        additionalContext: "Protocolo TODO v9.0: o último item do manage_todo_list deve ser chamada de vscode_askQuestions de continuação (Template A/D/E). Ajuste a lista e tente novamente."
                    }'
                exit 0
            fi
        fi

        if [ "$TOOL_NAME" = "vscode_askQuestions" ]; then
            ASK_TEMPLATE_F_PRE=false
            ASK_HAS_TEMPLATE_F_OPTION_PRE=false

            if command -v policy_input_is_template_f > /dev/null 2>&1 \
                && policy_input_is_template_f "$INPUT"; then
                ASK_TEMPLATE_F_PRE=true
                ASK_HAS_TEMPLATE_F_OPTION_PRE=true
            elif echo "$INPUT" | jq -e '
                    [
                        (.tool_input.questions? // [])[]?
                        | ((.header // "") + " " + (.question // ""))
                    ]
                    | any(test("encerrar[^\\n]{0,60}sess(ã|a)o|encerrar session|session close|close key|chave de encerramento|ENCERRAR-[A-F0-9]{8}"; "i"))
                ' > /dev/null 2>&1; then
                ASK_TEMPLATE_F_PRE=true
                ASK_HAS_TEMPLATE_F_OPTION_PRE=true
            fi

            if [ "$ASK_HAS_TEMPLATE_F_OPTION_PRE" != "true" ] \
                && command -v policy_input_has_template_f_option > /dev/null 2>&1 \
                && policy_input_has_template_f_option "$INPUT"; then
                ASK_HAS_TEMPLATE_F_OPTION_PRE=true
            elif echo "$INPUT" | jq -e '
                    [
                        (.tool_input.questions? // [])[]?
                        | (.options? // [])[]?
                        | ((.label // "") + " " + (.description // ""))
                    ]
                    | any(test("template f|encerrar sess(ã|a)o|session close|close key|escalar"; "i"))
                ' > /dev/null 2>&1; then
                ASK_HAS_TEMPLATE_F_OPTION_PRE=true
            fi

            TEMPLATE_F_PENDING_PRE="false"
            if [ -f "$CTX_FILE" ]; then
                TEMPLATE_F_PENDING_PRE="$(jq -r '.session.template_f_request_pending // false' "$CTX_FILE" 2> /dev/null || echo false)"
            fi

            if [ "$ASK_TEMPLATE_F_PRE" != "true" ] && [ "$ASK_HAS_TEMPLATE_F_OPTION_PRE" != "true" ]; then
                jq -cn \
                    --arg event "askQuestions_pretool_deny_missing_template_f_option" \
                    --arg sid "$SESSION_ID" \
                    --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
                    --arg tool_use_id "$TOOL_USE_ID" \
                    '{
                        event: $event,
                        session_id: $sid,
                        timestamp: $ts,
                        tool_use_id: $tool_use_id,
                        message: "Bloqueado no preToolUse: askQuestions sem opção de escalonamento para Template F"
                    }' >> "$AUDIT_FILE" 2> /dev/null || true

                jq -cn \
                    '{
                        permissionDecision: "deny",
                        additionalContext: "Governança de continuidade: inclua no askQuestions uma opção explícita para escalonar ao Template F (fechamento de SESSION) antes de enviar novamente."
                    }'
                exit 0
            fi

            if [ "$ASK_TEMPLATE_F_PRE" = "true" ] && [ "$TEMPLATE_F_PENDING_PRE" != "true" ]; then
                jq -cn \
                    --arg event "askQuestions_pretool_deny_template_f_without_request" \
                    --arg sid "$SESSION_ID" \
                    --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
                    --arg tool_use_id "$TOOL_USE_ID" \
                    '{
                        event: $event,
                        session_id: $sid,
                        timestamp: $ts,
                        tool_use_id: $tool_use_id,
                        message: "Bloqueado no preToolUse: Template F sem solicitação prévia registrada"
                    }' >> "$AUDIT_FILE" 2> /dev/null || true

                jq -cn \
                    '{
                        permissionDecision: "deny",
                        additionalContext: "Template F só pode ser chamado após solicitação explícita de escalonamento em askQuestions anterior. Use Template A/D/E com opção de escalonamento e aguarde a solicitação do usuário."
                    }'
                exit 0
            fi
        fi

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
                        strict_turn_close_requires_key: true,
                        source: "auto_recovery", cwd: null
                    },
                    session_stats: {
                        turn_count: 0, turn_authorized: 0, turn_unauthorized: 0,
                        resume_count: 0,
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
                        intent_declared: false, intent: null,
                        last_non_bookkeeping_tool: null,
                        last_askquestions_template: null,
                        last_askquestions_close_action: null,
                        last_askquestions_close_key_found: false
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
                    },
                    quality_gates: {},
                    session_summary: null,
                    last_turn_ts: null
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

        # ── Backfill canônico da flag strict de fechamento de TURN ──────────────────
        # Contextos legados podem não ter session.strict_turn_close_requires_key.
        # Em modo hardening, a ausência deve convergir para true e ficar persistida.
        if command -v ensure_strict_turn_close_flag_default > /dev/null 2>&1; then
            ensure_strict_turn_close_flag_default "$CTX_FILE" > /dev/null 2>&1 || true
        fi

        # ── Backfill canônico de campos de resumo de sessão ────────────────────────
        # Alguns contextos legados podem não conter estes campos esperados pelo smoke.
        if [ -f "$CTX_FILE" ]; then
            ctx_apply_expr '.session_summary = (.session_summary // null)
                | .last_turn_ts = (.last_turn_ts // null)'
        fi

        # ── Guard: session_id deve corresponder ao contexto ativo ─────────────────────
        # HARDENING v5: previne contaminação cruzada entre sessões.
        # HEAL v1: quando CTX_FILE é de manual_recovery, adota session_id real do Copilot.
        # FIX BUG-06: também trata inline_restart — CTX já tem o session_id correto do VS Code
        # (BUG-02 garante isso); o payload está stale (sessão anterior). Per PREMISSA 1:
        # adotamos SESSION_ID do CTX (VS Code) em vez de bloquear.
        # Guard canônico centralizado em reconcile_session_id_guard_prepost() —
        # emite evento "session_id_mismatch" quando o caso é não recuperável.
        # Se o payload carrega session_id diferente do contexto ativo,
        # ainda loga no audit.jsonl (read-append), mas NÃO modifica session-context.json.
        if [ -f "$CTX_FILE" ] && [ -n "$SESSION_ID" ]; then
            CTX_ACTIVE_SID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
            if [ -n "$CTX_ACTIVE_SID" ] && [ "$SESSION_ID" != "$CTX_ACTIVE_SID" ]; then
                _GUARD_RC=0
                _GUARD_RECONCILED_SID="$(reconcile_session_id_guard_prepost "$SESSION_ID" "$TOOL_NAME" "${TIMESTAMP:-}" "pre-tool-use.sh")" || _GUARD_RC=$?
                if [ -n "$_GUARD_RECONCILED_SID" ]; then
                    SESSION_ID="$_GUARD_RECONCILED_SID"
                fi

                if [ "$_GUARD_RC" -eq 10 ]; then
                    # P0-H053: mesmo em mismatch, saneia recovery stale do CTX ativo.
                    # Isso evita perpetuar alertas falsos quando o bloco recovery foi
                    # contaminado por fixture antiga (sess_test*) ou timestamps futuros.
                    _MM_RCV_MODE="$(jq -r '.recovery.close_mode // "ok"' "$CTX_FILE" 2> /dev/null || echo 'ok')"
                    _MM_RCV_SID="$(jq -r '.recovery.prev_session_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
                    _MM_RCV_TS="$(jq -r '.recovery.prev_session_ts // ""' "$CTX_FILE" 2> /dev/null || echo '')"
                    _MM_RCV_DET="$(jq -r '.recovery.detected_at // ""' "$CTX_FILE" 2> /dev/null || echo '')"
                    _MM_SAN=false
                    _MM_REASON=""

                    case "$_MM_RCV_SID" in
                        sess_test*)
                            _MM_SAN=true
                            _MM_REASON="synthetic_prev_session_id"
                            ;;
                    esac

                    _MM_NOW_EPOCH="$(date -u +%s 2> /dev/null || echo 0)"
                    if [ "$_MM_SAN" = "false" ] && [ -n "$_MM_RCV_TS" ]; then
                        _MM_RCV_EPOCH="$(date -u -d "$_MM_RCV_TS" +%s 2> /dev/null || echo '')"
                        if [ -n "$_MM_RCV_EPOCH" ] && [ "$_MM_RCV_EPOCH" -gt $((_MM_NOW_EPOCH + 300)) ]; then
                            _MM_SAN=true
                            _MM_REASON="future_prev_session_ts"
                        fi
                    fi
                    if [ "$_MM_SAN" = "false" ] && [ -n "$_MM_RCV_DET" ]; then
                        _MM_DET_EPOCH="$(date -u -d "$_MM_RCV_DET" +%s 2> /dev/null || echo '')"
                        if [ -n "$_MM_DET_EPOCH" ] && [ "$_MM_DET_EPOCH" -gt $((_MM_NOW_EPOCH + 300)) ]; then
                            _MM_SAN=true
                            _MM_REASON="future_detected_at"
                        fi
                    fi

                    if [ "$_MM_SAN" = "true" ] && [ "$_MM_RCV_MODE" != "ok" ]; then
                        _MM_TS_NOW="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
                        ctx_apply_expr \
                            '.recovery.close_mode = "ok"
                             | .recovery.prev_session_id = ""
                             | .recovery.prev_session_ts = ""
                             | .recovery.alerts = []
                             | .recovery.alerts_require_kickoff = false
                             | .recovery.detected_at = $now' \
                            --arg now "$_MM_TS_NOW"
                        jq -cn \
                            --arg event "recovery_stale_sanitized" \
                            --arg sid "$CTX_ACTIVE_SID" \
                            --arg ts "$_MM_TS_NOW" \
                            --arg reason "$_MM_REASON" \
                            --arg old_close_mode "$_MM_RCV_MODE" \
                            --arg old_prev_sid "$_MM_RCV_SID" \
                            '{
                                event: $event,
                                session_id: $sid,
                                timestamp: $ts,
                                reason: $reason,
                                old_close_mode: $old_close_mode,
                                old_prev_session_id: $old_prev_sid,
                                message: "Recovery stale detectado e neutralizado durante session_id_mismatch"
                            }' >> "$AUDIT_FILE" 2> /dev/null || true
                    fi

                    exit 0
                fi
            fi
        fi

        # ── Sanitização de recovery stale (anti-contaminação persistida) ───────────
        # Objetivo: neutralizar blocos .recovery antigos/contaminados que ficaram no
        # contexto ativo (ex.: prev_session_id sintético sess_test* ou datas futuras).
        if [ -f "$CTX_FILE" ] && command -v jq > /dev/null 2>&1; then
            _RCV_CLOSE_MODE="$(jq -r '.recovery.close_mode // "ok"' "$CTX_FILE" 2> /dev/null || echo 'ok')"
            _RCV_PREV_SID="$(jq -r '.recovery.prev_session_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
            _RCV_PREV_TS="$(jq -r '.recovery.prev_session_ts // ""' "$CTX_FILE" 2> /dev/null || echo '')"
            _RCV_DETECTED_AT="$(jq -r '.recovery.detected_at // ""' "$CTX_FILE" 2> /dev/null || echo '')"

            _RCV_SANITIZE=false
            _RCV_REASON=""

            if [ -n "$_RCV_PREV_SID" ]; then
                case "$_RCV_PREV_SID" in
                    sess_test*)
                        _RCV_SANITIZE=true
                        _RCV_REASON="synthetic_prev_session_id"
                        ;;
                esac
            fi

            _RCV_NOW_EPOCH="$(date -u +%s 2> /dev/null || echo 0)"
            if [ "$_RCV_SANITIZE" = "false" ] && [ -n "$_RCV_PREV_TS" ]; then
                _RCV_PREV_EPOCH="$(date -u -d "$_RCV_PREV_TS" +%s 2> /dev/null || echo '')"
                if [ -n "$_RCV_PREV_EPOCH" ] && [ "$_RCV_PREV_EPOCH" -gt $((_RCV_NOW_EPOCH + 300)) ]; then
                    _RCV_SANITIZE=true
                    _RCV_REASON="future_prev_session_ts"
                fi
            fi

            if [ "$_RCV_SANITIZE" = "false" ] && [ -n "$_RCV_DETECTED_AT" ]; then
                _RCV_DETECTED_EPOCH="$(date -u -d "$_RCV_DETECTED_AT" +%s 2> /dev/null || echo '')"
                if [ -n "$_RCV_DETECTED_EPOCH" ] && [ "$_RCV_DETECTED_EPOCH" -gt $((_RCV_NOW_EPOCH + 300)) ]; then
                    _RCV_SANITIZE=true
                    _RCV_REASON="future_detected_at"
                fi
            fi

            if [ "$_RCV_SANITIZE" = "true" ] && [ "$_RCV_CLOSE_MODE" != "ok" ]; then
                _RCV_TS_NOW="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo "${TIMESTAMP:-}")"
                ctx_apply_expr \
                    '.recovery.close_mode = "ok"
                     | .recovery.prev_session_id = ""
                     | .recovery.prev_session_ts = ""
                     | .recovery.alerts = []
                     | .recovery.alerts_require_kickoff = false
                     | .recovery.detected_at = $now' \
                    --arg now "$_RCV_TS_NOW"

                jq -cn \
                    --arg event "recovery_stale_sanitized" \
                    --arg sid "$SESSION_ID" \
                    --arg ts "$_RCV_TS_NOW" \
                    --arg reason "$_RCV_REASON" \
                    --arg old_close_mode "$_RCV_CLOSE_MODE" \
                    --arg old_prev_sid "$_RCV_PREV_SID" \
                    '{
                        event: $event,
                        session_id: $sid,
                        timestamp: $ts,
                        reason: $reason,
                        old_close_mode: $old_close_mode,
                        old_prev_session_id: $old_prev_sid,
                        message: "Recovery stale detectado e neutralizado para evitar falso alerta persistente"
                    }' >> "$AUDIT_FILE" 2> /dev/null || true
            fi
        fi

        # ── Hardening de schema mínimo do contexto ─────────────────────────────────
        # Garante campos-base exigidos por smoke/checks mesmo em contextos recuperados
        # de versões antigas ou sessões interrompidas abruptamente.
        if [ -f "$CTX_FILE" ]; then
            ctx_apply_expr '.quality_gates = (.quality_gates // {})'
        fi

        # ── Atualiza contexto — Schema v2 ────────────────────────────────────────────
        # Atualiza 3 blocos separados:
        #   last_tool.*       → sobrescrito a cada chamada (âmbito: chamada)
        #   current_turn.*    → acumula até agentStop (âmbito: turno)
        #   session_stats.*   → acumula até sessionEnd (âmbito: sessão)
        # Quando vscode_askQuestions: seta current_turn.auth_requested = true
        # NOTA: NÃO sobrescreve .session.id (removido no HARDENING v5 — session_id é
        #       definido apenas por session-start.sh; sobrescrever aqui causava contaminação).
        if [ -f "$CTX_FILE" ]; then
            if [ "$TOOL_NAME" = "vscode_askQuestions" ]; then
                ctx_apply_expr \
                    '.last_tool.name   = $tool
                     | .last_tool.ts     = $ts
                     | .last_tool.use_id = $id
                     | .last_tool.result = null
                     | .current_turn.auth_requested    = true
                     | .current_turn.auth_requested_at = $ts
                     | .current_turn.last_non_bookkeeping_tool = $tool
                     | .current_turn.tools_count   = ((.current_turn.tools_count // 0) + 1)
                     | .current_turn.tools_by_name = ((.current_turn.tools_by_name // {}) | .[$tool] = ((. // {})[$tool] // 0) + 1)
                     | .session_stats.tools_total   = ((.session_stats.tools_total // 0) + 1)
                     | .session_stats.tools_by_name = ((.session_stats.tools_by_name // {}) | .[$tool] = ((. // {})[$tool] // 0) + 1)
                     | .current_section.tools_by_name = ((.current_section.tools_by_name // {}) | .[$tool] = ((. // {})[$tool] // 0) + 1)' \
                    --arg ts "$TIMESTAMP" \
                    --arg tool "$TOOL_NAME" \
                    --arg id "$TOOL_USE_ID"
            elif [ "$TOOL_NAME" = "runSubagent" ] || [ "$TOOL_NAME" = "search_subagent" ]; then
                # ── HARDENING: delegação ao subagente = autorização implícita ─────────
                # runSubagent e search_subagent (ambas ferramentas Core) disparam agentStop
                # no agente pai antes do subagente iniciar.
                # Sem este tratamento, o sistema marca o turno como UNAUTHORIZED — falso positivo.
                # Solução: setamos auth_requested=true E subagent_delegated=true no contexto,
                # e logamos evento "subagentStart" no audit.jsonl como sinal de autorização.
                # FIX BUG-03: search_subagent agora também é reconhecido (equivalente a runSubagent).
                _SUBAGENT_DESCRIPTION="$(echo "$INPUT" | jq -r '.tool_input.description // .tool_input.prompt // "(sem descrição)"' 2> /dev/null | head -c 200 || echo '(sem descrição)')"
                _SUBTURN_ID="$(jq -r '.current_turn.subturn.subturn_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
                _SUBTURN_NUMBER="$(jq -r '.current_turn.subturn.number // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
                if [ -z "$_SUBTURN_ID" ]; then
                    _SUBTURN_ID="subturn_${TOOL_USE_ID:-unknown}"
                fi
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
                _SUBTURN_TURN_ID="$(jq -r '.current_turn.turn_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
                if command -v emit_subturn_transition_event > /dev/null 2>&1; then
                    emit_subturn_transition_event \
                        "$AUDIT_FILE" \
                        "$SESSION_ID" \
                        "${TIMESTAMP:-$_LOCAL_TS}" \
                        "$_SUBTURN_TURN_ID" \
                        "$_SUBTURN_ID" \
                        "${_SUBTURN_NUMBER:-1}" \
                        "active" \
                        "delegated" \
                        "subagent_delegate" \
                        "preToolUse"
                fi
                ctx_apply_expr \
                    '.last_tool.name   = $tool
                     | .last_tool.ts     = $ts
                     | .last_tool.use_id = $id
                     | .last_tool.result = null
                     | .current_turn.auth_requested       = true
                     | .current_turn.auth_requested_at    = $ts
                     | .current_turn.subagent_delegated   = true
                     | .current_turn.subagent_description = $desc
                     | .session_stats.subturn_via_subagent = ((.session_stats.subturn_via_subagent // 0) + 1)
                     | .current_turn.last_non_bookkeeping_tool = $tool
                     | .current_turn.tools_count   = ((.current_turn.tools_count // 0) + 1)
                     | .current_turn.tools_by_name = ((.current_turn.tools_by_name // {}) | .[$tool] = ((. // {})[$tool] // 0) + 1)
                     | .session_stats.tools_total   = ((.session_stats.tools_total // 0) + 1)
                     # FIX BUG-04: subagent_calls NÃO incrementado aqui — subagent-start.sh é o local correto
                     # (evita double-count: pre-tool-use.sh + subagent-start.sh = 2x por subagente)
                     | .session_stats.tools_by_name = ((.session_stats.tools_by_name // {}) | .[$tool] = ((. // {})[$tool] // 0) + 1)
                     | .current_section.tools_by_name = ((.current_section.tools_by_name // {}) | .[$tool] = ((. // {})[$tool] // 0) + 1)' \
                    --arg ts "$TIMESTAMP" \
                    --arg tool "$TOOL_NAME" \
                    --arg id "$TOOL_USE_ID" \
                    --arg desc "$_SUBAGENT_DESCRIPTION"

                if command -v write_current_subturn_state > /dev/null 2>&1; then
                    write_current_subturn_state \
                        "${TIMESTAMP:-$_LOCAL_TS}" \
                        "delegated" \
                        "subagent_delegate" \
                        "false" \
                        "false" \
                        "$_SUBTURN_ID" \
                        "${_SUBTURN_NUMBER:-1}" \
                        "15"
                fi
            else
                ctx_apply_expr \
                    '.last_tool.name   = $tool
                     | .last_tool.ts     = $ts
                     | .last_tool.use_id = $id
                     | .last_tool.result = null
                     | .current_turn.todo_last_item_label = (
                         if $tool == "manage_todo_list" then (if $todo_last_item == "" then null else $todo_last_item end)
                         else (.current_turn.todo_last_item_label // null)
                         end)
                     | .current_turn.todo_last_item_is_askquestions_continuation = (
                         if $tool == "manage_todo_list" then ($todo_last_item_is_cont == "true")
                         else (.current_turn.todo_last_item_is_askquestions_continuation // false)
                         end)
                     | .current_turn.todo_last_item_checked_at = (
                         if $tool == "manage_todo_list" then $ts
                         else (.current_turn.todo_last_item_checked_at // null)
                         end)
                     | .current_turn.todo_protocol_version = (
                         if $tool == "manage_todo_list" then "subturn_v1"
                         else (.current_turn.todo_protocol_version // null)
                         end)
                     | .current_turn.last_non_bookkeeping_tool = (
                         if $tool == "manage_todo_list" then (.current_turn.last_non_bookkeeping_tool // null)
                         else $tool
                         end)
                     | .current_turn.tools_count   = ((.current_turn.tools_count // 0) + 1)
                     | .current_turn.tools_by_name = ((.current_turn.tools_by_name // {}) | .[$tool] = ((. // {})[$tool] // 0) + 1)
                     | .session_stats.tools_total   = ((.session_stats.tools_total // 0) + 1)
                     | .session_stats.tools_by_name = ((.session_stats.tools_by_name // {}) | .[$tool] = ((. // {})[$tool] // 0) + 1)
                     | .current_section.tools_by_name = ((.current_section.tools_by_name // {}) | .[$tool] = ((. // {})[$tool] // 0) + 1)' \
                    --arg ts "$TIMESTAMP" \
                    --arg tool "$TOOL_NAME" \
                    --arg id "$TOOL_USE_ID" \
                    --arg todo_last_item "$TODO_LAST_ITEM_LABEL" \
                    --arg todo_last_item_is_cont "$TODO_LAST_ITEM_IS_CONTINUATION"
            fi
        fi

        # ── Hardening v8.0: BLOQUEIO do Mecanismo 5 — session-close.sh sem KEY ───────
        # ── Enforcement: auto-auditoria obrigatória após continuidade ambígua ─────────
        # Quando postToolUse marca auto_audit_required=true por resposta ambígua de
        # askQuestions de continuidade, este preToolUse:
        #   1) considera iniciado ao usar ferramentas de leitura/busca/diagnóstico;
        #   2) bloqueia desvios prematuros (novo askQuestions ou edição direta) até kickoff.
        if [ -f "$CTX_FILE" ]; then
            _AA_REQUIRED="$(jq -r '.current_turn.auto_audit_required // false' "$CTX_FILE" 2> /dev/null || echo false)"
            _AA_STARTED="$(jq -r '.current_turn.auto_audit_started // false' "$CTX_FILE" 2> /dev/null || echo false)"

            if [ "$_AA_REQUIRED" = "true" ] && [ "$_AA_STARTED" != "true" ]; then
                _AA_IS_AUDIT_START=false
                case "$TOOL_NAME" in
                    read_file | grep_search | semantic_search | get_errors | file_search | vscode_listCodeUsages)
                        _AA_IS_AUDIT_START=true
                        ;;
                esac

                if [ "$_AA_IS_AUDIT_START" = "true" ]; then
                    ctx_apply_expr \
                        '.current_turn.auto_audit_started = true
                         | .current_turn.auto_audit_started_at = $ts
                         | .current_turn.auto_audit_started_tool = $tool' \
                        --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
                        --arg tool "$TOOL_NAME"

                    jq -cn \
                        --arg event "autoAudit_started" \
                        --arg sid "$SESSION_ID" \
                        --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
                        --arg tool "$TOOL_NAME" \
                        --arg tool_use_id "$TOOL_USE_ID" \
                        '{
                            event: $event,
                            session_id: $sid,
                            timestamp: $ts,
                            tool_name: $tool,
                            tool_use_id: $tool_use_id,
                            message: "Auto-auditoria obrigatória iniciada por ferramenta de diagnóstico"
                        }' >> "$AUDIT_FILE" 2> /dev/null || true
                elif [ "$TOOL_NAME" = "vscode_askQuestions" ] || [ "$TOOL_NAME" = "apply_patch" ] || [ "$TOOL_NAME" = "create_file" ]; then
                    jq -cn \
                        --arg event "autoAudit_pretool_deny" \
                        --arg sid "$SESSION_ID" \
                        --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
                        --arg tool "$TOOL_NAME" \
                        --arg tool_use_id "$TOOL_USE_ID" \
                        '{
                            event: $event,
                            session_id: $sid,
                            timestamp: $ts,
                            tool_name: $tool,
                            tool_use_id: $tool_use_id,
                            message: "Desvio bloqueado: auto-auditoria obrigatória ainda não iniciada"
                        }' >> "$AUDIT_FILE" 2> /dev/null || true

                    jq -cn \
                        '{
                            permissionDecision: "deny",
                            additionalContext: "Auto-auditoria obrigatória está pendente (resposta de continuidade ambígua). Antes de novo askQuestions ou edição, inicie auditoria com leitura/busca/diagnóstico e atualize os TODOs conforme protocolo."
                        }'
                    exit 0
                fi
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
            _M5_DIRECT_CALL=false
            if printf '%s\n' "$_M5_CMD" | grep -Eq '(^|[;&]|&&|\|\|)[[:space:]]*(bash|sh|zsh)[[:space:]]+([^;&|[:space:]]*/)?session-close\.sh([[:space:]]|$)'; then
                _M5_DIRECT_CALL=true
            elif printf '%s\n' "$_M5_CMD" | grep -Eq '(^|[;&]|&&|\|\|)[[:space:]]*(source|\.)[[:space:]]+([^;&|[:space:]]*/)?session-close\.sh([[:space:]]|$)'; then
                _M5_DIRECT_CALL=true
            elif printf '%s\n' "$_M5_CMD" | grep -Eq '(^|[;&]|&&|\|\|)[[:space:]]*([^;&|[:space:]]*/)?session-close\.sh([[:space:]]|$)'; then
                _M5_DIRECT_CALL=true
            fi
            if [ "$_M5_DIRECT_CALL" = "true" ]; then
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

                    # P7.1: lock primário (PreToolUse) no mecanismo de duplo lock
                    jq -cn \
                        --arg event "turnClose_prevented_dual_lock" \
                        --arg sid "$SESSION_ID" \
                        --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
                        --arg reason "session_close_direct_pretool_deny" \
                        --arg cmd "$_M5_CMD" \
                        '{
                            event: $event,
                            session_id: $sid,
                            timestamp: $ts,
                            lock_stage: "preToolUse",
                            reason: $reason,
                            tool: "run_in_terminal",
                            command: $cmd,
                            message: "Fechamento prevenido por lock primário (preToolUse)"
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
                    '{systemMessage: ("🔐 SESSION REMINDER [tool #" + ($n|tostring) + "] — SESSION≠SECTION≠TURN. Para encerrar esta SESSION: (1) vscode_askQuestions Template F exibindo a KEY (2) usuário digita " + $key + " (3) post-tool-use valida a KEY e executa session-close.sh automaticamente. Texto plano não conta — apenas tool call real. Próximo reminder em " + ($n + ($interval|tonumber) | tostring) + " ferramentas.")}' 2> /dev/null || true
                exit 0
            fi
        fi

        # ── Nível 2: Telemetria de Git Push (desacoplado de session close) ──────────
        # Objetivo: detectar `git push` e registrar contexto, sem acoplar push ao
        # encerramento de SESSION (close_key_validated). O push é parte normal do fluxo
        # de trabalho e não deve ser bloqueado por estado de close da sessão.
        if [ "$TOOL_NAME" = "run_in_terminal" ] && [ -f "$CTX_FILE" ]; then
            _N2_CMD="$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2> /dev/null || echo '')"

            # Detecta padrões de git push (variações comuns)
            if echo "$_N2_CMD" | grep -qE '^\s*git\s+(push|force-push|rebase)\b'; then
                _N2_CLOSE_VALIDATED="$(jq -r '.session.close_key_validated // false' "$CTX_FILE" 2> /dev/null || echo 'false')"
                _N2_FINAL_PUSH_ALLOWED="$(jq -r '.recovery.final_push_allowed // false' "$CTX_FILE" 2> /dev/null || echo 'false')"
                _N2_PUSH_AUTHORIZED=false
                if [ "$_N2_CLOSE_VALIDATED" = "true" ] || [ "$_N2_FINAL_PUSH_ALLOWED" = "true" ]; then
                    _N2_PUSH_AUTHORIZED=true
                fi

                # Log principal de detecção de push (sem bloqueio)
                jq -cn \
                    --arg event "gitPush_detected" \
                    --arg sid "$SESSION_ID" \
                    --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
                    --arg cmd "$_N2_CMD" \
                    --argjson push_authorized "$_N2_PUSH_AUTHORIZED" \
                    '{
                        event:      $event,
                        session_id: $sid,
                        timestamp:  $ts,
                        command:    $cmd,
                        push_authorized: $push_authorized,
                        message:    "Git push detectado — sem bloqueio por close_key"
                    }' >> "$AUDIT_FILE" 2> /dev/null || true

                # Alerta observável quando push ocorre sem autorização explícita de fechamento
                if [ "$_N2_PUSH_AUTHORIZED" != "true" ]; then
                    jq -cn \
                        --arg event "gitPush_requires_template_g" \
                        --arg sid "$SESSION_ID" \
                        --arg ts "${TIMESTAMP:-$_LOCAL_TS}" \
                        --arg cmd "$_N2_CMD" \
                        '{
                            event:      $event,
                            session_id: $sid,
                            timestamp:  $ts,
                            command:    $cmd,
                            message:    "Git push sem bloqueio por close_key; recomenda-se autorização via Template G"
                        }' >> "$AUDIT_FILE" 2> /dev/null || true
                fi
            fi
        fi

        # NÃO emite JSON de decision — autonomia total do agente.
        # Exit 0 garante que o agente nunca é bloqueado por este hook.
        exit 0
    )
}
