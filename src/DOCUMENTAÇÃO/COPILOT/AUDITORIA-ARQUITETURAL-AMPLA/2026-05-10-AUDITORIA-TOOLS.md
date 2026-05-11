# Auditoria Arquitetural — `src/copilot/tools/`

> **Data**: 2026-05-10  
> **Auditor**: Kilo (automated)  
> **Escopo**: Todos os 32 arquivos em `src/copilot/tools/` e suas relações com o restante de `src/copilot/`  
> **Objetivo**: Diagnóstico completo da arquitetura atual, identificação de déficits técnicos e proposição de situação ideal com roadmap.

---

## Sumário Executivo

O módulo `src/copilot/tools/` é o **registry central de Custom Tools** do Always-Alive Agent. Ele abriga 10 categorias funcionais de tools (tarefas, código, git, sessão, hooks, hub, introspecção, filesystem, shell, web), além de infraestrutura transversal (factory, DI tokens, logger, metrics proxy, verifier de contratos). A arquitetura atual demonstra **maturidade moderada-alta** com padrões consistentes de DI via injeção de módulos, mas apresenta **déficits estruturais** em encapsulamento de domínio, acoplamento funcional cruzado e ausência de limites de módulo (module boundaries) formalizados.

> **📎 Documento complementar:** A análise foi expandida para os módulos Terminal, Events, Hooks, MCP Bridge, Presentation e Server Deps em [`2026-05-10-AUDITORIA-EXTENSAO-FASE2.md`](2026-05-10-AUDITORIA-EXTENSAO-FASE2.md) (seções 24–34). As novas seções incluem 20 novos bugs (BUG-18 a BUG-35), 6 gaps sistêmicos (SYS-GAP-11 a SYS-GAP-16), 1 inconsistência adicional (INC-06) e atualizações na priorização consolidada.

---

## 1. Mapa de Grafos — Relação `tools/` ↔ Resto de `src/copilot/`

### 1.1 Consumidores externos de `#copilot/tools`

```
src/copilot/
├── bootstrap.js                    → importa { TOOLS_LOGGER, TOOLS_METRICS }
├── observability/bootstrap.js      → importa { TOOLS_LOGGER, TOOLS_METRICS }
├── server/routes/sdk/deps.js       → importa { getAllTools }
├── agent/ports/tool-port.js        → importa { isToolDisabled, readStore }
├── hooks/presets/production.js     → importa { isToolDisabled }
├── terminal/commands/sdk.js        → importa { fileReadTools, fileWriteTools }
├── terminal/commands/fs.js         → importa { fileReadTools, fileWriteTools }
├── terminal/commands/tools.js      → importa { readIntrospectionRegistrySnapshot }
├── terminal/commands/resume.js     → importa { fileReadTools }
└── (tool-factory.js docstring)     → referência documental (não runtime)
```

### 1.2 Dependências externas de `tools/` (imports `#copilot/*`)

```
#copilot/config          → bootstrap.js, session-rpc-tools.js, experimental-rpc-tools.js,
                           web-tools.js, task-tools.js, shell/sandbox.js, shell/executor.js,
                           tool-factory.js, introspection-tools.js (9 arquivos)

#copilot/sdk             → bootstrap.js, session-rpc-tools.js, experimental-rpc-tools.js,
                           git/index.js, introspection-tools.js, shell/index.js,
                           task-tools.js, todo/query-tools.js, todo/crud-tools.js,
                           todo/todo-write-tools.js, todo/bulk-tools.js,
                           file/read-tools-io.js (via shared.js validatePath → core)
                           (12 arquivos)

#copilot/core            → bootstrap.js (observability), permission-tools.js, session-rpc-tools.js,
                           experimental-rpc-tools.js, web-tools.js, file/shared.js,
                           task-tools.js, todo/store.js, session-tools.js,
                           hook-tools.js (via error-handlers), code-tools.js (via error-handlers)
                           (10 arquivos)

#copilot/boot            → git/index.js, shell/sandbox.js, file/shared.js, code-tools.js,
                           session-tools.js, todo/store.js, file/write-tools.js (via io-engine)
                           (6 arquivos)

#copilot/audit           → hook-tools.js, shell/index.js (2 arquivos)

#copilot/observability   → bootstrap.js (1 arquivo)

#copilot/db              → todo/store.js (1 arquivo)

#copilot/infra           → file/scope-tools.js (1 arquivo — io-session-scope)
                           file/read-tools-io.js (io-engine, io-prefetch)
                           file/write-tools.js (io-engine)
                           file/read-tools-search.js (io-index-registry, io-observability)
                           file/symbol-search-tool.js (io-observability)
```

### 1.3 Grafo de Dependências Internas (dentro de `tools/`)

```
tool-factory.js ──────────────────┐
  ▲                               │
  │ (importa: config, sdk)        │ usado por: TODOS os *-tools.js
  │                               │
  ├── permission-tools.js         │
  ├── hook-tools.js ──────────┐   │
  │    ▲                     │   │
  │    │ user-input-state.js │   │
  ├───┘                     └───┘
  ├── hub-tools.js ───────────────┐
  │    ▲                          │
  │    │ (importa: config, core)  │
  ├───┘                          │
  ├── introspection-tools.js      │
  │    ├── tool-contract-verifier │
  │    ├── metrics-proxy          │
  │    └── logger                 │
  ├───┘                          │
  ├── session-tools.js           │
  ├── session-rpc-tools.js       │
  ├── task-tools.js              │
  ├── code-tools.js              │
  ├── web-tools.js               │
  ├── experimental-rpc-tools.js  │
  ├── git/index.js               │
  ├── shell/index.js ──────────┐ │
  │    ├── executor.js         │ │
  │    └── sandbox.js          │ │
  ├───┘                       │ │
  ├── file/index.js ────────┐  │ │
  │    ├── read-tools.js ──┐ │  │ │
  │    │   ├── read-tools-io.js     │
  │    │   ├── read-tools-search.js │
  │    │   └── symbol-search-tool.js│
  │    ├── write-tools.js   │ │  │
  │    ├── index-tools.js   │ │  │
  │    ├── scope-tools.js   │ │  │
  │    └── shared.js        │ │  │
  ├───┘                    │ │  │
  ├── todo/index.js ───┐   │ │  │
  │    ├── todo-schema.js    │ │  │
  │    ├── store.js          │ │  │
  │    ├── crud-tools.js     │ │  │
  │    ├── todo-write-tools.js│ │  │
  │    ├── query-tools.js    │ │  │
  │    └── bulk-tools.js     │ │  │
  └───┘                │ │  │
                        │ │  │
bootstrap.js ◄─────────┴─┴──┘
```

### 1.4 Dependências `node:*` por subdomínio

| Subdomínio | Módulos Node |
|---|---|
| shell/* | `child_process`, `path`, `util` |
| file/shared.js | `buffer`, `child_process`, `path`, `util` |
| file/read-tools-io.js | `fs/promises` |
| file/write-tools.js | (via io-engine) |
| hook-tools.js | `child_process`, `fs/promises`, `path`, `url`, `util` |
| task-tools.js | `fs/promises`, `path`, `url` |
| session-tools.js | `child_process`, `fs/promises`, `path` |
| code-tools.js | `child_process`, `fs`, `path`, `util` |
| git/index.js | `child_process`, `util` |
| todo/store.js | `fs` |
| introspection-tools.js | `module` |
| tool-factory.js | `module` |

---

## 2. Análise da Situação Atual

### 2.1 Forças

1. **Padrão consistente de DI (Dependency Injection)**: Cada subdomínio que necessita de serviço externo usa `setXxx()` para injeção tardia, evitando import cycles. Visto em `setHub()`, `setPermissionAgent()`, `setSessionRpc()`, `setExperimentalSession()`, `configureHookTools()`, `setToolsLogger()`, `setToolsMetrics()`.

2. **Factory pattern uniforme**: Quase todas as tools usam `buildTool()` do `tool-factory.js`, que encapsula `defineTool` do SDK com logging automático, conversão Zod→JSON Schema e semântica `skipPermission`.

3. **Separação clara de leitura vs escrita**:
   - `todoReadTools` vs `todoWriteTools`
   - `fileReadTools` vs `fileWriteTools`
   - `withSkipPermission()` aplicado consistentemente em tools read-only

4. **Barrels organizados**: Cada subdomínio tem um `index.js` barrel que agrupa exports.

5. **Tool Contract Verifier**: Mecanismo maduro de validação de metadados em runtime.

6. **Observabilidade integrada**: `metrics-proxy.js` e `logger.js` com injeção, evitando dependência direta de `observability/`.

### 2.2 Fraquezas e Problemas Identificados

#### PROBLEMA 1: `file/` é um agregado desproporcional (God Module)

O subdiretório `file/` contém **8 arquivos** e **28+ tools**, representando ~40% de todo o módulo tools. Ele mistura:
- IO de baixo nível (`read-tools-io.js`, `write-tools.js`)
- Busca e indexação (`read-tools-search.js`, `index-tools.js`, `symbol-search-tool.js`)
- Escopo de sessão (`scope-tools.js`)
- Infraestrutura compartilhada (`shared.js`)
- Barrel (`index.js`)

**Impacto**: Dificulta a manutenção, testabilidade e evolução independente das funcionalidades.

#### PROBLEMA 2: `todo/` mistura lógica de domínio com transporte (tools)

O subdiretório `todo/` contém 7 arquivos onde `store.js` acumula responsabilidades de:
- Persistência SQLite
- Migração legada (JSON→SQLite)
- Lógica de domínio (validação de transições, geração de IDs)
- Helpers puros (sanitize, isOverdue, now)
- Agendamento de cleanup (`startTodoCleanupJob`)

**Impacto**: O store não pode ser reutilizado fora do contexto de tools, e a lógica de domínio fica acoplada ao mecanismo de persistência.

#### PROBLEMA 3: Acoplamento funcional cruzado via module-level state

Vários arquivos mantêm estado global mutável em nível de módulo:
- `introspection-tools.js`: `_registeredTools`, `_disabledTools`, `_CATEGORY_TOOL_MAP_DYNAMIC`, `_toolNameToMetadataMap`, `_toolContractReport`
- `user-input-state.js`: `_pendingInputResolvers`, `_pendingInputSeq`
- `hook-tools.js`: `_broadcastSse`
- `hub-tools.js`: `_injectedHub`
- `permission-tools.js`: `_agent`
- `session-rpc-tools.js`: `_rpc`
- `experimental-rpc-tools.js`: `_session`
- `metrics-proxy.js`: `_impl`
- `logger.js`: `_injectedLogger`
- `web-tools.js`: `RATE_WINDOW`

**Impacto**: Estado global dificulta testes, cria race conditions potenciais em ambientes multi-sessão, e viola princípios de clean architecture.

#### PROBLEMA 4: `tool-factory.js` é um God Object de utilidades

Além de `buildTool()` e `withSkipPermission()`, contém:
- Loading dinâmico de `zod-to-json-schema`
- Fallback para `zod` v4 nativo
- Validação de schema (`isUsableToolParameterSchema`)
- Detecção de erros recuperáveis (`isRecoverableToolFactoryError`)
- Logger local (`logToolFactory`)
- TryZodV4ToJsonSchema

**Impacto**: O arquivo tem 345 linhas e mistura pelo menos 4 responsabilidades distintas.

#### PROBLEMA 5: Ausência de limites de módulo (Module Boundary Rules)

Não há definição formal do que cada subdomínio pode importar. Por exemplo:
- `file/read-tools-io.js` importa de `../../infra/io-engine.js`, `../../infra/io-prefetch.js`, `../../infra/io-scanner.js` — cruzando a fronteira tools→infra diretamente.
- `file/scope-tools.js` importa de `#copilot/infra/io-session-scope`
- `todo/store.js` importa de `#copilot/db`
- `shell/index.js` importa de `../metrics-proxy.js` (vizinho) e `../logger.js` (vizinho), mas shell/executor.js importa de `../../core/error-handlers.js`

**Impacto**: Sem regras declarativas de dependência, qualquer arquivo pode importar de qualquer camada, criando um grafo denso e frágil.

#### PROBLEMA 6: Inconsistência no uso de `createTool` vs `buildTool`

Alguns arquivos usam `createTool` direto do SDK (session-tools, session-rpc-tools, experimental-rpc-tools, introspection-tools), enquanto outros usam `buildTool` do tool-factory. A diferença:
- `createTool`: sem logging automático, sem conversão Zod automática
- `buildTool`: com logging automático, conversão Zod, tratamento de erros

**Impacto**: Tools criadas com `createTool` não têm o mesmo nível de observabilidade e podem falhar silenciosamente em cenários de TDZ (module initialization).

#### PROBLEMA 7: `user-input-state.js` é um singleton global frágil

O estado de pending inputs é mantido em module-level variables em vez de uma instância injetável. Múltiplas sessões poderiam colidir.

#### PROBLEMA 8: Barrels expõem detalhes de implementação

`tools/index.js` exporta:
- `readStore` (do `todo/store.js`) — acesso direto ao store SQLite
- `TOOLS_LOGGER`, `TOOLS_METRICS` — tokens DI
- Funções de reset para testes (`clearToolsLogger`, `clearToolsMetrics`)

**Impacto**: Consumidores externos podem depender de implementações internas.

---

## 3. Situação Atual vs. Situação Ideal

### 3.1 Visão Comparativa

| Aspecto | Situação Atual | Situação Ideal |
|---|---|---|
| **Estrutura de módulos** | 1 diretório monolítico com 12 subdomínios | Domínios separados com limites explícitos |
| **Gestão de estado** | Module-level singletons (10+ variáveis globais) | Instâncias injetáveis com lifecycle explícito |
| **Factory** | God Object (345 linhas, 5+ responsabilidades) | Factory + validadores + utilidades separados |
| **File tools** | 8 arquivos, 28+ tools em 1 namespace | 3 submódulos: io, search/index, scope |
| **Todo tools** | Store mistura domínio + persistência + agendamento | Store (domínio) + Repository (persistência) separados |
| **Injeção de dependência** | Convenção informal (setXxx) | Container DI explícito com interfaces |
| **Testabilidade** | Requer monkey-patching de singletons | Injeção limpa, mocks naturais |
| **Limites de módulo** | Não definidos | Declarados via ESLint/c8/import-linter |
| **Consistência** | Mix de createTool/buildTool | buildTool padrão, createTool apenas para casos especiais |
| **Documentação** | JSDoc parcial | Contratos formais (Zod + OpenAPI) |

---

## 4. Roadmap de Evolução

### Fase 1 — Estabilização (Semanas 1-2)

**Objetivo**: Eliminar os problemas mais críticos sem mudar a estrutura de diretórios.

| # | Ação | Impacto | Esforço |
|---|---|---|---|
| 1.1 | Extrair `tool-factory.js` em: `buildTool` + `toolValidator` + `zodAdapter` + `toolLogger` | Reduz God Object, melhora testabilidade | Médio |
| 1.2 | Criar `tools/shell/ports.js` para `recordToolCall`, remover acoplamento direto a `metrics-proxy.js` | Elimina dependência lateral shell→metrics | Baixo |
| 1.3 | Padronizar `buildTool()` em todas as tools (substituir usos de `createTool` em session-tools, session-rpc-tools, introspection-tools) | Consistência de logging/observability | Médio |
| 1.4 | Adicionar ESLint rule `no-restricted-imports` para `tools/` → proibir imports de `../../infra/*` e `../../db/*` diretamente | Forçar limites de módulo | Baixo |
| 1.5 | Migrar `user-input-state.js` para classe instanciável com injeção via `tool-port.js` | Eliminar singleton frágil | Médio |

### Fase 2 — Reestruturação de Domínios (Semanas 3-6)

**Objetivo**: Separar `file/` e `todo/` em submódulos coesos.

| # | Ação | Impacto | Esforço |
|---|---|---|---|
| 2.1 | Criar `tools/file/io/` com `read-tools-io.js`, `write-tools.js`, `shared.js` | IO isolado | Baixo (move) |
| 2.2 | Criar `tools/file/search/` com `read-tools-search.js`, `index-tools.js`, `symbol-search-tool.js` | Busca/indexação isolada | Baixo (move) |
| 2.3 | Criar `tools/file/scope/` (manter scope-tools.js) | Escopo de sessão isolado | Baixo (move) |
| 2.4 | Extrair lógica de domínio de `todo/store.js` em `todo/domain.js` (validações, transições, sanitize, isOverdue, createTask) | Domínio puro, testável sem DB | Médio |
| 2.5 | Extrair persistência de `todo/store.js` em `todo/repository.js` (SQLite, migração, withStore, readStore) | Repository substituível | Médio |
| 2.6 | Mover agendamento de cleanup para `todo/scheduler.js` | Lifecycle explícito | Baixo |
| 2.7 | Atualizar `todo/index.js` barrel para refletir nova estrutura | Semântica clara | Baixo |

### Fase 3 — DI Formal (Semanas 7-8)

**Objetivo**: Substituir singletons por injeção explícita.

| # | Ação | Impacto | Esforço |
|---|---|---|---|
| 3.1 | Criar `tools/container.js` — factory que cria instâncias de cada submódulo com dependências injetadas | Single source of truth | Alto |
| 3.2 | Migrar todos os `setXxx()` para uso do container | Eliminar module-level state | Alto |
| 3.3 | Introduzir interfaces TypeScript (via `@typedef` JSDoc para compatibilidade) para: `ToolRegistry`, `ConversationHub`, `PermissionAgent`, `SessionRpc`, `MetricsBackend`, `Logger` | Contratos formais | Médio |
| 3.4 | Refatorar `introspection-tools.js` para receber registry via injeção em vez de module-level `_registeredTools` | Testabilidade | Médio |

### Fase 4 — Observabilidade & Contratos (Semanas 9-10)

| # | Ação | Impacto | Esforço |
|---|---|---|---|
| 4.1 | Gerar JSON Schema formal para cada tool (não apenas Zod→JSON Schema ad-hoc) | Contrato estável para SDK | Alto |
| 4.2 | Adicionar health-check tool por subdomínio (file-health, todo-health, shell-health) | Diagnóstico granular | Baixo |
| 4.3 | Implementar rate-limiting real (token bucket) para web-tools em vez de in-memory advisory | Segurança | Médio |
| 4.4 | Dashboard de dependências automático (import-linter + madge) CI check | Prevenção de regressão arquitetural | Baixo |

---

## 5. Métricas Atuais do Módulo (Tools Only)

| Métrica | Valor |
|---|---|
| **Arquivos totais** | 32 |
| **Tools registradas** | ~55 |
| **Subdomínios** | 10 (task, code, git, session, session-rpc, hook, hub, introspection, file, shell, web, todo, permission, experimental-rpc) |
| **Imports `#copilot/*`** | 38 referências cross-boundary |
| **Imports `node:*`** | 12 arquivos |
| **Variáveis module-level mutáveis** | 11 |
| **Uso de `createTool` (sem factory)** | 5 arquivos (~15 tools) |
| **Uso de `buildTool` (com factory)** | 10 arquivos (~40 tools) |
| **Linhas totais** | ~2.800 |
| **Cobertura JSDoc** | ~85% (parcial em handlers) |

### 5.1 Métricas Expandidas (Fase 2 — Total do Subsistema Tools)

| Métrica | Valor |
|---|---|
| **Arquivos lidos (Fase 2)** | ~50+ (terminal, hooks, events, bridges, presentation, server, agent facades) |
| **Total do módulo terminal** | 103 arquivos |
| **Total hooks** | 15+ arquivos (incl. re-exports e presets) |
| **Bugs tools (original)** | 17 |
| **Bugs tools (Fase 2 novos)** | 18 (BUG-18 a BUG-35) |
| **Bugs SDK** | 12 (inalterado) |
| **Gaps sistêmicos** | 16 (original 10 + 6 novos) |
| **Inconsistências** | 6 (original 5 + 1 novo) |

---

## 6. Riscos e Dependências

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Quebra de backward compatibility ao renomear paths | Alta | Alto | Manter barrels de compatibilidade por 2 versões |
| Feature flags do SDK bloquearem `experimental-rpc-tools` | Média | Médio | Fallback graceful já implementado via `wrapExp` |
| Race conditions em module-level state com múltiplas sessões | Média | Alto | Fase 3 (DI formal) resolve |
| Regressão de segurança ao mover arquivos | Baixa | Alto | Testes de regression + lint CI |

---

## 7. Anexo: Índice Completo de Arquivos

| # | Arquivo | Linhas | Tools | Dependências externas |
|---|---|---|---|---|
| 1 | `index.js` | 167 | — (barrel) | `#copilot/config`, `#copilot/sdk`, `#copilot/observability` (via barrel) |
| 2 | `tool-factory.js` | 345 | — (factory) | `#copilot/config`, `#copilot/sdk`, `zod` |
| 3 | `tool-contract-verifier.js` | 316 | — (utilidade) | Nenhuma (autossuficiente) |
| 4 | `bootstrap.js` | 175 | — (bootstrap) | `#copilot/observability`, `#copilot/sdk`, todos os subdomínios |
| 5 | `di-tokens.js` | 26 | — (DI) | `../core/di.js` |
| 6 | `logger.js` | 73 | — (utilidade) | Nenhuma |
| 7 | `metrics-proxy.js` | 90 | — (utilidade) | `../observability/metrics-histogram.js` (tipo) |
| 8 | `hub-tools.js` | 373 | 5 | `zod`, `#copilot/config`, `#copilot/core` |
| 9 | `permission-tools.js` | 221 | 2 | `#copilot/audit`, `#copilot/core`, `zod` |
| 10 | `hook-tools.js` | 345 | 3 | `#copilot/audit`, `#copilot/core`, `zod`, `user-input-state.js` |
| 11 | `web-tools.js` | 558 | 2 | `#copilot/config`, `#copilot/core`, `zod`, `../infra/io-observability.js` |
| 12 | `introspection-tools.js` | 643 | 7 | `#copilot/config`, `#copilot/sdk`, `zod`, `./metrics-proxy.js`, `./tool-contract-verifier.js`, `./tool-factory.js` |
| 13 | `session-tools.js` | 230 | 5 | `#copilot/boot`, `#copilot/core`, `#copilot/sdk`, `zod` |
| 14 | `session-rpc-tools.js` | 376 | 10 | `#copilot/config`, `#copilot/core`, `#copilot/sdk`, `zod` |
| 15 | `experimental-rpc-tools.js` | 387 | 15 | `#copilot/config`, `#copilot/core`, `#copilot/sdk`, `zod` |
| 16 | `task-tools.js` | 156 | 4 | `#copilot/config`, `#copilot/sdk`, `#copilot/core`, `zod` |
| 17 | `code-tools.js` | 148 | 3 | `#copilot/boot`, `#copilot/core`, `zod` |
| 18 | `git/index.js` | 292 | 9 | `#copilot/boot`, `#copilot/sdk`, `zod`, `../../core/error-handlers.js` |
| 19 | `shell/index.js` | 461 | 3 | `#copilot/audit`, `#copilot/config`, `#copilot/sdk`, `./executor.js`, `./sandbox.js` |
| 20 | `shell/executor.js` | 300 | — (utilidade) | `#copilot/config`, `../../core/error-handlers.js`, `./sandbox.js` |
| 21 | `shell/sandbox.js` | 255 | — (utilidade) | `#copilot/boot`, `#copilot/config` |
| 22 | `file/index.js` | 75 | — (barrel) | Todos os subarquivos |
| 23 | `file/read-tools.js` | 30 | — (barrel) | `../tool-factory.js`, read-tools-io, read-tools-search, symbol-search-tool |
| 24 | `file/read-tools-io.js` | 197 | 2 | `../../core/error-handlers`, `../../core/io-contracts`, `../../core/io-policy`, `../../infra/io-engine`, `../../infra/io-prefetch`, `../../infra/io-scanner`, `./shared.js` |
| 25 | `file/read-tools-search.js` | 363 | 2 | `../../core/error-handlers`, `../../core/io-contracts`, `../../core/io-policy`, `../../infra/io-engine`, `../../infra/io-index-registry`, `../../infra/io-observability`, `./shared.js` |
| 26 | `file/symbol-search-tool.js` | 257 | 1 | `../../core/error-handlers`, `../../core/io-contracts`, `../../core/io-policy`, `../../infra/io-observability`, `./shared.js` |
| 27 | `file/write-tools.js` | 327 | 6 | `../../core/error-handlers`, `../../core/io-contracts`, `../../infra/io-engine`, `./shared.js` |
| 28 | `file/index-tools.js` | 106 | 4 | `../../infra/index.js`, `../tool-factory.js` |
| 29 | `file/scope-tools.js` | 178 | 6 | `#copilot/infra/io-session-scope`, `../tool-factory.js` |
| 30 | `file/shared.js` | 134 | — (utilidade) | `#copilot/boot`, `#copilot/core` |
| 31 | `todo/index.js` | 56 | — (barrel) | Todos os subarquivos |
| 32 | `todo/store.js` | 345 | — (domínio+persistência) | `#copilot/boot`, `#copilot/core`, `#copilot/db`, `./todo-schema.js` |
| 33 | `todo/todo-schema.js` | 100 | — (tipos) | `zod` |
| 34 | `todo/crud-tools.js` | 226 | 3 | `#copilot/sdk`, `../tool-factory.js`, `./store.js` |
| 35 | `todo/todo-write-tools.js` | 234 | 3 | `#copilot/sdk`, `../logger.js`, `../tool-factory.js`, `./store.js` |
| 36 | `todo/query-tools.js` | 328 | 3 | `#copilot/sdk`, `../tool-factory.js`, `./store.js` |
| 37 | `todo/bulk-tools.js` | 270 | 3 | `#copilot/sdk`, `../logger.js`, `./store.js` |
| 38 | `user-input-state.js` | 82 | — (estado) | Nenhuma |

---

## 8. Grafo Completo — Relação entre Arquivos de `tools/`

```
                     ┌─────────────────────────┐
                     │   index.js (barrel)      │
                     │   exports ALL tools      │
                     └────────────┬────────────┘
                                  │
    ┌──────────────┬───────────────┼───────────────┬──────────────────┬──────────────────┐
    │              │               │               │                  │                  │
    ▼              ▼               ▼               ▼                  ▼                  ▼
┌────────┐  ┌─────────────┐  ┌───────────┐  ┌───────────┐   ┌──────────────┐  ┌───────────────┐
│  DI &  │  │tool-factory │  │bootstrap  │  │  hook-    │   │ experimental │  │    todo/      │
│  utils │  │  (345 lin)   │  │  (175)    │  │  tools    │   │  rpc-tools   │  │  (7 arquivos) │
│        │  │             │  │           │  │  (345)    │   │  (387)       │  │               │
│logger  │  └──────┬──────┘  │           │  │           │   │              │  │  store.js     │
│metrics │         │         │  Imports:  │  │ Imports:  │   │ Imports:     │  │  schema.js    │
│di-tok  │         │         │  ALL tool  │  │ user-     │   │  #copilot/   │  │  crud-tools   │
└────────┘         │         │  modules   │  │ input-    │   │  config/core │  │  write-tools  │
                   │         └────────────┘  │ state     │   │  #copilot/sdk│  │  query-tools  │
                   │                         │           │   │  + 14 fns    │  │  bulk-tools   │
                   │                         │  #copilot/│   │    SDK fns   │   └──────┬───────┘
                   │                         │  audit    │   │              │          │
                   │                         │  core     │   └──────────────┘          │
                   │                         │  logger   │                            │
                   │                         │  ./user-  │                            │
                   │                         │  input-   │                            │
                   │                         │  state    │                            │
                   │                         └──────────┘                            │
                   │                                                                      │
    ┌──────────────┴──────────────┐    ┌─────────────────┐    ┌──────────────────────┐   │
    │  file/ (8 arquivos,         │    │  shell/         │    │  web-tools.js        │   │
    │   28+ tools)                │    │  (3 arqs)       │    │  (558 lin, 2 tools)  │   │
    │                             │    │  461+300+255    │    │                      │   │
    │  read-tools.js (barrel)     │    │  linhas total   │    │  Imports:             │   │
    │    ├── read-tools-io.js     │    │                 │    │  #copilot/config      │   │
    │    ├── read-tools-search.js │    │  Imports:       │    │  #copilot/core       │   │
    │    └── symbol-search-tool   │    │  #copilot/audit │    │  ../infra/io-*.js    │   │
    │                             │    │  #copilot/config│    │  ./logger.js          │   │
    │  write-tools.js             │    │  #copilot/sdk   │    │  ./tool-factory.js    │   │
    │  index-tools.js             │    │  ./executor.js  │    │                       │   │
    │  scope-tools.js             │    │  ./sandbox.js   │    └───────────────────────┘   │
    │  shared.js                  │    │                 │                               │
    │                             │    │  sandbox.js      │    ┌──────────────────────┐   │
    │  Imports:                   │    │  ─────────────   │    │  session/            │   │
    │  ../../infra/io-engine.js   │    │                  │    │  (256+376 linhas)     │   │
    │  ../../infra/io-prefetch.js │    │  #copilot/config │    │                      │   │
    │  ../../infra/io-scanner.js  │    │  #copilot/sdk    │    │  session-tools.js     │   │
    │  ../../infra/io-index-*.js  │    │  ../../core/     │    │  session-rpc-tools.js │   │
    │  ../../infra/io-observab.*  │    │  error-handlers  │    │                      │   │
    │  #copilot/core              │    │                  │    │  Imports:             │   │
    │  #copilot/boot (shared.js)  │    │  exec + sandbox  │    │  #copilot/boot       │   │
    │                             │    │  security        │    │  #copilot/core       │   │
    └─────────────────────────────┘    └─────────────────┘    │  #copilot/sdk        │   │
                                                               │  zod                 │   │
                                                               └──────────────────────┘   │
                                                                                          │
    ┌──────────────────┐   ┌───────────────────┐   ┌────────────────────┐               │
    │  hub-tools.js     │   │  introspection-   │   │  permission-tools   │               │
    │  (373 lin, 5)    │   │  tools.js          │   │  (221 lin, 2)      │               │
    │                  │   │  (643 lin, 7)     │   │                    │               │
    │ Imports:         │   │                    │   │ Imports:           │               │
    │  zod             │   │  #copilot/config   │   │  #copilot/audit    │               │
    │  #copilot/config │   │  #copilot/sdk      │   │  #copilot/core     │               │
    │  #copilot/core   │   │  zod               │   │  zod               │               │
    │  ./logger.js     │   │  ./metrics-proxy   │   │  ./logger.js       │               │
    │  ./tool-factory  │   │  ./tool-contract-  │   │  ./tool-factory    │               │
    │                  │   │    verifier        │   │                    │               │
    └────────┬─────────┘   │  └─────────────────┘   └────────────────────┘               │
             │              │                                                              │
             │              └─── exports _registeredTools, _disabledTools (module state) ──┘
             │
             └── git/index.js (292 lin, 9 tools)
                  Imports: #copilot/boot, #copilot/sdk, zod, ../../core/error-handlers
```

---

## 9. Métricas de Acoplamento

| Métrica | Valor | Avaliação |
|---|---|---|
| **Fan-out médio por arquivo** | 4.2 imports externos | Moderado |
| **Fan-in máximo** | `bootstrap.js` (12 imports) | Alto ⚠️ |
| **Arquivos com >5 imports externos** | 8 | ⚠️ |
| **Módulos `#copilot/infra` acessados diretamente de `tools/`** | 6 (`io-engine`, `io-prefetch`, `io-scanner`, `io-index-registry`, `io-observability`, `io-session-scope`) | ⚠️ Violação de camada |
| **Estado global mutável (module-level)** | 11 variáveis | Alto ⚠️ |
| **Testabilidade estimada** | ~40% (requer monkey-patching) | Insuficiente |

---

## 10. Recomendações Prioritárias (original)

1. **Imediato**: Adicionar `no-restricted-imports` no ESLint para `tools/` → `infra/*` e `db/*` (previne degradação futura)
2. **Curto prazo**: Extrair domínio de `todo/store.js` em `todo/domain.js` (melhora testabilidade sem quebrar nada)
3. **Médio prazo**: Padronizar `buildTool()` universalmente (consistência + observabilidade)
4. **Médio prazo**: Converter singletons module-level em classes injetáveis (testabilidade)
5. **Longo prazo**: Separar `file/` em subpacotes com limites declarativos

---

## 11. Catálogo de Bugs, Gaps e Problemas Identificados

Esta seção documenta bugs concretos, gaps de segurança e problemas de engenharia encontrados na análise profunda de cada arquivo. Itens classificados por severidade.

### 11.1 Bugs Funcionais

| ID | Arquivo | Linha | Severidade | Descrição | Correção Sugerida |
|---|---|---|---|---|---|
| **BUG-01** | `bootstrap.js` | 132 | **CRITICAL** | `getAllTools(registry)` é chamado passando `registry` como argumento, mas `getAllTools()` em `index.js:80` **não declara nenhum parâmetro**. O parâmetro é silenciosamente ignorado via coercion de JS. Se ferramentas forem registradas dinamicamente no registry após o bootstrap, não serão incluídas no array retornado. A dependência entre `bootstrap.js` e `index.js` está quebrada em seu contrato. | Alterar `getAllTools()` para aceitar `(registry?)` e, se fornecido, mesclar tools do registry com as tools estáticas; ou remover o argumento da chamada em `bootstrap.js`. |
| **BUG-02** | `session-rpc-tools.js` | 86-89 | **HIGH** | `resolveRpcTimeoutMs()` é código morto: recebe `timeoutMs`, aplica `void timeoutMs` (expressão sem efeito), e sempre retorna `null`. A função é chamada em `wrapRpc()` (linha 104) mas o retorno nunca é utilizado. O parâmetro `opts.timeoutMs` passado individualmente por cada tool é **completamente ignorado**. Feature flags e timeouts por-call são ilusórios. | Remover o parâmetro `opts` de `wrapRpc` ou implementar `resolveRpcTimeoutMs` para realmente respeitar o timeout informado por cada tool. |
| **BUG-03** | `tool-factory.js` | 193-206 | **HIGH** | Na fallback path de `createTool()`, quando `sdkCreateTool` falha com erro recuperável, `makePlainTool` é chamado passando `options.parameters` sem normalização. Se o caller passou um schema Zod (v3 ou v4), ele será propagado como objeto bruto sem conversão para JSON Schema. Isso significa que tools criadas durante a fallback window terão contrato invisível para o modelo. | Aplicar `normalizeParameters` antes de chamar `makePlainTool` no fallback, ou pelo menos logar warning agressivo quando isso acontecer. |
| **BUG-04** | `file/shared.js` | 25-34 | **HIGH** | Todas as constantes de limite (`MAX_CONTENT_BYTES`, `MAX_SEARCH_OUTPUT`, `MAX_LIST_ENTRIES`, `MAX_DIFF_OUTPUT`) são `Number.POSITIVE_INFINITY`. Não há nenhum teto real de proteção contra leituras de arquivos gigantes ou resultados de busca massivos. Um arquivo de 10GB pode ser lido e retornado sem qualquer truncamento, causando OOM no processo. | Definir valores concretos (ex: 10MB para content, 1M para search, 10K para list) e aplicar truncamento/streaming quando necessário. |
| **BUG-05** | `file/read-tools-io.js` | 84-89 | **MEDIUM** | `warmReadThroughContext()` é chamado incondicionalmente para **toda** leitura de arquivo, inclusive para arquivos binários (`encoding: 'base64'`) ou arquivos muito pequenos. Isso gera I/O desnecessário (leitura de imports, parsing) mesmo quando não há benefício. O prefetch deveria ser condicional: apenas para arquivos de texto acima de um tamanho mínimo. | Envolver `warmReadThroughContext` em condição: executar apenas se `encoding !== 'base64'` E `stats.size > MIN_SIZE_THRESHOLD` (ex: 1024 bytes). |
| **BUG-06** | `hook-tools.js` | 274-288 | **MEDIUM** | O `autoCleanupTimer` de 10 minutos chama `deletePendingUserInputResolver` e resolve com status `'timeout'`. Porém, se o usuário responder APÓS o timer disparar mas ANTES do event loop processar o callback do timer, a resposta chegará a uma promise já resolvida e será perdida. Além disso, se `resolvePendingUserInput` é chamada manualmente (via terminal) e depois o timer dispara, há double-resolve (a segunda resolve é no-op pela flag `finished` pattern, mas `deletePendingUserInputResolver` já removeu a entry, então o timer não encontra mais o resolver e falha silenciosamente). | Adicionar guarda atômica: verificar se a promise já foi resolvida ANTES de resolver no timer. Usar `clearTimeout` no path de resolução manual bem-sucedida. |
| **BUG-07** | `web-tools.js` | 339-446 | **MEDIUM** | Quando a DDG JSON API retorna HTTP 200 mas com body inesperado (não JSON), `response.json()` na linha 354 lançará `SyntaxError`. Isso NÃO é capturado pelo `catch` na linha 440, pois o `response.ok` check na linha 352 já entrou no bloco try interno. O erro de parse vai propagar e cair no catch genérico, retornando erro genérico sem informação útil. | Adicionar try/catch específico ao redor de `response.json()` para tratar JSON malformado com mensagem clara. |
| **BUG-08** | `git/index.js` | 35-52 | **LOW** | A função `safeGitArgs` não aplica timeout real — apenas loga o `advisoryTimeoutMs`. O `execAsync` (promisify de `execFile`) não recebe timeout. Comandos git em repos muito grandes podem travar indefinidamente. Os nomes `ADVISORY_GIT_CMD_TIMEOUT_MS` e `ADVISORY_GIT_PUSH_TIMEOUT_MS` são enganosos — são puramente informativos. | Implementar timeout real via `AbortController` + `signal` no `execFileAsync`, ou documentar explicitamente que timeouts são apenas advisory. |

### 11.2 Problemas de Segurança

| ID | Arquivo | Linha | Severidade | Descrição | Correção Sugerida |
|---|---|---|---|---|---|
| **SEC-01** | `shell/sandbox.js` | 214-254 | **HIGH** | A função `safeEnv()` usa `_cache` como propriedade anexada à própria função (pattern `safeEnv._cache`). Isso é frágil e pode ser corrompido por qualquer código que tenha referência à função. Além disso, o cache TTL de **1 segundo** (linha 251: `expiresAt: now + 1000`) é excessivamente agressivo — para workloads de alta frequência, isso significa reconstrução do env sanitizado a cada segundo, e durante essa reconstrução todas as chamadas compartilham o mesmo snapshot, o que pode incluir credenciais que foram removidas do `process.env` real. | Mover o cache para uma variável module-level privada. Aumentar TTL para algo mais razoável (ex: 5-10s) ou invalidar apenas quando `process.env` mudar. |
| **SEC-02** | `shell/sandbox.js` | 196-203 | **MEDIUM** | `checkCommandBlocklist` usa regex que pode sofrer ReDoS em inputs muito longos. Os patterns usam `\b` e combinações de flags case-insensitive. Um comando intencionalmente longo com caracteres que geram backtracking pode causar degradação de performance. | Testar os patterns contra inputs adversarialmente longos; considerar uso de regex com atomic groups ou possessive quantifiers. |
| **SEC-03** | `hook-tools.js` | 245-252 | **MEDIUM** | O limite de 5 requests pendentes simultâneos (`getPendingUserInputCount() >= 5`) é verificado APÓS a geração do `requestId`, criando uma janela onde o ID é gerado mas o request é rejeitado. Mais criticamente, se dois requests forem criados em paralelo (exatas-milissegundos), ambos podem passar na checagem antes que o counter seja atualizado. | Mover a checagem de limite para ANTES da geração do requestId, ou usar lock/mutex para atomicidade. |
| **SEC-04** | `web-tools.js` | 198-202 | **MEDIUM** | Parâmetros `maxBytes` e `timeoutMs` na tool `web_fetch_local` são **estritamente informativos** — não limitam nem abortam a operação real. A documentação diz "informativo e não bloqueia", mas um usuário pode ser enganado achando que está protegendo contra consumo excessivo de recursos. | Renomear/clarificar na documentação e nos nomes dos parâmetros que são advisory-only, OU implementar limites reais. |

### 11.3 Vazamentos de Estado e Encapsulamento

| ID | Arquivo | Linha | Severidade | Descrição | Correção Sugerida |
|---|---|---|---|---|---|
| **ENC-01** | `introspection-tools.js` | 87 | **HIGH** | `_toolNameToMetadataMap` é exportado como `export const` mas é um `Map` mutável. Qualquer consumer pode fazer `_toolNameToMetadataMap.clear()` ou alterar entradas, corrompendo o estado interno de introspecção. O underscore prefix é apenas uma convenção, não proteção real. | Tornar privado (remover export) e expor apenas funções de acesso controlado (`getToolMetadata`, `recordToolCategory` já existem). |
| **ENC-02** | `introspection-tools.js` | 42-80 | **HIGH** | Múltiplas variáveis module-level são mutáveis: `_registeredTools`, `_disabledTools`, `_CATEGORY_TOOL_MAP_DYNAMIC`, `_toolNameToMetadataMap`, `_toolContractReport`. Todas compartilham escopo de módulo. Em ambiente multi-sessão (se suportado no futuro), estados colidem. | Encapsular em uma classe `IntrospectionRegistry` com instância injetável. |
| **ENC-03** | `todo/store.js` | 87 | **HIGH** | `_storeMutex` é uma promise encadeada module-level. Em caso de erro dentro de `withStore`, se `release()` nunca for chamado no `finally`, todo o chain de mutex trava permanentemente (deadlock). O try/finally parece correto, mas não há timeout de fallback no mutex. | Adicionar timeout ao mutex: se `prev` não resolver em N segundos, force-release e log warning. |
| **ENC-04** | `user-input-state.js` | 15-18 | **MEDIUM** | `_pendingInputResolvers` e `_pendingInputSeq` são module-level sem qualquer mecanismo de reset entre sessões. Se o agente for parado e reiniciado no mesmo processo, IDs sequenciais continuam de onde pararam e resolvers antigos podem colidir. | Adicionar `resetAll()` exportada para limpeza completa entre sessões, chamada no stop do agente. |
| **ENC-05** | `permission-tools.js` | 39-58 | **MEDIUM** | `_agent` é module-level e só pode conter UMA instância de agent. Se houver múltiplos agentes em futuro, este é um single point of failure. O `setPermissionAgent` tem `force` flag mas o padrão é protegido contra sobrescrita. | Documentar que apenas um agente é suportado; ou refatorar para map por agent ID. |

### 11.4 Inconsistências e Dívida Técnica

| ID | Arquivo | Linha | Severidade | Descrição | Correção Sugerida |
|---|---|---|---|---|---|
| **INC-01** | `tool-factory.js`, `introspection-tools.js`, `session-tools.js`, `session-rpc-tools.js`, `experimental-rpc-tools.js` | diversos | **MEDIUM** | 5 arquivos usam `createTool` direto do SDK (sem passar por `buildTool`), enquanto ~25 arquivos usam `buildTool`. Tools criadas com `createTool` não têm: (a) logging automático de invocação, (b) conversão automática Zod→JSON Schema, (c) tratamento de erros de factory. Isso cria disparidade de observabilidade e comportamento. | Converter todas as tools para usar `buildTool`. Para `introspection-tools.js`, `session-tools.js` etc., verificar se o logging adicional justifica a divergência, ou se é legacy de quando `buildTool` não existia. |
| **INC-02** | `todo/query-tools.js` | 14 | **LOW** | Importa `zPriority` e `zStatus` de `./store.js` para uso em schemas de filtro. Esses schemas são re-exportados pelo barrel mas o acoplamento direto ao store é desnecessário — poderiam estar no `todo-schema.js`. | Mover `zPriority` e `zStatus` para `todo-schema.js` e importar de lá. |
| **INC-03** | `web-tools.js` | 156-159 | **LOW** | Parâmetros `maxBytes` e `timeoutMs` são descritos como "informativos" na docstring mas têm nomes que sugerem controle real. Outras ferramentas como `shell/index.js` usam nomes mais claros com prefixo `advisory`. | Renomear para `advisoryMaxBytes` e `advisoryTimeoutMs` para consistência com shell tools. |
| **INC-04** | `todo/store.js` | 80-84 | **MEDIUM** | A migração `_migrateJsonLegacy()` roda sincronamente no top-level do módulo durante import. Se `todos.json` for muito grande (milhares de tarefas), o `fs.readFileSync` + `JSON.parse` + loop de inserts bloqueará o event loop durante o boot. | Tornar assíncrona ou usar batch com `setImmediate` para não bloquear. |
| **INC-05** | `bootstrap.js` | 135 | **LOW** | `wrapWithStats` é aplicado a todas as tools após `getAllTools()` mas antes de qualquer registro de introspecção. Se uma tool falhar durante `wrapWithStats`, ela será silenciosamente removida do array instrumentado mas permanecerá registrada no registry. | Adicionar try/catch individual com logging por tool durante instrumentation. |
| **INC-06** | `terminal/commands/sdk.js`, `terminal/commands/fs.js` | — | **MEDIUM** | Terminal commands importam `#copilot/tools` diretamente (fileReadTools, fileWriteTools) em vez de usar `agent/ports/tool-port.js`, bypassando a abstração do agent. | Rotejar acesso às tools via `tool-port.js` ou documentar a exceção de forma explícita. |
| **INC-05** | `bootstrap.js` | 135 | **LOW** | `wrapWithStats` é aplicado a todas as tools após `getAllTools()` mas antes de qualquer registro de introspecção. Se uma tool falhar durante `wrapWithStats`, ela será silenciosamente removida do array instrumentado mas permanecerá registrada no registry. | Adicionar try/catch individual com logging por tool durante instrumentation. |

### 11.5 Gaps de Testabilidade

| ID | Descrição | Impacto |
|---|---|---|
| **TEST-01** | 11 variáveis module-level mutáveis precisam ser reset via funções de test (existentes para algumas, ausentes para outras). | Testes de integração não conseguem isolar módulos sem monkey-patching. |
| **TEST-02** | `safeEnv()` usa `_cache` como propriedade de função — impossível de mockar sem `Object.defineProperty`. | Testes de shell tools não conseguem controlar o ambiente sanitizado. |
| **TEST-03** | `bootstrap()` orquestra 17 categorias de tools em uma única função sem granularidade. Testar falha de uma categoria requer testar todas. | Boot test é frágil e lento. |
| **TEST-04** | Todo store depende de SQLite real (`getCopilotDb()`). Não há abstração de storage para injeção de mock. | Testes de todo tools requerem banco de dados real. |
| **TEST-05** | `getAllTools(registry)` em `bootstrap.js` — como o parâmetro é ignorado, não há como testar a interação bootstrap↔registry. | Cobertura de bootstrap é limitada. |

---

## 12. Priorização Consolidada de Correções

| Prioridade | ID | Item | Esforço | Impacto |
|---|---|---|---|---|
| 🔴 P0 | **BUG-01** | `getAllTools(registry)` ignora parâmetro — contrato quebrado | Baixo | Crítico — tools dinâmicas perdidas |
| 🔴 P0 | **BUG-04** | Limites `Infinity` em file tools | Médio | OOM potencial em produção |
| 🔴 P0 | **SDK-BUG-01** | Double-wrapping logging/metrics entre tool-factory e sdk/tools/core | Médio | Dados de observabilidade incorretos |
| 🔴 P0 | **BUG-02** | `resolveRpcTimeoutMs()` é código morto | Baixo | Timeouts RPC inoperantes |
| 🟠 P1 | **SEC-01** | `safeEnv()` cache frágil + TTL 1s | Baixo | Credenciais expostas |
| 🟠 P1 | **ENC-03** | Deadlock potencial no mutex do todo store | Médio | Agente trava |
| 🟠 P1 | **BUG-03** | Fallback no factory sem normalização de schema | Médio | Tools quebram no cold start |
| 🟠 P1 | **SDK-BUG-02** | Ordem de bootstrap frágil em custom tools | Médio | Custom tools podem falhar silenciosamente |
| 🟠 P1 | **BUG-06** | Race condition no autoCleanupTimer | Médio | Memory leak / double-resolve |
| 🟠 P1 | **SDK-BUG-03** | `registerTool()` sobrescreve silenciosamente tools duplicadas | Médio | Sem detecção de duplicatas em testes |
| 🟠 P1 | **ENC-01** | `_toolNameToMetadataMap` exportado como mutável | Baixo | Corrupção de estado |
| 🟠 P1 | **SDK-BUG-04** | `_toolsConfig` sem mecanismo de reset para testes | Baixo | Isolamento de testes comprometido |
| 🟠 P1 | **SYS-GAP-02** | Dois registries desatualizados | Médio | Introspecção stale |
| 🟠 P1 | **SYS-GAP-04** | Blind spot de observabilidade no interceptor | Médio | Ataques de enumeração invisíveis |
| 🟠 P1 | **SDK-BUG-05** | ToolRegistry compartilhado entre sessões sem isolamento | Médio | Ferramentas podem vazar entre sessões |
| 🟠 P1 | **SDK-BUG-06** | Dois sistemas paralelos de user-input (SDK + legacy) | Médio | Respostas do usuário não resolvem promises pendentes |
| 🟠 P1 | **BUG-11** | Memory leak em promises pendentes no shutdown | Médio | Vazamento de memória |
| 🟠 P1 | **BUG-09** | `logToolFactory` ignora logger injetado — usa console.* | Baixo | Logs perdidos ou duplicados |
| 🟠 P1 | **SDK-BUG-08** | Métrica enganosa para tools interativas (request_user_input) | Médio | Latência reportada incorretamente |
| 🟡 P2 | **INC-01** | Padronizar `buildTool` universalmente | Médio | Observabilidade inconsistente |
| 🟡 P2 | **SDK-BUG-12** | Sem health-check/circuit-breaker para hangs em tools | Médio | Tools podem travar indefinidamente |
| 🟡 P2 | **BUG-10** | Limites `Infinity` + ausência de streaming = OOM no `read_file_content` | Médio | Produção down |
| 🟡 P2 | **TEST-04** | Abstrair storage do todo store | Médio | Testabilidade |
| 🟡 P2 | **SDK-BUG-09** | `loadZodToJsonSchema()` usa CJS require — falha em ESM puro | Baixo | Tools com Zod ficam sem JSON Schema |
| 🟡 P2 | **SDK-BUG-10** | Falso positivo na detecção de Zod (propriedade `_def` em objetos literais) | Baixo | Erro silencioso na conversão |
| 🟡 P2 | **SDK-BUG-11** | Race condition no `_toolsConfig` concorrente | Baixo | Corrupção de estado |
| 🟡 P2 | **BUG-07** | JSON parse sem try/catch específico (DDG fallback) | Baixo | Erro genérico em fallback |
| 🟡 P2 | **BUG-13** | Custom tool persistida com `handlerId` inválido — erro só aparece em build | Médio | Custom tools falham em build |
| 🟡 P2 | **BUG-15** | Shallow copy em `state.js` permite corrupção externa do estado | Baixo | Corrupção de estado |
| 🟡 P2 | **SYS-GAP-01** | Sem contrato formal SDK↔Tools | Médio | Bugs de tipo em runtime |
| 🟡 P2 | **SYS-GAP-05** | Sem versionamento semântico das tools | Baixo | Quebras silenciosas em updates SDK |
| 🟢 P3 | **SEC-03** | Race no limite de requests | Baixo | Edge case raro |
| 🟢 P3 | **SEC-04** | Parâmetros advisory mal nomeados | Baixo | Confusão do usuário |
| 🟢 P3 | **SYS-GAP-03** | Sem versionamento de compatibilidade de tools | Baixo | Quebras silenciosas em updates SDK |
| 🟢 P3 | **SYS-GAP-06** | Sem health-check por domínio | Baixo | Diagnóstico manual |
| 🟢 P3 | **SYS-GAP-07** | Sem health-check granular por subsistema | Baixo | Diagnóstico manual |
| 🟢 P3 | **SYS-GAP-08** | Sem circuit-breaker para hangs em tools internas | Baixo | Tools podem travar indefinidamente |
| 🟢 P3 | **SYS-GAP-09** | Segurança fragmentada (safeEnv, BLOCKED_PATTERNS, allowlist, checkCommandBlocklist) | Baixo | Inconsistência defensiva |
| 🟢 P3 | **SYS-GAP-10** | Sem health-check por domínio de tools | Baixo | Diagnóstico manual |
| 🟢 P3 | **BUG-14** | `normalizeAgentToolList` não filtra null | Baixo | Entrada fantasma em Set |
| 🟢 P3 | **BUG-16** | Race condition em `answerNext()` | Baixo | Double-consume assíncrono |
| 🟢 P3 | **BUG-17** | `generateId()` usa `Math.random()` | Baixo | Colisão remota de IDs |

---

## 13. Análise Sistêmica: SDK ↔ Tools (`src/copilot/sdk/` × `src/copilot/tools/`)

### 13.1 Arquitetura de Duas Fábricas Paralelas

O projeto possui **duas factories de tools** com responsabilidades sobrepostas e interfaces distintas:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  sdk/tools/core.js (Fábrica SDK)                                        │
│  ├── createTool() / createToolSync()                                    │
│  ├── tryZodToJsonSchema() — conversão Zod v3/v4 → JSON Schema          │
│  ├── loadZodToJsonSchema() — carrega zod-to-json-schema (CJS require)  │
│  ├── defineToolSafe() — wrapper com fallback para mocks                 │
│  └── wrappedHandler() — logging DEBUG básico (sessionId)                │
│                                                                          │
│  tools/tool-factory.js (Fábrica Tools)                                  │
│  ├── buildTool() — wrapper de convenção do projeto                      │
│  ├── normalizeParameters() — mesma lógica Zod v3/v4→JSON Schema         │
│  ├── tryZodV4ToJsonSchema() — DUPLICADA de sdk/tools/core.js            │
│  ├── makePlainTool() — fallback plain object (TDZ-safe)                 │
│  └── wrappedHandler() logging + logToolFactory() — CONFLITANTE          │
│                                                                          │
│  RELAÇÃO: tools/buildTool() → NÃO usa sdk/createTool()                  │
│           tools/buildTool() → USA sdk/defineTool (via createTool())      │
│           sdk/createTool() → defineToolSafe() → defineTool() SDK        │
└──────────────────────────────────────────────────────────────────────────┘
```

**Problema central**: Existem **duas implementações paralelas** de normalização Zod→JSON Schema, com lógica quase idêntica, mantidas em sincronia manualmente. Ambas tentam:
1. Detectar Zod v4 (`_zod` property) → `tryZodV4ToJsonSchema()`
2. Fallback para `zod-to-json-schema` (CJS require dinâmico)
3. Fallback para `schema.toJSONSchema()` (Zod v4 nativo)

Qualquer correção na lógica de conversão precisa ser aplicada em **dois lugares**.

### 13.2 Grapho Completo SDK ↔ Tools

```
src/copilot/sdk/
├── tools/
│   ├── core.js               ← re-exporta defineTool do SDK
│   │                           e exporta createTool() (F.8.1, F.8.2)
│   ├── registry.js            ← registry funcional (createRegistry, registerTool, etc.)
│   │                           opera sobre Map<name, ToolEntry>
│   ├── state.js               ← allowlist/denylist persistido (F.9.2)
│   │                           NOTA: usa module-level state (_toolsConfig)
│   ├── agent-policy.js        ← AgentToolPolicy class (F.9.1 compliant)
│   │
│   └── custom.js              ← custom tools declarativas
│       ├── BUILTIN_HANDLER_MAP (echo, timestamp, env_read, process_info, uptime, math_eval)
│       ├── setCustomToolsBuilder({buildTool}) ← injeta tools/buildTool
│       │   (conexão SDK ↔ tools/ via DI tardio)
│       └── buildCustomTools() → usa _buildTool para instanciar tools
│
├── rpc/
│   ├── ops.js                 ← RPC ops (toolsHandlePendingCall, shellExec, etc.)
│   └── session.js             ← RPC session (model, mode, plan, workspace)
│
├── session/
│   ├── user-input.js          ← ask_user / onUserInputRequest handlers
│   ├── elicitation.js         ← Elicitation handler
│   ├── permissions.js         ← Permission event handlers
│   └── client.js              ← CopilotClient lifecycle
│
└── di-tokens.js               ← SDK_LOGGER, TOOLS_BUILDER, SDK_CLIENT_MANAGER, SDK_MODEL_RUNTIME
```

**Pontes SDK ↔ Tools:**

```
sdk/tools/custom.js  ←→  tools/tool-factory.js
  │   (via setCustomToolsBuilder / TOOLS_BUILDER DI token)
  │
sdk/di-tokens.js     ←→  tools/di-tokens.js
  │   (TOOLS_LOGGER, TOOLS_METRICS tokens registrados no mesmo container DI)
  │
sdk/tools/state.js   ←→  tools/tool-contract-verifier.js
  │   (Ambos gerenciam estado de configuração de tools, mas de domínios diferentes)
  │
sdk/rpc/ops.js       ←→  tools/shell/index.js
  │   (shellExec RPC → shellTools execução real)
  │
sdk/session/user-input.js  ←→  tools/hook-tools.js
  │   (onUserInputRequest → user-input-state.js pending resolvers)
  │
sdk/session/events.js      ←→  tools/introspection-tools.js
  │   (onToolCall events → metrics-proxy.js)
```

### 13.3 O Pattern de DI Tardio (Late Binding)

Ambas as fábricas usam **DI por setter injection** em vez de constructor injection:

```
Padrão observado (copiado em 8+ lugares):
─────────────────────────────────────────
// 1. Declarar variável module-level
let _session = null;

// 2. Exportar setter
export function setXxx(value) { _xxx = value; }

// 3. Usar dentro de handlers com verificação
function requireXxx() {
    if (!_xxx) throw new Error('xxx não injetado');
    return _xxx;
}
```

**Instâncias desse pattern em tools/:**
| Módulo | Variável | Setter |
|---|---|---|
| `hub-tools.js` | `_injectedHub` | `setHub()` |
| `permission-tools.js` | `_agent` | `setPermissionAgent()` |
| `session-rpc-tools.js` | `_rpc` | `setSessionRpc()` |
| `experimental-rpc-tools.js` | `_session` | `setExperimentalSession()` |
| `metrics-proxy.js` | `_impl` | `setToolsMetrics()` |
| `logger.js` | `_injectedLogger` | `setToolsLogger()` |
| `hook-tools.js` | `_broadcastSse` | `configureHookTools()` |

**Instâncias no SDK:**
| Módulo | Variável | Setter |
|---|---|---|
| `sdk/custom.js` | `_buildTool` | `setCustomToolsBuilder()` |
| `sdk/logger.js` | `_log` | `setSdkLogger()` |
| `sdk/tools/state.js` | `_toolsConfig` | — (carregado via async load) |

### 13.4 Conflito de Logging

Há **três fontes de logging** competindo:

1. **`tools/logger.js`** — proxy com injeção via `setToolsLogger()`. Fallback: `console.*`.
2. **`sdk/logger.js`** — proxy com injeção via `setSdkLogger()`. Fallback: `console.warn/console.error` apenas (suprime INFO/DEBUG).
3. **`tool-factory.js`** — `logToolFactory()` local inline. Fallback: `console.*` direto.

**Problema**: `tool-factory.js:logToolFactory()` (linha 214-225) usa `console.error/warn/info/debug` diretamente, **ignorando** tanto o `tools/logger.js` quanto o `sdk/logger.js`. Isso significa que:
- Logs da factory durante cold-start (quando loggers ainda não foram injetados) são perdidos ou vão para console raw
- Não há rotação de nível consistente
- Não há integração com o pipeline de observabilidade

### 13.5 Conflito de Métricas

Similarmente, há **duas camadas de métricas**:

1. `observability/tool-stats.js` — `wrapWithStats()` (SDK-level, rastreia latência/erros)
2. `tools/metrics-proxy.js` — `recordToolCall()` (Tools-level, proxy para observability)

Em `bootstrap.js:135-138`:
```js
const instrumentedTools = allTools.map(wrapWithStats);  // SDK stats
registerForIntrospection(instrumentedTools, registry);
```

E em `shell/index.js:244-246`:
```js
recordToolCall('shell.exec_command', result.durationMs, result.exitCode === 0);  // Tools metrics
```

Resultado: **As mesmas tools são rastreadas em dois sistemas paralelos** com granularidades diferentes.

### 13.6 O Problema getToolsByPrefix / Nomeação

O SDK usa nomes no formato `namespace.action` (ex: `shell.exec_command`, `web.web_fetch_local`), mas as tools em `tools/` usam nomes flat (ex: `exec_command`, `web_fetch_local`). A correspondência é feita ad-hoc em `tool-stats.js:136-141`:

```js
const category = (name.includes('.') ? name.split('.')[0] : 'other') ?? 'other';
```

Mas as tools registradas via introspecção NÃO seguem este formato — `git_status` em vez de `git.status`, `todo_create` em vez de `todo.create`. Isso gera categorização inconsistente.

---

## 14. Novos Bugs e Gaps (SDK + Tools Integration)

### 13.1 Bugs de Integração SDK↔Tools

| ID | Severidade | Descrição | Local | Correção Sugerida |
|---|---|---|---|---|
| **SDK-BUG-01** | **CRITICAL** | `tools/buildTool()` (tool-factory.js) NÃO usa `sdk/createTool()` internamente — usa `sdk/defineTool` diretamente via `createTool()` que é o wrapper do SDK. Porém `sdk/createTool()` (sdk/index.js:212-214) chama `createToolCore()` de `sdk/tools/core.js`, que por sua vez chama `defineToolSafe()` → `defineTool()`. Isso significa que **cada tool passa por dois layers de wrapping**: factory handler log (tool-factory) + SDK handler log (sdk/tools/core). Se `tool-factory.js` for migrado para usar `buildTool` do SDK (conforme planejado), haverá **double-wrapping** e double-counting de métricas. | `tools/tool-factory.js:193` × `sdk/tools/core.js:239` | Antes de fundir as fábricas, garantir que apenas UM layer de wrapping/logging exista. Definir claramente se `tools/buildTool` é a canonical (e SDK `createTool` é raw) ou vice-versa. |
| **SDK-BUG-02** | **HIGH** | `sdk/tools/custom.js:351` faz `const buildTool = _buildTool ?? createToolSync`. O `_buildTool` é injetado via `setCustomToolsBuilder()` chamado em `observability/bootstrap.js:218`. Se `bootstrapLateDeps()` for chamado ANTES de `setToolsLogger/Metrics`, o builder terá logger/metrics não-inicializados dentro de tools custom. **Ordem de bootstrap frágil e não documentada.** | `sdk/tools/custom.js:351` × `observability/bootstrap.js:215-219` | Documentar a ordem de bootstrap. Adicionar verificação de dependências no builder. |
| **SDK-BUG-03** | **HIGH** | `sdk/tools/registry.js:76` — `registerTool()` sobrescreve silenciosamente tools com mesmo nome (`Map.set`). Não há warning. Em `bootstrap.js:150-160` há detecção de duplicatas (log warning), MAS isso ocorre **depois** do registro. Se o registro for usado antes do bootstrap completar (por exemplo, em testes), duplicatas passarão despercebidas. | `sdk/tools/registry.js:76` + `tools/bootstrap.js:150` | Acrescentar warning no `registerTool()` quando key já existir. |
| **SDK-BUG-04** | **HIGH** | `sdk/tools/state.js:30` — `_toolsConfig` é module-level mutable state com padrão `{ allowlist: null, denylist: [] }`. Não há nenhum mecanismo de reset para testes (diferente de custom.js que tem `_resetRegistry()`). Testes que verificam policy de tools não conseguem isolar estado. | `sdk/tools/state.js:30` | Adicionar `_resetToolsConfig()` export para testes, similar ao `_resetRegistry()` em custom.js. |
| **SDK-BUG-05** | **MEDIUM** | `sdk/rpc/ops.js` executa `toolsHandlePendingCall` (linha 57 exportada) — este RPC opera sobre o ToolRegistry, mas a documentação não esclarece como o registry é sincronizado entre a sessão principal e o RPC handler. Se uma sessão tem tools registradas e outra sessão herda o registry, ferramentas podem vazar entre sessões. | `sdk/rpc/ops.js:57` × `sdk/tools/registry.js` | Garantir que cada sessão tenha seu próprio registry isolado, ou documentar o modelo de compartilhamento. |
| **SDK-BUG-06** | **MEDIUM** | `sdk/session/user-input.js` implementa `onUserInputRequest` — este mecanismo compete com `tools/user-input-state.js`. O SDK tem seu próprio gerenciamento de pending inputs via protocolo de elicitação. Quando `request_user_input` (hook-tools) é chamada, ela usa `user-input-state.js`, mas o SDK também pode receber inputs via `onUserInputRequest`. **Dois sistemas paralelos de gerenciamento de input do usuário.** | `sdk/session/user-input.js` × `tools/user-input-state.js` × `hooks/tool-interceptor.js` | Consolidar ambos os mecanismos. A tool `request_user_input` deveria delegar ao SDK user-input, ou vice-versa. |
| **SDK-BUG-07** | **MEDIUM** | `sdk/tools/custom.js:89-123` — O handler `env_read` retorna valores de env vars na allowlist. Porém, `shell/sandbox.js:213-254` remove agressivamente env vars sensíveis via `safeEnv()`. Se um subprocesso shell é gerado depois de `env_read` expor valores, as credenciais podem estar disponíveis em logs/resultados da tool custom mas não no ambiente do subprocesso. **Inconsistência de security posture entre camadas.** | `sdk/tools/custom.js:89` × `tools/shell/sandbox.js:213` | Documentar o escopo de cada mecanismo. `env_read` retorna apenas para o modelo (não para execução). `safeEnv` protege subprocessos. Mas se o modelo obtém valor via `env_read` e tenta usá-lo em `exec_command`, o safeEnv bloqueará — comportamento correto mas não documentado. |
| **SDK-BUG-08** | **MEDIUM** | `tools/observability/tool-stats.js:97-118` — `wrapWithStats()` cria handler async que registra métricas. Mas a tool `request_user_input` (hook-tools.js:251) retorna uma **Promise que fica suspensa** até o usuário responder. Durante essa suspensão, a métrica de "chamada" é registrada imediatamente (sucesso), mas o tempo real decorrido só será conhecido quando o usuário responder. **Métrica de latência enganosa** para tools interativas. | `observability/tool-stats.js:108-110` × `tools/hook-tools.js:251-297` | Filtrar tools interativas do stats wrapping, ou registrar métricas de forma assíncrona (após resolução da promise). |

### 13.2 Gaps Arquiteturais Sistêmicos

| ID | Severidade | Descrição | Impacto |
|---|---|---|---|
| **SYS-GAP-01** | **HIGH** | **Falta de contrato formal via interface/protocolo entre SDK e Tools.** O SDK define `Tool`, `ToolHandler`, `ToolRegistry` como types; as tools implementam ad-hoc. Não há validação em build-time de que tools atendem ao contrato esperado pelo SDK. | Bugs de tipo só são detectados em runtime. |
| **SYS-GAP-02** | **HIGH** | **Dois registries com funcionalidades sobrepostas:** `sdk/tools/registry.js` (funcional, baseado em Map) e `tools/introspection-tools.js` (module-level state, derivado do registry). A introspecção mantém `_registeredTools` separado do registry Map. Se o registry for modificado (ex: remoção de tool), a introspecção fica desatualizada. | Ferramentas de diagnóstico mostram informações stale. |
| **SYS-GAP-03** | **MEDIUM** | **Não há mecanismo de versionamento de tools.** Quando o SDK é atualizado (ex: v0.3.0 → v0.4.0), as tools do `src/copilot/tools/` não têm como declarar versão mínima do SDK ou compatibilidade. O `custom.js` tem versionamento do schema (`SCHEMA_VERSION` no todo-schema) mas não para as tools em si. | Atualização do SDK pode quebrar tools silenciosamente. |
| **SYS-GAP-04** | **MEDIUM** | **Observabilidade desconectada da autoridade de decisão.** `tool-interceptor.js` (hooks) decide allow/deny ANTES da tool executar. `tool-stats.js` (observability) contabiliza APÓS execução. Mas ferramentas bloqueadas pelo interceptor NÃO são rastreadas nos stats. Isso significa que um ataque de enumeração de tools (tentar todas e ver quais são bloqueadas) não aparece no dashboard de métricas. | Blind spot de segurança na observabilidade. |
| **SYS-GAP-05** | **LOW** | **Circular load path em cenários de teste.** `tools/tool-factory.js` precisa de `sdk/createTool`, `sdk/tools/core.js` precisa de `@github/copilot-sdk`. Em testes unitários, mockar uma dessas dependências requer setup complexo e pode causar TDZ errors se a ordem de import/setup estiver errada. | Dificuldade em testes unitários isolados. |
| **SYS-GAP-06** | **LOW** | **Não há health-check por domínio de tools.** Existem checks de saúde genéricos (`get_system_health`), mas nenhuma tool verifica "o subsistema de filesystem tools está saudável" ou "o registry de custom tools está carregado". | Diagnóstico de falhas parcial requer investigação manual. |

### 13.3 Inconsistências de Nomenclatura entre SDK e Tools

| Aspecto | Convenção SDK | Convenção Tools | Conflito |
|---|---|---|---|
| Nomes de tools | `camelCase` (implícito) | `snake_case` | SDK `createTool` aceita qualquer nome; tools usam `snake_case` mas sem enforcement |
| Skip permission | `skipPermission` (propriedade direta) | `withSkipPermission()` (wrapper) | Dois mecanismos equivalentes; `withSkipPermission` cria cópia do objeto, `skipPermission` é nativo |
| Handler signature | `(args, invocation)` | `(args, invocation)` | Consistente ✓ |
| Error handling | SDK lança exceções | Tools retornam `{ success: false, error }` | Mismatch: erros lançados em tools podem não ser capturados pelo SDK |
| Parameters | `Record<string, unknown>` | Zod schema ou plain object | Conversão duplicada (tools → JSON Schema → SDK → validação) |

---

## 15. Bugs Adicionais Encontrados (Complemento ao Catálogo da Seção 11)

| ID | Arquivo | Linha | Severidade | Descrição | Correção Sugerida |
|---|---|---|---|---|---|
| **BUG-09** | `tool-factory.js` | 68 | **MEDIUM** | Importa `COPILOT_LOG_LEVEL` de `#copilot/config` para o log level da factory. Porém `tools/logger.js` já faz level filtering. Resultado: logs da factory usam `COPILOT_LOG_LEVEL` diretamente via `console.debug/info/warn/error`, ignorando o logger injetado. Se `setToolsLogger` for chamado, logs da factory continuam indo pelo caminho `console.*` porque `logToolFactory` não usa o logger injetado. | `logToolFactory` deve delegar ao mesmo logger injetado em `setToolsLogger`, ou ser removido e usar `./logger.js`. |
| **SDK-BUG-09** | `sdk/tools/core.js` | 49-61 | **MEDIUM** | `loadZodToJsonSchema()` usa `createRequire(import.meta.url)` para carregar `zod-to-json-schema`. Em ambientes ESM puros (sem CJS interop), este `requireFromHere` pode falhar com `ERR_REQUIRE_ESM`. O código trata o erro (catch vazio), mas fica sem conversor — tools com Zod ficam sem JSON Schema. | Adicionar fallback para import dinâmico (`import('zod-to-json-schema')`) antes de desistir. |
| **SDK-BUG-10** | `sdk/tools/core.js` | 141 | **LOW** | `tryZodToJsonSchema` verifica `'_def' in schema || '_zod' in schema`. Se um usuário passar um objeto literal com propriedade nomeada `_def` (ex: `{ _def: 'test' }`), será falso-positivamente detectado como Zod schema e tentará conversão, resultando em erro silencioso. | Adicionar verificação mais robusta (ex: `schema instanceof z.ZodType` ou verificar `schema._def` ser um objeto Zod interno específico). |
| **BUG-10** | `tools/file/shared.js` | 25-34 | **HIGH** | Os limites infinitos (`MAX_CONTENT_BYTES`, `MAX_SEARCH_OUTPUT`, etc.) combinados com a ausência de streaming no handler significam que `read_file_content` de um arquivo de 2GB alocará 2GB em memória de uma vez. Não há mecanismo de chunked response no protocolo SDK. | Implementar limite máximo concreto (ex: 5MB) e retornar erro informativo quando excedido, OU implementar streaming via chunks. |
| **SDK-BUG-11** | `sdk/tools/state.js` | 30 | **MEDIUM** | `_toolsConfig` initial value `{ allowlist: null, denylist: [] }` é shared module state. Se dois módulos modificarem simultaneamente (ex: `patchToolsConfig` chamado de dois lugares), há race condition no estado. | Usar mutex ou snapshot isolation para updates. |
| **BUG-11** | `tools/hook-tools.js` | 252-287 | **HIGH** | O `request_user_input` cria uma Promise que só resolve quando `resolveUserInput()` é chamado externamente. Se o agent for interrompido/shutdown enquanto a promise está pendente, o resolver pode nunca ser chamado, causando memory leak da promise e do timer de cleanup de 10min. | Adicionar cleanup no shutdown path: rejeitar todas as promises pendentes no `unbindAgentSessionTools()` ou equivalente. |
| **SDK-BUG-12** | `sdk/rpc/ops.js` | - (implícito) | **HIGH** | Não há heartbeat/health-check entre o SDK e as tools. Se o processo de um tool handler travar (ex: infinite loop em `exec_command`), o SDK não tem mecanismo de timeout ou circuit-breaker. O timeout de 120s em `ADVISORY_TIMEOUT_MS` é apenas informativo. | Implementar health-check periódico e circuit-breaker para chamadas de tools de longa duração. |

---

## 16. Fragmentação da Camada de Permissões

O sistema possui **5 mecanismos independentes** de enforcement de permissões que não se coordenam:

| # | Mecanismo | Origem | Escopo |
|---|---|---|---|
| 1 | `tools/permission-tools.js` | `_agent` + `setPermissionAgent()` | Permissão baseada em agente |
| 2 | `hooks/presets/production.js` | `createProductionHooks()` + `isToolDisabled` | Allow/deny lists + toggle de runtime |
| 3 | `hooks/tool-interceptor.js` | `createRuntimeDisableHook()`, `createBlocklistHook()`, `createAllowlistHook()` | Interceptação de hooks |
| 4 | `sdk/session/permissions.js` | `createPermissionHandler()` | Hierarquia estruturada (denyKinds → denyPatterns → denyTools → allowTools → allowAll → default) |
| 5 | `sdk/tools/agent-policy.js` | `AgentToolPolicy` class | Per-agent allowlists + global allow/deny |

### Problemas identificados

1. **Decisões contraditórias possíveis**: Uma tool pode ser permitida pelo mecanismo 3 (blocklist não a inclui) mas bloqueada pelo mecanismo 5 (agent-policy a nega). Não há chain of authority definido.

2. **Auditoria fragmentada**: Cada mecanismo registra decisões em seu próprio log/sistema. Não há um audit trail unificado.

3. **Inconsistência de estado**: `hooks/presets/production.js:24` importa `isToolDisabled` de `#copilot/tools`, que depende do module-level state `_disabledTools` em `introspection-tools.js`. Porém o `sdk/session/permissions.js` opera sobre `PermissionRequest` do SDK, que as tools nunca veem.

4. **Tools desabilitadas visíveis**: Quando `toggle_tool` desabilita uma tool via `introspection-tools.js`, ela é removida do `_registeredTools` do módulo MAS permanece registrada no `ToolRegistry` do SDK. Uma chamada via RPC que contorne os hooks legacy ainda pode encontrá-la.

### Correção sugerida

Fundir em um único engine de políticas. O `createPermissionHandler()` do SDK já tem a estrutura correta (layered evaluation). Estendê-lo para:
- Receber `AgentToolPolicy` decisions como pre-processor
- Consultar `introspection-tools` para estado de toggle
- Ser o único ponto de decisão e auditoria

---

## 17. O Sistema Duplo de User-Input

Dois sistemas paralelos gerenciam o mesmo conceito ("o usuário precisa fornecer input"):

### Path A — `tools/user-input-state.js` (legado)
- `requestUserInput()` cria pending resolver em `_pendingInputResolvers`
- `resolveUserInput()` é chamado de `tool-port.js:resolveAgentUserInput()`
- Auto-cleanup por timer de 10 minutos
- Usado por `hook-tools.js:request_user_input`

### Path B — `sdk/session/user-input.js` (moderno)
- `createQueuedInputHandler()` — fila com maxSize
- `createReadlineInputHandler()` — readline de terminal
- `createStaticInputHandler()` — para testes
- Normaliza eventos via `normalizeUserInputRequestedEvent()` / `normalizeUserInputCompletedEvent()`
- Integrado ao lifecycle de sessão do SDK

### Problemas
1. **Incompatibilidade**: Um usuário respondendo via Path B **não resolve** um pending input do Path A
2. **Sem normalização**: Path A não normaliza eventos — usa raw string matching
3. **Sem timeout no Path A**: O timer de 10 min é hardcoded, sem configuração via SDK
4. **Race condition**: Se o agent for interrompido enquanto uma promise do Path A está pendente, o resolver nunca é chamado — memory leak (BUG-11)

### Correção sugerida
Depreciar Path A. Fazer a tool `request_user_input` delegar ao `createQueuedInputHandler()` do SDK. `user-input-state.js` deve se tornar adapter fino para compatibilidade reversa.

---

## 18. O Buraco Cego do tool-interceptor

`hooks/tool-interceptor.js` bloqueia tools **ANTES** da execução (retornando `{ permissionDecision: 'deny' }`). Consequências:

1. Tools bloqueadas nunca executam → `wrapWithStats()` em `observability/tool-stats.js` nunca as registra
2. Não há contador de "tentativas bloqueadas"
3. Um atacante pode enumerar tools observando quais retornam sucesso vs. permitDecision='deny' — **blind spot de segurança**
4. No production preset, tools desabilitadas em runtime ainda aparecem em `list_tools` (introspection mostra todas as registered)

### Correção sugerida
Adicionar `recordBlockedToolCall()` em `observability/tool-stats.js`. Fazer `tool-interceptor.js` chamá-lo em deny. Atualizar dashboard de métricas para mostrar tentativas bloqueadas por tool.

---

## 19. Novos Bugs e Gaps Encontrados (SDK + Camada de Integração)

### 19.1 Bugs Funcionais Adicionais

| ID | Severidade | Descrição | Local | Correção Sugerida |
|---|---|---|---|---|
| **BUG-12** | HIGH | `hooks/presets/production.js:24` importa `isToolDisabled` de `#copilot/tools`. Este import depende do module-level state de `introspection-tools.js`. Se a introspecção for resetada (testes), o import fica stale com referência antiga. | `hooks/presets/production.js:24` | Injetar a função via configuração de hooks em vez de import direto, ou garantir que o binding seja sempre dinâmico. |
| **BUG-13** | MEDIUM | `sdk/tools/custom.js:315` — `_registry.set(def.name, ...)` não valida se o `handlerId` corresponde a um handler real **antes** de persistir no disco. O erro só aparece quando `buildCustomTools()` é chamado. | `sdk/tools/custom.js:315` | Validar `handlerId` contra `BUILTIN_HANDLER_MAP` no `registerCustomTool()` (já faz isso!) MAS permitir que dados inválidos sejam persistidos se `BUILTIN_HANDLER_MAP` for alterado posteriormente. Adicionar versionamento do mapa. |
| **BUG-14** | MEDIUM | `sdk/tools/agent-policy.js:53` — `normalizeAgentToolList()` usa a saída de `resolveToolName()` como chave de `Set`. Se tool names contiverem caracteres especiais de regex, a comparação funciona (é string equality, não regex). **Porém**, `resolveToolName()` retorna `null` para nomes desconhecidos, e `null` é adicionado ao Set, causando entrada fantasma. | `sdk/tools/agent-policy.js:53` | Filtrar `null` values antes de criar o Set: `.filter(Boolean)`. |
| **BUG-15** | MEDIUM | `sdk/tools/state.js:48` — `_toolsConfig = { allowlist: result.data.allowlist, denylist: result.data.denylist }` faz shallow reference. Embora `getToolsConfig()` retorne spread, se o `patchToolsConfig` for chamado com o próprio `getToolsConfig()` result, os mesmos arrays serão referenciados mutavelmente. | `sdk/tools/state.js:48,97-108` | Deep clone na entrada e saída de `patchToolsConfig`. |
| **BUG-16** | LOW | `sdk/session/user-input.js:221` — `answerNext()` faz `queue.shift()` mas há race condition assíncrona: dois consumers podem resolver o mesmo `pending`. | `sdk/session/user-input.js:221` | Adicionar guard `if (pending)` já dentro do microtask após `shift()`, ou usar Mutex. |
| **BUG-17** | LOW | `tools/todo/store.js:178` — `generateId()` usa `Math.random()` (não criptográfico). Em alta carga, há probabilidade não-zero de colisão. O `upsert` SQLite sobrescreve silenciosamente. | `tools/todo/store.js:178` | Usar `crypto.randomUUID()` (Node 19+) ou prefixed UUID. |

### 19.2 Gaps Arquiteturais Sistêmicos (Adicionais)

| ID | Severidade | Descrição |
|---|---|---|
| **SYS-GAP-07** | HIGH | **Nenhum health-check granular por subsistema.** `get_system_health` (introspection-tools.js) é genérico. Não verifica: "registry de custom tools carregado?", "mutex do todo store íntegro?", "safeEnv cache funcional?". |
| **SYS-GAP-08** | MEDIUM | **Sem circuit-breaker para hangs em tools internas.** O SDK tem circuit-breaker para erros de rede mas não para hangs de tools. Se `exec_command` travar, só o timeout advisory (120s, não aplicado) o detectaria. |
| **SYS-GAP-09** | LOW | **Segurança fragmentada.** `safeEnv()` (shell), `BLOCKED_PATTERNS_SECRETS` (file), allowlist de `env_read` (custom tools), e `checkCommandBlocklist` (shell) são implementações independentes sem coordenação central. |
| **SYS-GAP-10** | MEDIUM | **Sem versionamento semântico das tools.** Quando o SDK atualiza (ex: v0.3.0 → v0.4.0), as tools não declaram compatibilidade. O `buildCustomTools()` tenta instanciar todas — se uma API do SDK mudar, tools custom podem quebrar silenciosamente. |

### 19.3 Bugs de Integração SDK↔Tools (Revisão do SDK-BUG-01)

| ID | Severidade | Descrição | Local |
|---|---|---|---|
| **SDK-BUG-01-r1** | HIGH | A análise inicial reportou double-wrapping entre `tool-factory.js` e `sdk/tools/core.js`. Após investigação profunda: `tools/buildTool()` chama `sdk/createTool()` (via import de `#copilot/sdk`), que chama `sdk/tools/core.js:createToolCore()`, que chama `defineToolSafe()` → SDK `defineTool()`. O handler do `tools/buildTool()` envolve com logs E métricas. O handler do `sdk/tools/core.js:createTool()` também envolve com log DEBUG. Resultado: cada invocação de tool gera **2 entradas de log DEBUG** e potencialmente **2 chamadas** ao sistema de métricas (dependendo de como `recordToolCall` é deduplicado). A correção não é apenas "unificar" — é decidir qual layer é o **único** responsável por observabilidade. | `tools/tool-factory.js:186` × `sdk/tools/core.js:258-259` |
| **SDK-BUG-01-r2** | MEDIUM | `tools/tool-factory.js` importa `createTool` como nomeado de `#copilot/sdk`, mas usa `sdk/defineTool` (via deep import?) diretamente em seu código. A relação exata precisa ser verificada: o `tool-factory.js` usa `createTool` do SDK para criar a tool final, mas também implementa seu próprio wrapping. A fusão das factories deve considerar que `createToolCore()` no SDK pode receber um `handler` já-wrapped e adicionar outro layer. | Verificar import exato em tool-factory.js:6 |

---

## 20. Priorização Consolidada Final

| # | Prioridade | ID(s) | Item | Esforço | Impacto |
|---|---|---|---|---|---|
| 1 | 🔴 P0 | BUG-01 | `getAllTools(registry)` ignora parâmetro — contrato quebrado | Baixo | Crítico |
| 2 | 🔴 P0 | BUG-04/10 | Limites `Infinity` → OOM no `read_file_content` | Médio | Produção down |
| 3 | 🔴 P0 | SDK-BUG-01 | Double-wrapping logging/metrics | Médio | Dados de observabilidade incorretos |
| 4 | 🔴 P0 | BUG-02 | `resolveRpcTimeoutMs()` é código morto | Baixo | Timeouts RPC inoperantes |
| 5 | 🟠 P1 | SEC-01 | `safeEnv()` cache frágil + TTL 1s | Baixo | Credenciais expostas |
| 6 | 🟠 P1 | ENC-03 | Deadlock potencial no mutex do todo store | Médio | Agente trava permanentemente |
| 7 | 🟠 P1 | BUG-11 | Memory leak em promises pendentes no shutdown | Médio | Vazamento de memória |
| 8 | 🟠 P1 | BUG-03 | Fallback no factory sem normalização Zod | Médio | Tools quebram no cold start |
| 9 | 🟠 P1 | SYS-GAP-01 | Sem contrato formal SDK↔Tools | Médio | Bugs de tipo em runtime |
| 10 | 🟠 P1 | SYS-GAP-04 | Blind spot: bloqueios não rastreados | Médio | Ataques de enumeração invisíveis |
| 11 | 🟠 P1 | SYS-GAP-02 | Dois registries desatualizados | Médio | Introspecção stale |
| 12 | 🟠 P1 | BUG-12 | `production.js` importa `isToolDisabled` diretamente | Médio | Stale reference em testes |
| 13 | 🟡 P2 | INC-01 | Padronizar `buildTool` universalmente | Médio | Observabilidade inconsistente |
| 14 | 🟡 P2 | SYS-GAP-05 | Sem versionamento semântico das tools | Baixo | Quebras silenciosas |
| 15 | 🟡 P2 | BUG-13 | `custom.js` persiste handlerId inválido | Médio | Custom tools falham em build |
| 16 | 🟡 P2 | BUG-15 | Shallow copy em `state.js` | Baixo | Corrupção de estado |
| 17 | 🟡 P2 | BUG-07 | JSON parse sem try/catch (DDG) | Baixo | Erro genérico em fallback |
| 18 | 🟡 P2 | TEST-04 | Abstrair storage do todo store | Médio | Testabilidade |
| 19 | 🟢 P3 | INC-04 | Migração síncrona bloqueante | Baixo | Boot lento |
| 20 | 🟢 P3 | SYS-GAP-07 | Sem health-check granular | Baixo | Diagnóstico manual |
| 21 | 🟢 P3 | SYS-GAP-08 | Sem circuit-breaker para hangs | Baixo | Tools podem travar indefinidamente |
| 22 | 🟢 P3 | SYS-GAP-09 | Segurança fragmentada | Baixo | Inconsistência defensiva |
| 23 | 🟢 P3 | BUG-14 | `normalizeAgentToolList` não filtra null | Baixo | Entrada fantasma em Set |
| 24 | 🟢 P3 | BUG-16 | Race condition em `answerNext()` | Baixo | Double-consume assíncrono |
| 25 | 🟢 P3 | BUG-17 | `generateId()` usa `Math.random()` | Baixo | Colisão remota de IDs |
| 26 | 🔴 P0 | **BUG-24** | MCP circuit breaker: state mutable module-level | Médio | Corrupção em concorrência |
| 27 | 🟠 P1 | **BUG-33** | Audit preset registra "allow" para denied hooks | Médio | Auditoria enganosa |
| 28 | 🟠 P1 | **SYS-GAP-11** | Terminal sem limites de módulo (nenhum ESLint rule) | Médio | Degradação arquitetural livre |
| 29 | 🟠 P1 | **SYS-GAP-12** | Event adapter coverage sem validação build-time | Médio | Eventos silenciosamente ignorados |
| 30 | 🟠 P1 | **SYS-GAP-14** | `active-tool-call-registry` singleton vs session-scoped | Médio | Vazamento cross-session |
| 31 | 🟠 P1 | **BUG-25** | MCP tools sem `buildTool` wrapper (observabilidade degradada) | Médio | Dois níveis de tools |
| 32 | 🟠 P1 | **BUG-19** | `active-tool-call-registry.js` module-level singleton | Médio | Subverte session-scoped design |
| 33 | 🟡 P2 | **SYS-GAP-13** | Dois sistemas paralelos de eventos no terminal | Baixo | Duplicação de lógica |
| 34 | 🟡 P2 | **SYS-GAP-15** | MCP bridge não usa `buildTool` | Médio | Dois níveis de tools |
| 35 | 🟡 P2 | **SYS-GAP-16** | Event adapter coverage não testado em CI | Baixo | Cobertura não verificada |
| 36 | 🟡 P2 | **INC-06** | Terminal bypassa agent facade para acessar tools | Médio | Acoplamento direto |
| 37 | 🟡 P2 | **BUG-20** | `sdk-session-events.js` 1103 linhas — God Object | Médio | Manutenção prejudicada |
| 38 | 🟡 P2 | **BUG-21** | `agent-runtime-events.js` 691 linhas — God Object | Médio | Manutenção prejudicada |
| 39 | 🟢 P3 | **BUG-26** | AbortSignal + withRetry interação defeituosa | Baixo | Erro engolido em retry |
| 40 | 🟢 P3 | **BUG-27** | `getAllTools()` sem cache em deps.js | Baixo | Recomputação por request |
| 41 | 🟢 P3 | **BUG-28** | `defaultBus` singleton cross-session | Baixo | Event bleed |
| 42 | 🟢 P3 | **BUG-29** | `composeHandlers` termina em `{}` | Baixo | Chain terminada prematuramente | **PARCIALMENTE CORRIGIDO** — check `result !== undefined && result !== null` previne early exit para `null`/`undefined`, mas `{}` ainda requer campos de decisão |
| 43 | 🟢 P3 | **BUG-30** | `pipeline` swallow null signals | Baixo | Sinal perdido | **CORRIGIDO** — `if (result && typeof result === 'object')` filtra `null` |
| 44 | 🟢 P3 | **BUG-31** | AuditTrail race condition read/write | Baixo | Dados corrompidos |
| 45 | 🟢 P3 | **BUG-32** | `createRuntimeDisableHook` sem fallback null | Baixo | Crash se null |
| 46 | 🟢 P3 | **BUG-34** | `hooks/index.js` JSDoc duplicado | Baixo | Documentação confusa |
| 47 | 🟢 P3 | ~~**BUG-35**~~ | ~~Typo `tttlMs` → `ttlMs` em pending-question-replay~~ **NÃO REPRODUZIDO** — código uses `options.ttlMs` corretamente | — | — |
| 48 | 🟢 P3 | **INC-07** | Tool presenters podem divergir | Baixo | Inconsistência de dados |

---

## 21. Registros de Decisões Arquiteturais (ADRs)

### ADR-001: Por que duas fábricas de tools existem

**Contexto**: O projeto tem `tools/tool-factory.js` (usada pela maioria das tools internas) e `sdk/tools/core.js` (usada por tools SDK e custom tools). Ambas implementam normalização Zod→JSON Schema, logging de invocação e fallback para ambientes mockados.

**Decisão**: Manter as duas separadas inicialmente. A fusão requer resolver: (a) dependência circular entre SDK e tools, (b) TDZ (Temporal Dead Zone) em ESM que exige factories no module-level, (c) o `buildTool()` do tools adiciona lógica de projeto (como `withSkipPermission`) que o `createTool()` do SDK não tem.

**Consequência**: Qualquer correção na lógica de conversão Zod→JSON Schema deve ser aplicada em dois lugares. Risco de divergência permanente.

**Reversibilidade**: Média. A fusão pode ser feita movendo toda a lógica para `sdk/tools/core.js` e fazendo `tools/buildTool` ser um thin wrapper.

### ADR-002: Por que module-level state em vez de DI container

**Contexto**: As variáveis module-level (`_session`, `_rpc`, `_agent`, etc.) são o padrão dominante em `src/copilot/tools/` e `src/copilot/sdk/`. Isto foi escolhido em vez de um container DI explícito.

**Decisão**: Manter o padrão atual. Alternativas como injection via constructor são incompatíveis com as constraints do runtime ESM do SDK do Copilot, onde module evaluation order é não-determinístico (TDZ).

**Consequência**: Testes requerem monkey-patching. Race conditions possíveis em cenários multi-sessão. Não há injeção de mocks limpa.

**Reversibilidade**: Baixa. Migrar para DI container requer refatoração de todos os consumers e mudança na ordem de bootstrap.

**Nota**: Os DI tokens (`di-tokens.js` no core e no sdk) já existem como mecanismo de registro, mas a injeção real ainda é feita via setters module-level. Isto é um passo intermediário, não o estado final.

### ADR-003: Por que interceptação de hooks vive fora `tools/`

**Contexto**: `hooks/tool-interceptor.js` implementa `onPreToolUse` e `onPostToolUse` hooks que decidem allow/deny de tools. Mora em `src/copilot/hooks/`, não em `src/copilot/tools/`.

**Decisão**: Manter separação. A separação permite que hooks sejam compostos independentemente das tools (hooks são plugáveis via `createProductionHooks()`, `createHooks()`, etc.), enquanto tools podem ser registradas sem conhecimento do sistema de hooks.

**Consequência**: Duas fontes de verdade sobre permissões (hooks + internal allow/deny em tools). O blind spot de observabilidade (SYS-GAP-04) é consequência direta.

**Reversibilidade**: Média. Mover a lógica de interceptação para dentro de `tools/` quebraria a composição de hooks que dependem de `hooks/bus.js`.

---

## 22. Relação Completa: Toda a Árvore de Dependências de Tools

### 22.1 Nível 0 — Kernel (sem dependências internas)
```
tools/di-tokens.js         → core/di.js
tools/logger.js            → (nenhuma dependência interna)
tools/metrics-proxy.js     → observability/metrics-histogram.js (tipo apenas)
tools/tool-contract-verifier.js → (nenhuma)
user-input-state.js        → (nenhuma)
sdk/tools/core.js          → @github/copilot-sdk, node:module
sdk/tools/state.js         → core/error-handlers, core/safe-json, core/schemas
sdk/tools/registry.js      → core (ConfigError)
sdk/tools/agent-policy.js  → config (normalizeAgentToolList, resolveToolName)
sdk/tools/custom.js        → core/*, sdk/logger, sdk/persistent-paths, sdk/tools/core
```

### 22.2 Nível 1 — Infraestrutura de Tools
```
tools/tool-factory.js      → config, sdk (createTool), zod, ./logger.js
tools/bootstrap.js          → observability, sdk, todos os submódulos de tools
```

### 22.3 Nível 2 — Subdomínios funcionais
```
tools/hub-tools.js          → zod, config, core, ./logger.js, ./tool-factory.js
tools/permission-tools.js   → audit, core, zod
tools/session-tools.js      → boot, core, sdk, zod
tools/session-rpc-tools.js  → config, core, sdk, zod
tools/experimental-rpc-tools.js → config, core, sdk, zod, ./logger.js, ./tool-factory.js
tools/task-tools.js         → config, sdk, core, zod
tools/code-tools.js          → boot, core, zod
tools/web-tools.js           → config, core, zod, ../infra/io-*, ./logger.js, ./tool-factory.js
tools/introspection-tools.js → config, sdk, zod, ./metrics-proxy.js, ./tool-contract-verifier.js, ./tool-factory.js
tools/hook-tools.js          → audit, core, zod, user-input-state.js
tools/git/index.js           → boot, sdk, zod, ../../core/error-handlers.js
tools/shell/index.js         → audit, config, sdk, ./executor.js, ./sandbox.js
tools/shell/executor.js      → config, ../../core/error-handlers.js, ./sandbox.js
tools/shell/sandbox.js       → boot, config
```

### 22.4 Nível 3 — Subdomínios compostos
```
tools/file/shared.js         → boot, core
tools/file/read-tools-io.js  → core/error-handlers, core/io-contracts, core/io-policy,
                                infra/io-*, ./shared.js
tools/file/read-tools-search.js → core/error-handlers, core/io-contracts, core/io-policy,
                                   infra/io-*, ./shared.js
tools/file/write-tools.js    → core/error-handlers, core/io-contracts, infra/io-engine, ./shared.js
tools/file/index-tools.js    → infra/index.js, ../tool-factory.js
tools/file/scope-tools.js    → #copilot/infra/io-session-scope, ../tool-factory.js
tools/file/symbol-search-tool.js → core/error-handlers, core/io-contracts, core/io-policy,
                                    infra/io-*, ./shared.js

tools/todo/store.js          → boot, core, db, ./todo-schema.js
tools/todo/todo-schema.js    → zod
tools/todo/crud-tools.js     → sdk, ../tool-factory.js, ./store.js
tools/todo/write-tools.js    → sdk, ../logger.js, ../tool-factory.js, ./store.js
tools/todo/query-tools.js    → sdk, ../tool-factory.js, ./store.js
tools/todo/bulk-tools.js     → sdk, ../logger.js, ./store.js
```

### 22.5 Consumidores Externos de `#copilot/tools`

```
src/copilot/
├── bootstrap.js                    → { TOOLS_LOGGER, TOOLS_METRICS }
├── observability/bootstrap.js      → { TOOLS_LOGGER, TOOLS_METRICS }
├── server/routes/sdk/deps.js       → getAllTools
├── agent/ports/tool-port.js        → { isToolDisabled, readStore }
├── hooks/presets/production.js     → isToolDisabled
├── terminal/commands/sdk.js        → { fileReadTools, fileWriteTools }
├── terminal/commands/fs.js         → { fileReadTools, fileWriteTools }
├── terminal/commands/tools.js      → readIntrospectionRegistrySnapshot
├── terminal/commands/resume.js     → { fileReadTools }
└── hooks/tool-interceptor.js       → (indiretamente via isToolDisabled)
```

> **📎 Extensão Fase 2:** Veja [`2026-05-10-AUDITORIA-EXTENSAO-FASE2.md`](2026-05-10-AUDITORIA-EXTENSAO-FASE2.md) para análise completa do módulo Terminal, Events, Hooks, MCP Bridge, Presentation e Server Deps.

---

## 22.6 Arquitetura de Observabilidade e Relações com Tools

### 22.6.1 Pilha de Observabilidade

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         src/copilot/observability/                           │
│                                                                              │
│  bootstrap.js               ← Conecta core/ → observability/ via DI           │
│      ├─ registra tokens: SHUTDOWN_LOGGER, DB_LOGGER, SDK_LOGGER,              │
│      ├─ HOOKS_LOGGER, TOOLS_LOGGER, TOOLS_METRICS                            │
│      ├─ EVENT_BUS (singleton global)                                          │
│      └─ HookBus → EventBus bridge (FIX para SYS-GAP-14)                       │
│                                                                              │
│  index.js                   ← Barrel de exports públicos                       │
│      ├─ tool-stats.js       ← wrapWithStats, recordToolCall, getToolStats    │
│      ├─ metrics.js         ← defaultMetrics singleton (createMetricsStore)   │
│      ├─ event-bus-runtime.js← attach/detach observability runtime            │
│      ├─ event-collector.js ← SDK event collection (50+ event types)         │
│      └─ error-tracker.js   ← ring buffer + global handlers                  │
│                                                                              │
│  core/event-bus.js         ← EventBus canônico (namespaces, wildcards, MW)   │
│      ├─ usado por: terminal/events/, observability/, hooks/                  │
│      └─ middleware: registerBuiltinMiddleware()                               │
│                                                                              │
│  sdk/session/hook-bus.js   ← HookBus estende EventEmitter                  │
│      ├─ defaultBus singleton (BUG-28 cross-session bleed)                   │
│      └─ emitHook() → EventBus bridge                                          │
└────────────────────────────────────────────────────────────────────────────┘
```

### 22.6.2 Core Infrastructure Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         src/copilot/core/                                      │
│                                                                              │
│  di.js (275 lin)           ← Container DI formal                              │
│      ├─ createToken()    ← tokens tipados                                   │
│      ├─ createContainer()← singleton/transient/scoped lifecycle             │
│      ├─ fork()           ← child containers                                 │
│      └─ dispose()        ← cleanup ordem reversa                            │
│                                                                              │
│  di-container.js (20 lin) ← Singleton global exportado                       │
│                                                                              │
│  error-handlers.js (233 lin)                                                 │
│      ├─ logSwallowed()   ← DEBUG + ErrorTracker entry                        │
│      ├─ wrapAsync()      ← fire-and-forget wrapper                           │
│      ├─ isFatalError()   ← SESSION_FATAL, CircuitOpenError, socket/IPC       │
│      └─ isTransientError()← ECONNREFUSED, ETIMEDOUT, HTTP 429/502/503/504    │
│                                                                              │
│  mutex.js (151 lin)          ← Promise-chain serialization                     │
│      ├─ createMutex()    ← mutex básico                                         │
│      ├─ createMutexPool()← mutex por chave                                     │
│      └─ withMutex()      ← helper para execução protegida                   │
│                                                                              │
│  circuit-breaker.js (164 lin)                                                  │
│      ├─ CircuitOpenError ← erro customizado                                  │
│      ├─ Estados: closed → open → half-open                                    │
│      └─ execute()        ← wrapper protegido                                   │
│                                                                              │
│  event-bus.js (383 lin)      ← Bus canônico com namespaces/wildcards          │
│      ├─ on/once/emit     ← subscrição básica                                   │
│      ├─ use()            ← middleware pipeline                                 │
│      ├─ count()/stats()  ← métricas observáveis                                │
│      └─ bridgeEmitter()  ← bridge EventEmitter → EventBus                      │
│                                                                              │
│  shutdown.js (367 lin)                                                       │
│      ├─ Priority-based handlers                                                 │
│      ├─ Per-handler timeout (5s default)                                      │
│      ├─ Lifecycle event emission via injected emitter                         │
│      └─ Metrics tracking per handler                                            │
│                                                                              │
│  interfaces.js (321 lin)     ← 7 interfaces canônicas                         │
│      ├─ IAgent, IEventBus, IStateStore, IToolRegistry                        │
│      ├─ IHooksPipeline, IConfigProvider, IMetricsCollector                    │
│      └─ Contratos JSDoc para DI / testes mock                                │
└────────────────────────────────────────────────────────────────────────────┘
```

### 22.6.3 Relação Tools ↔ Observability

| Camada | Arquivo | Função | Observabilidade |
|---|---|---|---|
| **Tools Factory** | `tools/tool-factory.js` | buildTool() | Usa `logToolFactory()` → **IGNORA** logger injetado (MITIGADO: fallback check) |
| **Tools Stats** | `observability/tool-stats.js` | wrapWithStats() | **DOUBLE WRAPPING** com sdk/tools/core.js (SDK-BUG-01) |
| **Tools Metrics** | `tools/metrics-proxy.js` | recordToolCall() | Proxy → `observability/metrics.js` → `defaultMetrics` |
| **SDK Tools** | `sdk/tools/core.js` | createTool() | wrappedHandler() → **segundo layer de logs** |
| **Hook Interceptor** | `hooks/tool-interceptor.js` | onPreToolUse/onPostToolUse | **Tools bloqueadas NÃO são contabilizadas** (SYS-GAP-04) |
| **Tool Stats** | `tools/introspection-tools.js` | get_system_health | Usa getToolStats() + getStatsByCategory() |

### 22.6.4 Problemas Identificados na Observabilidade

| ID | Severidade | Descrição | Status |
|---|---|---|---|
| **OBS-BUG-01** | HIGH | `logToolFactory()` verifica `typeof log === 'function'` antes de usar logger injetado, mas cai para `console.*` se falhar | **MITIGADO** |
| **OBS-BUG-02** | HIGH | `wrapWithStats()` dupla: tools/tool-stats.js + sdk/tools/core.js acumulam logs/metrics | Ativo |
| **OBS-BUG-03** | MEDIUM | Hook interceptor (tool-interceptor.js) não chama `recordToolCall()` para denys | Ativo |
| **OBS-GAP-01** | MEDIUM | EventBus não conectado a HookBus até bootstrap via `defaultHookBus.setEventBus(bus)` em bootstrap.js:146 | **MITIGADO** |
| **OBS-GAP-02** | LOW | `defaultBus` singleton em sdk/session/hook-bus.js compartilhado cross-session | Ativo |

## 23. Recomendações Prioritárias Consolidadas

| # | Ação | Seção Ref | Prazo |
|---|---|---|---|
| 1 | Adicionar `no-restricted-imports` (ESLint) para `tools/` → `infra/*` e `db/*` | §10 | Imediato |
| 2 | Corrigir `getAllTools(registry)` — registrar `registry` como parâmetro aceito ou remover argumento da chamada | §11.1 (BUG-01) | Imediato |
| 3 | Aplicar limites concretos em `file/shared.js` (5MB content, 1M search, 10K list) | §11.1 (BUG-04/10) | Imediato |
| 4 | Corrigir `resolveRpcTimeoutMs()` — remover código morto ou implementar funcionalidade | §11.1 (BUG-02) | Curto prazo |
| 5 | Extrair lógica de domínio de `todo/store.js` em `todo/domain.js` | §2 (Recomendação 2) | Curto prazo |
| 6 | Unificar `tools/tool-factory.js` com `sdk/tools/core.js` em uma factory canonical | §13.1 (SDK-BUG-01) | Curto prazo |
| 7 | Padronizar `buildTool()` universalmente — converter `createTool` direto em `buildTool` | §11.4 (INC-01) | Médio prazo |
| 8 | Converter singletons module-level em classes injetáveis (DI via container) | §3.1 | Médio prazo |
| 9 | Fundir 5 mecanismos de permissão em um único engine | §16 | Médio prazo |
| 10 | Consolidar dual user-input (SDK elicitation + user-input-state.js) | §17 | Médio prazo |
| 11 | Adicionar `recordBlockedToolCall()` e dashboard de enumeração | §18 (SYS-GAP-04) | Médio prazo |
| 12 | Separar `file/` em subpacotes (`io/`, `search/`, `scope/`) com limites declarativos | §2 (Recomendação 5) | Longo prazo |
| 13 | Implementar contrato formal (Zod runtime validation) entre SDK e tools | §2 (Recomendação 8) | Longo prazo |

---

## Notas Finais

- **Total de arquivos analisados**: 32 (em `src/copilot/tools/`) + 20+ (em `src/copilot/sdk/`) + ~50+ (Fase 2: terminal, hooks, events, bridges, presentation, server, agent facades, observability) + ~2400 lin (core/ infrastructure)
- **Core Infrastructure analisados**: 7 módulos (di.js, di-container.js, error-handlers.js, mutex.js, circuit-breaker.js, event-bus.js, shutdown.js, interfaces.js) totando ~2070 linhas
- **Total de bugs tools documentados**: 34 (BUG-01 a BUG-34, incluindo BUG-18 a BUG-34 da Fase 2; BUG-35 **NÃO REPRODUZIDO**)
- **Total de bugs SDK documentados**: 12 (SDK-BUG-01 a SDK-BUG-12)
- **Total de bugs de observabilidade documentados**: 3 (OBS-BUG-01 a OBS-BUG-03)
- **Total de gaps de observabilidade documentados**: 2 (OBS-GAP-01 a OBS-GAP-02)
- **Total de gaps sistêmicos documentados**: 16 (SYS-GAP-01 a SYS-GAP-16, incluindo SYS-GAP-11 a SYS-GAP-16 da Fase 2)
- **Total de inconsistências documentadas**: 6 (INC-01 a INC-06)
- **Total de test gaps documentados**: 5 (TEST-01 a TEST-05)
- **Total de itens na priorização final**: 47 (removido BUG-35 não reprodutível)
- **Seções da auditoria (original + extensão)**: 35 (seções 1–23 originais + seção 22.6 observabilidade + seções 24–35 da extensão)
- **Linhas do arquivo (original + extensão)**: ~1200 (original + observabilidade) + ~542 (extensão)

> **📎 Documento de Extensão Fase 2:** [`2026-05-10-AUDITORIA-EXTENSAO-FASE2.md`](2026-05-10-AUDITORIA-EXTENSAO-FASE2.md) — cobre em profundidade os módulos Terminal, Events, Hooks, MCP Bridge, Presentation e Server Deps, incluindo análise de estado atual dos arquivos-fonte após modificações recentes.

---

*Auditoria arquitetural completa gerada em 2026-05-10.*
*Versão final consolidada — seções 1-23, incluindo análise sistêmica SDK↔Tools, core infrastructure, e extensão Fase 2.*
*Autor: Kilo (automated) — repositório: chatgpt-docker-puppeteer*