#!/usr/bin/env bash
# session-start-lib.sh — Lógica do SessionStart hook
#
# Responsabilidades:
#   1. Inicializar ou reconectar state da sessão
#   2. Gerar session-briefing.md com contexto atual
#   3. Emitir additionalContext para o agente via stdout
#
# Sourceado por scripts/session-start.sh

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
# shellcheck source=hook-payload-api.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hook-payload-api.sh"

export_lang_utf8

# ---------------------------------------------------------------------------
# Detecção de reconexão
# ---------------------------------------------------------------------------

# Verifica se o session_id armazenado já corresponde ao da entrada.
# Se sim, é uma reconexão (mesmo processo Copilot retomado).
# $1 = session_id extraído do payload
# Retorna 0 se reconexão, 1 se nova sessão
is_reconnect() {
    local incoming="$1"
    if ! state_exists; then return 1; fi
    local stored
    stored=$(read_field ".session_id")
    [ -n "$stored" ] && [ "$stored" != "null" ] && [ "$stored" = "$incoming" ]
}

# ---------------------------------------------------------------------------
# Geração do contexto de retomada (reconnect)
# ---------------------------------------------------------------------------

# Gera um bloco de contexto de reconexão com resumo das estatísticas
build_reconnect_context() {
    local turn_count turn_auth turn_unauth consecutive close_key started_at
    turn_count=$(read_field ".session_stats.turn_count")
    turn_auth=$(read_field ".session_stats.turn_authorized")
    turn_unauth=$(read_field ".session_stats.turn_unauthorized")
    consecutive=$(read_field ".compliance.consecutive_unauthorized")
    close_key=$(read_field ".close_key")
    started_at=$(read_field ".started_at")

    context_block "## Reconexão de Sessão" \
        "Esta sessão foi reconectada. Iniciada em **${started_at:-N/A}**.
Turnos: ${turn_count:-0} totais | ${turn_auth:-0} autorizados | ${turn_unauth:-0} não-autorizados
Consecutivos sem askQuestions: ${consecutive:-0}
Chave de encerramento: \`${close_key:-N/A}\`"
}

# ---------------------------------------------------------------------------
# Geração do contexto de nova sessão
# ---------------------------------------------------------------------------

# Gera bloco de contexto para uma sessão nova com instrução de orientação
build_new_session_context() {
    local session_id close_key
    session_id=$(read_field ".session_id")
    close_key=$(read_field ".close_key")

    context_block "## Nova Sessão Iniciada" \
        "Session ID: \`${session_id}\`
Chave de encerramento: \`${close_key}\`

**Protocolo obrigatório:**
- Use \`manage_todo_list\` ao iniciar qualquer turno de trabalho
- Chame \`vscode_askQuestions\` como ÚLTIMO ato de cada turno
- Para encerrar a sessão: Template F + chave acima"
}

# ---------------------------------------------------------------------------
# Leitura de tarefas pendentes para briefing
# ---------------------------------------------------------------------------

# Retorna uma seção de tarefas pendentes formatada para o briefing
section_pending_tasks() {
    if [ -f "$PENDING_TASKS_FILE" ] && [ -s "$PENDING_TASKS_FILE" ]; then
        context_block "## Tarefas Pendentes" "$(cat "$PENDING_TASKS_FILE")"
    else
        context_block "## Tarefas Pendentes" "*(nenhuma tarefa registrada)*"
    fi
}

# ---------------------------------------------------------------------------
# Assembler do additionalContext completo
# ---------------------------------------------------------------------------

# Monta o additionalContext que será injetado pelo VS Code no início da sessão.
# Combina: briefing do estado + tarefas pendentes + orientações de protocolo
build_additional_context() {
    local source="$1" # "new" ou "reconnect"
    local session_info
    local pending_section protocol_section

    if [ "$source" = "reconnect" ]; then
        session_info=$(build_reconnect_context)
    else
        session_info=$(build_new_session_context)
    fi

    pending_section=$(section_pending_tasks)

    protocol_section=$(context_block "## Protocolo de Hooks Ativo" \
        "Sistema de rastreamento de sessão/turno/subturn operacional.
Leia \`.github/hooks/state/session-briefing.md\` para detalhes completos.")

    printf '%s\n%s\n%s' "$session_info" "$pending_section" "$protocol_section"
}

# GAP-54: executa watchdog --json e, se houver issues ou warnings, anexa seção
# de alerta ao BRIEFING_FILE para que o agente veja imediatamente ao iniciar.
_session_start_append_watchdog_alerts() {
    local watchdog_script="$HOOK_DIR/scripts/watchdog.sh"
    [ -x "$watchdog_script" ] || return 0  # watchdog ausente: OK, não bloquear
    [ -f "${BRIEFING_FILE:-}" ] || return 0

    local wdog_json
    wdog_json=$(bash "$watchdog_script" --json 2>/dev/null) || true
    [ -z "$wdog_json" ] && return 0

    local healthy issues_count warnings_count
    healthy=$(printf '%s' "$wdog_json" | jq -r '.healthy // true')
    issues_count=$(printf '%s' "$wdog_json" | jq '.issues | length // 0')
    warnings_count=$(printf '%s' "$wdog_json" | jq '.warnings | length // 0')

    # Só anexa se houver algo a reportar
    if [ "$healthy" = "true" ] && [ "$warnings_count" -eq 0 ] 2>/dev/null; then
        return 0
    fi

    {
        printf '\n---\n\n'
        printf '## ⚠️ Alertas do Watchdog\n\n'
        if [ "$healthy" = "false" ] && [ "$issues_count" -gt 0 ] 2>/dev/null; then
            printf '### 🔴 Problemas críticos (%s)\n\n' "$issues_count"
            printf '%s' "$wdog_json" | jq -r '.issues[]?' | while IFS= read -r issue; do
                printf '- %s\n' "$issue"
            done
            printf '\n'
        fi
        if [ "$warnings_count" -gt 0 ] 2>/dev/null; then
            printf '### ⚠️ Avisos (%s)\n\n' "$warnings_count"
            printf '%s' "$wdog_json" | jq -r '.warnings[]?' | while IFS= read -r warn; do
                printf '- %s\n' "$warn"
            done
            printf '\n'
        fi
        printf '_Verifique com: `bash .github/hooks/scripts/watchdog.sh`_\n'
    } >> "$BRIEFING_FILE"

    hook_log_audit "watchdog_alerts_appended" \
        "issues" "$issues_count" "warnings" "$warnings_count" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Entrypoint principal do SessionStart
# ---------------------------------------------------------------------------
session_start_main() {
    local input="$1"
    maybe_capture_debug "$input"

    # Popula HOOK_* vars e extrai session_id
    hook_api_parse "$input"
    local session_id="${HOOK_SESSION_ID:-}"
    [ -z "$session_id" ] && session_id="session-$(uuidgen_safe)"
    export SESSION_ID="$session_id"

    local source

    if is_reconnect "$session_id"; then
        # --- Reconexão: mantém estado existente ---
        source="reconnect"
        # GAP-25: executar migração de schema se necessário (estado legado)
        if hook_state_needs_migration; then hook_state_migrate; fi
        hook_log_audit "sessionStart_reconnect" "session_id" "$session_id"
    else
        # --- Nova sessão: inicializa state zerado ---
        source="new"
        init_state "$session_id" "new"
        hook_log_audit "sessionStart_new" "session_id" "$session_id"
    fi

    # Gera/regenera o session-briefing.md
    generate_session_briefing
    hook_log_audit "briefing_generated"

    # GAP-54: auto-run watchdog e anota alertas no briefing se houver issues
    _session_start_append_watchdog_alerts

    # Monta e emite additionalContext
    local additional_ctx
    additional_ctx=$(build_additional_context "$source")
    hook_out_session_start_context "$additional_ctx"  # GAP-61

    exit 0
}

main() { session_start_main "$1"; }
