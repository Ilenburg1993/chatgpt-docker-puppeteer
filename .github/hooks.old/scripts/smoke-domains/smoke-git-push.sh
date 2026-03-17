#!/bin/bash
# smoke-git-push.sh — checks do domínio git push / section transition.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh" "${1:-}"

ON_PUSH="$SCRIPTS_DIR/on-git-push.sh"
CONTINUE_SECTION="$SCRIPTS_DIR/continue-section.sh"
INSTALL_HOOKS="$SCRIPTS_DIR/install-git-hooks.sh"
AGENT_STOP="$SCRIPTS_DIR/agent-stop.sh"

section "[git-push] Arquivos"
require_file "$ON_PUSH" "on-git-push.sh"
require_file "$CONTINUE_SECTION" "continue-section.sh"
require_file "$INSTALL_HOOKS" "install-git-hooks.sh"
require_file "$AGENT_STOP" "agent-stop.sh"

section "[git-push] Fluxo e flags"
require_grep 'gitPush' "$ON_PUSH" "on-git-push registra evento gitPush" "on-git-push sem evento gitPush"
require_grep 'pending_section_after_push' "$ON_PUSH" "on-git-push define pending_section_after_push" "on-git-push sem pending_section_after_push"
require_grep 'pending_section_after_push' "$CONTINUE_SECTION" "continue-section limpa/usa pending_section_after_push" "continue-section sem pending_section_after_push"
require_grep 'pending_section_after_push' "$AGENT_STOP" "agent-stop observa pending_section_after_push" "agent-stop sem tratamento pending_section_after_push"
require_grep 'pre-push' "$INSTALL_HOOKS" "install-git-hooks cobre pre-push" "install-git-hooks sem pre-push"

summary_and_exit
