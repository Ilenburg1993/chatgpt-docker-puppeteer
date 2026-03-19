#!/usr/bin/env bash
# api/07-state.sh — Funções 🟧 que dependem de estado externo (session.json, STATE_DIR)
# Módulo 7/7 do sistema hook-payload-api modular
# Carregado por: hook-payload-api.sh (loader principal)
#
# 🟧 CAMADA 3 — NOSSO SISTEMA (funções que leem/escrevem estado em disco)
#
# Depende de: 01-vars.sh, 02-parse.sh, 04-predicates.sh, 06-query.sh
# Usa de common.sh: detect_close_key_in_text, read_field, STATE_DIR
#
# SEPARAÇÃO DE RESPONSABILIDADES:
#   06-query.sh  → funções puras (getters, dump, summary) — somente leitura de vars
#   04-predicates.sh → predicados puros (somente variáveis HOOK_* do stdin)
#   07-state.sh  → funções 🟧 que leem session.json ou escrevem em STATE_DIR

# ─── SEÇÃO 7A: PREDICADOS DE ESTADO (leem session.json) ─────────────────────

# 🟧 close_key da sessão está na resposta do usuário ao Template F
# Requer session.json com .close_key preenchido
# Anteriormente em: 04-predicates.sh
hook_close_key_in_response() {
    hook_is_ask_questions || return 1
    detect_close_key_in_text "$HOOK_ASK_ALL_TEXT"
}

# 🟧 Template F detectado na proposta (PreToolUse de vscode_askQuestions com close_key)
# Obs: a AÇÃO de fechar só ocorre no PostToolUse quando o usuário responde com a KEY
# Requer session.json com .close_key preenchido
# Anteriormente em: 04-predicates.sh
hook_is_template_f_proposed() {
    [ "$HOOK_EVENT" = "PreToolUse" ] || return 1
    [ "$HOOK_TOOL_NAME" = "vscode_askQuestions" ] || return 1
    # Checa se a close_key aparece nas perguntas (o agente está propondo encerramento)
    local stored_key
    if declare -f read_field > /dev/null 2>&1; then
        stored_key=$(read_field ".close_key" 2> /dev/null || true)
    fi
    [ -n "$stored_key" ] && printf '%s' "$HOOK_ASK_QUESTIONS_JSON" | grep -qF "$stored_key"
}

# ─── SEÇÃO 7B: OPERAÇÕES DE ESCRITA EM STATE_DIR ────────────────────────────

# 🟧 hook_api_record — grava payload atual em payload-log.jsonl (linha por evento)
# Formato: {"ts":"...","event":"...","session":"...","summary":"...","payload":{...}}
# Uso: hook_api_record  (após hook_api_parse)
# Anteriormente em: 06-query.sh
hook_api_record() {
    local log_file="${STATE_DIR:-/tmp}/payload-log.jsonl"
    local ts event session summary raw
    ts=$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || date '+%Y-%m-%dT%H:%M:%SZ')
    event="$HOOK_EVENT"
    session="${HOOK_SESSION_ID:-unknown}"
    summary=$(hook_summary)
    raw="$HOOK_RAW"

    # Garante que o raw é JSON válido antes de gravar
    if ! printf '%s' "$raw" | jq -e . > /dev/null 2>&1; then
        raw="{}"
    fi

    printf '%s\n' "$(printf '%s' "$raw" | jq -c \
        --arg ts "$ts" \
        --arg ev "$event" \
        --arg se "$session" \
        --arg su "$summary" \
        '{"ts":$ts,"event":$ev,"session":$se,"summary":$su,"payload":.}')" \
        >> "$log_file" 2> /dev/null || true
}
