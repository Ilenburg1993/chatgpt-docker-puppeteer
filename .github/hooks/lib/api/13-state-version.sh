#!/usr/bin/env bash
# api/13-state-version.sh — Versionamento e Migração de Schema de State (v2.4)
# Módulo 13/13 do sistema hook-payload-api modular
# Carregado por: hook-payload-api.sh (loader principal)
#
# 🟧 CAMADA NOSSA
# Gerencia versão do schema do session.json, detecta estado legado e
# fornece função de migração idempotente para adicionar campos ausentes.
#
# Depende de:
#   common.sh         — read_field, update_nested_state, STATE_FILE
#   01-vars.sh        — HOOK_STATE_SCHEMA_CURRENT, HOOK_STATE_VERSION,
#                       HOOK_STATE_MIGRATION_NEEDED
#
# Estado lido/escrito no session.json:
#   .state_schema_version   — versão numérica inteira do schema (string)
#
# Versões conhecidas:
#   "0" (ou ausente) — legado: sem close_key estruturada, sem session_stats
#                      completo, sem state_schema_version
#   "1"              — v1.0: schema canônico com close_key, session_stats,
#                      compliance, strict_turn_close, state_schema_version

# ─── SEÇÃO 13A: LEITURA DE VERSÃO ────────────────────────────────────────────

# 🟧 hook_state_version — versão do schema registrada no state
# Retorna string numérica. Retorna "0" se campo ausente (estado legado).
hook_state_version() {
    local ver
    ver="$(read_field '.state_schema_version' 2> /dev/null)"
    if [[ -z "$ver" || "$ver" == "null" ]]; then
        printf '%s' "0"
    else
        printf '%s' "$ver"
    fi
}

# 🟧 hook_state_version_current — versão canônica esperada pelo código atual
# Constante: igual a HOOK_STATE_SCHEMA_CURRENT (default "1")
hook_state_version_current() {
    printf '%s' "${HOOK_STATE_SCHEMA_CURRENT:-1}"
}

# ─── SEÇÃO 13B: PREDICADOS ───────────────────────────────────────────────────

# 🟧 hook_state_needs_migration — true se versão do state < versão atual
# Retorna 0 (true em bash) se o state precisa de migração.
hook_state_needs_migration() {
    local current recorded
    current="$(hook_state_version_current)"
    recorded="$(hook_state_version)"
    [[ "$recorded" -lt "$current" ]] 2> /dev/null && return 0
    return 1
}

# 🟧 hook_state_schema_ok — true se versão do state == versão atual (sem migração)
hook_state_schema_ok() {
    hook_state_needs_migration && return 1
    return 0
}

# 🟧 hook_state_is_legacy — true se versão == "0" (estado legado sem campo)
hook_state_is_legacy() {
    local ver
    ver="$(hook_state_version)"
    [[ "$ver" == "0" ]] && return 0
    return 1
}

# ─── SEÇÃO 13C: MIGRAÇÃO IDEMPOTENTE ─────────────────────────────────────────

# 🟧 hook_state_migrate — aplica migrações necessárias (idempotente)
# Lê versão atual do state, aplica patches incrementais até atingir
# HOOK_STATE_SCHEMA_CURRENT, depois atualiza .state_schema_version.
# Retorna 0 em caso de sucesso, 1 se STATE_FILE indisponível.
hook_state_migrate() {
    # Requer STATE_FILE
    if [[ -z "${STATE_FILE:-}" || ! -f "$STATE_FILE" ]]; then
        return 1
    fi

    local recorded current
    recorded="$(hook_state_version)"
    current="$(hook_state_version_current)"

    # Nada a fazer se já atualizado
    if [[ "$recorded" -ge "$current" ]] 2> /dev/null; then
        return 0
    fi

    # ── Migração 0 → 1 ──────────────────────────────────────────────────────
    # Adiciona campos ausentes no schema legado ("0" ou sem campo)
    if [[ "$recorded" -lt "1" ]] 2> /dev/null; then
        # Garante close_key como string (schema canônico usa string direta, não objeto)
        local ck_raw
        ck_raw="$(read_field '.close_key' 2> /dev/null)"
        if [[ -z "$ck_raw" || "$ck_raw" == "null" ]]; then
            # close_key ausente: inicializar como string vazia
            update_nested_state 'close_key' '' 2> /dev/null || true
        fi
        # Se close_key já é string válida (incluindo "ENCERRAR-*"), preservar como está

        # Garante session_stats{subagents_active,subagents_total} se ausente
        local sub_act
        sub_act="$(read_field '.session_stats.subagents_active' 2> /dev/null)"
        if [[ -z "$sub_act" || "$sub_act" == "null" ]]; then
            update_nested_state 'session_stats.subagents_active' '0' 2> /dev/null || true
            update_nested_state 'session_stats.subagents_total' '0' 2> /dev/null || true
        fi

        # Garante strict_turn_close se ausente
        local stc
        stc="$(read_field '.strict_turn_close' 2> /dev/null)"
        if [[ -z "$stc" || "$stc" == "null" ]]; then
            update_nested_state 'strict_turn_close' 'false' 2> /dev/null || true
        fi

        recorded="1"
    fi

    # Persiste a versão migrada
    update_nested_state 'state_schema_version' "$recorded" 2> /dev/null || true
    HOOK_STATE_VERSION="$recorded"
    export HOOK_STATE_VERSION
    return 0
}

# ─── SEÇÃO 13D: LOADER (popula variáveis HOOK_STATE_*) ───────────────────────

# 🟧 hook_state_version_load — popula HOOK_STATE_VERSION e HOOK_STATE_MIGRATION_NEEDED
# Deve ser chamado após hook_api_parse quando precisar das variáveis.
hook_state_version_load() {
    HOOK_STATE_VERSION="$(hook_state_version)"
    if hook_state_needs_migration; then
        HOOK_STATE_MIGRATION_NEEDED="true"
    else
        HOOK_STATE_MIGRATION_NEEDED="false"
    fi
    export HOOK_STATE_VERSION HOOK_STATE_MIGRATION_NEEDED
}
