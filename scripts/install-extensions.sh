#!/bin/bash
# ============================================================
# Script de Instalação Automática de Extensões
# chatgpt-docker-puppeteer
# Versão: 1.0 (21/01/2026)
# ============================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=================================================="
echo "  INSTALADOR DE EXTENSÕES VS CODE"
echo "  chatgpt-docker-puppeteer"
echo -e "==================================================${NC}"
echo ""

# Verificar se o comando 'code' está disponível
if ! command -v code &> /dev/null; then
    echo -e "${RED}❌ ERRO: Comando 'code' não encontrado${NC}"
    echo ""
    echo "Você precisa instalar o VS Code CLI. Instruções:"
    echo "1. Abra o VS Code"
    echo "2. Ctrl+Shift+P → 'Shell Command: Install code command in PATH'"
    echo "3. Execute este script novamente"
    exit 1
fi

echo -e "${GREEN}✓ VS Code CLI encontrado${NC}"
echo ""

# Lista de extensões por prioridade
declare -A EXTENSIONS_CRITICAL=(
    ["dbaeumer.vscode-eslint"]="ESLint"
    ["esbenp.prettier-vscode"]="Prettier"
    ["ms-azuretools.vscode-docker"]="Docker"
    ["GitHub.copilot"]="GitHub Copilot"
    ["GitHub.copilot-chat"]="GitHub Copilot Chat"
    ["ms-vscode.makefile-tools"]="Makefile Tools"
)

declare -A EXTENSIONS_HIGH=(
    ["eamodio.gitlens"]="GitLens"
    ["usernamehw.errorlens"]="Error Lens"
    ["christian-kohler.path-intellisense"]="Path Intellisense"
    ["christian-kohler.npm-intellisense"]="NPM Intellisense"
    ["aaron-bond.better-comments"]="Better Comments"
    ["gruntfuggly.todo-tree"]="TODO Tree"
    ["yzhang.markdown-all-in-one"]="Markdown All in One"
    ["humao.rest-client"]="REST Client"
)

declare -A EXTENSIONS_MEDIUM=(
    ["PKief.material-icon-theme"]="Material Icon Theme"
    ["streetsidesoftware.code-spell-checker"]="Code Spell Checker"
    ["pflannery.vscode-versionlens"]="Version Lens"
)

declare -A EXTENSIONS_LOW=(
    ["ms-vscode.node-debug2"]="Node Debug 2"
    ["eg2.vscode-npm-script"]="NPM Script Runner"
    ["cmstead.jsrefactor"]="JS Refactor"
    ["mhutchie.git-graph"]="Git Graph"
    ["oderwat.indent-rainbow"]="Indent Rainbow"
    ["rangav.vscode-thunder-client"]="Thunder Client"
    ["bierner.markdown-preview-github-styles"]="Markdown GitHub Preview"
    ["formulahendry.code-runner"]="Code Runner"
)

# Função para instalar uma extensão
install_extension() {
    local ext_id="$1"
    local ext_name="$2"

    # Verificar se já está instalada
    if code --list-extensions | grep -qi "^${ext_id}$"; then
        echo -e "  ${GREEN}✓${NC} $ext_name ${YELLOW}(já instalada)${NC}"
        return 0
    fi

    # Tentar instalar
    echo -n "  ⏳ Instalando $ext_name... "
    if code --install-extension "$ext_id" --force > /dev/null 2>&1; then
        echo -e "${GREEN}OK${NC}"
        return 0
    else
        echo -e "${RED}FALHOU${NC}"
        return 1
    fi
}

# Contadores
INSTALLED=0
FAILED=0
SKIPPED=0

# Instalar extensões críticas
echo -e "${RED}🔴 EXTENSÕES CRÍTICAS${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
for ext_id in "${!EXTENSIONS_CRITICAL[@]}"; do
    if install_extension "$ext_id" "${EXTENSIONS_CRITICAL[$ext_id]}"; then
        if code --list-extensions | grep -qi "^${ext_id}$" && ! code --list-extensions 2>&1 | grep -q "already installed"; then
            INSTALLED=$((INSTALLED + 1))
        else
            SKIPPED=$((SKIPPED + 1))
        fi
    else
        FAILED=$((FAILED + 1))
    fi
done
echo ""

# Instalar extensões de alta prioridade
echo -e "${YELLOW}🟡 EXTENSÕES DE ALTA PRIORIDADE${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
for ext_id in "${!EXTENSIONS_HIGH[@]}"; do
    if install_extension "$ext_id" "${EXTENSIONS_HIGH[$ext_id]}"; then
        if code --list-extensions | grep -qi "^${ext_id}$" && ! code --list-extensions 2>&1 | grep -q "already installed"; then
            INSTALLED=$((INSTALLED + 1))
        else
            SKIPPED=$((SKIPPED + 1))
        fi
    else
        FAILED=$((FAILED + 1))
    fi
done
echo ""

# Perguntar se quer instalar média prioridade
echo -e "${BLUE}🔵 EXTENSÕES DE MÉDIA PRIORIDADE${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Deseja instalar extensões de média prioridade? (recomendado)"
read -p "Instalar? (S/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[SsYy]$ ]] || [[ -z $REPLY ]]; then
    for ext_id in "${!EXTENSIONS_MEDIUM[@]}"; do
        if install_extension "$ext_id" "${EXTENSIONS_MEDIUM[$ext_id]}"; then
            if code --list-extensions | grep -qi "^${ext_id}$" && ! code --list-extensions 2>&1 | grep -q "already installed"; then
                INSTALLED=$((INSTALLED + 1))
            else
                SKIPPED=$((SKIPPED + 1))
            fi
        else
            FAILED=$((FAILED + 1))
        fi
    done
else
    echo -e "${YELLOW}⏭️  Puladas${NC}"
fi
echo ""

# Perguntar se quer instalar baixa prioridade
echo -e "${GREEN}🟢 EXTENSÕES DE BAIXA PRIORIDADE (Opcional)${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Deseja instalar extensões opcionais? (pode pular)"
read -p "Instalar? (s/N): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[SsYy]$ ]]; then
    for ext_id in "${!EXTENSIONS_LOW[@]}"; do
        if install_extension "$ext_id" "${EXTENSIONS_LOW[$ext_id]}"; then
            if code --list-extensions | grep -qi "^${ext_id}$" && ! code --list-extensions 2>&1 | grep -q "already installed"; then
                INSTALLED=$((INSTALLED + 1))
            else
                SKIPPED=$((SKIPPED + 1))
            fi
        else
            FAILED=$((FAILED + 1))
        fi
    done
else
    echo -e "${YELLOW}⏭️  Puladas${NC}"
fi
echo ""

# Resumo final
echo -e "${BLUE}=================================================="
echo "  RESUMO DA INSTALAÇÃO"
echo -e "==================================================${NC}"
echo -e "  ${GREEN}✓ Instaladas:${NC} $INSTALLED"
echo -e "  ${YELLOW}⏭  Já existentes:${NC} $SKIPPED"
echo -e "  ${RED}✗ Falharam:${NC} $FAILED"
echo ""

if [ $FAILED -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Algumas extensões falharam. Tente instalar manualmente:${NC}"
    echo "   Ctrl+Shift+X → Pesquise pela extensão → Install"
    echo ""
fi

echo -e "${GREEN}✅ Instalação concluída!${NC}"
echo ""
echo "Próximos passos:"
echo "1. Recarregue o VS Code: Ctrl+Shift+P → 'Developer: Reload Window'"
echo "2. Verifique extensões: Ctrl+Shift+X"
echo "3. Execute: make health"
echo ""

exit 0
