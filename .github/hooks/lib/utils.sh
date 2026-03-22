#!/usr/bin/env bash
# utils.sh — Utilitários gerais (IDs, payloads, debug)
# Extraído de common.sh (R-06: split de módulos)
# Requer: STATE_DIR definido (via common.sh header)
# Não usar set -euo pipefail (é sourceado, não executado)

# Guard de re-source
[[ -n "${_UTILS_LIB_LOADED:-}" ]] && return 0
_UTILS_LIB_LOADED=1

# ---------------------------------------------------------------------------
# Funções auxiliares
# ---------------------------------------------------------------------------

# Retorna timestamp ISO 8601 em UTC
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Gera close_key aleatória no formato ENCERRAR-XXXXXXXX (8 chars hex maiúsculos)
make_close_key() {
    local hex
    # Prefere /proc/sys/kernel/random/uuid (Linux — disponível sem uuidgen/xxd)
    if [[ -r /proc/sys/kernel/random/uuid ]]; then
        hex=$(tr -d '-' < /proc/sys/kernel/random/uuid | tr '[:lower:]' '[:upper:]' | cut -c1-8)
    elif command -v od > /dev/null 2>&1 && [[ -r /dev/urandom ]]; then
        hex=$(od -An -tx1 /dev/urandom 2> /dev/null | tr -d ' \n' | head -c8 | tr '[:lower:]' '[:upper:]')
    elif [[ -r /dev/urandom ]]; then
        # GAP-09: fallback com dd quando od não está disponível (evita timestamp previsível)
        hex=$(dd if=/dev/urandom bs=4 count=1 2> /dev/null | od -An -tx1 2> /dev/null | tr -d ' \n' | cut -c1-8 | tr '[:lower:]' '[:upper:]')
    fi
    # R-17: fallback com $RANDOM (4x 16-bit → 64-bit de entropia) antes do timestamp
    if [[ -z "$hex" ]]; then
        hex=$(printf '%04X%04X' "$RANDOM" "$RANDOM")
    fi
    # Último recurso: derivado do timestamp
    if [[ -z "$hex" ]]; then
        hex=$(date +%s%N 2> /dev/null | tr -d '[:space:]' | head -c8 | tr '[:lower:]' '[:upper:]')
    fi
    printf 'ENCERRAR-%s' "$hex"
}

# Extrai campo de JSON passado como string (seguro com input não-confiável)
# Uso: jq_field "$input" ".tool_name"
jq_field() {
    printf '%s' "$1" | jq -r "${2} // empty"
}

# ---------------------------------------------------------------------------
# Identificadores e IDs portáveis
# ---------------------------------------------------------------------------

# Gera UUID v4 sem depender do binário `uuidgen` (usa /dev/urandom + awk)
# Fallback: timestamp + random se /dev/urandom falhar
uuidgen_safe() {
    if command -v uuidgen > /dev/null 2>&1; then
        uuidgen | tr '[:upper:]' '[:lower:]'
    else
        local rnd
        rnd=$(cat /proc/sys/kernel/random/uuid 2> /dev/null || true)
        if [[ -n "$rnd" ]]; then
            printf '%s' "$rnd"
        else
            # Fallback: hex aleatório formatado como UUID
            local b
            b=$(od -An -tx1 /dev/urandom 2> /dev/null | tr -d ' \n' | head -c32 || date +%s%N | tr -d '[:space:]')
            printf '%s-%s-%s-%s-%s\n' \
                "${b:0:8}" "${b:8:4}" "4${b:13:3}" "${b:16:4}" "${b:20:12}"
        fi
    fi
}

# Gera ID de seção canônico: "seção-XXXXXXXX" (8 hex chars)
generate_section_id() {
    local name="${1:-unknown}"
    local suffix
    # GAP-11: usa od em vez de xxd (od é padrão POSIX, xxd não está em todas distros)
    suffix=$(od -An -tx1 /dev/urandom 2> /dev/null | tr -d ' \n' | head -c8)
    printf '%s-%s' "$(printf '%s' "$name" | tr ' ' '-' | tr '[:upper:]' '[:lower:]')" "$suffix"
}

# ---------------------------------------------------------------------------
# Leitura de payload (stdin)
# ---------------------------------------------------------------------------

# Lê o payload JSON do stdin e armazena em HOOK_INPUT global.
# Retorna 0 se parseable, 1 se stdin vazio ou inválido (HOOK_INPUT = "{}").
# Se debug capture estiver ativo (state/debug/capture.enabled), salva o payload.
# Uso: load_payload; tool_name=$(jq_field "$HOOK_INPUT" ".tool_name")
load_payload() {
    HOOK_INPUT=$(cat /dev/stdin 2> /dev/null || true)
    if [[ -z "$HOOK_INPUT" ]]; then
        HOOK_INPUT='{}'
        return 1
    fi
    if ! printf '%s' "$HOOK_INPUT" | jq -e . > /dev/null 2>&1; then
        HOOK_INPUT='{}'
        return 1
    fi
    # Captura automática se debug mode ativo
    maybe_capture_debug "$HOOK_INPUT"
    return 0
}

# Salva payload para diagnóstico se STATE_DIR/debug/capture.enabled existir.
# Nunca falha — erros são silenciosos para não impactar o hook principal.
# Uso: maybe_capture_debug "$payload"
maybe_capture_debug() {
    local payload="$1"
    local flag="$STATE_DIR/debug/capture.enabled"
    [[ -f "$flag" ]] || return 0

    local event ts_slug debug_dir
    event=$(printf '%s' "$payload" | jq -r '.hookEventName // "unknown"' 2> /dev/null || echo "unknown")
    ts_slug=$(date -u +%Y%m%dT%H%M%SZ 2> /dev/null || date +%s)
    debug_dir="$STATE_DIR/debug/payloads"
    mkdir -p "$debug_dir" 2> /dev/null || return 0

    printf '%s' "$payload" | jq '.' > "$debug_dir/${event}-${ts_slug}.json" 2> /dev/null || true
}

# sanitize_md — remove chars que quebrariam formatação Markdown em heredoc (GAP-35)
# Remove: backticks, pipe, hash inicial, backslash de escape
sanitize_md() {
    # shellcheck disable=SC1003  # tr pattern '`\\' é válido — deleta backtick e backslash; SC1003 é falso positivo
    printf '%s' "${1:-}" | tr -d '`\\' | tr '|' '-' | tr -d '\r'
}

# ---------------------------------------------------------------------------
# Variáveis de ambiente seguras (charset)
# ---------------------------------------------------------------------------

# Garante LANG=C.UTF-8 para tratamento correto de unicode em jq/date/printf
export_lang_utf8() {
    export LANG="${LANG:-C.UTF-8}"
    export LC_ALL="${LC_ALL:-C.UTF-8}"
}
