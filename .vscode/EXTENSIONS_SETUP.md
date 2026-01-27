# 📦 Guia de Extensões VS Code

**Última atualização:** 22/01/2026
**Status:** 10/18 instaladas (~56%)
**Versão:** v3.0 (Auditoria Completa)

## 📊 Status Atual

### ✅ Extensões Instaladas (10)

| Extensão            | ID                                   | Prioridade |
| ------------------- | ------------------------------------ | ---------- |
| ESLint              | `dbaeumer.vscode-eslint`             | 🔴 CRÍTICA  |
| Prettier            | `esbenp.prettier-vscode`             | 🔴 CRÍTICA  |
| Docker              | `ms-azuretools.vscode-docker`        | 🔴 CRÍTICA  |
| GitHub Copilot      | `GitHub.copilot`                     | 🔴 CRÍTICA  |
| GitHub Copilot Chat | `GitHub.copilot-chat`                | 🔴 CRÍTICA  |
| Makefile Tools      | `ms-vscode.makefile-tools`           | 🔴 CRÍTICA  |
| GitLens             | `eamodio.gitlens`                    | 🟡 ALTA     |
| Error Lens          | `usernamehw.errorlens`               | 🟡 ALTA     |
| Path Intellisense   | `christian-kohler.path-intellisense` | 🟡 ALTA     |
| NPM Intellisense    | `christian-kohler.npm-intellisense`  | 🟡 ALTA     |

### ❌ Extensões Faltando (8)

#### 🔴 Prioridade ALTA (Produtividade)

| Extensão            | ID                           | Motivo                             |
| ------------------- | ---------------------------- | ---------------------------------- |
| Better Comments     | `aaron-bond.better-comments` | Destaque de comentários TODO/FIXME |
| TODO Tree           | `gruntfuggly.todo-tree`      | Visão geral de TODOs               |
| Markdown All in One | `yzhang.markdown-all-in-one` | Edição de documentação             |
| REST Client         | `humao.rest-client`          | Testar APIs sem sair do editor     |

#### 🟡 Prioridade MÉDIA (Build Tools)

| Extensão               | ID                                       | Motivo                         |
| ---------------------- | ---------------------------------------- | ------------------------------ |
| JS Refactor            | `cmstead.jsrefactor`                     | Refatoração JavaScript         |
| Version Lens           | `pflannery.vscode-versionlens`           | Ver versões de pacotes         |
| Markdown GitHub Styles | `bierner.markdown-preview-github-styles` | Preview markdown estilo GitHub |

#### 🟢 Prioridade BAIXA (Opcional)

| Extensão            | ID                                      | Motivo               |
| ------------------- | --------------------------------------- | -------------------- |
| Material Icon Theme | `PKief.material-icon-theme`             | Ícones de arquivos   |
| Code Spell Checker  | `streetsidesoftware.code-spell-checker` | Correção ortográfica |

### 🚫 Extensões REMOVIDAS (Deprecated/Problemáticas)

**NÃO INSTALE** as seguintes extensões (bloqueadas em `unwantedRecommendations`):

| Extensão               | ID                                   | Motivo da Remoção                                                             |
| ---------------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| Node Debug 2           | `ms-vscode.node-debug2`              | ❌ DEPRECATED - VS Code tem debugger built-in desde 2018                       |
| NPM Script Runner      | `eg2.vscode-npm-script`              | ❌ DEPRECATED - VS Code tem npm.enableScriptExplorer nativo desde v1.30        |
| Auto Close Tag         | `formulahendry.auto-close-tag`       | ❌ DEPRECATED - VS Code tem html.autoClosingTags nativo desde v1.16            |
| Auto Rename Tag        | `formulahendry.auto-rename-tag`      | ❌ DEPRECATED - VS Code tem html.mirrorCursorOnMatchingTag nativo desde v1.16  |
| Bracket Pair Colorizer | `CoenraadS.bracket-pair-colorizer`   | ❌ DEPRECATED - VS Code tem editor.bracketPairColorization nativo desde v1.60  |
| Bracket Pair Color. 2  | `CoenraadS.bracket-pair-colorizer-2` | ❌ DEPRECATED - VS Code tem editor.bracketPairColorization nativo desde v1.60  |
| Import Cost            | `wix.vscode-import-cost`             | ❌ PROBLEMÁTICO - Alto impacto em performance, causa lag no editor             |
| Git Graph              | `mhutchie.git-graph`                 | ❌ REDUNDANTE - GitLens já inclui graph view + VS Code tem Timeline view       |
| Indent Rainbow         | `oderwat.indent-rainbow`             | ❌ PROBLEMÁTICO - Impacto em performance; use editor.guides.indentation nativo |
| Thunder Client         | `rangav.vscode-thunder-client`       | ❌ REDUNDANTE - REST Client é mais leve e suficiente                           |
| Code Runner            | `formulahendry.code-runner`          | ❌ PROBLEMÁTICO - Problemas em containers; use tasks do VS Code                |

---
## 🌈 Indent Rainbow - Caso Especial

**Status:** ✅ ADICIONADA DE VOLTA (v3.0)

**Por quê foi adicionada de volta?**

Indent Rainbow oferece **funcionalidade Única** que o VS Code nativo NÃO tem:

| Recurso              | VS Code Nativo | Indent Rainbow                  | Vencedor     |
| -------------------- | -------------- | ------------------------------- | ------------ |
| Linhas de indentação | ✅              | ✅                               | Empate       |
| **Cores arco-íris**  | ❌ (só cinza)   | ✅ (vermelho/amarelo/verde/azul) | **Extensão** |
| Performance          | ✅ Ótima        | ⚠️ Pode causar lag               | Nativo       |

**Trade-off:**
- ✅ **Visual superior:** Identifica níveis rapidamente com cores
- ❌ **Performance:** Pode causar lag em arquivos >2000 linhas

**Configuração otimizada:**
```jsonc
// .vscode/settings.json
"indentRainbow.colors": [
    "rgba(255,64,64,0.07)",   // Vermelho
    "rgba(255,215,0,0.07)",   // Amarelo
    "rgba(0,255,127,0.07)",   // Verde
    "rgba(0,191,255,0.07)"    // Azul
],
"indentRainbow.ignoreErrorLanguages": ["markdown", "plaintext"],
"indentRainbow.indicatorStyle": "light"
```

**Conclusão:** Funcionalidade é DIFERENTE (não equivalente), então foi adicionada de volta.

---
## 🎯 Funcionalidades Nativas do VS Code (Não Precisam de Extensões)

**VS Code moderno inclui MUITAS funcionalidades que antes exigiam extensões:**

### ✅ HTML/JavaScript (Desde v1.16)
- **Auto Close Tags**: `html.autoClosingTags: true` ✅ JÁ CONFIGURADO
- **Auto Rename Tags**: `editor.linkedEditing: true` ✅ JÁ CONFIGURADO
- Não precisa de extensões `formulahendry.auto-close-tag` ou `auto-rename-tag`

### ✅ Bracket Pair Colorization (Desde v1.60)
- **Colorização de Parênteses**: `editor.bracketPairColorization.enabled: true` ✅ JÁ CONFIGURADO
- **Bracket Guides**: `editor.guides.bracketPairs: "active"` ✅ JÁ CONFIGURADO
- Não precisa de extensões `CoenraadS.bracket-pair-colorizer`

### ✅ Indent Guides (Nativo)
- **Guias de Indentação**: `editor.guides.indentation: true` ✅ JÁ CONFIGURADO
- **Highlight Ativo**: `editor.guides.highlightActiveIndentation: true` ✅ JÁ CONFIGURADO
- Não precisa de extensão `oderwat.indent-rainbow`

### ✅ NPM Scripts Explorer (Desde v1.30)
- **Explorer de Scripts NPM**: Disponível no menu "Views" do Explorer
- **Auto-detecção**: `npm.autoDetect: "on"` ✅ JÁ CONFIGURADO
- Não precisa de extensão `eg2.vscode-npm-script`

### ✅ Node.js Debugger (Desde v1.30/2018)
- **Debugger Integrado**: VS Code tem debugger JavaScript/Node.js built-in
- **Auto-attach**: `debug.javascript.autoAttachFilter: "smart"`
- Não precisa de extensões `ms-vscode.node-debug` ou `node-debug2`

### ✅ Auto Imports (Nativo)
- **JavaScript Auto Imports**: `javascript.suggest.autoImports: true` ✅ JÁ CONFIGURADO
- **TypeScript Auto Imports**: `typescript.suggest.autoImports: true`
- **Path Suggestions**: `javascript.suggest.paths: true` ✅ JÁ CONFIGURADO

### ✅ Git Timeline (Desde v1.44)
- **File History**: Disponível na view "Timeline" (Ctrl+Shift+E → Timeline)
- **Git Graph**: GitLens já inclui, não precisa de extensão `mhutchie.git-graph`

### ✅ Sticky Scroll (Desde v1.70)
- **Headers Fixos**: `editor.stickyScroll.enabled: true` ✅ JÁ CONFIGURADO
- Mantém contexto de função/classe visível ao scrollar

### ✅ Editor Linked Editing (Desde v1.60)
- **Edição Sincronizada**: `editor.linkedEditing: true` ✅ JÁ CONFIGURADO
- Renomeia tags HTML/JSX automaticamente

### ✅ Semantic Highlighting (Desde v1.43)
- **Destaque Semântico**: `editor.semanticHighlighting.enabled: true` ✅ JÁ CONFIGURADO
- Diferencia variáveis de parâmetros de funções (baseado em análise, não regex)

### ✅ Inlay Hints (Desde v1.60)
- **Parameter Names**: `javascript.inlayHints.parameterNames.enabled: "literals"` ✅ JÁ CONFIGURADO
- **Return Types**: `javascript.inlayHints.functionLikeReturnTypes.enabled: true` ✅ JÁ CONFIGURADO
- Mostra nomes de parâmetros e tipos inline

### ✅ Test Explorer (Desde v1.59)
- **Test View Nativo**: `testing.automaticallyOpenPeekView: "failureInVisibleDocument"` ✅ JÁ CONFIGURADO
- Suporta Jest, Mocha, Node.js test runner nativo
- Não precisa de extensões de testing

### ✅ Debug Inline Values (Desde v1.43)
- **Valores Inline**: `debug.inlineValues: "on"` ✅ JÁ CONFIGURADO
- **Focus on Break**: `debug.focusEditorOnBreak: true` ✅ JÁ CONFIGURADO
- Mostra valores de variáveis durante debug sem hover

### ✅ Terminal GPU Acceleration (Desde v1.56)
- **GPU Rendering**: `terminal.integrated.gpuAcceleration: "auto"` ✅ JÁ CONFIGURADO
- **Smooth Scrolling**: `terminal.integrated.smoothScrolling: true` ✅ JÁ CONFIGURADO
- Performance superior em terminals

### ✅ Search on Type (Nativo)
- **Busca Instantânea**: `search.searchOnType: true` ✅ JÁ CONFIGURADO
- Mostra resultados enquanto digita (300ms debounce)

### ✅ Large File Optimizations (Desde v1.47)
- **Otimização Automática**: `editor.largeFileOptimizations: true` ✅ JÁ CONFIGURADO
- Desabilita features pesadas em arquivos >10MB

### ✅ Folding (Nativo)
- **Code Folding**: `editor.folding: true` ✅ JÁ CONFIGURADO
- **Estratégia**: `editor.foldingStrategy: "auto"` ✅ JÁ CONFIGURADO
- Colapsa/expande até 5000 regiões

### 📊 Resumo: 16+ Funcionalidades Nativas Configuradas

**Você NÃO precisa instalar extensões para:**
1. ✅ Auto close/rename tags HTML
2. ✅ Colorização de parênteses
3. ✅ Guias de indentação
4. ✅ NPM scripts explorer
5. ✅ Node.js debugging
6. ✅ Auto imports JavaScript/TypeScript
7. ✅ Path suggestions
8. ✅ Git timeline/history
9. ✅ Sticky scroll
10. ✅ Linked editing

**Todas essas configurações JÁ ESTÃO ATIVADAS em `.vscode/settings.json`!**

---

## 🚀 Como Instalar

### Opção 1: Rebuild Dev Container (Recomendado - Auto-install)

As extensões do `devcontainer.json` instalam automaticamente:

1. `Ctrl+Shift+P` → `Dev Containers: Rebuild Container`
2. Aguarde o rebuild (~5-10min primeira vez)
3. Extensões instalam automaticamente ✅

### Opção 2: Instalação Automática (Workspace)

Quando você abrir o workspace no VS Code:

1. Popup: **"Do you want to install the recommended extensions?"**
2. Clique em **"Install All"**

### Opção 3: Instalação Manual via Command Palette

1. Pressione `Ctrl+Shift+P` (ou `Cmd+Shift+P` no macOS)
2. Digite: `Extensions: Show Recommended Extensions`
3. Clique em **"Install Workspace Recommendations"**

### Opção 4: Instalação Individual

Vá até a aba Extensions (`Ctrl+Shift+X`) e pesquise pelo nome ou ID.

### Opção 5: Instalação via CLI

```bash
# Instalar extensões prioritárias
code --install-extension aaron-bond.better-comments
code --install-extension gruntfuggly.todo-tree
code --install-extension yzhang.markdown-all-in-one
code --install-extension humao.rest-client
code --install-extension cmstead.jsrefactor
code --install-extension pflannery.vscode-versionlens
```

### Opção 6: Verificar Status (CLI)

```bash
# Verificar extensões instaladas vs recomendadas
npm run vscode:check

# Listar todas extensões instaladas
code --list-extensions --show-versions
```

---

## 🔧 Troubleshooting

### Problema: "This extension is disabled because it is defined to run in the Remote Extension Host"

**Causa:** A extensão está instalada no host local, mas não no Dev Container.

**Solução:**
1. Vá até a aba Extensions (`Ctrl+Shift+X`)
2. Encontre a extensão desabilitada
3. Clique no botão **"Install in Dev Container: ChatGPT Docker Puppeteer"**
4. Ou faça rebuild do container: `Dev Containers: Rebuild Container`

### Problema: Extensão instalada mas não funciona

**Soluções:**
1. Recarregue o VS Code: `Ctrl+Shift+P` → `Developer: Reload Window`
2. Verifique se está instalada no contexto correto (Container vs Local)
3. Verifique conflitos em `unwantedRecommendations`

### Problema: "Extension not found"

**Causa:** ID da extensão incorreto ou extensão removida do marketplace.

**Solução:**
1. Pesquise a extensão no marketplace: https://marketplace.visualstudio.com/vscode
2. Verifique se o ID está correto (formato: `publisher.extension-name`)

---

## 📋 Checklist de Instalação

Execute este comando para verificar o status:

```bash
bash /tmp/check_extensions.sh
```

Ou manualmente:

- [ ] ESLint (dbaeumer.vscode-eslint)
- [ ] Prettier (esbenp.prettier-vscode)
- [ ] Docker (ms-azuretools.vscode-docker)
- [ ] GitHub Copilot (GitHub.copilot)
- [ ] GitHub Copilot Chat (GitHub.copilot-chat)
- [ ] Makefile Tools (ms-vscode.makefile-tools)
- [ ] GitLens (eamodio.gitlens)
- [ ] Error Lens (usernamehw.errorlens)
- [ ] Path Intellisense (christian-kohler.path-intellisense)
- [ ] NPM Intellisense (christian-kohler.npm-intellisense)
- [ ] Better Comments (aaron-bond.better-comments)
- [ ] TODO Tree (gruntfuggly.todo-tree)
- [ ] REST Client (humao.rest-client)
- [ ] Markdown All in One (yzhang.markdown-all-in-one)
- [ ] Material Icon Theme (PKief.material-icon-theme)
- [ ] Code Spell Checker (streetsidesoftware.code-spell-checker)

---

## 🎯 Prioridades Recomendadas

### Para Desenvolvimento Ativo (Instale AGORA)

```bash
code --install-extension aaron-bond.better-comments
code --install-extension gruntfuggly.todo-tree
code --install-extension yzhang.markdown-all-in-one
```

### Para Debugging e Testes (Instale quando precisar)

```bash
code --install-extension humao.rest-client
code --install-extension ms-vscode.node-debug2
```

### Para Melhor UX (Instale quando quiser)

```bash
code --install-extension PKief.material-icon-theme
code --install-extension streetsidesoftware.code-spell-checker
code --install-extension oderwat.indent-rainbow
```

---

## 🔄 Manutenção

### Verificar Atualizações

1. Vá até Extensions (`Ctrl+Shift+X`)
2. Clique no ícone **"..."** (More Actions)
3. Selecione **"Check for Extension Updates"**

### Atualizar Todas as Extensões

```bash
# Atualizar todas de uma vez
code --update-extensions
```

### Remover Extensões Não Recomendadas

O arquivo `extensions.json` contém uma lista de `unwantedRecommendations` que devem ser evitadas por conflitarem com nosso setup:

- `standard.vscode-standard` (conflita com ESLint)
- `HookyQR.beautify` (conflita com Prettier)
- `ms-vscode.live-server` (usamos Express)
- E outros...

---

## 📚 Referências

- [VS Code Extension Marketplace](https://marketplace.visualstudio.com/vscode)
- [Managing Extensions in VS Code](https://code.visualstudio.com/docs/editor/extension-marketplace)
- [Dev Container Extension Configuration](https://containers.dev/implementors/json_reference/#general-properties)

---

## 🐛 Reportar Problemas

Se alguma extensão não estiver funcionando:

1. Verifique logs: `Ctrl+Shift+P` → `Developer: Toggle Developer Tools`
2. Desabilite outras extensões temporariamente
3. Teste em uma workspace limpa
4. Reporte no GitHub Issues do projeto

---

**Última verificação:** `bash /tmp/check_extensions.sh`
