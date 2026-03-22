#!/usr/bin/env bash
# audit-lib.sh — Funções de auditoria e log canônico
# Extraído de common.sh (R-06: split de módulos)
# Requer: STATE_DIR, STATE_FILE, AUDIT_FILE, AUDIT_CURRENT_LINK, HOOK_DIR definidos (via common.sh header)
# Não usar set -euo pipefail (é sourceado, não executado)

# Guard de re-source
[[ -n "${_AUDIT_LIB_LOADED:-}" ]] && return 0
_AUDIT_LIB_LOADED=1

# ---------------------------------------------------------------------------
# Funções de auditoria
# ---------------------------------------------------------------------------

# UP-AUDIT: tabela de categorias de eventos por nível mínimo de gravação
# Eventos omitidos em HOOK_AUDIT_LEVEL=normal: subturnStart, subturnEnd
# Eventos gravados apenas em HOOK_AUDIT_LEVEL=verbose: payload_validation_warnings
# Eventos críticos (gravados em todos os níveis): turnStart, turnEnd, sessionStart,
#   sessionEnd, state_initialized_clean, state_recovered_from_checkpoint,
#   compliance/block decisions
_audit_event_is_suppressed() {
    local event="$1" level="${HOOK_AUDIT_LEVEL:-normal}"
    case "$level" in
        verbose) return 1 ;; # grava tudo
        minimal)
            # minimal: só lifecycle crítico e compliance — omite operacionais
            case "$event" in
                turnStart | turnEnd_authorized | turnEnd_unauthorized | \
                    sessionStart | sessionStart_new | sessionStart_reconnect | \
                    sessionEnd | sessionClose | \
                    state_initialized_clean | state_recovered_from_checkpoint | \
                    briefing_generated | compliance_block | task_complete_blocked | \
                    audit_log_rotated | audit_log_capped)
                    return 1
                    ;;         # não suprimir (gravar)
                *) return 0 ;; # suprimir
            esac
            ;;
        *) # normal (padrão): suprime subturns e validation_warnings de baixo valor
            case "$event" in
                subturnStart | subturnEnd | payload_validation_warnings)
                    return 0
                    ;;         # suprimir
                *) return 1 ;; # gravar
            esac
            ;;
    esac
}

# UP-AUDIT: verifica se audit.jsonl ativo excedeu HOOKS_AUDIT_MAX_LINES e rotaciona
# R-13: contador em memória de linhas do audit.jsonl (evita wc -l a cada evento)
# Reset para 0 ao rotacionar. Subshells herdam cópia — incremento não propaga de volta,
# mas basta para detecção de cap dentro do mesmo processo executor.
_AUDIT_LINE_COUNT=0

_audit_cap_check() {
    [[ -f "$AUDIT_FILE" ]] || return 0
    local max="${HOOKS_AUDIT_MAX_LINES:-5000}"
    # R-13: usa contador em memória quando disponível; ignora otimização se zerado
    # (contador 0 = subshell sem herança ou pós-rotação imediata; usa wc -l em vez disso)
    if [[ "${_AUDIT_LINE_COUNT:-0}" -gt 0 ]] && [[ "${_AUDIT_LINE_COUNT:-0}" -lt "$max" ]]; then
        return 0
    fi
    # Confirmar com wc -l antes de rotacionar (contador pode estar dessincronizado)
    local count
    count=$(wc -l < "$AUDIT_FILE" 2> /dev/null | tr -d ' ') || return 0
    [ "${count:-0}" -lt "$max" ] && return 0

    # Cap atingido — rotacionar para logs/ (ou state/ se logs/ inacessível)
    local ts
    ts=$(date +%Y%m%d-%H%M%S 2> /dev/null || date +%s)
    local log_dir
    if [[ -n "${HOOKS_AUDIT_LOG_DIR:-}" ]]; then
        log_dir="$HOOKS_AUDIT_LOG_DIR"
    elif [[ -n "${HOOK_DIR:-}" ]]; then
        log_dir="$HOOK_DIR/logs"
    else
        log_dir="$(dirname "$AUDIT_FILE")"
    fi
    mkdir -p "$log_dir" 2> /dev/null || true
    local rotated="$log_dir/audit-${ts}.jsonl"
    if mv -f "$AUDIT_FILE" "$rotated" 2> /dev/null; then
        # Registrar no novo arquivo que houve rotação por cap
        printf '{"ts":"%s","event":"audit_log_capped","session_id":"%s","lines":%s,"file":"%s"}\n' \
            "$(now_iso)" "${SESSION_ID:-unknown}" "$count" "$(basename "$rotated")" \
            >> "$AUDIT_FILE" || true
        # R-14: aponta symlink para o archive rotacionado
        _audit_update_symlink "$rotated" || true
        # R-13: reset do contador após rotação
        _AUDIT_LINE_COUNT=1
    fi
}

# R-10: retorna o path do arquivo de auditoria ativo (state/ ou logs/)
# Usa o symlink AUDIT_CURRENT_LINK como indireção canônica quando disponível.
# @returns {string} path absoluto para o audit.jsonl ativo via stdout
find_audit_file() {
    if [[ -L "${AUDIT_CURRENT_LINK:-}" ]] && [[ -f "$AUDIT_CURRENT_LINK" ]]; then
        readlink -f "$AUDIT_CURRENT_LINK" 2> /dev/null || echo "$AUDIT_CURRENT_LINK"
        return 0
    fi
    echo "${AUDIT_FILE:-$STATE_DIR/audit.jsonl}"
}

# Atualiza o symlink R-14 para apontar ao audit ativo
# @param {string} $1 — path absoluto do arquivo de audit ativo
_audit_update_symlink() {
    local target="${1:-$AUDIT_FILE}"
    local link_dir
    link_dir="$(dirname "$AUDIT_CURRENT_LINK")"
    mkdir -p "$link_dir" 2> /dev/null || return 0
    ln -sf "$target" "$AUDIT_CURRENT_LINK" 2> /dev/null || true
}

# ---------------------------------------------------------------------------
# log_audit — Função de log de auditoria (canônica — Parte 10.10 do plano)
# [LEGADO — DEPRECADO] Use hook_log_audit() de api/15-audit.sh
# Usa jq -n --arg para prevenir JSON injection.
# Assinatura posicional: log_audit "event" [key1 value1 key2 value2 ...]
# @deprecated Use hook_log_audit() de api/15-audit.sh
# ---------------------------------------------------------------------------
log_audit() {
    local event="$1"
    shift
    local ts sid json_obj k v

    # UP-U8: delega para implementação canônica em 15-audit.sh quando carregado.
    # _audit_write_event oferece: 1 jq fork (vs 1+N), auto-enrichment de contexto.
    if declare -f _audit_write_event > /dev/null 2>&1; then
        _audit_write_event "$event" "$@"
        return $?
    fi

    # Fallback: implementação legada (executa apenas quando 15-audit.sh ainda não
    # foi sourceado — raramente ocorre em produção; mantida por segurança).

    # UP-AUDIT: filtrar eventos de baixo valor conforme HOOK_AUDIT_LEVEL
    _audit_event_is_suppressed "$event" && return 0

    ts="$(now_iso)"
    sid="${SESSION_ID:-$([[ -f "$STATE_FILE" ]] && jq -r '.session_id // "unknown"' "$STATE_FILE" 2> /dev/null || echo "unknown")}"

    json_obj=$(jq -cn \
        --arg ts "$ts" \
        --arg ev "$event" \
        --arg sid "$sid" \
        '{ts: $ts, event: $ev, session_id: $sid}')

    # Adicionar campos extras via jq (seguro contra injection)
    while [ "$#" -ge 2 ]; do
        k="$1" v="$2"
        shift 2
        json_obj=$(printf '%s' "$json_obj" | jq -c --arg k "$k" --arg v "$v" '. + {($k): $v}')
    done

    mkdir -p "$STATE_DIR"
    printf '%s\n' "$json_obj" >> "$AUDIT_FILE"
    # R-13: incrementa contador em memória para evitar wc -l a cada evento
    _AUDIT_LINE_COUNT=$((_AUDIT_LINE_COUNT + 1))

    # UP-AUDIT: verificar cap mid-session após gravar (leve — só executa acima do limite)
    _audit_cap_check || true
}
