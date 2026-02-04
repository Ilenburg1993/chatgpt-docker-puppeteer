#!/usr/bin/env bash
# Check if DevContainer config changes require reload

set -euo pipefail

echo "=========================================="
echo "🔍 DEVCONTAINER SYNC CHECK"
echo "=========================================="
echo ""

# Get VS Code server start time
VSCODE_PID=$(pgrep -f vscode-server | head -1)
if [ -n "$VSCODE_PID" ]; then
    VSCODE_UPTIME=$(ps -p "$VSCODE_PID" -o etime= | tr -d ' ')
    echo "VS Code Server uptime: $VSCODE_UPTIME"
else
    echo "⚠️  VS Code server PID not found"
fi

# Get devcontainer.json modification time
DEVCONTAINER_FILE="/workspaces/chatgpt-docker-puppeteer/.devcontainer/devcontainer.json"
if [ -f "$DEVCONTAINER_FILE" ]; then
    LAST_MODIFIED=$(stat -c '%y' "$DEVCONTAINER_FILE" | cut -d. -f1)
    echo "devcontainer.json modified: $LAST_MODIFIED"
else
    echo "❌ devcontainer.json not found"
    exit 1
fi

echo ""
echo "=========================================="
echo "📋 PORT FORWARDING STATUS"
echo "=========================================="
echo ""

# Check forwardPorts in config
echo "Ports declared in devcontainer.json:"
grep -A 5 "forwardPorts" "$DEVCONTAINER_FILE" | grep -oE "[0-9]{4,5}" | while read -r port; do
    echo "  • Port $port"
done

echo ""
echo "=========================================="
echo "💡 RECOMMENDATION"
echo "=========================================="
echo ""

# VS Code uptime (aproximado em minutos)
if [ -n "$VSCODE_PID" ]; then
    UPTIME_SECONDS=$(ps -p "$VSCODE_PID" -o etimes= | tr -d ' ')
    FILE_MOD_TIMESTAMP=$(stat -c '%Y' "$DEVCONTAINER_FILE")
    VSCODE_START_TIMESTAMP=$(($(date +%s) - UPTIME_SECONDS))

    if [ "$VSCODE_START_TIMESTAMP" -lt "$FILE_MOD_TIMESTAMP" ]; then
        echo "⚠️  CONFIG WAS MODIFIED AFTER VS CODE STARTED"
        echo ""
        echo "Options to apply changes:"
        echo ""
        echo "1️⃣  FASTEST (10 seconds):"
        echo "    → Manual port forwarding (no reload needed)"
        echo "    → PORTS tab → [+] → 5173 → Enter"
        echo ""
        echo "2️⃣  RECOMMENDED (30 seconds):"
        echo "    → Reload Window to apply devcontainer.json"
        echo "    → Ctrl+Shift+P → 'Developer: Reload Window'"
        echo ""
        echo "3️⃣  SLOWEST (3-5 minutes) - NOT NEEDED:"
        echo "    → Rebuild Container (overkill for this)"
        echo ""
    else
        echo "✅ CONFIG IS IN SYNC"
        echo ""
        echo "Port forwarding should be automatic."
        echo "If not appearing, try:"
        echo "  → Manual forward: PORTS tab → [+] → 5173"
        echo "  → Or reload: Ctrl+Shift+P → 'Reload Window'"
    fi
fi

echo "=========================================="

exit 0
