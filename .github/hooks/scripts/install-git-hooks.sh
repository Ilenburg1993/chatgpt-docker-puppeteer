#!/bin/bash
# install-git-hooks.sh — Instala hooks de git localmente em .git/hooks/.
# Idempotente: pode ser rodado múltiplas vezes sem efeitos colaterais.
#
# Hooks instalados:
#   pre-commit: roda lint + format:check + typecheck:node antes de cada commit
#
# Uso:
#   bash .github/hooks/scripts/install-git-hooks.sh
#   npm run hooks:install-git
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
GIT_HOOKS_DIR="$PROJECT_DIR/.git/hooks"

if [ ! -d "$GIT_HOOKS_DIR" ]; then
    echo "ERRO: .git/hooks não encontrado. Execute dentro de um repositório git." >&2
    exit 1
fi

# ── Instala pre-commit ───────────────────────────────────────────────────────
PRE_COMMIT_SCRIPT="$GIT_HOOKS_DIR/pre-commit"

cat > "$PRE_COMMIT_SCRIPT" << 'HOOK_EOF'
#!/bin/bash
# pre-commit — Quality gates automáticos antes de cada commit.
# Instalado por: .github/hooks/scripts/install-git-hooks.sh
# Para pular (emergência): git commit --no-verify
set -euo pipefail

PROJECT_DIR="$(git rev-parse --show-toplevel)"
cd "$PROJECT_DIR"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                 PRE-COMMIT QUALITY GATES                     ║"
echo "╚══════════════════════════════════════════════════════════════╝"

FAILED=0
# Usa arquivo temporário único (seguro para commits paralelos)
GATE_OUTPUT="$(mktemp /tmp/pre-commit-gate-XXXXXX.txt)"
trap 'rm -f "$GATE_OUTPUT"' EXIT

run_gate() {
    local label="$1"
    local cmd="$2"
    printf "  %-30s " "$label..."
    if eval "$cmd" > "$GATE_OUTPUT" 2>&1; then
        echo "✓"
    else
        echo "✗ FALHOU"
        echo ""
        echo "  Saída de erro:"
        sed 's/^/    /' "$GATE_OUTPUT" | head -20
        echo ""
        FAILED=$(( FAILED + 1 ))
    fi
}

run_gate "lint (ESLint)"    "npm run lint --silent"
run_gate "format:check"     "npm run format:check --silent"
run_gate "typecheck:node"   "npm run typecheck:node --silent"

echo ""
if [ "$FAILED" -gt 0 ]; then
    echo "  ⚠ $FAILED gate(s) com problemas — commit liberado (modo informativo)."
    echo "  → Corrija quando possível. Use --no-verify para suprimir esta saída."
    echo ""
else
    echo "  ✓ Todos os gates passaram — commit autorizado."
    echo ""
fi
exit 0
HOOK_EOF

chmod +x "$PRE_COMMIT_SCRIPT"
echo "✓ pre-commit instalado em: $PRE_COMMIT_SCRIPT"

# ── Instala commit-msg (valida formato convencional) ─────────────────────────
COMMIT_MSG_SCRIPT="$GIT_HOOKS_DIR/commit-msg"

cat > "$COMMIT_MSG_SCRIPT" << 'HOOK_EOF'
#!/bin/bash
# commit-msg — Valida que a mensagem segue Conventional Commits.
# Tipos aceitos: feat, fix, refactor, chore, docs, test, style, perf, ci, build, revert
# Instalado por: .github/hooks/scripts/install-git-hooks.sh
set -euo pipefail

MSG_FILE="$1"
MSG="$(cat "$MSG_FILE")"

# Aceita merge commits, revert commits e WIP sem validar
if echo "$MSG" | grep -qE '^(Merge |Revert |WIP)'; then
    exit 0
fi

PATTERN='^(feat|fix|refactor|chore|docs|test|style|perf|ci|build|revert)(\(.+\))?: .{1,120}$'
FIRST_LINE="$(echo "$MSG" | head -1)"

if ! echo "$FIRST_LINE" | grep -qE "$PATTERN"; then
    echo ""
    echo "✗ Mensagem de commit inválida."
    echo "  Padrão obrigatório: <tipo>(<escopo opcional>): <descrição>"
    echo "  Tipos aceitos: feat, fix, refactor, chore, docs, test, style, perf, ci, build, revert"
    echo ""
    echo "  Exemplos:"
    echo "    feat(hooks): add daily report generation"
    echo "    fix: correct session-context stale state"
    echo "    chore: update dependencies"
    echo ""
    echo "  Sua mensagem: $FIRST_LINE"
    echo ""
    exit 1
fi

exit 0
HOOK_EOF

chmod +x "$COMMIT_MSG_SCRIPT"
echo "✓ commit-msg instalado em: $COMMIT_MSG_SCRIPT"

# ── Instala post-push (registra push no sistema de hooks) ────────────────────
POST_PUSH_SCRIPT="$GIT_HOOKS_DIR/post-push"
HOOKS_SCRIPT_DIR="$PROJECT_DIR/.github/hooks/scripts"

cat > "$POST_PUSH_SCRIPT" << HOOK_EOF
#!/bin/bash
# post-push — Registra git push no sistema de hooks do agente.
# Instalado por: .github/hooks/scripts/install-git-hooks.sh
# Dispara on-git-push.sh que loga gitPush e define pending_section_after_push.
set -euo pipefail

ON_PUSH_SCRIPT="${HOOKS_SCRIPT_DIR}/on-git-push.sh"
if [ -f "\$ON_PUSH_SCRIPT" ]; then
    REMOTE="\${1:-origin}"
    # Passa a primeira linha de stdin (format: local-ref local-sha remote-ref remote-sha)
    read -r LOCAL_REF LOCAL_SHA REMOTE_REF REMOTE_SHA < /dev/stdin 2> /dev/null || true
    BRANCH="\${REMOTE_REF##*/}"
    bash "\$ON_PUSH_SCRIPT" --branch "\$BRANCH" --remote "\$REMOTE" 2>&1 || true
fi
exit 0
HOOK_EOF

chmod +x "$POST_PUSH_SCRIPT"
echo "✓ post-push instalado em: $POST_PUSH_SCRIPT"

echo ""
echo "✅ Git hooks instalados com sucesso."
echo "   • pre-commit: lint + format:check + typecheck:node"
echo "   • commit-msg: validação Conventional Commits"
echo "   • post-push:  registra push no sistema de hooks (on-git-push.sh)"
echo ""
echo "   Para desinstalar manualmente:"
echo "     rm .git/hooks/pre-commit .git/hooks/commit-msg .git/hooks/post-push"
echo ""
echo "   Para pular em emergência (não abusar!):"
echo "     git commit --no-verify -m 'mensagem'"
echo ""
exit 0
