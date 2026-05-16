#!/usr/bin/env bash
# =============================================================================
# nss-gatekeeper — canonical entrypoint wrapper for NSS Wrapper activation
# Version: 2.1.2
#
# Purpose:
#   Ensure NSS wrapper is safe and canonical before the DevContainer command
#   starts, including non-login / non-interactive processes that never source
#   /etc/profile.d.
#
# Canonical rule:
#   LD_PRELOAD must never contain a relative "libnss_wrapper.so" token.
#   The preferred canonical path is:
#     /usr/local/lib/devcontainer/libnss_wrapper.so
#
# Design contract:
#   • Fail-safe: never blocks container boot; exits non-zero only when no command
#     is provided or when exec itself fails.
#   • Idempotent: can run multiple times without accumulating LD_PRELOAD entries.
#   • Artifact-safe: seeds fallback NSS artifacts from /etc/passwd and /etc/group.
#   • Arbitrary-UID-safe: if the active UID/GID is not present in the seeded
#     artifacts, appends a minimal synthetic passwd/group entry.
#   • Profile-compatible: may source immutable /etc/profile.d/10-gatekeeper-nss.sh,
#     but canonicalizes LD_PRELOAD again afterwards to defeat inherited relative
#     or duplicated NSS tokens.
#   • Hardened: never sources shell code from writable runtime directories.
#   • Stdout-safe: diagnostics go to stderr only and only when explicitly enabled,
#     except for critical no-command failure.
#
# Controls:
#   DEVCONTAINER_SKIP_NSS=1
#     Bypass NSS setup entirely and exec the command as-is.
#
#   DEVCONTAINER_NSS_DIR=/path
#     Override NSS artifact directory. Default: /tmp/devcontainer-nss
#
#   DEVCONTAINER_NSS_WRAPPER_LIB=/absolute/path/libnss_wrapper.so
#     Preferred absolute libnss_wrapper path. Default fallback:
#     /usr/local/lib/devcontainer/libnss_wrapper.so, then multiarch paths, then
#     ldconfig discovery.
#
#   DEVCONTAINER_NSS_DEBUG=1
#     Emit diagnostic lines to stderr.
#
# Usage:
#   ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/nss-gatekeeper"]
#   CMD ["sleep", "infinity"]
# =============================================================================

# Fail-safe posture. This wrapper must tolerate partial environments and must not
# abort container boot because a best-effort NSS step failed.
set +e
set +u
set +o pipefail 2> /dev/null || true
trap - ERR EXIT INT TERM 2> /dev/null || true

SCRIPT_NAME="nss-gatekeeper"
SCRIPT_VERSION="2.1.2"

_dc_dbg() {
    if [ -n "${DEVCONTAINER_NSS_DEBUG:-}" ]; then
        printf '%s\n' "[${SCRIPT_NAME}] $*" >&2
    fi
}

_dc_warn() {
    printf '%s\n' "⚠️  [${SCRIPT_NAME}] $*" >&2
}

_has_cmd() {
    command -v "$1" > /dev/null 2>&1
}

_is_readable_file() {
    [ -n "${1:-}" ] && [ -r "$1" ] && [ -f "$1" ]
}

_resolve_nss_wrapper_lib() {
    local candidate arch found

    candidate="${DEVCONTAINER_NSS_WRAPPER_LIB:-}"
    if _is_readable_file "${candidate}"; then
        printf '%s\n' "${candidate}"
        return 0
    fi

    candidate="/usr/local/lib/devcontainer/libnss_wrapper.so"
    if _is_readable_file "${candidate}"; then
        printf '%s\n' "${candidate}"
        return 0
    fi

    arch="$(uname -m 2> /dev/null || printf 'x86_64')"

    for candidate in \
        "/usr/lib/${arch}-linux-gnu/libnss_wrapper.so" \
        "/usr/lib/x86_64-linux-gnu/libnss_wrapper.so" \
        "/usr/lib/aarch64-linux-gnu/libnss_wrapper.so" \
        "/lib/${arch}-linux-gnu/libnss_wrapper.so" \
        "/lib/x86_64-linux-gnu/libnss_wrapper.so" \
        "/lib/aarch64-linux-gnu/libnss_wrapper.so"; do
        if _is_readable_file "${candidate}"; then
            printf '%s\n' "${candidate}"
            return 0
        fi
    done

    if _has_cmd ldconfig; then
        found="$(ldconfig -p 2> /dev/null | awk '/libnss_wrapper\.so/{print $NF; exit}')"
        if _is_readable_file "${found}"; then
            printf '%s\n' "${found}"
            return 0
        fi
    fi

    return 1
}

_strip_nss_preload_tokens() {
    # Prints LD_PRELOAD with any NSS wrapper token removed.
    # Rules:
    #   • remove "libnss_wrapper.so";
    #   • remove any absolute/relative path ending in "/libnss_wrapper.so";
    #   • preserve all unrelated tokens and order.
    local old_preload new_preload token ifs_save

    old_preload="${1:-}"
    new_preload=""

    ifs_save="${IFS}"
    IFS=":"
    for token in ${old_preload}; do
        [ -z "${token}" ] && continue

        case "${token}" in
            libnss_wrapper.so | */libnss_wrapper.so)
                continue
                ;;
        esac

        if [ -z "${new_preload}" ]; then
            new_preload="${token}"
        else
            new_preload="${new_preload}:${token}"
        fi
    done
    IFS="${ifs_save}"

    printf '%s\n' "${new_preload}"
}

_canonicalize_ld_preload() {
    local nss_lib stripped_preload

    nss_lib="$(_resolve_nss_wrapper_lib 2> /dev/null || true)"
    stripped_preload="$(_strip_nss_preload_tokens "${LD_PRELOAD:-}")"

    if [ -z "${nss_lib}" ] || [ ! -r "${nss_lib}" ]; then
        _dc_dbg "libnss_wrapper.so not found; removing broken NSS preload tokens only"

        if [ -n "${stripped_preload}" ]; then
            export LD_PRELOAD="${stripped_preload}"
        else
            unset LD_PRELOAD 2> /dev/null || true
        fi

        return 0
    fi

    export DEVCONTAINER_NSS_WRAPPER_LIB="${nss_lib}"

    if [ -n "${stripped_preload}" ]; then
        export LD_PRELOAD="${nss_lib}:${stripped_preload}"
    else
        export LD_PRELOAD="${nss_lib}"
    fi

    _dc_dbg "canonical LD_PRELOAD=${LD_PRELOAD}"
    return 0
}

_seed_nss_artifacts_if_missing() {
    local base_dir passwd_file group_file passwd_tmp group_tmp
    local current_uid current_gid current_user current_home

    base_dir="${DEVCONTAINER_NSS_DIR:-/tmp/devcontainer-nss}"
    passwd_file="${base_dir}/passwd"
    group_file="${base_dir}/group"

    if [ -r "${passwd_file}" ] && [ -s "${passwd_file}" ] \
        && [ -r "${group_file}" ] && [ -s "${group_file}" ]; then
        _dc_dbg "NSS artifacts already present and readable: ${base_dir}"
        return 0
    fi

    mkdir -p "${base_dir}" 2> /dev/null || {
        _dc_dbg "could not create NSS base dir: ${base_dir}; using /etc fallback"
        return 0
    }

    chmod 700 "${base_dir}" 2> /dev/null || true

    if [ ! -w "${base_dir}" ]; then
        _dc_dbg "NSS base dir is not writable by current user: ${base_dir}; using /etc fallback"
        return 0
    fi

    current_uid="$(id -u 2> /dev/null || printf '')"
    current_gid="$(id -g 2> /dev/null || printf '')"
    current_user="$(id -un 2> /dev/null || printf '')"
    current_home="${HOME:-/home/node}"

    if [ -z "${current_user}" ] || [ "${current_user}" = "unknown" ]; then
        current_user="${USER_NAME:-node}"
    fi

    if [ -z "${current_uid}" ] || [ -z "${current_gid}" ]; then
        _dc_dbg "could not determine current uid/gid; using /etc fallback"
        return 0
    fi

    passwd_tmp="$(mktemp "${base_dir}/passwd.tmp.XXXXXX" 2> /dev/null || printf '')"
    if [ -n "${passwd_tmp}" ]; then
        if [ -r /etc/passwd ]; then
            cat /etc/passwd > "${passwd_tmp}" 2> /dev/null || true
        fi

        if [ -s "${passwd_tmp}" ] && ! awk -F: -v uid="${current_uid}" '($3 == uid) { found=1 } END { exit found ? 0 : 1 }' "${passwd_tmp}" 2> /dev/null; then
            printf '%s:x:%s:%s:%s user:%s:/bin/bash\n' \
                "${current_user}" "${current_uid}" "${current_gid}" "${current_user}" "${current_home}" \
                >> "${passwd_tmp}" 2> /dev/null || true
        fi

        if [ -s "${passwd_tmp}" ]; then
            mv -f "${passwd_tmp}" "${passwd_file}" 2> /dev/null || rm -f "${passwd_tmp}" 2> /dev/null || true
        else
            rm -f "${passwd_tmp}" 2> /dev/null || true
        fi
    else
        _dc_dbg "could not create passwd tmp file in ${base_dir}; using /etc fallback"
    fi

    group_tmp="$(mktemp "${base_dir}/group.tmp.XXXXXX" 2> /dev/null || printf '')"
    if [ -n "${group_tmp}" ]; then
        if [ -r /etc/group ]; then
            cat /etc/group > "${group_tmp}" 2> /dev/null || true
        fi

        if [ -s "${group_tmp}" ] && ! awk -F: -v gid="${current_gid}" '($3 == gid) { found=1 } END { exit found ? 0 : 1 }' "${group_tmp}" 2> /dev/null; then
            printf '%s:x:%s:\n' "${current_user}" "${current_gid}" >> "${group_tmp}" 2> /dev/null || true
        fi

        if [ -s "${group_tmp}" ]; then
            mv -f "${group_tmp}" "${group_file}" 2> /dev/null || rm -f "${group_tmp}" 2> /dev/null || true
        else
            rm -f "${group_tmp}" 2> /dev/null || true
        fi
    else
        _dc_dbg "could not create group tmp file in ${base_dir}; using /etc fallback"
    fi

    chmod 600 "${passwd_file}" "${group_file}" 2> /dev/null || true
    _dc_dbg "fallback NSS artifacts seeded if writable: ${base_dir}"
    return 0
}

_sanitize_account_name() {
    # POSIX-ish account name sanitizer for synthetic fallback entries.
    # Accepts common Linux account-name characters; otherwise falls back to node.
    local raw
    raw="${1:-}"

    case "${raw}" in
        "" | *[!A-Za-z0-9_.-]* | -* | .*)
            printf '%s\n' "node"
            ;;
        *)
            printf '%s\n' "${raw}"
            ;;
    esac
}

_ensure_current_identity_in_artifacts() {
    # Best-effort support for arbitrary UID/GID runtimes.
    #
    # Safety rules:
    #   • never write directly to predictable *.identity.$$ paths;
    #   • never attempt mutation unless artifacts are readable and base_dir is writable;
    #   • use mktemp inside the runtime NSS dir to avoid permission-denied noise;
    #   • fail closed to /etc fallback rather than emitting startup errors.
    local base_dir passwd_file group_file
    local current_uid current_gid current_name current_home current_shell
    local group_name passwd_tmp group_tmp

    base_dir="${DEVCONTAINER_NSS_DIR:-/tmp/devcontainer-nss}"
    passwd_file="${base_dir}/passwd"
    group_file="${base_dir}/group"

    if [ ! -r "${passwd_file}" ] || [ ! -s "${passwd_file}" ] \
        || [ ! -r "${group_file}" ] || [ ! -s "${group_file}" ]; then
        _dc_dbg "identity ensure skipped; NSS artifacts are not readable/non-empty"
        return 0
    fi

    if [ ! -d "${base_dir}" ] || [ ! -w "${base_dir}" ]; then
        _dc_dbg "identity ensure skipped; NSS base dir is not writable: ${base_dir}"
        return 0
    fi

    current_uid="$(id -u 2> /dev/null || printf '')"
    current_gid="$(id -g 2> /dev/null || printf '')"

    case "${current_uid}" in "" | *[!0-9]*) return 0 ;; esac
    case "${current_gid}" in "" | *[!0-9]*) return 0 ;; esac

    current_name="$(_sanitize_account_name "${USER_NAME:-${REMOTE_USER:-${USER:-node}}}")"
    current_home="${HOME:-/home/${current_name}}"
    current_shell="${SHELL:-/bin/bash}"

    if ! awk -F: -v uid="${current_uid}" '($3 == uid){found=1} END{exit found ? 0 : 1}' "${passwd_file}" 2> /dev/null; then
        if awk -F: -v name="${current_name}" '($1 == name){found=1} END{exit found ? 0 : 1}' "${passwd_file}" 2> /dev/null; then
            current_name="devcontainer-${current_uid}"
        fi

        passwd_tmp="$(mktemp "${base_dir}/passwd.identity.XXXXXX" 2> /dev/null || printf '')"
        if [ -n "${passwd_tmp}" ]; then
            if cat "${passwd_file}" > "${passwd_tmp}" 2> /dev/null; then
                printf '%s:x:%s:%s:DevContainer User:%s:%s\n' \
                    "${current_name}" "${current_uid}" "${current_gid}" "${current_home}" "${current_shell}" \
                    >> "${passwd_tmp}" 2> /dev/null || true

                if [ -s "${passwd_tmp}" ]; then
                    mv -f "${passwd_tmp}" "${passwd_file}" 2> /dev/null || rm -f "${passwd_tmp}" 2> /dev/null || true
                    chmod 600 "${passwd_file}" 2> /dev/null || true
                    _dc_dbg "synthetic passwd identity added for uid=${current_uid}"
                else
                    rm -f "${passwd_tmp}" 2> /dev/null || true
                fi
            else
                rm -f "${passwd_tmp}" 2> /dev/null || true
            fi
        else
            _dc_dbg "identity ensure skipped; could not create passwd temp file"
        fi
    fi

    if ! awk -F: -v gid="${current_gid}" '($3 == gid){found=1} END{exit found ? 0 : 1}' "${group_file}" 2> /dev/null; then
        group_name="$(_sanitize_account_name "${current_name}")"
        if awk -F: -v name="${group_name}" '($1 == name){found=1} END{exit found ? 0 : 1}' "${group_file}" 2> /dev/null; then
            group_name="devcontainer-group-${current_gid}"
        fi

        group_tmp="$(mktemp "${base_dir}/group.identity.XXXXXX" 2> /dev/null || printf '')"
        if [ -n "${group_tmp}" ]; then
            if cat "${group_file}" > "${group_tmp}" 2> /dev/null; then
                printf '%s:x:%s:\n' "${group_name}" "${current_gid}" >> "${group_tmp}" 2> /dev/null || true

                if [ -s "${group_tmp}" ]; then
                    mv -f "${group_tmp}" "${group_file}" 2> /dev/null || rm -f "${group_tmp}" 2> /dev/null || true
                    chmod 600 "${group_file}" 2> /dev/null || true
                    _dc_dbg "synthetic group identity added for gid=${current_gid}"
                else
                    rm -f "${group_tmp}" 2> /dev/null || true
                fi
            else
                rm -f "${group_tmp}" 2> /dev/null || true
            fi
        else
            _dc_dbg "identity ensure skipped; could not create group temp file"
        fi
    fi

    return 0
}

_normalize_nss_bindings_to_existing_files() {
    local base_dir passwd_file group_file

    base_dir="${DEVCONTAINER_NSS_DIR:-/tmp/devcontainer-nss}"
    passwd_file="${base_dir}/passwd"
    group_file="${base_dir}/group"

    if [ -n "${NSS_WRAPPER_PASSWD:-}" ] && [ -n "${NSS_WRAPPER_GROUP:-}" ] \
        && [ -r "${NSS_WRAPPER_PASSWD}" ] && [ -s "${NSS_WRAPPER_PASSWD}" ] \
        && [ -r "${NSS_WRAPPER_GROUP}" ] && [ -s "${NSS_WRAPPER_GROUP}" ]; then
        _dc_dbg "NSS_WRAPPER_PASSWD/GROUP already valid"
        return 0
    fi

    if [ -r "${passwd_file}" ] && [ -s "${passwd_file}" ] \
        && [ -r "${group_file}" ] && [ -s "${group_file}" ]; then
        export NSS_WRAPPER_PASSWD="${passwd_file}"
        export NSS_WRAPPER_GROUP="${group_file}"
        _dc_dbg "NSS bindings set to runtime artifacts"
        return 0
    fi

    if [ -r /etc/passwd ] && [ -r /etc/group ]; then
        export NSS_WRAPPER_PASSWD="/etc/passwd"
        export NSS_WRAPPER_GROUP="/etc/group"
        _dc_dbg "NSS bindings set to stable /etc baseline"
        return 0
    fi

    unset NSS_WRAPPER_PASSWD 2> /dev/null || true
    unset NSS_WRAPPER_GROUP 2> /dev/null || true
    _dc_dbg "NSS bindings unavailable; unset"
    return 0
}

_validate_final_state() {
    local token ifs_save found_nss

    found_nss=0

    if [ -n "${LD_PRELOAD:-}" ]; then
        case "${LD_PRELOAD}" in
            :* | *: | *::*)
                _dc_warn "LD_PRELOAD contains empty token(s): '${LD_PRELOAD}'"
                ;;
        esac

        if [ "${#LD_PRELOAD}" -gt 4096 ]; then
            _dc_warn "LD_PRELOAD length ${#LD_PRELOAD} exceeds kernel preload limit; may be truncated"
        fi

        ifs_save="${IFS}"
        IFS=":"
        for token in ${LD_PRELOAD}; do
            [ -z "${token}" ] && continue

            case "${token}" in
                libnss_wrapper.so)
                    _dc_warn "LD_PRELOAD still contains relative libnss_wrapper.so; canonicalization failed"
                    ;;
                */libnss_wrapper.so)
                    found_nss=1
                    if [ ! -r "${token}" ]; then
                        _dc_warn "LD_PRELOAD NSS wrapper path is not readable: ${token}"
                    fi
                    ;;
            esac
        done
        IFS="${ifs_save}"
    fi

    if [ "${found_nss}" -eq 1 ]; then
        if [ -z "${NSS_WRAPPER_PASSWD:-}" ] || [ -z "${NSS_WRAPPER_GROUP:-}" ]; then
            _dc_warn "NSS wrapper preloaded but NSS_WRAPPER_PASSWD/GROUP not fully set"
        elif [ ! -r "${NSS_WRAPPER_PASSWD}" ] || [ ! -s "${NSS_WRAPPER_PASSWD}" ] \
            || [ ! -r "${NSS_WRAPPER_GROUP}" ] || [ ! -s "${NSS_WRAPPER_GROUP}" ]; then
            _dc_warn "NSS wrapper bindings point to unreadable, empty or missing files"
        fi
    fi

    _dc_dbg "final NSS_WRAPPER_PASSWD=${NSS_WRAPPER_PASSWD:-<unset>}"
    _dc_dbg "final NSS_WRAPPER_GROUP=${NSS_WRAPPER_GROUP:-<unset>}"
    return 0
}

_safe_source_profile() {
    local profile_file

    # Canonical policy:
    #   Source only the immutable image-level profile.
    #
    # Do NOT source `${DEVCONTAINER_NSS_DIR}/10-gatekeeper-nss.sh`.
    # DEVCONTAINER_NSS_DIR normally points to /tmp/devcontainer-nss, a runtime
    # location. Loading shell code from there would turn a data directory into a
    # code execution surface. The runtime dir may contain passwd/group artifacts,
    # but not executable policy.
    profile_file="/etc/profile.d/10-gatekeeper-nss.sh"

    if [ ! -r "${profile_file}" ]; then
        _dc_dbg "profile not readable: ${profile_file}"
        return 0
    fi

    _dc_dbg "sourcing immutable profile: ${profile_file}"

    # shellcheck disable=SC1090
    if [ -n "${DEVCONTAINER_NSS_DEBUG:-}" ]; then
        # Preserve stderr debug emitted by the profile, but keep stdout clean.
        . "${profile_file}" > /dev/null || true
    else
        # Fully quiet in normal operation.
        . "${profile_file}" > /dev/null 2>&1 || true
    fi

    return 0
}

if [ "$#" -lt 1 ]; then
    printf '%s\n' "[${SCRIPT_NAME}] ERROR: no command provided" >&2
    exit 127
fi

if [ -n "${DEVCONTAINER_SKIP_NSS:-}" ]; then
    _dc_dbg "bypass requested via DEVCONTAINER_SKIP_NSS"
    exec "$@"
fi

export DEVCONTAINER_NSS_DIR="${DEVCONTAINER_NSS_DIR:-/tmp/devcontainer-nss}"

_dc_dbg "version=${SCRIPT_VERSION}"
_dc_dbg "initial LD_PRELOAD=${LD_PRELOAD:-<unset>}"
_dc_dbg "DEVCONTAINER_NSS_DIR=${DEVCONTAINER_NSS_DIR}"

# 1. Canonicalize immediately. This is the critical fix for non-login processes
#    that inherit LD_PRELOAD=libnss_wrapper.so from containerEnv/remoteEnv.
_canonicalize_ld_preload || true

# 2. Seed artifacts so profile activation has stable non-empty files.
_seed_nss_artifacts_if_missing || true

# 3. Ensure arbitrary UID/GID runtimes have a resolvable identity in artifacts.
_ensure_current_identity_in_artifacts || true

# 4. Normalize bindings to valid files before profile.d has a chance to refine.
_normalize_nss_bindings_to_existing_files || true

# 5. Source profile.d as a secondary immutable layer. The profile may decide to
#    switch NSS_WRAPPER_PASSWD/GROUP to runtime artifacts and may touch LD_PRELOAD.
_safe_source_profile || true

# 6. Canonicalize again after profile sourcing, because the profile or inherited
#    environment may have reintroduced a relative or duplicate NSS token.
_canonicalize_ld_preload || true

# 7. Ensure NSS bindings still point at existing files after all transformations.
_normalize_nss_bindings_to_existing_files || true

# 8. Final non-fatal diagnostics.
_validate_final_state || true

exec "$@"
