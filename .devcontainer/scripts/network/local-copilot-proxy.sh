#!/usr/bin/env bash
# =============================================================================
# local-copilot-proxy.sh — Optional Local HTTP CONNECT Proxy Manager
# Version: v1.1.0
#
# Purpose:
#   Manage an optional loopback-only HTTP CONNECT proxy for GitHub/Copilot
#   diagnostics and future opt-in VS Code/Copilot proxy flows inside a
#   DevContainer.
#
# Contract:
#   - Runtime-only helper; does not mutate Docker/DevContainer structure.
#   - Does not change the parent process environment; writes env/profile hints.
#   - Starts only a loopback-bound local proxy by default; never public-facing.
#   - Uses tinyproxy when available.
#   - Returns 0 for optional/off/auto-skip states, non-zero when local mode
#     explicitly requires a working proxy but it cannot be proven.
#   - No application services are started.
#
# Security model:
#   - Default bind address is 127.0.0.1.
#   - Non-loopback bind is refused unless explicitly enabled by
#     DEVCONTAINER_LOCAL_COPILOT_PROXY_ALLOW_NON_LOOPBACK=true.
#   - CONNECT is restricted to configured ports, default 443.
#   - No TLS interception, no certificate injection, no credential capture.
# =============================================================================

set +e
set +u
set +o pipefail 2> /dev/null || true
trap - ERR EXIT INT TERM 2> /dev/null || true

# -----------------------------------------------------------------------------
# Config helpers
# -----------------------------------------------------------------------------
cfg_bool() {
    case "${1:-}" in
        true | TRUE | 1 | yes | YES | on | ON) printf 'true' ;;
        false | FALSE | 0 | no | NO | off | OFF) printf 'false' ;;
        *) printf '%s' "${2:-false}" ;;
    esac
}

cfg_uint() {
    local value fallback min max
    value="${1:-}"
    fallback="${2:-0}"
    min="${3:-0}"
    max="${4:-}"

    if [[ ! "${value}" =~ ^[0-9]+$ ]]; then
        value="${fallback}"
    fi
    if ((value < min)); then
        value="${fallback}"
    fi
    if [[ -n "${max}" && "${max}" =~ ^[0-9]+$ && "${value}" =~ ^[0-9]+$ && value -gt max ]]; then
        value="${max}"
    fi

    printf '%s' "${value}"
}

cfg_word_list_ports() {
    local raw item port out
    raw="${1:-443}"
    out=""

    for item in ${raw}; do
        port="$(cfg_uint "${item}" 0 1 65535)"
        if [[ "${port}" != "0" ]]; then
            if [[ -z "${out}" ]]; then
                out="${port}"
            else
                out="${out} ${port}"
            fi
        fi
    done

    if [[ -z "${out}" ]]; then
        out="443"
    fi

    printf '%s' "${out}"
}

# -----------------------------------------------------------------------------
# Constants / sanitized config
# -----------------------------------------------------------------------------
SCRIPT_NAME="local-copilot-proxy.sh"
readonly SCRIPT_NAME
SCRIPT_VERSION="1.1.0"
readonly SCRIPT_VERSION

ACTION="${DEVCONTAINER_LOCAL_COPILOT_PROXY_ACTION:-start}"
case "${ACTION}" in
    start | stop | status | restart | probe | env) : ;;
    *) ACTION="start" ;;
esac
readonly ACTION

PROXY_MODE="${DEVCONTAINER_COPILOT_PROXY_MODE:-local}"
case "${PROXY_MODE}" in
    off | disabled | false | none) PROXY_MODE="off" ;;
    local | auto) : ;;
    *) PROXY_MODE="local" ;;
esac
readonly PROXY_MODE

PROXY_HOST_RAW="${DEVCONTAINER_LOCAL_COPILOT_PROXY_HOST:-127.0.0.1}"
readonly PROXY_HOST_RAW
case "${PROXY_HOST_RAW}" in
    localhost) PROXY_HOST="127.0.0.1" ;;
    *) PROXY_HOST="${PROXY_HOST_RAW}" ;;
esac
readonly PROXY_HOST

PROXY_PORT="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_PORT:-3128}" 3128 1024 65535)"
readonly PROXY_PORT

if [[ "${PROXY_HOST}" == *:* ]]; then
    PROXY_URL="http://[${PROXY_HOST}]:${PROXY_PORT}"
else
    PROXY_URL="http://${PROXY_HOST}:${PROXY_PORT}"
fi
readonly PROXY_URL

RUNTIME_DIR="${DEVCONTAINER_LOCAL_COPILOT_PROXY_RUNTIME_DIR:-/tmp/devcontainer-network}"
readonly RUNTIME_DIR
TINYPROXY_CONF="${DEVCONTAINER_LOCAL_COPILOT_PROXY_CONF:-${RUNTIME_DIR}/tinyproxy-copilot.conf}"
readonly TINYPROXY_CONF
TINYPROXY_PID_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_PID_FILE:-${RUNTIME_DIR}/tinyproxy-copilot.pid}"
readonly TINYPROXY_PID_FILE
TINYPROXY_LOG_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_LOG_FILE:-${RUNTIME_DIR}/tinyproxy-copilot.log}"
readonly TINYPROXY_LOG_FILE
LOCK_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_LOCK_FILE:-${RUNTIME_DIR}/tinyproxy-copilot.lock}"
readonly LOCK_FILE

ENV_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_ENV_FILE:-/tmp/devcontainer-copilot-proxy.env}"
readonly ENV_FILE
VSCODE_SETTINGS_HINT_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_VSCODE_HINT_FILE:-/tmp/devcontainer-copilot-proxy.vscode-settings.json}"
readonly VSCODE_SETTINGS_HINT_FILE
REPORT_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_REPORT_FILE:-/tmp/devcontainer-copilot-proxy.report}"
readonly REPORT_FILE
STATUS_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_STATUS_FILE:-/tmp/devcontainer-copilot-proxy.status}"
readonly STATUS_FILE
METRICS_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_METRICS_FILE:-/tmp/devcontainer-copilot-proxy.metrics.tsv}"
readonly METRICS_FILE

PROBE_URL="${DEVCONTAINER_LOCAL_COPILOT_PROXY_PROBE_URL:-https://api.github.com/}"
readonly PROBE_URL
CONNECT_TIMEOUT="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_CONNECT_TIMEOUT:-4}" 4 1 60)"
readonly CONNECT_TIMEOUT
MAX_TIME="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_MAX_TIME:-12}" 12 2 180)"
readonly MAX_TIME
START_WAIT_SECONDS="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_START_WAIT_SECONDS:-3}" 3 1 30)"
readonly START_WAIT_SECONDS

APPLY_PROFILE="$(cfg_bool "${DEVCONTAINER_LOCAL_COPILOT_PROXY_APPLY_PROFILE:-false}" false)"
readonly APPLY_PROFILE
REMOVE_PROFILE_ON_STOP="$(cfg_bool "${DEVCONTAINER_LOCAL_COPILOT_PROXY_REMOVE_PROFILE_ON_STOP:-false}" false)"
readonly REMOVE_PROFILE_ON_STOP
PROFILE_FILE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_PROFILE_FILE:-/etc/profile.d/99-devcontainer-copilot-proxy.sh}"
readonly PROFILE_FILE
NO_PROXY_VALUE="${DEVCONTAINER_LOCAL_COPILOT_PROXY_NO_PROXY:-localhost,127.0.0.1,::1,host.docker.internal}"
readonly NO_PROXY_VALUE

ALLOW_NON_LOOPBACK="$(cfg_bool "${DEVCONTAINER_LOCAL_COPILOT_PROXY_ALLOW_NON_LOOPBACK:-false}" false)"
readonly ALLOW_NON_LOOPBACK
CONNECT_PORTS="$(cfg_word_list_ports "${DEVCONTAINER_LOCAL_COPILOT_PROXY_CONNECT_PORTS:-443}")"
readonly CONNECT_PORTS

TINYPROXY_TIMEOUT_SECONDS="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_TIMEOUT_SECONDS:-600}" 600 10 7200)"
readonly TINYPROXY_TIMEOUT_SECONDS
TINYPROXY_MAX_CLIENTS="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_MAX_CLIENTS:-64}" 64 1 1024)"
readonly TINYPROXY_MAX_CLIENTS
TINYPROXY_START_SERVERS="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_START_SERVERS:-1}" 1 1 64)"
readonly TINYPROXY_START_SERVERS
TINYPROXY_MIN_SPARE="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_MIN_SPARE:-1}" 1 1 64)"
readonly TINYPROXY_MIN_SPARE
TINYPROXY_MAX_SPARE="$(cfg_uint "${DEVCONTAINER_LOCAL_COPILOT_PROXY_MAX_SPARE:-4}" 4 1 128)"
readonly TINYPROXY_MAX_SPARE
TINYPROXY_LOG_LEVEL="${DEVCONTAINER_LOCAL_COPILOT_PROXY_LOG_LEVEL:-Connect}"
case "${TINYPROXY_LOG_LEVEL}" in
    Critical | Error | Warning | Notice | Connect | Info) : ;;
    critical) TINYPROXY_LOG_LEVEL="Critical" ;;
    error) TINYPROXY_LOG_LEVEL="Error" ;;
    warning) TINYPROXY_LOG_LEVEL="Warning" ;;
    notice) TINYPROXY_LOG_LEVEL="Notice" ;;
    connect) TINYPROXY_LOG_LEVEL="Connect" ;;
    info) TINYPROXY_LOG_LEVEL="Info" ;;
    *) TINYPROXY_LOG_LEVEL="Connect" ;;
esac
readonly TINYPROXY_LOG_LEVEL

DISABLE_VIA_HEADER="$(cfg_bool "${DEVCONTAINER_LOCAL_COPILOT_PROXY_DISABLE_VIA_HEADER:-false}" false)"
readonly DISABLE_VIA_HEADER

# -----------------------------------------------------------------------------
# Logging/report helpers
# -----------------------------------------------------------------------------
ts() { date '+%Y-%m-%dT%H:%M:%S%z' 2> /dev/null || date; }
log_info() { printf '%s\n' "ℹ️  [${SCRIPT_NAME}] $*"; }
log_warn() { printf '%s\n' "⚠️  [${SCRIPT_NAME}] $*"; }
log_ok() { printf '%s\n' "✅ [${SCRIPT_NAME}] $*"; }
log_debug() {
    if [[ "${DEVCONTAINER_VERBOSE_NETWORK:-false}" == "true" ]]; then
        printf '%s\n' "🔎 [${SCRIPT_NAME}] $*" >&2
    fi
}

ensure_parent_dir() {
    local path dir
    path="${1:-/tmp/unknown}"
    dir="$(dirname "${path}" 2> /dev/null || printf '/tmp')"
    mkdir -p "${dir}" 2> /dev/null || true
}

write_status() {
    local value
    value="${1:-unknown}"
    ensure_parent_dir "${STATUS_FILE}"
    printf '%s\n' "${value}" > "${STATUS_FILE}" 2> /dev/null || true
}

append_report() {
    ensure_parent_dir "${REPORT_FILE}"
    printf '%s\n' "$*" >> "${REPORT_FILE}" 2> /dev/null || true
}

write_report_header() {
    ensure_parent_dir "${REPORT_FILE}"
    {
        printf 'script=%s\n' "${SCRIPT_NAME}"
        printf 'version=%s\n' "${SCRIPT_VERSION}"
        printf 'timestamp=%s\n' "$(ts)"
        printf 'action=%s\n' "${ACTION}"
        printf 'proxy_mode=%s\n' "${PROXY_MODE}"
        printf 'proxy_host=%s\n' "${PROXY_HOST}"
        printf 'proxy_port=%s\n' "${PROXY_PORT}"
        printf 'proxy_url=%s\n' "${PROXY_URL}"
        printf 'probe_url=%s\n' "${PROBE_URL}"
        printf 'apply_profile=%s\n' "${APPLY_PROFILE}"
        printf 'allow_non_loopback=%s\n' "${ALLOW_NON_LOOPBACK}"
        printf 'connect_ports=%s\n' "${CONNECT_PORTS}"
        printf 'runtime_dir=%s\n' "${RUNTIME_DIR}"
        printf 'tinyproxy_conf=%s\n' "${TINYPROXY_CONF}"
        printf 'pid_file=%s\n' "${TINYPROXY_PID_FILE}"
        printf 'log_file=%s\n' "${TINYPROXY_LOG_FILE}"
        printf '\n'
    } > "${REPORT_FILE}" 2> /dev/null || true
}

write_metrics_header() {
    ensure_parent_dir "${METRICS_FILE}"
    printf 'timestamp\tproxy_url\tprobe_url\thttp_code\tremote_ip\tdns_ms\ttcp_ms\ttls_ms\tttfb_ms\ttotal_ms\ttls_verify\tresult\n' > "${METRICS_FILE}" 2> /dev/null || true
}

append_metric() {
    ensure_parent_dir "${METRICS_FILE}"
    printf '%s\n' "$*" >> "${METRICS_FILE}" 2> /dev/null || true
}

# -----------------------------------------------------------------------------
# Generic helpers
# -----------------------------------------------------------------------------
has_cmd() { command -v "$1" > /dev/null 2>&1; }

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

make_temp_file() {
    local prefix dir tmp
    prefix="${1:-tmp}"
    dir="${2:-/tmp}"
    tmp=""

    mkdir -p "${dir}" 2> /dev/null || dir="/tmp"
    tmp="$(mktemp "${dir%/}/${prefix}.XXXXXX" 2> /dev/null || true)"
    if [[ -n "${tmp}" ]]; then
        printf '%s\n' "${tmp}"
        return 0
    fi

    mktemp "/tmp/${prefix}.XXXXXX" 2> /dev/null || true
}

extract_field() {
    local key line
    key="$1"
    line="$2"
    printf '%s' "${line}" | tr '|' '\n' | awk -F= -v k="${key}" '$1 == k {sub($1"=", ""); print; exit}'
}

float_ms() {
    local value
    value="${1:-0}"
    value="${value/,/.}"
    LC_ALL=C awk -v s="${value}" 'BEGIN { if (s == "") s=0; printf "%d", s*1000 }' 2> /dev/null
}

is_loopback_host() {
    case "${1:-}" in
        127.* | localhost | ::1) return 0 ;;
        *) return 1 ;;
    esac
}

is_probably_our_tinyproxy_process() {
    local pid exe cmdline
    pid="${1:-}"
    [[ "${pid}" =~ ^[0-9]+$ ]] || return 1

    if [[ -r "/proc/${pid}/comm" ]]; then
        exe="$(cat "/proc/${pid}/comm" 2> /dev/null || true)"
        case "${exe}" in
            tinyproxy) return 0 ;;
        esac
    fi

    if [[ -r "/proc/${pid}/cmdline" ]]; then
        cmdline="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2> /dev/null || true)"
        [[ "${cmdline}" == *tinyproxy* && "${cmdline}" == *"${TINYPROXY_CONF}"* ]] && return 0
    fi

    return 1
}

pid_is_alive() {
    local pid
    pid="${1:-}"
    [[ "${pid}" =~ ^[0-9]+$ ]] || return 1
    kill -0 "${pid}" 2> /dev/null
}

read_proxy_pid() {
    if [[ -s "${TINYPROXY_PID_FILE}" ]]; then
        awk 'NR==1{print $1}' "${TINYPROXY_PID_FILE}" 2> /dev/null
    fi
}

proxy_is_running() {
    local pid
    pid="$(read_proxy_pid)"
    if pid_is_alive "${pid}" && is_probably_our_tinyproxy_process "${pid}"; then
        return 0
    fi

    if has_cmd pgrep; then
        pgrep -f "tinyproxy.*${TINYPROXY_CONF}" > /dev/null 2>&1
        return $?
    fi

    return 1
}

port_in_use() {
    if has_cmd ss; then
        ss -H -ltn 2> /dev/null | awk -v port=":${PROXY_PORT}" '$4 ~ port"$" {found=1} END {exit found ? 0 : 1}'
        return $?
    fi

    if has_cmd netstat; then
        netstat -ltn 2> /dev/null | awk -v port=":${PROXY_PORT}" '$4 ~ port"$" {found=1} END {exit found ? 0 : 1}'
        return $?
    fi

    return 1
}

prepare_runtime_dir() {
    mkdir -p "${RUNTIME_DIR}" 2> /dev/null || return 1
    touch "${TINYPROXY_LOG_FILE}" 2> /dev/null || true
    chmod 0755 "${RUNTIME_DIR}" 2> /dev/null || true
    chmod 0644 "${TINYPROXY_LOG_FILE}" 2> /dev/null || true
    return 0
}

detect_root_drop_identity() {
    # Prints "user:group" when running as root and a safe drop identity exists;
    # prints nothing for non-root or when no known identity exists.
    local user group

    if [[ "$(id -u 2> /dev/null || echo 1)" != "0" ]]; then
        return 0
    fi

    if getent passwd tinyproxy > /dev/null 2>&1 && getent group tinyproxy > /dev/null 2>&1; then
        user="tinyproxy"
        group="tinyproxy"
    elif getent passwd nobody > /dev/null 2>&1; then
        user="nobody"
        if getent group nogroup > /dev/null 2>&1; then
            group="nogroup"
        else
            group="nobody"
        fi
    else
        return 0
    fi

    printf '%s:%s\n' "${user}" "${group}"
}

# -----------------------------------------------------------------------------
# tinyproxy lifecycle
# -----------------------------------------------------------------------------
write_tinyproxy_config() {
    local tmp identity drop_user drop_group port disable_via

    prepare_runtime_dir || return 1
    tmp="$(make_temp_file tinyproxy.conf "${RUNTIME_DIR}")"
    [[ -n "${tmp}" ]] || return 1

    identity="$(detect_root_drop_identity)"
    drop_user=""
    drop_group=""
    if [[ "${identity}" == *:* ]]; then
        drop_user="${identity%%:*}"
        drop_group="${identity#*:}"
        chown "${drop_user}:${drop_group}" "${RUNTIME_DIR}" "${TINYPROXY_LOG_FILE}" 2> /dev/null || true
    fi

    if [[ "${DISABLE_VIA_HEADER}" == "true" ]]; then
        disable_via="Yes"
    else
        disable_via="No"
    fi

    {
        printf '# Generated by %s v%s at %s\n' "${SCRIPT_NAME}" "${SCRIPT_VERSION}" "$(ts)"
        printf '# Loopback-only local proxy for DevContainer GitHub/Copilot diagnostics.\n'
        if [[ -n "${drop_user}" && -n "${drop_group}" ]]; then
            printf 'User %s\n' "${drop_user}"
            printf 'Group %s\n' "${drop_group}"
        fi
        printf 'Port %s\n' "${PROXY_PORT}"
        printf 'Listen %s\n' "${PROXY_HOST}"
        printf 'Timeout %s\n' "${TINYPROXY_TIMEOUT_SECONDS}"
        printf 'LogFile "%s"\n' "${TINYPROXY_LOG_FILE}"
        printf 'LogLevel %s\n' "${TINYPROXY_LOG_LEVEL}"
        printf 'PidFile "%s"\n' "${TINYPROXY_PID_FILE}"
        printf 'MaxClients %s\n' "${TINYPROXY_MAX_CLIENTS}"
        printf 'StartServers %s\n' "${TINYPROXY_START_SERVERS}"
        printf 'MinSpareServers %s\n' "${TINYPROXY_MIN_SPARE}"
        printf 'MaxSpareServers %s\n' "${TINYPROXY_MAX_SPARE}"
        printf 'MaxRequestsPerChild 0\n'
        printf 'Allow 127.0.0.1\n'
        printf 'Allow ::1\n'
        printf 'ViaProxyName "devcontainer-copilot-proxy"\n'
        printf 'DisableViaHeader %s\n' "${disable_via}"
        for port in ${CONNECT_PORTS}; do
            printf 'ConnectPort %s\n' "${port}"
        done
    } > "${tmp}" 2> /dev/null || {
        rm -f "${tmp}" 2> /dev/null || true
        return 1
    }

    mv -f "${tmp}" "${TINYPROXY_CONF}" 2> /dev/null || {
        rm -f "${tmp}" 2> /dev/null || true
        return 1
    }
    chmod 0644 "${TINYPROXY_CONF}" 2> /dev/null || true
    if [[ -n "${drop_user}" && -n "${drop_group}" ]]; then
        chown "${drop_user}:${drop_group}" "${TINYPROXY_CONF}" 2> /dev/null || true
    fi
    append_report "tinyproxy_conf=${TINYPROXY_CONF}"
    append_report "tinyproxy_identity=${identity:-current-user}"
    return 0
}

preflight_safety() {
    if [[ "${PROXY_MODE}" == "off" ]]; then
        return 0
    fi

    if ! is_loopback_host "${PROXY_HOST}" && [[ "${ALLOW_NON_LOOPBACK}" != "true" ]]; then
        log_warn "bind recusado: ${PROXY_HOST}. Use somente loopback ou DEVCONTAINER_LOCAL_COPILOT_PROXY_ALLOW_NON_LOOPBACK=true."
        append_report "result=unsafe-bind host=${PROXY_HOST}"
        write_status "degraded"
        return 1
    fi

    return 0
}

start_proxy() {
    local pid start_epoch now elapsed

    preflight_safety || return 1

    if [[ "${PROXY_MODE}" == "off" ]]; then
        log_info "proxy local Copilot desligado por DEVCONTAINER_COPILOT_PROXY_MODE=off."
        write_status "off"
        append_report "result=off"
        return 0
    fi

    if ! has_cmd tinyproxy; then
        if [[ "${PROXY_MODE}" == "auto" ]]; then
            log_info "tinyproxy não encontrado; modo auto ignora proxy local."
            append_report "result=auto-no-tinyproxy"
            write_status "off"
            return 0
        fi
        log_warn "tinyproxy não encontrado. Instale tinyproxy no Dockerfile para usar proxy local."
        append_report "result=no-tinyproxy"
        write_status "degraded"
        return 1
    fi

    if proxy_is_running; then
        log_info "tinyproxy já está em execução em ${PROXY_URL}."
        write_status "ok"
        append_report "tinyproxy=already-running"
        return 0
    fi

    if port_in_use; then
        log_warn "porta ${PROXY_PORT} já está em uso e não parece pertencer ao tinyproxy gerenciado."
        append_report "result=port-conflict port=${PROXY_PORT}"
        write_status "conflict"
        return 1
    fi

    write_tinyproxy_config || {
        log_warn "falha ao gerar configuração do tinyproxy."
        append_report "result=config-failed"
        write_status "degraded"
        return 1
    }

    rm -f "${TINYPROXY_PID_FILE}" 2> /dev/null || true
    tinyproxy -d -c "${TINYPROXY_CONF}" > /dev/null 2>> "${TINYPROXY_LOG_FILE}" &
    pid="$!"
    printf '%s\n' "${pid}" > "${TINYPROXY_PID_FILE}" 2> /dev/null || true

    start_epoch="$(date '+%s' 2> /dev/null || printf '0')"
    while true; do
        if proxy_is_running; then
            log_ok "tinyproxy ativo em ${PROXY_URL}."
            write_status "starting"
            append_report "tinyproxy=running pid=$(read_proxy_pid)"
            return 0
        fi

        now="$(date '+%s' 2> /dev/null || printf '0')"
        elapsed=$((now - start_epoch))
        if ((elapsed >= START_WAIT_SECONDS)); then
            break
        fi
        sleep 0.2
    done

    log_warn "tinyproxy não ficou ativo. Veja ${TINYPROXY_LOG_FILE}."
    append_report "tinyproxy=not-running log=${TINYPROXY_LOG_FILE}"
    write_status "degraded"
    return 1
}

stop_proxy() {
    local pid attempt

    pid="$(read_proxy_pid)"
    if pid_is_alive "${pid}" && is_probably_our_tinyproxy_process "${pid}"; then
        kill "${pid}" 2> /dev/null || safe_sudo kill "${pid}" 2> /dev/null || true
        attempt=0
        while pid_is_alive "${pid}" && ((attempt < 10)); do
            sleep 0.2
            attempt=$((attempt + 1))
        done
        if pid_is_alive "${pid}"; then
            kill -TERM "${pid}" 2> /dev/null || true
        fi
    fi

    rm -f "${TINYPROXY_PID_FILE}" 2> /dev/null || true
    log_info "tinyproxy stop solicitado."
    append_report "result=stopped"

    if [[ "${REMOVE_PROFILE_ON_STOP}" == "true" ]]; then
        safe_sudo rm -f "${PROFILE_FILE}" 2> /dev/null || true
        append_report "profile_removed=${PROFILE_FILE}"
    fi

    write_status "stopped"
    return 0
}

# -----------------------------------------------------------------------------
# Probe / hints
# -----------------------------------------------------------------------------
expected_http_ok() {
    local url code
    url="${1:-}"
    code="${2:-000}"

    case "${url}" in
        https://api.github.com/ | https://api.github.com)
            [[ "${code}" == "200" ]]
            return $?
            ;;
        https://api.github.com/user*)
            [[ "${code}" == "200" || "${code}" == "401" || "${code}" == "403" ]]
            return $?
            ;;
        *)
            [[ -n "${code}" && "${code}" != "000" ]]
            return $?
            ;;
    esac
}

probe_proxy() {
    local result http_code remote_ip total tls_verify dns_time tcp_time tls_time ttfb_time
    local dns_ms tcp_ms tls_ms ttfb_ms total_ms probe_result

    if ! has_cmd curl; then
        log_warn "curl não encontrado; não é possível testar proxy."
        append_report "result=no-curl"
        return 1
    fi

    result="$(LC_ALL=C curl -sS -o /dev/null \
        --proxy "${PROXY_URL}" \
        --connect-timeout "${CONNECT_TIMEOUT}" \
        --max-time "${MAX_TIME}" \
        -w 'http_code=%{http_code}|remote_ip=%{remote_ip}|time_namelookup=%{time_namelookup}|time_connect=%{time_connect}|time_appconnect=%{time_appconnect}|time_starttransfer=%{time_starttransfer}|time_total=%{time_total}|ssl_verify_result=%{ssl_verify_result}' \
        "${PROBE_URL}" 2> /dev/null || true)"

    http_code="$(extract_field http_code "${result}")"
    remote_ip="$(extract_field remote_ip "${result}")"
    dns_time="$(extract_field time_namelookup "${result}")"
    tcp_time="$(extract_field time_connect "${result}")"
    tls_time="$(extract_field time_appconnect "${result}")"
    ttfb_time="$(extract_field time_starttransfer "${result}")"
    total="$(extract_field time_total "${result}")"
    tls_verify="$(extract_field ssl_verify_result "${result}")"

    dns_ms="$(float_ms "${dns_time}")"
    tcp_ms="$(float_ms "${tcp_time}")"
    tls_ms="$(float_ms "${tls_time}")"
    ttfb_ms="$(float_ms "${ttfb_time}")"
    total_ms="$(float_ms "${total}")"

    probe_result="fail"
    if expected_http_ok "${PROBE_URL}" "${http_code}" && [[ "${tls_verify}" == "0" ]]; then
        probe_result="ok"
    elif [[ "${tls_verify}" != "0" ]]; then
        probe_result="tls-error"
    elif [[ -z "${http_code}" || "${http_code}" == "000" ]]; then
        probe_result="no-response"
    else
        probe_result="unexpected-http"
    fi

    append_report "proxy_probe url=${PROBE_URL} http=${http_code:-000} remote_ip=${remote_ip:-unknown} dns_ms=${dns_ms} tcp_ms=${tcp_ms} tls_ms=${tls_ms} ttfb_ms=${ttfb_ms} total_ms=${total_ms} tls_verify=${tls_verify:-?} result=${probe_result}"
    append_metric "$(ts)	${PROXY_URL}	${PROBE_URL}	${http_code:-000}	${remote_ip:-unknown}	${dns_ms}	${tcp_ms}	${tls_ms}	${ttfb_ms}	${total_ms}	${tls_verify:-?}	${probe_result}"

    if [[ "${probe_result}" == "ok" ]]; then
        log_ok "proxy validado: ${PROBE_URL} → HTTP ${http_code} via ${PROXY_URL} (${total_ms}ms)."
        return 0
    fi

    log_warn "proxy não validou: ${PROBE_URL} → HTTP ${http_code:-000}, tls=${tls_verify:-?}, result=${probe_result}."
    return 1
}

write_env_hint() {
    ensure_parent_dir "${ENV_FILE}"
    {
        printf '# Generated by %s v%s at %s\n' "${SCRIPT_NAME}" "${SCRIPT_VERSION}" "$(ts)"
        printf 'export HTTPS_PROXY=%q\n' "${PROXY_URL}"
        printf 'export HTTP_PROXY=%q\n' "${PROXY_URL}"
        printf 'export https_proxy=%q\n' "${PROXY_URL}"
        printf 'export http_proxy=%q\n' "${PROXY_URL}"
        printf 'export NO_PROXY=%q\n' "${NO_PROXY_VALUE}"
        printf 'export no_proxy=%q\n' "${NO_PROXY_VALUE}"
        printf 'export DEVCONTAINER_COPILOT_PROXY_READY=1\n'
        printf 'export DEVCONTAINER_COPILOT_PROXY_URL=%q\n' "${PROXY_URL}"
    } > "${ENV_FILE}" 2> /dev/null || true
    chmod 0600 "${ENV_FILE}" 2> /dev/null || true
    append_report "env_hint=${ENV_FILE}"

    ensure_parent_dir "${VSCODE_SETTINGS_HINT_FILE}"
    {
        printf '{\n'
        printf '  "http.proxy": "%s",\n' "${PROXY_URL}"
        printf '  "http.proxySupport": "on",\n'
        printf '  "http.proxyStrictSSL": true\n'
        printf '}\n'
    } > "${VSCODE_SETTINGS_HINT_FILE}" 2> /dev/null || true
    chmod 0600 "${VSCODE_SETTINGS_HINT_FILE}" 2> /dev/null || true
    append_report "vscode_settings_hint=${VSCODE_SETTINGS_HINT_FILE}"

    if [[ "${APPLY_PROFILE}" == "true" ]]; then
        local tmp
        tmp="$(make_temp_file copilot-proxy-profile /tmp)"
        [[ -n "${tmp}" ]] || return 0
        {
            printf '# Generated by %s v%s at %s\n' "${SCRIPT_NAME}" "${SCRIPT_VERSION}" "$(ts)"
            printf '# This affects future login shells only. It cannot alter already-running VS Code extension hosts.\n'
            printf '[ -r %q ] && . %q\n' "${ENV_FILE}" "${ENV_FILE}"
        } > "${tmp}" 2> /dev/null || true
        safe_sudo tee "${PROFILE_FILE}" < "${tmp}" > /dev/null 2>&1 || true
        safe_sudo chmod 0644 "${PROFILE_FILE}" 2> /dev/null || true
        rm -f "${tmp}" 2> /dev/null || true
        append_report "profile_hint=${PROFILE_FILE}"
    fi
}

status_proxy() {
    if [[ "${PROXY_MODE}" == "off" ]]; then
        log_info "proxy mode off."
        write_status "off"
        append_report "result=off"
        return 0
    fi

    preflight_safety || return 1

    if proxy_is_running; then
        log_ok "tinyproxy running em ${PROXY_URL}."
        write_status "ok"
        append_report "result=running"
        return 0
    fi

    log_warn "tinyproxy não está rodando."
    write_status "stopped"
    append_report "result=stopped"
    return 1
}

with_lock_or_run() {
    if has_cmd flock; then
        ensure_parent_dir "${LOCK_FILE}"
        (
            flock -x 9 || exit 98
            main_unlocked "$@"
        ) 9> "${LOCK_FILE}"
        return $?
    fi

    main_unlocked "$@"
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main_unlocked() {
    write_report_header
    write_metrics_header
    log_info "Local Copilot proxy manager iniciado (v${SCRIPT_VERSION}); action=${ACTION}; mode=${PROXY_MODE}."
    log_debug "PROXY_URL=${PROXY_URL}"
    log_debug "RUNTIME_DIR=${RUNTIME_DIR}"
    log_debug "CONNECT_PORTS=${CONNECT_PORTS}"

    case "${ACTION}" in
        stop)
            stop_proxy
            return 0
            ;;
        status)
            status_proxy
            return $?
            ;;
        env)
            write_env_hint
            write_status "env-only"
            append_report "result=env-only"
            return 0
            ;;
        restart)
            stop_proxy || true
            ;;
        probe)
            status_proxy || return 1
            probe_proxy
            return $?
            ;;
    esac

    start_proxy || return 1
    if [[ "${PROXY_MODE}" == "off" ]]; then
        return 0
    fi
    if [[ -s "${STATUS_FILE}" ]] && grep -qx 'off' "${STATUS_FILE}" 2> /dev/null; then
        append_report "result=optional-proxy-skipped"
        return 0
    fi

    probe_proxy || {
        write_status "degraded"
        append_report "result=probe-failed"
        if [[ "${PROXY_MODE}" == "auto" ]]; then
            return 0
        fi
        return 1
    }

    write_env_hint
    write_status "ok"
    append_report "result=ok proxy_url=${PROXY_URL}"
    log_ok "Proxy local Copilot pronto. Para shells futuros: source ${ENV_FILE}"
    return 0
}

main() {
    with_lock_or_run "$@"
    return $?
}

main "$@"
exit $?
