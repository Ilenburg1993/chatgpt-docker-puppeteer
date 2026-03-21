#!/usr/bin/env bash
# api/16-lifecycle.sh — Turn lifecycle helpers: hook_turn_is_orphaned() etc. (v1.0)
# Módulo 16 do sistema hook-payload-api modular
# Carregado por: hook-payload-api.sh (loader principal)
#
# 🟧 CAMADA 3 — NOSSO SISTEMA
# Encapsula funções de ciclo de vida de turno com nome canônico hook_*.
# A implementação real reside em common.sh.
#
# Depende de:
#   common.sh  — turn_is_orphaned(), heal_orphaned_turn(), read_field,
#                update_nested_state, log_audit, now_iso
#
# Motivação:
#   turn_is_orphaned() e heal_orphaned_turn() são funções de lógica de negócio
#   que não pertencem ao núcleo do state machine (common.sh). Este módulo as
#   expõe sob o prefixo hook_*, permitindo que fat libs usem apenas a API.
#
# ─── SEÇÃO 16A: DETECÇÃO DE TURNO ÓRFÃO ─────────────────────────────────────

# hook_turn_is_orphaned — retorna 0 se o turno atual ultrapassou o threshold
# sem ser encerrado (ask_questions_called permanece false).
# Parâmetro: threshold em segundos (padrão: 300)
# Uso: if hook_turn_is_orphaned 300; then hook_heal_orphaned_turn; fi
hook_turn_is_orphaned() {
    turn_is_orphaned "$@"
}

# ─── SEÇÃO 16B: CURA DE TURNO ÓRFÃO ─────────────────────────────────────────

# hook_heal_orphaned_turn — fecha turno órfão e registra no audit.jsonl
# Deve ser chamado após hook_turn_is_orphaned retornar 0.
# Uso: hook_heal_orphaned_turn
hook_heal_orphaned_turn() {
    heal_orphaned_turn "$@"
}

# ─── SEÇÃO 16C: HEARTBEAT DE SESSÃO ─────────────────────────────────────────

# hook_session_last_activity — retorna o ISO8601 do último Stop registrado
# Retorna string vazia se campo ausente ou null.
# Uso: laa=$(hook_session_last_activity)
hook_session_last_activity() {
    local v
    v=$(read_field '.last_activity_at' 2> /dev/null)
    if [ -n "$v" ] && [ "$v" != "null" ]; then
        printf '%s' "$v"
    fi
}

# hook_session_is_stale — retorna 0 (true) se last_activity_at ultrapassou N segundos
# $1 = threshold em segundos (padrão: 3600 = 1 hora)
# Retorna 1 se campo ausente (não detecta como stale se não há dados)
# Uso: if hook_session_is_stale 1800; then echo "sessão inativa"; fi
hook_session_is_stale() {
    local threshold="${1:-3600}"
    local laa now_ts laa_ts elapsed

    laa=$(hook_session_last_activity)
    [ -z "$laa" ] && return 1 # sem dados: não stale

    now_ts=$(date -u +%s 2> /dev/null) || return 1
    laa_ts=$(date -u -d "$laa" +%s 2> /dev/null) || return 1

    elapsed=$((now_ts - laa_ts))
    [ "${elapsed}" -gt "${threshold}" ]
}
