#!/usr/bin/env bash
# =============================================================================
# nss-gatekeeper — robust entrypoint wrapper for NSS Wrapper activation (FINAL)
#
# Purpose:
#   Ensure /etc/profile.d/10-gatekeeper-nss.sh is applied even when the process
#   starts without a login/interactive shell (ENTRYPOINT/CMD bypass profile.d).
#
# Design contract (canonical):
#   • Fail-safe: never blocks container boot; never exits non-zero unless exec fails
#   • Single source of truth: /etc/profile.d/10-gatekeeper-nss.sh
#   • Seeds fallback NSS artifacts when absent; post-create.sh may refine them later
#   • Activates NSS only if the profile activates it (profile is artifact-gated)
#   • Preserves any pre-existing LD_PRELOAD while preventing duplication
#   • Avoids corrupting stdout/stderr of the real process
#
# Controls:
#   • DEVCONTAINER_SKIP_NSS=1      → bypass entirely
#   • DEVCONTAINER_NSS_DIR=...     → override artifact dir for tests/special workflows
#   • DEVCONTAINER_NSS_DEBUG=1     → diagnostic output to stderr
#
# Usage:
#   ENTRYPOINT ["/usr/local/bin/nss-gatekeeper"]
#   CMD ["node","src/main.js"]
# =============================================================================

set -euo pipefail

# ---- helpers ---------------------------------------------------------------

_dc_dbg() {
  if [[ -n "${DEVCONTAINER_NSS_DEBUG:-}" ]]; then
    echo "[nss-gatekeeper] $*" >&2
  fi
}

# normalize ":"-separated list: remove empties and dedupe preserving order
_dedupe_colon_list() {
  local input="${1:-}"
  local -a out=()

  # If associative arrays are not available (very old bash), fall back to O(n^2)
  if ! (declare -A __t 2>/dev/null); then
    local IFS=':'
    local tok existing found
    for tok in $input; do
      [[ -z "$tok" ]] && continue
      found=false
      for existing in "${out[@]:-}"; do
        [[ "$existing" == "$tok" ]] && found=true && break
      done
      [[ "$found" == "false" ]] && out+=("$tok")
    done
    (IFS=':'; echo "${out[*]:-}")
    return 0
  fi

  local -A seen=()
  local IFS=':'
  local tok
  for tok in $input; do
    [[ -z "$tok" ]] && continue
    if [[ -z "${seen[$tok]+x}" ]]; then
      seen["$tok"]=1
      out+=("$tok")
    fi
  done
  (IFS=':'; echo "${out[*]:-}")
}

# safe, non-fatal "source"
_safe_source() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  # shellcheck disable=SC1090
  . "$f" >/dev/null 2>&1 || true
}

_seed_nss_artifacts_if_missing() {
  local base_dir="${DEVCONTAINER_NSS_DIR}"
  local passwd_file="${base_dir}/passwd"
  local group_file="${base_dir}/group"
  local passwd_tmp="${passwd_file}.tmp"
  local group_tmp="${group_file}.tmp"

  if [[ -s "${passwd_file}" && -s "${group_file}" ]]; then
    _dc_dbg "artifacts already present"
    return 0
  fi

  mkdir -p "${base_dir}" 2>/dev/null || return 0
  chmod 700 "${base_dir}" 2>/dev/null || true

  if [[ -r /etc/passwd ]]; then
    cat /etc/passwd > "${passwd_tmp}" 2>/dev/null || true
    if [[ -s "${passwd_tmp}" ]]; then
      mv -f "${passwd_tmp}" "${passwd_file}" 2>/dev/null || true
    else
      rm -f "${passwd_tmp}" 2>/dev/null || true
    fi
  fi

  if [[ -r /etc/group ]]; then
    cat /etc/group > "${group_tmp}" 2>/dev/null || true
    if [[ -s "${group_tmp}" ]]; then
      mv -f "${group_tmp}" "${group_file}" 2>/dev/null || true
    else
      rm -f "${group_tmp}" 2>/dev/null || true
    fi
  fi

  chmod 600 "${passwd_file}" "${group_file}" 2>/dev/null || true
  _dc_dbg "fallback artifacts seeded (passwd/group)"
  return 0
}

# ---- main ------------------------------------------------------------------

# Must have a command
if [[ $# -lt 1 ]]; then
  echo "[nss-gatekeeper] ERROR: no command provided" >&2
  exit 127
fi

# Bypass if requested
if [[ -n "${DEVCONTAINER_SKIP_NSS:-}" ]]; then
  _dc_dbg "bypass (DEVCONTAINER_SKIP_NSS set)"
  exec "$@"
fi

# Canonical NSS artifact dir (override allowed for tests/special workflows)
export DEVCONTAINER_NSS_DIR="${DEVCONTAINER_NSS_DIR:-/tmp/devcontainer-nss}"

# Seed fallback artifacts early so later remote-exec / VS Code processes can
# safely preload nss_wrapper without racing a missing file.
_seed_nss_artifacts_if_missing || true

# Snapshot original env
OLD_LD_PRELOAD="${LD_PRELOAD:-}"
OLD_NSS_WRAPPER_PASSWD="${NSS_WRAPPER_PASSWD:-}"
OLD_NSS_WRAPPER_GROUP="${NSS_WRAPPER_GROUP:-}"

_dc_dbg "original LD_PRELOAD len=${#OLD_LD_PRELOAD}"

# Source canonical profile (single source of truth).
# Tests and special workflows may inject a local profile override in DEVCONTAINER_NSS_DIR.
PROFILE_FILE="/etc/profile.d/10-gatekeeper-nss.sh"
PROFILE_OVERRIDE="${DEVCONTAINER_NSS_DIR}/10-gatekeeper-nss.sh"
if [[ -f "${PROFILE_OVERRIDE}" ]]; then
  PROFILE_FILE="${PROFILE_OVERRIDE}"
fi
if [[ -f "${PROFILE_FILE}" ]]; then
  _dc_dbg "sourcing ${PROFILE_FILE}"
  _safe_source "${PROFILE_FILE}"
else
  _dc_dbg "profile not found: ${PROFILE_FILE} (skip)"
fi

# Determine whether the profile actually activated NSS
PROFILE_SET_NSS=false
[[ -n "${NSS_WRAPPER_PASSWD:-}" && -n "${NSS_WRAPPER_GROUP:-}" ]] && PROFILE_SET_NSS=true

# Basic validation (non-fatal)
if [[ "${PROFILE_SET_NSS}" == "true" ]]; then
  _dc_dbg "profile indicates NSS active"
  if [[ ! -s "${NSS_WRAPPER_PASSWD}" || ! -s "${NSS_WRAPPER_GROUP}" ]]; then
    # Artifacts missing/empty → revert to old values to avoid broken NSS
    _dc_dbg "artifacts missing/empty; reverting NSS env"
    NSS_WRAPPER_PASSWD="${OLD_NSS_WRAPPER_PASSWD}"
    NSS_WRAPPER_GROUP="${OLD_NSS_WRAPPER_GROUP}"
    export NSS_WRAPPER_PASSWD NSS_WRAPPER_GROUP
    PROFILE_SET_NSS=false
  fi
else
  _dc_dbg "profile did not activate NSS"
fi

# Preserve a copy of the post-profile preload for debugging/tests
if [[ -n "${LD_PRELOAD:-}" ]]; then
  export DEVCONTAINER_LD_PRELOAD_FROM_PROFILE="${LD_PRELOAD}"
fi

# Merge preloads: profile-preferred first, then original, then dedupe
# - If profile didn't set LD_PRELOAD, keep OLD_LD_PRELOAD as-is.
# - If both exist, join and dedupe.
FINAL_LD_PRELOAD=""
if [[ -n "${LD_PRELOAD:-}" && -n "${OLD_LD_PRELOAD}" ]]; then
  FINAL_LD_PRELOAD="$(_dedupe_colon_list "${LD_PRELOAD}:${OLD_LD_PRELOAD}")"
elif [[ -n "${LD_PRELOAD:-}" ]]; then
  FINAL_LD_PRELOAD="$(_dedupe_colon_list "${LD_PRELOAD}")"
else
  FINAL_LD_PRELOAD="$(_dedupe_colon_list "${OLD_LD_PRELOAD}")"
fi

# Apply final LD_PRELOAD (may be empty)
if [[ -n "${FINAL_LD_PRELOAD}" ]]; then
  export LD_PRELOAD="${FINAL_LD_PRELOAD}"
else
  unset LD_PRELOAD 2>/dev/null || true
fi

# Validate LD_PRELOAD string (non-fatal warnings only)
if [[ -n "${LD_PRELOAD:-}" ]]; then
  if [[ "${LD_PRELOAD}" == ":"* || "${LD_PRELOAD}" == *":" || "${LD_PRELOAD}" == *"::"* ]]; then
    echo "⚠️  [nss-gatekeeper] LD_PRELOAD contains empty token(s): '${LD_PRELOAD}'" >&2
  fi
  if (( ${#LD_PRELOAD} > 4096 )); then
    echo "⚠️  [nss-gatekeeper] LD_PRELOAD length ${#LD_PRELOAD} exceeds kernel limit; may be truncated" >&2
  fi
  _dc_dbg "final LD_PRELOAD len=${#LD_PRELOAD}"
fi

# Optional: emit a short status line if debug is enabled
if [[ -n "${DEVCONTAINER_NSS_DEBUG:-}" ]]; then
  _dc_dbg "NSS_WRAPPER_PASSWD='${NSS_WRAPPER_PASSWD:-}'"
  _dc_dbg "NSS_WRAPPER_GROUP='${NSS_WRAPPER_GROUP:-}'"
fi

# Execute real command
exec "$@"
