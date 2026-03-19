#!/usr/bin/env bash
# api/05-output.sh — Output builders: funções hook_out_* para resposta ao VS Code
# Módulo 5/6 do sistema hook-payload-api modular
# Carregado por: hook-payload-api.sh (loader principal)
#
# 🟦 CAMADA 1 — PLATAFORMA NATIVA
# Todas as funções aqui produzem JSON exatamente conforme o protocolo oficial
# do VS Code Copilot Hooks. Nenhuma depende de estado externo ou nosso sistema.
#
# HIERARQUIA DE CONTROLE (mais para menos restritivo):
#   hook_out_exit2()         → exit 2 + stderr = bloqueio imediato sem JSON
#   hook_out_stop_session()  → {"continue":false} = encerra SESSION inteira
#   hook_out_stop_block()    → hookSpecificOutput.decision:block = bloqueia TURNO
#   hook_out_pre_deny()      → permissionDecision:deny = bloqueia ferramenta
#   hook_out_pre_ask()       → permissionDecision:ask = pede aprovação ao usuário
#   hook_out_system_message()→ systemMessage = exibe aviso, sem bloquear

# ─── UTILITÁRIOS INTERNOS ────────────────────────────────────────────────────

# Utilitário interno: escapa string para JSON via jq
_hook_json_str() {
    printf '%s' "$1" | jq -Rs '.'
}

# Utilitário interno: valida se string é JSON válido, retorna '{}' se não for
_hook_json_or_empty() {
    local raw="$1"
    if [ -z "$raw" ]; then
        printf '{}'
        return
    fi
    if printf '%s' "$raw" | jq -e . > /dev/null 2>&1; then
        printf '%s' "$raw" | jq -c '.'
    else
        printf '{}'
    fi
}

# ─── SEÇÃO 8: OUTPUT SIDE ────────────────────────────────────────────────────

# ─── 8.1 SAÍDA COMUM (todos os eventos) ─────────────────────────────────────

# hook_out_continue — passa sem fazer nada (hook silencioso)
# Uso: hook_out_continue
hook_out_continue() {
    printf '{}\n'
}

# hook_out_system_message — exibe aviso no chat sem bloquear nada
# Uso: hook_out_system_message "texto do aviso"
hook_out_system_message() {
    local msg
    msg=$(_hook_json_str "$1")
    printf '{"systemMessage":%s}\n' "$msg"
}

# hook_out_stop_session — encerra a SESSION INTEIRA (nuclear — use com cuidado)
# Diferente de decision:block que bloqueia apenas o TURNO
# Uso: hook_out_stop_session "motivo para o usuário"
hook_out_stop_session() {
    local reason
    reason=$(_hook_json_str "${1:-sessão encerrada pelo hook}")
    printf '{"continue":false,"stopReason":%s}\n' "$reason"
}

# hook_out_exit2 — bloqueia imediatamente via exit code 2 (stderr vai ao modelo)
# Uso: hook_out_exit2 "mensagem de erro"
# NOTA: esta função faz exit 2, não retorna
hook_out_exit2() {
    printf '%s\n' "${1:-erro interno no hook}" >&2
    exit 2
}

# ─── 8.2 SessionStart ────────────────────────────────────────────────────────

# hook_out_session_start_context — injeta contexto no início da sessão
# Uso: hook_out_session_start_context "texto do briefing/contexto"
hook_out_session_start_context() {
    local ctx
    ctx=$(_hook_json_str "$1")
    printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":%s}}\n' "$ctx"
}

# ─── 8.3 UserPromptSubmit ────────────────────────────────────────────────────
# UPS só suporta o formato comum (systemMessage, continue, stopReason)
# Usa hook_out_system_message ou hook_out_stop_session conforme necessário

# ─── 8.4 PreToolUse ─────────────────────────────────────────────────────────

# hook_out_pre_allow — permite execução da ferramenta (silencioso)
# Uso: hook_out_pre_allow [additionalContext]
hook_out_pre_allow() {
    local ctx="${1:-}"
    if [ -z "$ctx" ]; then
        printf '{}\n'
    else
        local json_ctx
        json_ctx=$(_hook_json_str "$ctx")
        printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","additionalContext":%s}}\n' \
            "$json_ctx"
    fi
}

# hook_out_pre_deny — nega execução da ferramenta com motivo obrigatório
# Uso: hook_out_pre_deny "motivo" [additionalContext]
hook_out_pre_deny() {
    local reason="${1:?hook_out_pre_deny: motivo obrigatório}"
    local ctx="${2:-}"
    local json_reason json_ctx
    json_reason=$(_hook_json_str "$reason")
    if [ -n "$ctx" ]; then
        json_ctx=$(_hook_json_str "$ctx")
        printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s,"additionalContext":%s}}\n' \
            "$json_reason" "$json_ctx"
    else
        printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' \
            "$json_reason"
    fi
}

# hook_out_pre_ask — pede aprovação do usuário antes de executar a ferramenta
# Uso: hook_out_pre_ask [additionalContext]
hook_out_pre_ask() {
    local ctx="${1:-}"
    if [ -n "$ctx" ]; then
        local json_ctx
        json_ctx=$(_hook_json_str "$ctx")
        printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","additionalContext":%s}}\n' \
            "$json_ctx"
    else
        printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask"}}\n'
    fi
}

# hook_out_pre_update_input — modifica o tool_input antes da execução
# Uso: hook_out_pre_update_input '{"command":"echo sanitized"}' [additionalContext]
# NOTA: newInputJson deve ser JSON válido — use _hook_json_or_empty para validar
hook_out_pre_update_input() {
    local new_input="${1:?hook_out_pre_update_input: novo input JSON obrigatório}"
    local ctx="${2:-}"
    local validated_input
    validated_input=$(_hook_json_or_empty "$new_input")
    if [ -n "$ctx" ]; then
        local json_ctx
        json_ctx=$(_hook_json_str "$ctx")
        printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":%s,"additionalContext":%s}}\n' \
            "$validated_input" "$json_ctx"
    else
        printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":%s}}\n' \
            "$validated_input"
    fi
}

# hook_out_pre_full — output PreToolUse completo com todos os campos opcionais
# Uso: hook_out_pre_full <decision> [reason] [context] [updatedInputJSON]
#   decision: "allow" | "deny" | "ask"
hook_out_pre_full() {
    local decision="${1:-allow}"
    local reason="${2:-}"
    local ctx="${3:-}"
    local new_input="${4:-}"

    # Monta o hookSpecificOutput incrementalmente via jq — começa com JSON válido
    local hso
    hso=$(jq -cn --arg ev "PreToolUse" --arg dec "$decision" \
        '{"hookEventName":$ev,"permissionDecision":$dec}')

    if [ -n "$reason" ]; then
        hso=$(printf '%s' "$hso" | jq -c \
            --arg r "$reason" '. + {"permissionDecisionReason": $r}')
    fi
    if [ -n "$ctx" ]; then
        hso=$(printf '%s' "$hso" | jq -c \
            --arg c "$ctx" '. + {"additionalContext": $c}')
    fi
    if [ -n "$new_input" ]; then
        local validated
        validated=$(_hook_json_or_empty "$new_input")
        hso=$(printf '%s' "$hso" | jq -c \
            --argjson ni "$validated" '. + {"updatedInput": $ni}')
    fi
    printf '{"hookSpecificOutput":%s}\n' "$hso"
}

# ─── 8.5 PostToolUse ─────────────────────────────────────────────────────────

# hook_out_post_context — injeta contexto adicional após execução da ferramenta
# Uso: hook_out_post_context "texto de contexto"
hook_out_post_context() {
    local ctx
    ctx=$(_hook_json_str "$1")
    printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":%s}}\n' "$ctx"
}

# hook_out_post_block — bloqueia continuação após ferramenta (nível raiz, não hookSpecificOutput)
# Uso: hook_out_post_block "motivo do bloqueio"
hook_out_post_block() {
    local reason
    reason=$(_hook_json_str "${1:?hook_out_post_block: motivo obrigatório}")
    printf '{"decision":"block","reason":%s}\n' "$reason"
}

# ─── 8.6 Stop (agentStop) ────────────────────────────────────────────────────

# hook_out_stop_block — bloqueia o fim do TURNO (agente continua, novo turno inicia)
# DEVE ser chamado APENAS quando HOOK_STOP_HOOK_ACTIVE = "false"
# Uso: hook_out_stop_block "motivo" [systemMessage]
hook_out_stop_block() {
    local reason="${1:?hook_out_stop_block: motivo obrigatório}"
    local sys_msg="${2:-}"
    local json_reason json_sys
    json_reason=$(_hook_json_str "$reason")
    if [ -n "$sys_msg" ]; then
        json_sys=$(_hook_json_str "$sys_msg")
        printf '{"hookSpecificOutput":{"hookEventName":"Stop","decision":"block","reason":%s},"systemMessage":%s}\n' \
            "$json_reason" "$json_sys"
    else
        printf '{"hookSpecificOutput":{"hookEventName":"Stop","decision":"block","reason":%s}}\n' \
            "$json_reason"
    fi
}

# hook_out_stop_safe_block — bloqueia SOMENTE se stop_hook_active=false (previne loop)
# Uso: hook_out_stop_safe_block "motivo" [systemMessage]
# Retorna 1 (sem output) se stop_hook_active=true
hook_out_stop_safe_block() {
    if hook_is_stop_active; then
        return 1
    fi
    hook_out_stop_block "$@"
}

# ─── 8.7 SubagentStart / SubagentStop ────────────────────────────────────────

# hook_out_subagent_start_context — injeta contexto no subagente ao iniciar
# Uso: hook_out_subagent_start_context "texto de contexto"
hook_out_subagent_start_context() {
    local ctx
    ctx=$(_hook_json_str "$1")
    printf '{"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":%s}}\n' "$ctx"
}

# hook_out_subagent_stop_block — bloqueia encerramento de subagente (nível raiz)
# DEVE verificar HOOK_STOP_HOOK_ACTIVE antes de chamar
# Uso: hook_out_subagent_stop_block "motivo"
hook_out_subagent_stop_block() {
    local reason
    reason=$(_hook_json_str "${1:?hook_out_subagent_stop_block: motivo obrigatório}")
    printf '{"decision":"block","reason":%s}\n' "$reason"
}

# hook_out_subagent_stop_safe_block — bloqueia SOMENTE se stop_hook_active=false
hook_out_subagent_stop_safe_block() {
    if hook_is_stop_active; then
        return 1
    fi
    hook_out_subagent_stop_block "$@"
}

# ─── 8.8 PreCompact ──────────────────────────────────────────────────────────
# PreCompact não suporta hookSpecificOutput, apenas o formato comum
# Usa hook_out_system_message ou hook_out_continue

# ─── 8.9 Output Builders v1.1 ────────────────────────────────────────────────

# hook_out_pre_update_command — wrapper: aplica updatedInput sobrescrevendo só o campo command
# Uso: hook_out_pre_update_command "echo novo_cmd" [additionalContext]
hook_out_pre_update_command() {
    local new_cmd="${1:?hook_out_pre_update_command: novo comando obrigatório}"
    local ctx="${2:-}"
    local new_input
    new_input=$(jq -cn --arg cmd "$new_cmd" '{"command":$cmd}')
    hook_out_pre_update_input "$new_input" "$ctx"
}

# hook_out_pre_update_filepath — wrapper: aplica updatedInput sobrescrevendo só o campo filePath
# Uso: hook_out_pre_update_filepath "/caminho/limpo" [additionalContext]
hook_out_pre_update_filepath() {
    local new_path="${1:?hook_out_pre_update_filepath: filePath obrigatório}"
    local ctx="${2:-}"
    local new_input
    new_input=$(jq -cn --arg fp "$new_path" '{"filePath":$fp}')
    hook_out_pre_update_input "$new_input" "$ctx"
}
