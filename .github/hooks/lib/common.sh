#!/usr/bin/env bash
# common.sh — Funções compartilhadas por todos os hooks
# Deve ser sourceado como PRIMEIRO passo de cada lib.
# Não usar set -euo pipefail aqui (libs são sourceadas, não executadas).

# ---------------------------------------------------------------------------
# Caminhos fundamentais (calculados a partir deste arquivo, independente do cwd)
# ---------------------------------------------------------------------------
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Permite override do diretório de state para testes (NUNCA usar em produção)
if [[ -n "${HOOKS_TEST_STATE_DIR:-}" ]]; then
    STATE_DIR="$HOOKS_TEST_STATE_DIR"
else
    STATE_DIR="$HOOK_DIR/state"
fi

# shellcheck disable=SC2034  # usadas pelos sub-módulos (utils, audit-lib, state-crud, etc.)
STATE_FILE="$STATE_DIR/session.json"
# shellcheck disable=SC2034
AUDIT_FILE="$STATE_DIR/audit.jsonl"

# R-14: Symlink canônico que sempre aponta para o audit ativo
# shellcheck disable=SC2034  # usada por audit-lib.sh
AUDIT_CURRENT_LINK="${HOOKS_AUDIT_LOG_DIR:-${HOOK_DIR}/logs}/audit-current.jsonl"

# ---------------------------------------------------------------------------
# Verificação de dependência crítica
# ---------------------------------------------------------------------------
if ! command -v jq > /dev/null 2>&1; then
    printf 'ERROR[hooks/common.sh]: jq is required but not installed\n' >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# R-06: Módulos delegados (common.sh agora é apenas um agregador)
# Ordem importa: utils → audit-lib → state-crud → turn-lifecycle → briefing
# utils.sh deve vir primeiro: define now_iso, make_close_key, sanitize_md, etc.
# audit-lib.sh antes de state-crud: init_state() chama _audit_update_symlink()
# ---------------------------------------------------------------------------
_COMMON_LIB_DIR="$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=utils.sh
source "${_COMMON_LIB_DIR}/utils.sh"
# shellcheck source=audit-lib.sh
source "${_COMMON_LIB_DIR}/audit-lib.sh"
# shellcheck source=state-crud.sh
source "${_COMMON_LIB_DIR}/state-crud.sh"
# shellcheck source=turn-lifecycle.sh
source "${_COMMON_LIB_DIR}/turn-lifecycle.sh"
# shellcheck source=briefing.sh
source "${_COMMON_LIB_DIR}/briefing.sh"
