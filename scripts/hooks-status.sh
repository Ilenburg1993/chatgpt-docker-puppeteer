#!/bin/bash
# hooks-status.sh — Ponto de entrada para "npm run hooks:status".
# Exibe estado completo do sistema de hooks (backlog, tendências, performance,
# findings) e grava o relatório Markdown diário automaticamente.
#
# Uso: npm run hooks:status [-- --no-file] [-- --quiet]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DAILY_REPORT="$PROJECT_DIR/.github/hooks/scripts/generate-daily-report.sh"

# Suporte a args encaminhados via npm (npm run hooks:status -- --no-file)
EXTRA_ARGS=("$@")

if [ ! -f "$DAILY_REPORT" ]; then
    echo "ERRO: script não encontrado: $DAILY_REPORT" >&2
    exit 1
fi

bash "$DAILY_REPORT" "${EXTRA_ARGS[@]}"
exit 0
