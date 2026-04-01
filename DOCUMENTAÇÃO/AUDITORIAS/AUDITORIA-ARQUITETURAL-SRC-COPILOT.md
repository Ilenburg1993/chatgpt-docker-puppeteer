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

| LOC  | Arquivo                        | Problema                                           |
| ---- | ------------------------------ | -------------------------------------------------- |
| 1385 | `tools/todo-tools.js`          | 1 arquivo com todo CRUD, render, e gestão de TODOs |
| 1281 | `agent/always-alive.js`        | Lifecycle inteiro do agent em 1 classe             |
| 922  | `terminal/http-handlers.js`    | Todos os handlers HTTP em 1 arquivo                |
| 811  | `conversation-hub/store.js`    | Store + queries + lifecycle em 1 arquivo           |
| 796  | `tools/file-tools.js`          | Todas as file tools (read, write, search, etc.)    |
| 762  | `bridges/gh-bridge.js`         | Todo o wrapper GitHub CLI                          |
| 760  | `agent/dialog-loop-manager.js` | Loop de diálogo inteiro em 1 arquivo               |

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

- **4.1** Split `tools/todo-tools.js` (1385 LOC) → `tools/todo/crud.js` + `tools/todo/render.js` +
  `tools/todo/index.js`
- **4.2** Split `tools/file-tools.js` (796 LOC) → `tools/file/read-tools.js` +
  `tools/file/write-tools.js` + `tools/file/search-tools.js` + `tools/file/index.js`
- **4.3** Split `terminal/http-handlers.js` (922 LOC) → `terminal/handlers-agent.js` +
  `terminal/handlers-dialog.js` + `terminal/handlers-system.js`
- **4.4** Extrair métodos de `agent/always-alive.js` (1281 LOC) para arquivos existentes que já
  receberam responsabilidades (dialog-loop-manager, session-initializer, etc.) — reduzir ≤ 600 LOC
- **4.5** Split `conversation-hub/store.js` (811 LOC) → `store.js` (state) + `store-queries.js`
  (queries)
- **4.6** Validar: typecheck 0 erros, testes existentes passam

### Fase 5 — Decomposição de Funções Complexas (> 100 LOC)

- **5.1** `socket-ns.js/mountCopilotNamespace` (276 LOC) → dividir em `_handleConnection`,
  `_handleDisconnect`, `_handleReconnect`, `_setupNamespaceEvents`
- **5.2** `bridge-control.js/registerControlRoutes` (197 LOC) → handlers individuais
- **5.3** `session-event-wirer.js/wireSessionEvents` (177 LOC) → agrupar por tipo de evento
- **5.4** `repl.js/dispatchCmd` (146 LOC) → route table pattern (já existe route-table.js, integrar)
- **5.5** Validar: typecheck, testes existentes

### Fase 6 — Consolidação de Tools Registries

- **6.1** Auditar `lib/tools-registry.js` vs `config/tools/registry.js` — mapear consumidores
- **6.2** Unificar em `config/tools/registry.js` (runtime) com interface abstrata mantida
- **6.3** Remover `lib/tools-registry.js`, atualizar imports
- **6.4** Atualizar `lib/index.js` barrel

### Fase 7 — Atualização de Barrels (index.js)

- **7.1** `agent/index.js`: re-exportar todos os públicos (de 44% → 90%+)
- **7.2** `lib/index.js`: re-exportar todos os públicos (de 10% → 80%+)
- **7.3** `terminal/index.js`: re-exportar públicos (de 1.5% → 50%+)
- **7.4** `tools/index.js`: re-exportar todas as tool arrays
- **7.5** `config/index.js`: re-exportar configuração pública
- **7.6** `core/index.js`: re-exportar constantes e errors
- **7.7** Validar: sem imports quebrados

### Fase 8 — Testes Unitários Prioritários

- **8.1** `lib/event-helpers.spec.js` — waitForEvent, raceEvents (pure functions)
- **8.2** `lib/url-validator.spec.js` — validateUrl, validateUrlString (pure)
- **8.3** `lib/permissions.spec.js` — createPermissionHandler factories (pure)
- **8.4** `lib/hooks.spec.js` — hook factories (pure)
- **8.5** `bridges/alias-store.spec.js` — resolve, setAlias, removeAlias (in-memory)
- **8.6** `agent/tool-audit-logger.spec.js` — isHighRiskTool, buildAuditingPermissionHandler
- **8.7** `agent/message-queue.spec.js` — enqueue, dequeue, isEmpty
- **8.8** `agent/status-snapshot.spec.js` — buildStatusSnapshot
- **8.9** `agent/state-io.spec.js` — readState, writeState, clearState (with tmp dir)
- **8.10** `config/tools/registry.spec.js` — register, list, remove
- **8.11** Validar: `npm run test:unit` passa, cobertura baseline

### Fase 9 — Testes de Integração Expandidos

- **9.1** `channel/client.integration.spec.js` — LlmBridgeClient connect/disconnect
- **9.2** `conversation-hub/store.integration.spec.js` — Store CRUD com SQLite
- **9.3** `terminal/repl.integration.spec.js` — dispatchCmd com comandos reais
- **9.4** Validar: `npm run test:integration` passa

### Fase 10 — Housekeeping e Documentação Final

- **10.1** Atualizar `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md` com nova estrutura
- **10.2** Criar `src/copilot/README.md` com mapa de módulos e dependências
- **10.3** Atualizar `CLAUDE.MD` seção copilot
- **10.4** Verificação final: 0 circular deps, 0 typecheck errors, lint clean, testes passam

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
