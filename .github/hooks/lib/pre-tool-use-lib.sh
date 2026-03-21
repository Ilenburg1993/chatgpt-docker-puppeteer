#!/usr/bin/env bash
# pre-tool-use-lib.sh — Lógica do PreToolUse hook
#
# Responsabilidades:
#   1. Abrir novo SUBTURN para rastrear a execução da ferramenta
#   2. Incrementar contador de ferramentas (tools_count do turno + tools_total da sessão)
#   3. Registrar evento no audit.jsonl (subturnStart + toolUse)
#   4. Proteção de segurança: bloquear chamada direta a session-close.sh via terminal
#
# Sourceado por scripts/pre-tool-use.sh

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
# shellcheck source=hook-payload-api.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hook-payload-api.sh"

export_lang_utf8

# ---------------------------------------------------------------------------
# Detecção de tool especial: start-turn.sh (declara intenção do turno)
# ---------------------------------------------------------------------------

# Se o agente chamou start-turn.sh, extrai a intenção e atualiza state.
# $1 = tool_input (JSON string)
maybe_capture_turn_intent() {
    local tool_input="$1"
    local intent

    # Detecta padrão: bash .github/hooks/scripts/start-turn.sh "intenção"
    # NEW-F: usar ['"] em vez de ["\x27] — \x27 não é portável em bracket expressions POSIX
    intent=$(printf '%s' "$tool_input" | grep -oE "start-turn\\.sh[[:space:]]+[\"']([^\"']+)[\"']" \
        | sed -E "s/start-turn\\.sh[[:space:]]+[\"']([^\"']+)[\"']/\\1/" || true)

    if [ -n "$intent" ]; then
        update_nested_state "current_turn.intent" "$intent"
        hook_log_audit "turnIntent_declared" "intent" "$intent"
    fi
}

# ---------------------------------------------------------------------------
# Contagem de tool calls: garante state antes de contar
# ---------------------------------------------------------------------------

# Auto-init se o state não existe quando um tool é chamado (sem SessionStart anterior)
ensure_state_for_tool() {
    local session_id="${1:-unknown}"
    if ! state_exists; then
        init_state "$session_id" "auto-init"
        hook_log_audit "state_auto_init_on_tool"
        # Abre também um turn sintético para não deixar tools sem turno (GAP-17: source=synthetic)
        open_new_turn "synthetic" > /dev/null
        hook_log_audit "turnStart_synthetic"
    fi
}

# ---------------------------------------------------------------------------
# Entrypoint principal do PreToolUse
# ---------------------------------------------------------------------------
pre_tool_use_main() {
    local input="$1"
    local _pre_allow_context=""
    maybe_capture_debug "$input"

    # Popula HOOK_* vars a partir do payload (session_id, tool_name, tool_input, etc.)
    hook_api_parse "$input"

    # Exporta SESSION_ID para compatibilidade com funções de state (common.sh)
    local session_id="${HOOK_SESSION_ID:-unknown}"
    export SESSION_ID="$session_id"

    # --- Passo 1: Proteção de segurança (via API) ---
    if hook_is_bypass_attempt; then
        # GAP-20: contabiliza tools bloqueadas por bypass
        if state_exists; then
            increment_field ".session_stats.tools_blocked" > /dev/null || true
        fi
        hook_log_audit "preToolUse_blocked_protected" \
            "tool" "${HOOK_TOOL_NAME:-}" \
            "reason" "chamada direta a script protegido"
        hook_out_pre_deny "session-close.sh não pode ser chamado diretamente. Use o fluxo: vscode_askQuestions (Template F) → usuário digita a close_key."
        exit 0
    fi

    # --- Passo 1c: UP-H4 — enforcement retroativo por turnos consecutivos não-autorizados ---
    # Quando o turno ANTERIOR foi encerrado sem vscode_askQuestions (turno não-autorizado),
    # esta camada injeta pressão crescente logo no PRIMEIRO tool do turno atual:
    #   soft (consecutive >= HOOK_CONSEC_UNAUTH_SOFT, default=1): injection de reminder contextual;
    #   hard (consecutive >= HOOK_CONSEC_UNAUTH_HARD, default=3): bloqueia TODOS os tools
    #     exceto vscode_askQuestions e manage_todo_list, até o agente regularizar compliance.
    #
    # Exemptions (nunca bloqueados): vscode_askQuestions, manage_todo_list, task_complete
    # (task_complete já tem seu próprio gate UP-H1; não duplicar block aqui).
    if state_exists; then
        local _h4_consec _h4_soft _h4_hard _h4_tool
        _h4_consec=$(read_field '.compliance.consecutive_unauthorized' 2> /dev/null || printf '0')
        _h4_soft="${HOOK_CONSEC_UNAUTH_SOFT:-1}"
        _h4_hard="${HOOK_CONSEC_UNAUTH_HARD:-3}"
        _h4_tool="${HOOK_TOOL_NAME:-}"

        # Exemptions — estas ferramentas nunca são bloqueadas por UP-H4
        local _h4_exempt="false"
        case "${_h4_tool}" in
            vscode_askQuestions | manage_todo_list | task_complete) _h4_exempt="true" ;;
        esac

        if [ "${_h4_exempt}" != "true" ] && [ "${_h4_consec:-0}" -ge "${_h4_hard}" ] 2> /dev/null; then
            # Hard enforcement: bloqueia até compliance ser regularizado
            hook_log_audit "preToolUse_h4_hard_block" \
                "tool" "${_h4_tool}" \
                "consecutive_unauthorized" "${_h4_consec}" \
                "threshold_hard" "${_h4_hard}"
            hook_out_pre_deny \
                "🚫 UP-H4 HARD: ${_h4_consec} turnos consecutivos sem vscode_askQuestions (limite: ${_h4_hard})." \
                "⚠️ COMPLIANCE BLOQUEADO: Você DEVE chamar vscode_askQuestions (Template A ou D) AGORA para regularizar. Ferramentas de trabalho estão suspensas até regularização."
            exit 0
        fi

        if [ "${_h4_exempt}" != "true" ] && [ "${_h4_consec:-0}" -ge "${_h4_soft}" ] 2> /dev/null; then
            # Soft enforcement: injeta reminder + deixa a tool prosseguir (hook_out_pre_allow)
            # Só dispara na PRIMEIRA tool de cada turno (tools_count == 0) para não poluir
            local _h4_tc
            _h4_tc=$(read_field '.current_turn.tools_count' 2> /dev/null || printf '1')
            if [ "${_h4_tc:-1}" -eq 0 ] 2> /dev/null; then
                hook_log_audit "preToolUse_h4_soft_reminder" \
                    "tool" "${_h4_tool}" \
                    "consecutive_unauthorized" "${_h4_consec}" \
                    "threshold_soft" "${_h4_soft}"
                _pre_allow_context="⚠️ UP-H4: O turno anterior NÃO foi autorizado (${_h4_consec} consecutivo(s) sem vscode_askQuestions). LEMBRETE URGENTE: ao concluir este turno, você DEVE chamar vscode_askQuestions ANTES de encerrar. Protocolo TODO v9.0 obrigatório."
            fi
        fi
    fi

    # --- Passo 1b: UP-H1/H1b — bloqueia task_complete sem vscode_askQuestions proximal ---
    # Camada 1 (UP-H1):  ask_questions_called=false → turno nunca autorizado.
    # Camada 2 (UP-H1b): ask_questions foi chamado mas outras ferramentas foram usadas DEPOIS,
    #                     indicando que o protocolo "último ato" foi violado.
    #   Permitido: askQ → task_complete (direto, tools_after=0)
    #   Permitido: askQ → manage_todo_list (bookkeeping, 1x) → task_complete (tools_after=1, last=manage_todo_list)
    #   Bloqueado: qualquer outro caso (tools_after > 1, ou last != manage_todo_list)
    if [ "${HOOK_TOOL_NAME:-}" = "task_complete" ] && state_exists; then
        local _h1_aq
        _h1_aq=$(read_field '.current_turn.ask_questions_called' 2> /dev/null || printf 'false')

        # Camada 1: ask_questions ainda não foi chamado neste turno
        if [ "${_h1_aq:-false}" != "true" ]; then
            increment_field ".session_stats.tools_blocked" > /dev/null || true

            # Guard C: detecta heurísticas de completude no summary (✅, "completo", "finalizado", etc.)
            # Permite mensagem mais específica quando o agente sinaliza "terminei" sem askQ.
            local _gc_summary _gc_hit _gc_msg
            _gc_summary=$(printf '%s' "${HOOK_TOOL_INPUT:-{}}" | jq -r '.summary // empty' 2> /dev/null || printf '')
            _gc_hit=$(printf '%s' "${_gc_summary}" \
                | grep -ciE '[✅☑️✔️]|complet[ao]|finaliz[ao]|conclu[íi]d[ao]|entregue|pronto|done\b|finish' \
                    2> /dev/null || printf '0')
            if [ "${_gc_hit:-0}" -gt 0 ] 2> /dev/null; then
                _gc_msg="⚠️ Guard C: seu summary indica conclusão de tarefa mas vscode_askQuestions não foi chamado. Chame Template A (tarefa concluída) AGORA antes de task_complete."
                hook_log_audit "preToolUse_task_complete_blocked" \
                    "tool" "task_complete" \
                    "reason" "guard_c_completion_heuristic_no_askq"
            else
                _gc_msg="⚠️ PROTOCOLO OBRIGATÓRIO: Chame vscode_askQuestions (Template A para tarefa concluída, Template D para checkpoint) AGORA. task_complete NÃO substitui vscode_askQuestions."
                hook_log_audit "preToolUse_task_complete_blocked" \
                    "tool" "task_complete" \
                    "reason" "ask_questions_not_called_this_turn"
            fi
            hook_out_pre_deny \
                "🚫 task_complete bloqueado: você DEVE chamar vscode_askQuestions ANTES de encerrar o turno (Protocolo TODO v9.0)." \
                "${_gc_msg}"
            exit 0
        fi

        # Camada 2: ask_questions foi chamado mas há tools não-bookkeeping depois dele
        local _h1b_taaq _h1b_last _h1b_blocked
        _h1b_taaq=$(read_field '.current_turn.tools_after_ask_questions' 2> /dev/null || printf '0')
        _h1b_last=$(read_field '.current_turn.last_tool_after_ask_questions' 2> /dev/null || printf '')
        _h1b_blocked="false"
        if [ "${_h1b_taaq:-0}" -gt 1 ] 2> /dev/null; then
            _h1b_blocked="true"
        elif [ "${_h1b_taaq:-0}" -eq 1 ] && [ "${_h1b_last:-}" != "manage_todo_list" ] 2> /dev/null; then
            _h1b_blocked="true"
        fi
        if [ "${_h1b_blocked}" = "true" ]; then
            increment_field ".session_stats.tools_blocked" > /dev/null || true
            hook_log_audit "preToolUse_task_complete_blocked" \
                "tool" "task_complete" \
                "reason" "tools_called_after_ask_questions" \
                "tools_after" "${_h1b_taaq:-0}" \
                "last_tool" "${_h1b_last:-unknown}"
            hook_out_pre_deny \
                "🚫 task_complete bloqueado (UP-H1b): vscode_askQuestions foi chamado mas ${_h1b_taaq:-?} ferramenta(s) foram usadas depois (última: '${_h1b_last:-?}')." \
                "⚠️ PROTOCOLO: Chame vscode_askQuestions AGORA como ÚLTIMO ATO. Após a resposta do usuário, só manage_todo_list é permitido antes de task_complete."
            exit 0
        fi

        # Camada 3 (Guard B): task_complete.summary contém perguntas → requer novo askQ
        # Detecta agentes que tentam fazer perguntas em texto simples em vez de usar vscode_askQuestions.
        local _gb_summary _gb_qmarks
        _gb_summary=$(printf '%s' "${HOOK_TOOL_INPUT:-{}}" | jq -r '.summary // empty' 2> /dev/null || printf '')
        _gb_qmarks=$(printf '%s' "${_gb_summary}" | tr -cd '?' | wc -c | tr -d ' ')
        if [ "${_gb_qmarks:-0}" -ge 1 ] 2> /dev/null; then
            increment_field ".session_stats.tools_blocked" > /dev/null || true
            hook_log_audit "preToolUse_task_complete_blocked" \
                "tool" "task_complete" \
                "reason" "guard_b_questions_in_summary" \
                "question_marks" "${_gb_qmarks}"
            hook_out_pre_deny \
                "🚫 Guard B: task_complete.summary contém ${_gb_qmarks} pergunta(s) em texto simples." \
                "⚠️ PROTOCOLO: Se tem perguntas para o usuário, use vscode_askQuestions (Template A) — não embuta perguntas no summary. Chame vscode_askQuestions AGORA com as perguntas relevantes."
            exit 0
        fi
    fi

    # --- Passo 2: Garante state inicializado ---
    ensure_state_for_tool "$session_id"

    # --- Passo 2b: migração defensiva de schema (idempotente) ---
    # Garante que campos do UP-H1b/Guards B/C existam antes de leitura/incremento.
    hook_state_migrate 2> /dev/null || true

    # --- Passo 3: Captura intenção do turno se start-turn.sh foi chamado ---
    maybe_capture_turn_intent "$HOOK_TOOL_INPUT"

    # --- Passo 3b: UP-06 — rate limiting por turno ---
    local _rl_limit="${HOOKS_TOOLS_LIMIT:-150}"
    if state_exists; then
        local _rl_cur
        _rl_cur=$(read_field '.current_turn.tools_count' 2> /dev/null || printf '0')
        if [ "${_rl_cur:-0}" -ge "$_rl_limit" ] 2> /dev/null; then
            increment_field ".session_stats.tools_blocked" > /dev/null || true
            hook_log_audit "preToolUse_rate_limited" \
                "tool" "${HOOK_TOOL_NAME:-unknown}" \
                "tools_count" "${_rl_cur}" \
                "limit" "${_rl_limit}"
            hook_out_pre_deny "⚠️ Rate limit: ${_rl_limit} chamadas de ferramenta por turno atingido. Chame vscode_askQuestions para encerrar o turno."
            exit 0
        fi
    fi

    # --- Passo 4: Abre novo SUBTURN ---
    local subturn_num
    subturn_num=$(open_new_subturn)

    # --- Passo 5: Contabiliza tool use ---
    local tool_num
    tool_num=$(count_tool_use)

    # UP-H3: injeção periódica de contexto a cada 15 ferramentas no turno
    # Lembra o LLM do protocolo quando o contexto longo pode ter diminuído atenção
    if state_exists; then
        local _h3_tc _h3_aq
        _h3_tc=$(read_field '.current_turn.tools_count' 2> /dev/null || printf '0')
        _h3_aq=$(read_field '.current_turn.ask_questions_called' 2> /dev/null || printf 'false')
        # Dispara no múltiplo de 15 (exceto zero) e apenas se turno ainda não autorizado
        if [ "${_h3_tc:-0}" -gt 0 ] && [ "${_h3_aq:-false}" != "true" ] 2> /dev/null; then
            if [ $((_h3_tc % 15)) -eq 0 ] 2> /dev/null; then
                hook_log_audit "preToolUse_periodic_reminder" "tools_count" "${_h3_tc}"
                if [ -z "$_pre_allow_context" ]; then
                    _pre_allow_context="⚠️ Lembrete de protocolo (tool #${_h3_tc} neste turno): ao concluir o trabalho deste turno, você DEVE chamar vscode_askQuestions ANTES de task_complete ou de encerrar. task_complete sem vscode_askQuestions ESTÁ BLOQUEADO. Use Template A para tarefas concluídas."
                fi
            fi
        fi
    fi

    # UP-02: detecta template de vscode_askQuestions (A-G) pelo header da primeira pergunta
    if [ "$HOOK_TOOL_NAME" = "vscode_askQuestions" ] && state_exists; then
        local _tpl_header _tpl_id
        _tpl_header=$(printf '%s' "${HOOK_ASK_QUESTIONS_JSON:-[]}" \
            | jq -r '.[0].header // ""' 2> /dev/null || printf '')
        case "$_tpl_header" in
            "Proposta de upgrade"*) _tpl_id="C" ;;
            "Próxima ação"*) _tpl_id="A" ;;
            "Ação sobre bugs" | *"bugs"*) _tpl_id="B" ;;
            "Checkpoint"*) _tpl_id="D" ;;
            "Kickoff"*) _tpl_id="E" ;;
            *"Encerrar"* | *"SESSION"*) _tpl_id="F" ;;
            "Pré-autorização"*) _tpl_id="G" ;;
            *) _tpl_id="" ;;
        esac
        if [ -n "$_tpl_id" ]; then
            _increment_template_usage "$_tpl_id" > /dev/null || true
        fi
    fi

    # --- Passo 6: Log do subturnStart + toolUse ---
    local subturn_id turn_num
    subturn_id=$(read_field ".current_subturn.subturn_id")
    turn_num=$(read_field ".current_turn.number")

    hook_log_audit "subturnStart" \
        "subturn" "${subturn_num:-0}" \
        "subturn_id" "${subturn_id:-unknown}" \
        "turn" "${turn_num:-0}" \
        "tool" "${HOOK_TOOL_NAME:-unknown}" \
        "tool_call_num" "${tool_num:-0}"

    if [ -n "$_pre_allow_context" ]; then
        hook_out_pre_allow "$_pre_allow_context"
    fi

    exit 0
}

main() { pre_tool_use_main "$1"; }
