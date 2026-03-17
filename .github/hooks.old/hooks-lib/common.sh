#!/bin/bash

# F7.7 shim canônico: root delega para runtime/common.sh.
if [[ "${HOOKS_LIB_BYPASS_COMMON_SHIM:-0}" != "1" ]]; then
    _hooks_lib_root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    # shellcheck disable=SC1091
    source "${_hooks_lib_root_dir}/runtime/common.sh"
    return 0
fi

# hooks-lib/common.sh — Biblioteca de funções compartilhadas para os scripts de hook.
#
# COMO USAR:
#   HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
#   source "$HOOK_DIR/hooks-lib/common.sh"
#
# Funções disponíveis:
#   iso_now            — retorna timestamp ISO-8601 UTC
#   get_session_id     — retorna session_id do contexto ativo
#   ctx_read <jq_path> — lê um campo do session-context.json
#   ctx_update <jq_expr> — atualiza session-context.json atomicamente (com flock)
#   log_event <json>   — appenda evento em audit.jsonl
#   with_lock <lockfile> <cmd...> — executa cmd com flock exclusivo
#   redact_credentials <string> — remove tokens/senhas do texto
#   log_info <msg>     — loga mensagem informativa em stderr
#   log_warn <msg>     — loga aviso em stderr
#   log_error <msg>    — loga erro em stderr
#
# Variáveis exportadas (disponíveis após source):
#   HOOK_LIB_VERSION   — versão da biblioteca
#   LOG_DIR, STATE_DIR, CTX_FILE, AUDIT_FILE — caminhos canônicos
#   HOOKS_FLOCK_TIMEOUT, HOOKS_HEAL_THRESHOLD, etc. — tunáveis de config.sh

HOOK_LIB_VERSION="1.1"
export HOOK_LIB_VERSION

# Resolve caminhos a partir de HOOK_DIR (deve ser definido pelo script chamador)
if [ -z "${HOOK_DIR:-}" ]; then
    HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

LOG_DIR="${LOG_DIR:-$HOOK_DIR/logs}"
STATE_DIR="${STATE_DIR:-$HOOK_DIR/state}"
CTX_FILE="${CTX_FILE:-$STATE_DIR/session-context.json}"
AUDIT_FILE="${AUDIT_FILE:-$LOG_DIR/audit.jsonl}"

# Carrega tunáveis centralizados (idempotente via HOOKS_CONFIG_LOADED guard)
# shellcheck disable=SC1091
source "$HOOK_DIR/hooks-lib/config.sh" 2> /dev/null || true

# Garante diretórios
mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"
mkdir -p "$STATE_DIR"

# ── iso_now ──────────────────────────────────────────────────────────────────
# Retorna timestamp ISO-8601 UTC. Nunca falha — retorna 'unknown' em último caso.
#
# Uso: NOW="$(iso_now)"
iso_now() {
    date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo 'unknown'
}

# ── get_session_id ───────────────────────────────────────────────────────────
# Lê session_id do contexto ativo. Retorna string vazia se não disponível.
#
# Uso: SID="$(get_session_id)"
get_session_id() {
    if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ]; then
        jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo ''
    else
        echo ''
    fi
}

# ── ctx_read ─────────────────────────────────────────────────────────────────
# Lê um campo do session-context.json.
# Parâmetros: $1 = expressão jq (ex: '.current_turn.number'), $2 = fallback
#
# Uso: TURN="$(ctx_read '.current_turn.number' 0)"
ctx_read() {
    local expr="${1:-.}" fallback="${2:-}"
    if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ]; then
        jq -r "${expr} // empty" "$CTX_FILE" 2> /dev/null || echo "$fallback"
    else
        echo "$fallback"
    fi
}

# ── with_lock ────────────────────────────────────────────────────────────────
# Executa um comando com flock exclusivo no lockfile.
# Garante que apenas uma instância do hook modifica session-context.json de cada vez.
#
# Parâmetros: $1 = arquivo de lock, $2... = comando a executar
# Retorno: código de saída do comando
#
# Uso: with_lock "$CTX_FILE.lock" jq '...' "$CTX_FILE" | sponge "$CTX_FILE"
with_lock() {
    local lockfile="$1"
    shift
    # BUG-67 FIX: Padronizar timeout para HOOKS_FLOCK_TIMEOUT (padrão 5s, consistente com config.sh)
    local _timeout="${HOOKS_FLOCK_TIMEOUT:-5}"
    if command -v flock > /dev/null 2>&1; then
        # shellcheck disable=SC2094
        (
            flock -x -w "$_timeout" 9 2> /dev/null
            "$@"
        ) 9> "$lockfile"
    else
        # flock não disponível — executa sem lock (degraded mode)
        "$@"
    fi
}

# ── run_aux_block ───────────────────────────────────────────────────────────
# Executa bloco auxiliar em subshell com timeout e log de falha.
# Não deve ser usado para fluxo crítico de lifecycle; apenas jobs fail-open.
#
# Parâmetros:
#   $1 = nome lógico do bloco (ex.: "session-start:trends")
#   $2 = timeout em segundos (inteiro >= 1)
#   $3... = comando/função + args
#
# Retorno:
#   0 em sucesso
#   124 em timeout
#   rc do comando em falha
run_aux_block() {
    local block_name="${1:-aux-block}"
    local timeout_s="${2:-5}"
    shift 2 || true

    if ! [[ "$timeout_s" =~ ^[0-9]+$ ]] || [ "$timeout_s" -lt 1 ]; then
        timeout_s=5
    fi

    [ $# -gt 0 ] || return 1

    (
        "$@"
    ) &
    local pid=$!
    local elapsed=0

    while kill -0 "$pid" 2> /dev/null; do
        if [ "$elapsed" -ge "$timeout_s" ]; then
            kill -TERM "$pid" 2> /dev/null || true
            sleep 1
            kill -KILL "$pid" 2> /dev/null || true
            wait "$pid" 2> /dev/null || true
            log_warn "aux timeout" "block=${block_name}" "timeout_s=${timeout_s}"
            return 124
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done

    wait "$pid"
    local rc=$?
    if [ "$rc" -ne 0 ]; then
        log_warn "aux failure" "block=${block_name}" "rc=${rc}"
    fi
    return "$rc"
}

# ── ctx_update ───────────────────────────────────────────────────────────────
# Atualiza session-context.json atomicamente com flock.
# Parâmetros: $1 = expressão jq de transformação (ex: '.current_turn.number += 1')
# Retorno: 0 em sucesso, 1 em falha ou se CTX_FILE não existir
#
# Uso: ctx_update '.current_turn.tools_count += 1'
ctx_update() {
    local expr="$1"
    [ -f "$CTX_FILE" ] || return 1

    local lockfile="${CTX_FILE}.lock"

    if command -v sponge > /dev/null 2>&1; then
        with_lock "$lockfile" \
            sh -c "jq '${expr}' \"$CTX_FILE\" | sponge \"$CTX_FILE\"" 2> /dev/null || return 1
    else
        local tmp
        # fix Haiku C6.1: valida mktemp antes de usar
        tmp="$(mktemp)" || return 1
        if with_lock "$lockfile" \
            sh -c "jq '${expr}' \"$CTX_FILE\" > \"$tmp\"" 2> /dev/null; then
            # UPG-AUDIT-01: resolve symlink antes de mv para não quebrar o pointeiro.
            local _real_ctx
            _real_ctx="$(readlink -f "$CTX_FILE" 2> /dev/null || echo "$CTX_FILE")"
            mv "$tmp" "$_real_ctx" 2> /dev/null || {
                rm -f "$tmp"
                return 1
            }
        else
            rm -f "$tmp"
            return 1
        fi
    fi
    return 0
}

# ── ctx_apply_jq_expr_best_effort ─────────────────────────────────────────
# Aplica uma expressão jq no CTX_FILE sem gerenciar lock internamente.
# Uso recomendado: cenários onde o lock já foi obtido no script chamador.
#
# Parâmetros:
#   $1 = expressão jq
#   $@ (restante) = argumentos opcionais para jq (--arg/--argjson/...)
#
# Retorno:
#   0 em best-effort (mesmo com falhas não fatais), 1 se CTX ausente/expr vazia
ctx_apply_jq_expr_best_effort() {
    local expr="${1:-}"
    shift || true

    [ -n "$expr" ] || return 1
    [ -f "$CTX_FILE" ] || return 1

    if command -v sponge > /dev/null 2>&1; then
        jq "$@" "$expr" "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    else
        local _tmp_ctx
        if _tmp_ctx="$(mktemp 2> /dev/null)"; then
            if jq "$@" "$expr" "$CTX_FILE" > "$_tmp_ctx" 2> /dev/null; then
                local _real_ctx
                _real_ctx="$(readlink -f "$CTX_FILE" 2> /dev/null || echo "$CTX_FILE")"
                mv "$_tmp_ctx" "$_real_ctx" 2> /dev/null || rm -f "$_tmp_ctx"
            else
                rm -f "$_tmp_ctx"
            fi
        fi
    fi

    return 0
}

# ── resolve_hook_runtime_input ──────────────────────────────────────────────
# Lê stdin do hook, extrai campos-base de runtime e resolve paths per-session.
# Exporta variáveis globais esperadas pelos scripts de hook:
#   INPUT, TIMESTAMP, SESSION_ID_PAYLOAD, NOW_ISO
# Também aplica apply_per_session_paths quando SESSION_ID_PAYLOAD está presente.
resolve_hook_runtime_input() {
    INPUT="$(cat 2> /dev/null || true)"
    TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
    SESSION_ID_PAYLOAD="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"
    NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"

    if [ -n "${SESSION_ID_PAYLOAD:-}" ] && command -v apply_per_session_paths > /dev/null 2>&1; then
        apply_per_session_paths "${SESSION_ID_PAYLOAD:-}" 2> /dev/null || true
    fi

    export INPUT TIMESTAMP SESSION_ID_PAYLOAD NOW_ISO
    return 0
}

# ── write_askquestions_turn_state ───────────────────────────────────────────
# Writer unificado para atualizar estado do current_turn após vscode_askQuestions.
# Reduz duplicação em hooks que persistem auth_requested + metadados de Template F.
#
# Parâmetros:
#   $1 = result (success|failure|unknown)
#   $2 = response_json (string JSON serializada)
#   $3 = timestamp ISO
#   $4 = ask_template_f ("true"|"false")
#   $5 = ask_close_action
#   $6 = ask_close_key_found ("true"|"false")
#
# Retorno: 0 em sucesso best-effort (não-fatal), 1 se CTX inexistente
write_askquestions_turn_state() {
    local result="${1:-unknown}"
    local response_json="${2:-}"
    local ts="${3:-$(iso_now)}"
    local ask_template_f="${4:-false}"
    local ask_close_action="${5:-not_applicable}"
    local ask_close_key_found="${6:-false}"

    [ -f "$CTX_FILE" ] || return 1

    local jq_expr
    jq_expr='.last_tool.result = $result
        | .current_turn.last_askquestions_response = $response
        | .current_turn.auth_requested = true
        | .current_turn.auth_requested_at = $ts
        | .current_turn.last_askquestions_template = (if $ask_template_f == "true" then "template_f" else "other" end)
        | .current_turn.last_askquestions_close_action = $ask_close_action
        | .current_turn.last_askquestions_close_key_found = ($ask_close_key_found == "true")
        | .current_turn.todo_refresh_required = true
        | .current_turn.todo_refresh_required_at = $ts'

    if command -v sponge > /dev/null 2>&1; then
        jq \
            --arg result "$result" \
            --arg response "$response_json" \
            --arg ts "$ts" \
            --arg ask_template_f "$ask_template_f" \
            --arg ask_close_action "$ask_close_action" \
            --arg ask_close_key_found "$ask_close_key_found" \
            "$jq_expr" "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    else
        local _tmp_waq
        if _tmp_waq="$(mktemp 2> /dev/null)"; then
            if jq \
                --arg result "$result" \
                --arg response "$response_json" \
                --arg ts "$ts" \
                --arg ask_template_f "$ask_template_f" \
                --arg ask_close_action "$ask_close_action" \
                --arg ask_close_key_found "$ask_close_key_found" \
                "$jq_expr" "$CTX_FILE" > "$_tmp_waq" 2> /dev/null; then
                mv "$_tmp_waq" "$CTX_FILE" 2> /dev/null || rm -f "$_tmp_waq"
            else
                rm -f "$_tmp_waq"
            fi
        fi
    fi

    return 0
}

# ── write_last_tool_result ──────────────────────────────────────────────────
# Atualiza apenas .last_tool.result no session-context.
write_last_tool_result() {
    local result="${1:-unknown}"
    [ -f "$CTX_FILE" ] || return 1
    if command -v sponge > /dev/null 2>&1; then
        jq --arg result "$result" '.last_tool.result = $result' "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    else
        local _tmp_wltr
        if _tmp_wltr="$(mktemp 2> /dev/null)"; then
            if jq --arg result "$result" '.last_tool.result = $result' "$CTX_FILE" > "$_tmp_wltr" 2> /dev/null; then
                mv "$_tmp_wltr" "$CTX_FILE" 2> /dev/null || rm -f "$_tmp_wltr"
            else
                rm -f "$_tmp_wltr"
            fi
        fi
    fi
    return 0
}

# ── increment_turn_failure_counters ─────────────────────────────────────────
# Incrementa contadores de falha do turno e da sessão.
increment_turn_failure_counters() {
    [ -f "$CTX_FILE" ] || return 1
    if command -v sponge > /dev/null 2>&1; then
        jq '.current_turn.failures_count = ((.current_turn.failures_count // 0) + 1)
            | .session_stats.failures_detected = ((.session_stats.failures_detected // 0) + 1)' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    else
        local _tmp_ifc
        if _tmp_ifc="$(mktemp 2> /dev/null)"; then
            if jq '.current_turn.failures_count = ((.current_turn.failures_count // 0) + 1)
                | .session_stats.failures_detected = ((.session_stats.failures_detected // 0) + 1)' \
                "$CTX_FILE" > "$_tmp_ifc" 2> /dev/null; then
                mv "$_tmp_ifc" "$CTX_FILE" 2> /dev/null || rm -f "$_tmp_ifc"
            else
                rm -f "$_tmp_ifc"
            fi
        fi
    fi
    return 0
}

# ── mark_turn_todo_created_true ─────────────────────────────────────────────
# Marca flag current_turn.todo_created=true.
mark_turn_todo_created_true() {
    local ts="${1:-$(iso_now)}"
    [ -f "$CTX_FILE" ] || return 1
    if command -v sponge > /dev/null 2>&1; then
        jq --arg ts "$ts" '
            .current_turn.todo_created = true
            | (if (.current_turn.todo_refresh_required // false)
                then .current_turn.todo_refresh_required = false
                else .
               end)
            | .current_turn.todo_refresh_done_at = $ts
        ' "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    else
        local _tmp_todo
        if _tmp_todo="$(mktemp 2> /dev/null)"; then
            if jq --arg ts "$ts" '
                .current_turn.todo_created = true
                | (if (.current_turn.todo_refresh_required // false)
                    then .current_turn.todo_refresh_required = false
                    else .
                   end)
                | .current_turn.todo_refresh_done_at = $ts
            ' "$CTX_FILE" > "$_tmp_todo" 2> /dev/null; then
                mv "$_tmp_todo" "$CTX_FILE" 2> /dev/null || rm -f "$_tmp_todo"
            else
                rm -f "$_tmp_todo"
            fi
        fi
    fi
    return 0
}

# ── ensure_strict_turn_close_flag_default ──────────────────────────────────
# Garante que session.strict_turn_close_requires_key exista no contexto.
# Regra: se ausente/null -> true; se já for false/true explícito, preserva.
# Útil para backfill de contextos legados criados antes do hardening estrito.
#
# Parâmetros:
#   $1 = caminho opcional do contexto (default: $CTX_FILE)
#
# Retorno:
#   0 quando o backfill foi tentado com sucesso best-effort
#   1 quando o arquivo não existe
ensure_strict_turn_close_flag_default() {
    local ctx_file="${1:-$CTX_FILE}"
    [ -f "$ctx_file" ] || return 1

    local jq_expr
    jq_expr='.session = ((.session // {}) + {
        strict_turn_close_requires_key: (
            if (.session.strict_turn_close_requires_key == null)
            then true
            else .session.strict_turn_close_requires_key
            end
        )
    })'

    if command -v sponge > /dev/null 2>&1; then
        jq "$jq_expr" "$ctx_file" | sponge "$ctx_file" 2> /dev/null || true
    else
        local _tmp_strict
        if _tmp_strict="$(mktemp 2> /dev/null)"; then
            if jq "$jq_expr" "$ctx_file" > "$_tmp_strict" 2> /dev/null; then
                mv "$_tmp_strict" "$ctx_file" 2> /dev/null || rm -f "$_tmp_strict"
            else
                rm -f "$_tmp_strict"
            fi
        fi
    fi

    return 0
}

# ── emit_subturn_transition_event ──────────────────────────────────────────
# Emite evento canônico subturnTransition no audit.
emit_subturn_transition_event() {
    local audit_file="$1"
    local sid="$2"
    local ts="$3"
    local turn_id="$4"
    local subturn_id="$5"
    local subturn_number="${6:-1}"
    local from_state="${7:-active}"
    local to_state="${8:-active}"
    local reason="${9:-unspecified}"
    local trigger_event="${10:-unknown}"

    jq -cn \
        --arg event "subturnTransition" \
        --arg sid "$sid" \
        --arg ts "$ts" \
        --arg turn_id "$turn_id" \
        --arg subturn_id "$subturn_id" \
        --argjson subturn_number "${subturn_number:-1}" \
        --arg from_state "$from_state" \
        --arg to_state "$to_state" \
        --arg reason "$reason" \
        --arg trigger_event "$trigger_event" \
        ' {
            event: $event,
            session_id: $sid,
            timestamp: $ts,
            turn_id: (if $turn_id == "" then null else $turn_id end),
            parent_turn_id: (if $turn_id == "" then null else $turn_id end),
            subturn_id: (if $subturn_id == "" then null else $subturn_id end),
            subturn_number: $subturn_number,
            from_state: $from_state,
            to_state: $to_state,
            reason: $reason,
            trigger_event: $trigger_event
        }' >> "$audit_file"
}

# ── emit_subturn_start_event ───────────────────────────────────────────────
# Emite evento canônico subturnStart no audit.
emit_subturn_start_event() {
    local audit_file="$1"
    local sid="$2"
    local ts="$3"
    local turn_id="$4"
    local subturn_id="$5"
    local subturn_number="${6:-1}"
    local reason="${7:-turn_start}"
    local state="${8:-active}"
    local trigger_event="${9:-unknown}"

    jq -cn \
        --arg event "subturnStart" \
        --arg sid "$sid" \
        --arg ts "$ts" \
        --arg turn_id "$turn_id" \
        --arg subturn_id "$subturn_id" \
        --argjson subturn_number "${subturn_number:-1}" \
        --arg reason "$reason" \
        --arg state "$state" \
        --arg trigger_event "$trigger_event" \
        ' {
            event: $event,
            session_id: $sid,
            timestamp: $ts,
            turn_id: (if $turn_id == "" then null else $turn_id end),
            parent_turn_id: (if $turn_id == "" then null else $turn_id end),
            subturn_id: (if $subturn_id == "" then null else $subturn_id end),
            subturn_number: $subturn_number,
            reason: $reason,
            state: $state,
            trigger_event: $trigger_event
        }' >> "$audit_file"
}

# ── emit_subturn_resume_event ──────────────────────────────────────────────
# Emite evento canônico subturnResume no audit.
emit_subturn_resume_event() {
    local audit_file="$1"
    local sid="$2"
    local ts="$3"
    local turn_id="$4"
    local subturn_id="$5"
    local subturn_number="${6:-1}"
    local reason="${7:-resume}"
    local trigger_event="${8:-unknown}"

    jq -cn \
        --arg event "subturnResume" \
        --arg sid "$sid" \
        --arg ts "$ts" \
        --arg turn_id "$turn_id" \
        --arg subturn_id "$subturn_id" \
        --argjson subturn_number "${subturn_number:-1}" \
        --arg reason "$reason" \
        --arg trigger_event "$trigger_event" \
        ' {
            event: $event,
            session_id: $sid,
            timestamp: $ts,
            turn_id: (if $turn_id == "" then null else $turn_id end),
            parent_turn_id: (if $turn_id == "" then null else $turn_id end),
            subturn_id: (if $subturn_id == "" then null else $subturn_id end),
            subturn_number: $subturn_number,
            reason: $reason,
            trigger_event: $trigger_event
        }' >> "$audit_file"
}

# ── emit_subturn_end_event ─────────────────────────────────────────────────
# Emite evento canônico subturnEnd no audit.
emit_subturn_end_event() {
    local audit_file="$1"
    local sid="$2"
    local ts="$3"
    local turn_id="$4"
    local subturn_id="$5"
    local subturn_number="${6:-1}"
    local from_state="${7:-active}"
    local from_reason="${8:-unspecified}"
    local reason="${9:-completed}"
    local final_state="${10:-closed}"
    local duration_ms="${11:-null}"

    if ! echo "$duration_ms" | grep -Eq '^(null|-?[0-9]+(\.[0-9]+)?)$'; then
        duration_ms="null"
    fi

    jq -cn \
        --arg event "subturnEnd" \
        --arg sid "$sid" \
        --arg ts "$ts" \
        --arg turn_id "$turn_id" \
        --arg subturn_id "$subturn_id" \
        --argjson subturn_number "${subturn_number:-1}" \
        --arg from_state "$from_state" \
        --arg from_reason "$from_reason" \
        --arg reason "$reason" \
        --arg final_state "$final_state" \
        --argjson duration_ms "$duration_ms" \
        ' {
            event: $event,
            session_id: $sid,
            timestamp: $ts,
            turn_id: (if $turn_id == "" then null else $turn_id end),
            parent_turn_id: (if $turn_id == "" then null else $turn_id end),
            subturn_id: (if $subturn_id == "" then null else $subturn_id end),
            subturn_number: $subturn_number,
            from_state: $from_state,
            from_reason: $from_reason,
            reason: $reason,
            final_state: $final_state,
            duration_ms: $duration_ms
        }' >> "$audit_file"
}

# ── write_current_subturn_state ────────────────────────────────────────────
# Atualiza current_turn.subturn com estado/razão/temporalidade e snapshot de autorização.
# Params:
#   $1 ts, $2 state, $3 reason, $4 stop_hook_active(true|false), $5 requires_user_action(true|false)
#   $6 subturn_id(optional), $7 subturn_number(optional), $8 expected_window_minutes(optional)
write_current_subturn_state() {
    local ts="${1:-$(iso_now)}"
    local state="${2:-active}"
    local reason="${3:-unspecified}"
    local stop_hook_active="${4:-false}"
    local requires_user_action="${5:-false}"
    local subturn_id="${6:-}"
    local subturn_number="${7:-}"
    local expected_window_minutes="${8:-}"

    [ -f "$CTX_FILE" ] || return 1

    local jq_expr
    jq_expr='.current_turn.subturn = ((.current_turn.subturn // {}) + {
            parent_turn_id: (.current_turn.turn_id // null),
            state: $state,
            reason: $reason,
            last_transition_at: $ts,
            stop_hook_active: ($stop_hook_active == "true"),
            requires_user_action: ($requires_user_action == "true"),
            authorization_snapshot: {
                auth_requested: (.current_turn.auth_requested // false),
                ask_template: (.current_turn.last_askquestions_template // null),
                close_key_found: (.current_turn.last_askquestions_close_key_found // false),
                close_key_validated: (.session.close_key_validated // false)
            }
         }
         + (if $subturn_id == "" then {} else {subturn_id: $subturn_id} end)
         + (if $subturn_number == "" then {} else {number: ($subturn_number|tonumber)} end)
         + (if $expected_window_minutes == "" then {} else {expected_window_minutes: ($expected_window_minutes|tonumber)} end))'

    if command -v sponge > /dev/null 2>&1; then
        jq \
            --arg ts "$ts" \
            --arg state "$state" \
            --arg reason "$reason" \
            --arg stop_hook_active "$stop_hook_active" \
            --arg requires_user_action "$requires_user_action" \
            --arg subturn_id "$subturn_id" \
            --arg subturn_number "$subturn_number" \
            --arg expected_window_minutes "$expected_window_minutes" \
            "$jq_expr" "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    else
        local _tmp_ws
        if _tmp_ws="$(mktemp 2> /dev/null)"; then
            if jq \
                --arg ts "$ts" \
                --arg state "$state" \
                --arg reason "$reason" \
                --arg stop_hook_active "$stop_hook_active" \
                --arg requires_user_action "$requires_user_action" \
                --arg subturn_id "$subturn_id" \
                --arg subturn_number "$subturn_number" \
                --arg expected_window_minutes "$expected_window_minutes" \
                "$jq_expr" "$CTX_FILE" > "$_tmp_ws" 2> /dev/null; then
                mv "$_tmp_ws" "$CTX_FILE" 2> /dev/null || rm -f "$_tmp_ws"
            else
                rm -f "$_tmp_ws"
            fi
        fi
    fi

    return 0
}

# ── auto_advance_subturn_n_plus_one ───────────────────────────────────────
# Encerra o SubTurn atual e abre automaticamente o próximo (n+1) no mesmo TURN.
# Fluxo canônico para askQuestions de continuidade: mantém SESSION/TURN e evolui
# apenas a rodada interna.
#
# Params:
#   $1 ts (ISO)
#   $2 next_reason
#   $3 trigger_event
#   $4 next_state (default: active)
#   $5 next_requires_user_action (true|false)
#   $6 audit_file (optional; default AUDIT_FILE)
#   $7 session_id (optional)
auto_advance_subturn_n_plus_one() {
    local ts="${1:-$(iso_now)}"
    local next_reason="${2:-askquestions_followup_n_plus_one}"
    local trigger_event="${3:-postToolUse}"
    local next_state="${4:-active}"
    local next_requires_user_action="${5:-false}"
    local audit_file="${6:-$AUDIT_FILE}"
    local session_id="${7:-$(get_session_id)}"

    [ -f "$CTX_FILE" ] || return 1

    local curr_subturn_number curr_subturn_id curr_state curr_reason curr_started_at curr_turn_id
    curr_subturn_number="$(jq -r '.current_turn.subturn.number // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
    curr_subturn_id="$(jq -r '.current_turn.subturn.subturn_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    curr_state="$(jq -r '.current_turn.subturn.state // "active"' "$CTX_FILE" 2> /dev/null || echo 'active')"
    curr_reason="$(jq -r '.current_turn.subturn.reason // "turn_runtime"' "$CTX_FILE" 2> /dev/null || echo 'turn_runtime')"
    curr_started_at="$(jq -r '.current_turn.subturn.started_at // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    curr_turn_id="$(jq -r '.current_turn.turn_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"

    if ! [[ "$curr_subturn_number" =~ ^[0-9]+$ ]]; then
        curr_subturn_number=1
    fi

    if [ -z "$curr_subturn_id" ]; then
        curr_subturn_id="${curr_turn_id:-turn_unknown}_st${curr_subturn_number}"
    fi

    local next_subturn_number next_subturn_id
    next_subturn_number=$((curr_subturn_number + 1))
    next_subturn_id="${curr_turn_id:-turn_unknown}_st${next_subturn_number}"

    local duration_ms="null"
    if [ -n "$curr_started_at" ]; then
        local _st_epoch _end_epoch
        _st_epoch="$(iso_to_epoch_portable "$curr_started_at")"
        _end_epoch="$(iso_to_epoch_portable "$ts")"
        if [[ "$_st_epoch" =~ ^[0-9]+$ ]] && [[ "$_end_epoch" =~ ^[0-9]+$ ]] && [ "$_end_epoch" -ge "$_st_epoch" ] 2> /dev/null; then
            duration_ms="$(((_end_epoch - _st_epoch) * 1000))"
        fi
    fi

    if command -v sponge > /dev/null 2>&1; then
        jq \
            --arg ts "$ts" \
            --arg curr_subturn_id "$curr_subturn_id" \
            --argjson curr_subturn_number "$curr_subturn_number" \
            --arg curr_state "$curr_state" \
            --arg curr_reason "$curr_reason" \
            --arg curr_started_at "$curr_started_at" \
            --argjson duration_ms "$duration_ms" \
            --arg next_subturn_id "$next_subturn_id" \
            --argjson next_subturn_number "$next_subturn_number" \
            --arg next_state "$next_state" \
            --arg next_reason "$next_reason" \
            --arg next_requires_user_action "$next_requires_user_action" \
            '.current_turn.subturn_history = ((.current_turn.subturn_history // []) + [{
                number: $curr_subturn_number,
                subturn_id: $curr_subturn_id,
                parent_turn_id: (.current_turn.turn_id // null),
                state: $curr_state,
                reason: $curr_reason,
                started_at: (if $curr_started_at == "" then null else $curr_started_at end),
                ended_at: $ts,
                duration_ms: $duration_ms
             }] | if length > 20 then .[-20:] else . end)
             | .current_turn.subturn = {
                number: $next_subturn_number,
                subturn_id: $next_subturn_id,
                state: $next_state,
                reason: $next_reason,
                started_at: $ts,
                last_transition_at: $ts,
                parent_turn_id: (.current_turn.turn_id // null),
                expected_window_minutes: 15,
                stop_hook_active: false,
                requires_user_action: ($next_requires_user_action == "true"),
                authorization_snapshot: {
                    auth_requested: (.current_turn.auth_requested // false),
                    ask_template: (.current_turn.last_askquestions_template // null),
                    close_key_found: (.current_turn.last_askquestions_close_key_found // false),
                    close_key_validated: (.session.close_key_validated // false)
                }
             }
             | .session_stats.subturn_count = ((.session_stats.subturn_count // 0) + 1)
             | .session_stats.subturn_resumed = ((.session_stats.subturn_resumed // 0) + (if $next_state == "active" then 1 else 0 end))' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    else
        local _tmp_subturn_next
        if _tmp_subturn_next="$(mktemp 2> /dev/null)"; then
            if jq \
                --arg ts "$ts" \
                --arg curr_subturn_id "$curr_subturn_id" \
                --argjson curr_subturn_number "$curr_subturn_number" \
                --arg curr_state "$curr_state" \
                --arg curr_reason "$curr_reason" \
                --arg curr_started_at "$curr_started_at" \
                --argjson duration_ms "$duration_ms" \
                --arg next_subturn_id "$next_subturn_id" \
                --argjson next_subturn_number "$next_subturn_number" \
                --arg next_state "$next_state" \
                --arg next_reason "$next_reason" \
                --arg next_requires_user_action "$next_requires_user_action" \
                '.current_turn.subturn_history = ((.current_turn.subturn_history // []) + [{
                    number: $curr_subturn_number,
                    subturn_id: $curr_subturn_id,
                    parent_turn_id: (.current_turn.turn_id // null),
                    state: $curr_state,
                    reason: $curr_reason,
                    started_at: (if $curr_started_at == "" then null else $curr_started_at end),
                    ended_at: $ts,
                    duration_ms: $duration_ms
                 }] | if length > 20 then .[-20:] else . end)
                 | .current_turn.subturn = {
                    number: $next_subturn_number,
                    subturn_id: $next_subturn_id,
                    state: $next_state,
                    reason: $next_reason,
                    started_at: $ts,
                    last_transition_at: $ts,
                    parent_turn_id: (.current_turn.turn_id // null),
                    expected_window_minutes: 15,
                    stop_hook_active: false,
                    requires_user_action: ($next_requires_user_action == "true"),
                    authorization_snapshot: {
                        auth_requested: (.current_turn.auth_requested // false),
                        ask_template: (.current_turn.last_askquestions_template // null),
                        close_key_found: (.current_turn.last_askquestions_close_key_found // false),
                        close_key_validated: (.session.close_key_validated // false)
                    }
                 }
                 | .session_stats.subturn_count = ((.session_stats.subturn_count // 0) + 1)
                 | .session_stats.subturn_resumed = ((.session_stats.subturn_resumed // 0) + (if $next_state == "active" then 1 else 0 end))' \
                "$CTX_FILE" > "$_tmp_subturn_next" 2> /dev/null; then
                mv "$_tmp_subturn_next" "$CTX_FILE" 2> /dev/null || rm -f "$_tmp_subturn_next"
            else
                rm -f "$_tmp_subturn_next"
            fi
        fi
    fi

    if [ -n "$session_id" ] && [ -n "$audit_file" ]; then
        if command -v emit_subturn_end_event > /dev/null 2>&1; then
            emit_subturn_end_event \
                "$audit_file" \
                "$session_id" \
                "$ts" \
                "$curr_turn_id" \
                "$curr_subturn_id" \
                "$curr_subturn_number" \
                "$curr_state" \
                "$curr_reason" \
                "askquestions_cycle_closed" \
                "closed" \
                "$duration_ms"
        fi
        if command -v emit_subturn_start_event > /dev/null 2>&1; then
            emit_subturn_start_event \
                "$audit_file" \
                "$session_id" \
                "$ts" \
                "$curr_turn_id" \
                "$next_subturn_id" \
                "$next_subturn_number" \
                "$next_reason" \
                "$next_state" \
                "$trigger_event"
        fi
        jq -cn \
            --arg event "subturnAutoAdvance" \
            --arg sid "$session_id" \
            --arg ts "$ts" \
            --arg turn_id "$curr_turn_id" \
            --arg from_subturn_id "$curr_subturn_id" \
            --argjson from_subturn_number "$curr_subturn_number" \
            --arg to_subturn_id "$next_subturn_id" \
            --argjson to_subturn_number "$next_subturn_number" \
            --arg reason "$next_reason" \
            --arg trigger_event "$trigger_event" \
            '{
                event: $event,
                session_id: $sid,
                timestamp: $ts,
                turn_id: (if $turn_id == "" then null else $turn_id end),
                parent_turn_id: (if $turn_id == "" then null else $turn_id end),
                from_subturn_id: $from_subturn_id,
                from_subturn_number: $from_subturn_number,
                to_subturn_id: $to_subturn_id,
                to_subturn_number: $to_subturn_number,
                reason: $reason,
                trigger_event: $trigger_event,
                message: "SubTurn avançado automaticamente em n+1 após ciclo de askQuestions"
            }' >> "$audit_file" 2> /dev/null || true
    fi

    return 0
}

# ── bind_current_subturn_parent_turn_id ───────────────────────────────────
# Reata parent_turn_id da subturn ao current_turn.turn_id ativo.
# Útil em fluxos de retomada/rebind no agent-stop para evitar drift de vínculo.
# Params:
#   $1 ts (optional)
bind_current_subturn_parent_turn_id() {
    local ts="${1:-$(iso_now)}"

    [ -f "$CTX_FILE" ] || return 1

    local jq_expr
    jq_expr='.current_turn.subturn = ((.current_turn.subturn // {}) + {
            parent_turn_id: (.current_turn.turn_id // null),
            last_transition_at: $ts
         })'

    if command -v sponge > /dev/null 2>&1; then
        jq --arg ts "$ts" "$jq_expr" "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    else
        local _tmp_bind
        if _tmp_bind="$(mktemp 2> /dev/null)"; then
            if jq --arg ts "$ts" "$jq_expr" "$CTX_FILE" > "$_tmp_bind" 2> /dev/null; then
                mv "$_tmp_bind" "$CTX_FILE" 2> /dev/null || rm -f "$_tmp_bind"
            else
                rm -f "$_tmp_bind"
            fi
        fi
    fi

    return 0
}

# ── iso_to_epoch_portable ────────────────────────────────────────────────────
# BUG-71 FIX: Converte timestamp ISO8601 para epoch segundos, com fallback BSD
# Suporta GNU date -d e BSD date -j, garantindo portabilidade (Linux/macOS/BSD)
#
# Parâmetros: $1 = ISO timestamp (ex: "2026-03-11T14:30:45Z")
# Retorno: epoch segundos (inteiro) ou 0 em caso de erro
#
# Uso: EPOCH="$(iso_to_epoch_portable "$ISO_TIMESTAMP")"
iso_to_epoch_portable() {
    local iso_ts="$1"
    [ -z "$iso_ts" ] && echo 0 && return 0

    # Tenta GNU date -d primeiro (mais comum)
    if date -d "$iso_ts" '+%s' > /dev/null 2>&1; then
        date -d "$iso_ts" '+%s' 2> /dev/null || echo 0
    # Fallback para BSD date -j (macOS, FreeBSD)
    elif date -j -f '%Y-%m-%dT%H:%M:%SZ' "$iso_ts" '+%s' > /dev/null 2>&1; then
        date -j -f '%Y-%m-%dT%H:%M:%SZ' "$iso_ts" '+%s' 2> /dev/null || echo 0
    # Last resort: extrai segundos do timestamp e usa como epoch (degraded)
    else
        echo 0
    fi
}

# ── log_event ────────────────────────────────────────────────────────────────
# Appenda um objeto JSON como evento em audit.jsonl.
# Parâmetros: $1 = JSON object string (deve ser JSON válido)
# Retorno: 0 em sucesso
#
# Uso: log_event "$(jq -cn --arg event "myEvent" --arg sid "$SID" --arg ts "$NOW" \
#        '{event: $event, session_id: $sid, timestamp: $ts}')"
log_event() {
    local json="$1"
    mkdir -p "$LOG_DIR"
    printf '%s\n' "$json" >> "$AUDIT_FILE" 2> /dev/null || true
}

# ── redact_credentials ───────────────────────────────────────────────────────
# Remove tokens e senhas de uma string antes de log.
# Parâmetros: $1 = string a redactar (lida de stdin se omitido)
#
# Uso: CLEAN="$(redact_credentials "$TOOL_INPUT_RAW")"
#      echo "$DIRTY" | redact_credentials
redact_credentials() {
    local input
    if [ $# -gt 0 ]; then
        input="$1"
    else
        input="$(cat)"
    fi
    echo "$input" \
        | sed -E 's/ghp_[A-Za-z0-9]{20,}/[REDACTED_GHP]/g' \
        | sed -E 's/gho_[A-Za-z0-9]{20,}/[REDACTED_GHO]/g' \
        | sed -E 's/ghu_[A-Za-z0-9]{20,}/[REDACTED_GHU]/g' \
        | sed -E 's/ghs_[A-Za-z0-9]{20,}/[REDACTED_GHS]/g' \
        | sed -E 's/ghr_[A-Za-z0-9]{20,}/[REDACTED_GHR]/g' \
        | sed -E 's/github_pat_[A-Za-z0-9_]{20,}/[REDACTED_GITHUB_PAT]/g' \
        | sed -E 's/glpat-[A-Za-z0-9_-]{10,}/[REDACTED_GITLAB_PAT]/g' \
        | sed -E 's/AKIA[0-9A-Z]{16}/[REDACTED_AWS_KEY]/g' \
        | sed -E 's/sk-ant-[A-Za-z0-9_-]{20,}/[REDACTED_ANTHROPIC_KEY]/g' \
        | sed -E 's/sk-[A-Za-z0-9_-]{20,}/[REDACTED_OPENAI_KEY]/g' \
        | sed -E 's/xai-[A-Za-z0-9_-]{20,}/[REDACTED_XAI_KEY]/g' \
        | sed -E 's/hf_[A-Za-z0-9]{20,}/[REDACTED_HF_TOKEN]/g' \
        | sed -E 's/AIza[A-Za-z0-9_-]{35}/[REDACTED_GOOGLE_KEY]/g' \
        | sed -E 's/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/[REDACTED_JWT]/g' \
        | sed -E 's|https?://[^/@]+:[^@]+@[^"[:space:]]+|[REDACTED_URL_WITH_CREDS]|g' \
        | sed -E 's/[?&]token=[^&"[:space:]]*/\&token=[REDACTED]/g' \
        | sed -E 's/[?&]api_key=[^&"[:space:]]*/\&api_key=[REDACTED]/g' \
        | sed -E 's/Bearer [A-Za-z0-9_\-\.]+/Bearer [REDACTED]/g' \
        | sed -E 's/--password[=[:space:]][^[:space:]]+/--password=[REDACTED]/g' \
        | sed -E 's/--token[=[:space:]][^[:space:]]+/--token=[REDACTED]/g' \
        | sed -E 's/-p [A-Za-z0-9!@#$%^&*]{6,}/-p [REDACTED]/g' \
        | sed -E 's/"password"[[:space:]]*:[[:space:]]*"[^"]+"/\"password\":\"[REDACTED]\"/gi' \
        | sed -E 's/"api_key"[[:space:]]*:[[:space:]]*"[^"]+"/\"api_key\":\"[REDACTED]\"/gi' \
        | sed -E 's/"secret"[[:space:]]*:[[:space:]]*"[^"]+"/\"secret\":\"[REDACTED]\"/gi' \
        | sed -E 's/(PASSWORD|TOKEN|SECRET|API_KEY)=([^[:space:]"]{4,})/\1=[REDACTED]/g'
}

# ── strip_sensitive_json_keys ─────────────────────────────────────────────────
# G9-11: Redação estrutural por denylist de chaves JSON sensíveis.
# Remove recursivamente campos com nomes conhecidamente sensíveis de um objeto
# JSON, independente de nível de aninhamento. Complementa redact_credentials()
# que opera por regex em strings serializadas.
#
# Parâmetros: $1 = JSON string (ou stdin se omitido)
# Saída: JSON sem campos sensíveis (ou string original se jq indisponível)
#
# Chaves removidas: password, passwd, secret, token, api_key, apikey,
#   authorization, auth_token, access_token, refresh_token, private_key,
#   client_secret, close_key (nossa chave de encerramento de sessão)
#
# Uso: SAFE="$(strip_sensitive_json_keys "$TOOL_INPUT")"
#      echo "$JSON" | strip_sensitive_json_keys
strip_sensitive_json_keys() {
    local input
    if [ $# -gt 0 ]; then
        input="$1"
    else
        input="$(cat)"
    fi
    if ! command -v jq &> /dev/null; then
        echo "$input"
        return 0
    fi
    # Verifica se é JSON válido; se não, retorna como string (provavelmente conteúdo de arquivo)
    if ! echo "$input" | jq -e . &> /dev/null 2>&1; then
        echo "$input"
        return 0
    fi
    echo "$input" | jq 'walk(
        if type == "object" then
            with_entries(select(
                (.key | ascii_downcase) |
                test("^(password|passwd|secret|token|api_key|apikey|authorization|auth_token|access_token|refresh_token|private_key|client_secret|close_key)$") | not
            ))
        else . end
    )' 2> /dev/null || echo "$input"
}

# ── log_info / log_warn / log_error ───────────────────────────────────────────
# Helpers de logging semântico para stderr. Produzem saída padronizada com
# prefixo [INFO], [WARN] ou [ERROR] e timestamp ISO.
# Parâmetros: $1 = mensagem, ... = campos extras (opcionais)
#
# Uso:
#   log_info "session iniciada" "session_id=$SID"
#   log_warn "flock timeout — modo degradado"
#   log_error "sessão corrompida" "ctx_file=$CTX_FILE"
log_info() {
    local msg="$1"
    shift
    echo "[INFO]  $(iso_now) ${msg}${*:+ | $*}" >&2
}

log_warn() {
    local msg="$1"
    shift
    echo "[WARN]  $(iso_now) ${msg}${*:+ | $*}" >&2
}

log_error() {
    local msg="$1"
    shift
    echo "[ERROR] $(iso_now) ${msg}${*:+ | $*}" >&2
}

# ════════════════════════════════════════════════════════════════════════════
# HEAL v1 — Adoção imediata de session_id real do VS Code (GAP-04 / BUG-06)
# ════════════════════════════════════════════════════════════════════════════
# Premissa-1: o session_id do VS Code é SEMPRE a fonte da verdade.
# Nunca geramos UUIDs próprios nem bloqueamos state writes por mismatch.
#
# Ativa quando:
#   - CTX source = "manual_recovery" → contexto criado manualmente (sem sessionStart real)
#   - CTX source = "inline_restart"  → reinício inline (budget de tokens esgotado)
#
# Parâmetros:
#   $1 = SESSION_ID_PAYLOAD  — session_id real recebido do VS Code
#   $2 = TIMESTAMP           — timestamp ISO-8601 atual
#
# Saída:
#   Retorna 0 se HEAL foi aplicado, 1 se não era necessário ou falhou.
#   Incrementa ctx session_stats.session_id_syncs_inline.
#
# Uso:
#   if heal_v1 "$SESSION_ID_PAYLOAD" "$TIMESTAMP"; then
#       SESSION_ID="$SESSION_ID_PAYLOAD"  # continua com o ID correto
#   fi
heal_v1() {
    local real_sid="${1:-}" ts="${2:-$(iso_now)}"
    [ -n "$real_sid" ] || return 1
    [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] || return 1

    local ctx_sid ctx_source
    ctx_sid="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    ctx_source="$(jq -r '.session.source // ""' "$CTX_FILE" 2> /dev/null || echo '')"

    # Só ativa se há mismatch E source é elegível para HEAL v1 imediato
    [ "$real_sid" != "$ctx_sid" ] || return 1
    [ "$ctx_source" = "manual_recovery" ] || [ "$ctx_source" = "inline_restart" ] || return 1

    local heal_expr
    heal_expr=".session.id = \"$real_sid\"
               | .session.vs_code_session_id = \"$real_sid\"
               | .session.source = \"healed_from_real_session\"
               | .session.healed_at = \"$ts\"
               | .session_stats.session_id_syncs_inline = ((.session_stats.session_id_syncs_inline // 0) + 1)"

    if command -v sponge > /dev/null 2>&1; then
        # shellcheck disable=SC2016
        jq "$heal_expr" "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || return 1
    else
        local tmp
        # fix Haiku C6.2: valida mktemp antes de usar (heal_v1)
        tmp="$(mktemp)" || return 1
        # shellcheck disable=SC2016
        if jq "$heal_expr" "$CTX_FILE" > "$tmp" 2> /dev/null; then
            mv "$tmp" "$CTX_FILE" 2> /dev/null || {
                rm -f "$tmp"
                return 1
            }
        else
            rm -f "$tmp"
            return 1
        fi
    fi

    log_event "$(jq -cn \
        --arg event "heal_v1_applied" \
        --arg old "$ctx_sid" \
        --arg new "$real_sid" \
        --arg src "common.sh:heal_v1" \
        --arg ts "$ts" \
        '{event: $event, old_session_id: $old, new_session_id: $new, source: $src, timestamp: $ts,
          message: "HEAL v1: session_id atualizado para ID real do VS Code (manual_recovery/inline_restart)"}')"

    return 0
}

# ════════════════════════════════════════════════════════════════════════════
# HEAL v2 — Recuperação por threshold de mismatches (GAP-04)
# ════════════════════════════════════════════════════════════════════════════
# Ativa quando session_stats.session_id_mismatches >= HOOKS_HEAL_THRESHOLD.
# Mais conservador que HEAL v1: exige acúmulo de evidências antes de corrigir.
# Implementado originalmente em agent-stop.sh — extraído aqui para reutilização.
#
# Parâmetros:
#   $1 = SESSION_ID_PAYLOAD  — session_id real recebido do VS Code
#   $2 = TIMESTAMP           — timestamp ISO-8601 atual
#
# Saída:
#   Retorna 0 se HEAL v2 foi aplicado, 1 se threshold não atingido ou falhou.
#
# Uso:
#   MISMATCHES="$(ctx_read '.session_stats.session_id_mismatches' 0)"
#   if [ "$MISMATCHES" -ge "${HOOKS_HEAL_THRESHOLD:-3}" ]; then
#       heal_v2 "$SESSION_ID_PAYLOAD" "$TIMESTAMP"
#   fi
heal_v2() {
    local real_sid="${1:-}" ts="${2:-$(iso_now)}"
    [ -n "$real_sid" ] || return 1
    [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] || return 1

    local ctx_sid mismatches threshold
    ctx_sid="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    mismatches="$(jq -r '.session_stats.session_id_mismatches // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    threshold="${HOOKS_HEAL_THRESHOLD:-3}"

    [ "$real_sid" != "$ctx_sid" ] || return 1
    [ "$mismatches" -ge "$threshold" ] 2> /dev/null || return 1

    local heal_expr
    heal_expr=".session.id = \"$real_sid\"
               | .session.vs_code_session_id = \"$real_sid\"
               | .session.source = \"healed_v2_threshold\"
               | .session.healed_at = \"$ts\"
               | .session_stats.session_id_mismatches = 0
               | .session_stats.session_id_syncs_inline = ((.session_stats.session_id_syncs_inline // 0) + 1)"

    if command -v sponge > /dev/null 2>&1; then
        # shellcheck disable=SC2016
        jq "$heal_expr" "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || return 1
    else
        local tmp
        # fix Haiku C6.3: valida mktemp antes de usar (heal_v2)
        tmp="$(mktemp)" || return 1
        # shellcheck disable=SC2016
        if jq "$heal_expr" "$CTX_FILE" > "$tmp" 2> /dev/null; then
            mv "$tmp" "$CTX_FILE" 2> /dev/null || {
                rm -f "$tmp"
                return 1
            }
        else
            rm -f "$tmp"
            return 1
        fi
    fi

    log_event "$(jq -cn \
        --arg event "heal_v2_applied" \
        --arg old "$ctx_sid" \
        --arg new "$real_sid" \
        --arg mismatches "$mismatches" \
        --arg threshold "$threshold" \
        --arg src "common.sh:heal_v2" \
        --arg ts "$ts" \
        '{event: $event, old_session_id: $old, new_session_id: $new,
          mismatches_at_trigger: ($mismatches | tonumber),
          threshold: ($threshold | tonumber),
          source: $src, timestamp: $ts,
          message: "HEAL v2: session_id corrigido por threshold de mismatches atingido"}')"

    return 0
}

# ── increment_mismatch ────────────────────────────────────────────────────────
# Incrementa o contador session_stats.session_id_mismatches no CTX.
# Chamado pelos hooks quando há mismatch mas nenhum HEAL ativou.
#
# Uso: increment_mismatch
increment_mismatch() {
    ctx_update '.session_stats.session_id_mismatches = ((.session_stats.session_id_mismatches // 0) + 1)' \
        2> /dev/null || true
}

# ── handle_manual_recovery_session_id ────────────────────────────────────────
# R1.3: rotina canônica para guard de session_id em source=manual_recovery.
# Quando payload SID diverge do CTX em sessão manualmente recuperada,
# adota o SID real do payload e registra evento canônico de heal.
#
# Parâmetros:
#   $1 = payload_sid   (session_id recebido no payload do hook)
#   $2 = tool_name     (nome da ferramenta atual)
#   $3 = timestamp     (ISO)
#   $4 = source_script (ex.: pre-tool-use.sh)
#
# Saída:
#   stdout: SID adotado (payload_sid) quando tratado com sucesso
#   return 0: mismatch manual_recovery tratado
#   return 1: cenário não elegível
handle_manual_recovery_session_id() {
    local payload_sid="${1:-}"
    local tool_name="${2:-}"
    local ts="${3:-$(iso_now)}"
    local source_script="${4:-unknown-script}"

    [ -n "$payload_sid" ] || return 1
    [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] || return 1

    local ctx_sid ctx_source
    ctx_sid="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    ctx_source="$(jq -r '.session.source // ""' "$CTX_FILE" 2> /dev/null || echo '')"

    [ -n "$ctx_sid" ] || return 1
    [ "$payload_sid" != "$ctx_sid" ] || return 1
    [ "$ctx_source" = "manual_recovery" ] || return 1

    if command -v sponge > /dev/null 2>&1; then
        jq --arg real_sid "$payload_sid" --arg heal_ts "$ts" \
            '.session.id = $real_sid
             | .session.vs_code_session_id = $real_sid
             | .session.source = "healed_from_real_session"
             | .session.healed_at = $heal_ts' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    else
        local _tmp_manual
        if _tmp_manual="$(mktemp 2> /dev/null)"; then
            if jq --arg real_sid "$payload_sid" --arg heal_ts "$ts" \
                '.session.id = $real_sid
                 | .session.vs_code_session_id = $real_sid
                 | .session.source = "healed_from_real_session"
                 | .session.healed_at = $heal_ts' \
                "$CTX_FILE" > "$_tmp_manual" 2> /dev/null; then
                mv "$_tmp_manual" "$CTX_FILE" 2> /dev/null || rm -f "$_tmp_manual"
            else
                rm -f "$_tmp_manual"
            fi
        fi
    fi

    log_event "$(jq -cn \
        --arg event "session_id_healed" \
        --arg old "$ctx_sid" \
        --arg new "$payload_sid" \
        --arg source "$source_script" \
        --arg tool "$tool_name" \
        --arg ts "$ts" \
        '{event: $event, old_session_id: $old, new_session_id: $new, source: $source, tool: $tool, timestamp: $ts,
          message: "CTX manual_recovery adotado: session_id atualizado para sessão real do Copilot"}')"

    echo "$payload_sid"
    return 0
}

# ── handle_inline_restart_stale_payload_sid ─────────────────────────────────
# R1.2: rotina canônica para guard de session_id em source=inline_restart.
# Quando payload SID está stale e CTX já possui o SID correto do VS Code,
# adota o SID do CTX, registra evento com cap de ruído e incrementa contador.
#
# Parâmetros:
#   $1 = payload_sid   (session_id recebido no payload do hook)
#   $2 = tool_name     (nome da ferramenta atual)
#   $3 = timestamp     (ISO)
#   $4 = source_script (ex.: pre-tool-use.sh)
#
# Saída:
#   stdout: SID adotado (ctx_sid) quando tratado com sucesso
#   return 0: mismatch inline_restart tratado
#   return 1: cenário não elegível (não inline_restart / sem mismatch)
handle_inline_restart_stale_payload_sid() {
    local payload_sid="${1:-}"
    local tool_name="${2:-}"
    local ts="${3:-$(iso_now)}"
    local source_script="${4:-unknown-script}"

    [ -n "$payload_sid" ] || return 1
    [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] || return 1

    local ctx_sid ctx_source syncs_inline
    ctx_sid="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    ctx_source="$(jq -r '.session.source // ""' "$CTX_FILE" 2> /dev/null || echo '')"

    [ -n "$ctx_sid" ] || return 1
    [ "$payload_sid" != "$ctx_sid" ] || return 1
    [ "$ctx_source" = "inline_restart" ] || return 1

    syncs_inline="$(jq -r '.session_stats.session_id_syncs_inline // 0' "$CTX_FILE" 2> /dev/null || echo 0)"

    if [ "$syncs_inline" -lt 5 ]; then
        log_event "$(jq -cn \
            --arg event "session_id_sync_inline_restart" \
            --arg stale "$payload_sid" \
            --arg adopted "$ctx_sid" \
            --arg source "$source_script" \
            --arg tool "$tool_name" \
            --arg ts "$ts" \
            '{event: $event, stale_payload_sid: $stale, adopted_ctx_sid: $adopted,
              source: $source, tool: $tool, timestamp: $ts,
              message: "inline_restart: payload stale — adotado session_id do CTX (VS Code, PREMISSA 1)"}')"
    elif [ "$syncs_inline" -eq 5 ]; then
        log_event "$(jq -cn --arg event "session_id_sync_inline_restart_cap" --arg source "$source_script" \
            '{event: $event, source: $source, message: "inline_restart sync count reached cap (5) — logs suprimidos daqui em diante"}')"
    fi

    if command -v sponge > /dev/null 2>&1; then
        jq '.session_stats.session_id_syncs_inline = ((.session_stats.session_id_syncs_inline // 0) + 1)' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    else
        local _tmp_inline
        if _tmp_inline="$(mktemp 2> /dev/null)"; then
            if jq '.session_stats.session_id_syncs_inline = ((.session_stats.session_id_syncs_inline // 0) + 1)' \
                "$CTX_FILE" > "$_tmp_inline" 2> /dev/null; then
                mv "$_tmp_inline" "$CTX_FILE" 2> /dev/null || rm -f "$_tmp_inline"
            else
                rm -f "$_tmp_inline"
            fi
        fi
    fi

    echo "$ctx_sid"
    return 0
}

# ── record_unrecoverable_session_id_mismatch ───────────────────────────────
# Registra mismatch não recuperável (source diferente de manual_recovery/inline_restart)
# e incrementa contador de mismatches no contexto.
#
# Parâmetros:
#   $1 = expected_sid
#   $2 = got_sid
#   $3 = tool_name
#   $4 = timestamp
#   $5 = source_script
record_unrecoverable_session_id_mismatch() {
    local expected_sid="${1:-}"
    local got_sid="${2:-}"
    local tool_name="${3:-}"
    local ts="${4:-$(iso_now)}"
    local source_script="${5:-unknown-script}"

    [ -n "$expected_sid" ] && [ -n "$got_sid" ] || return 1

    log_event "$(jq -cn \
        --arg event "session_id_mismatch" \
        --arg expected "$expected_sid" \
        --arg got "$got_sid" \
        --arg source "$source_script" \
        --arg tool "$tool_name" \
        --arg ts "$ts" \
        '{event: $event, expected: $expected, got: $got, source: $source, tool: $tool, timestamp: $ts,
          message: "Payload session_id diferente do contexto ativo — state write bloqueado"}')"

    increment_mismatch
    return 0
}

# ── reconcile_session_id_guard_prepost ──────────────────────────────────────
# Orquestra guard de session_id para pre/post hooks, unificando a lógica:
#   - sem mismatch: mantém payload_sid
#   - manual_recovery: heal para payload_sid
#   - inline_restart: adota SID do CTX
#   - demais casos: registra mismatch não recuperável
#
# Parâmetros:
#   $1 = payload_sid
#   $2 = tool_name
#   $3 = timestamp
#   $4 = source_script
#
# Saída:
#   stdout: sid reconciliado
#   return 0: continuar normalmente
#   return 10: mismatch não recuperável (state write deve ser bloqueado)
reconcile_session_id_guard_prepost() {
    local payload_sid="${1:-}"
    local tool_name="${2:-}"
    local ts="${3:-$(iso_now)}"
    local source_script="${4:-unknown-script}"

    [ -n "$payload_sid" ] || {
        echo ""
        return 0
    }
    [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] || {
        echo "$payload_sid"
        return 0
    }

    local ctx_sid ctx_source reconciled_sid
    ctx_sid="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    ctx_source="$(jq -r '.session.source // ""' "$CTX_FILE" 2> /dev/null || echo '')"

    if [ -z "$ctx_sid" ] || [ "$payload_sid" = "$ctx_sid" ]; then
        echo "$payload_sid"
        return 0
    fi

    if [ "$ctx_source" = "manual_recovery" ]; then
        if reconciled_sid="$(handle_manual_recovery_session_id "$payload_sid" "$tool_name" "$ts" "$source_script")"; then
            echo "$reconciled_sid"
            return 0
        fi
        echo "$payload_sid"
        return 0
    fi

    if [ "$ctx_source" = "inline_restart" ]; then
        if reconciled_sid="$(handle_inline_restart_stale_payload_sid "$payload_sid" "$tool_name" "$ts" "$source_script")"; then
            echo "$reconciled_sid"
            return 0
        fi
        echo "$ctx_sid"
        return 0
    fi

    record_unrecoverable_session_id_mismatch "$ctx_sid" "$payload_sid" "$tool_name" "$ts" "$source_script" > /dev/null 2>&1 || true
    echo "$payload_sid"
    return 10
}

# ════════════════════════════════════════════════════════════════════════════
# UPG-AUDIT-01 — Helpers per-session (v1.2)
# Funções para resolução de caminhos per-SESSION_ID e gestão de symlinks
# de compatibilidade retroativa.
# ════════════════════════════════════════════════════════════════════════════

# ── sid_short ────────────────────────────────────────────────────────────────
# Extrai os primeiros 8 caracteres de um session_id UUID (SID_SHORT).
# Usado como sufixo de arquivos per-session: audit-{SID_SHORT}.jsonl
#
# Uso: SID_SHORT="$(sid_short "$SESSION_ID")"
sid_short() {
    local sid="${1:-}"
    echo "${sid:0:8}"
}

# ── resolve_audit_file ────────────────────────────────────────────────────────
# Retorna o caminho do audit file para um SID_SHORT.
# Quando SID_SHORT está vazio, retorna o AUDIT_FILE global (backward compat).
#
# Uso: AUDIT="$(resolve_audit_file "$SID_SHORT")"
resolve_audit_file() {
    local sid_short="${1:-}"
    if [ -n "$sid_short" ]; then
        echo "${LOG_DIR}/audit-${sid_short}.jsonl"
    else
        echo "${AUDIT_FILE}"
    fi
}

# ── resolve_ctx_file ──────────────────────────────────────────────────────────
# Retorna o caminho do session-context para um SID_SHORT.
# Quando SID_SHORT está vazio, retorna o CTX_FILE global (backward compat).
#
# Uso: CTX="$(resolve_ctx_file "$SID_SHORT")"
resolve_ctx_file() {
    local sid_short="${1:-}"
    if [ -n "$sid_short" ]; then
        echo "${STATE_DIR}/session-context-${sid_short}.json"
    else
        echo "${CTX_FILE}"
    fi
}

# ── get_current_session_id ────────────────────────────────────────────────────
# Lê o session_id da sessão ativa de state/current-session-id.txt.
# Scripts manuais devem usar isso para descobrir a sessão ativa.
# Fallback: lê do CTX_FILE global (compatibilidade com versão anterior).
#
# Uso: SID="$(get_current_session_id)"
get_current_session_id() {
    local sid_file="${STATE_DIR}/current-session-id.txt"
    if [ -f "$sid_file" ] && [ -s "$sid_file" ]; then
        tr -d '[:space:]' < "$sid_file" 2> /dev/null || echo ''
    else
        get_session_id
    fi
}

# ── set_current_session_id ────────────────────────────────────────────────────
# Escreve atomicamente o session_id ativo em state/current-session-id.txt.
# Chamado por session-start.sh quando nova sessão começa.
#
# Uso: set_current_session_id "$SESSION_ID"
set_current_session_id() {
    local sid="${1:-}" sid_file="${STATE_DIR}/current-session-id.txt"
    [ -n "$sid" ] || return 1
    local tmp
    tmp="$(mktemp)" || return 1
    echo "$sid" > "$tmp"
    mv "$tmp" "$sid_file" 2> /dev/null || {
        rm -f "$tmp"
        return 1
    }

    # UPG-AUDIT-02: manter ponteiros de compatibilidade alinhados à sessão ativa.
    # Evita split-brain onde current-session-id aponta para uma sessão e os symlinks
    # (session-context.json/audit.jsonl) continuam apontando para outra.
    local sid_short
    sid_short="${sid:0:8}"
    if command -v update_compat_symlinks > /dev/null 2>&1; then
        update_compat_symlinks "$sid_short" 2> /dev/null || true
    fi
}

# ── update_compat_symlinks ────────────────────────────────────────────────────
# Atualiza/cria symlinks de compatibilidade retroativa para a sessão ativa.
# Garante que audit.jsonl aponta para audit-{SID_SHORT}.jsonl.
# Garante que session-context.json aponta para session-context-{SID_SHORT}.json,
# mas SÓ quando o arquivo per-session já existe (evita symlink quebrado).
#
# Uso: update_compat_symlinks "$SID_SHORT"
update_compat_symlinks() {
    local sid_short="${1:-}"
    [ -n "$sid_short" ] || return 1

    # audit.jsonl → audit-{SID_SHORT}.jsonl
    local audit_target="${LOG_DIR}/audit-${sid_short}.jsonl"
    # Hardening: não sobrescrever audit.jsonl regular (arquivo) em fluxos onde o
    # per-session audit ainda não existe, pois isso pode ocultar eventos recém-logados
    # no mesmo script. Só relinka quando o alvo já existe ou quando audit.jsonl já é symlink.
    if [ -f "$audit_target" ] || [ -L "${LOG_DIR}/audit.jsonl" ]; then
        touch "$audit_target" 2> /dev/null || true
        # ln -sfn usa caminho relativo para portabilidade
        (cd "$LOG_DIR" && ln -sfn "audit-${sid_short}.jsonl" "audit.jsonl" 2> /dev/null) || true
    fi

    # session-context.json → session-context-{SID_SHORT}.json
    # Só cria/atualiza o symlink quando o arquivo de destino já existe.
    local ctx_target="${STATE_DIR}/session-context-${sid_short}.json"
    if [ -f "$ctx_target" ]; then
        (cd "$STATE_DIR" && ln -sfn "session-context-${sid_short}.json" "session-context.json" 2> /dev/null) || true
    fi

    return 0
}

# ── apply_per_session_paths ───────────────────────────────────────────────────
# Resolve e sobreescreve CTX_FILE e AUDIT_FILE para caminhos per-session quando
# o arquivo per-session já existe (criado por session-start.sh).
# Operação segura: só troca se o arquivo per-session existir (backward compat).
# Para uso em hooks VS Code-invocados (recebem SESSION_ID_PAYLOAD por stdin).
#
# Parâmetros: $1 = SESSION_ID_PAYLOAD (session_id do VS Code)
# Saída: modifica CTX_FILE e AUDIT_FILE no escopo do chamador (via eval).
# Retorna 0 se usou per-session, 1 se manteve global.
#
# Uso:
#   apply_per_session_paths "$SESSION_ID_PAYLOAD"
apply_per_session_paths() {
    local sid_payload="${1:-}"
    [ -n "$sid_payload" ] || return 1

    local _ssh
    _ssh="${sid_payload:0:8}"
    local _per_ctx="${STATE_DIR}/session-context-${_ssh}.json"
    local _per_audit="${LOG_DIR}/audit-${_ssh}.jsonl"

    if [ -f "$_per_ctx" ]; then
        CTX_FILE="$_per_ctx"
        AUDIT_FILE="$_per_audit"
        return 0
    fi
    return 1
}
