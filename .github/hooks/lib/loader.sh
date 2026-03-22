#!/usr/bin/env bash
# loader.sh — Carregador centralizado da camada de biblioteca dos hooks
#
# R-11: garante a ordem correta de carregamento:
#   1. common.sh    — state CRUD, audit, turn lifecycle, utils
#   2. hook-payload-api.sh — módulos api/01-16, parsing de payload
#
# Uso: em qualquer *-lib.sh, substitua os dois source calls por:
#   source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/loader.sh"
#
# Idempotente: verifica _HOOKS_COMMON_LOADED / _HOOKS_API_LOADED para evitar
# double-source em contextos de teste onde múltiplos scripts são sourceados.
#
# Não usar set -euo pipefail (é sourceado, não executado).

_LOADER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1) common.sh — sempre primeiro
if [ -z "${_HOOKS_COMMON_LOADED:-}" ]; then
    # shellcheck source=common.sh
    source "${_LOADER_DIR}/common.sh"
    _HOOKS_COMMON_LOADED=1
fi

# 2) hook-payload-api.sh — após common.sh (usa HOOK_DIR definido lá)
if [ -z "${_HOOKS_API_LOADED:-}" ]; then
    # shellcheck source=hook-payload-api.sh
    source "${_LOADER_DIR}/hook-payload-api.sh"
    _HOOKS_API_LOADED=1
fi
