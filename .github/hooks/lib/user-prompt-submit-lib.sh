#!/usr/bin/env bash
# user-prompt-submit-lib.sh — Lógica do UserPromptSubmit hook
#
# Responsabilidades:
#   1. Detectar e curar turno órfão do turno anterior (se aplicável)
#   2. Abrir novo TURN: incrementar contadores, gerar turn_id, setar started_at
#   3. Registrar evento turnStart no audit.jsonl
#
# Sourceado por scripts/user-prompt-submit.sh

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
# shellcheck source=hook-payload-api.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hook-payload-api.sh"

export_lang_utf8

# ---------------------------------------------------------------------------
# Guardrail: garante que state existe antes de processar o turno
# ---------------------------------------------------------------------------

# Inicializa state se necessário (edge case: UserPromptSubmit sem SessionStart)
# Retorna 0 se state já existia, 1 se foi criado agora (auto-init)
ensure_state_initialized() {
    local session_id="${1:-unknown}"
    if ! state_exists; then
        init_state "$session_id" "auto-init"
        hook_log_audit "state_auto_init_on_prompt"
        return 1 # sinaliza: state recém criado
    fi
    return 0
}

# ---------------------------------------------------------------------------
# Ciclo de healing de turno órfão
# ---------------------------------------------------------------------------

# Verifica e cura turno órfão ANTES de abrir o novo turno.
# Um turno é considerado órfão se:
#   - started_at está definido (turno foi aberto)
#   - O tempo decorrido excede ORPHAN_THRESHOLD_SECONDS
# O healing apenas registra o encerramento e ajusta flags — sem bloquear.
# GAP-18: ORPHAN_THRESHOLD_SECONDS respeitável via env (default: 10 minutos)
ORPHAN_THRESHOLD_SECONDS="${ORPHAN_THRESHOLD_SECONDS:-600}"

maybe_heal_orphaned_turn() {
    # Só healer se houve turno anterior (turn_count > 0 e started_at não é null)
    local turn_count started_at
    turn_count=$(read_field ".session_stats.turn_count")
    started_at=$(read_field ".current_turn.started_at")

    [ -z "$started_at" ] || [ "$started_at" = "null" ] && return 0
    [ -z "$turn_count" ] || [ "$turn_count" -eq 0 ] 2> /dev/null && return 0

    if hook_turn_is_orphaned "$ORPHAN_THRESHOLD_SECONDS"; then
        hook_heal_orphaned_turn
    fi
}

# ---------------------------------------------------------------------------
# Extração de metadados do prompt
# ---------------------------------------------------------------------------

# Extrai o texto do prompt do payload (truncado para log)
extract_prompt_preview() {
    local input="$1"
    local prompt
    prompt=$(jq_field "$input" ".userPrompt // .prompt // \"\"")
    # Trunca para 80 chars para evitar logs enormes
    # NEW-L: cut -c1-80 preserva fronteiras UTF-8 (head -c80 trunca em bytes)
    printf '%s' "$prompt" | cut -c1-80
}

# ---------------------------------------------------------------------------
# Entrypoint principal do UserPromptSubmit
# ---------------------------------------------------------------------------
user_prompt_submit_main() {
    local input="$1"
    maybe_capture_debug "$input"

    # Popula HOOK_* vars e extrai session_id
    hook_api_parse "$input"
    local session_id="${HOOK_SESSION_ID:-unknown}"
    export SESSION_ID="$session_id"

    # --- Passo 1: Garante state inicializado ---
    local _was_auto_init=0
    ensure_state_initialized "$session_id" || _was_auto_init=1

    # --- Passo 2: Cura turno órfão se necessário ---
    maybe_heal_orphaned_turn

    # --- Passo 2b: UP-03 — alerta proativo de compliance ---
    # Se consecutive_unauthorized >= 2, emite systemMessage de alerta imediato
    # (antes de abrir o novo turno, enquanto o counter ainda reflete o estado anterior)
    local _consec
    _consec=$(read_field ".compliance.consecutive_unauthorized" 2> /dev/null || printf '0')
    _consec="${_consec:-0}"
    if [ "${_consec}" -ge 2 ] 2> /dev/null; then
        hook_out_system_message "⚠️ COMPLIANCE: ${_consec} turnos consecutivos sem vscode_askQuestions. Chame Template D AGORA antes de qualquer trabalho novo. Turno atual não pode ser encerrado sem essa chamada (stop hook bloqueará se ativo)."
    elif [ "$_was_auto_init" -eq 1 ]; then
        local _close_key
        _close_key=$(read_field ".close_key")
        hook_out_system_message "Sessão iniciada automaticamente pelo sistema de hooks. Protocolo de session ativo. Close-key registrada. Use vscode_askQuestions para autorizar encerramento de turno."
    fi

    # --- Passo 3: Abre novo TURN ---
    local turn_num
    turn_num=$(open_new_turn)

    # --- Passo 4: Log do turnStart ---
    local prompt_preview section_turn turn_id
    prompt_preview=$(extract_prompt_preview "$input")
    turn_id=$(read_field ".current_turn.turn_id")
    section_turn=$(read_field ".current_turn.number") # Neste modelo, number = global turn

    hook_log_audit "turnStart" \
        "turn" "${turn_num}" \
        "turn_id" "${turn_id:-unknown}" \
        "section_turn" "${section_turn:-0}" \
        "prompt_preview" "${prompt_preview}"

    exit 0
}

main() { user_prompt_submit_main "$1"; }
