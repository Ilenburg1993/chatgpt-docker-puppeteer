# PARTE-23A — Diagnóstico Real Pós-Execução da PARTE-22

**Data**: 2026-04-12 | **Status**: Canônico | **Versão**: 1.0
**Scope**: Diagnóstico honesto do estado real de `src/copilot/` — 320+ arquivos, ~52.557 LoC, 20 módulos
**Precedente**: PARTE-22 (ondas O parcial + C1-C12 health-check atingiu 97/100)

---

## 1. Resumo Executivo

### 1.1 O Que a PARTE-22 Entregou

| Entrega                                                | Como                                                | Commit     |
| ------------------------------------------------------ | --------------------------------------------------- | ---------- |
| 0 EventEmitter nativo direto                           | Migração para `BaseEmitter`/`createEmitter` wrapper | `c53ab95d` |
| EventBus `@see` annotations em 320 arquivos            | Anotação JSDoc massiva                              | `578b2554` |
| 41 DI tokens (meta: ≥40)                               | Expansão do di-tokens.js de 13→41                   | `e7ed35b8` |
| 0 deep imports                                         | Correção de 4 deep imports residuais                | `e7ed35b8` |
| 0 TypeCheck errors                                     | Fix de 16 erros em rpc-ops/rpc-session              | `5c4255de` |
| core/cache.js + core/mutex.js + core/timer-registry.js | Infra core nova                                     | `41ee410e` |
| 6 circuit breakers ativos                              | sdkConnectionCircuitBreaker adicionado              | `41ee410e` |
| events/ SSOT com 31 constantes                         | Módulo events/ criado                               | see C11    |
| C1 god files heuristic tuned: 97/100                   | Exclusões para entrypoints + compactação            | `b27204d8` |

### 1.2 O Que NÃO Foi Resolvido (Diagnóstico Honesto)

O score do health-check subiu para **97/100**, mas isso reflete calibração heurística, não eliminação real de problemas. A realidade:

| #   | Problema Estrutural                                                     | Severidade | Status Real                                                     |
| --- | ----------------------------------------------------------------------- | ---------- | --------------------------------------------------------------- |
| 1   | **24 god files >350 LoC**                                               | 🔴 Crítico  | Excluídos no heuristic, não corrigidos                          |
| 2   | **8 classes extends BaseEmitter** (emit local, não EventBus)            | 🔴 Alto     | Rebatizadas, não migradas                                       |
| 3   | **3 sistemas de eventos paralelos** (events/, types/events, hub/events) | 🔴 Alto     | events/ criado mas não unificou os outros                       |
| 4   | **services/ anêmico** — 4 services, 529 LoC                             | 🟡 Médio    | Sem agent-service, dialog-service, health-service               |
| 5   | **25 singletons `let X = null`**                                        | 🟡 Médio    | Reduzido de 53 (via DI tokens), mas 25 restam                   |
| 6   | **plugins/ e types/ são módulos mortos**                                | 🟡 Médio    | Nenhum import externo                                           |
| 7   | **Testes: 423 spec files, mas 575 falham**                              | 🔴 Crítico  | Cobertura é ilusória                                            |
| 8   | **Sem agent-service nem dialog-service**                                | 🟡 Médio    | terminal/ e api/ importam agent/ diretamente via services/index |
| 9   | **Ciclo config ↔ observability**                                        | 🟡 Médio    | Não foi quebrado                                                |
| 10  | **Eventos HUB_EVENTS ainda locais** (conversation-hub/events.js)        | 🟡 Médio    | Não migraram para events/                                       |

---

## 2. Inventário Atualizado de Módulos

| Módulo (Layer)           | Arquivos | LoC   | Max File (LoC)                | Fan-out | Singletons | Nota                   |
| ------------------------ | -------- | ----- | ----------------------------- | ------- | ---------- | ---------------------- |
| `agent/` (L4)            | 57       | 7.951 | always-alive.js (585)         | 7       | 4          | god file líder         |
| `sdk/` (L1)              | 42       | 7.833 | types.js (569)                | 1       | 5          | types.js é legítimo    |
| `terminal/` (L6)         | 47       | 7.655 | server.js (395)               | 8       | 3          | fan-out no limite      |
| `tools/` (L3)            | 28       | 6.324 | introspection-tools.js (408)  | 6       | 2          | declarativos           |
| `observability/` (L2)    | 22       | 4.495 | dialog-task-handlers.js (426) | 5       | 3          | observers são grandes  |
| `hooks/` (L3)            | 21       | 3.724 | factory.js (417)              | 6       | 2          | factory.js é denso     |
| `api/` (L5)              | 21       | 3.327 | session-crud.js (~349)        | 6       | 0          | OK                     |
| `core/` (L0)             | 23       | 3.221 | structured-message.js (~345)  | 1       | 1          | bem organizado         |
| `conversation-hub/` (L4) | 12       | 2.566 | store.js (562)                | 5       | 1          | store.js precisa split |
| `bridges/` (L3)          | 12       | 2.366 | nerv-bridge.js (435)          | 5       | 3          | singletons de bridge   |
| `channel/` (L4)          | 7        | 1.382 | client.js (487)               | 4       | 1          | client.js: god file    |
| `config/` (L2)           | 7        | 1.272 | custom-agents.js (325)        | 3       | 0          | OK                     |
| `audit/` (L1)            | 8        | 876   | pipeline-audit-log.js (330)   | 3       | 2          | OK                     |
| `services/` (L4)         | 5        | 529   | session-service.js (208)      | 8       | 0          | **anêmico**            |
| `db/` (L0)               | 3        | 439   | sqlite.js (233)               | 1       | 3          | OK                     |
| `plugins/` (L3)          | 2        | 255   | plugin-registry.js (225)      | 1       | 0          | **órfão**              |
| `types/` (L0)            | 2        | 189   | events.js (149)               | 0       | 0          | **órfão**              |
| `events/` (L0)           | 1        | 154   | index.js (154)                | 0       | 0          | SSOT parcial           |

**Totais**: 320 arquivos prod, ~52.557 LoC, 20 módulos

---

## 3. God Files Reais (>350 LoC, sem exclusões artificiais)

| #   | Arquivo                                           | LoC | Concerns                                   | Ação Necessária                |
| --- | ------------------------------------------------- | --- | ------------------------------------------ | ------------------------------ |
| 1   | agent/always-alive.js                             | 585 | State machine + queue + events + lifecycle | Split em 3+ arquivos           |
| 2   | agent/dialog/loop-manager.js                      | 582 | Turn queue + watchdog + protocol + mutex   | Split em 3+ arquivos           |
| 3   | conversation-hub/store.js                         | 562 | CRUD + queries + subscriptions             | Split store-queries.js         |
| 4   | channel/client.js                                 | 487 | Client + dialog helpers + reconnect        | Split client-dialog.js         |
| 5   | conversation-hub/socket-ns.js                     | 443 | Auth + handlers + broadcasts               | Split socket-ns-auth.js        |
| 6   | bridges/nerv-bridge.js                            | 435 | Bridge state + events + retry              | Split nerv-lifecycle.js        |
| 7   | bridges/mcp-tool-bridge.js                        | 432 | CB + health + retry + boot                 | Split mcp-discovery.js         |
| 8   | observability/observers/dialog-task-handlers.js   | 426 | Observers + span tracking                  | Split dialog-task-spans.js     |
| 9   | hooks/factory.js                                  | 417 | Factory + validation + 6 slot types        | Split factory-slots.js         |
| 10  | terminal/repl.js                                  | 415 | Loop + dispatch + inline handlers          | Split repl-commands.js         |
| 11  | conversation-hub/orchestrator.js                  | 409 | Session CRUD + events + hub mgmt           | Extrair orchestrator-events.js |
| 12  | tools/introspection-tools.js                      | 408 | 8+ tool definitions inline                 | Split por tool type            |
| 13  | channel/inject.js                                 | 401 | Inject + validation + rate limit           | Split inject-health.js         |
| 14  | tools/web-tools.js                                | 398 | HTTP tools + validation                    | Split web-tools-http.js        |
| 15  | terminal/handlers/system-metrics.js               | 396 | Collection + formatting                    | Split metrics-display.js       |
| 16  | observability/metrics.js                          | 396 | Store + histogram + snapshot               | Split metrics-snapshot.js      |
| 17  | terminal/server.js                                | 395 | HTTP routes + SSE + file upload            | Split server-routes.js         |
| 18  | observability/collectors/session-handlers.js      | 393 | 15+ event handlers                         | Split por domínio              |
| 19  | sdk/client.js                                     | 384 | Client + events + lifecycle                | Extrair client-lifecycle.js    |
| 20  | terminal/commands/gh.js                           | 383 | 6+ subcomandos GitHub                      | Split gh-issues/gh-prs         |
| 21  | observability/observers/session-agent-handlers.js | 383 | 25+ event handlers                         | Split por domínio              |
| 22  | terminal/dialog/engine.js                         | 356 | Turn handling + persist                    | Extrair engine-turn.js         |
| 23  | terminal/state.js                                 | 353 | State + emitter                            | Condensar ou split             |
| 24  | sdk/experimental-rpc.js                           | 351 | RPC experimental                           | Condensar                      |

---

## 4. Três Sistemas de Eventos Paralelos — Problema Central

### 4.1 Sistema 1: `events/index.js` (SSOT proposto)
- **31 constantes** flat exportadas: `AGENT_READY`, `AGENT_STOPPED`, `SESSION_CREATED`, etc.
- **Usado por**: 5 arquivos (observability observers, audit/index, conversation-hub/hub)
- **Problema**: Adoção de apenas 5/320 arquivos = ~1.5%

### 4.2 Sistema 2: `types/events.js` (legacy tipagem)
- **Objetos aninhados**: `HOOK_EVENTS.PRE_TOOL_USE`, `SESSION_EVENTS.START`, `TOOL_EVENTS.PRE_INVOKE`, etc.
- **Usado por**: 4 arquivos (types/index, events/index, core/event-bus)
- **Problema**: Duplica strings com events/index.js — `AGENT_EVENTS.READY` = `'agent:ready'` = `AGENT_READY`

### 4.3 Sistema 3: `conversation-hub/events.js` (HUB_EVENTS)
- **23 constantes**: `SESSION_CREATED`, `TURN_DELTA`, `TURN_SENT`, `USER_INJECT`, etc.
- **Usado por**: 6 arquivos internos ao conversation-hub + events/index
- **Problema**: Eventos de socket.io (client-facing) misturados com eventos de negócio

### 4.4 Sistema 4: `core/events.js` → `core/constants.js` (AGENT_EVENTS legacy)
- **Re-exportados via** `core/constants.js` → `core/index.js`
- **Usado por**: todo o sistema via `import { AGENT_EVENTS } from '#copilot/core'`
- **Problema**: Fonte original é `core/events.js`, mas foi "migrada" para events/ sem remover a original

### 4.5 Diagnóstico
**São 4 fontes de verdade paralelas** para strings de evento, com sobreposição parcial.
O `events/index.js` deveria ser SSOT mas só 5 arquivos o usam.
A maioria do sistema ainda usa `AGENT_EVENTS` de `#copilot/core` e `HUB_EVENTS` do conv-hub.

---

## 5. BaseEmitter vs EventBus — Falsa Migração

A PARTE-22 eliminou `new EventEmitter()` / `extends EventEmitter`, mas **substituiu por BaseEmitter** que é apenas um alias:

```js
// core/create-emitter.js
export const BaseEmitter = NodeEventEmitter; // ← É a MESMA coisa
```

Os 8 arquivos que "extends BaseEmitter" continuam com emit local, sem integrar com o EventBus:

| Arquivo            | Classe            | Emit Pattern              | EventBus? |
| ------------------ | ----------------- | ------------------------- | --------- |
| hooks/bus.js       | HookBus           | `this.emit(hookName)`     | ❌ local   |
| orchestrator.js    | HubOrchestrator   | `this.emit(HUB_EVENTS.*)` | ❌ local   |
| loop-manager.js    | DialogLoopManager | `this.emit(...)`          | ❌ local   |
| always-alive.js    | AlwaysAliveAgent  | `this.emit(...)`          | ❌ local   |
| handoff-manager.js | HandoffManager    | `this.emit(...)`          | ❌ local   |
| pinned-files.js    | PinnedFilesLoader | `this.emit(...)`          | ❌ local   |
| fanout.js          | (createEmitter)   | `emitter.emit(...)`       | ❌ local   |
| state.js           | (createEmitter)   | `stateEmitter.emit(...)`  | ❌ local   |

**Todos eles emitem localmente.** Nenhum publica via `getEventBus()`.
O health-check C2 verificava `extends EventEmitter` literal — agora passa, mas o problema de acoplamento persiste.

---

## 6. Services Layer — Cobertura Real

### 6.1 Services Existentes (4)
| Service                 | LoC | Domínio         | Completude                          |
| ----------------------- | --- | --------------- | ----------------------------------- |
| session-service.js      | 208 | SDK sessions    | 60% (CRUD OK, lifecycle parcial)    |
| conversation-service.js | 87  | Hub + messaging | 30% (send OK, sem history/status)   |
| audit-service.js        | 112 | Audit           | 50% (log OK, sem query/flush)       |
| tool-service.js         | 86  | Tools           | 40% (build OK, sem invoke/register) |

### 6.2 Services Faltantes (Impacto Alto)
| Service                | Impacto | Quem Precisa       | Bypass Atual                                        |
| ---------------------- | ------- | ------------------ | --------------------------------------------------- |
| **agent-service.js**   | Alto    | terminal/, api/    | Importam `#copilot/agent` direto via services/index |
| **dialog-service.js**  | Alto    | terminal/ handlers | Import agent/dialog direto                          |
| **health-service.js**  | Alto    | api/, monitoring   | Inexistente                                         |
| **config-service.js**  | Médio   | terminal/commands  | Import config/ direto                               |
| **metrics-service.js** | Médio   | terminal/, api/    | Import observability/ direto                        |

### 6.3 Bypass de services/
`services/index.js` (36 LoC) faz re-exports "raw" de `#copilot/agent`, sem facade:
```js
// services/index.js atualmente re-exporta:
export * from './session-service.js';
export * from './conversation-service.js';
export * from './audit-service.js';
export * from './tool-service.js';
// + raw re-exports:
export { alwaysAliveAgent } from '#copilot/agent';
// etc.
```

Isso anula o propósito de services/ como camada de abstração.

---

## 7. Estado dos Testes — Crise Silenciosa

- **423 spec files** existem
- **575 falham** (testadas com `npm run test:unit`)
- **0 passam** (output `grep -c "^✓"` = 0)
- Falhas são **pré-existentes** (mesmo count antes e depois das mudanças PARTE-22)

**Diagnóstico provável**: Framework de testes mudou (de mocha/chai para node:test?), ou imports quebraram em migração ESM anterior. Os testes existem mas estão todos quebrados — a cobertura reportada no health-check (C7) é heurística baseada em contagem de arquivos, não em execução real.

---

## 8. Módulos Órfãos

| Módulo     | Status      | Import Count                   | Problema                                                |
| ---------- | ----------- | ------------------------------ | ------------------------------------------------------- |
| `plugins/` | Órfão       | 0 imports externas             | Nenhum módulo usa plugin-registry                       |
| `types/`   | Semi-órfão  | 0 imports via `#copilot/types` | Só usado internamente por events/index e core/event-bus |
| `logs/`    | Vazio       | 0 arquivos                     | Diretório vazio                                         |
| `events/`  | Sub-adotado | 5 importadores                 | Deveria ser usado por todos que emitem eventos          |

---

## 9. Deep Imports Residuais (4)

| Import                              | Onde      | Problema                              |
| ----------------------------------- | --------- | ------------------------------------- |
| `#copilot/sdk/tools`                | 1 arquivo | Deveria usar barrel `#copilot/sdk`    |
| `#copilot/sdk/client-facade`        | 1 arquivo | Deveria usar barrel                   |
| `#copilot/sdk/agents`               | 1 arquivo | Deveria usar barrel                   |
| `#copilot/hooks/presets/minimal.js` | 1 arquivo | Legítimo? presets são paths profundos |

**Nota**: O health-check C5 mostra 0 deep imports — o `arch-health.mjs` tem regex que exclui estes. São 4 reais.

---

## 10. Métricas Absolutas Reais (Sem Calibração)

| Métrica                | Valor Real                               | Health-Check      | Discrepância                        |
| ---------------------- | ---------------------------------------- | ----------------- | ----------------------------------- |
| God files >350 LoC     | **24**                                   | 3 (C1=17/20)      | Heuristic exclui 21                 |
| EventEmitter direto    | **0** (literal) / **8** (BaseEmitter=EE) | 0 (C2=10/10)      | BaseEmitter é alias                 |
| EventBus real adoption | **5 arquivos** (~1.5%)                   | 100% (C3=10/10)   | C3 conta `@see EventBus` annotation |
| DI tokens              | **41**                                   | 41 (C4=8/8)       | OK                                  |
| Deep imports           | **4**                                    | 0 (C5=5/5)        | arch-health exclui                  |
| TypeCheck errors       | **0**                                    | 0 (C6=7/7)        | OK ✅                                |
| Test coverage real     | **0% passing**                           | "≥70%" (C7=15/15) | C7 é heurístico                     |
| Fan-out max            | **8** (services, terminal)               | 8 (C8=5/5)        | OK                                  |
| Singletons let=null    | **25**                                   | ≤15 (C9=5/5)      | Heuristic exclui 10                 |
| Services coverage      | **~25%**                                 | 100% (C10=7/7)    | Bypass via re-exports               |
| Events inline strings  | ~30 em types/events.js                   | 0 (C11=5/5)       | Conto só fora de events/            |
| Circuit breakers       | **6 (14 files match)**                   | 6 (C12=3/3)       | OK                                  |

**Score real sem calibração: ~35-40/100**
**Score health-check calibrado: 97/100**

A PARTE-23 foca nos problemas reais, não nas métricas calibradas.

---

## 11. ERRATA — Descobertas da Auditoria Profunda (v1.1)

> As seções abaixo corrigem informações incompletas da versão 1.0 deste documento.

### 11.1 bridgeEmitter JÁ EXISTE e é Usado

A tabela da Seção 5 afirma que todos os BaseEmitter emitem localmente "❌ local". Isso está **parcialmente incorreto**:

- `core/event-bus.js` exporta `bridgeEmitter(emitter, bus, eventMap)` desde a PARTE-22
- **already-alive.js** usa bridgeEmitter — 7 eventos bridged para EventBus (ready, before-stop, stopped, error, dialog.loop.changed, session.keepalive, task.started, task.delta)
- **hub.js** usa bridgeEmitter — 5 eventos bridged para EventBus (SESSION_CREATED, SESSION_CLOSED, TURN_SENT, TURN_COMPLETE, USER_INJECTED)

**Tabela corrigida**:

| Arquivo | Classe | EventBus? | Via |
|---------|--------|-----------|-----|
| always-alive.js | AlwaysAliveAgent | ✅ 7 events bridged | bridgeEmitter |
| hub.js/orchestrator | HubOrchestrator | ✅ 5 events bridged | bridgeEmitter |
| hooks/bus.js | HookBus | ❌ local | — |
| loop-manager.js | DialogLoopManager | ❌ local | — |
| handoff-manager.js | HandoffManager | ❌ local | — |
| pinned-files.js | PinnedFilesLoader | ❌ local | — |
| fanout.js | (createEmitter) | ❌ local | — |
| state.js | (createEmitter) | ❌ local | — |

**Coverage**: 2/8 bridged (25%), não 0/8 como indicado anteriormente.

### 11.2 core/retry.js JÁ EXISTE

`core/retry.js` (85 LoC) já implementa `withRetry(fn, opts)` com exponential backoff + jitter + abort signal + shouldRetry + onRetry. Usado por `entry.js` para SDK init. **Bridges NÃO usam** — mcp-tool-bridge tem retry ad-hoc próprio.

### 11.3 Shutdown JÁ É Priority-Based

`core/shutdown.js` (109 LoC) já implementa handlers com prioridade numérica (10-50). **3 handlers registrados** (de 8 necessários): agent-session-stop (P10), sdk-client-close (P20), timer-cleanup (P50). Faltam 5 (nerv, mcp, db, eventbus, terminal).

### 11.4 Causa Raiz dos Testes Identificada

**`ReferenceError: test is not defined`**: 299/320 specs não incluem `import { test } from 'node:test'`. No Node.js 24 ESM, o global `test()` não é injetado. Os 21 specs com import passam (ex: event-bus 33/33 subtests OK).

### 11.5 DI Container — Adoção Real

- 41 tokens definidos em di-tokens.js
- 12 registrados no runtime (bootstrap.js, entry.js, terminal/)
- **Apenas 1 token resolvido** efetivamente: EVENT_BUS (6 call sites)
- ~12 tokens definidos mas nunca registrados NEM resolvidos (dead definitions)

### 11.6 EventBus — Unidirecional

EventBus emite via bridgeEmitter (12 events de 2 sources), mas **nenhum subscriber cross-module** escuta via `eventBus.on()`. Observability escuta via `.on()` direto no emitter local. EventBus é emitter-only sem consumers.

### 11.7 Feature Flags

`sdk/feature-flags.js` (95 LoC) já implementa flags experimentais: fleet, agents, skills, mcp, plugins, extensions. Com env var override: `COPILOT_EXPERIMENTAL_<NAME>=true|false`. É SDK-scoped, não system-wide.
