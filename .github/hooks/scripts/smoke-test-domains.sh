#!/bin/bash
# smoke-test-domains.sh — agregador de suítes smoke por domínio.
#
# Uso:
#   bash .github/hooks/scripts/smoke-test-domains.sh [--quiet]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOMAINS_DIR="$SCRIPT_DIR/smoke-domains"
QUIET="${1:-}"

DOMAINS=(
    "smoke-core.sh"
    "smoke-policy.sh"
    "smoke-recovery.sh"
    "smoke-close.sh"
    "smoke-git-push.sh"
)

TOTAL_FAILS=0

echo ""
echo "══════════════════════════════════════════════════"
echo "  Smoke Domains — Hooks"
echo "══════════════════════════════════════════════════"

for domain in "${DOMAINS[@]}"; do
    domain_path="$DOMAINS_DIR/$domain"
    echo ""
    echo "▶ Executando $domain"
    if [ ! -f "$domain_path" ]; then
        echo "  ✗ arquivo não encontrado: $domain"
        TOTAL_FAILS=$((TOTAL_FAILS + 1))
        continue
    fi

    if bash "$domain_path" "$QUIET"; then
        echo "  ✓ $domain concluído"
    else
        echo "  ✗ $domain com falhas"
        TOTAL_FAILS=$((TOTAL_FAILS + 1))
    fi
done

echo ""
echo "Resumo agregado: FAIL_DOMAINS=$TOTAL_FAILS"
exit "$TOTAL_FAILS"
