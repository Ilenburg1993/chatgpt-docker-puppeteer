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
# Configurável via env: HOOKS_CHECKPOINT_MAX (default: 10)
MAX_CHECKPOINTS="${HOOKS_CHECKPOINT_MAX:-10}"

save_checkpoint() {
    mkdir -p "$CHECKPOINT_DIR"
    local ts filename
    ts=$(now_iso | tr ':' '-')
    filename="$CHECKPOINT_DIR/session-${ts}.json"
    cp "$STATE_FILE" "$filename" 2> /dev/null || true

    # GAP-55: prune cross-platform usando ls -t (compativel com macOS/BSD e Linux)
    local count
    count=$(ls "$CHECKPOINT_DIR"/session-*.json 2> /dev/null | wc -l)
    if [ "$count" -gt "$MAX_CHECKPOINTS" ]; then
        ls -t "$CHECKPOINT_DIR"/session-*.json 2> /dev/null \
            | tail -n "+$((MAX_CHECKPOINTS + 1))" \
            | xargs rm -f
    fi
}

# ---------------------------------------------------------------------------
# Construção do contexto para PreCompact
# ---------------------------------------------------------------------------

# Monta o additionalContext a ser injetado após a compactação.
# Inclui: briefing completo + stats + close_key + tarefas + protocolo
# Delega para hook_compact_ctx_briefing_full() do módulo 11-compact-context.sh
build_compact_context() {
    hook_compact_ctx_briefing_full
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
    hook_log_audit "preCompact_checkpoint_saved"

    # --- Passo 1b: UP-15 — warning se turno atual não chamou vscode_askQuestions ---
    local _aq_called _turn_num
    # Usa != "true" em vez de = "false" porque read_field retorna vazio (não "false")
    # para booleans JSON false, devido ao comportamento do operador // empty do jq
    _aq_called=$(read_field '.current_turn.ask_questions_called' 2> /dev/null)
    _turn_num=$(read_field '.current_turn.number' 2> /dev/null || printf '0')
    if [ "${_aq_called}" != "true" ] && [ "${_turn_num:-0}" -gt 0 ]; then
        hook_log_audit "preCompact_ask_questions_missing" \
            "turn" "${_turn_num}" \
            "warning" "vscode_askQuestions não chamado antes da compactação"
    fi

    # --- Passo 2: Emitir additionalContext com briefing completo ---
    local ctx
    ctx=$(build_compact_context)
    hook_out_additional_context "PreCompact" "$ctx"

    exit 0
}

main() { pre_compact_main "$1"; }
