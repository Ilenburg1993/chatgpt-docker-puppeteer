#!/usr/bin/env bash
# pre-compact-lib.sh — Lógica do PreCompact hook
#
# Responsabilidades:
#   1. Salvar um checkpoint do estado atual antes da compactação
#   2. Emitir additionalContext com o conteúdo do session-briefing.md
#      (garante que após a compactação o agente retoma o contexto correto)
#
# Sourceado por scripts/pre-compact.sh

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
# shellcheck source=hook-payload-api.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hook-payload-api.sh"

export_lang_utf8

# ---------------------------------------------------------------------------
# Checkpoint de estado
# ---------------------------------------------------------------------------

CHECKPOINT_DIR="$STATE_DIR/checkpoints"

# Salva cópia timestampada do session.json em state/checkpoints/
# Mantém no máximo MAX_CHECKPOINTS arquivos (remove os mais antigos)
MAX_CHECKPOINTS=10

save_checkpoint() {
    mkdir -p "$CHECKPOINT_DIR"
    local ts filename
    ts=$(now_iso | tr ':' '-')
    filename="$CHECKPOINT_DIR/session-${ts}.json"
    cp "$STATE_FILE" "$filename" 2> /dev/null || true

    # Prune: mantém apenas os últimos MAX_CHECKPOINTS checkpoints
    local count
    count=$(find "$CHECKPOINT_DIR" -maxdepth 1 -name 'session-*.json' 2> /dev/null | wc -l)
    if [ "$count" -gt "$MAX_CHECKPOINTS" ]; then
        find "$CHECKPOINT_DIR" -maxdepth 1 -name 'session-*.json' -printf '%T@ %p\n' 2> /dev/null \
            | sort -rn | tail -n "+$((MAX_CHECKPOINTS + 1))" | awk '{print $2}' | xargs rm -f
    fi
}

# ---------------------------------------------------------------------------
# Construção do contexto para PreCompact
# ---------------------------------------------------------------------------

# Monta o additionalContext a ser injetado após a compactação.
# Inclui: briefing completo + resumo de tarefas + lembrete de protocolo
build_compact_context() {
    local briefing turn_count consecutive close_key

    # Lê estado atual
    turn_count=$(read_field ".session_stats.turn_count")
    consecutive=$(read_field ".compliance.consecutive_unauthorized")
    close_key=$(read_field ".close_key")

    # Aviso de violações pendentes (se houver)
    local violation_warning=""
    if [ -n "$consecutive" ] && [ "$consecutive" != "0" ] && [ "$consecutive" != "null" ]; then
        violation_warning="⚠️ **${consecutive} turno(s) consecutivos sem vscode_askQuestions**"$'\n'
    fi

    # Briefing completo (regenerado para garantir atualização)
    generate_session_briefing
    briefing=$(read_briefing)

    printf '%s\n%s\n%s' \
        "$briefing" \
        "$(context_block "## Status Pós-Compactação" \
            "${violation_warning}Turnos: ${turn_count:-0} totais | Chave: \`${close_key:-N/A}\`
O contexto acima foi preservado automaticamente antes da compactação.")" \
        "$(context_block "## Ação Imediata" \
            "Continue o trabalho a partir do estado acima. Se houver tarefas em progresso,
retome pelo último TODO marcado como \`in-progress\`.")"
}

# ---------------------------------------------------------------------------
# Entrypoint principal do PreCompact
# ---------------------------------------------------------------------------
pre_compact_main() {
    local input="$1"
    maybe_capture_debug "$input"

    # Popula HOOK_* vars e extrai session_id
    hook_api_parse "$input"
    local session_id="${HOOK_SESSION_ID:-unknown}"
    export SESSION_ID="$session_id"

    # Se não há state, nada a fazer (compactação sem sessão ativa)
    if ! state_exists; then
        exit 0
    fi

    # --- Passo 1: Salvar checkpoint ---
    save_checkpoint
    log_audit "preCompact_checkpoint_saved"

    # --- Passo 2: Emitir additionalContext com briefing completo ---
    local ctx
    ctx=$(build_compact_context)
    emit_additional_context "$ctx"

    exit 0
}

main() { pre_compact_main "$1"; }
