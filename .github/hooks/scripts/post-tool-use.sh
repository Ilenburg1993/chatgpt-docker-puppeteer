#!/bin/bash
# post-tool-use.sh — Hook postToolUse do Copilot
# Executado APÓS cada uso de ferramenta (sucesso ou falha).
# Input JSON (stdin): {timestamp, hook_event_name, session_id, transcript_path,
#                      tool_name, tool_input, tool_response, tool_use_id, cwd}
# Schema verificado empiricamente em 2026-03-09 (vide raw-post-input.jsonl).
# Output: ignorado pelo Copilot.
#
# Schema v2: atualiza last_tool.result e current_turn.failures_count.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
CTX_FILE="$STATE_DIR/session-context.json"
# shellcheck disable=SC1091
if [ -f "$HOOK_DIR/hooks-lib/common.sh" ]; then
    source "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null \
        || echo "[warn] common.sh falhou ao carregar em post-tool-use.sh" >&2
else
    echo "[warn] common.sh não encontrado (post-tool-use.sh) — heal_v1/ctx functions indisponíveis" >&2
fi
mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"
# CRÍTICO-1 FIX: lê stdin e resolve per-session ANTES de abrir o flock (fd 9)
if command -v resolve_hook_runtime_input > /dev/null 2>&1; then
    resolve_hook_runtime_input
else
    INPUT="$(cat 2> /dev/null || true)"
    TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
    SESSION_ID_PAYLOAD="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"
    apply_per_session_paths "${SESSION_ID_PAYLOAD:-}" 2> /dev/null || true
fi

# Extrai campos usando o schema real (snake_case)
TOOL_NAME="$(echo "$INPUT" | jq -r '.tool_name // ""' 2> /dev/null || echo '')"
TOOL_USE_ID="$(echo "$INPUT" | jq -r '.tool_use_id // ""' 2> /dev/null || echo '')"
TOOL_RESPONSE="$(echo "$INPUT" | jq -r '.tool_response // ""' 2> /dev/null || echo '')"

# session_id vem diretamente do payload (UUID real do Copilot)
SESSION_ID="${SESSION_ID_PAYLOAD:-}"

# Fallback: se session_id não veio do payload, usa o do contexto
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

# G9-08: Lock exclusivo APÓS resolver CTX_FILE per-session
_CTX_LOCK="${CTX_FILE}.lock"
exec 9> "$_CTX_LOCK"
if command -v flock > /dev/null 2>&1; then
    flock -x -w 3 9 2> /dev/null
fi

# ── Determina result_type (heurística progressiva) ───────────────────────────
# 1. Resposta vazia → "unknown" (muitos sucessos não têm body)
# 2. Padrões explícitos de falha → "failure"
# 3. Resposta não-vazia sem padrão de falha → "success"
# REV-02: regex refinada — removidos ENOENT/EACCES (são errno C, nunca aparecem
# em tool_response) e patterns muito amplos; mantidos apenas padrões literais claros.
if [ -z "$TOOL_RESPONSE" ]; then
    RESULT_TYPE="unknown"
elif echo "$TOOL_RESPONSE" | grep -qiE \
    "String replacement failed|No such file or directory|Permission denied|command not found|fatal: |Error: .*(failed|error|not found)|Tool call failed|cannot open|failed to (open|read|write|connect|parse)"; then
    RESULT_TYPE="failure"
else
    RESULT_TYPE="success"
fi
POST_HOOK_OUTPUT=""

# Append em audit.jsonl (sem logar tool_response completo — pode ser grande)
jq -cn \
    --arg event "postToolUse" \
    --arg sid "$SESSION_ID" \
    --arg ts "$TIMESTAMP" \
    --arg tool "$TOOL_NAME" \
    --arg tool_use_id "$TOOL_USE_ID" \
    --arg result "$RESULT_TYPE" \
    '{
        event:        $event,
        session_id:   $sid,
        timestamp:    $ts,
        tool_name:    $tool,
        tool_use_id:  $tool_use_id,
        result_type:  $result
    }' >> "$AUDIT_FILE"

# ── Guard: session_id deve corresponder ao contexto ativo ─────────────────────
# F0.3: detecta contexto vazio
if [ -f "$CTX_FILE" ] && [ ! -s "$CTX_FILE" ]; then
    echo "[guard] session-context.json vazio — guard desabilitado (aguardando auto-recovery)" >&2
fi
# HARDENING v5: previne contaminação cruzada entre sessões.
# HEAL v1: quando CTX_FILE é de manual_recovery, adota session_id real do Copilot.
# FIX BUG-06: também trata inline_restart — CTX já tem o session_id correto do VS Code.
# Guard canônico centralizado em reconcile_session_id_guard_prepost() —
# emite evento "session_id_mismatch" quando o caso é não recuperável.
# Se o payload carrega session_id diferente do contexto ativo,
# logamos mismatch e NÃO modificamos session-context.json.
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] && [ -n "$SESSION_ID" ]; then
    CTX_ACTIVE_SID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    if [ -n "$CTX_ACTIVE_SID" ] && [ "$SESSION_ID" != "$CTX_ACTIVE_SID" ]; then
        _GUARD_RC=0
        _GUARD_RECONCILED_SID="$(reconcile_session_id_guard_prepost "$SESSION_ID" "$TOOL_NAME" "${TIMESTAMP:-}" "post-tool-use.sh")" || _GUARD_RC=$?
        if [ -n "$_GUARD_RECONCILED_SID" ]; then
            SESSION_ID="$_GUARD_RECONCILED_SID"
        fi

        if [ "$_GUARD_RC" -eq 10 ]; then
            exit 0
        fi
    fi
fi

# ── Backfill canônico da flag strict de fechamento de TURN ──────────────────
# Alguns contextos antigos/reconectados podem chegar sem essa flag persistida.
# Força convergência para true quando ausente, preservando false explícito.
if command -v ensure_strict_turn_close_flag_default > /dev/null 2>&1; then
    ensure_strict_turn_close_flag_default "$CTX_FILE" > /dev/null 2>&1 || true
fi

# ── Atualiza contexto — Schema v3 ────────────────────────────────────────────
# last_tool.result: resultado desta chamada específica
# current_turn.failures_count: acumula falhas do turno atual
# session_stats.failures_detected: acumula falhas da sessão
# current_turn.last_askquestions_response: captura todas as respostas de vscode_askQuestions
if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
    if [ "$TOOL_NAME" = "vscode_askQuestions" ] && [ -n "$TOOL_RESPONSE" ]; then
        # Captura resposta completa do usuário ao vscode_askQuestions
        # tool_response para askQuestions é JSON: {answers:{...}} — normaliza para string
        RESPONSE_STR="$(echo "$TOOL_RESPONSE" | jq -c '.' 2> /dev/null || echo "$TOOL_RESPONSE")"

        # ── Hardening 1: Detectar falha de API do askQuestions ───────────────────
        # "FAILED: Response contained no choices" ocorre quando o contexto é grande
        # demais ou a API do Copilot está sobrecarregada. O tool retorna success:true
        # mas com erro interno — este bloco detecta e loga corretamente.
        ASK_API_FAILED=false
        if echo "$TOOL_RESPONSE" | grep -q "FAILED.*no choices\|contained no choices\|Response contained no choices"; then
            ASK_API_FAILED=true
            jq -cn \
                --arg sid "$SESSION_ID" \
                --arg ts "$TIMESTAMP" \
                --arg tool_use_id "$TOOL_USE_ID" \
                --arg response "$(echo "$RESPONSE_STR" | head -c 300)" \
                '{
                    event:      "askQuestions_api_failure",
                    session_id: $sid,
                    timestamp:  $ts,
                    tool_use_id: $tool_use_id,
                    error:      "Response contained no choices",
                    cause:      "Context too large or Copilot API unavailable",
                    response_preview: $response
                }' >> "$AUDIT_FILE"

            # Atualiza session-context com flag de falha de API (Hardening 2)
            jq --arg ts "$TIMESTAMP" \
                '.current_turn.askquestions_api_error = true
                 | .current_turn.askquestions_api_error_at = $ts
                 | .session_stats.askquestions_api_failures = ((.session_stats.askquestions_api_failures // 0) + 1)' \
                "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true

            echo "⚠️ [post-tool-use] vscode_askQuestions falhou com API error: 'Response contained no choices'" >&2
            echo "   Causa provável: contexto muito grande ou Copilot API indisponível." >&2
            echo "   Flag 'current_turn.askquestions_api_error' definido no session-context.json." >&2
        fi
        # ─────────────────────────────────────────────────────────────────────────

        # Lê close_key atual do contexto e valida de forma estruturada no payload de answers
        CURRENT_CLOSE_KEY="$(jq -r '.session.close_key // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        ASK_TEMPLATE_F=false
        ASK_HAS_TEMPLATE_F_OPTION=false
        ASK_CLOSE_ACTION="not_applicable"

        # Detecta se o askQuestions enviado foi Template F (Session Close).
        # Critérios: presença da close_key no prompt OU assinatura textual de encerramento.
        if [ -n "$CURRENT_CLOSE_KEY" ] && echo "$INPUT" | jq -e --arg key "$CURRENT_CLOSE_KEY" '
                                [
                                    (.tool_input.questions? // [])[]?
                                    | ((.header // "") + " " + (.question // ""))
                                ]
                                | any(type == "string" and contains($key))
                        ' > /dev/null 2>&1; then
            ASK_TEMPLATE_F=true
        elif echo "$INPUT" | jq -e '
                                [
                                    (.tool_input.questions? // [])[]?
                                    | ((.header // "") + " " + (.question // ""))
                                ]
                                | any(test("template f|encerrar session|encerrar sessão|session close|close key"; "i"))
                        ' > /dev/null 2>&1; then
            ASK_TEMPLATE_F=true
        fi

        # Toda chamada askQuestions deve expor opção de escalonamento para Template F.
        # Se já for o próprio Template F, considera-se requisito atendido.
        if [ "$ASK_TEMPLATE_F" = "true" ]; then
            ASK_HAS_TEMPLATE_F_OPTION=true
        elif echo "$INPUT" | jq -e '
                                [
                                    (.tool_input.questions? // [])[]?
                                    | (.options? // [])[]?
                                    | ((.label // "") + " " + (.description // ""))
                                ]
                                | any(test("template f|encerrar sess(ã|a)o|session close|close key|escalar"; "i"))
                        ' > /dev/null 2>&1; then
            ASK_HAS_TEMPLATE_F_OPTION=true
        fi

        KEY_FOUND=false
        if [ -n "$CURRENT_CLOSE_KEY" ]; then
            # Formato esperado do vscode_askQuestions:
            # {"answers": {"Pergunta": {"selected": [...], "freeText": "..."}, ...}}
            # Aceita KEY apenas quando encontrada exatamente em freeText/selected.
            if echo "$TOOL_RESPONSE" | jq -e --arg key "$CURRENT_CLOSE_KEY" '
                                [
                                    (.answers? // {})
                                    | to_entries[]?
                                    | .value
                                    | if type == "object" then
                                            (([.freeText?] + (.selected? // [])))
                                        elif type == "string" then
                                            [.]
                                        else
                                            []
                                        end
                                    | .[]
                                    | select(type == "string")
                                ]
                                | any(. == $key)
                        ' > /dev/null 2>&1; then
                KEY_FOUND=true
            elif [ "$(printf '%s' "$TOOL_RESPONSE" | tr -d '\r\n')" = "$CURRENT_CLOSE_KEY" ]; then
                # Fallback compatível para respostas legadas em texto puro
                KEY_FOUND=true
            fi
        fi

        # Classifica a ação de fechamento quando Template F foi emitido.
        # close_with_key: usuário confirmou com key válida
        # close_without_valid_key: usuário tentou encerrar sem key válida
        # cancel_or_continue: usuário explicitamente cancelou/continuou
        # unknown: resposta ambígua
        if [ "$ASK_TEMPLATE_F" = "true" ]; then
            ASK_HAS_CLOSE_INTENT=false
            ASK_HAS_CANCEL_INTENT=false
            ASK_HAS_FREE_TEXT=false

            if echo "$TOOL_RESPONSE" | jq -e '
                                [
                                    (.answers? // {})
                                    | to_entries[]?
                                    | .value
                                    | if type == "object" then
                                            ((.selected? // []))
                                        elif type == "string" then
                                            [.]
                                        else
                                            []
                                        end
                                    | .[]
                                    | select(type == "string")
                                ]
                                | any(test("encerrar|fechar|close"; "i"))
                        ' > /dev/null 2>&1; then
                ASK_HAS_CLOSE_INTENT=true
            fi

            if echo "$TOOL_RESPONSE" | jq -e '
                                [
                                    (.answers? // {})
                                    | to_entries[]?
                                    | .value
                                    | if type == "object" then
                                            ((.selected? // []))
                                        elif type == "string" then
                                            [.]
                                        else
                                            []
                                        end
                                    | .[]
                                    | select(type == "string")
                                ]
                                | any(test("cancelar|continuar|manter"; "i"))
                        ' > /dev/null 2>&1; then
                ASK_HAS_CANCEL_INTENT=true
            fi

            if echo "$TOOL_RESPONSE" | jq -e '
                                [
                                    (.answers? // {})
                                    | to_entries[]?
                                    | .value
                                    | .freeText? // empty
                                    | select(type == "string" and length > 0)
                                ]
                                | length > 0
                        ' > /dev/null 2>&1; then
                ASK_HAS_FREE_TEXT=true
            fi

            if [ "$KEY_FOUND" = "true" ]; then
                ASK_CLOSE_ACTION="close_with_key"
            elif [ "$ASK_HAS_CLOSE_INTENT" = "true" ] && [ "$ASK_HAS_CANCEL_INTENT" != "true" ]; then
                ASK_CLOSE_ACTION="close_without_valid_key"
            elif [ "$ASK_HAS_CANCEL_INTENT" = "true" ] && [ "$ASK_HAS_CLOSE_INTENT" != "true" ]; then
                ASK_CLOSE_ACTION="cancel_or_continue"
            elif [ "$ASK_HAS_FREE_TEXT" = "true" ]; then
                ASK_CLOSE_ACTION="close_without_valid_key"
            else
                ASK_CLOSE_ACTION="unknown"
            fi
        fi

        TEMPLATE_F_REQUESTED_NEXT=false
        if [ "$ASK_TEMPLATE_F" != "true" ] && echo "$TOOL_RESPONSE" | jq -e '
                                [
                                    (.answers? // {})
                                    | to_entries[]?
                                    | .value
                                    | if type == "object" then
                                            (([.freeText?] + (.selected? // [])))
                                        elif type == "string" then
                                            [.]
                                        else
                                            []
                                        end
                                    | .[]
                                    | select(type == "string")
                                ]
                                | any(test("template f|session close|encerrar sess(ã|a)o|escalar"; "i"))
                        ' > /dev/null 2>&1; then
            TEMPLATE_F_REQUESTED_NEXT=true
        fi

        TEMPLATE_F_PENDING_BEFORE="$(jq -r '.session.template_f_request_pending // false' "$CTX_FILE" 2> /dev/null || echo false)"
        TEMPLATE_F_PENDING_AFTER="$TEMPLATE_F_PENDING_BEFORE"
        TEMPLATE_F_CALLED_WITHOUT_REQUEST=false
        if [ "$ASK_TEMPLATE_F" = "true" ]; then
            if [ "$TEMPLATE_F_PENDING_BEFORE" = "true" ]; then
                TEMPLATE_F_PENDING_AFTER=false
            else
                TEMPLATE_F_CALLED_WITHOUT_REQUEST=true
                TEMPLATE_F_PENDING_AFTER=false
            fi
        elif [ "$TEMPLATE_F_REQUESTED_NEXT" = "true" ]; then
            TEMPLATE_F_PENDING_AFTER=true
        fi

        ASK_HAS_USER_ANSWER=false
        if echo "$TOOL_RESPONSE" | jq -e '
                                ((.answers? // {}) | to_entries | map(.value))
                                | if length == 0 then false else
                                    any(
                                        if type == "object" then
                                            ((.skipped // false) == false)
                                            and (((.freeText // "") != "") or ((.selected // []) | length > 0) or (has("selected") | not))
                                        elif type == "string" then
                                            (. != "")
                                        else
                                            false
                                        end
                                    )
                                  end
                        ' > /dev/null 2>&1; then
            ASK_HAS_USER_ANSWER=true
        fi

        ASK_CONTINUATION_CLEAR=true
        ASK_CONTINUATION_UNCLEAR=false
        if [ "$ASK_TEMPLATE_F" != "true" ] && [ "$ASK_HAS_USER_ANSWER" = "true" ]; then
            if echo "$TOOL_RESPONSE" | jq -e '
                                [
                                    (.answers? // {})
                                    | to_entries[]?
                                    | .value
                                    | if type == "object" then
                                          (((.selected? // []) | length) > 0)
                                          or (
                                              ((.freeText? // "") | type == "string")
                                              and (
                                                  ((.freeText // "") | length) >= 24
                                                  or ((.freeText // "") | test("(auditar|auditoria|analis|investig|corrig|implem|test|valid|document|refator|execut|rodar|planej|upgrade|review|fix|debug|lint|typecheck|smoke)"; "i"))
                                              )
                                          )
                                      elif type == "string" then
                                          ((. | length) >= 24)
                                          or (test("(auditar|auditoria|analis|investig|corrig|implem|test|valid|document|refator|execut|rodar|planej|upgrade|review|fix|debug|lint|typecheck|smoke)"; "i"))
                                      else
                                          false
                                      end
                                ]
                                | any
                        ' > /dev/null 2>&1; then
                ASK_CONTINUATION_CLEAR=true
            else
                ASK_CONTINUATION_CLEAR=false
            fi

            if [ "$ASK_CONTINUATION_CLEAR" != "true" ]; then
                ASK_CONTINUATION_UNCLEAR=true
            fi
        fi

        SUBTURN_ID_CURR="$(jq -r '.current_turn.subturn.subturn_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        SUBTURN_NUMBER_CURR="$(jq -r '.current_turn.subturn.number // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
        SUBTURN_FROM_STATE="$(jq -r '.current_turn.subturn.state // "active"' "$CTX_FILE" 2> /dev/null || echo 'active')"
        TURN_ID_CURR="$(jq -r '.current_turn.turn_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        SUBTURN_TO_STATE="waiting_user"
        SUBTURN_REASON="askquestions_missing_answer"
        if [ "$ASK_HAS_USER_ANSWER" = "true" ]; then
            SUBTURN_TO_STATE="resumed"
            SUBTURN_REASON="askquestions_response_processed"
        fi

        # Log da resposta no audit.jsonl (sem dados sensíveis excessivos — truncada a 500 chars)
        RESPONSE_TRUNCATED="$(echo "$RESPONSE_STR" | head -c 500)"
        jq -cn \
            --arg sid "$SESSION_ID" \
            --arg ts "$TIMESTAMP" \
            --arg tool_use_id "$TOOL_USE_ID" \
            --arg response "$RESPONSE_TRUNCATED" \
            --argjson key_found "$KEY_FOUND" \
            --argjson api_failed "$ASK_API_FAILED" \
            --argjson template_f "$ASK_TEMPLATE_F" \
            --arg close_action "$ASK_CLOSE_ACTION" \
            --argjson has_template_f_option "$ASK_HAS_TEMPLATE_F_OPTION" \
            --argjson template_f_requested_next "$TEMPLATE_F_REQUESTED_NEXT" \
            --argjson template_f_pending_before "$TEMPLATE_F_PENDING_BEFORE" \
            --argjson template_f_pending_after "$TEMPLATE_F_PENDING_AFTER" \
            '{
                event:        "askQuestions_response",
                session_id:   $sid,
                timestamp:    $ts,
                tool_use_id:  $tool_use_id,
                response:     $response,
                close_key_found: $key_found,
                api_failed:   $api_failed,
                template_f:   $template_f,
                close_action: $close_action,
                has_template_f_option: $has_template_f_option,
                template_f_requested_next: $template_f_requested_next,
                template_f_pending_before: $template_f_pending_before,
                template_f_pending_after: $template_f_pending_after
            }' >> "$AUDIT_FILE"

        if command -v emit_subturn_transition_event > /dev/null 2>&1; then
            emit_subturn_transition_event \
                "$AUDIT_FILE" \
                "$SESSION_ID" \
                "$TIMESTAMP" \
                "$TURN_ID_CURR" \
                "$SUBTURN_ID_CURR" \
                "${SUBTURN_NUMBER_CURR:-1}" \
                "$SUBTURN_FROM_STATE" \
                "$SUBTURN_TO_STATE" \
                "$SUBTURN_REASON" \
                "postToolUse"
        fi

        if [ "$ASK_TEMPLATE_F" = "true" ] && [ "$ASK_CLOSE_ACTION" = "close_without_valid_key" ]; then
            jq -cn \
                --arg sid "$SESSION_ID" \
                --arg ts "$TIMESTAMP" \
                --arg tool_use_id "$TOOL_USE_ID" \
                '{
                    event: "sessionClose_key_missing_or_invalid",
                    session_id: $sid,
                    timestamp: $ts,
                    tool_use_id: $tool_use_id,
                    message: "Template F respondeu sem close_key válida — encerramento de sessão não autorizado"
                }' >> "$AUDIT_FILE"
        fi

        if [ "$ASK_HAS_TEMPLATE_F_OPTION" != "true" ]; then
            jq -cn \
                --arg sid "$SESSION_ID" \
                --arg ts "$TIMESTAMP" \
                --arg tool_use_id "$TOOL_USE_ID" \
                '{
                    event: "askQuestions_missing_template_f_option",
                    session_id: $sid,
                    timestamp: $ts,
                    tool_use_id: $tool_use_id,
                    message: "askQuestions sem opção de escalonamento para Template F"
                }' >> "$AUDIT_FILE"
        fi

        if [ "$TEMPLATE_F_REQUESTED_NEXT" = "true" ]; then
            jq -cn \
                --arg sid "$SESSION_ID" \
                --arg ts "$TIMESTAMP" \
                --arg tool_use_id "$TOOL_USE_ID" \
                '{
                    event: "askQuestions_template_f_requested",
                    session_id: $sid,
                    timestamp: $ts,
                    tool_use_id: $tool_use_id,
                    message: "Usuário solicitou escalonamento para Template F em próximo askQuestions"
                }' >> "$AUDIT_FILE"
        fi

        if [ "$TEMPLATE_F_CALLED_WITHOUT_REQUEST" = "true" ]; then
            jq -cn \
                --arg sid "$SESSION_ID" \
                --arg ts "$TIMESTAMP" \
                --arg tool_use_id "$TOOL_USE_ID" \
                '{
                    event: "askQuestions_template_f_called_without_request",
                    session_id: $sid,
                    timestamp: $ts,
                    tool_use_id: $tool_use_id,
                    message: "Template F chamado sem solicitação prévia registrada"
                }' >> "$AUDIT_FILE"
        fi

        if [ "$ASK_CONTINUATION_UNCLEAR" = "true" ]; then
            jq -cn \
                --arg sid "$SESSION_ID" \
                --arg ts "$TIMESTAMP" \
                --arg tool_use_id "$TOOL_USE_ID" \
                '{
                    event: "askQuestions_continuation_unclear",
                    session_id: $sid,
                    timestamp: $ts,
                    tool_use_id: $tool_use_id,
                    message: "Resposta de continuidade sem instrução operacional clara — auto-auditoria obrigatória ativada"
                }' >> "$AUDIT_FILE"
        fi

        if [ "$ASK_TEMPLATE_F" != "true" ]; then
            jq -cn \
                --arg sid "$SESSION_ID" \
                --arg ts "$TIMESTAMP" \
                --arg tool_use_id "$TOOL_USE_ID" \
                '{
                    event: "askQuestions_continuation_mandatory_notice",
                    session_id: $sid,
                    timestamp: $ts,
                    tool_use_id: $tool_use_id,
                    message: "Resposta a askQuestions de continuidade recebida — encerramento de TURN/SESSION proibido nesta etapa"
                }' >> "$AUDIT_FILE"
        fi

        # Atualiza contexto com resposta e, se necessário, valida a close_key
        # REV4-06: setar auth_requested=true aqui também (defesa em profundidade — garante
        # que mesmo se preToolUse perdeu a janela, postToolUse confirma a autorização)
        # BUG-80 FIX v1: Validar close_key ANTES de setar close_key_validated flag
        # (evita false positive quando KEY é inválida mas flag é setada prematuramente)
        if [ "$KEY_FOUND" = "true" ]; then
            # Guard de idempotência: verifica se close_key_validated já está true
            # para evitar duplo sessionCloseAuthorized quando o usuário digita a key mais de uma vez.
            _ALREADY_VALIDATED="$(jq -r '.session.close_key_validated // false' "$CTX_FILE" 2> /dev/null || echo 'false')"

            # REV4-06: branch KEY_FOUND também atualiza current_turn.auth_requested_at
            # (via write_askquestions_turn_state).
            write_askquestions_turn_state \
                "$RESULT_TYPE" \
                "$RESPONSE_STR" \
                "$TIMESTAMP" \
                "$ASK_TEMPLATE_F" \
                "$ASK_CLOSE_ACTION" \
                "$KEY_FOUND" \
                > /dev/null 2>&1 || true

            if [ "$_ALREADY_VALIDATED" != "true" ]; then
                # Auto-encerramento: chama session-close.sh para VALIDAR close_key
                # e setar close_key_validated=true (session-close.sh faz isso internamente)
                # Esta é a defesa-em-profundidade: Template F → KEY detectada → validação → encerramento automático.
                _SESSION_CLOSE_SCRIPT="$HOOK_DIR/scripts/session-close.sh"
                _CLOSE_EXIT_CODE=0
                if [ -f "$_SESSION_CLOSE_SCRIPT" ] && [ -x "$_SESSION_CLOSE_SCRIPT" ]; then
                    # BUG-24 fix: libera flock fd 9 antes de chamar session-close.sh
                    # (session-close.sh também tenta flock fd 9 no mesmo lock file — deadlock sem esta linha)
                    exec 9>&-
                    bash "$_SESSION_CLOSE_SCRIPT" "$CURRENT_CLOSE_KEY" > /dev/null 2>&1 || _CLOSE_EXIT_CODE=$?

                    if [ $_CLOSE_EXIT_CODE -eq 0 ]; then
                        # SUCCESS: session-close.sh validou KEY e setou close_key_validated=true
                        # Confirmar no audit (log informativo apenas — session-close.sh já fez tudo)
                        jq -cn \
                            --arg sid "$SESSION_ID" \
                            --arg ts "$TIMESTAMP" \
                            --arg key "$CURRENT_CLOSE_KEY" \
                            '{
                                event:      "sessionClose_key_validated_confirmed",
                                session_id: $sid,
                                timestamp:  $ts,
                                close_key:  $key,
                                message:    "session-close.sh validou KEY com sucesso — close_key_validated ja esta true no contexto"
                            }' >> "$AUDIT_FILE"
                    else
                        # FAILURE: session-close.sh rejetou KEY (exit code != 0)
                        # Manter close_key_validated = false (nunca foi alterado do padrão)
                        # Log da falha para auditoria
                        jq -cn \
                            --arg sid "$SESSION_ID" \
                            --arg ts "$TIMESTAMP" \
                            --arg key "$CURRENT_CLOSE_KEY" \
                            --arg exit_code "$_CLOSE_EXIT_CODE" \
                            '{
                                event:      "sessionClose_key_validation_failed",
                                session_id: $sid,
                                timestamp:  $ts,
                                close_key:  $key,
                                session_close_exit_code: $exit_code,
                                message:    "session-close.sh rejeitou KEY — close_key_validated permanece false"
                            }' >> "$AUDIT_FILE"
                    fi
                fi
            else
                # Chave já validada: log informativo sem chamar session-close.sh novamente
                jq -cn \
                    --arg sid "$SESSION_ID" \
                    --arg ts "$TIMESTAMP" \
                    --arg key "$CURRENT_CLOSE_KEY" \
                    '{
                        event:      "sessionClose_key_already_validated",
                        session_id: $sid,
                        timestamp:  $ts,
                        close_key:  $key,
                        message:    "close_key já validada anteriormente — encerramento idempotente, session-close.sh não re-executado"
                    }' >> "$AUDIT_FILE"
            fi
        else
            # REV4-06: branch sem KEY_FOUND também atualiza current_turn.auth_requested_at
            # (via write_askquestions_turn_state).
            write_askquestions_turn_state \
                "$RESULT_TYPE" \
                "$RESPONSE_STR" \
                "$TIMESTAMP" \
                "$ASK_TEMPLATE_F" \
                "$ASK_CLOSE_ACTION" \
                "$KEY_FOUND" \
                > /dev/null 2>&1 || true
        fi

        # Persiste governança de escalonamento para validação no agent-stop.
        if [ -f "$CTX_FILE" ]; then
            if command -v sponge > /dev/null 2>&1; then
                jq --argjson has_opt "$ASK_HAS_TEMPLATE_F_OPTION" \
                    --argjson called_wo "$TEMPLATE_F_CALLED_WITHOUT_REQUEST" \
                    --argjson pending_after "$TEMPLATE_F_PENDING_AFTER" \
                    --argjson has_answer "$ASK_HAS_USER_ANSWER" \
                    --argjson api_failed "$ASK_API_FAILED" \
                    --argjson template_f "$ASK_TEMPLATE_F" \
                    --argjson continuation_unclear "$ASK_CONTINUATION_UNCLEAR" \
                    --arg ts "$TIMESTAMP" \
                    '.current_turn.last_askquestions_has_template_f_option = $has_opt
                     | .current_turn.template_f_called_without_prior_request = $called_wo
                     | .session.template_f_request_pending = $pending_after
                     | .current_turn.continuation_instruction_clear = (if (.current_turn.last_askquestions_template // "") == "template_f" then true else (not $continuation_unclear) end)
                     | .current_turn.continuation_mandatory = (if $template_f then false else true end)
                     | .current_turn.continuation_mandatory_at = (if $template_f then null else $ts end)
                     | .current_turn.continuation_mandatory_reason = (if $template_f then null else "askquestions_non_template_f_continue_required" end)
                     | .current_turn.auto_audit_required = (if (.current_turn.last_askquestions_template // "") == "template_f" then false else $continuation_unclear end)
                     | .current_turn.auto_audit_required_at = (if $continuation_unclear then $ts else null end)
                     | .current_turn.auto_audit_reason = (if $continuation_unclear then "askquestions_continuation_unclear" else null end)
                     | .current_turn.auto_audit_started = false
                     | .current_turn.auto_audit_started_at = null
                     | .current_turn.auto_audit_started_tool = null
                     | .session_stats.continuation_mandatory_triggers = ((.session_stats.continuation_mandatory_triggers // 0) + (if $template_f then 0 else 1 end))
                     | .session_stats.auto_audit_triggers = ((.session_stats.auto_audit_triggers // 0) + (if $continuation_unclear then 1 else 0 end))
                     | .session_stats.subturn_via_askquestions = ((.session_stats.subturn_via_askquestions // 0) + (if $api_failed then 0 else 1 end))' \
                    "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
            else
                _TMP_TF="$(mktemp 2> /dev/null || true)"
                if [ -n "$_TMP_TF" ] \
                    && jq --argjson has_opt "$ASK_HAS_TEMPLATE_F_OPTION" \
                        --argjson called_wo "$TEMPLATE_F_CALLED_WITHOUT_REQUEST" \
                        --argjson pending_after "$TEMPLATE_F_PENDING_AFTER" \
                        --argjson has_answer "$ASK_HAS_USER_ANSWER" \
                        --argjson api_failed "$ASK_API_FAILED" \
                        --argjson template_f "$ASK_TEMPLATE_F" \
                        --argjson continuation_unclear "$ASK_CONTINUATION_UNCLEAR" \
                        --arg ts "$TIMESTAMP" \
                        '.current_turn.last_askquestions_has_template_f_option = $has_opt
                         | .current_turn.template_f_called_without_prior_request = $called_wo
                         | .session.template_f_request_pending = $pending_after
                         | .current_turn.continuation_instruction_clear = (if (.current_turn.last_askquestions_template // "") == "template_f" then true else (not $continuation_unclear) end)
                         | .current_turn.continuation_mandatory = (if $template_f then false else true end)
                         | .current_turn.continuation_mandatory_at = (if $template_f then null else $ts end)
                         | .current_turn.continuation_mandatory_reason = (if $template_f then null else "askquestions_non_template_f_continue_required" end)
                         | .current_turn.auto_audit_required = (if (.current_turn.last_askquestions_template // "") == "template_f" then false else $continuation_unclear end)
                         | .current_turn.auto_audit_required_at = (if $continuation_unclear then $ts else null end)
                         | .current_turn.auto_audit_reason = (if $continuation_unclear then "askquestions_continuation_unclear" else null end)
                         | .current_turn.auto_audit_started = false
                         | .current_turn.auto_audit_started_at = null
                         | .current_turn.auto_audit_started_tool = null
                         | .session_stats.continuation_mandatory_triggers = ((.session_stats.continuation_mandatory_triggers // 0) + (if $template_f then 0 else 1 end))
                         | .session_stats.auto_audit_triggers = ((.session_stats.auto_audit_triggers // 0) + (if $continuation_unclear then 1 else 0 end))
                         | .session_stats.subturn_via_askquestions = ((.session_stats.subturn_via_askquestions // 0) + (if $api_failed then 0 else 1 end))' \
                        "$CTX_FILE" > "$_TMP_TF" 2> /dev/null; then
                    mv "$_TMP_TF" "$CTX_FILE" 2> /dev/null || rm -f "$_TMP_TF"
                else
                    [ -n "$_TMP_TF" ] && rm -f "$_TMP_TF"
                fi
            fi

            if command -v write_current_subturn_state > /dev/null 2>&1; then
                _SUBTURN_REQUIRES_USER_ACTION="true"
                if [ "$ASK_HAS_USER_ANSWER" = "true" ]; then
                    _SUBTURN_REQUIRES_USER_ACTION="false"
                fi
                write_current_subturn_state \
                    "$TIMESTAMP" \
                    "$SUBTURN_TO_STATE" \
                    "$SUBTURN_REASON" \
                    "false" \
                    "$_SUBTURN_REQUIRES_USER_ACTION"

                if [ "$ASK_API_FAILED" != "true" ] && command -v auto_advance_subturn_n_plus_one > /dev/null 2>&1; then
                    _NEXT_SUBTURN_STATE="active"
                    _NEXT_SUBTURN_REASON="askquestions_followup_n_plus_one"
                    _NEXT_SUBTURN_REQUIRES_USER_ACTION="false"
                    if [ "$ASK_HAS_USER_ANSWER" != "true" ]; then
                        _NEXT_SUBTURN_STATE="waiting_user"
                        _NEXT_SUBTURN_REASON="askquestions_pending_user_n_plus_one"
                        _NEXT_SUBTURN_REQUIRES_USER_ACTION="true"
                    fi
                    auto_advance_subturn_n_plus_one \
                        "$TIMESTAMP" \
                        "$_NEXT_SUBTURN_REASON" \
                        "postToolUse" \
                        "$_NEXT_SUBTURN_STATE" \
                        "$_NEXT_SUBTURN_REQUIRES_USER_ACTION" \
                        "$AUDIT_FILE" \
                        "$SESSION_ID" \
                        > /dev/null 2>&1 || true
                fi
            fi
        fi

        if [ "$ASK_TEMPLATE_F" != "true" ]; then
            _CONT_MSG="⚠️ CONTINUAÇÃO OBRIGATÓRIA: resposta de askQuestions não-Template F detectada. É PROIBIDO tentar encerrar TURN/SESSION nesta etapa. Continue o trabalho no mesmo escopo."
            _CONT_CTX="COMANDO OPERACIONAL OBRIGATÓRIO: após askQuestions não-Template F, continue o TURN e execute próximas ações de trabalho (diagnóstico/implementação/validação). Não tente encerramento de TURN/SESSION; Template F só em escalonamento explícito de fechamento de SESSION."
            if [ "$ASK_CONTINUATION_UNCLEAR" = "true" ]; then
                _CONT_MSG="⚠️ CONTINUAÇÃO OBRIGATÓRIA: resposta ambígua de askQuestions não-Template F. Encerramento é proibido e auto-auditoria foi ativada para este TURN."
                _CONT_CTX="COMANDO OPERACIONAL OBRIGATÓRIO: inicie imediatamente auditoria do escopo atual (leitura/busca/diagnóstico), atualize TODOs com último item askQuestions de continuidade e só depois avance para edição/validação. Encerramento de TURN/SESSION é proibido nesta etapa."
            fi
            POST_HOOK_OUTPUT="$(jq -cn --arg msg "$_CONT_MSG" --arg ctx "$_CONT_CTX" '
                {
                    systemMessage: $msg,
                    hookSpecificOutput: {
                        hookEventName: "PostToolUse",
                        additionalContext: $ctx
                    }
                }
            ' 2> /dev/null || echo '')"
        fi
    elif [ "$RESULT_TYPE" = "failure" ]; then
        if command -v write_last_tool_result > /dev/null 2>&1; then
            write_last_tool_result "$RESULT_TYPE" > /dev/null 2>&1 || true
        else
            jq --arg result "$RESULT_TYPE" \
                '.last_tool.result = $result' \
                "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
        fi

        if command -v increment_turn_failure_counters > /dev/null 2>&1; then
            increment_turn_failure_counters > /dev/null 2>&1 || true
        else
            jq '.current_turn.failures_count = ((.current_turn.failures_count // 0) + 1)
                | .session_stats.failures_detected = ((.session_stats.failures_detected // 0) + 1)' \
                "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
        fi
    elif [ "$TOOL_NAME" = "manage_todo_list" ]; then
        # v9.0: rastreia uso de manage_todo_list (Protocolo TODO Obrigatório)
        # Compat V90-1 (smoke): manter presença textual de "todo_created = true".
        if command -v write_last_tool_result > /dev/null 2>&1; then
            write_last_tool_result "$RESULT_TYPE" > /dev/null 2>&1 || true
        else
            jq --arg result "$RESULT_TYPE" \
                '.last_tool.result = $result' \
                "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
        fi

        if command -v mark_turn_todo_created_true > /dev/null 2>&1; then
            mark_turn_todo_created_true > /dev/null 2>&1 || true
        else
            jq '.current_turn.todo_created = true' \
                "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
        fi
    elif [ "$TOOL_NAME" = "runSubagent" ] || [ "$TOOL_NAME" = "search_subagent" ]; then
        # FIX BUG-05: defesa em profundidade — reforça auth_requested após retorno do subagente.
        # pre-tool-use.sh já seta auth_requested=true antes da execução; este bloco garante
        # que o flag permanece verdadeiro mesmo se houve falha parcial de estado no pre-hook.
        if command -v write_last_tool_result > /dev/null 2>&1; then
            write_last_tool_result "$RESULT_TYPE" > /dev/null 2>&1 || true
        else
            jq --arg result "$RESULT_TYPE" \
                '.last_tool.result = $result' \
                "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
        fi

        jq --arg ts "$TIMESTAMP" \
            '.current_turn.auth_requested = true
             | .current_turn.auth_requested_at = $ts
             | .current_turn.subagent_delegated = true' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    else
        if command -v write_last_tool_result > /dev/null 2>&1; then
            write_last_tool_result "$RESULT_TYPE" > /dev/null 2>&1 || true
        else
            jq --arg result "$RESULT_TYPE" \
                '.last_tool.result = $result' \
                "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
        fi
    fi
fi

if [ -n "$POST_HOOK_OUTPUT" ]; then
    printf '%s\n' "$POST_HOOK_OUTPUT"
fi

# ── Métricas de tempo por ferramenta ─────────────────────────────────────────
# Calcula duração entre preToolUse (last_tool.ts) e este postToolUse.
# Ambos os timestamps são ISO strings — converte para epoch ms com date -d.
if [ -f "$CTX_FILE" ]; then
    LAST_TOOL_TS="$(jq -r '.last_tool.ts // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    if [ -n "$LAST_TOOL_TS" ] && [ -n "$TIMESTAMP" ]; then
        # BUG-B.1 FIX: %3N não é portável em BSD/macOS date; fallback usa %s * 1000
        _ms_from_iso() {
            local ts="$1"
            date -d "$ts" '+%s%3N' 2> /dev/null \
                || date -d "$ts" '+%s' 2> /dev/null | awk '{printf "%d000", $1}' \
                || echo ''
        }
        TS_MS="$(_ms_from_iso "$TIMESTAMP")"
        LAST_MS="$(_ms_from_iso "$LAST_TOOL_TS")"
        if [ -n "$TS_MS" ] && [ -n "$LAST_MS" ] && [ "$TS_MS" -gt 0 ] && [ "$LAST_MS" -gt 0 ]; then
            DURATION_MS=$((TS_MS - LAST_MS))
            # Sanity: ignora durações negativas ou absurdas (>10min = gap entre sessões)
            if [ "$DURATION_MS" -gt 0 ] && [ "$DURATION_MS" -lt 600000 ]; then
                jq -cn \
                    --arg sid "$SESSION_ID" \
                    --arg ts "$TIMESTAMP" \
                    --arg tool "$TOOL_NAME" \
                    --argjson dur "$DURATION_MS" \
                    --arg result "$RESULT_TYPE" \
                    '{
                        session_id:  $sid,
                        timestamp:   $ts,
                        tool_name:   $tool,
                        duration_ms: $dur,
                        result_type: $result
                    }' >> "$LOG_DIR/tool-metrics.jsonl"
            fi
        fi
    fi
fi

# ── Quality gates: registra execuções de lint/typecheck/test/format ──────────
# tool_input é objeto JSON; extrai .command para identificar gates de qualidade
if [ "$TOOL_NAME" = "run_in_terminal" ] || [ "$TOOL_NAME" = "bash" ]; then
    COMMAND="$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2> /dev/null || echo '')"

    for GATE_PATTERN in "npm run lint" "npm run typecheck" "npm run test" "npm run format"; do
        if echo "$COMMAND" | grep -qF "$GATE_PATTERN"; then
            if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
                GATE_KEY="$(echo "$GATE_PATTERN" | sed 's/npm run //' | sed 's/:/_/g')"
                jq --arg key "gate_${GATE_KEY}" --arg ts "$TIMESTAMP" --arg result "$RESULT_TYPE" \
                    '.quality_gates[$key] = {timestamp: $ts, result: $result}' \
                    "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
            fi
            break
        fi
    done
fi

exit 0
