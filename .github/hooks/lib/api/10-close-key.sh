#!/usr/bin/env bash
# api/10-close-key.sh — Gestão de close_key (v2.1)
# Módulo 10/10 do sistema hook-payload-api modular
# Carregado por: hook-payload-api.sh (loader principal)
#
# 🟧 CAMADA 3 — NOSSO SISTEMA
# Todas as funções desta camada dependem de session.json via read_field/STATE_FILE.
#
# Depende de:
#   common.sh  — make_close_key, detect_close_key_in_text, read_field, STATE_FILE
#   01-vars.sh — HOOK_CLOSE_KEY_VALUE, HOOK_CLOSE_KEY_IN_PAYLOAD
#
# Contexto do protocolo:
#   - close_key = "ENCERRAR-XXXXXXXX" (8 chars hex uppercase)
#   - Armazenada em session.json → .close_key
#   - Usada no Template F: agente exibe a key → usuário responde com ela
#   - post-tool-use-lib.sh detecta via hook_close_key_in_response() (07-state.sh)
#   - v2.1 centraliza geração, rotação, leitura e validação neste módulo
#
# Funções existentes que são preservadas (não redefinidas):
#   hook_close_key_in_response()   → em 07-state.sh (v1.0)
#   hook_session_close_key()       → em 09-metrics.sh (v1.5, alias de read_field)

# ─── SEÇÃO 10A: LEITURA ──────────────────────────────────────────────────────

# 🟧 hook_close_key_read — lê a close_key armazenada no session.json
# Alias canônico para hook_session_close_key (09-metrics.sh), mais explícito
# Retorna string "ENCERRAR-XXXXXXXX" ou vazio se ausente
hook_close_key_read() {
    read_field '.close_key' 2> /dev/null || printf ''
}

# ─── SEÇÃO 10B: VALIDAÇÃO ─────────────────────────────────────────────────────

# 🟧 hook_close_key_valid_format — valida formato "ENCERRAR-XXXXXXXX"
# XXXXXXXX = 8 chars hexadecimais maiúsculos (0-9, A-F)
# Usa a KEY fornecida como argumento; sem argumento, lê do session.json
# Retorna 0 se formato OK, 1 se inválido
# Uso: hook_close_key_valid_format "ENCERRAR-ABCD1234"
#      hook_close_key_valid_format  (usa close_key do session.json)
hook_close_key_valid_format() {
    local key="${1:-}"
    if [ -z "$key" ]; then
        key=$(hook_close_key_read)
    fi
    [ -z "$key" ] && return 1
    printf '%s' "$key" | grep -qE '^ENCERRAR-[0-9A-F]{8}$'
}

# 🟧 hook_close_key_matches — compara KEY fornecida com a armazenada no session.json
# Retorna 0 se match exato, 1 se não match ou ausente
# Uso: hook_close_key_matches "ENCERRAR-ABCD1234"
hook_close_key_matches() {
    local provided="${1:-}"
    [ -z "$provided" ] && return 1
    local stored
    stored=$(hook_close_key_read)
    [ -z "$stored" ] && return 1
    [ "$provided" = "$stored" ]
}

# ─── SEÇÃO 10C: GERAÇÃO E ROTAÇÃO ────────────────────────────────────────────

# 🟧 hook_close_key_generate — gera nova close_key "ENCERRAR-XXXXXXXX"
# Delega para make_close_key (common.sh) — NÃO persiste; apenas gera
# Retorna string no formato "ENCERRAR-XXXXXXXX"
hook_close_key_generate() {
    if declare -f make_close_key > /dev/null 2>&1; then
        make_close_key
    else
        # Fallback inline se make_close_key não estiver disponível (testes isolados)
        local hex
        if [ -r /proc/sys/kernel/random/uuid ]; then
            hex=$(tr -d '-' < /proc/sys/kernel/random/uuid | tr '[:lower:]' '[:upper:]' | cut -c1-8)
        else
            hex=$(od -An -tx1 /dev/urandom 2> /dev/null | tr -d ' \n' | head -c8 | tr '[:lower:]' '[:upper:]')
        fi
        printf 'ENCERRAR-%s' "${hex:-DEADBEEF}"
    fi
}

# 🟧 hook_close_key_rotate — gera nova close_key E persiste no session.json
# Atualiza .close_key atomicamente via update_state (common.sh)
# Retorna 0 se rotação OK, 1 se falhou
# Uso: new_key=$(hook_close_key_rotate) → retorna a nova key
hook_close_key_rotate() {
    local new_key
    new_key=$(hook_close_key_generate)
    if declare -f update_state > /dev/null 2>&1 && [ -f "${STATE_FILE:-}" ]; then
        update_state 'close_key' "$new_key" 2> /dev/null || return 1
    fi
    printf '%s' "$new_key"
}

# ─── SEÇÃO 10D: POPULADOR DE VARIÁVEIS ───────────────────────────────────────

# 🟧 hook_close_key_load — popula HOOK_CLOSE_KEY_VALUE a partir de session.json
# Uso: hook_close_key_load && echo "$HOOK_CLOSE_KEY_VALUE"
hook_close_key_load() {
    HOOK_CLOSE_KEY_VALUE=$(hook_close_key_read)
    export HOOK_CLOSE_KEY_VALUE
}

# ─── SEÇÃO 10E: DETECÇÃO EM TEXTO ────────────────────────────────────────────

# 🟧 hook_close_key_detect_in_text — API pública canônica para detect_close_key_in_text()
# Verifica se a close_key da sessão aparece no texto fornecido.
# Retorna 0 se encontrar, 1 se não encontrar ou close_key ausente no state.
# Uso: hook_close_key_detect_in_text "$tool_response_text"
hook_close_key_detect_in_text() {
    detect_close_key_in_text "$@"
}
