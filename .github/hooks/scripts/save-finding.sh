#!/usr/bin/env bash
# save-finding.sh — Registra finding (bug/gap/melhoria) em state/findings.md
#
# Uso: bash .github/hooks/scripts/save-finding.sh "módulo" "severity" "type" "descrição"
#
# severity: critical | high | medium | low | info
# type: bug | gap | improvement | security | performance
# Arquivo destino: state/findings.md

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib/common.sh
source "$HOOK_DIR/lib/common.sh"

MODULE="${1:-unknown}"
SEVERITY="${2:-medium}"
TYPE="${3:-bug}"
DESCRIPTION="${4:-}"

if [ -z "$DESCRIPTION" ]; then
    printf 'Uso: bash save-finding.sh "módulo" "severity" "type" "descrição"\n' >&2
    printf 'Severity: critical | high | medium | low | info\n' >&2
    printf 'Type: bug | gap | improvement | security | performance\n' >&2
    exit 1
fi

FINDINGS_FILE="$STATE_DIR/findings.md"
mkdir -p "$STATE_DIR"

# Cria o arquivo se não existir
if [ ! -f "$FINDINGS_FILE" ]; then
    cat > "$FINDINGS_FILE" << 'EOF'
# Findings

Achados registrados durante a sessão (bugs, gaps, melhorias).

EOF
fi

# Formata severity
case "$SEVERITY" in
    critical) SEV_LABEL="🔴 CRITICAL" ;;
    high) SEV_LABEL="🟠 HIGH" ;;
    medium) SEV_LABEL="🟡 MEDIUM" ;;
    low) SEV_LABEL="🟢 LOW" ;;
    info) SEV_LABEL="ℹ️ INFO" ;;
    *) SEV_LABEL="⚪ ${SEVERITY}" ;;
esac

# Formata type
case "$TYPE" in
    bug) TYPE_LABEL="🐛 Bug" ;;
    gap) TYPE_LABEL="🕳️ Gap" ;;
    improvement) TYPE_LABEL="⬆️ Improvement" ;;
    security) TYPE_LABEL="🔒 Security" ;;
    performance) TYPE_LABEL="⚡ Performance" ;;
    *) TYPE_LABEL="📋 ${TYPE}" ;;
esac

NOW=$(now_iso)

{
    printf '## [%s] [%s] %s — %s\n' "$SEV_LABEL" "$TYPE_LABEL" "$MODULE" "$NOW"
    printf '%s\n\n' "$DESCRIPTION"
} >> "$FINDINGS_FILE"

# Log no audit
if state_exists; then
    SESSION_ID=$(read_field ".session_id")
    export SESSION_ID
fi
log_audit "finding_saved" \
    "module" "$MODULE" \
    "severity" "$SEVERITY" \
    "type" "$TYPE"

printf '[save-finding] Finding registrado: [%s] [%s] %s\n' "$SEV_LABEL" "$TYPE_LABEL" "$MODULE"
