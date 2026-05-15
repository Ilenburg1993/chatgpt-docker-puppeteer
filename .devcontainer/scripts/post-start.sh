#!/usr/bin/env bash
# =============================================================================
# post-start.sh — DevContainer Start Hook (Fail-Safe + Smart GitHub API Route)
# Version: v2.2.0
#
# Contract:
# - Never blocks DevContainer start/attach indefinitely.
# - Never starts application services automatically.
# - Always exits 0.
# - No destructive structural mutations: no recursive chown, no mount rewrites.
# - Only bounded, reversible runtime-network mutations are allowed:
#     * /etc/resolv.conf rewrite, when enabled.
#     * managed /etc/hosts block for api.github.com, when a validated route exists.
#
# Purpose:
# - Preserve the lightweight diagnostics from v1.1.
# - Repair a specific route/DNS failure mode where api.github.com resolves to an
#   unreachable edge IP from the current ISP/route.
# - Select an API IP by semantic validation, not merely by TCP reachability.
# - Keep Copilot/VS Code diagnostics readable and actionable.
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
readonly SCRIPT_VERSION="2.2.0"
if SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2> /dev/null && pwd -P 2> /dev/null)"; then
    :
else
    SCRIPT_DIR="$(pwd -P 2> /dev/null || printf '.')"
fi
readonly SCRIPT_DIR

readonly HEALTH_STATUS_FILE="${DEVCONTAINER_HEALTH_STATUS_FILE:-/tmp/devcontainer-health.status}"
readonly NETWORK_STATUS_FILE="${DEVCONTAINER_NETWORK_STATUS_FILE:-/tmp/devcontainer-network.status}"
readonly GITHUB_ROUTE_REPORT_FILE="${DEVCONTAINER_GITHUB_ROUTE_REPORT_FILE:-/tmp/devcontainer-github-api-route.report}"

readonly MAKE_INFO_TIMEOUT_SECONDS="${DEVCONTAINER_MAKE_TIMEOUT:-10}"
readonly ENABLE_SSHD_CHECK="${DEVCONTAINER_ENABLE_SSHD_CHECK:-false}"
readonly NSS_BASE_DIR="${DEVCONTAINER_NSS_DIR:-/tmp/devcontainer-nss}"

readonly ENABLE_DNS_FIX="${DEVCONTAINER_ENABLE_DNS_FIX:-true}"
readonly DNS_FIX_SERVERS="${DEVCONTAINER_DNS_FIX_SERVERS:-1.1.1.1 8.8.8.8}"
readonly DNS_FIX_OPTIONS="${DEVCONTAINER_DNS_FIX_OPTIONS:-timeout:1 attempts:2 rotate}"

readonly ENABLE_GITHUB_API_ROUTE_FIX="${DEVCONTAINER_ENABLE_GITHUB_API_ROUTE_FIX:-true}"
readonly GITHUB_API_HOST="${DEVCONTAINER_GITHUB_API_HOST:-api.github.com}"
readonly GITHUB_API_ROUTE_CONNECT_TIMEOUT="${DEVCONTAINER_GITHUB_API_ROUTE_CONNECT_TIMEOUT:-3}"
readonly GITHUB_API_ROUTE_MAX_TIME="${DEVCONTAINER_GITHUB_API_ROUTE_MAX_TIME:-7}"
readonly GITHUB_API_MIN_SCORE="${DEVCONTAINER_GITHUB_API_MIN_SCORE:-85}"
readonly GITHUB_API_MAX_CANDIDATES="${DEVCONTAINER_GITHUB_API_MAX_CANDIDATES:-16}"

# Resolvers used only for candidate discovery. They do not replace /etc/resolv.conf.
# 185.228.* returned valid 140.82.* candidates in the observed environment.
readonly GITHUB_API_RESOLVERS="${DEVCONTAINER_GITHUB_API_RESOLVERS:-185.228.168.9 185.228.169.9 1.1.1.1 1.0.0.1 8.8.8.8 8.8.4.4 9.9.9.9 149.112.112.112 208.67.222.222 208.67.220.220 76.76.2.0 76.76.10.0 94.140.14.14 94.140.15.15}"

# Seed candidates are not trusted. They are only probed. Keep small.
readonly GITHUB_API_SEED_CANDIDATES="${DEVCONTAINER_GITHUB_API_SEED_CANDIDATES:-140.82.112.6 140.82.113.6 140.82.114.6 140.82.121.6}"

# Optional authenticated probes. Disabled by default because start hooks should
# not depend on auth state and must never leak credentials.
readonly ENABLE_GITHUB_API_AUTH_PROBE="${DEVCONTAINER_ENABLE_GITHUB_API_AUTH_PROBE:-false}"
readonly ENABLE_COPILOT_INTERNAL_AUTH_PROBE="${DEVCONTAINER_ENABLE_COPILOT_INTERNAL_AUTH_PROBE:-false}"

# Network smoke probes. These are not auth checks. 4xx can be acceptable for
# service roots; 000/TLS failure is the primary red flag.
readonly COPILOT_PROBE_ENDPOINTS="${DEVCONTAINER_COPILOT_PROBE_ENDPOINTS:-https://copilot-proxy.githubusercontent.com https://api.github.com https://api.github.com/rate_limit https://api.github.com/user https://default.exp-tas.com https://api.githubcopilot.com https://api.individual.githubcopilot.com https://proxy.individual.githubcopilot.com}"

# -----------------------------------------------------------------------------
# Logging / report helpers
# -----------------------------------------------------------------------------
ts() { date '+%Y-%m-%dT%H:%M:%S%z' 2> /dev/null || date; }
log_info() { printf '%s\n' "ℹ️  [${SCRIPT_NAME}] $*"; }
log_warn() { printf '%s\n' "⚠️  [${SCRIPT_NAME}] $*"; }
log_ok() { printf '%s\n' "✅ [${SCRIPT_NAME}] $*"; }
log_debug() {
    if [[ "${DEVCONTAINER_VERBOSE_NETWORK:-false}" == "true" ]]; then
        printf '%s\n' "🔎 [${SCRIPT_NAME}] $*"
    fi
}

write_report_header() {
    {
        printf 'script=%s\n' "${SCRIPT_NAME}"
        printf 'version=%s\n' "${SCRIPT_VERSION}"
        printf 'timestamp=%s\n' "$(ts)"
        printf 'host=%s\n' "${GITHUB_API_HOST}"
        printf 'connect_timeout=%s\n' "${GITHUB_API_ROUTE_CONNECT_TIMEOUT}"
        printf 'max_time=%s\n' "${GITHUB_API_ROUTE_MAX_TIME}"
        printf 'min_score=%s\n' "${GITHUB_API_MIN_SCORE}"
        printf '\n'
    } > "${GITHUB_ROUTE_REPORT_FILE}" 2> /dev/null || true
}
append_report() { printf '%s\n' "$*" >> "${GITHUB_ROUTE_REPORT_FILE}" 2> /dev/null || true; }

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
    printf '%s' "${line}" | tr '|' '\n' | awk -F= -v k="${key}" '$1 == k {sub($1"=", ""); print; exit}'
}

float_ms() {
    awk -v s="$1" 'BEGIN { if (s == "") s=0; printf "%d", s*1000 }' 2> /dev/null
}

trim_candidate_list() {
    local max="${1:-${GITHUB_API_MAX_CANDIDATES}}"
    awk -v max="${max}" 'NF && !seen[$0]++ { print; count++; if (count >= max) exit }'
}

# -----------------------------------------------------------------------------
# Diagnostic: LD_PRELOAD and NSS wrapper surface
# -----------------------------------------------------------------------------
check_ld_preload() {
    local val="${LD_PRELOAD:-}"
    if [[ -z "${val}" ]]; then
        log_warn "LD_PRELOAD is empty; NSS wrapper may not be active (can be normal before profile load)."
        return 1
    fi
    if [[ "${val}" == ":"* || "${val}" == *":" || "${val}" == *"::"* ]]; then
        log_warn "LD_PRELOAD contém token vazio (p.ex. '::' ou ':' nas pontas): '${val}'"
    fi
    if ((${#val} > 4096)); then
        log_warn "LD_PRELOAD length=${#val} exceeds kernel limit; truncation may occur."
    fi
    if [[ "${val}" == *"libnss_wrapper.so"* && "${val}" != */* ]]; then
        if has_cmd ldconfig && ! ldconfig -p 2> /dev/null | grep -q 'libnss_wrapper\.so'; then
            log_warn "LD_PRELOAD usa libnss_wrapper.so relativo, mas ldconfig não o localizou; pode gerar aviso ld.so."
        fi
    fi
    return 0
}

repair_nss_artifacts() {
    local current_uid current_gid current_user passwd_file group_file passwd_tmp group_tmp
    current_uid="$(id -u 2> /dev/null || echo unknown)"
    if [[ "${current_uid}" == "0" || "${current_uid}" == "unknown" ]]; then return 1; fi
    current_gid="$(id -g 2> /dev/null || echo unknown)"
    current_user="$(id -un 2> /dev/null || echo node)"
    [[ -z "${current_user}" || "${current_user}" == "unknown" ]] && current_user="node"

    passwd_file="${NSS_BASE_DIR}/passwd"
    group_file="${NSS_BASE_DIR}/group"
    passwd_tmp="${passwd_file}.tmp"
    group_tmp="${group_file}.tmp"

    mkdir -p "${NSS_BASE_DIR}" 2> /dev/null || return 1
    [[ -r /etc/passwd ]] && cat /etc/passwd > "${passwd_tmp}" 2> /dev/null || true
    [[ -r /etc/group ]] && cat /etc/group > "${group_tmp}" 2> /dev/null || true

    if [[ ! -s "${passwd_tmp}" ]]; then
        printf '%s:x:%s:%s:%s user:%s:/bin/bash\n' \
            "${current_user}" "${current_uid}" "${current_gid}" "${current_user}" "${HOME:-/home/node}" > "${passwd_tmp}" 2> /dev/null || return 1
    fi
    if [[ ! -s "${group_tmp}" ]]; then
        printf '%s:x:%s:\n' "${current_user}" "${current_gid}" > "${group_tmp}" 2> /dev/null || return 1
    fi

    mv -f "${passwd_tmp}" "${passwd_file}" 2> /dev/null || return 1
    mv -f "${group_tmp}" "${group_file}" 2> /dev/null || return 1
    chmod 600 "${passwd_file}" "${group_file}" 2> /dev/null || true
    log_info "NSS artifacts repaired in post-start: ${NSS_BASE_DIR}"
    return 0
}

audit_nss_artifacts() {
    local degraded=0 passwd_file="${NSS_BASE_DIR}/passwd" group_file="${NSS_BASE_DIR}/group"
    export DEVCONTAINER_NSS_DIR="${NSS_BASE_DIR}"

    if [[ ! -s "${passwd_file}" || ! -s "${group_file}" ]]; then repair_nss_artifacts || true; fi

    if [[ -s "${passwd_file}" ]]; then log_info "NSS artifact OK: ${passwd_file}"; else
        log_warn "NSS artifact ausente/vazio: ${passwd_file}"
        degraded=1
    fi
    if [[ -s "${group_file}" ]]; then log_info "NSS artifact OK: ${group_file}"; else
        log_warn "NSS artifact ausente/vazio: ${group_file}"
        degraded=1
    fi

    local current_user current_uid
    current_user="$(id -un 2> /dev/null || echo unknown)"
    current_uid="$(id -u 2> /dev/null || echo unknown)"
    if [[ -s "${passwd_file}" && "${current_user}" != "unknown" && "${current_uid}" != "unknown" ]]; then
        if grep -qE "^${current_user}:x:${current_uid}:" "${passwd_file}" 2> /dev/null; then
            log_info "NSS passwd coerente com usuário atual: ${current_user} (uid=${current_uid})"
        else
            log_warn "NSS passwd NÃO contém linha esperada para ${current_user} (uid=${current_uid}) — possível mismatch."
            degraded=1
        fi
    fi

    check_ld_preload || true
    return "${degraded}"
}

# -----------------------------------------------------------------------------
# DNS fix — configurable and bounded
# -----------------------------------------------------------------------------
fix_dns() {
    if [[ "${ENABLE_DNS_FIX}" != "true" ]]; then
        log_info "DNS fix desabilitado por DEVCONTAINER_ENABLE_DNS_FIX=${ENABLE_DNS_FIX}."
        return 0
    fi

    local tmp ns count=0
    tmp="$(mktemp 2> /dev/null || echo "/tmp/resolv.conf.$$")"
    : > "${tmp}" 2> /dev/null || return 1

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

    safe_sudo cp "${tmp}" /etc/resolv.conf > /dev/null 2>&1 || {
        log_warn "DNS fix: falha ao sobrescrever /etc/resolv.conf (sem sudo -n/root ou read-only?)."
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
# Smart GitHub API route selector
# -----------------------------------------------------------------------------
probe_github_api_current_route() {
    local host="${GITHUB_API_HOST}" tmp meta body http ctype tls remote time_total root_ms
    tmp="$(mktemp 2> /dev/null || echo "/tmp/github-api-current.$$")"
    meta="$(curl -4 --noproxy '*' -sS \
        --connect-timeout "${GITHUB_API_ROUTE_CONNECT_TIMEOUT}" \
        --max-time "${GITHUB_API_ROUTE_MAX_TIME}" \
        -o "${tmp}" \
        -w 'http_code=%{http_code}|content_type=%{content_type}|time_total=%{time_total}|remote_ip=%{remote_ip}|ssl_verify_result=%{ssl_verify_result}' \
        "https://${host}/" 2> /dev/null || true)"
    body="$(cat "${tmp}" 2> /dev/null || true)"
    rm -f "${tmp}" 2> /dev/null || true

    http="$(extract_field http_code "${meta}")"
    ctype="$(extract_field content_type "${meta}")"
    tls="$(extract_field ssl_verify_result "${meta}")"
    remote="$(extract_field remote_ip "${meta}")"
    time_total="$(extract_field time_total "${meta}")"
    root_ms="$(float_ms "${time_total}")"

    if [[ "${http}" == "200" && "${ctype}" == *"application/json"* && "${tls}" == "0" ]] \
        && printf '%s' "${body}" | grep -q 'current_user_url' \
        && printf '%s' "${body}" | grep -q 'https://api.github.com/user' \
        && printf '%s' "${body}" | grep -q 'rate_limit_url'; then
        printf 'ok|%s|%s|%s\n' "${remote:-unknown}" "${root_ms:-0}" "${meta}"
        return 0
    fi

    printf 'fail|%s|%s|%s\n' "${remote:-unknown}" "${root_ms:-0}" "${meta}"
    return 1
}

collect_github_api_candidates() {
    local host="${GITHUB_API_HOST}" resolver
    {
        # Existing hosts entry is a candidate, not trusted.
        awk -v h="${host}" '$0 !~ /^#/ { for (i=2; i<=NF; i++) if ($i == h) print $1 }' /etc/hosts 2> /dev/null || true

        # System resolver candidate. May be bad; scorer rejects it if unreachable.
        if has_cmd getent; then getent ahostsv4 "${host}" 2> /dev/null | awk '{print $1}' || true; fi

        # Explicit resolvers bypass resolv.conf.
        if has_cmd dig; then
            for resolver in ${GITHUB_API_RESOLVERS}; do
                dig +time=1 +tries=1 @"${resolver}" "${host}" +short A 2> /dev/null || true
            done
        else
            log_warn "GitHub API route: dig não encontrado; usando getent + seed candidates."
        fi

        # Seed candidates. Must pass semantic validation.
        local seed
        for seed in ${GITHUB_API_SEED_CANDIDATES}; do
            printf '%s\n' "${seed}"
        done
    } | while IFS= read -r ip; do
        is_ipv4 "${ip}" && printf '%s\n' "${ip}"
    done | sort -u | trim_candidate_list "${GITHUB_API_MAX_CANDIDATES}"
}

probe_github_api_candidate() {
    # Prints: ip|score|root_http|rate_http|user_http|latency_ms|remote_ip|reason
    local ip="$1" host="${GITHUB_API_HOST}"
    local tmp_root tmp_rate tmp_user root_meta rate_meta user_meta root_body rate_body user_body
    local score=0 reason=""

    tmp_root="$(mktemp 2> /dev/null || echo "/tmp/github-api-root.$$")"

    root_meta="$(curl -4 --noproxy '*' -sS \
        --connect-timeout "${GITHUB_API_ROUTE_CONNECT_TIMEOUT}" \
        --max-time "${GITHUB_API_ROUTE_MAX_TIME}" \
        --resolve "${host}:443:${ip}" \
        -o "${tmp_root}" \
        -w 'http_code=%{http_code}|content_type=%{content_type}|time_connect=%{time_connect}|time_total=%{time_total}|remote_ip=%{remote_ip}|ssl_verify_result=%{ssl_verify_result}' \
        "https://${host}/" 2> /dev/null || true)"
    log_debug "GitHub API candidate ${ip}: root_meta=${root_meta}"

    local root_http root_ctype root_time root_remote root_tls root_ms
    root_http="$(extract_field http_code "${root_meta}")"
    root_ctype="$(extract_field content_type "${root_meta}")"
    root_time="$(extract_field time_total "${root_meta}")"
    root_remote="$(extract_field remote_ip "${root_meta}")"
    root_tls="$(extract_field ssl_verify_result "${root_meta}")"
    root_ms="$(float_ms "${root_time}")"
    root_body="$(cat "${tmp_root}" 2> /dev/null || true)"
    rm -f "${tmp_root}" 2> /dev/null || true

    if [[ "${root_http}" == "200" && "${root_ctype}" == *"application/json"* && "${root_tls}" == "0" ]] \
        && printf '%s' "${root_body}" | grep -q 'current_user_url' \
        && printf '%s' "${root_body}" | grep -q 'https://api.github.com/user' \
        && printf '%s' "${root_body}" | grep -q 'rate_limit_url'; then
        score=$((score + 55))
        reason="${reason}root-api-ok;"
    else
        reason="${reason}root-api-fail(http=${root_http:-000},ctype=${root_ctype:-none},tls=${root_tls:-?});"
        printf '%s|%s|%s|%s|%s|%s|%s|%s\n' "${ip}" "0" "${root_http:-000}" "000" "000" "${root_ms:-0}" "${root_remote:-}" "${reason}"
        return 0
    fi

    tmp_rate="$(mktemp 2> /dev/null || echo "/tmp/github-api-rate.$$")"
    rate_meta="$(curl -4 --noproxy '*' -sS \
        --connect-timeout "${GITHUB_API_ROUTE_CONNECT_TIMEOUT}" \
        --max-time "${GITHUB_API_ROUTE_MAX_TIME}" \
        --resolve "${host}:443:${ip}" \
        -o "${tmp_rate}" \
        -w 'http_code=%{http_code}|content_type=%{content_type}|time_total=%{time_total}|remote_ip=%{remote_ip}|ssl_verify_result=%{ssl_verify_result}' \
        "https://${host}/rate_limit" 2> /dev/null || true)"
    local rate_http rate_ctype rate_tls
    rate_http="$(extract_field http_code "${rate_meta}")"
    rate_ctype="$(extract_field content_type "${rate_meta}")"
    rate_tls="$(extract_field ssl_verify_result "${rate_meta}")"
    rate_body="$(cat "${tmp_rate}" 2> /dev/null || true)"
    rm -f "${tmp_rate}" 2> /dev/null || true

    if [[ "${rate_http}" == "200" && "${rate_ctype}" == *"application/json"* && "${rate_tls}" == "0" ]] \
        && printf '%s' "${rate_body}" | grep -q 'resources' \
        && printf '%s' "${rate_body}" | grep -q 'rate'; then
        score=$((score + 25))
        reason="${reason}rate-limit-ok;"
    else
        reason="${reason}rate-limit-fail(http=${rate_http:-000},ctype=${rate_ctype:-none},tls=${rate_tls:-?});"
    fi

    tmp_user="$(mktemp 2> /dev/null || echo "/tmp/github-api-user.$$")"
    user_meta="$(curl -4 --noproxy '*' -sS \
        --connect-timeout "${GITHUB_API_ROUTE_CONNECT_TIMEOUT}" \
        --max-time "${GITHUB_API_ROUTE_MAX_TIME}" \
        --resolve "${host}:443:${ip}" \
        -o "${tmp_user}" \
        -w 'http_code=%{http_code}|content_type=%{content_type}|time_total=%{time_total}|remote_ip=%{remote_ip}|ssl_verify_result=%{ssl_verify_result}' \
        "https://${host}/user" 2> /dev/null || true)"
    local user_http user_ctype user_tls
    user_http="$(extract_field http_code "${user_meta}")"
    user_ctype="$(extract_field content_type "${user_meta}")"
    user_tls="$(extract_field ssl_verify_result "${user_meta}")"
    user_body="$(cat "${tmp_user}" 2> /dev/null || true)"
    rm -f "${tmp_user}" 2> /dev/null || true

    # Without auth, /user normally returns 401 JSON. With auth/proxy state, 200
    # is fine. 403 is acceptable as a shaped API proof. Redirects/plaintext are not.
    if [[ ("${user_http}" == "200" || "${user_http}" == "401" || "${user_http}" == "403") && "${user_ctype}" == *"application/json"* && "${user_tls}" == "0" ]] \
        && { printf '%s' "${user_body}" | grep -q 'message\|login\|documentation_url' || [[ "${user_http}" == "403" ]]; }; then
        score=$((score + 15))
        reason="${reason}user-endpoint-shaped-ok;"
    else
        reason="${reason}user-endpoint-fail(http=${user_http:-000},ctype=${user_ctype:-none},tls=${user_tls:-?});"
    fi

    if [[ -n "${root_ms}" ]]; then
        if ((root_ms > 0 && root_ms <= 500)); then
            score=$((score + 5))
            reason="${reason}latency<=500ms;"
        elif ((root_ms > 500 && root_ms <= 1500)); then
            score=$((score + 2))
            reason="${reason}latency<=1500ms;"
        else
            reason="${reason}latency-slow-or-missing;"
        fi
    fi

    printf '%s|%s|%s|%s|%s|%s|%s|%s\n' \
        "${ip}" "${score}" "${root_http:-000}" "${rate_http:-000}" "${user_http:-000}" "${root_ms:-0}" "${root_remote:-}" "${reason}"
}

get_github_token_best_effort() {
    if [[ -n "${GH_TOKEN:-}" ]]; then
        printf '%s' "${GH_TOKEN}"
        return 0
    fi
    if [[ -n "${GITHUB_TOKEN:-}" ]]; then
        printf '%s' "${GITHUB_TOKEN}"
        return 0
    fi
    if has_cmd gh; then gh auth token 2> /dev/null || true; fi
}

probe_github_api_auth_optional() {
    local ip="$1" host="${GITHUB_API_HOST}"
    if [[ "${ENABLE_GITHUB_API_AUTH_PROBE}" != "true" && "${ENABLE_COPILOT_INTERNAL_AUTH_PROBE}" != "true" ]]; then return 0; fi

    local token
    token="$(get_github_token_best_effort)"
    if [[ -z "${token}" ]]; then
        log_warn "GitHub API auth probe: token indisponível; probes autenticados ignorados."
        return 0
    fi

    if [[ "${ENABLE_GITHUB_API_AUTH_PROBE}" == "true" ]]; then
        local user_meta user_http user_tls
        user_meta="$(curl -4 --noproxy '*' -sS \
            --connect-timeout "${GITHUB_API_ROUTE_CONNECT_TIMEOUT}" --max-time "${GITHUB_API_ROUTE_MAX_TIME}" \
            --resolve "${host}:443:${ip}" \
            -H "Authorization: Bearer ${token}" -H 'Accept: application/vnd.github+json' \
            -o /dev/null \
            -w 'http_code=%{http_code}|ssl_verify_result=%{ssl_verify_result}' \
            "https://${host}/user" 2> /dev/null || true)"
        user_http="$(extract_field http_code "${user_meta}")"
        user_tls="$(extract_field ssl_verify_result "${user_meta}")"
        if [[ "${user_http}" == "200" && "${user_tls}" == "0" ]]; then
            log_ok "GitHub API auth probe OK: /user autenticado via ${ip} → HTTP 200."
        else
            log_warn "GitHub API auth probe não OK: /user autenticado via ${ip} → HTTP ${user_http:-000}, tls=${user_tls:-?}."
        fi
    fi

    if [[ "${ENABLE_COPILOT_INTERNAL_AUTH_PROBE}" == "true" ]]; then
        local cop_meta cop_http cop_tls
        cop_meta="$(curl -4 --noproxy '*' -sS \
            --connect-timeout "${GITHUB_API_ROUTE_CONNECT_TIMEOUT}" --max-time "${GITHUB_API_ROUTE_MAX_TIME}" \
            --resolve "${host}:443:${ip}" \
            -H "Authorization: Bearer ${token}" -H 'Accept: application/json' \
            -o /dev/null \
            -w 'http_code=%{http_code}|ssl_verify_result=%{ssl_verify_result}' \
            "https://${host}/copilot_internal/v2/token" 2> /dev/null || true)"
        cop_http="$(extract_field http_code "${cop_meta}")"
        cop_tls="$(extract_field ssl_verify_result "${cop_meta}")"
        if [[ "${cop_tls}" == "0" && ("${cop_http}" == "200" || "${cop_http}" == "401" || "${cop_http}" == "403") ]]; then
            log_ok "Copilot internal auth-shaped probe OK: /copilot_internal/v2/token via ${ip} → HTTP ${cop_http}."
        else
            log_warn "Copilot internal auth-shaped probe não OK: HTTP ${cop_http:-000}, tls=${cop_tls:-?}."
        fi
    fi
}

apply_github_api_hosts_override() {
    local best_ip="$1" host="${GITHUB_API_HOST}" tmp_hosts backup_file
    tmp_hosts="$(mktemp 2> /dev/null || echo "/tmp/hosts.github-api.$$")"
    backup_file="/tmp/hosts.pre-github-api-route-fix.$(date +%s 2> /dev/null || echo $$)"
    cp /etc/hosts "${backup_file}" 2> /dev/null || true

    awk -v h="${host}" '
        BEGIN { skip=0 }
        $0 ~ /^# >>> devcontainer-github-api-route-fix/ { skip=1; next }
        $0 ~ /^# <<< devcontainer-github-api-route-fix/ { skip=0; next }
        skip == 1 { next }
        {
          found=0
          for (i=2; i<=NF; i++) if ($i == h) found=1
          if (found == 0) print $0
        }
    ' /etc/hosts > "${tmp_hosts}" 2> /dev/null || {
        log_warn "GitHub API route: falha ao preparar novo /etc/hosts."
        rm -f "${tmp_hosts}" 2> /dev/null || true
        return 1
    }

    {
        printf '\n# >>> devcontainer-github-api-route-fix managed by %s v%s\n' "${SCRIPT_NAME}" "${SCRIPT_VERSION}"
        printf '# reason: validated semantic GitHub API route; default ISP/DNS route may be broken\n'
        printf '# generated_at: %s\n' "$(ts)"
        printf '%s %s\n' "${best_ip}" "${host}"
        printf '# <<< devcontainer-github-api-route-fix\n'
    } >> "${tmp_hosts}"

    safe_sudo cp "${tmp_hosts}" /etc/hosts > /dev/null 2>&1 || {
        log_warn "GitHub API route: falha ao aplicar /etc/hosts (sem sudo -n/root ou read-only?)."
        rm -f "${tmp_hosts}" 2> /dev/null || true
        return 1
    }

    rm -f "${tmp_hosts}" 2> /dev/null || true
    log_info "GitHub API route: backup best-effort de /etc/hosts em ${backup_file}."
    log_ok "GitHub API route aplicado: ${host} → ${best_ip}"
    return 0
}

verify_github_api_hosts_override() {
    local expected_ip="$1" host="${GITHUB_API_HOST}" resolved
    resolved="$(getent ahostsv4 "${host}" 2> /dev/null | awk 'NR==1{print $1}' || true)"
    log_info "GitHub API route verify: getent ${host} → ${resolved:-<none>}"

    local result state remote latency meta
    result="$(probe_github_api_current_route)"
    IFS='|' read -r state remote latency meta <<< "${result}"
    if [[ "${state}" == "ok" ]]; then
        log_ok "GitHub API route verify OK: ${host} → IP ${remote:-unknown} | latency=${latency:-0}ms"
        [[ -n "${expected_ip}" && "${remote}" != "${expected_ip}" ]] && log_warn "GitHub API route verify: remote_ip=${remote}, esperado=${expected_ip}; pode haver cache/proxy."
        return 0
    fi

    log_warn "GitHub API route verify FALHOU: ${host} → IP ${remote:-unknown}; meta=${meta:-none}"
    return 1
}

fix_github_api_route() {
    if [[ "${ENABLE_GITHUB_API_ROUTE_FIX}" != "true" ]]; then
        log_info "GitHub API route fix desabilitado por DEVCONTAINER_ENABLE_GITHUB_API_ROUTE_FIX=${ENABLE_GITHUB_API_ROUTE_FIX}."
        return 0
    fi
    if ! has_cmd curl; then
        log_warn "GitHub API route: curl não encontrado — ignorado."
        return 1
    fi

    write_report_header
    log_info "GitHub API route: avaliando rota atual para ${GITHUB_API_HOST}."

    local current_result current_state current_remote current_latency current_meta
    current_result="$(probe_github_api_current_route)"
    IFS='|' read -r current_state current_remote current_latency current_meta <<< "${current_result}"
    append_report "current_route_state=${current_state} current_remote=${current_remote} current_latency_ms=${current_latency} current_meta=${current_meta}"

    if [[ "${current_state}" == "ok" ]]; then
        log_ok "GitHub API route: rota atual já é funcional (${GITHUB_API_HOST} → ${current_remote}, ${current_latency}ms)."
        return 0
    fi
    log_warn "GitHub API route: rota atual NÃO funcional (${GITHUB_API_HOST} → ${current_remote:-unknown}); buscando alternativa validada."

    local candidates
    candidates="$(collect_github_api_candidates)"
    if [[ -z "${candidates}" ]]; then
        log_warn "GitHub API route: nenhum candidato coletado."
        append_report "result=no-candidates"
        return 1
    fi

    log_info "GitHub API route: candidatos coletados: $(printf '%s' "${candidates}" | tr '\n' ' ')"
    append_report "candidates=$(printf '%s' "${candidates}" | tr '\n' ' ')"

    local best_ip="" best_score=-1 best_latency=999999 best_record=""
    local record ip score root_http rate_http user_http latency_ms remote reason

    while IFS= read -r ip; do
        [[ -z "${ip}" ]] && continue
        record="$(probe_github_api_candidate "${ip}")"
        IFS='|' read -r ip score root_http rate_http user_http latency_ms remote reason <<< "${record}"

        log_info "GitHub API candidate ${ip}: score=${score}; root=${root_http}; rate=${rate_http}; user=${user_http}; latency=${latency_ms}ms; remote=${remote:-?}; ${reason}"
        append_report "candidate=${ip} score=${score} root=${root_http} rate=${rate_http} user=${user_http} latency_ms=${latency_ms} remote=${remote} reason=${reason}"

        if [[ "${score}" =~ ^[0-9]+$ ]]; then
            if ((score > best_score)) || { ((score == best_score)) && ((latency_ms > 0 && latency_ms < best_latency)); }; then
                best_score="${score}"
                best_latency="${latency_ms:-999999}"
                best_ip="${ip}"
                best_record="${record}"
            fi
        fi
    done <<< "${candidates}"

    if [[ -z "${best_ip}" || "${best_score}" -lt "${GITHUB_API_MIN_SCORE}" ]]; then
        log_warn "GitHub API route: nenhum candidato atingiu score mínimo ${GITHUB_API_MIN_SCORE}; melhor=${best_ip:-none}, score=${best_score}."
        append_report "result=no-valid-candidate best_ip=${best_ip:-none} best_score=${best_score}"
        return 1
    fi

    log_ok "GitHub API route: escolhido ${best_ip} com score=${best_score}, latency=${best_latency}ms."
    append_report "selected=${best_ip} selected_score=${best_score} selected_record=${best_record}"

    apply_github_api_hosts_override "${best_ip}" || {
        append_report "result=apply-failed selected=${best_ip}"
        return 1
    }
    verify_github_api_hosts_override "${best_ip}" || {
        append_report "result=verify-failed selected=${best_ip}"
        return 1
    }
    probe_github_api_auth_optional "${best_ip}" || true

    append_report "result=ok selected=${best_ip} score=${best_score}"
    return 0
}

# -----------------------------------------------------------------------------
# NSS DB — initialize VS Code/Chromium trust store on Linux
# -----------------------------------------------------------------------------
init_nss_db() {
    local nssdb="${HOME}/.pki/nssdb"
    if ! has_cmd certutil; then
        log_warn "NSS DB: certutil não encontrado (libnss3-tools não instalado); ignorado."
        return 1
    fi

    if [[ -d "${nssdb}" ]]; then
        if certutil -L -d "sql:${nssdb}" > /dev/null 2>&1; then
            log_info "NSS DB OK: ${nssdb}"
            return 0
        fi
        log_warn "NSS DB corrompido: ${nssdb} — removendo e recriando."
        rm -rf "${nssdb}" 2> /dev/null || true
    fi

    mkdir -p "${nssdb}" 2> /dev/null || {
        log_warn "NSS DB: falha ao criar ${nssdb}."
        return 1
    }
    certutil -d "sql:${nssdb}" -N -f /dev/null 2> /dev/null || {
        log_warn "NSS DB: certutil -N falhou (rc=$?)."
        return 1
    }
    log_info "NSS DB criado: ${nssdb}"

    local custom_dir="/usr/local/share/ca-certificates" imported=0 crt_file ca_name
    if [[ -d "${custom_dir}" ]]; then
        while IFS= read -r -d '' crt_file; do
            ca_name="$(basename "${crt_file}" .crt)"
            if certutil -A -d "sql:${nssdb}" -n "custom-${ca_name}" -t "CT,," -i "${crt_file}" 2> /dev/null; then imported=$((imported + 1)); fi
        done < <(find "${custom_dir}" -maxdepth 2 -name '*.crt' -print0 2> /dev/null)
        [[ "${imported}" -gt 0 ]] && log_info "NSS DB: ${imported} CA(s) customizado(s) importado(s)"
    fi
    return 0
}

# -----------------------------------------------------------------------------
# Connectivity probes
# -----------------------------------------------------------------------------
expected_status_ok_for_url() {
    local url="$1" code="$2"
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

probe_copilot_connectivity() {
    local failed=0
    if ! has_cmd curl; then
        log_warn "Copilot probe: curl não encontrado — ignorado."
        return 1
    fi

    local url result http_code time_connect time_total tls_ok remote_ip ctype
    for url in ${COPILOT_PROBE_ENDPOINTS}; do
        result="$(curl -4 -so /dev/null --connect-timeout 5 --max-time 10 \
            -w 'http_code=%{http_code}|content_type=%{content_type}|time_connect=%{time_connect}|time_total=%{time_total}|remote_ip=%{remote_ip}|ssl_verify_result=%{ssl_verify_result}' \
            "${url}" 2> /dev/null || true)"
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
        timeout "${MAKE_INFO_TIMEOUT_SECONDS}" make info > /dev/null 2>&1
        return $?
    fi
    make info > /dev/null 2>&1
    return $?
}

audit_ssh() {
    local ssh_key_found=false key
    for key in id_rsa id_dsa id_ecdsa id_ed25519; do
        if [[ -s "${HOME:-/home/node}/.ssh/${key}" ]]; then
            ssh_key_found=true
            log_info "SSH private key presente: ~/.ssh/${key}"
            break
        fi
    done
    if [[ "${ssh_key_found}" == "false" ]]; then
        if has_cmd ssh-add && ssh-add -L > /dev/null 2>&1; then
            log_info "Nenhuma chave em ~/.ssh, mas agente SSH encaminhado detectado."
            ssh_key_found=true
        else log_warn "Nenhuma chave SSH privada detectada e nenhum agente aparente; git/ssh pode falhar (WARN only)."; fi
    fi
    if [[ "${ENABLE_SSHD_CHECK}" != "true" ]]; then
        log_info "SSHD check skipped via DEVCONTAINER_ENABLE_SSHD_CHECK."
    else
        if has_cmd sshd; then log_info "sshd está instalado."; else log_info "sshd não encontrado; acesso inbound via SSH permanece desabilitado (estado esperado)."; fi
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
log_info "LD_PRELOAD: ${LD_PRELOAD:-<unset>}"
log_info "Route report: ${GITHUB_ROUTE_REPORT_FILE}"

status="ok"
network_status="ok"

log_info "Aplicando fix de DNS..."
fix_dns
dns_rc=$?
if [[ "${dns_rc}" -ne 0 ]]; then
    status="degraded"
    network_status="degraded"
    log_warn "Fix de DNS não aplicado — resolução de nomes pode falhar."
fi

log_info "Aplicando fix inteligente de rota para ${GITHUB_API_HOST}..."
fix_github_api_route
github_api_route_rc=$?
if [[ "${github_api_route_rc}" -ne 0 ]]; then
    status="degraded"
    network_status="degraded"
    log_warn "Fix inteligente de rota para ${GITHUB_API_HOST} não aplicado — Copilot pode falhar se a rota DNS padrão estiver ruim."
fi

run_make_info
make_rc=$?
if [[ "${make_rc}" -ne 0 ]]; then
    status="degraded"
    log_warn "make info falhou (rc=${make_rc}, timeout=${MAKE_INFO_TIMEOUT_SECONDS}s)."
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
probe_copilot_connectivity
probe_rc=$?
if [[ "${probe_rc}" -ne 0 ]]; then
    network_status="degraded"
    log_warn "Um ou mais endpoints relevantes não responderam como esperado. Veja ${GITHUB_ROUTE_REPORT_FILE} e logs acima."
else
    log_ok "Todos os probes de rede relevantes responderam."
fi

audit_ssh || true

if [[ -x "${SCRIPT_DIR}/sync-local-auth.sh" ]]; then
    "${SCRIPT_DIR}/sync-local-auth.sh" || log_warn "sync-local-auth.sh falhou (WARN only)."
fi

printf '%s\n' "${status}" > "${HEALTH_STATUS_FILE}" 2> /dev/null || true
printf '%s\n' "${network_status}" > "${NETWORK_STATUS_FILE}" 2> /dev/null || true
log_info "health.status=${status} (${HEALTH_STATUS_FILE})"
log_info "network.status=${network_status} (${NETWORK_STATUS_FILE})"

exit 0
