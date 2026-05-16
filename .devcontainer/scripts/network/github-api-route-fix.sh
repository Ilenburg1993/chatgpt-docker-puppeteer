#!/usr/bin/env bash
# =============================================================================
# github-api-route-fix.sh — Smart GitHub API Route Selector
# Version: v1.3.0
#
# Contract:
# - Intended to be called by .devcontainer/scripts/post-start.sh v2.3.x.
# - Does not start services.
# - Does not mutate Docker/DevContainer structure.
# - Performs only bounded, reversible runtime-network mutation:
#     * managed /etc/hosts block for api.github.com, after semantic validation.
# - Exits 0 only when the current route is valid, a proxy route is valid, or a
#   validated direct route was applied.
# - Exits non-zero when it cannot prove a functional GitHub API route.
#
# Design:
# - Treat DNS answers, cache entries, /etc/hosts entries and seed IPs as
#   untrusted candidates.
# - Validate candidates by HTTPS/SNI/TLS plus semantic API checks.
# - Prefer stable current route; switch only when current is broken or materially
#   worse according to score/latency hysteresis.
# - Preserve Docker-managed /etc/hosts inode by writing content through tee,
#   never by replacing the file with cp/mv.
# - Force LC_ALL=C for curl write-out parsing stability.
# - Use flock where available for cache and hosts writes.
# - Probe candidates in parallel by default, bounded by curl timeouts.
# =============================================================================

set +e
set +u
set +o pipefail 2> /dev/null || true
trap - ERR EXIT INT TERM 2> /dev/null || true

# -----------------------------------------------------------------------------
# Constants / config
# -----------------------------------------------------------------------------
readonly SCRIPT_NAME="github-api-route-fix.sh"
readonly SCRIPT_VERSION="1.3.0"

readonly GITHUB_API_HOST="${DEVCONTAINER_GITHUB_API_HOST:-api.github.com}"
readonly GITHUB_ROUTE_REPORT_FILE="${DEVCONTAINER_GITHUB_ROUTE_REPORT_FILE:-/tmp/devcontainer-github-api-route.report}"

readonly CONNECT_TIMEOUT="${DEVCONTAINER_GITHUB_API_ROUTE_CONNECT_TIMEOUT:-3}"
readonly MAX_TIME="${DEVCONTAINER_GITHUB_API_ROUTE_MAX_TIME:-7}"
readonly MIN_SCORE="${DEVCONTAINER_GITHUB_API_MIN_SCORE:-85}"
readonly MAX_CANDIDATES="${DEVCONTAINER_GITHUB_API_MAX_CANDIDATES:-16}"

readonly RESOLVERS="${DEVCONTAINER_GITHUB_API_RESOLVERS:-185.228.168.9 185.228.169.9 1.1.1.1 1.0.0.1 8.8.8.8 8.8.4.4 9.9.9.9 149.112.112.112 208.67.222.222 208.67.220.220 76.76.2.0 76.76.10.0 94.140.14.14 94.140.15.15}"
readonly SEED_CANDIDATES="${DEVCONTAINER_GITHUB_API_SEED_CANDIDATES:-140.82.112.6 140.82.113.6 140.82.114.6 140.82.121.6}"

readonly ENABLE_AUTH_PROBE="${DEVCONTAINER_ENABLE_GITHUB_API_AUTH_PROBE:-false}"
readonly ENABLE_COPILOT_INTERNAL_AUTH_PROBE="${DEVCONTAINER_ENABLE_COPILOT_INTERNAL_AUTH_PROBE:-false}"

readonly CACHE_ENABLED="${DEVCONTAINER_GITHUB_API_ROUTE_CACHE_ENABLED:-true}"
readonly CACHE_FILE="${DEVCONTAINER_GITHUB_API_ROUTE_CACHE_FILE:-${XDG_CACHE_HOME:-${HOME:-/tmp}/.cache}/devcontainer/network/github-api-route.cache.tsv}"
readonly CACHE_MAX_AGE_SECONDS="${DEVCONTAINER_GITHUB_API_ROUTE_CACHE_MAX_AGE_SECONDS:-604800}"
readonly CACHE_LOCK_FILE="${DEVCONTAINER_GITHUB_API_ROUTE_CACHE_LOCK_FILE:-${CACHE_FILE}.lock}"

readonly HYSTERESIS_SCORE_MARGIN="${DEVCONTAINER_GITHUB_API_HYSTERESIS_SCORE_MARGIN:-8}"
readonly HYSTERESIS_LATENCY_RATIO_PERCENT="${DEVCONTAINER_GITHUB_API_HYSTERESIS_LATENCY_RATIO_PERCENT:-75}"
readonly OPTIMIZE_WHEN_CURRENT_OK="${DEVCONTAINER_GITHUB_API_OPTIMIZE_WHEN_CURRENT_OK:-true}"
readonly FORCE_RESELECT="${DEVCONTAINER_GITHUB_API_FORCE_RESELECT:-false}"

# auto: if a proxy is configured and works for api.github.com, do not touch hosts.
# direct: ignore proxies and run direct route selection.
# respect: if proxy exists, only test proxy-aware route and never apply hosts.
readonly PROXY_MODE="${DEVCONTAINER_GITHUB_API_ROUTE_PROXY_MODE:-auto}"

# IPv6 is opt-in for now. The current observed incident is IPv4-specific and the
# caller already runs IPv4 probes. If enabled, AAAA/getent IPv6 candidates are
# also considered and written to /etc/hosts when they win.
readonly ENABLE_IPV6="${DEVCONTAINER_GITHUB_API_ENABLE_IPV6:-false}"

# Candidate probing is parallel by default. With small MAX_CANDIDATES this keeps
# start hooks responsive under dropped-packet timeouts.
readonly PARALLEL_PROBES="${DEVCONTAINER_GITHUB_API_PARALLEL_PROBES:-true}"
readonly PROBE_TMP_DIR="${DEVCONTAINER_GITHUB_API_PROBE_TMP_DIR:-/tmp}"

# Optional TLS preflight. Curl already validates TLS; keep this off by default
# to avoid false negatives in minimal images or unusual OpenSSL behavior.
readonly OPENSSL_PREFLIGHT="${DEVCONTAINER_GITHUB_API_OPENSSL_PREFLIGHT:-false}"
readonly OPENSSL_PREFLIGHT_TIMEOUT="${DEVCONTAINER_GITHUB_API_OPENSSL_PREFLIGHT_TIMEOUT:-2}"

readonly HOSTS_LOCK_FILE="${DEVCONTAINER_GITHUB_API_HOSTS_LOCK_FILE:-/tmp/devcontainer-github-api-route.hosts.lock}"

# -----------------------------------------------------------------------------
# Logging / reporting
# -----------------------------------------------------------------------------
ts() { date '+%Y-%m-%dT%H:%M:%S%z' 2> /dev/null || date; }
now_epoch() { date '+%s' 2> /dev/null || printf '0'; }

log_info() { printf '%s\n' "ℹ️  [${SCRIPT_NAME}] $*"; }
log_warn() { printf '%s\n' "⚠️  [${SCRIPT_NAME}] $*"; }
log_ok() { printf '%s\n' "✅ [${SCRIPT_NAME}] $*"; }
log_debug() {
    if [[ "${DEVCONTAINER_VERBOSE_NETWORK:-false}" == "true" ]]; then
        printf '%s\n' "🔎 [${SCRIPT_NAME}] $*" >&2
    fi
}

write_report_header() {
    {
        printf 'script=%s\n' "${SCRIPT_NAME}"
        printf 'version=%s\n' "${SCRIPT_VERSION}"
        printf 'timestamp=%s\n' "$(ts)"
        printf 'host=%s\n' "${GITHUB_API_HOST}"
        printf 'connect_timeout=%s\n' "${CONNECT_TIMEOUT}"
        printf 'max_time=%s\n' "${MAX_TIME}"
        printf 'min_score=%s\n' "${MIN_SCORE}"
        printf 'max_candidates=%s\n' "${MAX_CANDIDATES}"
        printf 'cache_enabled=%s\n' "${CACHE_ENABLED}"
        printf 'cache_file=%s\n' "${CACHE_FILE}"
        printf 'parallel_probes=%s\n' "${PARALLEL_PROBES}"
        printf 'proxy_mode=%s\n' "${PROXY_MODE}"
        printf 'enable_ipv6=%s\n' "${ENABLE_IPV6}"
        printf 'optimize_when_current_ok=%s\n' "${OPTIMIZE_WHEN_CURRENT_OK}"
        printf '\n'
    } > "${GITHUB_ROUTE_REPORT_FILE}" 2> /dev/null || true
}

append_report() { printf '%s\n' "$*" >> "${GITHUB_ROUTE_REPORT_FILE}" 2> /dev/null || true; }

# -----------------------------------------------------------------------------
# Generic helpers
# -----------------------------------------------------------------------------
has_cmd() { command -v "$1" > /dev/null 2>&1; }

is_nonnegative_int() { [[ "$1" =~ ^[0-9]+$ ]]; }

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

is_ipv6() {
    [[ "$1" == *:* ]] || return 1
    if has_cmd python3; then
        python3 - "$1" << 'PY' > /dev/null 2>&1
import ipaddress, sys
try:
    ipaddress.IPv6Address(sys.argv[1])
except Exception:
    sys.exit(1)
PY
        return $?
    fi
    # Conservative fallback: only accept common IPv6 character set with colon.
    [[ "$1" =~ ^[0-9A-Fa-f:]+$ ]]
}

is_ip_candidate() {
    if is_ipv4 "$1"; then return 0; fi
    [[ "${ENABLE_IPV6}" == "true" ]] && is_ipv6 "$1"
}

ip_family() {
    if is_ipv4 "$1"; then
        printf '4'
        return 0
    fi
    if is_ipv6 "$1"; then
        printf '6'
        return 0
    fi
    printf 'unknown'
}

curl_ip_flag() {
    case "$(ip_family "$1")" in
        4) printf -- '-4' ;;
        6) printf -- '-6' ;;
        *) printf '' ;;
    esac
}

curl_resolve_value() {
    local host="$1" ip="$2"
    if is_ipv6 "${ip}"; then
        printf '%s:443:[%s]' "${host}" "${ip}"
    else
        printf '%s:443:%s' "${host}" "${ip}"
    fi
}

safe_sudo() {
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
    local key="$1" line="$2"
    printf '%s' "${line}" | tr '|' '\n' | awk -F= -v k="${key}" '$1 == k {sub($1"=", ""); print; exit}'
}

float_ms() {
    # curl write-out can be locale-sensitive in some builds. Normalize defensively.
    local value="$1"
    value="${value/,/.}"
    LC_ALL=C awk -v s="${value}" 'BEGIN { if (s == "") s=0; printf "%d", s*1000 }' 2> /dev/null
}

unique_ordered_trim() {
    local max="${1:-${MAX_CANDIDATES}}"
    awk -v max="${max}" 'NF && !seen[$0]++ { print; count++; if (count >= max) exit }'
}

split_words_to_lines() {
    local value="$1" item
    local -a items=()
    read -r -a items <<< "${value}"
    for item in "${items[@]}"; do
        [[ -n "${item}" ]] && printf '%s\n' "${item}"
    done
}

has_proxy_env() {
    [[ -n "${HTTPS_PROXY:-}${https_proxy:-}${HTTP_PROXY:-}${http_proxy:-}${ALL_PROXY:-}${all_proxy:-}" ]]
}

# -----------------------------------------------------------------------------
# Curl helpers
# -----------------------------------------------------------------------------
curl_current_route() {
    # args: output_file url mode family_hint
    # mode: direct|proxy-aware
    local output_file="$1" url="$2" mode="$3" family_hint="${4:-4}"
    local -a args=()
    if [[ "${family_hint}" == "4" ]]; then args+=("-4"); fi
    if [[ "${family_hint}" == "6" ]]; then args+=("-6"); fi
    if [[ "${mode}" == "direct" ]]; then args+=(--noproxy '*'); fi

    LC_ALL=C curl "${args[@]}" -sS \
        --connect-timeout "${CONNECT_TIMEOUT}" \
        --max-time "${MAX_TIME}" \
        -o "${output_file}" \
        -w 'http_code=%{http_code}|content_type=%{content_type}|time_total=%{time_total}|remote_ip=%{remote_ip}|ssl_verify_result=%{ssl_verify_result}' \
        "${url}" 2> /dev/null || true
}

curl_candidate_route() {
    # args: output_file path ip
    local output_file="$1" path="$2" ip="$3"
    local flag resolve_value
    local -a args=()

    flag="$(curl_ip_flag "${ip}")"
    [[ -n "${flag}" ]] && args+=("${flag}")
    args+=(--noproxy '*')

    resolve_value="$(curl_resolve_value "${GITHUB_API_HOST}" "${ip}")"

    LC_ALL=C curl "${args[@]}" -sS \
        --connect-timeout "${CONNECT_TIMEOUT}" \
        --max-time "${MAX_TIME}" \
        --resolve "${resolve_value}" \
        -o "${output_file}" \
        -w 'http_code=%{http_code}|content_type=%{content_type}|time_connect=%{time_connect}|time_total=%{time_total}|remote_ip=%{remote_ip}|ssl_verify_result=%{ssl_verify_result}' \
        "https://${GITHUB_API_HOST}${path}" 2> /dev/null || true
}

# -----------------------------------------------------------------------------
# Cache helpers
# TSV columns:
# ip success_count failure_count last_success_epoch last_failure_epoch
# last_score last_latency_ms selected_count last_selected_epoch
# -----------------------------------------------------------------------------
ensure_cache_file_locked_body() {
    [[ "${CACHE_ENABLED}" == "true" ]] || return 1
    local dir
    dir="$(dirname "${CACHE_FILE}" 2> /dev/null || printf '/tmp')"
    mkdir -p "${dir}" 2> /dev/null || return 1
    [[ -f "${CACHE_FILE}" ]] || : > "${CACHE_FILE}" 2> /dev/null || return 1
    return 0
}

ensure_cache_file() {
    if [[ "${CACHE_ENABLED}" != "true" ]]; then
        return 1
    fi

    local lock_dir
    lock_dir="$(dirname "${CACHE_LOCK_FILE}" 2> /dev/null || printf '/tmp')"
    mkdir -p "${lock_dir}" 2> /dev/null || true

    if has_cmd flock; then
        (
            flock -x 9 || exit 98
            ensure_cache_file_locked_body
        ) 9> "${CACHE_LOCK_FILE}"
        return $?
    fi

    ensure_cache_file_locked_body
}

cache_candidates() {
    [[ "${CACHE_ENABLED}" == "true" ]] || return 0
    ensure_cache_file || return 0

    local now max_age
    now="$(now_epoch)"
    max_age="${CACHE_MAX_AGE_SECONDS}"

    if has_cmd flock; then
        (
            flock -s 9 || exit 0
            awk -v now="${now}" -v max_age="${max_age}" -v enable_ipv6="${ENABLE_IPV6}" '
                BEGIN { FS="\t" }
                {
                    ip=$1; last_success=$4+0;
                    ipv4=(ip ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/);
                    ipv6=(ip ~ /:/);
                    if ((ipv4 || (enable_ipv6 == "true" && ipv6)) && last_success > 0 && (now - last_success) <= max_age) print ip;
                }' "${CACHE_FILE}" 2> /dev/null
        ) 9> "${CACHE_LOCK_FILE}"
    else
        awk -v now="${now}" -v max_age="${max_age}" -v enable_ipv6="${ENABLE_IPV6}" '
            BEGIN { FS="\t" }
            {
                ip=$1; last_success=$4+0;
                ipv4=(ip ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/);
                ipv6=(ip ~ /:/);
                if ((ipv4 || (enable_ipv6 == "true" && ipv6)) && last_success > 0 && (now - last_success) <= max_age) print ip;
            }' "${CACHE_FILE}" 2> /dev/null
    fi
}

cache_history_bonus() {
    local ip="$1"
    [[ "${CACHE_ENABLED}" == "true" ]] || {
        printf '0'
        return 0
    }
    ensure_cache_file || {
        printf '0'
        return 0
    }

    local now
    now="$(now_epoch)"

    awk -v ip="${ip}" -v now="${now}" '
        BEGIN { FS="\t"; bonus=0 }
        $1 == ip {
            success=$2+0; failure=$3+0; last_success=$4+0; last_failure=$5+0; selected=$8+0;
            age_success=(last_success > 0 ? now-last_success : 999999999);
            age_failure=(last_failure > 0 ? now-last_failure : 999999999);

            if (success >= 5) bonus += 5;
            else if (success >= 3) bonus += 3;
            else if (success >= 1) bonus += 1;

            if (selected >= 3) bonus += 3;
            else if (selected >= 1) bonus += 1;

            if (age_success < 3600) bonus += 4;
            else if (age_success < 86400) bonus += 2;
            else if (age_success < 604800) bonus += 1;

            if (age_failure < 300) bonus -= 25;
            else if (age_failure < 3600) bonus -= 15;
            else if (age_failure < 21600) bonus -= 10;
            else if (age_failure < 86400) bonus -= 5;
            else if (age_failure < 604800) bonus -= 2;

            if (failure > success && failure >= 2) bonus -= 8;
            print bonus;
            found=1;
            exit;
        }
        END { if (!found) print 0 }' "${CACHE_FILE}" 2> /dev/null
}

cache_update_locked_body() {
    local ip="$1" ok="$2" score="$3" latency="$4" selected="$5"
    ensure_cache_file_unlocked || return 0

    local now tmp
    now="$(now_epoch)"
    tmp="$(mktemp 2> /dev/null || echo "/tmp/github-api-cache.$$.$RANDOM")"

    if awk -v ip="${ip}" -v ok="${ok}" -v score="${score}" -v latency="${latency}" -v selected="${selected}" -v now="${now}" '
        BEGIN { FS=OFS="\t"; found=0 }
        $1 == ip {
            found=1;
            success=$2+0; failure=$3+0; last_success=$4+0; last_failure=$5+0;
            selected_count=$8+0; last_selected=$9+0;
            if (ok == "true") { success++; last_success=now } else { failure++; last_failure=now }
            if (selected == "true") { selected_count++; last_selected=now }
            print ip, success, failure, last_success, last_failure, score, latency, selected_count, last_selected;
            next;
        }
        { print }
        END {
            if (!found) {
                success=0; failure=0; last_success=0; last_failure=0; selected_count=0; last_selected=0;
                if (ok == "true") { success=1; last_success=now } else { failure=1; last_failure=now }
                if (selected == "true") { selected_count=1; last_selected=now }
                print ip, success, failure, last_success, last_failure, score, latency, selected_count, last_selected;
            }
        }' "${CACHE_FILE}" > "${tmp}" 2> /dev/null; then
        mv -f "${tmp}" "${CACHE_FILE}" 2> /dev/null || rm -f "${tmp}" 2> /dev/null || true
    else
        rm -f "${tmp}" 2> /dev/null || true
    fi
}

cache_update() {
    [[ "${CACHE_ENABLED}" == "true" ]] || return 0

    local lock_dir
    lock_dir="$(dirname "${CACHE_LOCK_FILE}" 2> /dev/null || printf '/tmp')"
    mkdir -p "${lock_dir}" 2> /dev/null || true

    if has_cmd flock; then
        (
            flock -x 9 || exit 0
            cache_update_locked_body "$@"
        ) 9> "${CACHE_LOCK_FILE}"
        return $?
    fi

    cache_update_locked_body "$@"
}

# -----------------------------------------------------------------------------
# Proxy-aware short-circuit
# -----------------------------------------------------------------------------
probe_proxy_route_if_configured() {
    has_proxy_env || return 1
    [[ "${PROXY_MODE}" == "auto" || "${PROXY_MODE}" == "respect" ]] || return 1

    local tmp meta body http ctype tls remote time_total latency_ms
    tmp="$(mktemp 2> /dev/null || echo "/tmp/github-api-proxy.$$")"
    meta="$(curl_current_route "${tmp}" "https://${GITHUB_API_HOST}/" "proxy-aware" "auto")"
    body="$(cat "${tmp}" 2> /dev/null || true)"
    rm -f "${tmp}" 2> /dev/null || true

    http="$(extract_field http_code "${meta}")"
    ctype="$(extract_field content_type "${meta}")"
    tls="$(extract_field ssl_verify_result "${meta}")"
    remote="$(extract_field remote_ip "${meta}")"
    time_total="$(extract_field time_total "${meta}")"
    latency_ms="$(float_ms "${time_total}")"

    append_report "proxy_route_probe http=${http:-000} ctype=${ctype:-none} tls=${tls:-?} remote=${remote:-unknown} latency_ms=${latency_ms} meta=${meta}"

    if [[ "${http}" == "200" && "${ctype}" == *"application/json"* && "${tls}" == "0" ]] \
        && printf '%s' "${body}" | grep -q 'current_user_url' \
        && printf '%s' "${body}" | grep -q 'https://api.github.com/user' \
        && printf '%s' "${body}" | grep -q 'rate_limit_url'; then
        log_ok "proxy-aware route funcional para ${GITHUB_API_HOST} → remote=${remote:-unknown}, latency=${latency_ms}ms; não alterando /etc/hosts."
        append_report "result=proxy-route-ok remote=${remote:-unknown} latency_ms=${latency_ms}"
        return 0
    fi

    if [[ "${PROXY_MODE}" == "respect" ]]; then
        log_warn "proxy configurado, mas rota via proxy não validou; PROXY_MODE=respect impede alteração de /etc/hosts."
        append_report "result=proxy-route-failed-respect-mode"
        return 1
    fi

    log_warn "proxy detectado, mas rota via proxy não validou; PROXY_MODE=auto seguirá com seleção direta."
    return 1
}

# -----------------------------------------------------------------------------
# GitHub API semantic probes
# -----------------------------------------------------------------------------
probe_github_api_current_route() {
    # Prints: state|remote_ip|latency_ms|score|meta
    local tmp meta body http ctype tls remote time_total latency_ms score=0
    tmp="$(mktemp 2> /dev/null || echo "/tmp/github-api-current.$$")"

    local family_hint="4"
    [[ "${ENABLE_IPV6}" == "true" ]] && family_hint="auto"
    meta="$(curl_current_route "${tmp}" "https://${GITHUB_API_HOST}/" "direct" "${family_hint}")"
    body="$(cat "${tmp}" 2> /dev/null || true)"
    rm -f "${tmp}" 2> /dev/null || true

    http="$(extract_field http_code "${meta}")"
    ctype="$(extract_field content_type "${meta}")"
    tls="$(extract_field ssl_verify_result "${meta}")"
    remote="$(extract_field remote_ip "${meta}")"
    time_total="$(extract_field time_total "${meta}")"
    latency_ms="$(float_ms "${time_total}")"

    if [[ "${http}" == "200" && "${ctype}" == *"application/json"* && "${tls}" == "0" ]] \
        && printf '%s' "${body}" | grep -q 'current_user_url' \
        && printf '%s' "${body}" | grep -q 'https://api.github.com/user' \
        && printf '%s' "${body}" | grep -q 'rate_limit_url'; then
        score=80
        if ((latency_ms > 0 && latency_ms <= 500)); then score=$((score + 5)); fi
        printf 'ok|%s|%s|%s|%s\n' "${remote:-unknown}" "${latency_ms:-0}" "${score}" "${meta}"
        return 0
    fi

    printf 'fail|%s|%s|0|%s\n' "${remote:-unknown}" "${latency_ms:-0}" "${meta}"
    return 1
}

openssl_preflight_ok() {
    local ip="$1" host="${GITHUB_API_HOST}"
    [[ "${OPENSSL_PREFLIGHT}" == "true" ]] || return 0
    has_cmd openssl || return 0
    has_cmd timeout || return 0

    local connect_target="${ip}:443"
    if is_ipv6 "${ip}"; then connect_target="[${ip}]:443"; fi

    timeout "${OPENSSL_PREFLIGHT_TIMEOUT}" openssl s_client \
        -servername "${host}" \
        -connect "${connect_target}" \
        -verify_return_error \
        < /dev/null > /dev/null 2>&1
}

probe_github_api_candidate() {
    # Prints: ip|score|root_http|rate_http|user_http|latency_ms|remote_ip|reason
    local ip="$1"
    local tmp_root tmp_rate tmp_user root_meta rate_meta user_meta root_body rate_body user_body
    local score=0 reason=""

    if ! openssl_preflight_ok "${ip}"; then
        reason="${reason}openssl-preflight-fail;"
        printf '%s|%s|%s|%s|%s|%s|%s|%s\n' "${ip}" "0" "000" "000" "000" "0" "" "${reason}"
        return 0
    fi

    tmp_root="$(mktemp 2> /dev/null || echo "/tmp/github-api-root.$$.$RANDOM")"
    root_meta="$(curl_candidate_route "${tmp_root}" "/" "${ip}")"
    log_debug "candidate=${ip} root_meta=${root_meta}"

    local root_http root_ctype root_time root_remote root_tls root_ms history_bonus
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

    tmp_rate="$(mktemp 2> /dev/null || echo "/tmp/github-api-rate.$$.$RANDOM")"
    rate_meta="$(curl_candidate_route "${tmp_rate}" "/rate_limit" "${ip}")"

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

    tmp_user="$(mktemp 2> /dev/null || echo "/tmp/github-api-user.$$.$RANDOM")"
    user_meta="$(curl_candidate_route "${tmp_user}" "/user" "${ip}")"

    local user_http user_ctype user_tls
    user_http="$(extract_field http_code "${user_meta}")"
    user_ctype="$(extract_field content_type "${user_meta}")"
    user_tls="$(extract_field ssl_verify_result "${user_meta}")"
    user_body="$(cat "${tmp_user}" 2> /dev/null || true)"
    rm -f "${tmp_user}" 2> /dev/null || true

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

    history_bonus="$(cache_history_bonus "${ip}")"
    if [[ "${history_bonus}" =~ ^-?[0-9]+$ && "${history_bonus}" != "0" ]]; then
        score=$((score + history_bonus))
        reason="${reason}history=${history_bonus};"
    fi

    if ((score < 0)); then score=0; fi

    printf '%s|%s|%s|%s|%s|%s|%s|%s\n' \
        "${ip}" "${score}" "${root_http:-000}" "${rate_http:-000}" "${user_http:-000}" "${root_ms:-0}" "${root_remote:-}" "${reason}"
}

# -----------------------------------------------------------------------------
# Candidate discovery
# -----------------------------------------------------------------------------
collect_github_api_candidates() {
    local host="${GITHUB_API_HOST}" resolver
    local -a resolvers=()
    read -r -a resolvers <<< "${RESOLVERS}"

    {
        cache_candidates || true

        awk -v h="${host}" '$0 !~ /^#/ { for (i=2; i<=NF; i++) if ($i == h) print $1 }' /etc/hosts 2> /dev/null || true

        if has_cmd getent; then
            if [[ "${ENABLE_IPV6}" == "true" ]]; then
                getent ahosts "${host}" 2> /dev/null | awk '{print $1}' || true
            else
                getent ahostsv4 "${host}" 2> /dev/null | awk '{print $1}' || true
            fi
        fi

        if has_cmd dig; then
            for resolver in "${resolvers[@]}"; do
                is_ip_candidate "${resolver}" || continue
                dig +time=1 +tries=1 @"${resolver}" "${host}" +short A 2> /dev/null || true
                if [[ "${ENABLE_IPV6}" == "true" ]]; then
                    dig +time=1 +tries=1 @"${resolver}" "${host}" +short AAAA 2> /dev/null || true
                fi
            done
        else
            log_warn "dig não encontrado; usando cache/getent/seeds."
        fi

        split_words_to_lines "${SEED_CANDIDATES}"
    } | while IFS= read -r ip; do
        is_ip_candidate "${ip}" && printf '%s\n' "${ip}"
    done | unique_ordered_trim "${MAX_CANDIDATES}"
}

# -----------------------------------------------------------------------------
# Optional auth-shaped probes
# -----------------------------------------------------------------------------
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

    if [[ "${ENABLE_AUTH_PROBE}" != "true" && "${ENABLE_COPILOT_INTERNAL_AUTH_PROBE}" != "true" ]]; then return 0; fi

    local token resolve_value flag
    token="$(get_github_token_best_effort)"
    if [[ -z "${token}" ]]; then
        log_warn "auth probe: token indisponível; probes autenticados ignorados."
        return 0
    fi

    resolve_value="$(curl_resolve_value "${host}" "${ip}")"
    flag="$(curl_ip_flag "${ip}")"

    if [[ "${ENABLE_AUTH_PROBE}" == "true" ]]; then
        local user_meta user_http user_tls
        local -a curl_args=()
        [[ -n "${flag}" ]] && curl_args+=("${flag}")
        curl_args+=(--noproxy '*')
        user_meta="$(LC_ALL=C curl "${curl_args[@]}" -sS \
            --connect-timeout "${CONNECT_TIMEOUT}" \
            --max-time "${MAX_TIME}" \
            --resolve "${resolve_value}" \
            -H "Authorization: Bearer ${token}" \
            -H 'Accept: application/vnd.github+json' \
            -o /dev/null \
            -w 'http_code=%{http_code}|ssl_verify_result=%{ssl_verify_result}' \
            "https://${host}/user" 2> /dev/null || true)"
        user_http="$(extract_field http_code "${user_meta}")"
        user_tls="$(extract_field ssl_verify_result "${user_meta}")"
        if [[ "${user_http}" == "200" && "${user_tls}" == "0" ]]; then
            log_ok "auth probe OK: /user autenticado via ${ip} → HTTP 200."
        else
            log_warn "auth probe não OK: /user autenticado via ${ip} → HTTP ${user_http:-000}, tls=${user_tls:-?}."
        fi
    fi

    if [[ "${ENABLE_COPILOT_INTERNAL_AUTH_PROBE}" == "true" ]]; then
        local cop_meta cop_http cop_tls
        local -a curl_args=()
        [[ -n "${flag}" ]] && curl_args+=("${flag}")
        curl_args+=(--noproxy '*')
        cop_meta="$(LC_ALL=C curl "${curl_args[@]}" -sS \
            --connect-timeout "${CONNECT_TIMEOUT}" \
            --max-time "${MAX_TIME}" \
            --resolve "${resolve_value}" \
            -H "Authorization: Bearer ${token}" \
            -H 'Accept: application/json' \
            -o /dev/null \
            -w 'http_code=%{http_code}|ssl_verify_result=%{ssl_verify_result}' \
            "https://${host}/copilot_internal/v2/token" 2> /dev/null || true)"
        cop_http="$(extract_field http_code "${cop_meta}")"
        cop_tls="$(extract_field ssl_verify_result "${cop_meta}")"
        if [[ "${cop_tls}" == "0" && ("${cop_http}" == "200" || "${cop_http}" == "401" || "${cop_http}" == "403") ]]; then
            log_ok "copilot_internal shaped probe OK: /copilot_internal/v2/token via ${ip} → HTTP ${cop_http}."
        else
            log_warn "copilot_internal shaped probe não OK: HTTP ${cop_http:-000}, tls=${cop_tls:-?}."
        fi
    fi
}

# -----------------------------------------------------------------------------
# /etc/hosts apply / verify
# -----------------------------------------------------------------------------
apply_hosts_locked_body() {
    local best_ip="$1" host="${GITHUB_API_HOST}"
    local tmp_hosts backup_file
    tmp_hosts="$(mktemp 2> /dev/null || echo "/tmp/hosts.github-api.$$.$RANDOM")"
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
        log_warn "falha ao preparar novo conteúdo de /etc/hosts."
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

    # Important for Docker/DevContainers: /etc/hosts is usually a Docker-managed
    # mounted file. Replacing it with cp/mv may fail with EBUSY or break inode
    # semantics. tee rewrites the content while preserving the mounted file.
    if ! safe_sudo tee /etc/hosts < "${tmp_hosts}" > /dev/null 2>&1; then
        log_warn "falha ao aplicar /etc/hosts via tee (sem sudo -n/root ou read-only?)."
        rm -f "${tmp_hosts}" 2> /dev/null || true
        return 1
    fi

    rm -f "${tmp_hosts}" 2> /dev/null || true
    log_info "backup best-effort de /etc/hosts em ${backup_file}."
    log_ok "override aplicado: ${host} → ${best_ip}"
    return 0
}

apply_github_api_hosts_override() {
    local best_ip="$1"
    local lock_dir
    lock_dir="$(dirname "${HOSTS_LOCK_FILE}" 2> /dev/null || printf '/tmp')"
    mkdir -p "${lock_dir}" 2> /dev/null || true

    if has_cmd flock; then
        (
            flock -x 9 || exit 98
            apply_hosts_locked_body "${best_ip}"
        ) 9> "${HOSTS_LOCK_FILE}"
        return $?
    fi

    apply_hosts_locked_body "${best_ip}"
}

verify_github_api_hosts_override() {
    local expected_ip="$1" host="${GITHUB_API_HOST}" resolved result state remote latency score meta
    if [[ "${ENABLE_IPV6}" == "true" ]]; then
        resolved="$(getent ahosts "${host}" 2> /dev/null | awk 'NR==1{print $1}' || true)"
    else
        resolved="$(getent ahostsv4 "${host}" 2> /dev/null | awk 'NR==1{print $1}' || true)"
    fi
    log_info "verify: getent ${host} → ${resolved:-<none>}"

    result="$(probe_github_api_current_route)"
    IFS='|' read -r state remote latency score meta <<< "${result}"

    if [[ "${state}" == "ok" ]]; then
        log_ok "verify OK: ${host} → IP ${remote:-unknown} | latency=${latency:-0}ms | score=${score:-0}"
        if [[ -n "${expected_ip}" && "${remote}" != "${expected_ip}" ]]; then
            log_warn "verify: remote_ip=${remote}, esperado=${expected_ip}; pode haver cache/proxy."
        fi
        return 0
    fi

    log_warn "verify FALHOU: ${host} → IP ${remote:-unknown}; meta=${meta:-none}"
    return 1
}

# -----------------------------------------------------------------------------
# Selection / hysteresis
# -----------------------------------------------------------------------------
should_switch_from_current() {
    local current_ip="$1" current_score="$2" current_latency="$3" best_ip="$4" best_score="$5" best_latency="$6"

    [[ "${FORCE_RESELECT}" == "true" ]] && return 0
    [[ -z "${current_ip}" || "${current_ip}" == "unknown" ]] && return 0
    [[ "${current_ip}" == "${best_ip}" ]] && return 1

    is_nonnegative_int "${current_score}" || current_score=0
    is_nonnegative_int "${current_latency}" || current_latency=0
    is_nonnegative_int "${best_score}" || best_score=0
    is_nonnegative_int "${best_latency}" || best_latency=999999

    if ((current_score < MIN_SCORE)); then return 0; fi
    if ((best_score >= current_score + HYSTERESIS_SCORE_MARGIN)); then return 0; fi

    if ((best_score >= current_score && current_latency > 0 && best_latency > 0)); then
        local threshold=$((current_latency * HYSTERESIS_LATENCY_RATIO_PERCENT / 100))
        if ((best_latency < threshold)); then return 0; fi
    fi

    return 1
}

probe_candidates_parallel() {
    local candidates="$1"
    local tmp_dir pid ip tmp_file
    local -a pids=() files=() ips=()

    tmp_dir="$(mktemp -d "${PROBE_TMP_DIR%/}/github-api-probes.XXXXXX" 2> /dev/null || mktemp -d 2> /dev/null)"
    if [[ -z "${tmp_dir}" || ! -d "${tmp_dir}" ]]; then
        return 1
    fi

    while IFS= read -r ip; do
        [[ -z "${ip}" ]] && continue
        tmp_file="${tmp_dir}/probe.$(printf '%s' "${ip}" | tr ':.' '__').out"
        probe_github_api_candidate "${ip}" > "${tmp_file}" 2> "${tmp_file}.err" &
        pid=$!
        pids+=("${pid}")
        files+=("${tmp_file}")
        ips+=("${ip}")
    done <<< "${candidates}"

    for pid in "${pids[@]}"; do
        wait "${pid}" 2> /dev/null || true
    done

    local index=0
    while ((index < ${#files[@]})); do
        if [[ -s "${files[index]}" ]]; then
            cat "${files[index]}"
        else
            printf '%s|0|000|000|000|0||probe-no-output;\n' "${ips[index]}"
        fi
        index=$((index + 1))
    done

    rm -rf "${tmp_dir}" 2> /dev/null || true
    return 0
}

probe_candidates_sequential() {
    local candidates="$1" ip
    while IFS= read -r ip; do
        [[ -z "${ip}" ]] && continue
        probe_github_api_candidate "${ip}"
    done <<< "${candidates}"
}

update_cache_from_record() {
    local record="$1" selected_ip="$2" ip score root_http rate_http user_http latency_ms remote reason ok selected
    IFS='|' read -r ip score root_http rate_http user_http latency_ms remote reason <<< "${record}"
    ok="false"
    selected="false"
    if is_nonnegative_int "${score}" && ((score >= MIN_SCORE)); then ok="true"; fi
    if [[ -n "${selected_ip}" && "${ip}" == "${selected_ip}" ]]; then selected="true"; fi
    cache_update "${ip}" "${ok}" "${score:-0}" "${latency_ms:-0}" "${selected}"
}

select_and_apply_route() {
    write_report_header

    if ! has_cmd curl; then
        log_warn "curl não encontrado; não é possível validar rota."
        append_report "result=no-curl"
        return 1
    fi

    ensure_cache_file || true

    if has_proxy_env && [[ "${PROXY_MODE}" != "direct" ]]; then
        if probe_proxy_route_if_configured; then
            return 0
        fi
        if [[ "${PROXY_MODE}" == "respect" ]]; then
            return 1
        fi
    fi

    log_info "avaliando rota direta atual para ${GITHUB_API_HOST}."
    local current_result current_state current_remote current_latency current_score current_meta
    current_result="$(probe_github_api_current_route)"
    IFS='|' read -r current_state current_remote current_latency current_score current_meta <<< "${current_result}"
    append_report "current_route_state=${current_state} current_remote=${current_remote} current_latency_ms=${current_latency} current_score=${current_score} current_meta=${current_meta}"

    if [[ "${current_state}" == "ok" && "${OPTIMIZE_WHEN_CURRENT_OK}" != "true" ]]; then
        log_ok "rota atual já é funcional (${GITHUB_API_HOST} → ${current_remote}, ${current_latency}ms); otimização desabilitada."
        append_report "result=current-ok-no-optimization selected=${current_remote} score=${current_score}"
        return 0
    fi

    if [[ "${current_state}" == "ok" ]]; then
        log_ok "rota atual funcional (${GITHUB_API_HOST} → ${current_remote}, ${current_latency}ms); avaliando alternativas com histerese."
    else
        log_warn "rota atual NÃO funcional (${GITHUB_API_HOST} → ${current_remote:-unknown}); buscando alternativa validada."
    fi

    local candidates
    candidates="$(collect_github_api_candidates)"
    if [[ -z "${candidates}" ]]; then
        log_warn "nenhum candidato coletado."
        append_report "result=no-candidates"
        return 1
    fi

    log_info "candidatos coletados: $(printf '%s' "${candidates}" | tr '\n' ' ')"
    append_report "candidates=$(printf '%s' "${candidates}" | tr '\n' ' ')"

    local effective_min_score="${MIN_SCORE}"
    if ! is_nonnegative_int "${effective_min_score}"; then
        log_warn "MIN_SCORE inválido (${MIN_SCORE}); usando 85."
        effective_min_score=85
    fi

    local all_records=""
    if [[ "${PARALLEL_PROBES}" == "true" ]]; then
        all_records="$(probe_candidates_parallel "${candidates}")"
        if [[ -z "${all_records}" ]]; then
            log_warn "probes paralelos não produziram resultado; usando fallback sequencial."
            all_records="$(probe_candidates_sequential "${candidates}")"
        fi
    else
        all_records="$(probe_candidates_sequential "${candidates}")"
    fi

    local best_ip="" best_score=-1 best_latency=999999 best_record=""
    local current_full_score="" current_full_latency=""
    local record ip score root_http rate_http user_http latency_ms remote reason

    while IFS= read -r record; do
        [[ -z "${record}" ]] && continue
        IFS='|' read -r ip score root_http rate_http user_http latency_ms remote reason <<< "${record}"

        log_info "candidate ${ip}: score=${score}; root=${root_http}; rate=${rate_http}; user=${user_http}; latency=${latency_ms}ms; remote=${remote:-?}; ${reason}"
        append_report "candidate=${ip} score=${score} root=${root_http} rate=${rate_http} user=${user_http} latency_ms=${latency_ms} remote=${remote} reason=${reason}"

        if [[ "${current_state}" == "ok" && "${ip}" == "${current_remote}" ]]; then
            current_full_score="${score}"
            current_full_latency="${latency_ms}"
        fi

        if is_nonnegative_int "${score}"; then
            if ((score > best_score)) || { ((score == best_score)) && ((latency_ms > 0 && latency_ms < best_latency)); }; then
                best_score="${score}"
                best_latency="${latency_ms:-999999}"
                best_ip="${ip}"
                best_record="${record}"
            fi
        fi
    done <<< "${all_records}"

    if [[ -z "${best_ip}" || "${best_score}" -lt "${effective_min_score}" ]]; then
        log_warn "nenhum candidato atingiu score mínimo ${effective_min_score}; melhor=${best_ip:-none}, score=${best_score}."
        append_report "result=no-valid-candidate best_ip=${best_ip:-none} best_score=${best_score} min_score=${effective_min_score}"
        while IFS= read -r record; do
            [[ -n "${record}" ]] && update_cache_from_record "${record}" ""
        done <<< "${all_records}"
        return 1
    fi

    if [[ "${current_state}" == "ok" ]]; then
        if is_nonnegative_int "${current_full_score:-}"; then current_score="${current_full_score}"; fi
        if is_nonnegative_int "${current_full_latency:-}"; then current_latency="${current_full_latency}"; fi

        if should_switch_from_current "${current_remote}" "${current_score}" "${current_latency}" "${best_ip}" "${best_score}" "${best_latency}"; then
            log_info "histerese permitiu troca: atual=${current_remote}/${current_score}/${current_latency}ms → novo=${best_ip}/${best_score}/${best_latency}ms."
        else
            log_ok "mantendo rota atual por estabilidade: atual=${current_remote}/${current_score}/${current_latency}ms; melhor=${best_ip}/${best_score}/${best_latency}ms."
            append_report "result=current-kept current=${current_remote} current_score=${current_score} best_ip=${best_ip} best_score=${best_score}"
            while IFS= read -r record; do
                [[ -n "${record}" ]] && update_cache_from_record "${record}" "${current_remote}"
            done <<< "${all_records}"
            return 0
        fi
    fi

    log_ok "escolhido ${best_ip} com score=${best_score}, latency=${best_latency}ms."
    append_report "selected=${best_ip} selected_score=${best_score} selected_record=${best_record}"

    apply_github_api_hosts_override "${best_ip}" || {
        append_report "result=apply-failed selected=${best_ip}"
        while IFS= read -r record; do
            [[ -n "${record}" ]] && update_cache_from_record "${record}" ""
        done <<< "${all_records}"
        return 1
    }

    verify_github_api_hosts_override "${best_ip}" || {
        append_report "result=verify-failed selected=${best_ip}"
        while IFS= read -r record; do
            [[ -n "${record}" ]] && update_cache_from_record "${record}" ""
        done <<< "${all_records}"
        return 1
    }

    while IFS= read -r record; do
        [[ -n "${record}" ]] && update_cache_from_record "${record}" "${best_ip}"
    done <<< "${all_records}"

    probe_github_api_auth_optional "${best_ip}" || true
    append_report "result=ok selected=${best_ip} score=${best_score}"
    return 0
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
    log_info "Smart GitHub API route fix iniciado (v${SCRIPT_VERSION})."
    log_info "host=${GITHUB_API_HOST}; report=${GITHUB_ROUTE_REPORT_FILE}; cache=${CACHE_FILE}; proxy_mode=${PROXY_MODE}; ipv6=${ENABLE_IPV6}; parallel=${PARALLEL_PROBES}"

    select_and_apply_route
    local rc=$?

    if [[ "${rc}" -eq 0 ]]; then
        log_ok "Smart GitHub API route fix concluído com sucesso."
    else
        log_warn "Smart GitHub API route fix não conseguiu provar/aplicar rota funcional (rc=${rc})."
    fi

    return "${rc}"
}

main "$@"
exit $?
