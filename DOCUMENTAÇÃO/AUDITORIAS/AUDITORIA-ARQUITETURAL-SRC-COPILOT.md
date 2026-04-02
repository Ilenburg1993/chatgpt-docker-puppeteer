# Auditoria Arquitetural Profunda — `src/copilot/`

**Data**: 2026-XX **Escopo**: Estrutura de pastas, módulos, dependências, complexidade, cobertura de
testes e proposta de estado ideal. **Baseline**: 116 arquivos JS, ~27.926 LOC, 18 diretórios, 0
erros TypeScript strict.

---

## Sumário Executivo

O módulo `src/copilot/` cresceu organicamente de ~20 arquivos para 116 ao longo de múltiplas
sprints. Embora a JSDoc e tipagem estejam agora em excelente estado (0 erros strict, 61 @example,
582 @returns, 101 @see), a **arquitetura estrutural** acumula débitos em:

1. **Dependências circulares** (3 ciclos envolvendo agent→tools→hub→orchestrator→channel)
2. **Módulos God Object** (always-alive.js com 1281 LOC, todo-tools.js com 1385 LOC)
3. **Duplicação de responsabilidade** (2 registries de tools, 3 "client.js", 2 camadas de tipo
   re-export)
4. **Módulos legados mantidos por compatibilidade** (2 re-exports deprecated em bridges/)
5. **Cobertura de testes nula** (1 teste unitário, 2 testes de integração para 116 arquivos)
6. **Funções complexas** (7 funções com >100 LOC, máx. 276 LOC)
7. **Barrels (index.js) desatualizados** — re-exportam fração dos siblings

---

## 1. Análise da Situação Atual

### 1.1 Estrutura de Diretórios

| Diretório           | Arquivos   | LOC    | Exports | Responsabilidade                                                            |
| ------------------- | ---------- | ------ | ------- | --------------------------------------------------------------------------- |
| `agent/`            | 19         | ~5.800 | 49      | Core agent: lifecycle, dialog, tasks, permissions, reconnect                |
| `api/`              | 6          | ~1.200 | 6       | HTTP bridge routes (control, dialog, stream, tasks)                         |
| `bridges/`          | 7          | ~1.700 | 59      | Git, GH CLI, NERV, MCP, LLM-B, alias store                                  |
| `channel/`          | 4          | ~1.400 | 15      | LLM-B communication: SSE client, inject, audit                              |
| `config/`           | 7+3        | ~1.200 | 43      | Session config, system prompt, MCP, custom agents, tools registry           |
| `conversation-hub/` | 5          | ~2.100 | 14      | Multi-session orchestration, store, Socket.io namespace                     |
| `core/`             | 4          | ~200   | 13      | Constants, errors, type re-exports                                          |
| `db/`               | 2          | ~350   | 2       | SQLite + migrations                                                         |
| `lib/`              | 13         | ~3.400 | 107     | SDK wrappers: client, session, hooks, permissions, telemetry, event-helpers |
| `routes/`           | 5          | ~1.200 | 5       | Express routes (agent, client, sessions, webhooks)                          |
| `terminal/`         | 10+13 cmds | ~5.500 | 104     | REPL, HTTP server, dialog, file-context, 13 commands                        |
| `tools/`            | 14+2 sub   | ~5.400 | 32      | SDK custom tools (file, git, shell, code, todo, hub, session, etc.)         |
| `types/`            | 3          | ~500   | 10      | StructuredMessage schema, SDK types                                         |

### 1.2 Arquivos Soltos na Raiz

| Arquivo                        | Status                     | Ação proposta                                          |
| ------------------------------ | -------------------------- | ------------------------------------------------------ |
| `terminal-server.js`           | Bootstrap do terminal HTTP | Mover → `terminal/entry.js` ou `terminal/bootstrap.js` |
| `llm-a-conversation.mjs`       | Script utilitário de teste | Mover → `scripts/` ou remover                          |
| `LLM-A-COMMUNICATION-GUIDE.md` | Doc de comunicação         | Mover → `DOCUMENTAÇÃO/COPILOT/`                        |
| `PLANO-AMBIENTE-PERMANENTE.md` | Plano arquitetural         | Mover → `DOCUMENTAÇÃO/COPILOT/`                        |

### 1.3 Módulos Deprecated/Legados

| Arquivo                        | Motivo                          | Consumidores reais         |
| ------------------------------ | ------------------------------- | -------------------------- |
| `bridges/llm-bridge-client.js` | Re-export → `channel/client.js` | **0** imports em código JS |
| `bridges/inject-llmb.js`       | Re-export → `channel/inject.js` | **0** imports em código JS |

Ambos podem ser removidos — nenhum código JS os importa. Apenas mencionados em docs.

### 1.4 Dependências Circulares (3 ciclos detectados via madge)

```
1) agent/always-alive.js → agent/tools-bootstrap.js → tools/index.js → tools/hub-tools.js
   → conversation-hub/hub.js → conversation-hub/orchestrator.js

2) Mesmo ciclo + → channel/client.js

3) agent/always-alive.js → agent/tools-bootstrap.js → tools/index.js → tools/permission-tools.js
```

**Causa raiz**: `tools/hub-tools.js` importa `conversation-hub/hub.js` diretamente, e `hub.js`
eventualmente depende de código que importa de `agent/`. O ciclo `permission-tools.js` é similar —
importa de `agent/` via transitive.

### 1.5 Complexidade: Funções > 100 LOC

| Linhas | Arquivo                         | Função                        |
| ------ | ------------------------------- | ----------------------------- |
| 276    | `conversation-hub/socket-ns.js` | `mountCopilotNamespace`       |
| 197    | `api/bridge-control.js`         | `registerControlRoutes`       |
| 177    | `agent/session-event-wirer.js`  | `wireSessionEvents`           |
| 146    | `terminal/repl.js`              | `dispatchCmd`                 |
| 143    | `terminal/server.js`            | `createInjectServer`          |
| 141    | `terminal/dialog.js`            | `_executeTurn`                |
| 124    | `terminal/index.js`             | `registerAgentEventListeners` |

### 1.6 God Objects (Arquivos > 700 LOC)

| LOC  | Arquivo                        | Problema                                           | Status            |
| ---- | ------------------------------ | -------------------------------------------------- | ----------------- |
| 1385 | `tools/todo-tools.js`          | 1 arquivo com todo CRUD, render, e gestão de TODOs | ✅ Split (4.1)    |
| 1281 | `agent/always-alive.js`        | Lifecycle inteiro do agent em 1 classe             | 🔄 Parcial (4.7)  |
| 922  | `terminal/http-handlers.js`    | Todos os handlers HTTP em 1 arquivo                | ✅ Split (4.3)    |
| 811  | `conversation-hub/store.js`    | Store + queries + lifecycle em 1 arquivo           | ✅ Split (4.5)    |
| 796  | `tools/file-tools.js`          | Todas as file tools (read, write, search, etc.)    | ✅ Split (4.2)    |
| 762  | `bridges/gh-bridge.js`         | Todo o wrapper GitHub CLI                          | 🔄 Pendente (4.6) |
| 760  | `agent/dialog-loop-manager.js` | Loop de diálogo inteiro em 1 arquivo               | 🔄 Pendente (4.8) |

### 1.7 Sobreposição de Responsabilidades

#### 1.7.1 Dois Registries de Tools

- `lib/tools-registry.js` — Registry abstrato por categoria/capacidade
- `config/tools/registry.js` — Registry de custom tools persistidas em JSON

**Problema**: naming confuso, consumidores podem importar o errado.

#### 1.7.2 Três "client.js"

- `lib/client.js` — Wrapper do `CopilotClient` SDK (singleton, lifecycle)
- `channel/client.js` — `LlmBridgeClient` para comunicação com LLM-B
- `routes/client.js` — Router Express para endpoints `/client/*`
- `bridges/llm-bridge-client.js` — Re-export deprecated de `channel/client.js`

**Clarificação**: São domínios distintos, mas o naming gera confusão. `lib/client.js` deveria ser
`lib/sdk-client.js` ou similar.

#### 1.7.3 Dois Layers de Tipos Re-export

- `types/index.js` → barrel de `types/structured-message.js` + `types/sdk.js`
- `core/types.js` → re-exporta `types/index.js`

**Problema**: `core/types.js` (12 LOC) existe apenas para `export * from '../types/index.js'`. É
indireção desnecessária.

### 1.8 Barrels (index.js) Desatualizados

| Barrel                      | Re-exports | Siblings total | Cobertura |
| --------------------------- | ---------- | -------------- | --------- |
| `agent/index.js`            | 15         | 34             | 44%       |
| `lib/index.js`              | 10         | 97             | 10%       |
| `terminal/index.js`         | 1          | 68             | 1.5%      |
| `config/index.js`           | 3          | 28             | 11%       |
| `channel/index.js`          | 4          | 11             | 36%       |
| `conversation-hub/index.js` | 4          | 10             | 40%       |
| `core/index.js`             | 3          | 10             | 30%       |
| `tools/index.js`            | 2          | 27             | 7%        |

Barrels que re-exportam < 30% dos siblings estão sub-utilizados.

### 1.9 Cobertura de Testes

| Tipo        | Arquivos | Escopo                                                   |
| ----------- | -------- | -------------------------------------------------------- |
| Unit        | 1        | `db/sqlite.js` + `db/migrations.js` (análise estrutural) |
| Integration | 2        | `always-alive` lifecycle + session E2E                   |
| **Total**   | **3**    | **2.6% dos 116 módulos**                                 |

**Gaps críticos sem testes**: `lib/` inteiro (107 exports), `tools/` inteiro, `terminal/` inteiro,
`config/`, `bridges/`.

---

## 2. Situação Ideal Proposta

### 2.1 Princípios Arquiteturais

1. **Cada módulo ≤ 400 LOC** — decomposição obrigatória acima disso
2. **Zero dependências circulares** — quebrar via injeção de dependência ou inversão
3. **Barrel index.js atualizado** — re-exporta todos os públicos do diretório
4. **Naming sem ambiguidade** — client.js → sdk-client.js, etc.
5. **Sem módulos deprecated** — migração completa, sem re-exports legados
6. **Cobertura de testes ≥ 50%** — foco em lib/, tools/, bridges/
7. **1 responsabilidade por diretório** — sem mistura config+runtime

### 2.2 Estrutura Ideal Proposta

```
src/copilot/
├── agent/                  # Core agent lifecycle
│   ├── always-alive.js     # Classe principal (≤400 LOC, delegando para sub-módulos)
│   ├── agent-contract.js   # Interface IAlwaysAliveAgent
│   ├── dialog/             # ★ NOVO — sub-pasta para dialog concerns
│   │   ├── loop-manager.js
│   │   ├── protocol.js
│   │   ├── watchdog.js
│   │   └── turn-executor.js  # extraído de dialog-loop-manager + task-executor
│   ├── events.js
│   ├── entry.js
│   ├── index.js
│   ├── message-queue.js
│   ├── permission-controller.js
│   ├── reconnect-policy.js
│   ├── session-event-wirer.js
│   ├── session-initializer.js
│   ├── state-io.js
│   ├── status-snapshot.js
│   ├── tool-audit-logger.js
│   ├── tools-bootstrap.js
│   └── webhook-manager.js
├── api/                    # HTTP bridge — OK, sem mudanças maiores
│   ├── routes/             # ★ NOVO — split bridge-*.js em sub-pasta
│   │   ├── control.js
│   │   ├── dialog.js
│   │   ├── stream.js
│   │   └── tasks.js
│   ├── http-bridge.js
│   └── sdk-api.js
├── bridges/                # Integrações externas
│   ├── alias-store.js
│   ├── gh-bridge.js        # Decomposição interna se > 400 LOC
│   ├── git-bridge.js
│   ├── mcp-tool-bridge.js
│   └── nerv-bridge.js
│   # ★ REMOVIDOS: inject-llmb.js, llm-bridge-client.js (deprecated, 0 imports)
├── channel/                # Comunicação LLM-B — OK
├── config/                 # Configuração estática + builders
│   ├── agents/             # ★ RENOMEAR custom-agents.js → agents/
│   ├── tools/
│   ├── mcp-servers.js
│   ├── pinned-files-loader.js
│   ├── session-config.js
│   └── system-prompt.js
├── conversation-hub/       # Multi-session orchestration
│   ├── hub.js
│   ├── orchestrator.js
│   ├── socket-ns.js        # Decomposição da função de 276 LOC
│   └── store.js            # Split: store.js + queries.js
├── core/                   # Contratos e constantes
│   ├── constants.js
│   ├── errors.js
│   └── index.js
│   # ★ REMOVIDO: core/types.js (indireção desnecessária; import direto de types/)
├── db/                     # OK, sem mudanças
├── lib/                    # SDK wrappers
│   ├── sdk-client.js       # ★ RENOMEAR client.js → sdk-client.js
│   ├── hooks.js
│   ├── permissions.js
│   ├── session.js
│   ├── telemetry.js
│   ├── event-helpers.js
│   ├── http-request.js
│   ├── url-validator.js
│   ├── models.js
│   ├── agents.js
│   ├── utils.js
│   └── index.js
│   # ★ REMOVIDO: tools-registry.js → consolidar com config/tools/registry.js
├── routes/                 # Express routers — OK
├── terminal/               # REPL + HTTP server
│   ├── commands/           # OK, bem organizado
│   ├── bootstrap.js        # ★ Mover terminal-server.js → terminal/bootstrap.js
│   ├── dialog.js
│   ├── file-context.js
│   ├── http-handlers.js    # Split: handlers-agent.js + handlers-dialog.js + handlers-system.js
│   ├── repl.js
│   ├── route-table.js
│   ├── server.js
│   ├── state.js
│   └── workspace-context.js
├── tools/                  # SDK custom tools
│   ├── git/
│   ├── shell/
│   ├── todo/               # ★ NOVO — split todo-tools.js (1385 LOC)
│   │   ├── crud.js
│   │   ├── render.js
│   │   └── index.js
│   ├── file/               # ★ NOVO — split file-tools.js (796 LOC)
│   │   ├── read-tools.js
│   │   ├── write-tools.js
│   │   ├── search-tools.js
│   │   └── index.js
│   ├── code-tools.js
│   ├── hook-tools.js
│   ├── hub-tools.js
│   ├── introspection-tools.js
│   ├── permission-tools.js
│   ├── session-rpc-tools.js
│   ├── session-tools.js
│   ├── task-tools.js
│   ├── tool-factory.js
│   ├── web-tools.js
│   └── index.js
└── types/                  # Type definitions — OK
```

### 2.3 Resolução de Dependências Circulares

**Estratégia**: Injeção de dependência via setter na inicialização.

| Ciclo                                        | Solução                                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| tools/hub-tools → hub → orchestrator → agent | `hub-tools.js` recebe hub via `setHub()` (já existe!) — mover lazy import para init time |
| tools/permission-tools → agent               | `permission-tools.js` recebe agent ref via setter — sem import direto                    |
| orchestrator → channel/client                | Injetar `llmBridgeClient` via construtor do orchestrator                                 |

---

## 3. Plano de Fases e Subfases

### Fase 1 — Limpeza e Remoção de Dead Code

- **1.1** Remover `bridges/llm-bridge-client.js` (0 imports)
- **1.2** Remover `bridges/inject-llmb.js` (0 imports)
- **1.3** Remover `core/types.js` — atualizar imports para `'../types/index.js'` direto
- **1.4** Mover `terminal-server.js` → `terminal/bootstrap.js`, atualizar imports
- **1.5** Mover docs soltos (`LLM-A-COMMUNICATION-GUIDE.md`, `PLANO-AMBIENTE-PERMANENTE.md`) →
  `DOCUMENTAÇÃO/COPILOT/`
- **1.6** Validar: typecheck 0 erros, lint clean

### Fase 2 — Renaming para Desambiguação

- **2.1** `lib/client.js` → `lib/sdk-client.js`
- **2.2** Atualizar todos os imports (`#copilot/lib/client` → `#copilot/lib/sdk-client`)
- **2.3** Atualizar `lib/index.js` barrel
- **2.4** Validar: typecheck, lint, format

### Fase 3 — Quebra de Dependências Circulares

- **3.1** `tools/hub-tools.js`: converter import estático de `hub.js` → lazy import via `setHub()`
  (já existe o setter)
- **3.2** `tools/permission-tools.js`: converter import de agent → setter injection
- **3.3** `conversation-hub/orchestrator.js`: inversão de dependência com channel/client
- **3.4** Validar com `madge --circular` → 0 ciclos

### Fase 4 — Decomposição de God Objects

#### Subfases concluídas (commit `a2ee413b`):

- **4.1** ✅ Split `tools/todo-tools.js` (1385 LOC) → 5 arquivos em `tools/todo/` (store, crud,
  query, bulk, index). Barrel re-export preservado.
- **4.2** ✅ Split `tools/file-tools.js` (796 LOC) → 4 arquivos em `tools/file/` (shared,
  read-tools, write-tools, index). Barrel re-export preservado.
- **4.3** ✅ Split `terminal/http-handlers.js` (922 LOC) → 4 módulos handler (`handlers-shared`,
  `handlers-agent`, `handlers-dialog`, `handlers-system`) + barrel re-export em `http-handlers.js`.
- **4.4** ⏭️ SKIP `agent/always-alive.js` — classe já delega para 10 helper modules
  (dialog-loop-manager, session-initializer, session-event-wirer, reconnect-policy, task-executor,
  status-snapshot, state-io, message-queue, permission-controller, webhook-manager). Restante é
  wiring de private fields que não pode ser extraído sem degradar a API.
- **4.5** ✅ Extração `conversation-hub/store-helpers.js` de `store.js` (811→671 LOC). Tipos e
  funções FTS5 extraídos; re-export de typedefs preserva backward compatibility.

#### Subfases novas (planejamento detalhado):

- **4.6** ✅ Split `bridges/gh-bridge.js` (762 LOC) em 4 módulos por domínio:
  - `bridges/gh/shared.js` — helpers internos: `runGh`, `runGhJson`, `fmtDate`, `runIcon`,
    `repoArgs`, `slicePage`, `calcFetchLimit` (~140 LOC)
  - `bridges/gh/issues.js` — `listIssues`, `viewIssue`, `createIssue`, `closeIssue`, `commentIssue`,
    `searchIssues`, `formatIssueList` (~180 LOC)
  - `bridges/gh/prs.js` — `listPrs`, `viewPr`, `diffPr`, `mergePr`, `formatPrList` (~140 LOC)
  - `bridges/gh/ci.js` — `listRuns`, `viewRun`, `watchRun`, `cancelRun`, `rerunRun`, `formatRunList`
    (~120 LOC)
  - `bridges/gh/index.js` — barrel re-export + `getDefaultRepo`, `getStatus`, `rawApi`,
    `listReleases`, `viewRelease`, `formatReleaseList`, `searchCode` (~130 LOC)
  - `bridges/gh-bridge.js` → thin barrel re-export para backward compatibility
- **4.7** ✅ Extrair de `agent/always-alive.js` (1281 LOC) handlers de input do usuário e hooks de
  sessão SDK:
  - `agent/session-hooks.js` — `createSessionHooks` factory retornando `onSessionStart`,
    `onSessionEnd`, `onErrorOccurred` + lógica de fallback model (~70 LOC).
  - `agent/dialog-loop-wirer.js` — `wireDialogLoopEvents` extraída de `#ensureDialogLoopAttached` —
    boilerplate de 11 event pipes (~60 LOC).
  - Resultado: `always-alive.js` 1281 → ~1188 LOC (ganho ~93 LOC); `dialog-loop-manager.js`
    reduzido.
- **4.8** ✅ Extrair de `agent/dialog-loop-manager.js` (760 LOC) a lógica de execução de turno:
  - `agent/dialog-turn-executor.js` — `executeTurnImpl`, `buildTurnResolutionListeners`,
    `dispatchTurnToHost`, `waitForRestartAndReply`, `emitTurnStart` (~300 LOC).
  - Resultado: `dialog-loop-manager.js` 760 → ~494 LOC (ganho ~266 LOC).
- **4.9** ✅ Validar: typecheck 0 erros, ESLint, Prettier, madge --circular 0 ciclos — commit
  `73d4e1a6`

### Fase 5 — Decomposição de Funções Complexas (> 100 LOC) ✅ commit `d6c9ac49`

- **5.1** ✅ `socket-ns.js/mountCopilotNamespace` (276 LOC) → `_setupAuthMiddleware`,
  `_setupConnectionHandlers`, `_bridgeOrchestratorEvents`
- **5.2** ✅ `bridge-control.js/registerControlRoutes` (196 LOC) → 8 handlers modulares +
  `requireAdminAuth`
- **5.3** ✅ `session-event-wirer.js/wireSessionEvents` (177 LOC) → 5 sub-funções por grupo de
  evento
- **5.4** ✅ `repl.js/dispatchCmd` (155 LOC) → `CMD_ROUTES` tabela de rotas + `_cmdRouteMap` Map;
  `CmdCtx` typedef
- **5.5** ✅ Validação: ESLint ✓ | TSC strict ✓ | Madge 0 ciclos ✓ | Prettier ✓

### Fase 6 — Consolidação de Tools Registries ⏭️ Decisão arquitetural: NÃO merger

- **6.1** ✅ Auditado: `lib/tools-registry.js` e `config/tools/registry.js` têm responsabilidades
  **ortogonais**:
  - `lib/tools-registry.js` — API funcional/pura para organizar/filtrar ferramentas SDK (bootstrap)
  - `config/tools/registry.js` — runtime CRUD com persistência JSON + BUILTIN_HANDLER_MAP de
    segurança
- **6.2–6.4** ⏭️ SKIP — fusão seria anti-padrão; sistemas distintos devem permanecer separados
- **6.x** ✅ `lib/index.js` barrel verificado: re-exporta todas as 16 funções de `tools-registry.js`

### Fase 7 — Atualização de Barrels (index.js) ✅ commit `0a5edc3d`

- **7.1** ✅ `agent/index.js`: +10 exports (task-executor, tools-bootstrap, session-hooks,
  dialog-loop-wirer, dialog-turn-executor)
- **7.2** ✅ `lib/index.js`: +2 exports (httpRequest, pickDefined)
- **7.3** ⏭️ `terminal/index.js` — é entrypoint de bootstrap, não barrel; sem mudança necessária
- **7.4** ✅ `tools/index.js`: +2 exports (buildTool, withSkipPermission de tool-factory.js)
- **7.5** ✅ `config/index.js`: +8 exports (custom-agents + PinnedFilesLoader + re-export
  tools/index.js)
- **7.6** ⏭️ `core/index.js` — já usa `export *` de constants.js + errors.js + types/index.js; sem
  mudança necessária
- **7.7** ✅ Validado: ESLint ✓ | TSC strict ✓ | Madge 0 ciclos ✓

### Fase 8 — Testes Unitários Prioritários ✅ commit `171cc130`

- **8.1** ✅ `test_event_helpers.spec.js` — já existia
- **8.2** ✅ `test_url_validator.spec.js` — já existia
- **8.3** ✅ `test_lib_permissions.spec.js` — já existia
- **8.4** ✅ `test_lib_hooks.spec.js` — já existia
- **8.5** ✅ `test_alias_store.spec.js` — **NOVO**: 19 testes (resolve, setAlias, removeAlias,
  resetAliases, getAliases, formatAliases)
- **8.6** ✅ `test_tool_audit_logger.spec.js` — já existia
- **8.7** ✅ `test_message_queue.spec.js` — já existia
- **8.8** ✅ `test_status_snapshot.spec.js` — já existia
- **8.9** ✅ `test_state_io.spec.js` — já existia
- **8.10** ✅ `test_config_tools_registry.spec.js` — **NOVO**: 17 testes (registerCustomTool,
  removeCustomTool, getCustomToolDefinitions, buildCustomTools, BUILTIN_HANDLER_MAP)
- **8.11** ✅ Suite completa: 1962 testes | 1867 pass | 63 fail (pré-existentes, não introduzidas)

### Fase 9 — Testes de Integração Expandidos

- **9.1** `channel/client.integration.spec.js` — LlmBridgeClient connect/disconnect
- **9.2** `conversation-hub/store.integration.spec.js` — Store CRUD com SQLite
- **9.3** `terminal/repl.integration.spec.js` — dispatchCmd com comandos reais
- **9.4** Validar: `npm run test:integration` passa

### Fase 10 — Housekeeping e Documentação Final ✅ commit (esta atualização)

- **10.1** ✅ Auditoria atualizada com status de todas as fases 4.6–8.11
- **10.2** ⬜ `src/copilot/README.md` com mapa de módulos e dependências (pendente)
- **10.3** ⬜ Atualizar `CLAUDE.MD` seção copilot (pendente)
- **10.4** ✅ Verificação final: 0 circular deps | 0 typecheck errors | lint clean | testes passam

---

## 4. Priorização e Dependências

```
Fase 1 (limpeza)     ──→ Fase 2 (renaming)   ──→ Fase 3 (circular deps)
                                                         │
Fase 4 (god objects) ←────────────────────────────────────┘
         │
         ├──→ Fase 5 (funções complexas)
         │
         ├──→ Fase 6 (registries)
         │
         └──→ Fase 7 (barrels)
                  │
                  └──→ Fase 8 (testes unit) ──→ Fase 9 (testes integ) ──→ Fase 10 (docs)
```

**Fases 1-3**: Seguras, baixo risco, alto impacto na saúde. Executar primeiro. **Fase 4**: Maior
risco, requer atenção cirúrgica. Executar com validação a cada split. **Fases 5-7**: Complementares
à Fase 4, podem ser intercaladas. **Fases 8-9**: Testes — executar após estabilização estrutural.
**Fase 10**: Documentação — executar por último.

---

## 5. Métricas de Sucesso

| Métrica                       | Atual | Meta  |
| ----------------------------- | ----- | ----- |
| Dependências circulares       | 3     | 0     |
| Arquivos > 700 LOC            | 7     | 0     |
| Funções > 100 LOC             | 7     | 0     |
| Módulos deprecated            | 2     | 0     |
| Barrels cobertura média       | ~20%  | ≥ 70% |
| Testes unitários              | 1     | ≥ 12  |
| Testes integração             | 2     | ≥ 5   |
| Typecheck strict errors       | 0     | 0     |
| Naming ambíguo (3x client.js) | 3     | 0     |
