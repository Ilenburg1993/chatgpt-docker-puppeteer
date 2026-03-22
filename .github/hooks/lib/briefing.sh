#!/usr/bin/env bash
# briefing.sh — Geração de session-briefing.md e contexto adicional
# Extraído de common.sh (R-06: split de módulos)
# Requer: STATE_DIR, STATE_FILE definidos (via common.sh header)
# Requer: state-crud.sh e utils.sh já sourceados
# Não usar set -euo pipefail (é sourceado, não executado)

# Guard de re-source
[[ -n "${_BRIEFING_LIB_LOADED:-}" ]] && return 0
_BRIEFING_LIB_LOADED=1

# ---------------------------------------------------------------------------
# Geração de session-briefing.md
# ---------------------------------------------------------------------------

BRIEFING_FILE="$STATE_DIR/session-briefing.md"
PENDING_TASKS_FILE="$STATE_DIR/pending-tasks.md"

# Gera (ou regenera) $BRIEFING_FILE com base no estado atual da sessão.
# O arquivo é usado pelo agente como contexto de início/retomada de sessão.
generate_session_briefing() {
    local session_id close_key started_at source
    local turn_count turn_auth turn_unauth consecutive_unauth
    local current_turn_num current_turn_source tools_total tools_blocked subagents_total
    local pending_tasks_content

    session_id=$(read_field ".session_id")
    close_key=$(read_field ".close_key")
    started_at=$(read_field ".started_at")
    source=$(read_field ".source")
    turn_count=$(read_field ".session_stats.turn_count")
    turn_auth=$(read_field ".session_stats.turn_authorized")
    turn_unauth=$(read_field ".session_stats.turn_unauthorized")
    consecutive_unauth=$(read_field ".compliance.consecutive_unauthorized")
    current_turn_num=$(read_field ".current_turn.number")
    current_turn_source=$(read_field ".current_turn.source")
    tools_total=$(read_field ".session_stats.tools_total")
    tools_blocked=$(read_field ".session_stats.tools_blocked")
    subagents_total=$(read_field ".session_stats.subagents_total")

    # Valores padrão para campos ausentes (retrocompatibilidade com state antigo)
    session_id="${session_id:-unknown}"
    close_key="${close_key:-N/A}"
    started_at="${started_at:-N/A}"
    source="${source:-unknown}"
    turn_count="${turn_count:-0}"
    turn_auth="${turn_auth:-0}"
    turn_unauth="${turn_unauth:-0}"
    consecutive_unauth="${consecutive_unauth:-0}"
    current_turn_num="${current_turn_num:-0}"
    current_turn_source="${current_turn_source:-unknown}"
    tools_total="${tools_total:-0}"
    tools_blocked="${tools_blocked:-0}"
    subagents_total="${subagents_total:-0}"

    # GAP-35: sanitizar campos string para evitar injeção de Markdown no heredoc
    session_id=$(sanitize_md "$session_id")
    close_key=$(sanitize_md "$close_key")
    started_at=$(sanitize_md "$started_at")
    source=$(sanitize_md "$source")
    current_turn_source=$(sanitize_md "$current_turn_source")

    # Lê pending-tasks.md se existir (envolvido em bloco para evitar injeção de Markdown)
    if [[ -f "$PENDING_TASKS_FILE" ]]; then
        # shellcheck disable=SC2016  # backticks em aspas simples são literais Markdown (cerca de código), não command substitution
        pending_tasks_content="$(printf '```\n%s\n```' "$(cat "$PENDING_TASKS_FILE")")"
    else
        pending_tasks_content="*(sem tarefas pendentes registradas)*"
    fi

    mkdir -p "$STATE_DIR"
    cat > "$BRIEFING_FILE" << EOF
# Session Briefing

**Gerado em**: $(now_iso)
**Session ID**: \`${session_id}\`
**Iniciada em**: ${started_at}
**Fonte**: ${source}

## Chave de Encerramento

Para encerrar esta sessão, use o Template F com a chave:
> \`${close_key}\`

## Turno Atual

| Campo | Valor |
|-------|-------|
| Número do turno | ${current_turn_num} |
| Fonte | ${current_turn_source} |

## Estatísticas da Sessão

| Métrica | Valor |
|--------|-------|
| Turnos totais | ${turn_count} |
| Autorizados | ${turn_auth} |
| Não-autorizados | ${turn_unauth} |
| Consecutivos sem askQuestions | ${consecutive_unauth} |
| Tools executadas (total) | ${tools_total} |
| Tools bloqueadas (bypass) | ${tools_blocked} |
| Subagentes invocados | ${subagents_total} |

## Tarefas Pendentes

${pending_tasks_content}

## Lembretes Operacionais

- Declare sua intenção com \`bash .github/hooks/scripts/start-turn.sh "intenção"\`
- Chame \`vscode_askQuestions\` ao final de cada turno de trabalho
- Use Template D a cada ~15 turnos para checkpoint periódico
EOF
}

# ---------------------------------------------------------------------------
# Construção de contexto adicional (SessionStart / PreCompact)
# ---------------------------------------------------------------------------

# Formata um bloco de contexto com título e corpo (para uso em additionalContext)
# Uso: context_block "## Título" "Conteúdo do bloco"
context_block() {
    printf '%s\n%s\n\n' "$1" "$2"
}

# Lê session-briefing.md e retorna conteúdo (ou mensagem padrão se não existir)
read_briefing() {
    if [[ -f "$BRIEFING_FILE" ]]; then
        cat "$BRIEFING_FILE"
    else
        printf 'Session briefing não disponível.\n'
    fi
}
