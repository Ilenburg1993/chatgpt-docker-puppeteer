# Relatório de Consolidação e Aprimoramento de Código (2026)

Este documento detalha as oportunidades de consolidação, remoção de redundâncias e aprimoramentos
estruturais identificados no projeto `chatgpt-docker-puppeteer`.

**Data:** 21 de Fevereiro de 2026 **Status:** Proposta de Refatoração

---

## 1. Consolidação de Scripts Operacionais (Prioridade Alta)

Identificou-se uma proliferação de scripts `.bat` e `.sh` na raiz do projeto e na pasta `scripts/`
com funcionalidades sobrepostas ou idênticas.

### Problema

Existem múltiplas versões de scripts para iniciar o Chrome e verificar o ambiente, dificultando a
manutenção e confundindo o uso.

- **Inicialização do Chrome:**
  - `start-chrome-proxy.bat` (v3.0)
  - `start-chrome-proxy-v4.bat` (v4.0 - Recomendado)
  - `start-chrome-proxy-simple.bat` (Versão simplificada)
  - `scripts/start-chrome-with-proxy.bat` (Provável duplicata)
  - `scripts/start-chrome.bat.deprecated`

- **Verificação de Ambiente:**
  - `verify-chrome-setup.bat`
  - `verify-chrome-setup-debug.bat` (Apenas adiciona `echo` e `pause`)
  - `verify-chrome-setup-no-close.bat`

### Proposta de Solução

1.  **Unificar `start-chrome-proxy`:**
    - Promover `start-chrome-proxy-v4.bat` para `start-chrome-proxy.bat` (sobrescrevendo a v3.0).
    - Incorporar a lógica de "simple" como um fallback ou argumento se necessário, mas a v4 já
      parece robusta.
    - Remover as outras variantes (`-simple`, `-v4`, scripts em `scripts/`).

2.  **Unificar `verify-chrome-setup`:**
    - Integrar o modo debug em `verify-chrome-setup.bat` usando um argumento `--debug` ou variável
      de ambiente `DEBUG=1`.
    - Remover `verify-chrome-setup-debug.bat` e `verify-chrome-setup-no-close.bat`.

3.  **Mover scripts legados:**
    - Criar `scripts/legacy/` (se não existir) e mover todos os scripts descontinuados para lá antes
      de deletar definitivamente.

---

## 2. Reorganização e Migração de Testes (Prioridade Média)

A raiz do projeto contém 13 arquivos `test-*.mjs` que parecem ser testes de integração ou manuais
que não foram movidos para a estrutura padrão `tests/`.

### Arquivos Afetados

- `test-ollama-cloud-complete.mjs`, `test-mcp-server.mjs`, `test-qwen3-final.mjs`
- `test-openai-compat.mjs`, `test-fhc.mjs`, `test-types.mjs`
- E outros similares.

### Proposta de Solução

1.  **Criar Diretórios em `tests/`:**
    - `tests/integration/providers/` (para testes de Ollama, Qwen, OpenAI).
    - `tests/integration/mcp/` (para testes de MCP e RAG).
    - `tests/manual/` (para testes manuais ou de debug pontual).

2.  **Mover e Renomear:**
    - Mover os arquivos da raiz para os diretórios apropriados.
    - Padronizar a nomenclatura (ex: `test-ollama.mjs` -> `ollama.test.mjs` ou manter kebab-case
      consistente).

3.  **Atualizar Scripts de Teste:**
    - Atualizar `scripts/run-tests.js` ou `package.json` para incluir esses novos diretórios na
      execução de testes de integração.

---

## 3. Limpeza de Arquivos de Build e Configuração (Prioridade Baixa)

Existem arquivos de configuração e build duplicados ou obsoletos na raiz.

### Arquivos Afetados

- `Makefile` (v4.1.0 - Principal) vs `Makefile.new` (v4.0.0 - Incompleto).
- `launcher.sh` vs `launcher-ascii.sh`.

### Proposta de Solução

1.  **Remover `Makefile.new`:** O `Makefile` atual é mais recente e completo.
2.  **Consolidar Launchers:** Verificar se `launcher-ascii.sh` é apenas uma variação visual e
    integrar ou remover.

---

## 4. Refatoração Estrutural de Código (Core/Kernel)

### A. Schemas e Validação (`src/core/schemas/`)

A estrutura atual mistura definição de schemas (`task_schema.js`) com lógica de migração
(`migrator_v4_to_v5.js`) e reparo (`task_healer.js`).

**Proposta:**

- Mover lógica de migração para `src/core/migrations/`.
- Manter em `src/core/schemas/` apenas definições de Zod/Joi.
- Consolidar `task_schema.js` e `task_schema_v5.js` em um único `task.js` que exporta a versão
  corrente, mantendo versões antigas em `legacy/` se necessário.

### B. Kernel Policy Engine (CRÍTICO)

Existe uma duplicação severa da classe `PolicyEngine` em dois locais diferentes:

- `src/kernel/policy_engine/policy_engine.js` (403 linhas - Versão Nova/Correta): Segue padrões
  rigorosos, JSDoc completo e responsabilidade clara.
- `src/kernel/policies/policy_engine.js` (136 linhas - Versão Legada): Implementação antiga com
  lógica hardcoded e mistura de responsabilidades.

**Proposta:**

- Remover imediatamente `src/kernel/policies/policy_engine.js`.
- Verificar todas as importações para garantir que apontem para
  `src/kernel/policy_engine/policy_engine.js`.
- Consolidar o diretório `src/kernel/policies/` (se contiver apenas regras soltas) para dentro de
  `src/kernel/policy_engine/rules/`.

### C. Kernel Orchestration (`src/kernel/`)

Existe uma possível sobreposição entre:

- `task_execution_orchestrator.js` (Gerenciamento de execução/eventos)
- `execution_engine/execution_engine.js` (Decisão pura)
- `task_runtime/task_runtime.js` (Estado da tarefa)

**Proposta:**

- Clarificar a responsabilidade do `Orchestrator`. Ele deve ser apenas o "executor" das decisões do
  `ExecutionEngine`.
- Verificar se `ExecutionEngine` pode absorver parte da lógica de decisão que hoje pode estar
  dispersa no `KernelLoop`.

---

## 5. Reorganização Profunda da Pasta `scripts/` (Prioridade Alta)

A pasta `scripts/` contém mais de 80 arquivos na raiz, misturando instalação, operação,
health-checks, validação e ferramentas de dev. A falta de hierarquia torna difícil encontrar
ferramentas úteis.

### Grupos Identificados e Proposta de Estrutura

**A. Setup e Instalação (`scripts/setup/`)**

- `setup.sh`, `setup-dev-tools.sh`, `setup-devcontainer.sh`, `setup-terminal-env.mjs`
- `install-extensions.sh`, `install-pm2-gui.sh`
- `pm2-startup.sh`, `setup-pm2-plus.sh`

**B. Validação de Ambiente (`scripts/env/`)**

- `validate-env.js` (O principal), `check-env.mjs`, `check-env-local.mjs`
- `pre-flight-check.mjs`, `verify-chrome-config-consistency.js`
- `check-bindings.sh`, `check-all-bindings.sh`

**C. Health e Diagnóstico (`scripts/health/`)**

- `healthcheck.js`, `health-posix.sh`, `health-windows.ps1`
- `test-health-logic.js`, `test-health-endpoints.sh`
- `doctor.sh`, `diagnose-lsp.mjs`, `diagnose-mcp.mjs`

**D. Operação e Runtime (`scripts/ops/`)**

- `pm2-check.sh`, `start-pm2-debug.sh`, `quick-ops.sh`
- `rotate-profiles.js`, `puppeteer_maintenance.js`
- `watch-logs.sh`, `visualizar_fila.js`

**E. Build e CI (`scripts/ci/` ou `scripts/build/`)**

- `build.mjs`, `build-sea.mjs`
- `validate-ci.js`, `run-tests.js`, `run-all-tests.js`

**Ação Recomendada:**

1.  Criar essas subpastas.
2.  Mover os arquivos.
3.  Atualizar referências no `package.json` (usar search-and-replace global).
4.  Atualizar o `Makefile` para apontar para os novos caminhos.

---

## 6. Ferramentas de Análise e Tipagem

### Configurações de VS Code

O projeto mantém `tsconfig.json`, `jsconfig.json` e `tsconfig.browser.json`. A herança está correta,
mas deve-se garantir que `jsconfig.json` (usado pelo VS Code para JS) esteja sempre sincronizado com
as regras de build do `tsconfig.json`.

### Análise de Dependências

O script `scripts/analyze-code-graph.js` parece ser uma implementação customizada para análise de
grafo de dependências. **Recomendação:** Avaliar a substituição por ferramentas padrão de mercado
como `madge` (já citada no `CLAUDE.MD`) para reduzir manutenção de ferramentas internas.

---

## 7. Padronização de Adaptadores NERV (Arquitetura)

Identificou-se uma implementação heterogênea dos adaptadores NERV (a ponte entre o barramento de
eventos e os domínios do sistema).

### Componentes Identificados

- `src/driver/nerv_adapter/driver_nerv_adapter.js` (2359 linhas) - Muito extenso, mistura lógica de
  negócio com infraestrutura.
- `src/kernel/nerv_bridge/kernel_nerv_bridge.js` (612 linhas) - Mais focado, mas com nome
  inconsistente (`_bridge` vs `_adapter`).
- `src/server/nerv_adapter/server_nerv_adapter.js` - Implementação do lado do servidor.

### Proposta

1.  **Renomeação e Padronização:**
    - Renomear `src/kernel/nerv_bridge/` para `src/kernel/nerv_adapter/`.
    - Padronizar nomenclatura das classes/funções exportadas (ex: `KernelNERVAdapter`,
      `DriverNERVAdapter`).

2.  **Refatoração do Driver Adapter (Longo Prazo):**
    - O `driver_nerv_adapter.js` é um "God Object" com mais de 2000 linhas.
    - Deve ser quebrado em handlers específicos (ex: `handlers/execution.js`,
      `handlers/browser_control.js`).

---

## 8. Centralização de Tipos e Interfaces (`src/shared/`)

A pasta `src/shared/` contém definições cruciais, mas a estrutura pode ser melhorada para facilitar
a importação e evitar dependências circulares.

- **NERV Shared:** `src/shared/nerv/` está bem estruturado (`constants`, `envelope`, `schemas`).
- **Biomechanics & SADI:** Estão em `src/shared/`, mas poderiam ser agrupados em
  `src/shared/automation/` para separar lógica de negócio genérica de automação de browser.

**Ação:** Manter como está por enquanto, mas monitorar o crescimento de `src/shared/` para evitar
que se torne um "dumping ground".

---

## 9. Plano de Ação Imediato (Quick Wins - Atualizado)

Para limpar a raiz do projeto e reduzir a carga cognitiva imediatamente:

1.  **Apagar:** `Makefile.new` e `src/kernel/policies/` (após backup).
2.  **Consolidar Batch Files:** Manter apenas `start-chrome-proxy.bat` (com conteúdo v4) e
    `verify-chrome-setup.bat`.
3.  **Mover Testes:** Mover todos os `test-*.mjs` para `tests/temp_migration/` temporariamente.
4.  **Reorganizar Scripts:** Criar pastas `scripts/{setup,env,health,ops,build}` e mover arquivos.
5.  **Atualizar package.json:** Refletir os novos caminhos dos scripts.
6.  **Renomear Kernel Bridge:** Mover `src/kernel/nerv_bridge` para `src/kernel/nerv_adapter`.

---

## 10. Limpeza da Raiz do Projeto (`/`)

A raiz do projeto contém diversos arquivos que deveriam estar organizados em subdiretórios.

### Arquivos Python

- `colect.py`: Script de auditoria/coleta de arquivos. Deveria estar em `scripts/audit/` ou
  `scripts/dev/`.
- `generate_architecture_v3.py`: Gerador de documentação. Deveria estar em `scripts/docs/`.

### Configurações

- `opencode.json`: Configuração de ferramenta externa. Manter se em uso, mas documentar em
  `CONFIGURATION.md`.
- `vocabulary.json`: Parece ser usado para detecção de erros/botões na interface. Deveria estar em
  `src/core/i18n/` ou `src/driver/config/`.

### Logs e Artefatos

- `Heap.*.heapprofile`: Arquivos de profiling de memória. Devem ser movidos para `profile/` ou
  deletados via `.gitignore`.
- `test-proxy-screenshot.png`: Artefato de teste. Deve ir para `artifacts/`.

**Ação:** Mover esses arquivos para locais apropriados para limpar a visão da raiz.

---

## 11. Integração Server vs Dashboard

O projeto possui duas estruturas relacionadas à interface web:

- `src/server/`: Backend API (Node.js/Express).
- `src/dashboard-ui/`: Frontend (Vue/Vite).

A estrutura atual é saudável (separação clara), mas deve-se garantir que o build do dashboard
(`src/dashboard-ui/dist`) seja servido corretamente pelo `src/server`.

**Ação:** Verificar configuração de _static serving_ em `src/server/main.js` ou
`src/server/middleware/` para garantir que o frontend compilado seja entregue.

---

## 12. Sobreposição Infra vs Core

Existe uma potencial duplicação de responsabilidades entre `src/infra/fs` e `src/core`.

- `src/infra/fs/` contém utilitários de sistema de arquivos (`atomic_write.js`, `safe_read.js`).
- `src/core/` contém lógica de configuração e ambiente.

**Observação:** A separação parece correta (Core = Regras de Negócio/Ambiente, Infra = Implementação
Técnica de IO), mas deve-se vigiar para que regras de negócio não vazem para `src/infra`.

---

## 13. Plano de Ação Imediato (Quick Wins - Atualizado)

1.  **Apagar:** `Makefile.new` e `src/kernel/policies/` (após backup).
2.  **Consolidar Batch Files:** Manter apenas `start-chrome-proxy.bat` e `verify-chrome-setup.bat`.
3.  **Mover Testes:** Mover `test-*.mjs` para `tests/temp_migration/`.
4.  **Reorganizar Scripts:** Criar pastas `scripts/{setup,env,health,ops,build}`.
5.  **Limpar Raiz:** Mover `.py`, `.json` soltos e artefatos para subpastas.
6.  **Renomear Kernel Bridge:** Mover `src/kernel/nerv_bridge` para `src/kernel/nerv_adapter`.
7.  **Atualizar package.json:** Refletir os novos caminhos.

---

## 14. Estratégia de Migração Segura de Scripts

A reorganização da pasta `scripts/` (Seção 5) tem alto risco de quebrar fluxos de trabalho
existentes (CI/CD, npm scripts, Makefiles). Para mitigar isso:

### A. Atualização de Referências

1.  **Mapeamento:** Utilizar `grep` para listar todos os arquivos que referenciam `scripts/`.
    - Alvos principais: `package.json`, `Makefile`, `.github/workflows/*.yml`, `Dockerfile`.
2.  **Batch Update:** Atualizar os caminhos nos arquivos de configuração simultaneamente à
    movimentação dos arquivos.

### B. Scripts de Compatibilidade (Proxies)

Durante a fase de transição (1-2 semanas), manter os arquivos originais como "proxies" que
redirecionam para o novo local e emitem um aviso.

**Exemplo para `scripts/build.mjs` (Proxy):**

```javascript
// scripts/build.mjs
console.warn('⚠️  DEPRECATED: Este script foi movido para scripts/build/build.mjs');
console.warn('   Por favor, atualize suas referências.');
import('./build/build.mjs');
```

**Exemplo para `scripts/setup.sh` (Proxy):**

```bash
#!/bin/bash
echo "⚠️  DEPRECATED: Este script foi movido para scripts/setup/setup.sh"
exec ./scripts/setup/setup.sh "$@"
```

### C. Validação

Criar um script de validação (`scripts/ops/validate-migration.js`) que verifica se todos os
entry-points críticos do `package.json` ainda funcionam após a mudança.

---

## 15. Plano de Ação Imediato (Quick Wins - Atualizado)

Para limpar a raiz do projeto e reduzir a carga cognitiva imediatamente:

1.  **Apagar:** `Makefile.new` e `src/kernel/policies/` (após backup).
2.  **Consolidar Batch Files:** Manter apenas `start-chrome-proxy.bat` (com conteúdo v4) e
    `verify-chrome-setup.bat`.
3.  **Mover Testes:** Mover todos os `test-*.mjs` para `tests/temp_migration/` temporariamente.
4.  **Reorganizar Scripts:** Criar pastas `scripts/{setup,env,health,ops,build}` e mover arquivos.
5.  **Atualizar package.json:** Refletir os novos caminhos dos scripts.
6.  **Renomear Kernel Bridge:** Mover `src/kernel/nerv_bridge` para `src/kernel/nerv_adapter`.
7.  **Atualizar referências:** Atualizar todos os arquivos de configuração que referenciam
    `scripts/`.
8.  **Criar Scripts de Compatibilidade:** Manter proxies para scripts críticos durante a transição.
9.  **Validar Migração:** Executar script de validação para garantir funcionamento pós-migração.

---

**Observação:** Este relatório foi gerado automaticamente por análise estática e estrutural.
Recomenda-se validação manual antes de deleção definitiva de arquivos.
