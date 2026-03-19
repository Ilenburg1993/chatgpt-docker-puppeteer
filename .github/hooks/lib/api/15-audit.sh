#!/usr/bin/env bash
# api/15-audit.sh — Audit logging: hook_log_audit() (v1.0)
# Módulo 15 do sistema hook-payload-api modular
# Carregado por: hook-payload-api.sh (loader principal)
#
# 🟧 CAMADA 3 — NOSSO SISTEMA
# Encapsula a função de log de auditoria com nome canônico hook_log_audit().
# A implementação real reside em common.sh → log_audit().
#
# Depende de:
#   common.sh  — log_audit(), STATE_FILE, AUDIT_FILE, now_iso, SESSION_ID
#
# Motivação:
#   O código legado nas fat libs chama log_audit() diretamente do common.sh.
#   Este módulo expõe hook_log_audit() como alias public da API, permitindo
#   que as fat libs usem exclusivamente funções com prefixo hook_* e removendo
#   a dependência direta de símbolos internos do common.sh.
#
# Uso:
#   hook_log_audit "eventName" [key1 value1 key2 value2 ...]
#   Exemplo: hook_log_audit "turnStart" "turn" "3" "intent" "fix bug"
#
# ─── SEÇÃO 15A: LOG DE AUDITORIA ─────────────────────────────────────────────

# hook_log_audit — registra evento no audit.jsonl
# API pública canônica para log_audit() do common.sh.
# Parâmetros: event [key value ...]
hook_log_audit() {
    log_audit "$@"
}
