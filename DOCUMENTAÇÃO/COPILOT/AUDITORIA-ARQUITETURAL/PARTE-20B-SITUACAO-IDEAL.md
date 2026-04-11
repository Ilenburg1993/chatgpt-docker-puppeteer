# PARTE-20B — Situação Ideal: Arquitetura Target de `src/copilot`

**Data**: 2026-04-10 | **Status**: Canônico | **Versão**: 1.0  
**Referência cruzada**: PARTE-20A (problemas), PARTE-20D (grafos), PARTE-20E (critérios)

---

## 1. Visão da Arquitetura Ideal

A arquitetura target de `src/copilot` deve satisfazer todos os 13 critérios definidos em `PARTE-20E-CRITERIOS.md`. O resultado final será um sistema com:

- **Hierarquia de camadas estrita** — dependências unidirecionais, verificadas por CI
- **Módulos coesos e bem delimitados** — cada pasta tem uma única responsabilidade
- **Interfaces públicas explícitas** — somente `index.js` é importado entre módulos
- **Zero artefatos runtime em `src/`** — logs e snapshots em `var/`
- **Arquivos < 300 LoC** — god objects decompostos
- **Zero duplicação de responsabilidade** — SSOT para config, tipos, URL validation, logging
- **Injeção de dependência** — sem singletons globais importados diretamente por camadas superiores

---

## 2. Estrutura de Diretório Target

```
src/copilot/
│
├── core/                    [L0] — Utilitários puros. Sem dependências internas.
│   ├── security/            NOVO — Utilitários de segurança (url-validator unificado)
│   │   └── url-validator.js
│   ├── shared-state.js      NOVO — Estado mínimo compartilhável (hubSessionId)
│   ├── abort-utils.js
│   ├── circuit-breaker.js
│   ├── constants.js
│   ├── error-codes.js
│   ├── error-handlers.js    MODIFICADO — sem import de observability
│   ├── errors.js
│   ├── events.js            RENOMEADO → event-types.js (clareza)
│   ├── retry.js
│   ├── safe-json.js
│   ├── schemas.js            RENOMEADO → validation-schemas.js (clareza)
│   ├── shutdown.js
│   ├── structured-message.js
│   ├── timer-registry.js
│   └── index.js
│
├── db/                      [L0] — Persistência SQLite.
│   ├── index.js
│   ├── migrations.js
│   └── sqlite.js
│
├── sdk/                     [L1] — Wrapper @github/copilot-sdk. SSOT runtime.
│   ├── models/
│   │   ├── helpers.js
│   │   ├── index.js
│   │   ├── known-models.js
│   │   ├── registry.js
│   │   ├── selector.js
│   │   └── stats-tracker.js
│   ├── agent-contract.js
│   ├── agents.js
│   ├── bridge-contract.js
│   ├── channel-contract.js
│   ├── client.js
│   ├── client-events.js
│   ├── client-facade.js
│   ├── config.js            CONSOLIDADO (fusão com config/session-config.js)
│   ├── constants.js
│   ├── custom-tools.js
│   ├── event-helpers.js
│   ├── events.js            RENOMEADO → sdk-events.js
│   ├── experimental-rpc.js
│   ├── feature-flags.js
│   ├── health.js
│   ├── http-request.js
│   ├── permissions.js
│   ├── provider.js
│   ├── quota-monitor.js
│   ├── rpc.js               DIVIDIDO em rpc-client.js + rpc-server.js (>400 LoC)
│   ├── server-rpc.js
│   ├── session.js
│   ├── session-lifecycle.js RENOMEADO → sdk-session-wrapper.js (evitar conflito)
│   ├── session-setup.js
│   ├── system-message.js
│   ├── telemetry.js
│   ├── tools.js
│   ├── tools-registry.js
│   ├── tools-state.js
│   ├── types.js             SSOT de tipos — manter
│   └── index.js
│
├── audit/                   [L1] — Pipeline de auditoria. Append-only.
│   ├── index.js
│   ├── jsonl-writer.js
│   ├── pipeline.js          DIVIDIDO → pipeline-core.js + pipeline-handlers.js
│   └── ring-buffer.js
│
├── config/                  [L2] — Configuração do sistema. SSOT de config.
│   ├── agents/              NOVO subdir para custom-agents
│   │   └── custom-agents.js
│   ├── prompts/             NOVO subdir para system-prompt
│   │   └── system-prompt.js
│   ├── env.js               SSOT de variáveis de ambiente
│   ├── mcp-servers.js
│   ├── pinned-files.js
│   ├── session-config.js    CONSOLIDADO com sdk/config.js
│   └── index.js
│
├── observability/           [L2] — Logging, métricas, alertas, traces.
│   ├── collectors/
│   │   ├── assistant-handlers.js
│   │   ├── context.js
│   │   ├── index.js
│   │   ├── interaction-handlers.js
│   │   ├── session-handlers.js
│   │   └── tool-handlers.js
│   ├── observers/
│   │   ├── context.js
│   │   ├── dialog-task-handlers.js  DIVIDIDO (>400 LoC)
│   │   ├── index.js
│   │   └── session-agent-handlers.js
│   ├── agent-event-observer.js     MODIFICADO — recebe agent por injeção
│   ├── bootstrap.js                NOVO — registra logger em core.onError callback
│   ├── error-alerting.js
│   ├── error-tracker.js
│   ├── event-catalog.js
│   ├── event-collector.js
│   ├── logger.js                   instância singleton — usada via import direto (aceitável)
│   ├── metrics.js                  DIVIDIDO → metrics-core.js + metrics-histograms.js
│   ├── metrics-histogram.js        FUSÃO com metrics.js
│   ├── otel.js
│   └── index.js
│
├── hooks/                   [L3] — Sistema de permissão e lifecycle.
│   ├── presets/
│   │   ├── audit.js
│   │   ├── deny-all.js
│   │   ├── index.js
│   │   ├── interactive.js
│   │   ├── minimal.js
│   │   ├── production.js
│   │   └── safe.js
│   ├── bus.js
│   ├── composer.js
│   ├── error-handler.js
│   ├── factory.js
│   ├── permission-handler.js
│   ├── prompt-transformer.js
│   ├── registry.js
│   ├── session-hooks.js     RENOMEADO de session-lifecycle.js (evitar conflito)
│   ├── tool-interceptor.js
│   ├── types.js             RENOMEADO → hook-types.js
│   ├── user-input.js
│   └── index.js
│
├── tools/                   [L3] — Definição de Tools disponíveis ao agente.
│   ├── file/
│   │   ├── index.js
│   │   ├── read-tools.js
│   │   ├── shared.js
│   │   └── write-tools.js
│   ├── git/
│   │   └── index.js
│   ├── shell/
│   │   ├── executor.js
│   │   ├── index.js
│   │   └── sandbox.js
│   ├── todo/
│   │   ├── bulk-tools.js
│   │   ├── crud-tools.js    DIVIDIDO (459 LoC) → crud-tools-read.js + crud-tools-write.js
│   │   ├── index.js
│   │   ├── query-tools.js
│   │   └── store.js         DIVIDIDO (423 LoC) → store-read.js + store-write.js
│   ├── code-tools.js
│   ├── hook-tools.js
│   ├── hub-tools.js
│   ├── introspection-tools.js
│   ├── permission-tools.js
│   ├── session-rpc-tools.js
│   ├── session-tools.js
│   ├── task-tools.js
│   ├── tool-factory.js      API pública estável — manter
│   ├── web-tools.js
│   └── index.js
│
├── bridges/                  [L3] — Adaptadores de infraestrutura externa.
│   │ (Reestruturado por natureza — 4 tipos distintos separados)
│   ├── git/                  NOVO subdir
│   │   ├── git-bridge.js     MOVIDO de bridges/git-bridge.js
│   │   ├── github/           MOVIDO de bridges/gh/
│   │   │   ├── ci.js
│   │   │   ├── issues.js
│   │   │   ├── prs.js
│   │   │   ├── shared.js
│   │   │   └── index.js
│   │   └── index.js
│   ├── mcp/                  NOVO subdir
│   │   ├── tool-bridge.js    MOVIDO de bridges/mcp-tool-bridge.js
│   │   ├── tool-schema.js    MOVIDO de bridges/mcp-tool-schema.js
│   │   └── index.js
│   ├── nerv/                 NOVO subdir
│   │   ├── event-publisher.js RENOMEADO/REFATORADO de nerv-bridge.js
│   │   │   (remove import de agent — recebe agent via parâmetro na factory)
│   │   └── index.js
│   └── index.js
│
├── agent/                    [L4] — Core agent. AlwaysAlive + session + dialog.
│   ├── dialog/
│   │   ├── agent-dialog-controller.js
│   │   ├── backpressure.js
│   │   ├── event-wiring.js
│   │   ├── index.js
│   │   ├── loop-coordinator.js  NOVO — coordena sub-managers
│   │   ├── loop-manager.js      DIVIDIDO — somente loop core (<300 LoC)
│   │   ├── turn-pipeline.js     NOVO — extraído de loop-manager.js
│   │   ├── model-fallback.js
│   │   ├── protocol.js
│   │   ├── turn-executor.js
│   │   ├── user-input-handler.js
│   │   └── watchdog.js
│   ├── infra/
│   │   ├── handoff-manager.js
│   │   ├── index.js
│   │   ├── message-queue.js
│   │   ├── permission-controller.js
│   │   ├── status-snapshot.js
│   │   ├── task-executor.js
│   │   ├── tools-bootstrap.js
│   │   └── webhook-manager.js   (url-validator removido — usa core/security)
│   ├── lifecycle/
│   │   ├── agent-bootstrap.js   NOVO — extraído de always-alive.js
│   │   ├── agent-lifecycle.js   MODIFICADO — remove import terminal
│   │   ├── connection-manager.js NOVO — extraído de always-alive.js
│   │   ├── entry.js
│   │   ├── index.js
│   │   ├── reconnect-policy.js
│   │   ├── session-setup.js
│   │   └── state-io.js
│   ├── messaging/
│   │   ├── agent-messaging.js
│   │   └── index.js
│   ├── session/
│   │   ├── event-handlers/
│   │   │   ├── catch-all.js
│   │   │   ├── compaction.js
│   │   │   ├── index.js
│   │   │   ├── mode-and-tools.js
│   │   │   ├── sdk-responses.js
│   │   │   ├── streaming.js
│   │   │   ├── system-notifications.js
│   │   │   ├── token-budget.js
│   │   │   └── usage.js
│   │   ├── boot-wiring.js
│   │   ├── cleanup.js
│   │   ├── event-wirer.js
│   │   ├── history-sync.js
│   │   ├── hook-context.js
│   │   ├── index.js
│   │   ├── initializer.js
│   │   ├── keepalive.js
│   │   ├── rotation.js
│   │   └── snapshot.js
│   ├── state/
│   │   ├── agent-state.js
│   │   └── index.js
│   ├── always-alive.js      DIVIDIDO em lifecycle/agent-bootstrap.js + lifecycle/connection-manager.js
│   ├── agent-context.js
│   ├── config.js            PERMANECE — config interna do agent
│   ├── queue-processor.js
│   ├── types.js             RENOMEADO → agent-types.js (evitar conflito)
│   └── index.js             PERMANECE — public API (alwaysAliveAgent + factory functions com DI)
│
├── conversation-hub/        [L4] — Hub de conversas multi-sessão.
│   ├── store/               NOVO subdir
│   │   ├── store.js         DIVIDIDO (562 LoC) → store-core.js + store-queries.js + store-sync.js
│   │   ├── store-helpers.js
│   │   ├── store-memories.js
│   │   ├── store-queries.js
│   │   └── store-sync.js
│   ├── call-strategies.js
│   ├── events.js
│   ├── hub.js
│   ├── orchestrator.js      DIVIDIDO (438 LoC)
│   ├── send-pipeline.js
│   ├── socket-ns.js         DIVIDIDO (482 LoC) → socket-ns-core.js + socket-ns-handlers.js
│   └── index.js
│
├── channel/                 [L5] — Client de comunicação LLM-A ↔ LLM-B.
│   ├── client.js            DIVIDIDO (557 LoC) e MODIFICADO (DI explícita)
│   ├── client-dialog.js
│   ├── client-history.js
│   ├── client-structured.js
│   ├── inject.js            DIVIDIDO (451 LoC) → session-factory.js + message-injector.js
│   ├── sse-client.js
│   └── index.js
│
├── api/                     [L5] — HTTP, SSE, bridge de controle.
│   ├── bridge/
│   │   ├── control.js       MODIFICADO — DI explícita
│   │   ├── dialog.js
│   │   ├── index.js
│   │   ├── stream.js
│   │   └── tasks.js
│   ├── express/
│   │   ├── agent.js         MODIFICADO — recebe agent por factory
│   │   ├── client.js
│   │   ├── hooks.js
│   │   ├── index.js         MODIFICADO — createRouter(agent) factory
│   │   ├── middleware.js
│   │   ├── observability.js
│   │   ├── session-crud.js
│   │   ├── session-messaging.js
│   │   ├── session-middleware.js
│   │   ├── sessions.js
│   │   └── webhooks.js
│   ├── sse/
│   │   ├── fanout.js
│   │   ├── index.js
│   │   ├── replay-buffer.js
│   │   └── utils.js
│   └── index.js
│
└── terminal/                [L6] — Interface interativa LLM-B. Camada de apresentação.
    ├── commands/             OK — 23 comandos bem agrupados
    │   └── ... (sem mudanças além de limpeza DI)
    ├── dialog/               OK — motor de diálogo terminal
    │   └── ...
    ├── handlers/             CONSOLIDADO — eliminar duplicação flat vs dir
    │   ├── agent.js
    │   ├── dialog.js
    │   ├── index.js
    │   ├── shared.js         RENOMEADO → shared-utils.js
    │   ├── system-config.js
    │   └── system-metrics.js
    ├── alias-store.js
    ├── dialog.js             RENOMEADO → terminal-dialog.js (evitar conflito)
    ├── file-context.js
    ├── index.js
    ├── rate-limiter-state.js
    ├── repl.js               MODIFICADO — usa DI para agent
    ├── repl-listeners.js
    ├── route-table.js
    ├── server.js
    ├── state.js              MODIFICADO — hubSessionId move para core/shared-state.js
    └── workspace-context.js
    (handlers-*.js eliminados — mantidas só versões em handlers/)
```

---

## 3. Comparação por Módulo: Atual → Ideal

| Módulo | Antes | Depois | Tipo de mudança |
|---|---|---|---|
| `core/` | 14 arquivos, importa observability | 15 arquivos (+security/), sem imports internos | Extração + fix |
| `sdk/` | 32 arquivos, rpc.js 484 LoC | 33 arquivos, rpc dividido | Divisão |
| `audit/` | 4 arquivos OK | 4 arquivos, pipeline dividido | Divisão |
| `config/` | 7 arquivos, 3 locais de config | 7 arq + subfolders, session-config consolidado | Reestruturação |
| `observability/` | 17 arquivos, métricas duplicadas | 17 arq + bootstrap.js, metrics fundidos | Adição + fusão |
| `hooks/` | 19 arq, tipos conflitantes | 19 arq, renomeações | Renomeação |
| `tools/` | 28 arq, todo/store.js 423 LoC | 28+ arq, arquivos grandes divididos | Divisão |
| `bridges/` | 11 arq, 4 naturezas misturadas | Reorganizado em git/, mcp/, nerv/ | Reorganização |
| `agent/` | 40 arq, always-alive 603 LoC | 42 arq, god objects divididos, sem imports terminal | Divisão + fix |
| `conversation-hub/` | 12 arq, store.js 562 LoC | 12 arq + store/ subdir, arquivos grandes divididos | Divisão |
| `channel/` | 7 arq, client.js 557 LoC + DI problemática | 8+ arq, DI explícita | Divisão + DI |
| `api/` | 20 arq, singleton import direto | 20 arq, factory DI | Fix DI |
| `terminal/` | 38 arq, handlers duplos, state global vaza | 36 arq (-flat handlers), state encapsulado | Limpeza + fix |
| `logs/` | Em src/copilot — errado | Movido para var/logs/copilot/ | Movimentação |

---

## 4. Mudanças Críticas Específicas

### 4.1 `core/error-handlers.js` — Remover Inversão de Dependência

**Atual:**
```js
import { errorTracker } from '../observability/error-tracker.js';
import logger from '../observability/logger.js';
```

**Ideal:**
```js
// core não importa observability
// observability registra handler via callback:
// observability/bootstrap.js:
import { registerCoreErrorHandler } from '../core/error-handlers.js';
registerCoreErrorHandler(logger, errorTracker);
```

### 4.2 `agent/lifecycle/agent-lifecycle.js` — Remover Import de Terminal

**Atual:**
```js
import { getHubSessionId } from '../../terminal/state.js';
void syncSdkHistory(session, ..., { getHubSessionId, conversationStore });
```

**Ideal — opção A (core/shared-state.js):**
```js
import { getHubSessionId } from '#copilot/core/shared-state';
```

**Ideal — opção B (injeção por parâmetro):**
```js
// agent-lifecycle.js não importa — recebe getHubSessionId como parâmetro de setup
async function setupSession(session, host, { getHubSessionId, conversationStore }) { ... }
```

### 4.3 `bridges/nerv-bridge.js` — Remover Import de Agent

**Atual:**
```js
import { alwaysAliveAgent } from '../agent/index.js';
```

**Ideal:**
```js
// nerv-bridge é um publisher passivo
// createNervBridge(agent) → bridge — DI explícita
```

### 4.4 `terminal/` — Eliminar Handlers Duplicados

Remover: `terminal/handlers-agent.js`, `terminal/handlers-dialog.js`, `terminal/handlers-shared.js`, `terminal/handlers-system.js`  
Manter: `terminal/handlers/` (versão subdiretório — organização correta)

### 4.5 `always-alive.js` — Decomposição

**Atual:** 1 arquivo 603 LoC com bootstrap + conexão + lifecycle + public API  
**Ideal:**
```
agent/lifecycle/agent-bootstrap.js   — inicialização única (criar agent, configurar)
agent/lifecycle/connection-manager.js — reconexão, keepalive, retry
agent/always-alive.js                — public API minimalista (< 100 LoC)
```

### 4.6 `loop-manager.js` — Decomposição

**Atual:** 1 arquivo 600 LoC com loop principal + retry + model fallback + event dispatch  
**Ideal:**
```
agent/dialog/loop-manager.js        — loop principal puro (< 200 LoC)
agent/dialog/turn-pipeline.js       — NEW — pipeline de execução de turn
agent/dialog/loop-coordinator.js    — NEW — coordena sub-managers, backpressure
```

---

## 5. Métricas Target

| Métrica | Atual | Target Ideal |
|---|---|---|
| Arquivos JS | 284 | ~290 (mais arquivos, menores) |
| LoC totais | ~33.700 | ~30.000 |
| Arquivos > 400 LoC | 13 | **0** |
| Violações de camada | 3 | **0** |
| Ciclos arquiteturais (módulo) | 3 | **0** |
| Cross-module edges | 26 | **≤ 16** |
| God objects | 4 | **0** |
| Duplicações de responsabilidade | 6 | **0** |
| Módulos sem README.md de escopo | 14 | **0** |
| Singleton imports diretos em camadas altas | 8+ | **0** |

---

## 6. Princípio de Evolução

A migração para este estado ideal deve ser **incremental e não-destrutiva**:
1. Cada fase tem zero regressões funcionais
2. Cada fase tem seus próprios testes antes do merge
3. Refatoração estrutural (mover arquivos) é separada de mudanças de comportamento
4. A hierarquia de camadas é enforçada por CI progressivamente

O roadmap detalhado está em `PARTE-20C-ROADMAP.md`.
