#!/usr/bin/env bash
# subagent-start.sh — Wrapper para o SubagentStart hook
# Thin wrapper: toda lógica está em lib/subagent-lib.sh
set -euo pipefail
INPUT=$(cat)
SUBAGENT_EVENT="start"
export SUBAGENT_EVENT
source "$(cd "$(dirname "$0")/../lib" && pwd)/subagent-lib.sh"
main "$INPUT"
