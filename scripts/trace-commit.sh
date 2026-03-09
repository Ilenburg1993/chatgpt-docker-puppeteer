#!/bin/bash
# trace-commit.sh — Rastrear commit por SHA ou SHA curto (8 chars)
#
# Busca metadados de session/section/turn associados a um commit específico.
# Os metadados são registrados pelo hook .git/hooks/post-commit em:
#   .git/commit-metadata/<SHA_SHORT>.json
# E também indexados em .github/hooks/logs/audit.jsonl via evento "commitMetadata".
#
# Uso:
#   bash scripts/trace-commit.sh <SHA>            # lookup por SHA (completo ou curto)
#   bash scripts/trace-commit.sh --recent [N]     # mostra os N commits mais recentes (padrão: 10)
#   bash scripts/trace-commit.sh --session <SID>  # filtra por session_id no audit.jsonl
#   bash scripts/trace-commit.sh --section <SID>  # filtra por section_id no audit.jsonl
#
# Exemplos:
#   bash scripts/trace-commit.sh 95e73001
#   bash scripts/trace-commit.sh --recent 5
#   bash scripts/trace-commit.sh --session sess_20260310_abc123

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2> /dev/null || pwd)"
METADATA_DIR="$REPO_ROOT/.git/commit-metadata"
AUDIT_FILE="$REPO_ROOT/.github/hooks/logs/audit.jsonl"

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

_usage() {
    echo -e "${BOLD}trace-commit.sh${RESET} — Rastrear metadados de session/section/turn por commit"
    echo ""
    echo "Uso:"
    echo "  bash scripts/trace-commit.sh <SHA>            # lookup por SHA"
    echo "  bash scripts/trace-commit.sh --recent [N]     # N commits recentes (padrão: 10)"
    echo "  bash scripts/trace-commit.sh --session <SID>  # filtra por session_id"
    echo "  bash scripts/trace-commit.sh --section <SID>  # filtra por section_id"
    echo ""
    exit 0
}

_print_commit_metadata() {
    local file="$1"
    if [ ! -f "$file" ]; then
        echo -e "${RED}Arquivo não encontrado: $file${RESET}" >&2
        return 1
    fi
    local sha sha_short branch ts msg session_id section_id section_name section_number turn_id turn_number intent
    sha="$(jq -r '.sha // "?"' "$file")"
    sha_short="$(jq -r '.sha_short // "?"' "$file")"
    branch="$(jq -r '.branch // "?"' "$file")"
    ts="$(jq -r '.timestamp // "?"' "$file")"
    msg="$(jq -r '.commit_message // "?"' "$file")"
    session_id="$(jq -r '.session_id // "—"' "$file")"
    section_id="$(jq -r '.section_id // "—"' "$file")"
    section_name="$(jq -r '.section_name // "—"' "$file")"
    section_number="$(jq -r '.section_number // 0' "$file")"
    turn_id="$(jq -r '.turn_id // "—"' "$file")"
    turn_number="$(jq -r '.turn_number // 0' "$file")"
    intent="$(jq -r '.intent // "—"' "$file")"

    echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo -e "${BOLD}Commit:${RESET}   ${GREEN}${sha_short}${RESET} (${sha})"
    echo -e "${BOLD}Branch:${RESET}   ${branch}"
    echo -e "${BOLD}Data:${RESET}     ${ts}"
    echo -e "${BOLD}Mensagem:${RESET} ${msg}"
    echo -e "${CYAN}──── Contexto de Sessão ────────────────────────────────────${RESET}"
    echo -e "${BOLD}Session:${RESET}  ${session_id}"
    echo -e "${BOLD}Section:${RESET}  #${section_number} \"${section_name}\" (${section_id})"
    echo -e "${BOLD}Turn:${RESET}     #${turn_number} (${turn_id})"
    echo -e "${BOLD}Intenção:${RESET} ${intent}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
}

_lookup_sha() {
    local sha_input="$1"
    local sha_short="${sha_input:0:40}"

    # Valida: aceita apenas caracteres hexadecimais (previne path traversal)
    if [[ ! "$sha_short" =~ ^[0-9a-fA-F]{4,40}$ ]]; then
        echo -e "${RED}SHA inválido: '${sha_input}'. Use apenas caracteres hexadecimais [0-9a-f].${RESET}" >&2
        return 1
    fi
    sha_short="${sha_short:0:8}"

    # 1. Tenta arquivo de metadados direto
    local meta_file="$METADATA_DIR/${sha_short}.json"
    if [ -f "$meta_file" ]; then
        _print_commit_metadata "$meta_file"
        return 0
    fi

    # 2. Tenta via audit.jsonl
    if [ -f "$AUDIT_FILE" ]; then
        local found
        found="$(grep -F '"commitMetadata"' "$AUDIT_FILE" 2> /dev/null \
            | jq -c --arg sha "$sha_short" 'select(.sha == $sha or (.sha // "" | startswith($sha)))' 2> /dev/null \
            | tail -1 || true)"
        if [ -n "$found" ]; then
            echo -e "${YELLOW}Metadados via audit.jsonl (arquivo .json não encontrado):${RESET}"
            echo "$found" | jq '.'
            return 0
        fi
    fi

    echo -e "${RED}Commit '${sha_short}' não encontrado nos metadados.${RESET}" >&2
    echo -e "Dica: o hook post-commit só rastreia commits feitos com a sessão ativa." >&2
    return 1
}

_recent_commits() {
    local n="${1:-10}"
    # Valida que N é numérico (previne head -"abc" com set -e)
    if [[ ! "$n" =~ ^[0-9]+$ ]]; then
        echo -e "${YELLOW}Aviso: N='${n}' não é numérico — usando padrão 10.${RESET}" >&2
        n=10
    fi
    if [ ! -d "$METADATA_DIR" ]; then
        echo -e "${YELLOW}Diretório de metadados vazio: $METADATA_DIR${RESET}"
        echo "Nenhum commit foi rastreado ainda. O hook post-commit precisa estar ativo."
        return 0
    fi

    local files
    # Ordena por data de modificação (mais recente primeiro)
    mapfile -t files < <(find "$METADATA_DIR" -name '*.json' -printf '%T@\t%p\n' 2> /dev/null \
        | sort -rn | head -"$n" | cut -f2-)

    if [ ${#files[@]} -eq 0 ]; then
        echo -e "${YELLOW}Nenhum commit rastreado encontrado em: $METADATA_DIR${RESET}"
        return 0
    fi

    echo -e "${BOLD}Últimos ${n} commits rastreados:${RESET}"
    for f in "${files[@]}"; do
        _print_commit_metadata "$f"
    done
}

_filter_by_session() {
    local sid="$1"
    if [ ! -f "$AUDIT_FILE" ]; then
        echo -e "${YELLOW}audit.jsonl não encontrado.${RESET}" >&2
        return 1
    fi
    echo -e "${BOLD}Commits na sessão ${CYAN}${sid}${RESET}:"
    grep -F '"commitMetadata"' "$AUDIT_FILE" 2> /dev/null \
        | jq -c --arg sid "$sid" 'select(.session_id == $sid)' 2> /dev/null \
        | jq '.' || echo -e "${YELLOW}Nenhum commit encontrado para esta sessão.${RESET}"
}

_filter_by_section() {
    local sectionid="$1"
    if [ ! -f "$AUDIT_FILE" ]; then
        echo -e "${YELLOW}audit.jsonl não encontrado.${RESET}" >&2
        return 1
    fi
    echo -e "${BOLD}Commits na seção ${CYAN}${sectionid}${RESET}:"
    grep -F '"commitMetadata"' "$AUDIT_FILE" 2> /dev/null \
        | jq -c --arg sid "$sectionid" 'select(.section_id == $sid)' 2> /dev/null \
        | jq '.' || echo -e "${YELLOW}Nenhum commit encontrado para esta seção.${RESET}"
}

# ── Main ──────────────────────────────────────────────────────────────────────
if [ $# -eq 0 ]; then
    _usage
fi

case "${1:-}" in
    --help | -h)
        _usage
        ;;
    --recent)
        _recent_commits "${2:-10}"
        ;;
    --session)
        [ -z "${2:-}" ] && {
            echo "Erro: forneça um session_id" >&2
            exit 1
        }
        _filter_by_session "$2"
        ;;
    --section)
        [ -z "${2:-}" ] && {
            echo "Erro: forneça um section_id" >&2
            exit 1
        }
        _filter_by_section "$2"
        ;;
    -*)
        echo -e "${RED}Opção desconhecida: $1${RESET}" >&2
        _usage
        ;;
    *)
        _lookup_sha "$1"
        ;;
esac
