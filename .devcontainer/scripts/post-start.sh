#!/usr/bin/env bash
# =============================================================================
# post-start.sh — Start Hook (Fail-Safe) — FINAL
# Version: v1.1
#
# Contrato (inviolável):
# - Nunca bloqueia o start/attach do DevContainer
# - Nunca inicia serviços automaticamente
# - Sempre termina com exit 0
# - Sem mutações estruturais perigosas (sem chown recursivo; sem alterar mounts)
#
# Papel:
# - Diagnóstico leve (make info, identidade, NSS artifacts, LD_PRELOAD)
# - Registro de health/status em /tmp (observacional)
# - Auto-reparo mínimo e seguro de artefatos NSS ausentes para sessões normais
# - Sinais úteis para humanos/agentes sem “auto-repair” destrutivo
#
# Nota importante:
# - Post-create continua sendo a origem canônica dos artefatos NSS.
# - Este hook pode regenerar artefatos mínimos quando eles estiverem ausentes e o processo não
#   estiver rodando como root, para manter o ambiente utilizável e observável.
# =============================================================================

# Defesa máxima contra herança de shell estrito (fail-safe)
set +e
set +u
set +o pipefail 2>/dev/null || true
trap - ERR EXIT INT TERM 2>/dev/null || true

# ---------------------------------------------------------------------------
# Constantes / Config
# ---------------------------------------------------------------------------
readonly SCRIPT_NAME="post-start.sh"
readonly SCRIPT_VERSION="1.1"

readonly HEALTH_STATUS_FILE="/tmp/devcontainer-health.status"

# Parâmetros configuráveis
readonly MAKE_INFO_TIMEOUT_SECONDS="${DEVCONTAINER_MAKE_TIMEOUT:-10}"
readonly ENABLE_SSHD_CHECK="${DEVCONTAINER_ENABLE_SSHD_CHECK:-true}"
readonly NSS_BASE_DIR="${DEVCONTAINER_NSS_DIR:-/tmp/devcontainer-nss}"

# ---------------------------------------------------------------------------
# Logging minimalista (não depende de cores; não quebra)
# ---------------------------------------------------------------------------
log_info() { printf "%s\n" "ℹ️  [${SCRIPT_NAME}] $*"; }
log_warn() { printf "%s\n" "⚠️  [${SCRIPT_NAME}] $*"; }

# ---------------------------------------------------------------------------
# Diagnóstico: LD_PRELOAD (informativo)
# ---------------------------------------------------------------------------
check_ld_preload() {
  local val="${LD_PRELOAD:-}"
  if [[ -z "${val}" ]]; then
    log_warn "LD_PRELOAD is empty; NSS wrapper may not be active (this can be normal before profile load)."
    return 1
  fi
  if [[ "${val}" == ":"* || "${val}" == *":" || "${val}" == *"::"* ]]; then
    log_warn "LD_PRELOAD contém token vazio (p.ex. '::' ou ':' nas pontas): '${val}'"
  fi
  if (( ${#val} > 4096 )); then
    log_warn "LD_PRELOAD length=${#val} exceeds kernel limit; truncation may occur."
  fi
  return 0
}

repair_nss_artifacts() {
  local current_uid current_gid current_user passwd_file group_file

  current_uid="$(id -u 2>/dev/null || echo unknown)"
  if [[ "${current_uid}" == "0" || "${current_uid}" == "unknown" ]]; then
    return 1
  fi

  current_gid="$(id -g 2>/dev/null || echo unknown)"
  current_user="$(id -un 2>/dev/null || echo node)"
  [[ -z "${current_user}" || "${current_user}" == "unknown" ]] && current_user="node"

  passwd_file="${NSS_BASE_DIR}/passwd"
  group_file="${NSS_BASE_DIR}/group"

  mkdir -p "${NSS_BASE_DIR}" 2>/dev/null || return 1
  printf '%s:x:%s:%s:%s user:%s:/bin/bash\n' \
    "${current_user}" "${current_uid}" "${current_gid}" "${current_user}" "${HOME:-/home/node}" > "${passwd_file}" 2>/dev/null || return 1
  printf '%s:x:%s:\n' "${current_user}" "${current_gid}" > "${group_file}" 2>/dev/null || return 1
  chmod 644 "${passwd_file}" "${group_file}" 2>/dev/null || true
  log_info "NSS artifacts repaired in post-start: ${NSS_BASE_DIR}"
  return 0
}

# ---------------------------------------------------------------------------
# Diagnóstico: NSS artifacts (somente audit; sem reparo)
# ---------------------------------------------------------------------------
audit_nss_artifacts() {
  local status_ref="$1" # name-ref string (em bash moderno), mas aqui faremos via echo/retcode
  local degraded=0

  local passwd_file="${NSS_BASE_DIR}/passwd"
  local group_file="${NSS_BASE_DIR}/group"

  # registrar path efetivo (útil p/ debugging)
  export DEVCONTAINER_NSS_DIR="${NSS_BASE_DIR}"

  # NSS artifacts são runtime-only; ausência pode ser normal se post-create não rodou ainda
  if [[ ! -s "${passwd_file}" || ! -s "${group_file}" ]]; then
    repair_nss_artifacts || true
  fi

  if [[ -s "${passwd_file}" ]]; then
    log_info "NSS artifact OK: ${passwd_file}"
  else
    log_warn "NSS artifact ausente/vazio: ${passwd_file}"
    degraded=1
  fi

  if [[ -s "${group_file}" ]]; then
    log_info "NSS artifact OK: ${group_file}"
  else
    log_warn "NSS artifact ausente/vazio: ${group_file}"
    degraded=1
  fi

  # coerência mínima: passwd deve conter entrada do usuário atual (best-effort)
  local current_user current_uid
  current_user="$(id -un 2>/dev/null || echo unknown)"
  current_uid="$(id -u 2>/dev/null || echo unknown)"

  if [[ -s "${passwd_file}" && "${current_user}" != "unknown" && "${current_uid}" != "unknown" ]]; then
    if grep -qE "^${current_user}:x:${current_uid}:" "${passwd_file}" 2>/dev/null; then
      log_info "NSS passwd coerente com usuário atual: ${current_user} (uid=${current_uid})"
    else
      log_warn "NSS passwd NÃO contém linha esperada para ${current_user} (uid=${current_uid}) — possível mismatch."
      degraded=1
    fi
  fi

  # validação leve do LD_PRELOAD no *ambiente atual* (pode ser cedo demais)
  check_ld_preload || true

  return "${degraded}"
}

# ---------------------------------------------------------------------------
# Diagnóstico: .initialized (manifesto do post-create)
# ---------------------------------------------------------------------------
audit_initialized_marker() {
  if [[ -f ".devcontainer/.initialized" ]]; then
    log_info "Marker encontrado: .devcontainer/.initialized"
    return 0
  fi
  log_warn "Marker ausente: .devcontainer/.initialized (post-create pode ter falhado ou não rodou)."
  return 0
}

# ---------------------------------------------------------------------------
# Diagnóstico: make info (observacional)
# ---------------------------------------------------------------------------
run_make_info() {
  if ! command -v make >/dev/null 2>&1; then
    log_warn "make não encontrado no PATH."
    return 1
  fi

  if command -v timeout >/dev/null 2>&1; then
    timeout "${MAKE_INFO_TIMEOUT_SECONDS}" make info >/dev/null 2>&1
    return $?
  fi

  make info >/dev/null 2>&1
  return $?
}

# ---------------------------------------------------------------------------
# Diagnóstico: SSH (observacional; nunca degrada por padrão)
# ---------------------------------------------------------------------------
audit_ssh() {
  local ssh_key_found=false
  local key

  for key in id_rsa id_dsa id_ecdsa id_ed25519; do
    if [[ -s "${HOME:-/home/node}/.ssh/${key}" ]]; then
      ssh_key_found=true
      log_info "SSH private key presente: ~/.ssh/${key}"
      break
    fi
  done

  if [[ "${ssh_key_found}" == "false" ]]; then
    if command -v ssh-add >/dev/null 2>&1 && ssh-add -L >/dev/null 2>&1; then
      log_info "Nenhuma chave em ~/.ssh, mas agente SSH encaminhado detectado."
      ssh_key_found=true
    else
      log_warn "Nenhuma chave SSH privada detectada e nenhum agente aparente; git/ssh pode falhar (WARN only)."
    fi
  fi

  if [[ "${ENABLE_SSHD_CHECK}" != "true" ]]; then
    log_info "SSHD check skipped via DEVCONTAINER_ENABLE_SSHD_CHECK."
  else
    if command -v sshd >/dev/null 2>&1; then
      log_info "sshd está instalado."
    else
      log_warn "sshd não encontrado; acesso inbound via SSH não disponível (WARN only)."
    fi
  fi
}

# =============================================================================
# Execução (sempre fail-safe)
# =============================================================================
log_info "Hook de start acionado (não-bloqueante)."
log_info "Versão: v${SCRIPT_VERSION}"
log_info "PWD: ${PWD:-unknown}"
log_info "User: $(id -un 2>/dev/null || echo unknown) (uid=$(id -u 2>/dev/null || echo unknown), gid=$(id -g 2>/dev/null || echo unknown))"
log_info "NSS_BASE_DIR: ${NSS_BASE_DIR}"
log_info "LD_PRELOAD: ${LD_PRELOAD:-<unset>}"

status="ok"

# make info (se falhar → degraded)
run_make_info
make_rc=$?
if [[ "${make_rc}" -ne 0 ]]; then
  status="degraded"
  log_warn "make info falhou (rc=${make_rc}, timeout=${MAKE_INFO_TIMEOUT_SECONDS}s)."
else
  log_info "make info executado com sucesso."
fi

# NSS + markers (se falhar → degraded)
audit_nss_artifacts
nss_rc=$?
if [[ "${nss_rc}" -ne 0 ]]; then
  status="degraded"
  log_warn "NSS audit degradado (artefatos ausentes/mismatch)."
  log_warn "Ação recomendada: Rebuild Container OU execute manualmente: .devcontainer/scripts/post-create.sh (com REEXECUTE_POST_CREATE=true se aplicável)."
fi

audit_initialized_marker || true

# SSH (WARN only)
audit_ssh || true

# Persist status (best-effort)
printf '%s\n' "${status}" > "${HEALTH_STATUS_FILE}" 2>/dev/null || true
log_info "health.status=${status} (${HEALTH_STATUS_FILE})"

exit 0
