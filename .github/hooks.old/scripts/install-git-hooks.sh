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
    local timeout="${3:-45}"  # default 45s timeout
    printf "  %-30s " "$label..."
    # BUG-FIX-PRECOMMIT: Add timeout to prevent hanging gates
    if timeout "$timeout" bash -c "eval '$cmd'" > "$GATE_OUTPUT" 2>&1; then
        echo "✓"
    else
        local exit_code=$?
        if [ "$exit_code" -eq 124 ]; then
            echo "⏱ timeout (${timeout}s) — gate pulado"
        else
            echo "✗ FALHOU"
            echo ""
            echo "  Saída de erro:"
            sed 's/^/    /' "$GATE_OUTPUT" | head -20
            echo ""
            FAILED=$(( FAILED + 1 ))
        fi
    fi
}

run_gate "lint (ESLint)"    "npm run lint --silent"

# BUG-FIX-PRECOMMIT: Skip format:check if only shell/bash/docs files were modified
# (Prettier doesn't format .sh files, so no point in running it)
_STAGED_FILES="$(git diff --cached --name-only 2> /dev/null || true)"
_HAS_PRETTIER_FILES="$(echo "$_STAGED_FILES" | grep -E '\.(js|jsx|ts|tsx|json|md|yaml|yml)$' || true)"
if [ -n "$_HAS_PRETTIER_FILES" ]; then
    run_gate "format:check"     "npm run format:check --silent" 30  # 30s timeout for format
else
    echo "  format:check... ⊘ skipped (no JS/TS/JSON/YAML/MD files staged)"
fi

run_gate "typecheck:node"   "npm run typecheck:node --silent" 45

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

# ── Instala pre-push (registra push no sistema de hooks) ─────────────────────
PRE_PUSH_SCRIPT="$GIT_HOOKS_DIR/pre-push"
HOOKS_SCRIPT_DIR="$PROJECT_DIR/.github/hooks/scripts"

cat > "$PRE_PUSH_SCRIPT" << HOOK_EOF
#!/bin/bash
# pre-push — Registra git push no sistema de hooks do agente.
# Instalado por: .github/hooks/scripts/install-git-hooks.sh
# Dispara on-git-push.sh que loga gitPush e define pending_section_after_push.
# NOTA: pre-push é hook Git válido; recebe remote em \$1, URL em \$2, refs via stdin.
set -euo pipefail

ON_PUSH_SCRIPT="${HOOKS_SCRIPT_DIR}/on-git-push.sh"
if [ -f "\$ON_PUSH_SCRIPT" ]; then
    REMOTE="\${1:-origin}"
    # Lê a primeira linha de stdin (format: local-ref local-sha remote-ref remote-sha)
    read -r LOCAL_REF LOCAL_SHA REMOTE_REF REMOTE_SHA < /dev/stdin 2> /dev/null || true
    BRANCH="\${REMOTE_REF##*/}"
    bash "\$ON_PUSH_SCRIPT" --branch "\$BRANCH" --remote "\$REMOTE" 2>&1 || true
fi
exit 0
HOOK_EOF

chmod +x "$PRE_PUSH_SCRIPT"
echo "✓ pre-push instalado em: $PRE_PUSH_SCRIPT"

echo ""
echo "✅ Git hooks instalados com sucesso."
echo "   • pre-commit: lint + format:check + typecheck:node"
echo "   • commit-msg: validação Conventional Commits"
echo "   • pre-push:   registra push no sistema de hooks (on-git-push.sh)"
echo ""
echo "   Para desinstalar manualmente:"
echo "     rm .git/hooks/pre-commit .git/hooks/commit-msg .git/hooks/pre-push"
echo ""
echo "   Para pular em emergência (não abusar!):"
echo "     git commit --no-verify -m 'mensagem'"
echo ""
exit 0
