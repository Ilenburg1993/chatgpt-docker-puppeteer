#!/bin/bash
set -euo pipefail
# Compatibilidade histórica. O catálogo e a lógica vivem em Node para compartilhar a mesma SSOT do DevContainer.
exec node "$(dirname "$0")/install-vscode-extensions.mjs" "$@"
