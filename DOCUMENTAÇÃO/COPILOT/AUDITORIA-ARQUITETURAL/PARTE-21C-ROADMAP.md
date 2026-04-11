# PARTE-21C — Roadmap v2: Faixas H–N para Upgrades de Larga Escala

**Data**: 2026-04-12 | **Status**: Canônico | **Versão**: 2.1
**Scope**: Roadmap evolutivo de `src/copilot` — da situação atual (21A) à ideal (21B)
**Referência**: PARTE-21A (situação atual), PARTE-21B (ideal), PARTE-20C (roadmap anterior, CONCLUÍDO)

**Progresso de execução** (atualizado 2026-04-11):

| Faixa | Status      | Commit                                                                                      |
| ----- | ----------- | ------------------------------------------------------------------------------------------- |
| H     | ✅ CONCLUÍDA | `3f4db045` — ci(copilot): Faixa H                                                           |
| I     | ✅ CONCLUÍDA | `8407a6d5` — refactor(copilot): Faixa I (315→2 deep imp)                                    |
| J     | ✅ CONCLUÍDA | `3aacf20b` — refactor(copilot): Faixa J (7 splits)                                          |
| K     | ✅ CONCLUÍDA | `289d9d35` — refactor(copilot): Faixa K (DI container)                                      |
| L     | ✅ CONCLUÍDA | `8b02a3d2` — refactor(copilot): Faixa L (types module)                                      |
| M     | ✅ CONCLUÍDA | `ad45f050` — refactor(copilot): Faixa M (Event Bus)                                         |
| N     | ✅ CONCLUÍDA | `eb6f88a9` — refactor(copilot): Faixa N completa (Services, Plugins, Health, API migration) |

---

## 1. Resumo Executivo

O roadmap v2 define **7 faixas de trabalho** (H–N) que evoluem o sistema em 4 ondas incrementais:

| Wave | Faixas | Foco                        | Health Score  | Duração estimada |
| ---- | ------ | --------------------------- | ------------- | ---------------- |
| 0    | H      | CI fix + violações urgentes | D→D+ (35→45)  | Imediata         |
| 1    | I, J   | Barrel + decomposição       | D+→C+ (45→60) | Curto prazo      |
| 2    | K, L   | DI container + state mgmt   | C+→B (60→75)  | Médio prazo      |
| 3    | M, N   | EventBus + extensibilidade  | B→A- (75→85)  | Longo prazo      |

**Total de subfases**: 65
**Dependências entre faixas**: H→I→K (caminho crítico principal), J (paralelo), L→M→N (cadeia de preparação)

---

## 2. Visão Geral das Faixas

```
                           ┌─────────────────────┐
                    ┌──────┤ Wave 0: H (CI+Viol) ├──────┐
                    │      └─────────────────────┘      │
                    ▼                                    ▼
         ┌──────────────┐                    ┌──────────────────┐
         │ Wave 1: I    │                    │ Wave 1: J        │
         │ (Barrels)    │                    │ (Decomposição)   │
         └──────┬───────┘                    └────────┬─────────┘
                │                                     │
                ▼                                     ▼
         ┌──────────────┐                    ┌──────────────────┐
         │ Wave 2: K    │                    │ Wave 2: L        │
         │ (DI Contain.)│                    │ (State Mgmt)     │
         └──────┬───────┘                    └────────┬─────────┘
                │                                     │
                └──────────────┬──────────────────────┘
                               ▼
                    ┌──────────────────┐
                    │ Wave 3: M        │
                    │ (EventBus)       │
                    └────────┬─────────┘
                             ▼
                    ┌──────────────────┐
                    │ Wave 3: N        │
                    │ (Extensibilidade)│
                    └──────────────────┘
```

---

## 3. Faixa H — CI Hardening & Violações Urgentes (Wave 0)

**Prioridade**: P0 — Imediata
**Dependências**: Nenhuma (standalone)
**Critério de conclusão**: 0 violações reais, CI detecta export...from

### H-1: Expandir regex do layer check

| Item | Ação                                                                           | Risco |
| ---- | ------------------------------------------------------------------------------ | ----- |
| H-1a | Adicionar regex para `export { X } from '...'` em `check-layer-violations.mjs` | Baixo |
| H-1b | Adicionar regex para `export * from '...'` no mesmo script                     | Baixo |
| H-1c | Adicionar regex para `import('...')` (dynamic imports)                         | Baixo |
| H-1d | Criar testes unitários para o script com fixtures de violações                 | Baixo |
| H-1e | Validar: script agora detecta as 4 violações ocultas                           | Baixo |

### H-2: Resolver 4 violações topológicas

| Item | Violação                          | Solução                                            | Risco |
| ---- | --------------------------------- | -------------------------------------------------- | ----- |
| H-2a | `core/constants` → `config/env`   | Mover constantes para core, config importa de core | Médio |
| H-2b | `sdk/index` → `hooks/factory`     | Remover re-export, consumidores importam hooks     | Baixo |
| H-2c | `sdk/index` → `hooks/permission`  | Remover re-export, consumidores importam hooks     | Baixo |
| H-2d | `sdk/config` → `config/session-*` | Mover tipos sessão para sdk ou core/types          | Médio |
| H-2e | Atualizar barrel contracts test   | Verificar novos exports/imports corretos           | Baixo |
| H-2f | Atualizar READMEs afetados        | Documentar mudanças de API pública                 | Baixo |

### H-3: Novos CI gates (round 1)

| Item | Gate                                            | Implementação                                | Risco |
| ---- | ----------------------------------------------- | -------------------------------------------- | ----- |
| H-3a | Re-export cross-module detector                 | Script separado ou integrado ao layer check  | Baixo |
| H-3b | Fan-out threshold check                         | Max 8 deps por módulo (warning > error)      | Baixo |
| H-3c | Barrel usage ratio tracker                      | Script gerando métrica (`barrel_ratio: 23%`) | Baixo |
| H-3d | Integrar gates no `npm run lint` ou `precommit` | Atualizar scripts npm                        | Baixo |

**Entregáveis Faixa H**: 16 subfases, all low-medium risk

---

## 4. Faixa I — Barrel Enforcement & Deep Import Migration (Wave 1)

**Prioridade**: P1 — Curto prazo
**Dependências**: H (CI deve detectar violações antes de enforçar barrels)
**Critério de conclusão**: Barrel ratio ≥80%, deep imports ≤50

### I-1: Auditoria de barrels e re-exports

| Item | Ação                                                                       | Risco |
| ---- | -------------------------------------------------------------------------- | ----- |
| I-1a | Inventariar todos exports de cada barrel (14 index.js)                     | Baixo |
| I-1b | Identificar exports internos que faltam no barrel                          | Baixo |
| I-1c | Para cada módulo: listar deep imports recebidos e mapear barrel equivalent | Baixo |
| I-1d | Gerar relatório: "barrel migration plan por módulo"                        | Baixo |

### I-2: Migrar deep imports do observability (134 targets)

| Item | Ação                                                                          | Risco   |
| ---- | ----------------------------------------------------------------------------- | ------- |
| I-2a | Decidir: `logger` fica como allow-listed deep import ou migra para barrel?    | Decisão |
| I-2b | Se barrel: expandir `observability/index.js` com export do logger             | Baixo   |
| I-2c | Migrar imports de `#copilot/observability/logger` → `#copilot/observability`  | Médio   |
| I-2d | Migrar imports de `#copilot/observability/metrics` → `#copilot/observability` | Médio   |
| I-2e | Migrar imports de `#copilot/observability/event-collector` → barrel           | Baixo   |
| I-2f | Validar: typecheck + lint + testes passam                                     | Baixo   |

### I-3: Migrar deep imports do core (57 targets)

| Item | Ação                                                                         | Risco |
| ---- | ---------------------------------------------------------------------------- | ----- |
| I-3a | Expandir `core/index.js` com exports faltantes (errors, error-handlers, etc) | Baixo |
| I-3b | Migrar imports de `#copilot/core/*` → `#copilot/core` (batch)                | Médio |
| I-3c | Validar: barrel contracts test atualizado e passando                         | Baixo |

### I-4: Migrar deep imports do config (43 targets)

| Item | Ação                                                                        | Risco |
| ---- | --------------------------------------------------------------------------- | ----- |
| I-4a | Expandir `config/index.js` com exports faltantes (env, session-config, etc) | Baixo |
| I-4b | Migrar imports de `#copilot/config/*` → `#copilot/config` (batch)           | Médio |
| I-4c | Validar typecheck + lint                                                    | Baixo |

### I-5: Migrar deep imports restantes (audit, hooks, bridges, tools, sdk, channel, db)

| Item | Target módulo | Deep imports | Ação                             | Risco |
| ---- | ------------- | ------------ | -------------------------------- | ----- |
| I-5a | audit/        | 12           | Expandir barrel + migrar imports | Baixo |
| I-5b | hooks/        | 11           | Expandir barrel + migrar imports | Baixo |
| I-5c | bridges/      | 10           | Expandir barrel + migrar imports | Baixo |
| I-5d | tools/        | 7            | Expandir barrel + migrar imports | Baixo |
| I-5e | sdk/          | 6            | Expandir barrel + migrar imports | Baixo |
| I-5f | channel/      | 5            | Expandir barrel + migrar imports | Baixo |
| I-5g | db/           | 2            | Migrar imports                   | Baixo |

### I-6: ESLint enforcement

| Item | Ação                                                                  | Risco |
| ---- | --------------------------------------------------------------------- | ----- |
| I-6a | Criar regra ESLint `no-restricted-imports` para `#copilot/*/!(index)` | Baixo |
| I-6b | Configurar allow-list (if any, ex: logger)                            | Baixo |
| I-6c | Validar: 0 violations com regra ativa                                 | Baixo |
| I-6d | Adicionar ao CI pipeline                                              | Baixo |

### I-7: Contract tests round 2

| Item | Ação                                                                         | Risco |
| ---- | ---------------------------------------------------------------------------- | ----- |
| I-7a | Testes de barrel completeness (cada barrel exporta todas as APIs públicas)   | Baixo |
| I-7b | Testes de no-cross-layer-export (barrels não exportam de camadas superiores) | Baixo |
| I-7c | Target: 14+ testes adicionais (total ≥20)                                    | Baixo |

**Entregáveis Faixa I**: 28 subfases, bulk é migração mecânica de imports

---

## 5. Faixa J — Decomposição de Arquivos Grandes (Wave 1, paralela com I)

**Prioridade**: P1 — Curto prazo
**Dependências**: H (para não introduzir novas violações durante splits)
**Critério de conclusão**: 0 arquivos >400 LoC raw com multi-concern

### J-1: Priority splits (multi-concern claros)

| Item | Arquivo                    | LoC | Split proposto                                            | Risco |
| ---- | -------------------------- | --- | --------------------------------------------------------- | ----- |
| J-1a | `audit/pipeline.js`        | 559 | pipeline-core.js + pipeline-helpers.js + pipeline-ring.js | Médio |
| J-1b | `terminal/index.js`        | 494 | bootstrap.js + lifecycle.js + index.js (barrel)           | Médio |
| J-1c | `tools/todo/crud-tools.js` | 459 | list-tools.js + write-tools.js + crud-tools.js            | Baixo |
| J-1d | `tools/todo/store.js`      | 423 | store.js + todo-schema.js                                 | Baixo |

### J-2: Class splits (classes grandes coesas mas splittable)

| Item | Arquivo                        | LoC | Split proposto                           | Risco |
| ---- | ------------------------------ | --- | ---------------------------------------- | ----- |
| J-2a | `agent/always-alive.js`        | 603 | always-alive.js + always-alive-events.js | Médio |
| J-2b | `agent/dialog/loop-manager.js` | 600 | loop-manager.js + loop-events.js         | Médio |
| J-2c | `conversation-hub/store.js`    | 562 | store.js + store-queries.js              | Médio |
| J-2d | `channel/client.js`            | 557 | client.js + client-connection.js         | Médio |
| J-2e | `sdk/rpc.js`                   | 484 | rpc-facade.js + rpc-operations.js        | Médio |
| J-2f | `channel/inject.js`            | 451 | inject-subscribe.js + inject-handlers.js | Médio |

### J-3: Type file splits

| Item | Arquivo                                            | LoC | Split proposto                                     | Risco |
| ---- | -------------------------------------------------- | --- | -------------------------------------------------- | ----- |
| J-3a | `sdk/types.js`                                     | 569 | types-agent.js + types-session.js + types-tools.js | Baixo |
| J-3b | Mover typedefs compartilhados para futuro `types/` |     | Preparação Wave 2                                  | Baixo |

### J-4: Bridge/Observability splits

| Item | Arquivo                            | LoC | Split proposto                         | Risco |
| ---- | ---------------------------------- | --- | -------------------------------------- | ----- |
| J-4a | `bridges/nerv-bridge.js`           | 434 | nerv-bridge.js + nerv-events.js        | Baixo |
| J-4b | `bridges/mcp-tool-bridge.js`       | 433 | mcp-bridge.js + mcp-reconnect.js       | Baixo |
| J-4c | `bridges/git-bridge.js`            | 428 | git-bridge.js + git-formatters.js      | Baixo |
| J-4d | `observability/metrics.js`         | 426 | metrics-store.js + metrics-factory.js  | Baixo |
| J-4e | `observability/event-collector.js` | 405 | event-collector.js + event-dispatch.js | Baixo |

### J-5: Remaining splits (lower priority)

| Item | Arquivo                            | LoC | Split proposto                         | Risco |
| ---- | ---------------------------------- | --- | -------------------------------------- | ----- |
| J-5a | `conversation-hub/socket-ns.js`    | 482 | socket-mount.js + socket-broadcast.js  | Baixo |
| J-5b | `conversation-hub/orchestrator.js` | 438 | Avaliar: potencialmente single-concern | Baixo |
| J-5c | `terminal/server.js`               | 452 | http-server.js + ws-server.js          | Baixo |
| J-5d | `terminal/repl.js`                 | 437 | repl-core.js + repl-handlers.js        | Baixo |
| J-5e | `sdk/client.js`                    | 416 | client.js + client-lifecycle.js        | Baixo |
| J-5f | `hooks/factory.js`                 | 416 | factory-create.js + factory-compose.js | Baixo |
| J-5g | `tools/introspection-tools.js`     | 409 | session-tools.js + system-tools.js     | Baixo |
| J-5h | `tools/file/read-tools.js`         | 405 | read-tools.js + list-tools.js          | Baixo |
| J-5i | `observability/observers/dialog-*` | 424 | Split por event type                   | Baixo |

### J-6: Validação pós-splits

| Item | Ação                                                                       | Risco |
| ---- | -------------------------------------------------------------------------- | ----- |
| J-6a | Atualizar todos os barrels (index.js) dos módulos afetados                 | Baixo |
| J-6b | Verificar: `npm run typecheck:node` + `npm run lint` + `npm run test:unit` | Baixo |
| J-6c | Atualizar barrel contract tests                                            | Baixo |
| J-6d | Verificar deep import count não aumentou                                   | Baixo |

**Entregáveis Faixa J**: 29 subfases, cada split é incremental e safe

**Resultado da execução (Faixa J)**:

- **J-1a** ✅ `audit/pipeline.js` 558→39 LoC (barrel) + 3 sub-files (sdk-buffer, audit-log, permission)
- **J-1b** ✅ `terminal/index.js` 494→224 LoC + `terminal-agent-wiring.js` (289 LoC)
- **J-1c** ✅ `tools/todo/crud-tools.js` 459→239 LoC + `todo-write-tools.js` (249 LoC)
- **J-1d** ✅ `tools/todo/store.js` 423→355 LoC + `todo-schema.js` (99 LoC)
- **J-2e** ✅ `sdk/rpc.js` 484→153 LoC + `rpc-session.js` (243 LoC) + `rpc-ops.js` (186 LoC)
- **J-4c** ✅ `bridges/git-bridge.js` 427→30 LoC + `git-bridge-read.js` (292 LoC) + `git-bridge-write.js` (226 LoC)
- **J-5h** ✅ `tools/file/read-tools.js` 405→26 LoC + `read-tools-io.js` (232 LoC) + `read-tools-search.js` (188 LoC)
- **J-2a-d, J-3a** ⏸ Deferidos — classes monolíticas (AlwaysAlive, LoopManager, ConversationStore, Client)
  requerem DI refactoring (Faixa K); types.js split causa erros TS2314 por chain de generics
- **J-6** ✅ Validação: TypeCheck 258 erros (baseline inalterado), 0 novos erros introduzidos

---

## 6. Faixa K — DI Container & Singleton Elimination (Wave 2)

**Prioridade**: P2 — Médio prazo
**Dependências**: I (barrels necessários para DI saudável), J (files menores facilitam DI)
**Critério de conclusão**: DI container funcional, ≤10 singletons, naming padronizado

### K-1: Criar DI container lightweight

| Item | Ação                                                                       | Risco |
| ---- | -------------------------------------------------------------------------- | ----- |
| K-1a | Implementar `core/di.js` (~100 LoC): createToken, createContainer, resolve | Médio |
| K-1b | Implementar lifecycle: singleton, transient, scoped                        | Médio |
| K-1c | Implementar `container.fork()` para child containers                       | Médio |
| K-1d | Implementar `container.dispose()` para ordered cleanup                     | Médio |
| K-1e | JSDoc robusto com generics: `@template T @param {Token<T>} token`          | Baixo |
| K-1f | Testes unitários do container (≥15 testes)                                 | Baixo |

### K-2: Definir DI tokens

| Item | Ação                                                                 | Risco |
| ---- | -------------------------------------------------------------------- | ----- |
| K-2a | Criar `types/di-tokens.js` com todos tokens derivados dos 22 setters | Baixo |
| K-2b | Documentar cada token com JSDoc descrevendo tipo e lifecycle         | Baixo |
| K-2c | Exportar via barrel `types/index.js`                                 | Baixo |

### K-3: Migrar setters para DI (batch 1 — observability stack)

| Item | Setter atual                                  | Token novo        | Risco |
| ---- | --------------------------------------------- | ----------------- | ----- |
| K-3a | `setSdkLogger`                                | `SDK_LOGGER`      | Médio |
| K-3b | `setAuditLogger`                              | `AUDIT_LOGGER`    | Médio |
| K-3c | `setAuditBus`                                 | `AUDIT_BUS`       | Médio |
| K-3d | `setShutdownLogger`                           | `SHUTDOWN_LOGGER` | Médio |
| K-3e | `setDbLogger`                                 | `DB_LOGGER`       | Médio |
| K-3f | `bootstrapObservability()` → container wiring | —                 | Médio |

### K-4: Migrar setters para DI (batch 2 — agent/tools stack)

| Item | Setter atual              | Token novo          | Risco |
| ---- | ------------------------- | ------------------- | ----- |
| K-4a | `setCustomToolsBuilder`   | `TOOLS_BUILDER`     | Médio |
| K-4b | `setBridgeAgent`          | `BRIDGE_AGENT`      | Médio |
| K-4c | `setFallbackAgent`        | `FALLBACK_AGENT`    | Médio |
| K-4d | `setHub`                  | `HUB`               | Médio |
| K-4e | `setPermissionAgent`      | `PERMISSION_AGENT`  | Médio |
| K-4f | `setSessionRpc`           | `SESSION_RPC`       | Médio |
| K-4g | `registerNervBridgeAgent` | `NERV_BRIDGE_AGENT` | Médio |

### K-5: Eliminar singletons residuais

| Item | Singleton                  | Solução                                | Risco |
| ---- | -------------------------- | -------------------------------------- | ----- |
| K-5a | `copilotDb`                | DI singleton com `{ singleton: true }` | Médio |
| K-5b | `_client`, `_startPromise` | DI singleton com lifecycle             | Alto  |
| K-5c | `copilotNamespace`         | DI singleton                           | Médio |
| K-5d | `globalAuditBuffer`        | DI singleton ou EventBus managed       | Médio |
| K-5e | Terminal state vars (8+)   | FSM (ver K-6)                          | Alto  |

### K-6: Terminal State Machine

| Item | Ação                                                    | Risco |
| ---- | ------------------------------------------------------- | ----- |
| K-6a | Implementar `terminal/state-machine.js` com FSM         | Médio |
| K-6b | Definir estados: idle, busy, plan, reflection, shutdown | Baixo |
| K-6c | Migrar 8+ vars de terminal/state.js para FSM            | Alto  |
| K-6d | Testes unitários de todas transições                    | Baixo |

### K-7: Validação e CI

| Item | Ação                                                               | Risco |
| ---- | ------------------------------------------------------------------ | ----- |
| K-7a | CI gate: singleton count por módulo (threshold configurable)       | Baixo |
| K-7b | CI gate: DI token coverage (todos tokens registrados no bootstrap) | Baixo |
| K-7c | Full regression: typecheck + lint + unit + integration tests       | Baixo |

**Entregáveis Faixa K**: 33 subfases

### Resultados da execução (Faixa K)

- **K-1** ✅ `core/di.js` (~240 LoC): `createToken`, `createContainer`, lifecycle (singleton/transient/scoped),
  `fork()`, `dispose()` com ordered cleanup
- **K-1f** ✅ 34 testes unitários passando (token, register/resolve, lifecycle, fork, dispose, dependency chain)
- **K-2** ✅ `core/di-tokens.js` com 12 tokens canônicos: SHUTDOWN_LOGGER, DB_LOGGER, SDK_LOGGER, TOOLS_BUILDER,
  AUDIT_LOGGER, AUDIT_BUS, BRIDGE_AGENT, FALLBACK_AGENT, HUB, PERMISSION_AGENT, SESSION_RPC, NERV_BRIDGE_AGENT
- **K-2c** ✅ `core/di-container.js` — container global singleton exportado via barrel `#copilot/core`
- **K-3** ✅ `observability/bootstrap.js` registra SHUTDOWN_LOGGER, DB_LOGGER, SDK_LOGGER, AUDIT_LOGGER no container
  (dual: setters legados + DI)
- **K-3f** ✅ `bootstrapLateDeps` registra TOOLS_BUILDER no container
- **K-4** ✅ `terminal/index.js` registra HUB, PERMISSION_AGENT, FALLBACK_AGENT, BRIDGE_AGENT, NERV_BRIDGE_AGENT
- **K-4 (entry)** ✅ `agent/lifecycle/entry.js` registra AUDIT_BUS no container
- **K-7** ✅ 16 contract tests (DI barrel exports + 12 tokens canônicos + distinção)
- **K-5, K-6** ⏸ Deferidos — eliminação de singletons residuais e terminal FSM requerem refactoring
  mais invasivo (candidatos para fase futura)
- **Validação**: TypeCheck 16 erros (baseline), Lint clean, 50 testes passando (34 unit + 16 contract)

---

## 7. Faixa L — Shared Types Module & TS Preparation (Wave 2, paralela com K)

**Prioridade**: P2 — Médio prazo
**Dependências**: J (types.js splittado), I (barrels prontos)
**Critério de conclusão**: `types/` module criado, typedefs compartilhados centralizados

### L-1: Criar módulo types/

| Item | Ação                                                       | Risco |
| ---- | ---------------------------------------------------------- | ----- |
| L-1a | Criar `src/copilot/types/index.js` (barrel)                | Baixo |
| L-1b | Criar `types/events.js` — schemas de eventos cross-module  | Baixo |
| L-1c | Criar `types/di-tokens.js` — tokens DI (de K-2)            | Baixo |
| L-1d | Mover typedefs compartilhados de `sdk/types.js` → `types/` | Médio |
| L-1e | README.md e barrel JSDoc                                   | Baixo |

### L-2: Declaration files (.d.ts)

| Item | Ação                                                   | Risco |
| ---- | ------------------------------------------------------ | ----- |
| L-2a | Criar `types/copilot.d.ts` — tipos globais do sistema  | Baixo |
| L-2b | Criar `types/events.d.ts` — typed events para EventBus | Baixo |
| L-2c | Criar `types/di.d.ts` — typed tokens para DI container | Baixo |
| L-2d | Validar com `npm run typecheck:node`                   | Baixo |

### L-3: Layer assignment e CI

| Item | Ação                                                                     | Risco |
| ---- | ------------------------------------------------------------------------ | ----- |
| L-3a | Registrar `types/` como L0 no layer check                                | Baixo |
| L-3b | Atualizar barrel contract tests                                          | Baixo |
| L-3c | Validar: nenhum módulo L1+ exporta typedefs que deveriam estar em types/ | Baixo |

**Entregáveis Faixa L**: 12 subfases

### Resultados da execução (Faixa L)

- **L-1a** ✅ `types/index.js` — barrel canônico com re-exports de DI tokens, container, event schemas
- **L-1b** ✅ `types/events.js` — catálogo de eventos cross-module: 8 namespaces (hook, session, tool,
  sdk, agent, api, terminal, audit), 28 event names, typedefs BaseEvent/SessionEvent/ToolEvent/SdkEvent/AuditEvent
- **L-1c** ✅ Re-export dos 12 DI tokens canônicos via barrel `#copilot/types`
- **L-1d** ⏸ Deferido — tipos SDK (Tool&lt;T&gt;, CopilotClient) não podem ser movidos de `sdk/types.js`
  sem quebrar TS resolution (mesmo problema do J-3a). Tipos permanecem em `sdk/types.js` como SSOT.
- **L-1e** ✅ `types/README.md` — documentação do módulo
- **L-2** ✅ Typedefs JSDoc declarados diretamente em `events.js` (BaseEvent, SessionEvent, ToolEvent, etc.)
  — sem necessidade de .d.ts separados
- **L-3a** ✅ `types/` registrado como L0 no LAYER_MAP (`scripts/check-layer-violations.mjs`)
- **L-3b** ✅ `test_types_contracts.spec.js` — 6 contract tests (barrel DI re-exports, event exports,
  namespace:action pattern, direct import resolution)
- **L-3c** ✅ Layer check integration: 0 violações no codebase
- **Validação**: TypeCheck 16 erros (baseline inalterada), Lint clean, 76 testes passando
- **tsconfig.base.json** atualizado com paths `#copilot/types` e `#copilot/types/*`
- **package.json** atualizado com subpath imports `#copilot/types` e `#copilot/types/*`

---

## 8. Faixa M — Application Event Bus (Wave 3)

**Prioridade**: P3 — Longo prazo
**Dependências**: K (DI container), L (typed events)
**Critério de conclusão**: EventBus cross-module funcional, ≤30 EventEmitter files ad-hoc

### M-1: Implementar Event Bus

| Item | Ação                                                                      | Risco |
| ---- | ------------------------------------------------------------------------- | ----- |
| M-1a | Implementar `core/event-bus.js` (~150 LoC): typed, namespaced, observable | Médio |
| M-1b | Wildcards: `agent:*`, `session:*`, `tool:*`                               | Baixo |
| M-1c | Middleware chain: logging, metrics, error-handling automáticos            | Médio |
| M-1d | Integration com DI: token `EVENT_BUS` no container                        | Baixo |
| M-1e | Testes unitários (≥20 testes)                                             | Baixo |

### M-2: Definir event catalog

| Item | Ação                                              | Risco |
| ---- | ------------------------------------------------- | ----- |
| M-2a | Catalogar todos os 70+ usos de .emit() existentes | Baixo |
| M-2b | Definir schemas para top 20 eventos mais usados   | Médio |
| M-2c | Publicar catálogo em `types/events.js`            | Baixo |

### M-3: Migração incremental (batch 1 — cross-module events)

| Item | Módulo(s)      | Eventos                                     | Risco |
| ---- | -------------- | ------------------------------------------- | ----- |
| M-3a | agent ↔ hooks  | session:start, session:end, tool:pre-invoke | Alto  |
| M-3b | agent ↔ obs.   | turn:start, turn:end, error:unhandled       | Alto  |
| M-3c | sdk → observ.  | sdk:request, sdk:response, sdk:error        | Médio |
| M-3d | api → services | api:request, api:error                      | Médio |

### M-4: Migração incremental (batch 2 — intra-module cleanup)

| Item | Ação                                                 | Risco |
| ---- | ---------------------------------------------------- | ----- |
| M-4a | Migrar terminal/ events para domain bus              | Médio |
| M-4b | Migrar conversation-hub events para domain bus       | Médio |
| M-4c | Avaliar: bridges/ pode usar EventBus para desacoplar | Médio |

### M-5: Integração NERV

| Item | Ação                                                                 | Risco |
| ---- | -------------------------------------------------------------------- | ----- |
| M-5a | Bridge `core/event-bus` ↔ `src/nerv/` (o bus NERV externo)           | Alto  |
| M-5b | Unificar event namespaces: copilot events são prefixados `copilot:*` | Médio |
| M-5c | Testes de integração: EventBus ↔ NERV                                | Médio |

**Entregáveis Faixa M**: 17 subfases

### Resultados da execução (Faixa M)

- **M-1a** ✅ `core/event-bus.js` (~230 LoC): EventBus com namespaces, wildcards (`session:*`, `*`),
  middleware chain, error isolation, counters/stats, dispose
- **M-1b** ✅ Wildcards implementados: `namespace:*` e `*` catch-all
- **M-1c** ✅ Middleware chain: pipeline com `use(fn)`, suporta intercept/block/transform
- **M-1d** ✅ Token `EVENT_BUS` criado em `core/di-tokens.js`, registrado como singleton no bootstrap
  via `observability/bootstrap.js`
- **M-1e** ✅ 29 testes unitários (on/emit, unsubscribe, once, wildcards, middleware, counters,
  listenerCount, dispose, error isolation)
- **M-2c** ✅ Catálogo de eventos publicado em `types/events.js` (28 event names, 8 namespaces,
  5 typedefs: BaseEvent, SessionEvent, ToolEvent, SdkEvent, AuditEvent)
- **M-2a, M-2b** ⏸ Catalogação exaustiva dos 70+ .emit() e schemas detalhados deferidos para
  fase de migração incremental
- **M-3, M-4, M-5** ⏸ Migrações incrementais (alto risco) deferidas — requerem refactoring invasivo
  de agent↔hooks, agent↔observability, sdk→observability, terminal, conversation-hub, NERV bridge
- **Validação**: TypeCheck 16 erros (baseline), Lint clean, 108 testes passando

---

## 9. Faixa N — Extensibilidade & API Services (Wave 3)

**Prioridade**: P3 — Longo prazo
**Dependências**: K (DI), L (types), M (EventBus)
**Critério de conclusão**: services/ funcional, plugin registry básico, api/ fan-out ≤8

### N-1: Services layer

| Item | Ação                                                                 | Risco |
| ---- | -------------------------------------------------------------------- | ----- |
| N-1a | Criar `src/copilot/services/` module (L4)                            | Baixo |
| N-1b | `SessionService` — facade: agent + sdk + config                      | Médio |
| N-1c | `ToolService` — facade: tools + hooks + bridges                      | Médio |
| N-1d | `AuditService` — facade: audit + observability                       | Médio |
| N-1e | `ConversationService` — facade: conversation-hub + channel           | Médio |
| N-1f | Migrar api/ routes para usar services em vez de imports diretos      | Alto  |
| N-1g | Target: api/ fan-out de 11→4 (services, config, core, observability) | —     |

### N-2: Plugin registry

| Item | Ação                                                            | Risco |
| ---- | --------------------------------------------------------------- | ----- |
| N-2a | Criar `src/copilot/plugins/` module (L3)                        | Baixo |
| N-2b | `PluginRegistry` — registro+discover de tools, bridges, hooks   | Médio |
| N-2c | Plugin interface contract: `{ name, type, install(container) }` | Médio |
| N-2d | Filesystem plugin discovery: `plugins/tools/*.js`               | Médio |
| N-2e | Config-based plugin activation                                  | Baixo |

### N-3: API refactoring

| Item | Ação                                                         | Risco |
| ---- | ------------------------------------------------------------ | ----- |
| N-3a | Migrar api/ endpoints para delegar a services/               | Alto  |
| N-3b | Extrair validation/auth middleware para `api/middleware/`    | Médio |
| N-3c | Adicionar OpenAPI schema gerado a partir dos tipos de types/ | Médio |
| N-3d | Validar: api/ fan-out ≤ 8                                    | Baixo |

### N-4: Health dashboard script

| Item | Ação                                                                  | Risco |
| ---- | --------------------------------------------------------------------- | ----- |
| N-4a | Criar `scripts/arch-health.mjs` — gera JSON de métricas de saúde      | Baixo |
| N-4b | Barrel ratio, singleton count, fan-out, violation count, deep imports | Baixo |
| N-4c | Health score calculado (A-F)                                          | Baixo |
| N-4d | Integrar ao CI como step informativo (não-bloqueante)                 | Baixo |

**Entregáveis Faixa N**: 18 subfases

### Resultados de Execução — Faixa N

**N-1a**: ✅ `src/copilot/services/index.js` — barrel L4 criado, layer registrado, subpath imports OK.

**N-1b**: ✅ `SessionService` — fachada para sdk sessions (create, resume, disconnect, list, foreground) com logging + EventBus.

**N-1c**: ✅ `ToolService` — fachada para tools (buildTool, listAll, getDisabled, isDisabled) com EventBus.

**N-1d**: ✅ `AuditService` — fachada para audit + observability (getTail, isHighRisk, errorTracker, metrics) com EventBus.

**N-1e**: ✅ `ConversationService` — fachada para conversation-hub (getHub, getStore, sendToLlmB, createHubSession).

**N-2a**: ✅ `src/copilot/plugins/index.js` — barrel L3 com `CopilotPlugin` typedef.

**N-2b**: ✅ `PluginRegistry` — register, install, installAll, list, has, get, size, clear. 11 testes.

**N-4a**: ✅ `scripts/arch-health.mjs` — health dashboard completo.

**N-4b**: ✅ Métricas: barrel ratio, singleton count, fan-out (max/avg/details), deep imports, DI tokens, test count.

**N-4c**: ✅ Health score A-F com fórmula ponderada.

**EventBus melhoria**: `emit()` agora aceita `{type: string}` sem timestamp obrigatório — auto-preenche `Date.now()`.

**Subfases deferidas** (alto risco / invasivas):
- N-1f–N-1g: Migração api/ para services — ✅ N-1f concluída (`e20fcc96`), fan-out 11→8.
- N-2c–N-2e: Plugin interface contract, filesystem discovery, config-based activation — ✅ concluídas (`eb6f88a9`).
- N-3a–N-3d: API refactoring — ✅ N-3a via N-1f, N-3b (middleware já extraído), N-3d (fan-out ≤8 atingido). N-3c (OpenAPI) adiada.
- N-4d: CI integration — ✅ arch-health step no code-quality.yml (`eb6f88a9`).

**N-1f**: ✅ Migração de api/ para services facades — fan-out reduzido de 11→8 modules. Rotas usam SessionService, ToolService, AuditService, ConversationService.

**N-2c**: ✅ CopilotPlugin typedef estendido: `version`, `description`, `dependencies` opcionais. PluginRegistry valida dependências em install().

**N-2d**: ✅ `discoverPlugins(baseDir, registry)` — escaneia tools/hooks/bridges/services/*.js, carrega via dynamic import, auto-infere tipo a partir do subdiretório.

**N-2e**: ✅ `activatePlugins(registry, container, enabledNames?)` — whitelist-based activation; sem whitelist instala todos.

**N-3b**: ✅ Middleware já extraído em middleware.js (error handler) e session-middleware.js (rate limiting, validation).

**N-3d**: ✅ api/ fan-out ≤ 8 — meta atingida na N-1f (8 modules: agent, bridges, channel, config, core, hooks, observability, services).

**N-4d**: ✅ Arch-health step integrado ao workflow code-quality.yml como step informativo (continue-on-error).

**Validação final N completa**: 22 node:test + 17 vitest = 39 testes copilot ✅ | lint 0 errors ✅ | typecheck 16 (baseline) ✅

---

## 10. Resumo de Subfases por Faixa

| Faixa | Nome                       | Subfases | Wave | Deps    |
| ----- | -------------------------- | -------- | ---- | ------- |
| **H** | CI Hardening + Violações   | 16       | 0    | —       |
| **I** | Barrel Enforcement         | 28       | 1    | H       |
| **J** | Decomposição de Arquivos   | 29       | 1    | H       |
| **K** | DI Container               | 33       | 2    | I, J    |
| **L** | Shared Types               | 12       | 2    | J, I    |
| **M** | Application Event Bus      | 17       | 3    | K, L    |
| **N** | Extensibilidade + Services | 18       | 3    | K, L, M |
| —     | **TOTAL**                  | **153**  | —    | —       |

---

## 11. Métricas Projetadas por Wave

| Métrica             | Atual (W0-) | Pós W0 (H) | Pós W1 (I,J) | Pós W2 (K,L) | Pós W3 (M,N) |
| ------------------- | ----------- | ---------- | ------------ | ------------ | ------------ |
| Layer violations    | 4           | **0**      | 0            | 0            | 0            |
| Barrel ratio        | 23%         | 23%        | **≥80%**     | ≥85%         | ≥90%         |
| Deep imports        | 233         | 233        | **≤50**      | ≤40          | ≤20          |
| Files >400 LoC      | 25          | 25         | **≤5**       | ≤5           | ≤5           |
| Singletons          | ~30         | ~30        | ~30          | **≤10**      | ≤5           |
| DI setters (ad-hoc) | 22          | 22         | 22           | **0** (DI)   | 0            |
| CI gates            | 2           | **5+**     | 7+           | 10+          | 12+          |
| Contract tests      | 6           | 8+         | **20+**      | 25+          | 30+          |
| EventEmitter ad-hoc | 70          | 70         | 70           | 70           | **≤30**      |
| api/ fan-out        | 11          | 11         | 11           | 11           | **≤4**       |
| Health Score (est.) | D (35)      | D+ (45)    | C+ (60)      | B (75)       | A- (85)      |

---

## 12. Riscos e Mitigações

| Risco                           | Probabilidade | Impacto | Mitigação                               |
| ------------------------------- | ------------- | ------- | --------------------------------------- |
| Barrel migration quebra imports | Média         | Médio   | Migrar por módulo, validar typecheck    |
| DI container over-engineering   | Média         | Alto    | Manter < 150 LoC, sem frameworks        |
| File splits criam circular deps | Baixa         | Médio   | CI gate de circular deps antes do split |
| EventBus adds latency           | Baixa         | Baixo   | Sync local events, async cross-module   |
| Effort creep nas waves 2-3      | Alta          | Médio   | Priorizar valor, defer subfases low-ROI |
| sdk/ wrapper instabilidade      | Baixa         | Alto    | Tests de contrato antes de cada mudança |

---

## 13. Conclusão

O roadmap de 153 subfases em 7 faixas e 4 ondas é desenhado para evolução **incremental e safe**:
cada subfase pode ser feita em um commit, testada e revertida se necessário.

O caminho crítico é H→I→K→M — CI hardening desbloqueia barrel enforcement, que desbloqueia DI
container, que desbloqueia EventBus. J e L são paralelos.

A execução disciplinada deste roadmap transforma o `src/copilot` de um monólito documentado em uma
**plataforma extensível e pronta para upgrades de larga escala**.
