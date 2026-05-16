#!/usr/bin/env bash
# =============================================================================
# post-start.sh — DevContainer Start Hook (Fail-Safe Orchestrator)
# Version: v2.5.0
#
# Contract:
# - Never blocks DevContainer start/attach indefinitely.
# - Never starts application services automatically.
# - Always exits 0.
# - No destructive structural mutations: no recursive chown, no mount rewrites.
# - Only bounded, reversible runtime-network mutations are allowed:
#     * /etc/resolv.conf content rewrite, when enabled, preserving file inode.
#     * delegated managed /etc/hosts block for api.github.com via:
#       .devcontainer/scripts/network/github-api-route-fix.sh
#
# Purpose:
# - Keep post-start.sh as a small fail-safe orchestrator.
# - Preserve lightweight diagnostics from v1.1/v2.2.
# - Delegate Smart GitHub API Route selection to a dedicated subscript.
# - Keep Copilot/VS Code diagnostics readable and actionable.
# - Canonicalize NSS/LD_PRELOAD for hook subprocesses even when inherited env is stale.
# =============================================================================

# Maximum fail-safe posture. This script must tolerate strict parent shells,
# partial environments, missing optional tools, and non-interactive sudo.
set +e
set +u
set +o pipefail 2> /dev/null || true
trap - ERR EXIT INT TERM 2> /dev/null || true

# -----------------------------------------------------------------------------
# Constants / config
# -----------------------------------------------------------------------------
readonly SCRIPT_NAME="post-start.sh"
readonly SCRIPT_VERSION="2.5.0"

if SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2> /dev/null && pwd -P 2> /dev/null)"; then
    :
else
    SCRIPT_DIR="$(pwd -P 2> /dev/null || printf '.')"
fi
readonly SCRIPT_DIR

readonly HEALTH_STATUS_FILE="${DEVCONTAINER_HEALTH_STATUS_FILE:-/tmp/devcontainer-health.status}"
readonly NETWORK_STATUS_FILE="${DEVCONTAINER_NETWORK_STATUS_FILE:-/tmp/devcontainer-network.status}"
readonly HEALTH_ERROR_LOG="${DEVCONTAINER_HEALTH_ERROR_LOG:-${HEALTH_STATUS_FILE}.error.log}"
readonly GITHUB_ROUTE_REPORT_FILE="${DEVCONTAINER_GITHUB_ROUTE_REPORT_FILE:-/tmp/devcontainer-github-api-route.report}"
readonly DIAGNOSTICS_STATUS_FILE="${DEVCONTAINER_DIAGNOSTICS_STATUS_FILE:-/tmp/devcontainer-diagnostics.status}"

readonly MAKE_INFO_TIMEOUT_SECONDS="${DEVCONTAINER_MAKE_TIMEOUT:-10}"
readonly ENABLE_SSHD_CHECK="${DEVCONTAINER_ENABLE_SSHD_CHECK:-false}"
readonly SSH_AUDIT_MODE="${DEVCONTAINER_SSH_AUDIT_MODE:-auto}"
readonly NSS_BASE_DIR="${DEVCONTAINER_NSS_DIR:-/tmp/devcontainer-nss}"
readonly NSS_TARGET_USER_OVERRIDE="${DEVCONTAINER_NSS_TARGET_USER:-}"
readonly NSS_TARGET_HOME_OVERRIDE="${DEVCONTAINER_NSS_TARGET_HOME:-}"
readonly NSS_WRAPPER_LIB_CANONICAL="${DEVCONTAINER_NSS_WRAPPER_LIB:-/usr/local/lib/devcontainer/libnss_wrapper.so}"

readonly ENABLE_DNS_FIX="${DEVCONTAINER_ENABLE_DNS_FIX:-true}"
readonly DNS_FIX_SERVERS="${DEVCONTAINER_DNS_FIX_SERVERS:-1.1.1.1 8.8.8.8}"
readonly DNS_FIX_OPTIONS="${DEVCONTAINER_DNS_FIX_OPTIONS:-timeout:1 attempts:2 rotate}"

readonly ENABLE_GITHUB_API_ROUTE_FIX="${DEVCONTAINER_ENABLE_GITHUB_API_ROUTE_FIX:-true}"
readonly GITHUB_API_HOST="${DEVCONTAINER_GITHUB_API_HOST:-api.github.com}"
readonly GITHUB_API_ROUTE_SCRIPT="${DEVCONTAINER_GITHUB_API_ROUTE_SCRIPT:-${SCRIPT_DIR}/network/github-api-route-fix.sh}"

# When the delegated route fixer succeeds, it has already semantically validated
# the GitHub API endpoints. Skipping them in the later smoke probe avoids double
# probing during boot while still probing the remaining Copilot/telemetry hosts.
readonly SKIP_GITHUB_API_PROBES_AFTER_ROUTE_FIX="${DEVCONTAINER_SKIP_GITHUB_API_PROBES_AFTER_ROUTE_FIX:-true}"

# Network smoke probes. These are not auth checks. 4xx can be acceptable for
# service roots; 000/TLS failure is the primary red flag.
readonly COPILOT_PROBE_ENDPOINTS="${DEVCONTAINER_COPILOT_PROBE_ENDPOINTS:-https://copilot-proxy.githubusercontent.com https://api.github.com https://api.github.com/rate_limit https://api.github.com/user https://default.exp-tas.com https://api.githubcopilot.com https://api.individual.githubcopilot.com https://proxy.individual.githubcopilot.com}"

# -----------------------------------------------------------------------------
# Logging helpers
# -----------------------------------------------------------------------------
log_info() { printf '%s\n' "ℹ️  [${SCRIPT_NAME}] $*"; }
log_warn() { printf '%s\n' "⚠️  [${SCRIPT_NAME}] $*"; }
log_ok() { printf '%s\n' "✅ [${SCRIPT_NAME}] $*"; }

log_error_detail() {
    {
        printf '[%s] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z' 2> /dev/null || date)" "$*"
    } >> "${HEALTH_ERROR_LOG}" 2> /dev/null || true
}

# -----------------------------------------------------------------------------
# Utility helpers
# -----------------------------------------------------------------------------
has_cmd() { command -v "$1" > /dev/null 2>&1; }

is_ipv4() {
    awk -v ip="$1" 'BEGIN {
        n=split(ip,a,"."); if (n != 4) exit 1;
        for (i=1;i<=4;i++) {
            if (a[i] !~ /^[0-9]+$/) exit 1;
            if (a[i] < 0 || a[i] > 255) exit 1;
        }
        exit 0;
    }' 2> /dev/null
}

safe_sudo() {
    # Non-interactive by design. A start hook must never hang on a password prompt.
    if [[ "$(id -u 2> /dev/null || echo 1)" == "0" ]]; then
        "$@"
        return $?
    fi

    if has_cmd sudo; then
        sudo -n "$@"
        return $?
    fi

    return 127
}

extract_field() {
    local key="$1"
    local line="$2"

    printf '%s' "${line}" | tr '|' '\n' | awk -F= -v k="${key}" '
        $1 == k {
            sub($1"=", "")
            print
            exit
        }
    '
}

resolve_target_user() {
    local current_uid current_user

    if [[ -n "${NSS_TARGET_USER_OVERRIDE}" ]]; then
        printf '%s\n' "${NSS_TARGET_USER_OVERRIDE}"
        return 0
    fi

    current_uid="$(id -u 2> /dev/null || echo unknown)"
    current_user="$(id -un 2> /dev/null || echo unknown)"

    if [[ "${current_uid}" != "0" && "${current_uid}" != "unknown" && -n "${current_user}" && "${current_user}" != "unknown" ]]; then
        printf '%s\n' "${current_user}"
        return 0
    fi

    if [[ -n "${SUDO_USER:-}" && "${SUDO_USER:-}" != "root" ]]; then
        printf '%s\n' "${SUDO_USER}"
        return 0
    fi

    if has_cmd getent && getent passwd node > /dev/null 2>&1; then
        printf '%s\n' "node"
        return 0
    fi

    printf '%s\n' "${current_user:-root}"
}

resolve_user_uid() {
    local user="$1"
    id -u "${user}" 2> /dev/null || awk -F: -v u="${user}" '$1 == u {print $3; exit}' /etc/passwd 2> /dev/null || true
}

resolve_user_gid() {
    local user="$1"
    id -g "${user}" 2> /dev/null || awk -F: -v u="${user}" '$1 == u {print $4; exit}' /etc/passwd 2> /dev/null || true
}

resolve_user_home() {
    local user="$1"

    if [[ -n "${NSS_TARGET_HOME_OVERRIDE}" ]]; then
        printf '%s\n' "${NSS_TARGET_HOME_OVERRIDE}"
        return 0
    fi

    if has_cmd getent; then
        getent passwd "${user}" 2> /dev/null | awk -F: 'NF >= 6 {print $6; exit}'
        return 0
    fi

    awk -F: -v u="${user}" '$1 == u {print $6; exit}' /etc/passwd 2> /dev/null || true
}

passwd_has_user_uid() {
    local passwd_file="$1"
    local user="$2"
    local uid="$3"

    awk -F: -v u="${user}" -v id="${uid}" '$1 == u && $3 == id {found=1} END {exit found ? 0 : 1}' "${passwd_file}" 2> /dev/null
}

# -----------------------------------------------------------------------------
# Diagnostic / canonicalization: LD_PRELOAD and NSS wrapper surface
# -----------------------------------------------------------------------------
resolve_nss_wrapper_lib() {
    local arch
    local candidate

    for candidate in "${NSS_WRAPPER_LIB_CANONICAL}" "/usr/local/lib/devcontainer/libnss_wrapper.so"; do
        if [[ -n "${candidate}" && -r "${candidate}" ]]; then
            printf '%s\n' "${candidate}"
            return 0
        fi
    done

    arch="$(uname -m 2> /dev/null || echo x86_64)"

    for candidate in "/usr/lib/${arch}-linux-gnu/libnss_wrapper.so" "/usr/lib/x86_64-linux-gnu/libnss_wrapper.so" "/usr/lib/aarch64-linux-gnu/libnss_wrapper.so"; do
        if [[ -r "${candidate}" ]]; then
            printf '%s\n' "${candidate}"
            return 0
        fi
    done

    if has_cmd ldconfig; then
        candidate="$(ldconfig -p 2> /dev/null | awk '/libnss_wrapper\.so/{print $NF; exit}')"
        if [[ -n "${candidate}" && -r "${candidate}" ]]; then
            printf '%s\n' "${candidate}"
            return 0
        fi
    fi

    return 1
}

canonicalize_ld_preload() {
    # Canonicalizes LD_PRELOAD for this hook and all future child processes.
    #
    # Rules:
    # - remove any existing NSS wrapper token, relative or absolute;
    # - preserve unrelated LD_PRELOAD tokens;
    # - prepend the canonical absolute NSS wrapper path;
    # - never hang, never fail the whole hook.
    if [[ -n "${DEVCONTAINER_SKIP_NSS:-}" ]]; then
        log_info "NSS preload canonicalization skipped via DEVCONTAINER_SKIP_NSS."
        return 0
    fi

    local nss_lib
    nss_lib="$(resolve_nss_wrapper_lib 2> /dev/null || true)"

    if [[ -z "${nss_lib}" || ! -r "${nss_lib}" ]]; then
        log_warn "NSS wrapper lib não encontrada; LD_PRELOAD não será canonicalizado."
        return 1
    fi

    local old_preload="${LD_PRELOAD:-}"
    local new_preload=""
    local token
    local old_ifs="${IFS}"

    IFS=':'
    for token in ${old_preload}; do
        [[ -z "${token}" ]] && continue

        case "${token}" in
            libnss_wrapper.so | */libnss_wrapper.so)
                continue
                ;;
        esac

        if [[ -z "${new_preload}" ]]; then
            new_preload="${token}"
        else
            new_preload="${new_preload}:${token}"
        fi
    done
    IFS="${old_ifs}"

    if [[ -n "${new_preload}" ]]; then
        export LD_PRELOAD="${nss_lib}:${new_preload}"
    else
        export LD_PRELOAD="${nss_lib}"
    fi

    export DEVCONTAINER_NSS_WRAPPER_LIB="${nss_lib}"

    log_info "LD_PRELOAD canonicalizado para NSS wrapper absoluto: ${nss_lib}"
    return 0
}

normalize_nss_wrapper_paths() {
    # Ensures NSS_WRAPPER_PASSWD/GROUP always point to readable, non-empty files.
    # Prefer runtime artifacts when present; otherwise use immutable /etc fallback.
    if [[ -n "${DEVCONTAINER_SKIP_NSS:-}" ]]; then
        log_info "NSS wrapper path normalization skipped via DEVCONTAINER_SKIP_NSS."
        return 0
    fi

    local passwd_file="${NSS_BASE_DIR}/passwd"
    local group_file="${NSS_BASE_DIR}/group"

    export DEVCONTAINER_NSS_DIR="${NSS_BASE_DIR}"

    if [[ -s "${passwd_file}" && -s "${group_file}" ]]; then
        export NSS_WRAPPER_PASSWD="${passwd_file}"
        export NSS_WRAPPER_GROUP="${group_file}"
        log_info "NSS wrapper paths apontam para artefatos runtime: ${NSS_BASE_DIR}"
        return 0
    fi

    if [[ -s /etc/passwd && -s /etc/group ]]; then
        export NSS_WRAPPER_PASSWD="/etc/passwd"
        export NSS_WRAPPER_GROUP="/etc/group"
        log_info "NSS wrapper paths normalizados para fallback seguro: /etc/passwd, /etc/group"
        return 0
    fi

    unset NSS_WRAPPER_PASSWD 2> /dev/null || true
    unset NSS_WRAPPER_GROUP 2> /dev/null || true
    log_warn "NSS wrapper paths não puderam ser normalizados; bindings foram removidos."
    return 1
}

normalize_nss_runtime_env() {
    local rc=0

    normalize_nss_wrapper_paths || rc=1
    canonicalize_ld_preload || rc=1

    return "${rc}"
}

check_ld_preload() {
    local val="${LD_PRELOAD:-}"
    local degraded=0
    local token
    local found_nss=0
    local old_ifs="${IFS}"

    if [[ -z "${val}" ]]; then
        log_warn "LD_PRELOAD vazio; NSS wrapper pode não estar ativo."
        return 1
    fi

    if [[ "${val}" == ":"* || "${val}" == *":" || "${val}" == *"::"* ]]; then
        log_warn "LD_PRELOAD contém token vazio (p.ex. '::' ou ':' nas pontas): '${val}'"
        degraded=1
    fi

    if ((${#val} > 4096)); then
        log_warn "LD_PRELOAD length=${#val} exceeds kernel limit; truncation may occur."
        degraded=1
    fi

    IFS=':'
    for token in ${val}; do
        [[ -z "${token}" ]] && continue

        case "${token}" in
            libnss_wrapper.so)
                log_warn "LD_PRELOAD contém libnss_wrapper.so relativo; esperado caminho absoluto canônico."
                degraded=1
                found_nss=1
                ;;
            */libnss_wrapper.so)
                found_nss=1
                if [[ ! -r "${token}" ]]; then
                    log_warn "LD_PRELOAD aponta para NSS wrapper ilegível/inexistente: ${token}"
                    degraded=1
                else
                    log_info "LD_PRELOAD NSS wrapper OK: ${token}"
                fi
                ;;
        esac
    done
    IFS="${old_ifs}"

    if [[ "${found_nss}" -eq 0 ]]; then
        log_warn "LD_PRELOAD não contém libnss_wrapper.so; NSS wrapper pode não estar ativo."
        degraded=1
    fi

    if [[ -n "${DEVCONTAINER_NSS_WRAPPER_LIB:-}" && ! -r "${DEVCONTAINER_NSS_WRAPPER_LIB}" ]]; then
        log_warn "DEVCONTAINER_NSS_WRAPPER_LIB aponta para arquivo ilegível/inexistente: ${DEVCONTAINER_NSS_WRAPPER_LIB}"
        degraded=1
    fi

    if [[ -n "${NSS_WRAPPER_PASSWD:-}" && ! -s "${NSS_WRAPPER_PASSWD}" ]]; then
        log_warn "NSS_WRAPPER_PASSWD inválido ou vazio: ${NSS_WRAPPER_PASSWD}"
        degraded=1
    fi

    if [[ -n "${NSS_WRAPPER_GROUP:-}" && ! -s "${NSS_WRAPPER_GROUP}" ]]; then
        log_warn "NSS_WRAPPER_GROUP inválido ou vazio: ${NSS_WRAPPER_GROUP}"
        degraded=1
    fi

    return "${degraded}"
}

repair_nss_artifacts() {
    local target_user target_uid target_gid target_home
    local passwd_file group_file passwd_tmp group_tmp

    target_user="$(resolve_target_user)"
    target_uid="$(resolve_user_uid "${target_user}")"
    target_gid="$(resolve_user_gid "${target_user}")"
    target_home="$(resolve_user_home "${target_user}")"

    [[ -z "${target_user}" || "${target_user}" == "unknown" ]] && target_user="node"
    [[ -z "${target_uid}" ]] && target_uid="$(id -u 2> /dev/null || echo 1000)"
    [[ -z "${target_gid}" ]] && target_gid="$(id -g 2> /dev/null || echo 1000)"
    [[ -z "${target_home}" ]] && target_home="/home/${target_user}"

    passwd_file="${NSS_BASE_DIR}/passwd"
    group_file="${NSS_BASE_DIR}/group"
    passwd_tmp="${passwd_file}.tmp"
    group_tmp="${group_file}.tmp"

    mkdir -p "${NSS_BASE_DIR}" 2>> "${HEALTH_ERROR_LOG}" || return 1

    if [[ -r /etc/passwd ]]; then
        cat /etc/passwd > "${passwd_tmp}" 2>> "${HEALTH_ERROR_LOG}" || true
    fi
    if [[ -r /etc/group ]]; then
        cat /etc/group > "${group_tmp}" 2>> "${HEALTH_ERROR_LOG}" || true
    fi

    if [[ ! -s "${passwd_tmp}" ]]; then
        printf '%s:x:%s:%s:%s user:%s:/bin/bash\n' \
            "${target_user}" "${target_uid}" "${target_gid}" "${target_user}" "${target_home}" > "${passwd_tmp}" 2>> "${HEALTH_ERROR_LOG}" || return 1
    fi

    if ! passwd_has_user_uid "${passwd_tmp}" "${target_user}" "${target_uid}"; then
        printf '%s:x:%s:%s:%s user:%s:/bin/bash\n' \
            "${target_user}" "${target_uid}" "${target_gid}" "${target_user}" "${target_home}" >> "${passwd_tmp}" 2>> "${HEALTH_ERROR_LOG}" || return 1
    fi

    if [[ ! -s "${group_tmp}" ]]; then
        printf '%s:x:%s:\n' "${target_user}" "${target_gid}" > "${group_tmp}" 2>> "${HEALTH_ERROR_LOG}" || return 1
    fi

    mv -f "${passwd_tmp}" "${passwd_file}" 2>> "${HEALTH_ERROR_LOG}" || return 1
    mv -f "${group_tmp}" "${group_file}" 2>> "${HEALTH_ERROR_LOG}" || return 1

    chmod 600 "${passwd_file}" "${group_file}" 2>> "${HEALTH_ERROR_LOG}" || true
    log_info "NSS artifacts repaired in post-start: ${NSS_BASE_DIR} (target=${target_user}, uid=${target_uid})"
    return 0
}

audit_nss_artifacts() {
    local degraded=0
    local passwd_file="${NSS_BASE_DIR}/passwd"
    local group_file="${NSS_BASE_DIR}/group"

    export DEVCONTAINER_NSS_DIR="${NSS_BASE_DIR}"

    if [[ ! -s "${passwd_file}" || ! -s "${group_file}" ]]; then
        repair_nss_artifacts || true
    fi

    # After artifacts are repaired/confirmed, point future child processes to them
    # and canonicalize LD_PRELOAD again. This affects this hook and all subprocesses
    # spawned after this point.
    normalize_nss_runtime_env || degraded=1

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

    local target_user target_uid
    target_user="$(resolve_target_user)"
    target_uid="$(resolve_user_uid "${target_user}")"

    if [[ -s "${passwd_file}" && -n "${target_user}" && -n "${target_uid}" ]]; then
        if passwd_has_user_uid "${passwd_file}" "${target_user}" "${target_uid}"; then
            log_info "NSS passwd coerente com usuário alvo: ${target_user} (uid=${target_uid})"
        else
            log_warn "NSS passwd NÃO contém linha esperada para ${target_user} (uid=${target_uid}) — possível mismatch."
            degraded=1
        fi
    fi

    check_ld_preload || true
    return "${degraded}"
}

# -----------------------------------------------------------------------------
# DNS fix — configurable, bounded, inode-preserving
# -----------------------------------------------------------------------------
fix_dns() {
    if [[ "${ENABLE_DNS_FIX}" != "true" ]]; then
        log_info "DNS fix desabilitado por DEVCONTAINER_ENABLE_DNS_FIX=${ENABLE_DNS_FIX}."
        return 0
    fi

    local tmp ns count=0
    tmp="$(mktemp 2> /dev/null || echo "/tmp/resolv.conf.$$")"
    : > "${tmp}" 2>> "${HEALTH_ERROR_LOG}" || return 1

    for ns in ${DNS_FIX_SERVERS}; do
        if is_ipv4 "${ns}"; then
            printf 'nameserver %s\n' "${ns}" >> "${tmp}"
            count=$((count + 1))
        else
            log_warn "DNS fix: ignorando nameserver inválido: ${ns}"
        fi
    done

    printf 'options %s\n' "${DNS_FIX_OPTIONS}" >> "${tmp}"

    if [[ "${count}" -eq 0 ]]; then
        log_warn "DNS fix: nenhum nameserver IPv4 válido em DEVCONTAINER_DNS_FIX_SERVERS."
        rm -f "${tmp}" 2> /dev/null || true
        return 1
    fi

    # Docker often bind-mounts /etc/resolv.conf. Preserve inode: write content via tee.
    safe_sudo tee /etc/resolv.conf < "${tmp}" > /dev/null 2>> "${HEALTH_ERROR_LOG}" || {
        log_warn "DNS fix: falha ao sobrescrever conteúdo de /etc/resolv.conf (sem sudo -n/root ou read-only?)."
        log_error_detail "DNS fix failed while tee-ing /etc/resolv.conf from ${tmp}"
        rm -f "${tmp}" 2> /dev/null || true
        return 1
    }

    rm -f "${tmp}" 2> /dev/null || true

    local configured
    configured="$(awk '/^nameserver/{printf "%s ", $2}' /etc/resolv.conf 2> /dev/null)"
    log_info "DNS configurado: ${configured}"
    return 0
}

# -----------------------------------------------------------------------------
# Delegated Smart GitHub API route selector
# -----------------------------------------------------------------------------
run_github_api_route_fix() {
    if [[ "${ENABLE_GITHUB_API_ROUTE_FIX}" != "true" ]]; then
        log_info "GitHub API route fix desabilitado por DEVCONTAINER_ENABLE_GITHUB_API_ROUTE_FIX=${ENABLE_GITHUB_API_ROUTE_FIX}."
        return 0
    fi

    if [[ ! -f "${GITHUB_API_ROUTE_SCRIPT}" ]]; then
        log_warn "GitHub API route: subscript ausente: ${GITHUB_API_ROUTE_SCRIPT}"
        return 1
    fi

    # Use bash explicitly; do not depend on executable bit preservation across
    # Windows/Git filesystems. The subscript owns DEVCONTAINER_GITHUB_* defaults;
    # any exported user-provided overrides remain visible to it naturally.
    DEVCONTAINER_GITHUB_ROUTE_REPORT_FILE="${GITHUB_ROUTE_REPORT_FILE}" \
        DEVCONTAINER_GITHUB_API_HOST="${GITHUB_API_HOST}" \
        DEVCONTAINER_VERBOSE_NETWORK="${DEVCONTAINER_VERBOSE_NETWORK:-false}" \
        bash "${GITHUB_API_ROUTE_SCRIPT}"

    return $?
}

# -----------------------------------------------------------------------------
# NSS DB — initialize VS Code/Chromium trust store on Linux
# -----------------------------------------------------------------------------
init_nss_db() {
    local target_user target_gid target_home nssdb current_user

    if ! has_cmd certutil; then
        log_warn "NSS DB: certutil não encontrado (libnss3-tools não instalado); ignorado."
        return 1
    fi

    target_user="$(resolve_target_user)"
    target_gid="$(resolve_user_gid "${target_user}")"
    target_home="$(resolve_user_home "${target_user}")"
    current_user="$(id -un 2> /dev/null || echo unknown)"

    [[ -z "${target_home}" ]] && target_home="${HOME:-/home/${target_user}}"
    [[ -z "${target_gid}" ]] && target_gid="$(id -g 2> /dev/null || echo 1000)"

    nssdb="${target_home}/.pki/nssdb"

    mkdir -p "${nssdb}" 2>> "${HEALTH_ERROR_LOG}" || {
        log_warn "NSS DB: falha ao criar ${nssdb}."
        return 1
    }

    if [[ "${current_user}" == "root" && "${target_user}" != "root" ]]; then
        safe_sudo chown "${target_user}:${target_gid}" "${target_home}/.pki" "${nssdb}" 2>> "${HEALTH_ERROR_LOG}" || true
    fi

    if [[ -d "${nssdb}" ]]; then
        if certutil -L -d "sql:${nssdb}" > /dev/null 2>> "${HEALTH_ERROR_LOG}"; then
            log_info "NSS DB OK: ${nssdb} (target=${target_user})"
            return 0
        fi

        log_warn "NSS DB corrompido: ${nssdb} — removendo e recriando. Veja ${HEALTH_ERROR_LOG}."
        rm -rf "${nssdb}" 2>> "${HEALTH_ERROR_LOG}" || true
        mkdir -p "${nssdb}" 2>> "${HEALTH_ERROR_LOG}" || return 1
        if [[ "${current_user}" == "root" && "${target_user}" != "root" ]]; then
            safe_sudo chown "${target_user}:${target_gid}" "${nssdb}" 2>> "${HEALTH_ERROR_LOG}" || true
        fi
    fi

    certutil -d "sql:${nssdb}" -N -f /dev/null > /dev/null 2>> "${HEALTH_ERROR_LOG}" || {
        log_warn "NSS DB: certutil -N falhou. Veja ${HEALTH_ERROR_LOG}."
        return 1
    }

    log_info "NSS DB criado: ${nssdb} (target=${target_user})"

    local custom_dir="/usr/local/share/ca-certificates"
    local imported=0
    local crt_file ca_name

    if [[ -d "${custom_dir}" ]]; then
        while IFS= read -r -d '' crt_file; do
            ca_name="$(basename "${crt_file}" .crt)"
            if certutil -A -d "sql:${nssdb}" -n "custom-${ca_name}" -t "CT,," -i "${crt_file}" > /dev/null 2>> "${HEALTH_ERROR_LOG}"; then
                imported=$((imported + 1))
            fi
        done < <(find "${custom_dir}" -maxdepth 2 -name '*.crt' -print0 2> /dev/null)

        [[ "${imported}" -gt 0 ]] && log_info "NSS DB: ${imported} CA(s) customizado(s) importado(s)"
    fi

    return 0
}

# -----------------------------------------------------------------------------
# Connectivity probes
# -----------------------------------------------------------------------------
expected_status_ok_for_url() {
    local url="$1"
    local code="$2"

    case "${url}" in
        https://api.github.com/user*)
            [[ "${code}" == "200" || "${code}" == "401" || "${code}" == "403" ]]
            return $?
            ;;
        https://api.github.com/rate_limit*)
            [[ "${code}" == "200" ]]
            return $?
            ;;
        https://api.github.com)
            [[ "${code}" == "200" ]]
            return $?
            ;;
        *)
            [[ "${code}" != "000" && -n "${code}" ]]
            return $?
            ;;
    esac
}

should_skip_probe_url() {
    local url="$1"
    local route_fix_ok="$2"

    [[ "${SKIP_GITHUB_API_PROBES_AFTER_ROUTE_FIX}" == "true" ]] || return 1
    [[ "${route_fix_ok}" == "true" ]] || return 1

    case "${url}" in
        https://api.github.com | https://api.github.com/*)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

probe_copilot_connectivity() {
    local route_fix_ok="${1:-false}"
    local failed=0

    if ! has_cmd curl; then
        log_warn "Copilot probe: curl não encontrado — ignorado."
        return 1
    fi

    local url result http_code time_connect time_total tls_ok remote_ip ctype

    for url in ${COPILOT_PROBE_ENDPOINTS}; do
        if should_skip_probe_url "${url}" "${route_fix_ok}"; then
            log_info "Copilot probe skip: ${url} já validado pelo GitHub API route fix."
            continue
        fi

        result="$(LC_ALL=C curl -4 -so /dev/null --connect-timeout 5 --max-time 10 \
            -w 'http_code=%{http_code}|content_type=%{content_type}|time_connect=%{time_connect}|time_total=%{time_total}|remote_ip=%{remote_ip}|ssl_verify_result=%{ssl_verify_result}' \
            "${url}" 2>> "${HEALTH_ERROR_LOG}" || true)"

        http_code="$(extract_field http_code "${result}")"
        ctype="$(extract_field content_type "${result}")"
        time_connect="$(extract_field time_connect "${result}")"
        time_total="$(extract_field time_total "${result}")"
        remote_ip="$(extract_field remote_ip "${result}")"
        tls_ok="$(extract_field ssl_verify_result "${result}")"

        if [[ -z "${http_code}" || "${http_code}" == "000" ]]; then
            log_warn "Copilot probe FALHOU: ${url} → IP ${remote_ip:-unknown} (sem resposta; TCP ${time_connect:-0}s; total ${time_total:-0}s)"
            failed=1
        elif [[ "${tls_ok}" != "0" ]]; then
            log_warn "Copilot probe TLS ERRO (${tls_ok:-?}): ${url} → HTTP ${http_code} | IP ${remote_ip:-unknown} | TCP ${time_connect:-0}s"
            failed=1
        elif ! expected_status_ok_for_url "${url}" "${http_code}"; then
            log_warn "Copilot probe HTTP inesperado: ${url} → HTTP ${http_code} | IP ${remote_ip:-unknown} | ctype=${ctype:-none} | TLS OK"
            failed=1
        else
            log_ok "Copilot probe OK: ${url} → HTTP ${http_code} | IP ${remote_ip:-unknown} | TCP ${time_connect:-0}s | total ${time_total:-0}s | TLS OK"
        fi
    done

    return "${failed}"
}

# -----------------------------------------------------------------------------
# Other diagnostics
# -----------------------------------------------------------------------------
audit_initialized_marker() {
    if [[ -f ".devcontainer/.initialized" ]]; then
        log_info "Marker encontrado: .devcontainer/.initialized"
        return 0
    fi

    log_warn "Marker ausente: .devcontainer/.initialized (post-create pode ter falhado ou não rodou)."
    return 0
}

run_make_info() {
    if ! has_cmd make; then
        log_warn "make não encontrado no PATH."
        return 1
    fi

    if has_cmd timeout; then
        timeout "${MAKE_INFO_TIMEOUT_SECONDS}" make info > /dev/null 2>> "${HEALTH_ERROR_LOG}"
        return $?
    fi

    make info > /dev/null 2>> "${HEALTH_ERROR_LOG}"
    return $?
}

audit_ssh() {
    case "${SSH_AUDIT_MODE}" in
        false | off | disabled | none)
            log_info "SSH audit desabilitado por DEVCONTAINER_SSH_AUDIT_MODE=${SSH_AUDIT_MODE}."
            return 0
            ;;
        attach-only)
            log_info "SSH audit adiado para postAttach por DEVCONTAINER_SSH_AUDIT_MODE=attach-only."
            return 0
            ;;
        auto | true | on | enabled)
            :
            ;;
        *)
            log_warn "SSH audit mode desconhecido (${SSH_AUDIT_MODE}); usando modo auto."
            ;;
    esac

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
        if [[ -n "${SSH_AUTH_SOCK:-}" ]] && has_cmd ssh-add; then
            if ssh-add -L > /dev/null 2>> "${HEALTH_ERROR_LOG}"; then
                log_info "Nenhuma chave em ~/.ssh, mas agente SSH encaminhado detectado."
                ssh_key_found=true
            else
                log_info "SSH_AUTH_SOCK presente, mas ssh-add -L ainda não retornou chaves; estado comum antes do postAttach."
            fi
        else
            log_info "Nenhuma chave SSH privada/agente detectado no postStart; normal antes do postAttach em alguns fluxos VS Code."
        fi
    fi

    if [[ "${ENABLE_SSHD_CHECK}" != "true" ]]; then
        log_info "SSHD check skipped via DEVCONTAINER_ENABLE_SSHD_CHECK."
    else
        if has_cmd sshd; then
            log_info "sshd está instalado."
        else
            log_info "sshd não encontrado; acesso inbound via SSH permanece desabilitado (estado esperado)."
        fi
    fi
}

# =============================================================================
# Execution — always fail-safe
# =============================================================================
log_info "Hook de start acionado (não-bloqueante)."
log_info "Versão: v${SCRIPT_VERSION}"
log_info "PWD: ${PWD:-unknown}"
log_info "User: $(id -un 2> /dev/null || echo unknown) (uid=$(id -u 2> /dev/null || echo unknown), gid=$(id -g 2> /dev/null || echo unknown))"
log_info "NSS_BASE_DIR: ${NSS_BASE_DIR}"
log_info "NSS target user: $(resolve_target_user)"
log_info "LD_PRELOAD inicial: ${LD_PRELOAD:-<unset>}"
log_info "GitHub API route script: ${GITHUB_API_ROUTE_SCRIPT}"
log_info "Route report: ${GITHUB_ROUTE_REPORT_FILE}"
log_info "Health error log: ${HEALTH_ERROR_LOG}"

log_info "Normalizando ambiente NSS/LD_PRELOAD para subprocessos do hook..."
normalize_nss_runtime_env
nss_env_rc=$?
if [[ "${nss_env_rc}" -ne 0 ]]; then
    log_warn "Normalização inicial de NSS/LD_PRELOAD degradada; audit_nss_artifacts tentará reparar artefatos depois."
fi
log_info "LD_PRELOAD após normalização: ${LD_PRELOAD:-<unset>}"
log_info "DEVCONTAINER_NSS_WRAPPER_LIB: ${DEVCONTAINER_NSS_WRAPPER_LIB:-<unset>}"
log_info "NSS_WRAPPER_PASSWD: ${NSS_WRAPPER_PASSWD:-<unset>}"
log_info "NSS_WRAPPER_GROUP: ${NSS_WRAPPER_GROUP:-<unset>}"

status="ok"
network_status="ok"
diagnostics_status="ok"
github_api_route_fix_ok="false"

log_info "Aplicando fix de DNS..."
fix_dns
dns_rc=$?
if [[ "${dns_rc}" -ne 0 ]]; then
    status="degraded"
    network_status="degraded"
    log_warn "Fix de DNS não aplicado — resolução de nomes pode falhar."
fi

log_info "Aplicando fix inteligente de rota para ${GITHUB_API_HOST}..."
run_github_api_route_fix
github_api_route_rc=$?
if [[ "${github_api_route_rc}" -ne 0 ]]; then
    status="degraded"
    network_status="degraded"
    log_warn "Fix inteligente de rota para ${GITHUB_API_HOST} não aplicado — Copilot pode falhar se a rota DNS padrão estiver ruim."
else
    github_api_route_fix_ok="true"
fi

run_make_info
make_rc=$?
if [[ "${make_rc}" -ne 0 ]]; then
    diagnostics_status="degraded"
    log_warn "make info falhou (rc=${make_rc}, timeout=${MAKE_INFO_TIMEOUT_SECONDS}s) — diagnóstico degradado, sem degradar health estrutural."
else
    log_info "make info executado com sucesso."
fi

audit_nss_artifacts
nss_rc=$?
if [[ "${nss_rc}" -ne 0 ]]; then
    status="degraded"
    log_warn "NSS audit degradado (artefatos ausentes/mismatch)."
    log_warn "Ação recomendada: Rebuild Container OU execute manualmente: .devcontainer/scripts/post-create.sh (com REEXECUTE_POST_CREATE=true se aplicável)."
fi

audit_initialized_marker || true
init_nss_db || true

log_info "Verificando conectividade com endpoints GitHub/Copilot/VS Code relevantes..."
probe_copilot_connectivity "${github_api_route_fix_ok}"
probe_rc=$?
if [[ "${probe_rc}" -ne 0 ]]; then
    network_status="degraded"
    log_warn "Um ou mais endpoints relevantes não responderam como esperado. Veja ${GITHUB_ROUTE_REPORT_FILE}, ${HEALTH_ERROR_LOG} e logs acima."
else
    log_ok "Todos os probes de rede relevantes responderam."
fi

audit_ssh || true

if [[ -x "${SCRIPT_DIR}/sync-local-auth.sh" ]]; then
    "${SCRIPT_DIR}/sync-local-auth.sh" || log_warn "sync-local-auth.sh falhou (WARN only)."
fi

printf '%s\n' "${status}" > "${HEALTH_STATUS_FILE}" 2> /dev/null || true
printf '%s\n' "${network_status}" > "${NETWORK_STATUS_FILE}" 2> /dev/null || true
printf '%s\n' "${diagnostics_status}" > "${DIAGNOSTICS_STATUS_FILE}" 2> /dev/null || true

log_info "health.status=${status} (${HEALTH_STATUS_FILE})"
log_info "network.status=${network_status} (${NETWORK_STATUS_FILE})"
log_info "diagnostics.status=${diagnostics_status} (${DIAGNOSTICS_STATUS_FILE})"

exit 0
