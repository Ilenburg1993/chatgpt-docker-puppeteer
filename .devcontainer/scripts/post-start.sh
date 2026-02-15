#!/usr/bin/env bash
# =============================================================================
# post-start.sh — Start Hook (Fail-Safe)
# Version: v1.0
#
# Contrato:
# - Nunca bloqueia o start/attach do DevContainer
# - Nunca inicia serviços de runtime automaticamente
# - Sempre termina com exit 0
# =============================================================================

# Defesa máxima contra herança de shell estrito
set +e
set +u
set +o pipefail 2>/dev/null || true
trap - ERR EXIT INT TERM 2>/dev/null || true

readonly HEALTH_STATUS_FILE="/tmp/devcontainer-health.status"
readonly MAKE_INFO_TIMEOUT_SECONDS=10

log_info() { printf "%s\n" "ℹ️  [post-start] $*"; }
log_warn() { printf "%s\n" "⚠️  [post-start] $*"; }

log_info "Hook de start acionado (modo não-bloqueante)."
log_info "PWD: ${PWD:-unknown}"
log_info "User: $(id -un 2>/dev/null || echo unknown)"

status="ok"

if command -v make >/dev/null 2>&1; then
    if command -v timeout >/dev/null 2>&1; then
        timeout "${MAKE_INFO_TIMEOUT_SECONDS}" make info >/dev/null 2>&1
        make_rc=$?
        if [[ "${make_rc}" -ne 0 ]]; then
            status="degraded"
            log_warn "make info retornou código ${make_rc} (timeout=${MAKE_INFO_TIMEOUT_SECONDS}s)."
        else
            log_info "make info executado com sucesso."
        fi
    else
        make info >/dev/null 2>&1
        make_rc=$?
        if [[ "${make_rc}" -ne 0 ]]; then
            status="degraded"
            log_warn "make info retornou código ${make_rc}."
        else
            log_info "make info executado com sucesso."
        fi
    fi
else
    status="degraded"
    log_warn "make não encontrado no PATH."
fi

printf '%s\n' "${status}" > "${HEALTH_STATUS_FILE}" 2>/dev/null || true
log_info "health.status=${status} (${HEALTH_STATUS_FILE})"

exit 0
