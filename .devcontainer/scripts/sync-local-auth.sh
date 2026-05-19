#!/usr/bin/env bash
# =============================================================================
# sync-local-auth.sh — Safe local env + GitHub CLI auth bootstrap
# Version: v2.0.0
#
# Purpose:
#   Make local, gitignored environment files available to future interactive and
#   login shells, and optionally persist GitHub CLI authentication in the user's
#   shared HOME inside the DevContainer.
#
# Contract:
#   - Fail-safe: lifecycle hooks must never fail because this script failed.
#   - No hardcoded secrets and no token values in logs, reports or argv.
#   - `.env*.local` files are local/gitignored overrides and are parsed, not
#     shell-sourced, by default.
#   - `remoteEnv`/containerEnv remain valid; local env exports are loaded later
#     by shell profile snippets and therefore override duplicate shell variables
#     only for interactive/login shells.
#   - Runtime GH_TOKEN/GITHUB_TOKEN are respected as ephemeral auth and are not
#     persisted automatically.
#   - GITHUB_PERSONAL_ACCESS_TOKEN is treated as an explicit persistence token
#     for `gh auth login --with-token`, unless persistence is disabled.
#   - Does not mutate Docker, DevContainer metadata, /etc/hosts, /etc/resolv.conf
#     or network services.
# =============================================================================

set +e
set +u
set +o pipefail 2> /dev/null || true
trap - ERR EXIT INT TERM 2> /dev/null || true

SCRIPT_NAME="sync-local-auth.sh"
readonly SCRIPT_NAME
SCRIPT_VERSION="2.0.0"
readonly SCRIPT_VERSION

# -----------------------------------------------------------------------------
# CLI
# -----------------------------------------------------------------------------
ACTION="${DEVCONTAINER_SYNC_LOCAL_AUTH_ACTION:-all}"
QUIET="${DEVCONTAINER_SYNC_LOCAL_AUTH_QUIET:-false}"
case "${1:-}" in
    --version)
        printf '%s v%s\n' "${SCRIPT_NAME}" "${SCRIPT_VERSION}"
        exit 0
        ;;
    --help)
        cat << 'USAGE'
sync-local-auth.sh [--help] [--version] [--emit-env] [--install-profile] [--sync-gh] [--status] [--doctor]

Fail-safe DevContainer helper for local env overlays and GitHub CLI auth.

Actions:
  --emit-env         Parse local env files and print safe POSIX export lines only.
  --install-profile  Install/update ~/.profile, ~/.bashrc and profile.d snippet.
  --sync-gh          Synchronize GitHub CLI auth when an explicit persistence token exists.
  --status           Print current summary/report paths and observed state.
  --doctor           Validate parser/profile/gh preconditions without requiring secrets.
  --all              Default: install profile, load local env in this process, sync gh.

Local env policy:
  Default files are .env*.local in the project root, sorted lexicographically.
  Files are parsed as KEY=VALUE or export KEY=VALUE. They are not shell-sourced.
  Dangerous shell/loader keys are skipped unless explicitly allowed.

Important environment knobs:
  DEVCONTAINER_SYNC_LOCAL_ENV_FILES="file1 file2"
  DEVCONTAINER_SYNC_LOCAL_ENV_ALLOW_DANGEROUS_KEYS=false
  DEVCONTAINER_SYNC_LOCAL_ENV_ALLOW_SHELL_SOURCE=false
  DEVCONTAINER_SYNC_GH_AUTH_PERSIST=true
  DEVCONTAINER_SYNC_GH_SETUP_GIT=true
  GITHUB_PERSONAL_ACCESS_TOKEN=<classic PAT intended for persistence>
  GH_TOKEN/GITHUB_TOKEN=<ephemeral token used by gh, not persisted by this script>
USAGE
        exit 0
        ;;
esac

while [[ $# -gt 0 ]]; do
    case "${1:-}" in
        --emit-env) ACTION="emit-env" ;;
        --install-profile) ACTION="install-profile" ;;
        --sync-gh) ACTION="sync-gh" ;;
        --status) ACTION="status" ;;
        --doctor) ACTION="doctor" ;;
        --all) ACTION="all" ;;
        --quiet) QUIET="true" ;;
        *) : ;;
    esac
    shift || true
done

# -----------------------------------------------------------------------------
# Generic helpers
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

sanitize_oneline() {
    local value
    if [[ $# -gt 0 ]]; then
        value="$*"
    else
        value="$(LC_ALL=C awk 'BEGIN{ORS=""} {print; exit}' 2> /dev/null || true)"
    fi
    value="${value//$'\r'/ }"
    value="${value//$'\n'/ }"
    value="${value//$'\t'/ }"
    value="$(printf '%s' "${value}" | LC_ALL=C sed 's/[[:cntrl:]]//g' 2> /dev/null || true)"
    printf '%.4096s' "${value}"
}

ts() { date '+%Y-%m-%dT%H:%M:%S%z' 2> /dev/null || date; }
has_cmd() { command -v "$1" > /dev/null 2>&1; }

QUIET="$(cfg_bool "${QUIET}" false)"
log_info() { [[ "${QUIET}" == "true" ]] || printf '%s\n' "ℹ️  [${SCRIPT_NAME}] $*"; }
log_warn() { [[ "${QUIET}" == "true" ]] || printf '%s\n' "⚠️  [${SCRIPT_NAME}] $*"; }
log_ok() { [[ "${QUIET}" == "true" ]] || printf '%s\n' "✅ [${SCRIPT_NAME}] $*"; }

ensure_parent_dir() {
    local path dir
    path="${1:-/tmp/unknown}"
    dir="$(dirname "${path}" 2> /dev/null || printf '/tmp')"
    mkdir -p "${dir}" 2> /dev/null || true
}

write_atomic_content() {
    local target mode dir tmp
    target="${1:-}"
    mode="${2:-0644}"
    [[ -n "${target}" ]] || return 1
    ensure_parent_dir "${target}"
    dir="$(dirname "${target}" 2> /dev/null || printf '/tmp')"
    tmp="$(mktemp "${dir%/}/.${SCRIPT_NAME}.XXXXXX" 2> /dev/null || true)"
    [[ -n "${tmp}" ]] || return 1
    cat > "${tmp}" 2> /dev/null || {
        rm -f "${tmp}" 2> /dev/null || true
        return 1
    }
    chmod "${mode}" "${tmp}" 2> /dev/null || true
    mv -f "${tmp}" "${target}" 2> /dev/null || {
        rm -f "${tmp}" 2> /dev/null || true
        return 1
    }
}

run_limited() {
    local seconds
    seconds="${1:-5}"
    shift || true
    if has_cmd timeout; then
        timeout "${seconds}" "$@"
        return $?
    fi
    "$@"
}

shell_quote() {
    if has_cmd python3; then
        python3 - "$1" << 'PY' 2> /dev/null
import shlex, sys
print(shlex.quote(sys.argv[1]))
PY
        return 0
    fi
    printf "'%s'" "$(printf '%s' "${1:-}" | sed "s/'/'\\''/g" 2> /dev/null || true)"
}

# -----------------------------------------------------------------------------
# Paths / config
# -----------------------------------------------------------------------------
SCRIPT_DIR_TMP=""
if SCRIPT_DIR_TMP="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2> /dev/null && pwd -P 2> /dev/null)"; then
    SCRIPT_DIR="${SCRIPT_DIR_TMP}"
else
    SCRIPT_DIR="$(pwd -P 2> /dev/null || printf '.')"
fi
readonly SCRIPT_DIR

PROJECT_ROOT="${DEVCONTAINER_PROJECT_ROOT:-}"
if [[ -z "${PROJECT_ROOT}" ]]; then
    if [[ -d "${SCRIPT_DIR}/../.." ]]; then
        PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." 2> /dev/null && pwd -P 2> /dev/null || printf '')"
    fi
fi
if [[ -z "${PROJECT_ROOT}" ]]; then
    PROJECT_ROOT="$(pwd -P 2> /dev/null || printf '.')"
fi
readonly PROJECT_ROOT

HOME_DIR="${HOME:-/home/node}"
readonly HOME_DIR
XDG_CONFIG_HOME_EFFECTIVE="${XDG_CONFIG_HOME:-${HOME_DIR}/.config}"
readonly XDG_CONFIG_HOME_EFFECTIVE
PROFILE_DIR="${DEVCONTAINER_SYNC_LOCAL_AUTH_PROFILE_DIR:-${XDG_CONFIG_HOME_EFFECTIVE}/profile.d}"
readonly PROFILE_DIR
PROFILE_SNIPPET="${DEVCONTAINER_SYNC_LOCAL_AUTH_PROFILE_SNIPPET:-${PROFILE_DIR}/20-chatgpt-docker-puppeteer-env.sh}"
readonly PROFILE_SNIPPET
PROFILE_BLOCK_BEGIN="# >>> chatgpt-docker-puppeteer local env >>>"
PROFILE_BLOCK_END="# <<< chatgpt-docker-puppeteer local env <<<"
readonly PROFILE_BLOCK_BEGIN PROFILE_BLOCK_END

STATUS_FILE="${DEVCONTAINER_SYNC_LOCAL_AUTH_STATUS_FILE:-/tmp/devcontainer-sync-local-auth.status}"
SUMMARY_FILE="${DEVCONTAINER_SYNC_LOCAL_AUTH_SUMMARY_FILE:-/tmp/devcontainer-sync-local-auth.summary}"
REPORT_FILE="${DEVCONTAINER_SYNC_LOCAL_AUTH_REPORT_FILE:-/tmp/devcontainer-sync-local-auth.report}"
LOCK_FILE="${DEVCONTAINER_SYNC_LOCAL_AUTH_LOCK_FILE:-/tmp/devcontainer-network/sync-local-auth.lock}"
readonly STATUS_FILE SUMMARY_FILE REPORT_FILE LOCK_FILE

LOCK_WAIT_SECONDS="$(cfg_uint "${DEVCONTAINER_SYNC_LOCAL_AUTH_LOCK_WAIT_SECONDS:-8}" 8 0 120)"
GH_TIMEOUT_SECONDS="$(cfg_uint "${DEVCONTAINER_SYNC_GH_TIMEOUT_SECONDS:-20}" 20 1 300)"
readonly LOCK_WAIT_SECONDS GH_TIMEOUT_SECONDS

ALLOW_DANGEROUS_KEYS="$(cfg_bool "${DEVCONTAINER_SYNC_LOCAL_ENV_ALLOW_DANGEROUS_KEYS:-false}" false)"
ALLOW_SHELL_SOURCE="$(cfg_bool "${DEVCONTAINER_SYNC_LOCAL_ENV_ALLOW_SHELL_SOURCE:-false}" false)"
INSTALL_ZSHRC="$(cfg_bool "${DEVCONTAINER_SYNC_LOCAL_AUTH_INSTALL_ZSHRC:-true}" true)"
SYNC_GH_PERSIST="$(cfg_bool "${DEVCONTAINER_SYNC_GH_AUTH_PERSIST:-true}" true)"
SYNC_GH_SETUP_GIT="$(cfg_bool "${DEVCONTAINER_SYNC_GH_SETUP_GIT:-true}" true)"
SYNC_GH_STATUS_CHECK="$(cfg_bool "${DEVCONTAINER_SYNC_GH_STATUS_CHECK:-true}" true)"
readonly ALLOW_DANGEROUS_KEYS ALLOW_SHELL_SOURCE INSTALL_ZSHRC SYNC_GH_PERSIST SYNC_GH_SETUP_GIT SYNC_GH_STATUS_CHECK

GH_HOSTNAME="${DEVCONTAINER_SYNC_GH_HOSTNAME:-${GH_HOST:-github.com}}"
readonly GH_HOSTNAME

ENV_FILES_RESOLVED=""
ENV_FILES_COUNT=0
ENV_KEYS_EXPORTED=0
ENV_KEYS_SKIPPED=0
PROFILE_STATUS="not-run"
GH_STATUS="not-run"
GH_AUTH_MODE="none"
GH_SETUP_GIT_STATUS="not-run"
LAST_REASON="none"

# -----------------------------------------------------------------------------
# Report/status helpers
# -----------------------------------------------------------------------------
write_status() {
    printf '%s\n' "${1:-unknown}" | write_atomic_content "${STATUS_FILE}" 0644 || true
}

append_report() {
    ensure_parent_dir "${REPORT_FILE}"
    printf '%s\n' "$*" >> "${REPORT_FILE}" 2> /dev/null || true
}

write_report_header() {
    {
        printf 'script=%s\n' "${SCRIPT_NAME}"
        printf 'version=%s\n' "${SCRIPT_VERSION}"
        printf 'timestamp=%s\n' "$(ts)"
        printf 'action=%s\n' "${ACTION}"
        printf 'project_root=%s\n' "${PROJECT_ROOT}"
        printf 'home_dir=%s\n' "${HOME_DIR}"
        printf 'profile_dir=%s\n' "${PROFILE_DIR}"
        printf 'profile_snippet=%s\n' "${PROFILE_SNIPPET}"
        printf 'allow_dangerous_keys=%s\n' "${ALLOW_DANGEROUS_KEYS}"
        printf 'allow_shell_source=%s\n' "${ALLOW_SHELL_SOURCE}"
        printf 'sync_gh_persist=%s\n' "${SYNC_GH_PERSIST}"
        printf 'sync_gh_setup_git=%s\n' "${SYNC_GH_SETUP_GIT}"
        printf 'gh_hostname=%s\n' "${GH_HOSTNAME}"
        printf '\n'
    } | write_atomic_content "${REPORT_FILE}" 0644 || true
}

write_summary() {
    local status reason gh_available runtime_token_present persist_token_present gh_config_dir
    status="${1:-unknown}"
    reason="${2:-${LAST_REASON:-none}}"
    if has_cmd gh; then gh_available="true"; else gh_available="false"; fi
    if [[ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]]; then runtime_token_present="true"; else runtime_token_present="false"; fi
    if [[ -n "${GITHUB_PERSONAL_ACCESS_TOKEN:-}${DEVCONTAINER_GITHUB_PERSONAL_ACCESS_TOKEN:-}${GH_PERSIST_TOKEN:-}" ]]; then persist_token_present="true"; else persist_token_present="false"; fi
    gh_config_dir="${GH_CONFIG_DIR:-${XDG_CONFIG_HOME_EFFECTIVE}/gh}"
    {
        printf 'status=%s\n' "${status}"
        printf 'reason=%s\n' "$(sanitize_oneline "${reason}")"
        printf 'script=%s\n' "${SCRIPT_NAME}"
        printf 'script_version=%s\n' "${SCRIPT_VERSION}"
        printf 'action=%s\n' "${ACTION}"
        printf 'project_root=%s\n' "${PROJECT_ROOT}"
        printf 'home_dir=%s\n' "${HOME_DIR}"
        printf 'profile_dir=%s\n' "${PROFILE_DIR}"
        printf 'profile_snippet=%s\n' "${PROFILE_SNIPPET}"
        printf 'profile_status=%s\n' "${PROFILE_STATUS}"
        printf 'env_files=%s\n' "$(sanitize_oneline "${ENV_FILES_RESOLVED}")"
        printf 'env_files_count=%s\n' "${ENV_FILES_COUNT}"
        printf 'env_keys_exported=%s\n' "${ENV_KEYS_EXPORTED}"
        printf 'env_keys_skipped=%s\n' "${ENV_KEYS_SKIPPED}"
        printf 'allow_dangerous_keys=%s\n' "${ALLOW_DANGEROUS_KEYS}"
        printf 'allow_shell_source=%s\n' "${ALLOW_SHELL_SOURCE}"
        printf 'gh_available=%s\n' "${gh_available}"
        printf 'gh_hostname=%s\n' "${GH_HOSTNAME}"
        printf 'gh_config_dir=%s\n' "${gh_config_dir}"
        printf 'gh_status=%s\n' "${GH_STATUS}"
        printf 'gh_auth_mode=%s\n' "${GH_AUTH_MODE}"
        printf 'gh_setup_git_status=%s\n' "${GH_SETUP_GIT_STATUS}"
        printf 'runtime_token_present=%s\n' "${runtime_token_present}"
        printf 'persist_token_present=%s\n' "${persist_token_present}"
        printf 'status_file=%s\n' "${STATUS_FILE}"
        printf 'summary_file=%s\n' "${SUMMARY_FILE}"
        printf 'report_file=%s\n' "${REPORT_FILE}"
        printf 'completed_at=%s\n' "$(ts)"
    } | write_atomic_content "${SUMMARY_FILE}" 0644 || true
}

# -----------------------------------------------------------------------------
# Env parser
# -----------------------------------------------------------------------------
resolve_env_files() {
    local explicit file
    ENV_FILES_RESOLVED=""
    ENV_FILES_COUNT=0
    explicit="${DEVCONTAINER_SYNC_LOCAL_ENV_FILES:-${DEVCONTAINER_LOCAL_ENV_FILES:-}}"
    if [[ -n "${explicit}" ]]; then
        local -a explicit_files=()
        read -r -a explicit_files <<< "${explicit}"
        for file in "${explicit_files[@]}"; do
            [[ -n "${file}" ]] || continue
            case "${file}" in
                /*) : ;;
                *) file="${PROJECT_ROOT}/${file}" ;;
            esac
            [[ -r "${file}" ]] || continue
            if [[ -z "${ENV_FILES_RESOLVED}" ]]; then
                ENV_FILES_RESOLVED="${file}"
            else
                ENV_FILES_RESOLVED="${ENV_FILES_RESOLVED} ${file}"
            fi
            ENV_FILES_COUNT=$((ENV_FILES_COUNT + 1))
        done
        return 0
    fi

    while IFS= read -r file; do
        [[ -n "${file}" && -r "${file}" ]] || continue
        if [[ -z "${ENV_FILES_RESOLVED}" ]]; then
            ENV_FILES_RESOLVED="${file}"
        else
            ENV_FILES_RESOLVED="${ENV_FILES_RESOLVED} ${file}"
        fi
        ENV_FILES_COUNT=$((ENV_FILES_COUNT + 1))
    done < <(find "${PROJECT_ROOT}" -maxdepth 1 -type f -name '.env*.local' 2> /dev/null | LC_ALL=C sort || true)
}

emit_env_exports_python() {
    local -a env_files_array=()
    if [[ -n "${ENV_FILES_RESOLVED}" ]]; then
        read -r -a env_files_array <<< "${ENV_FILES_RESOLVED}"
    fi
    python3 - "${ALLOW_DANGEROUS_KEYS}" "${env_files_array[@]}" << 'PY'
import os, re, shlex, sys
allow_dangerous = (sys.argv[1].lower() == "true") if len(sys.argv) > 1 else False
files = sys.argv[2:]
key_re = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
dangerous = {
    "BASH_ENV", "ENV", "SHELLOPTS", "BASHOPTS", "CDPATH", "GLOBIGNORE",
    "IFS", "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES",
    "PROMPT_COMMAND", "PS4",
}
# PATH changes are high-impact in DevContainers; allow only by explicit dangerous opt-in.
dangerous.add("PATH")
values = {}
skipped = 0

def strip_inline_comment_unquoted(value: str) -> str:
    out = []
    escaped = False
    prev_space = False
    for ch in value:
        if escaped:
            out.append(ch)
            escaped = False
            prev_space = ch.isspace()
            continue
        if ch == "\\":
            out.append(ch)
            escaped = True
            prev_space = False
            continue
        if ch == "#" and (not out or prev_space):
            break
        out.append(ch)
        prev_space = ch.isspace()
    return "".join(out).strip()

def parse_value(raw: str) -> str:
    raw = raw.strip()
    if raw == "":
        return ""
    if raw.startswith("'"):
        end = raw.rfind("'")
        if end > 0:
            return raw[1:end]
        return raw[1:]
    if raw.startswith('"'):
        end = raw.rfind('"')
        body = raw[1:end] if end > 0 else raw[1:]
        # dotenv-compatible light unescape without variable expansion.
        body = body.replace('\\n', '\n').replace('\\r', '\r').replace('\\t', '\t')
        body = body.replace('\\"', '"').replace('\\\\', '\\')
        return body
    return strip_inline_comment_unquoted(raw)

for path in files:
    try:
        with open(path, "r", encoding="utf-8-sig", errors="replace") as fh:
            for line_no, line in enumerate(fh, 1):
                line = line.rstrip("\n").rstrip("\r")
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                if stripped.startswith("export "):
                    stripped = stripped[7:].lstrip()
                if "=" not in stripped:
                    skipped += 1
                    continue
                key, raw_value = stripped.split("=", 1)
                key = key.strip()
                if not key_re.match(key):
                    skipped += 1
                    continue
                if (not allow_dangerous) and key in dangerous:
                    skipped += 1
                    continue
                values[key] = parse_value(raw_value)
    except Exception:
        skipped += 1

for key in sorted(values):
    print(f"export {key}={shlex.quote(values[key])}")
print(f"export CHATGPT_DOCKER_PUPPETEER_LOCAL_ENV_KEYS_EXPORTED={len(values)}")
print(f"export CHATGPT_DOCKER_PUPPETEER_LOCAL_ENV_KEYS_SKIPPED={skipped}")
PY
}

emit_env_exports_fallback() {
    local file line key value skipped exported
    local -a env_files_array=()
    skipped=0
    exported=0
    if [[ -n "${ENV_FILES_RESOLVED}" ]]; then
        read -r -a env_files_array <<< "${ENV_FILES_RESOLVED}"
    fi
    for file in "${env_files_array[@]}"; do
        [[ -n "${file}" && -r "${file}" ]] || continue
        while IFS= read -r line || [[ -n "${line}" ]]; do
            line="${line%$'\r'}"
            case "${line}" in
                '' | '#'*) continue ;;
                export\ *) line="${line#export }" ;;
            esac
            [[ "${line}" == *=* ]] || {
                skipped=$((skipped + 1))
                continue
            }
            key="${line%%=*}"
            value="${line#*=}"
            key="$(printf '%s' "${key}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' 2> /dev/null || true)"
            [[ "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || {
                skipped=$((skipped + 1))
                continue
            }
            case "${key}" in
                BASH_ENV | ENV | SHELLOPTS | BASHOPTS | CDPATH | GLOBIGNORE | IFS | LD_PRELOAD | LD_LIBRARY_PATH | PATH)
                    [[ "${ALLOW_DANGEROUS_KEYS}" == "true" ]] || {
                        skipped=$((skipped + 1))
                        continue
                    }
                    ;;
            esac
            value="$(printf '%s' "${value}" | sed 's/[[:space:]]#.*$//;s/^[[:space:]]*//;s/[[:space:]]*$//' 2> /dev/null || true)"
            case "${value}" in
                \"*\")
                    value="${value#\"}"
                    value="${value%\"}"
                    ;;
                \'*\')
                    value="${value#\'}"
                    value="${value%\'}"
                    ;;
            esac
            printf 'export %s=%s\n' "${key}" "$(shell_quote "${value}")"
            exported=$((exported + 1))
        done < "${file}"
    done
    printf 'export CHATGPT_DOCKER_PUPPETEER_LOCAL_ENV_KEYS_EXPORTED=%s\n' "${exported}"
    printf 'export CHATGPT_DOCKER_PUPPETEER_LOCAL_ENV_KEYS_SKIPPED=%s\n' "${skipped}"
}

emit_env_exports() {
    if [[ -z "${ENV_FILES_RESOLVED}" ]]; then
        resolve_env_files
    fi
    if [[ -z "${ENV_FILES_RESOLVED}" ]]; then
        printf 'export CHATGPT_DOCKER_PUPPETEER_LOCAL_ENV_KEYS_EXPORTED=0\n'
        printf 'export CHATGPT_DOCKER_PUPPETEER_LOCAL_ENV_KEYS_SKIPPED=0\n'
        return 0
    fi
    if has_cmd python3; then
        emit_env_exports_python
    else
        emit_env_exports_fallback
    fi
}

load_local_env_now() {
    local exports_output
    resolve_env_files
    exports_output="$(emit_env_exports 2> /dev/null || true)"
    [[ -n "${exports_output}" ]] || return 0
    # The string is generated by our parser as shell-quoted `export KEY=value` lines.
    eval "${exports_output}" 2> /dev/null || true
    ENV_KEYS_EXPORTED="${CHATGPT_DOCKER_PUPPETEER_LOCAL_ENV_KEYS_EXPORTED:-0}"
    ENV_KEYS_SKIPPED="${CHATGPT_DOCKER_PUPPETEER_LOCAL_ENV_KEYS_SKIPPED:-0}"
    append_report "local_env_loaded files=${ENV_FILES_COUNT} exported=${ENV_KEYS_EXPORTED} skipped=${ENV_KEYS_SKIPPED}"
}

# -----------------------------------------------------------------------------
# Profile hook
# -----------------------------------------------------------------------------
replace_or_append_block() {
    local target block tmp
    target="${1:-}"
    block="${2:-}"
    [[ -n "${target}" ]] || return 1
    ensure_parent_dir "${target}"
    touch "${target}" 2> /dev/null || return 1
    tmp="$(mktemp "$(dirname "${target}")/.${SCRIPT_NAME}.profile.XXXXXX" 2> /dev/null || true)"
    [[ -n "${tmp}" ]] || return 1
    awk -v begin="${PROFILE_BLOCK_BEGIN}" -v end="${PROFILE_BLOCK_END}" '
        $0 == begin { skip=1; next }
        $0 == end { skip=0; next }
        skip != 1 { print }
    ' "${target}" > "${tmp}" 2> /dev/null || cp "${target}" "${tmp}" 2> /dev/null || true
    {
        printf '\n%s\n' "${block}"
    } >> "${tmp}" 2> /dev/null || true
    mv -f "${tmp}" "${target}" 2> /dev/null || {
        rm -f "${tmp}" 2> /dev/null || true
        return 1
    }
    chmod 0644 "${target}" 2> /dev/null || true
}

ensure_profile_hook() {
    local block rc_file rc_files script_path q_script q_project q_snippet
    mkdir -p "${PROFILE_DIR}" 2> /dev/null || {
        PROFILE_STATUS="failed"
        LAST_REASON="profile-dir-failed"
        return 1
    }
    chmod 0700 "${PROFILE_DIR}" 2> /dev/null || true

    script_path="${SCRIPT_DIR}/${SCRIPT_NAME}"
    if [[ ! -r "${script_path}" ]]; then
        script_path="${BASH_SOURCE[0]}"
    fi
    q_script="$(shell_quote "${script_path}")"
    q_project="$(shell_quote "${PROJECT_ROOT}")"
    q_snippet="$(shell_quote "${PROFILE_SNIPPET}")"

    {
        printf '#!/bin/sh\n'
        printf '# Generated by %s v%s. Safe to overwrite.\n' "${SCRIPT_NAME}" "${SCRIPT_VERSION}"
        printf '# Loads gitignored local env overlays through a parser; does not source .env.local directly.\n'
        printf 'if [ -n "${CHATGPT_DOCKER_PUPPETEER_LOCAL_ENV_LOADED:-}" ]; then\n'
        printf '  return 0 2>/dev/null || exit 0\n'
        printf 'fi\n'
        printf '# Shell-local guard only: intentionally not exported, so child shells may reload fresh overlays.\n'
        printf 'CHATGPT_DOCKER_PUPPETEER_LOCAL_ENV_LOADED=1\n'
        printf 'CHATGPT_DOCKER_PUPPETEER_PROJECT_ROOT=%s\n' "${q_project}"
        printf 'if [ -r %s ]; then\n' "${q_script}"
        printf '  _chatgpt_local_env_exports="$(DEVCONTAINER_SYNC_LOCAL_AUTH_QUIET=true %s --emit-env 2>/dev/null)"\n' "${q_script}"
        printf '  if [ -n "${_chatgpt_local_env_exports:-}" ]; then\n'
        printf '    eval "${_chatgpt_local_env_exports}"\n'
        printf '  fi\n'
        printf '  unset _chatgpt_local_env_exports\n'
        printf 'fi\n'
    } | write_atomic_content "${PROFILE_SNIPPET}" 0644 || {
        PROFILE_STATUS="failed"
        LAST_REASON="profile-snippet-failed"
        return 1
    }

    block="${PROFILE_BLOCK_BEGIN}
if [ -f ${q_snippet} ]; then
  . ${q_snippet}
fi
${PROFILE_BLOCK_END}"

    rc_files="${HOME_DIR}/.profile ${HOME_DIR}/.bashrc"
    if [[ "${INSTALL_ZSHRC}" == "true" ]]; then
        rc_files="${rc_files} ${HOME_DIR}/.zshrc"
    fi
    for rc_file in ${rc_files}; do
        replace_or_append_block "${rc_file}" "${block}" || append_report "profile_rc_update_failed=${rc_file}"
    done
    PROFILE_STATUS="ok"
    append_report "profile_hook=ok snippet=${PROFILE_SNIPPET}"
    return 0
}

# -----------------------------------------------------------------------------
# GitHub CLI auth
# -----------------------------------------------------------------------------
mask_presence() {
    if [[ -n "${1:-}" ]]; then printf 'present'; else printf 'absent'; fi
}

sync_gh_auth() {
    local persist_token runtime_token status_rc setup_rc login_rc gh_config_dir
    runtime_token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
    persist_token="${GITHUB_PERSONAL_ACCESS_TOKEN:-${DEVCONTAINER_GITHUB_PERSONAL_ACCESS_TOKEN:-${GH_PERSIST_TOKEN:-}}}"
    gh_config_dir="${GH_CONFIG_DIR:-${XDG_CONFIG_HOME_EFFECTIVE}/gh}"

    append_report "gh_runtime_token=$(mask_presence "${runtime_token}")"
    append_report "gh_persist_token=$(mask_presence "${persist_token}")"
    append_report "gh_config_dir=${gh_config_dir}"

    if ! has_cmd gh; then
        GH_STATUS="gh-missing"
        GH_AUTH_MODE="unavailable"
        LAST_REASON="gh-missing"
        log_warn "gh não encontrado; bootstrap de GitHub CLI ignorado."
        return 0
    fi

    mkdir -p "${gh_config_dir}" 2> /dev/null || true
    chmod 0700 "${gh_config_dir}" 2> /dev/null || true

    if [[ -n "${runtime_token}" && -z "${persist_token}" ]]; then
        GH_STATUS="env-token"
        GH_AUTH_MODE="ephemeral-env"
        log_info "gh usará token de ambiente (GH_TOKEN/GITHUB_TOKEN); nada será persistido."
        return 0
    fi

    if [[ "${SYNC_GH_PERSIST}" != "true" ]]; then
        GH_STATUS="persist-disabled"
        GH_AUTH_MODE="disabled"
        log_info "Persistência do gh desabilitada por DEVCONTAINER_SYNC_GH_AUTH_PERSIST=false."
        return 0
    fi

    if [[ -z "${persist_token}" ]]; then
        GH_AUTH_MODE="none"
        if [[ "${SYNC_GH_STATUS_CHECK}" == "true" ]]; then
            run_limited "${GH_TIMEOUT_SECONDS}" env -u GH_TOKEN -u GITHUB_TOKEN -u GH_ENTERPRISE_TOKEN -u GITHUB_ENTERPRISE_TOKEN \
                gh auth status --hostname "${GH_HOSTNAME}" > /dev/null 2>&1
            status_rc=$?
            if [[ "${status_rc}" -eq 0 ]]; then
                GH_STATUS="already-authenticated"
                log_info "gh já autenticado para ${GH_HOSTNAME}; mantendo credenciais atuais."
            else
                GH_STATUS="no-token"
                log_info "Nenhum token persistente encontrado; gh permanecerá não autenticado até login manual ou GH_TOKEN."
            fi
        else
            GH_STATUS="no-token"
            log_info "Nenhum token persistente encontrado; status check desativado."
        fi
        return 0
    fi

    GH_AUTH_MODE="persist-with-token"
    printf '%s' "${persist_token}" | run_limited "${GH_TIMEOUT_SECONDS}" env -u GH_TOKEN -u GITHUB_TOKEN -u GH_ENTERPRISE_TOKEN -u GITHUB_ENTERPRISE_TOKEN \
        gh auth login --hostname "${GH_HOSTNAME}" --git-protocol https --with-token > /dev/null 2>&1
    login_rc=$?
    if [[ "${login_rc}" -eq 0 ]]; then
        GH_STATUS="authenticated"
        log_ok "Autenticação do gh sincronizada para ${GH_HOSTNAME}."
        if [[ "${SYNC_GH_SETUP_GIT}" == "true" ]]; then
            run_limited "${GH_TIMEOUT_SECONDS}" env -u GH_TOKEN -u GITHUB_TOKEN -u GH_ENTERPRISE_TOKEN -u GITHUB_ENTERPRISE_TOKEN \
                gh auth setup-git --hostname "${GH_HOSTNAME}" > /dev/null 2>&1
            setup_rc=$?
            if [[ "${setup_rc}" -eq 0 ]]; then
                GH_SETUP_GIT_STATUS="ok"
                log_ok "Git credential helper configurado via gh para ${GH_HOSTNAME}."
            else
                GH_SETUP_GIT_STATUS="failed-nonfatal"
                log_warn "gh auth setup-git falhou; autenticação gh foi mantida."
            fi
        else
            GH_SETUP_GIT_STATUS="disabled"
        fi
        chmod -R go-rwx "${gh_config_dir}" 2> /dev/null || true
        return 0
    fi

    if [[ "${SYNC_GH_STATUS_CHECK}" == "true" ]]; then
        run_limited "${GH_TIMEOUT_SECONDS}" env -u GH_TOKEN -u GITHUB_TOKEN -u GH_ENTERPRISE_TOKEN -u GITHUB_ENTERPRISE_TOKEN \
            gh auth status --hostname "${GH_HOSTNAME}" > /dev/null 2>&1
        status_rc=$?
        if [[ "${status_rc}" -eq 0 ]]; then
            GH_STATUS="already-authenticated"
            log_info "gh já autenticado; mantendo credenciais atuais."
            return 0
        fi
    fi

    GH_STATUS="auth-failed-nonfatal"
    LAST_REASON="gh-auth-failed"
    log_warn "Falha ao sincronizar gh; use GH_TOKEN para modo efêmero ou revise o PAT persistente."
    return 0
}

# -----------------------------------------------------------------------------
# Status / doctor
# -----------------------------------------------------------------------------
status_action() {
    local status_value
    if [[ -r "${SUMMARY_FILE}" ]]; then
        cat "${SUMMARY_FILE}" 2> /dev/null || true
    else
        status_value="unknown"
        [[ -r "${STATUS_FILE}" ]] && status_value="$(awk 'NR==1{print; exit}' "${STATUS_FILE}" 2> /dev/null || printf unknown)"
        printf 'status=%s\nsummary_file=%s\nreport_file=%s\n' "${status_value}" "${SUMMARY_FILE}" "${REPORT_FILE}"
    fi
}

doctor_action() {
    local rc
    rc=0
    resolve_env_files
    if [[ "${ENV_FILES_COUNT}" -gt 0 ]]; then
        log_ok "Arquivos .env local detectados: ${ENV_FILES_COUNT}."
    else
        log_info "Nenhum .env*.local encontrado; normal se segredos forem injetados por remoteEnv/GH_TOKEN."
    fi
    if has_cmd python3; then
        log_ok "Parser Python disponível para .env local."
    else
        log_warn "Python indisponível; fallback shell parser aceitará apenas subconjunto simples."
    fi
    if [[ -d "${HOME_DIR}" && -w "${HOME_DIR}" ]]; then
        log_ok "HOME gravável: ${HOME_DIR}."
    else
        log_warn "HOME ausente ou não gravável: ${HOME_DIR}."
        rc=1
    fi
    if has_cmd gh; then
        log_ok "GitHub CLI disponível."
    else
        log_warn "GitHub CLI indisponível; sync gh será ignorado."
    fi
    return "${rc}"
}

# -----------------------------------------------------------------------------
# Main orchestration
# -----------------------------------------------------------------------------
main_unlocked() {
    local final_status rc
    final_status="ok"
    rc=0
    write_report_header
    write_status "running"

    case "${ACTION}" in
        emit-env)
            emit_env_exports
            return 0
            ;;
        install-profile)
            ensure_profile_hook || rc=1
            ;;
        sync-gh)
            load_local_env_now || true
            sync_gh_auth || true
            ;;
        status)
            status_action
            return 0
            ;;
        doctor)
            doctor_action
            rc=$?
            ;;
        all | *)
            ensure_profile_hook || rc=1
            load_local_env_now || true
            sync_gh_auth || true
            ;;
    esac

    if [[ "${rc}" -ne 0 ]]; then
        final_status="degraded"
    fi
    write_status "${final_status}"
    write_summary "${final_status}" "${LAST_REASON}"
    if [[ "${final_status}" == "ok" ]]; then
        log_ok "sync-local-auth concluído. profile=${PROFILE_STATUS}; gh=${GH_STATUS}; env_files=${ENV_FILES_COUNT}."
    else
        log_warn "sync-local-auth concluído com observações. profile=${PROFILE_STATUS}; gh=${GH_STATUS}; env_files=${ENV_FILES_COUNT}."
    fi
    return 0
}

main() {
    if [[ "${ACTION}" == "emit-env" ]]; then
        main_unlocked
        return $?
    fi
    ensure_parent_dir "${LOCK_FILE}"
    if has_cmd flock; then
        (
            if [[ "${LOCK_WAIT_SECONDS}" -gt 0 ]]; then
                flock -x -w "${LOCK_WAIT_SECONDS}" 9 || exit 98
            else
                flock -x 9 || exit 98
            fi
            main_unlocked
        ) 9> "${LOCK_FILE}"
        if [[ "$?" -eq 98 ]]; then
            write_status "degraded"
            LAST_REASON="lock-timeout"
            write_summary "degraded" "lock-timeout"
            log_warn "lock indisponível; operação ignorada de forma fail-safe."
        fi
        return 0
    fi
    main_unlocked
    return 0
}

main "$@"
exit 0
