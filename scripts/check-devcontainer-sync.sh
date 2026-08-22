#!/usr/bin/env bash
# Check if DevContainer config changes require reload

set -euo pipefail

readonly GLOBAL_JSONC_PARSER="/home/node/.npm-global/lib/node_modules/jsonc-parser"
readonly SYSTEM_JSONC_PARSER="/usr/local/share/npm-global/lib/node_modules/jsonc-parser"

LATEST_CHANGED_FILE=""
LATEST_CHANGED_TS=0
LATEST_CHANGED_KIND="unknown"

has_command() {
    command -v "$1" > /dev/null 2>&1
}

classify_asset_kind() {
    local path="$1"
    case "$path" in
        */Dockerfile | */nss-gatekeeper.sh)
            printf '%s\n' "rebuild"
            ;;
        */devcontainer.json)
            printf '%s\n' "reload_or_rebuild"
            ;;
        */post-attach.sh)
            printf '%s\n' "reload"
            ;;
        */post-start.sh)
            printf '%s\n' "restart_or_manual"
            ;;
        */post-create.sh)
            printf '%s\n' "recreate_or_manual"
            ;;
        */scripts/*)
            printf '%s\n' "reload"
            ;;
        *)
            printf '%s\n' "reload_or_rebuild"
            ;;
    esac
}

resolve_workspace() {
    if has_command git; then
        git rev-parse --show-toplevel 2> /dev/null && return 0
    fi

    if [ -n "${DEVCONTAINER_WORKSPACE_FOLDER:-}" ] && [ -d "${DEVCONTAINER_WORKSPACE_FOLDER}" ]; then
        printf '%s\n' "${DEVCONTAINER_WORKSPACE_FOLDER}"
        return 0
    fi

    pwd
}

track_latest_asset() {
    local path="$1"
    local ts=""

    [ -f "$path" ] || return 0
    ts="$(stat -c '%Y' "$path" 2> /dev/null || true)"
    [[ "$ts" =~ ^[0-9]+$ ]] || return 0

    if ((ts > LATEST_CHANGED_TS)); then
        LATEST_CHANGED_TS="$ts"
        LATEST_CHANGED_FILE="$path"
        LATEST_CHANGED_KIND="$(classify_asset_kind "$path")"
    fi
}

print_ports_from_jsonc() {
    local file_path="$1"

    node - "$file_path" << 'EOF'
const fs = require('node:fs');
const path = process.argv[2];
const candidates = [];
if (process.env.JSONC_PARSER_MODULE_PATH) {
  candidates.push(process.env.JSONC_PARSER_MODULE_PATH);
}
  candidates.push('/usr/local/share/npm-global/lib/node_modules/jsonc-parser', '/home/node/.npm-global/lib/node_modules/jsonc-parser', 'jsonc-parser');
let parser = null;
for (const candidate of candidates) {
  try {
    parser = require(candidate);
    break;
  } catch {
  }
}
if (!parser) {
  process.exit(2);
}
const errors = [];
const source = fs.readFileSync(path, 'utf8');
const parsed = parser.parse(source, errors, { allowTrailingComma: true, disallowComments: false });
if (errors.length > 0 || !parsed || !Array.isArray(parsed.forwardPorts)) {
  process.exit(3);
}
for (const port of parsed.forwardPorts) {
  if (port === null || port === undefined) {
    continue;
  }
  console.log(String(port));
}
EOF
}

print_ports_with_fallback() {
    local file_path="$1"
    local port

    if print_ports_from_jsonc "$file_path" 2> /dev/null; then
        return 0
    fi

    sed -n '/"forwardPorts"[[:space:]]*:[[:space:]]*\[/,/\][[:space:]]*,\?[[:space:]]*$/p' "$file_path" 2> /dev/null \
        | grep -oE "[0-9]{4,5}" | while read -r port; do
        [ -n "$port" ] && printf '%s\n' "$port"
    done || true
}

echo "=========================================="
echo "DEVCONTAINER SYNC CHECK"
echo "=========================================="
echo ""

WORKSPACE_ROOT="$(resolve_workspace)"
DEVCONTAINER_FILE="${WORKSPACE_ROOT}/.devcontainer/devcontainer.json"
DOCKERFILE_PATH="${WORKSPACE_ROOT}/.devcontainer/Dockerfile"
NSS_GATEKEEPER_PATH="${WORKSPACE_ROOT}/.devcontainer/nss-gatekeeper.sh"

track_latest_asset "${DEVCONTAINER_FILE}"
track_latest_asset "${DOCKERFILE_PATH}"
track_latest_asset "${NSS_GATEKEEPER_PATH}"

while IFS= read -r asset; do
    track_latest_asset "${asset}"
done < <(find "${WORKSPACE_ROOT}/.devcontainer/scripts" -maxdepth 1 -type f 2> /dev/null | sort)

# Get VS Code server start time
VSCODE_PID="$(
    pgrep -f '(.vscode-server|code-server|server-main)' 2> /dev/null \
        | head -1 || true
)"
if [ -n "$VSCODE_PID" ]; then
    VSCODE_UPTIME="$(ps -p "$VSCODE_PID" -o etime= 2> /dev/null | tr -d ' ' || true)"
    if [ -n "$VSCODE_UPTIME" ]; then
        echo "VS Code Server uptime: $VSCODE_UPTIME"
    else
        echo "VS Code Server uptime: unavailable"
    fi
else
    echo "Warning: VS Code server PID not found"
fi

if has_command devcontainer; then
    DEVCONTAINER_VERSION="$(devcontainer --version 2> /dev/null | head -1 || true)"
    [ -n "$DEVCONTAINER_VERSION" ] && echo "devcontainer CLI: $DEVCONTAINER_VERSION"
fi

# Get devcontainer.json modification time
if [ -f "$DEVCONTAINER_FILE" ]; then
    LAST_MODIFIED="$(stat -c '%y' "$DEVCONTAINER_FILE" | cut -d. -f1)"
    echo "devcontainer.json modified: $LAST_MODIFIED"
else
    echo "Error: devcontainer.json not found at $DEVCONTAINER_FILE"
    exit 1
fi

if [ -n "${LATEST_CHANGED_FILE}" ] && [ "${LATEST_CHANGED_FILE}" != "${DEVCONTAINER_FILE}" ]; then
    LATEST_CHANGED_HUMAN="$(stat -c '%y' "${LATEST_CHANGED_FILE}" 2> /dev/null | cut -d. -f1 || true)"
    echo "latest watched asset: ${LATEST_CHANGED_FILE#"${WORKSPACE_ROOT}"/}"
    [ -n "${LATEST_CHANGED_HUMAN}" ] && echo "latest watched mtime: $LATEST_CHANGED_HUMAN"
fi

if has_command jsonc-validate; then
    if jsonc-validate "$DEVCONTAINER_FILE" > /dev/null 2>&1; then
        echo "JSONC validation: OK"
    else
        rc=$?
        case "$rc" in
            2 | 69)
                echo "JSONC validation: fallback mode (jsonc-validate present but parser module missing)"
                ;;
            3 | 65)
                echo "Error: devcontainer.json is not valid JSONC"
                exit 1
                ;;
            *)
                echo "Warning: jsonc-validate returned unexpected exit code ($rc); using fallback mode"
                ;;
        esac
    fi
elif [ -d "$SYSTEM_JSONC_PARSER" ]; then
    echo "JSONC parser module detected: $SYSTEM_JSONC_PARSER"
elif [ -d "$GLOBAL_JSONC_PARSER" ]; then
    echo "JSONC parser module detected: $GLOBAL_JSONC_PARSER"
else
    echo "JSONC validation: fallback mode (jsonc-validate not installed in this container yet)"
fi

echo ""
echo "=========================================="
echo "PORT FORWARDING STATUS"
echo "=========================================="
echo ""

echo "Ports declared in devcontainer.json:"
PORTS_OUTPUT="$(print_ports_with_fallback "$DEVCONTAINER_FILE")"
if [ -n "$PORTS_OUTPUT" ]; then
    while read -r port; do
        [ -n "$port" ] && echo "  - Port $port"
    done < <(printf '%s\n' "$PORTS_OUTPUT" | awk 'NF && !seen[$0]++')
else
    echo "  - No forwardPorts detected"
fi

echo ""
echo "=========================================="
echo "RECOMMENDATION"
echo "=========================================="
echo ""

if [ -n "$VSCODE_PID" ]; then
    UPTIME_SECONDS="$(ps -p "$VSCODE_PID" -o etimes= 2> /dev/null | tr -d ' ' || true)"
    if [ -z "$UPTIME_SECONDS" ]; then
        echo "Warning: could not determine VS Code uptime precisely"
        echo "Reload the window if you changed devcontainer.json after startup."
        echo "=========================================="
        exit 0
    fi
    VSCODE_START_TIMESTAMP="$(($(date +%s) - UPTIME_SECONDS))"

    if [ "${LATEST_CHANGED_TS:-0}" -gt "$VSCODE_START_TIMESTAMP" ]; then
        echo "Warning: watched DevContainer assets changed after VS Code started"
        echo ""
        if [ -n "${LATEST_CHANGED_FILE}" ]; then
            echo "Latest changed asset: ${LATEST_CHANGED_FILE#"${WORKSPACE_ROOT}"/}"
            echo "Likely action class: ${LATEST_CHANGED_KIND}"
            echo ""
        fi
        echo "Options to apply changes:"
        echo ""
        echo "1. Reload Window"
        echo "   Use when the latest change was devcontainer.json or post-attach-like UX assets."
        echo "   Ctrl+Shift+P -> Developer: Reload Window"
        echo ""
        echo "2. Restart Container / rerun hook"
        echo "   Use when the latest change was post-start/post-create logic in workspace scripts."
        echo "   Restart container, or run the specific script manually if you know the impact."
        echo ""
        echo "3. Rebuild Container"
        echo "   Required when the change touched Dockerfile, entrypoint/gatekeeper, containerEnv,"
        echo "   mounts, runArgs, remoteEnv, or image-level tooling."
        echo ""
    else
        echo "OK: config is in sync"
        echo ""
        echo "Port forwarding should be automatic."
        echo "If not, either forward the port manually or reload the window."
    fi
fi

echo "=========================================="

exit 0
