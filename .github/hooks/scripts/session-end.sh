#!/usr/bin/env bash
# session-end.sh — Handler para o evento SessionEnd (GAP-60)
# Thin wrapper: loga o evento de encerramento da sessão no audit.jsonl
set -euo pipefail

INPUT=$(cat)
HOOKS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LIB_DIR="$HOOKS_DIR/lib"

# shellcheck source=../lib/common.sh
source "$LIB_DIR/common.sh"
# shellcheck source=../lib/hook-payload-api.sh
source "$LIB_DIR/hook-payload-api.sh"

hook_api_parse "$INPUT" || true

hook_log_audit "sessionEnd_received" \
    "session_id" "${HOOK_SESSION_ID:-unknown}" \
    "event" "SessionEnd"

# Não emite output — SessionEnd é evento de notificação (read-only)
exit 0
