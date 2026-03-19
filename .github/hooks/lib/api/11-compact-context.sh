#!/usr/bin/env bash
# api/11-compact-context.sh — Context Builder para PreCompact (v2.3)
# Módulo 11/11 do sistema hook-payload-api modular
# Carregado por: hook-payload-api.sh (loader principal)
#
# 🟧 CAMADA 3 — NOSSO SISTEMA
# Constrói additionalContext rich para o evento PreCompact da plataforma.
# Combina dados de session.json com briefing e protocolo para que o
# agente retome o estado correto após a compactação automática do VS Code.
#
# Depende de:
#   common.sh         — read_field, generate_session_briefing, read_briefing, context_block
#   09-metrics.sh     — hook_stat_* / hook_compliance_* / hook_session_close_key
#   10-close-key.sh   — hook_close_key_read, hook_close_key_valid_format
#   01-vars.sh        — HOOK_COMPACT_CONTEXT_BYTES
#
# Protocolo PreCompact (plataforma 🟦):
#   Input: { hookEventName: "PreCompact", sessionId: "...", triggerReason: "auto"|"manual" }
#   Output esperado: { additionalContext: "<markdown string>" }  (via hook_out_* de 05-output.sh)
#   O campo additionalContext é INJETADO pelo VS Code após a compactação.

# ─── SEÇÃO 11A: SEÇÕES COMPOSÍVEIS DO additionalContext ──────────────────────

# 🟧 hook_compact_ctx_session_summary — seção markdown com stats da sessão
# Inclui: turn_count, turn_authorized, turn_unauthorized, subturn_total,
#         compliance.consecutive_unauthorized, close_key
# Retorna string markdown (sem trailing newline)
hook_compact_ctx_session_summary() {
    local turn_count turn_auth turn_unauth subturn consecutive close_key compliance_note
    turn_count=$(hook_stat_turn_count)
    turn_auth=$(hook_stat_turn_authorized)
    turn_unauth=$(hook_stat_turn_unauthorized)
    subturn=$(hook_stat_subturn_total)
    consecutive=$(hook_compliance_consecutive)
    close_key=$(hook_close_key_read)

    if [ "${consecutive:-0}" -gt 0 ]; then
        compliance_note="⚠️ ${consecutive} turno(s) consecutivos sem vscode_askQuestions"
    else
        compliance_note="✅ Compliance OK"
    fi

    printf '## Stats da Sessão\n'
    printf -- '- Turnos totais: %s (autorizados: %s | não autorizados: %s)\n' \
        "${turn_count:-0}" "${turn_auth:-0}" "${turn_unauth:-0}"
    printf -- '- Subturns acumulados: %s\n' "${subturn:-0}"
    printf -- '- Compliance: %s\n' "$compliance_note"
    printf -- '- Chave de encerramento: `%s`\n' "${close_key:-N/A}"
}

# 🟧 hook_compact_ctx_pending_tasks — seção markdown com tarefas pendentes
# Lê pending-tasks.md do STATE_DIR; se ausente, retorna linha indicativa
# Retorna string markdown
hook_compact_ctx_pending_tasks() {
    local pending_file
    pending_file="${STATE_DIR:-/tmp}/pending-tasks.md"
    if [ -f "$pending_file" ] && [ -s "$pending_file" ]; then
        printf '## Tarefas Pendentes\n'
        cat "$pending_file"
    else
        printf '## Tarefas Pendentes\n'
        printf '_Nenhuma tarefa pendente registrada_\n'
    fi
}

# 🟧 hook_compact_ctx_close_key — seção markdown com lembrete da close_key
# Garante que o agente não perca a chave após compactação
# Retorna string markdown
hook_compact_ctx_close_key() {
    local close_key
    close_key=$(hook_close_key_read)
    if [ -z "$close_key" ]; then
        return 0  # sem close_key → sem seção
    fi
    printf '## Chave de Encerramento de Sessão\n'
    printf 'Para encerrar a sessão, o protocolo exige que o usuário digite esta chave no Template F:\n\n'
    printf '```\n%s\n```\n' "$close_key"
    printf -- '\nNunca use esta chave sem solicitação explícita do usuário.\n'
}

# 🟧 hook_compact_ctx_protocol_reminder — seção markdown com lembrete do protocolo
# Lembrete conciso das regras operacionais críticas (vscode_askQuestions, TODO)
# Retorna string markdown
hook_compact_ctx_protocol_reminder() {
    printf '## Protocolo Operacional (Resumo)\n'
    printf -- '- **TODO obrigatório**: crie manage_todo_list ao iniciar cada turno\n'
    printf -- '- **Último TODO = vscode_askQuestions**: chame ao final de cada turno\n'
    printf -- '- **Template F + close_key**: único fluxo autorizado para encerrar SESSION\n'
    printf -- '- **Nunca** chame session-close.sh diretamente\n'
}

# ─── SEÇÃO 11B: BUILDER COMPLETO ─────────────────────────────────────────────

# 🟧 hook_compact_ctx_full — combina todas as seções em string markdown
# Retorna string markdown pronta para ser usada como additionalContext
# Também popula HOOK_COMPACT_CONTEXT_BYTES com o tamanho em bytes
hook_compact_ctx_full() {
    local ctx
    ctx="$(hook_compact_ctx_session_summary)"$'\n\n'
    ctx+="$(hook_compact_ctx_close_key)"$'\n\n'
    ctx+="$(hook_compact_ctx_pending_tasks)"$'\n\n'
    ctx+="$(hook_compact_ctx_protocol_reminder)"

    HOOK_COMPACT_CONTEXT_BYTES="${#ctx}"
    export HOOK_COMPACT_CONTEXT_BYTES

    printf '%s' "$ctx"
}

# 🟧 hook_compact_ctx_briefing_full — versão que inclui briefing gerado dinamicamente
# Combina generate_session_briefing + hook_compact_ctx_full como additionalContext ricco.
# Requer que common.sh esteja carregada (generate_session_briefing, read_briefing)
# Retorna string markdown
hook_compact_ctx_briefing_full() {
    local briefing ctx
    if declare -f generate_session_briefing > /dev/null 2>&1 \
        && declare -f read_briefing > /dev/null 2>&1; then
        generate_session_briefing 2>/dev/null || true
        briefing=$(read_briefing 2>/dev/null || printf '')
    fi

    if [ -n "${briefing:-}" ]; then
        ctx="${briefing}"$'\n\n'"$(hook_compact_ctx_full)"
    else
        ctx="$(hook_compact_ctx_full)"
    fi

    HOOK_COMPACT_CONTEXT_BYTES="${#ctx}"
    export HOOK_COMPACT_CONTEXT_BYTES
    printf '%s' "$ctx"
}
