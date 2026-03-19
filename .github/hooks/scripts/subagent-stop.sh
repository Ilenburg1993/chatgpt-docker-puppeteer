#!/usr/bin/env bash
# subagent-stop.sh — Wrapper para o SubagentStop hook
# Thin wrapper: toda lógica está em lib/subagent-lib.sh
set -euo pipefail
INPUT=$(cat)
SUBAGENT_EVENT="stop"
export SUBAGENT_EVENT
source "$(cd "$(dirname "$0")/../lib" && pwd)/subagent-lib.sh"
main "$INPUT"
