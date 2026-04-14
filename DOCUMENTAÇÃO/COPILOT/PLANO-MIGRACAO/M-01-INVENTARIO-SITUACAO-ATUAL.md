# M-01 — Inventário Completo: Situação Atual de src/copilot/

**Data**: 2026-03-21
**Versão**: 1.0
**Propósito**: Referência completa e autocontida de todos os arquivos, módulos e responsabilidades
do diretório `src/copilot/`. Este documento é referenciado por todos os M-02 a M-06.

---

## 1. Resumo Quantitativo

| Métrica                   | Valor                          |
| ------------------------- | ------------------------------ |
| Total de arquivos `.js`   | 408                            |
| Total de linhas           | ~62.000                        |
| Módulos de nível superior | 21                             |
| Diretórios                | 56                             |
| Maior módulo              | `agent/` (61 arquivos, 8.620L) |
| Menor módulo              | `types/` (1 arquivo, 30L)      |

---

## 2. Inventário por Módulo

### 2.1 agent/ — L5 Orchestration (61 arquivos, 8.620L)

**Responsabilidade**: Agente always-alive, dialog loop, lifecycle, sessão, infra interna.
**Problema**: God module — absorve event handlers, config, permission, tools-bootstrap, webhook,
status-snapshot que deveriam estar em outros módulos.

| Arquivo                      | Linhas | Responsabilidade                     | Ação na migração                               |
| ---------------------------- | ------ | ------------------------------------ | ---------------------------------------------- |
| `agent-context.js`           | 254    | Estado global do agente (30+ campos) | **M-03**: Particionar em sub-estados (K1)      |
| `always-alive.js`            | 759    | Fachada principal + event bridges    | **M-03**: Reduzir para <300L (K5/L2)           |
| `config.js`                  | 205    | Configuração do agente               | **M-02**: Mover para `config/agent.js` (C7)    |
| `agent.js` (raiz)            | 15     | Barrel re-export                     | Manter                                         |
| `di-tokens.js`               | 15     | DI tokens do agent                   | Manter                                         |
| `index.js`                   | 47     | Barrel principal                     | Manter                                         |
| `queue-processor.js`         | 44     | Thin wrapper sobre MessageQueue      | **M-03**: Merge com agent-messaging (C10)      |
| `types.js`                   | 176    | Tipos JSDoc do agent                 | Manter                                         |
| **dialog/**                  |        |                                      |                                                |
| `agent-dialog-controller.js` | 160    | Controller de dialog                 | Manter                                         |
| `backpressure.js`            | 101    | Controle de backpressure             | Manter                                         |
| `event-wiring.js`            | 74     | Wiring de eventos do dialog          | Manter                                         |
| `index.js`                   | 19     | Barrel                               | Manter                                         |
| `loop-manager.js`            | 597    | Loop principal do dialog             | Manter                                         |
| `model-fallback.js`          | 85     | Fallback de modelo                   | Manter                                         |
| `protocol.js`                | 128    | Protocolo de comunicação             | Manter                                         |
| `turn-executor.js`           | 391    | Executor de turno + OTEL             | **M-03**: Merge com task-executor (C10)        |
| `user-input-handler.js`      | 108    | Handler de input do usuário          | Manter                                         |
| `watchdog.js`                | 177    | Watchdog de timeout                  | Manter                                         |
| **facades/**                 |        |                                      |                                                |
| `agent-model-config.js`      | 81     | Facade para config de modelo         | Manter                                         |
| `agent-session-ops.js`       | 69     | Facade para ops de sessão            | Manter                                         |
| `agent-webhook-ops.js`       | 41     | Facade para webhooks                 | Manter                                         |
| **infra/**                   |        |                                      |                                                |
| `handoff-manager.js`         | 159    | Gerenciamento de handoff             | Manter em agent/                               |
| `index.js`                   | 24     | Barrel                               | Manter                                         |
| `message-queue.js`           | 213    | FIFO queue de mensagens              | Manter em agent/                               |
| `permission-controller.js`   | 156    | Controlador de permissões            | **M-02**: Mover para `hooks/` (C4)             |
| `status-snapshot.js`         | 103    | Snapshot de estado                   | **M-02**: Mover para `observability/` (C4)     |
| `task-executor.js`           | 179    | Executor de tarefas                  | **M-03**: Merge com turn-executor (C10)        |
| `tools-bootstrap.js`         | 137    | Bootstrap de tools                   | **M-02**: Mover para `tools/bootstrap.js` (C4) |
| `webhook-manager.js`         | 233    | Gerenciamento de webhooks            | **M-02**: Mover para `infra/webhooks.js` (C4)  |
| **lifecycle/**               |        |                                      |                                                |
| `agent-lifecycle.js`         | 359    | Ciclo de vida do agente              | Manter                                         |
| `entry.js`                   | 251    | Entry point do agente                | Manter                                         |
| `index.js`                   | 19     | Barrel                               | Manter                                         |
| `reconnect-policy.js`        | 161    | Política de reconexão                | Manter                                         |
| `session-setup.js`           | 138    | Setup de sessão                      | Manter                                         |
| `state-io.js`                | 288    | Persistência de estado               | Manter                                         |
| **messaging/**               |        |                                      |                                                |
| `agent-messaging.js`         | 161    | API de envio de mensagens            | **M-03**: Merge com queue-processor (C10)      |
| `index.js`                   | 14     | Barrel                               | Manter                                         |
| **session/**                 |        |                                      |                                                |
| `boot-wiring.js`             | 331    | 12 etapas de boot                    | **M-03**: Extrair steps nomeadas (K5)          |
| `cleanup.js`                 | 126    | Limpeza de sessão                    | Manter                                         |
| `event-wirer.js`             | 82     | Wire de event handlers               | Manter (simplificar após M-03 P4-5)            |
| `history-sync.js`            | 119    | Sincronização de histórico           | Manter                                         |
| `hook-context.js`            | 219    | Contexto de hooks                    | Manter                                         |
| `index.js`                   | 21     | Barrel                               | Manter                                         |
| `initializer.js`             | 196    | Inicializador de sessão              | Manter                                         |
| `keepalive.js`               | 157    | Keepalive de sessão                  | Manter                                         |
| `rotation.js`                | 92     | Rotação de sessão                    | Manter                                         |
| `snapshot.js`                | 262    | Snapshot de sessão                   | Manter                                         |
| **session/event-handlers/**  |        |                                      |                                                |
| `catch-all.js`               | 101    | Catch-all de eventos SDK             | **M-03**: Mover para `event-handlers/` (C3)    |
| `compaction.js`              | 50     | Handler de compaction                | **M-03**: Mover para `event-handlers/` (C3)    |
| `index.js`                   | 20     | Barrel                               | **M-03**: Mover                                |
| `interaction-events.js`      | 115    | Eventos de interação                 | **M-03**: Mover para `event-handlers/` (C3)    |
| `mcp-events.js`              | 55     | Eventos MCP                          | **M-03**: Mover para `event-handlers/` (C3)    |
| `mode-and-tools.js`          | 23     | Eventos de modo/tools                | **M-03**: Mover para `event-handlers/` (C3)    |
| `sdk-responses.js`           | 133    | Respostas SDK                        | **M-03**: Mover para `event-handlers/` (C3)    |
| `session-lifecycle.js`       | 68     | Eventos de lifecycle                 | **M-03**: Mover para `event-handlers/` (C3)    |
| `streaming.js`               | 38     | Eventos de streaming                 | **M-03**: Mover para `event-handlers/` (C3)    |
| `system-notifications.js`    | 69     | Notificações de sistema              | **M-03**: Mover para `event-handlers/` (C3)    |
| `token-budget.js`            | 56     | Eventos de token budget              | **M-03**: Mover para `event-handlers/` (C3)    |
| `tool-lifecycle.js`          | 39     | Eventos de lifecycle de tool         | **M-03**: Mover para `event-handlers/` (C3)    |
| `usage.js`                   | 40     | Eventos de uso                       | **M-03**: Mover para `event-handlers/` (C3)    |
| **state/**                   |        |                                      |                                                |
| `agent-state.js`             | 74     | Estado do agente                     | Manter                                         |
| `index.js`                   | 8      | Barrel                               | Manter                                         |

---

### 2.2 sdk/ — L1 SDK Facade (41 arquivos, 8.096L)

**Responsabilidade**: Wrapper fino sobre `@github/copilot-sdk`.
**Problema**: Mantém estado mutável (session registry, _client) que deveria estar em L4/L5.

| Arquivo               | Linhas | Responsabilidade                | Ação na migração                                        |
| --------------------- | ------ | ------------------------------- | ------------------------------------------------------- |
| `config.js`           | 150    | buildSessionConfig (legacy)     | **M-04**: Eliminar (subsumido por SessionConfigBuilder) |
| `constants.js`        | 234    | Constantes re-exportadas do SDK | Manter                                                  |
| `di-tokens.js`        | 22     | DI tokens                       | Manter                                                  |
| `event-helpers.js`    | 141    | Helpers de eventos              | Manter                                                  |
| `feature-flags.js`    | 95     | Feature flags                   | Manter                                                  |
| `http-request.js`     | 62     | HTTP request wrapper            | Manter                                                  |
| `index.js`            | 356    | Barrel principal (re-exports)   | Simplificar                                             |
| `logger.js`           | 46     | Logger SDK                      | Manter                                                  |
| `types.js`            | 700    | Tipos JSDoc centrais            | Manter                                                  |
| `utils.js`            | 38     | Utilitários                     | Manter                                                  |
| **agent/**            |        |                                 |                                                         |
| `agents.js`           | 268    | Factory CustomAgentConfig       | **M-04**: Mover para `config/custom-agents.js` (C6)     |
| `bridge-contract.js`  | 56     | Contrato bridge                 | **M-02**: Mover para `types/contracts/` (C6)            |
| `channel-contract.js` | 56     | Contrato channel                | **M-02**: Mover para `types/contracts/` (C6)            |
| `contract.js`         | 77     | Contrato base                   | **M-02**: Mover para `types/contracts/` (C6)            |
| **models/**           |        |                                 |                                                         |
| `helpers.js`          | 348    | Helpers de modelos              | Manter                                                  |
| `index.js`            | 49     | Barrel                          | Manter                                                  |
| `known-models.js`     | 131    | Lista de modelos conhecidos     | Manter                                                  |
| `registry.js`         | 216    | Registry de modelos             | Manter                                                  |
| `selector.js`         | 217    | Seletor de modelo               | Manter                                                  |
| `stats-tracker.js`    | 126    | Tracker de stats de modelo      | Manter                                                  |
| **rpc/**              |        |                                 |                                                         |
| `experimental.js`     | 371    | RPC experimental                | Manter                                                  |
| `ops.js`              | 287    | Operações RPC                   | Manter                                                  |
| `server.js`           | 182    | RPC server-side                 | Manter                                                  |
| `session.js`          | 255    | RPC session-side                | Manter                                                  |
| `rpc.js` (raiz)       | 183    | Barrel RPC                      | Manter                                                  |
| **session/**          |        |                                 |                                                         |
| `client.js`           | 386    | Session registry + getClient()  | **M-04**: Extrair registry (C5)                         |
| `client-events.js`    | 255    | Client lifecycle events         | Manter                                                  |
| `client-facade.js`    | 131    | Facade do client                | Manter                                                  |
| `events.js`           | 271    | Session events                  | Manter                                                  |
| `lifecycle.js`        | 335    | Lifecycle wrappers              | Manter                                                  |
| `permissions.js`      | 165    | Permission handlers             | Manter                                                  |
| `provider.js`         | 168    | Session provider                | Manter                                                  |
| `system-message.js`   | 193    | System message builder          | Manter                                                  |
| `wrapper.js`          | 167    | Session wrapper                 | Manter                                                  |
| **telemetry/**        |        |                                 |                                                         |
| `health.js`           | 209    | Health checks                   | Manter                                                  |
| `quota-monitor.js`    | 153    | Monitor de quotas               | Manter                                                  |
| `tracing.js`          | 148    | Tracing OTEL                    | Manter                                                  |
| **tools/**            |        |                                 |                                                         |
| `core.js`             | 166    | Core tool utilities             | Manter                                                  |
| `custom.js`           | 295    | Custom tool builder             | Manter                                                  |
| `registry.js`         | 284    | Tool registry                   | Manter                                                  |
| `state.js`            | 104    | Tool state                      | Manter                                                  |

---

### 2.3 terminal/ — L6 Presentation (47 arquivos, 7.111L)

**Responsabilidade**: REPL interativo, comandos, dialog engine, workspace context.
**Estado**: Saudável, bem organizado. Não requer refatoração significativa.

| Arquivo                     | Linhas | Responsabilidade            |
| --------------------------- | ------ | --------------------------- |
| `alias-store.js`            | 224    | Store de aliases de comando |
| `bootstrap.js`              | 15     | Bootstrap do terminal       |
| `di-wiring.js`              | 58     | DI wiring                   |
| `dialog.js`                 | 34     | Barrel dialog               |
| `file-context.js`           | 360    | Contexto de arquivos        |
| `index.js`                  | 247    | Entry point                 |
| `rate-limiter-state.js`     | 35     | Estado do rate limiter      |
| `repl.js`                   | 427    | REPL principal              |
| `repl-listeners.js`         | 164    | Listeners do REPL           |
| `state.js`                  | 314    | Estado do terminal          |
| `terminal-agent-wiring.js`  | 307    | Wiring terminal↔agent       |
| `workspace-context.js`      | 139    | Contexto do workspace       |
| **commands/** (22 arquivos) | ~2.508 | Comandos slash              |
| **dialog/** (5 arquivos)    | ~803   | Engine de dialog            |
| **handlers/** (4 arquivos)  | ~894   | Handlers de sistema         |

---

### 2.4 tools/ — L3 Policies (32 arquivos, 6.928L)

**Responsabilidade**: Custom tools expostas ao SDK (14 categorias).
**Estado**: Saudável, bem categorizado.

| Arquivo                     | Linhas | Responsabilidade                    |
| --------------------------- | ------ | ----------------------------------- |
| `code-tools.js`             | 146    | Tools de código                     |
| `di-tokens.js`              | 26     | DI tokens                           |
| `experimental-rpc-tools.js` | 375    | 20 tools experimentais (Faixa A3.2) |
| `hook-tools.js`             | 344    | Tools de hooks                      |
| `hub-tools.js`              | 346    | Tools de hub                        |
| `index.js`                  | 123    | Barrel + bootstrapAllTools          |
| `introspection-tools.js`    | 412    | Tools de introspecção               |
| `logger.js`                 | 72     | Logger de tools                     |
| `metrics-proxy.js`          | 84     | Proxy de métricas                   |
| `permission-tools.js`       | 166    | Tools de permissões                 |
| `session-rpc-tools.js`      | 308    | Tools de RPC de sessão              |
| `session-tools.js`          | 216    | Tools de sessão                     |
| `task-tools.js`             | 166    | Tools de tarefas                    |
| `tool-factory.js`           | 164    | Factory de tools                    |
| `web-tools.js`              | 398    | Tools web                           |
| **file/** (5 arquivos)      | ~923   | Read/write file tools               |
| **git/** (1 arquivo)        | 286    | Git tools                           |
| **shell/** (3 arquivos)     | ~762   | Shell execution tools               |
| **todo/** (6 arquivos)      | ~1.571 | Todo management tools               |

---

### 2.5 observability/ — Cross-cutting (32 arquivos, 5.757L)

**Responsabilidade**: Logs, métricas, OTEL, error tracking, alerting.
**Problema**: Super-engenharia — 3 subsistemas para coletar/reagir a eventos.

| Arquivo                       | Linhas | Responsabilidade             | Ação na migração                                  |
| ----------------------------- | ------ | ---------------------------- | ------------------------------------------------- |
| `agent-event-observer.js`     | 241    | Observer de eventos do agent | Manter                                            |
| `bootstrap.js`                | 150    | Bootstrap de observability   | Manter                                            |
| `di-tokens.js`                | 29     | DI tokens                    | Manter                                            |
| `error-alerting.js`           | 242    | Alertas de erros (threshold) | **M-06**: Merge em error-pipeline (C9)            |
| `error-tracker.js`            | 233    | Ring buffer de erros         | **M-06**: Merge em error-pipeline (C9)            |
| `event-bus-observers.js`      | 223    | Observers de EventBus        | Manter                                            |
| `event-catalog.js`            | 130    | Dead-letter queue            | **M-06**: Remover (C11)                           |
| `event-collector.js`          | 369    | Collector de eventos         | Manter                                            |
| `index.js`                    | 62     | Barrel                       | Manter                                            |
| `logger.js`                   | 327    | Logger principal             | Manter                                            |
| `metrics.js`                  | 417    | Métricas                     | Manter                                            |
| `metrics-histogram.js`        | 158    | Histogramas                  | Manter                                            |
| `otel.js`                     | 243    | OpenTelemetry                | Manter                                            |
| `tool-stats.js`               | 164    | Stats de tools               | Manter                                            |
| **bus-actions/** (6 arquivos) | ~566   | Actions do EventBus          | **M-06**: Consolidar em observers (C11)           |
| **collectors/** (5 arquivos)  | ~1.201 | SDK event collectors         | **M-05**: Avaliar sobreposição com event-handlers |
| **observers/** (4 arquivos)   | ~1.002 | Observers unificados         | Manter como target de consolidação                |

---

### 2.6 hooks/ — L3 Policies (24 arquivos, 4.456L)

**Responsabilidade**: Permissões, interceptors, presets, audit trail.
**Estado**: Bem organizado após Faixa E.

| Arquivo                   | Linhas | Responsabilidade                        |
| ------------------------- | ------ | --------------------------------------- |
| `audit-trail.js`          | 275    | Audit trail ring buffer (Faixa E)       |
| `bus.js`                  | 230    | HookBus bridge → EventBus               |
| `composer.js`             | 292    | Composição de hooks Koa-style (Faixa E) |
| `di-tokens.js`            | 15     | DI tokens                               |
| `error-handler.js`        | 308    | SDK onErrorOccurred handler             |
| `factory.js`              | 486    | Factory principal de SessionHooks       |
| `index.js`                | 121    | Barrel                                  |
| `logger.js`               | 72     | Logger                                  |
| `permission-handler.js`   | 218    | Permission handler                      |
| `prompt-transformer.js`   | 152    | Transformador de prompts                |
| `registry.js`             | 177    | Registry de hooks                       |
| `session-hooks.js`        | 173    | Session hooks builder (Faixa E)         |
| `tool-filter.js`          | 125    | Filtro de tools (Faixa E)               |
| `tool-interceptor.js`     | 266    | Interceptor de tools                    |
| `types.js`                | 313    | Tipos JSDoc                             |
| `user-input.js`           | 177    | User input handler                      |
| **presets/** (7 arquivos) | ~1.034 | Presets de hooks                        |

---

### 2.7 core/ — L0 Core (20 arquivos, 3.146L)

| Arquivo                     | Linhas | Responsabilidade          |
| --------------------------- | ------ | ------------------------- |
| `cache.js`                  | 183    | Cache LRU                 |
| `circuit-breaker.js`        | 135    | Circuit breaker           |
| `di-container.js`           | 48     | DI container              |
| `di.js`                     | 275    | DI utilities              |
| `di-tokens.js`              | 41     | DI tokens centrais        |
| `error-codes.js`            | 76     | Códigos de erro           |
| `error-handlers.js`         | 233    | Classificação de erros    |
| `errors.js`                 | 144    | Hierarquia de erros       |
| `event-bus.js`              | 345    | EventBus global           |
| `index.js`                  | 76     | Barrel                    |
| `interfaces.js`             | 317    | Interfaces JSDoc          |
| `mutex.js`                  | 150    | Mutex async               |
| `retry.js`                  | 119    | Retry com backoff         |
| `safe-json.js`              | 62     | JSON safe parse/stringify |
| `schemas.js`                | 127    | Schemas de validação      |
| `security/url-validator.js` | 200    | Validador de URLs         |
| `shared-state.js`           | 42     | Estado compartilhado      |
| `shutdown.js`               | 110    | Shutdown handler          |
| `structured-message.js`     | 350    | Mensagens estruturadas    |
| `timer-registry.js`         | 113    | Registry de timers        |

---

### 2.8 server/ — L6 Presentation (31 arquivos, 3.223L)

| Arquivo                      | Linhas | Responsabilidade                            |
| ---------------------------- | ------ | ------------------------------------------- |
| `app.js`                     | 81     | Express app setup                           |
| `handler-bridge.js`          | 105    | Bridge handler                              |
| `index.js`                   | 106    | Entry point                                 |
| `router.js`                  | 102    | Router principal                            |
| **middleware/** (7 arquivos) | ~468   | Auth, CORS, rate-limit, error-handler, etc. |
| **routes/** (12 arquivos)    | ~1.613 | Endpoints HTTP                              |
| **socket/** (2 arquivos)     | ~496   | Socket.IO                                   |

---

### 2.9 events/ — L0 Core (20 arquivos, 2.299L)

| Arquivo                      | Linhas | Responsabilidade                 |
| ---------------------------- | ------ | -------------------------------- |
| `agent-events.js`            | 362    | Constantes de eventos do agent   |
| `create-emitter.js`          | 31     | Factory de emitters              |
| `emitter-events.js`          | 107    | Constantes de eventos do emitter |
| `hook-events.js`             | 24     | Constantes de eventos de hooks   |
| `hub-events.js`              | 70     | Constantes de eventos do hub     |
| `index.js`                   | 349    | Barrel + all events              |
| `legacy-events.js`           | 151    | Eventos legados                  |
| `nerv-events.js`             | 270    | Eventos NERV                     |
| `sdk-events.js`              | 15     | Eventos SDK                      |
| `service-events.js`          | 17     | Eventos de serviço               |
| `system-events.js`           | 43     | Eventos de sistema               |
| `terminal-events.js`         | 31     | Eventos do terminal              |
| **middleware/** (5 arquivos) | ~286   | Event middleware                 |
| **schemas/** (3 arquivos)    | ~543   | Event schemas                    |

---

### 2.10 config/ — L2 Configuration (23 arquivos, 2.349L)

| Arquivo                          | Linhas | Responsabilidade                |
| -------------------------------- | ------ | ------------------------------- |
| `auth.js`                        | 72     | Autenticação                    |
| `client-options.js`              | 278    | ClientOptionsBuilder (Faixa C)  |
| `custom-agents.js`               | 326    | Config de custom agents         |
| `env.js`                         | 224    | Variáveis de ambiente           |
| `index.js`                       | 67     | Barrel                          |
| `mcp-servers.js`                 | 146    | Config MCP servers              |
| `pinned-files.js`                | 281    | Arquivos pinados                |
| `session-config.js`              | 345    | SessionConfigBuilder (Faixa C)  |
| `system-prompt.js`               | 108    | Barrel system prompt            |
| **system-prompt/** (12 arquivos) | ~502   | System prompt modular (Faixa I) |

---

### 2.11 conversation-hub/ — L4 Orchestration (12 arquivos, 2.217L)

| Arquivo              | Linhas | Responsabilidade          |
| -------------------- | ------ | ------------------------- |
| `broadcast.js`       | 51     | Broadcast de mensagens    |
| `call-strategies.js` | 116    | Estratégias de chamada    |
| `di-tokens.js`       | 29     | DI tokens                 |
| `hub.js`             | 367    | Hub principal             |
| `index.js`           | 19     | Barrel                    |
| `orchestrator.js`    | 412    | Orquestrador de conversas |
| `send-pipeline.js`   | 188    | Pipeline de envio         |
| `store.js`           | 563    | Store SQLite              |
| `store-helpers.js`   | 164    | Helpers do store          |
| `store-memories.js`  | 109    | Memórias                  |
| `store-queries.js`   | 111    | Queries do store          |
| `store-sync.js`      | 88     | Sync do store             |

---

### 2.12 bridges/ — L2 Configuration (13 arquivos, 2.171L)

| Arquivo                     | Linhas | Responsabilidade      |
| --------------------------- | ------ | --------------------- |
| `di-tokens.js`              | 36     | DI tokens             |
| `git-bridge.js`             | 23     | Barrel git            |
| `git-bridge-read.js`        | 294    | Git read operations   |
| `git-bridge-write.js`       | 230    | Git write operations  |
| `index.js`                  | 33     | Barrel                |
| `mcp-tool-bridge.js`        | 432    | MCP tool bridge       |
| `mcp-tool-schema.js`        | 140    | MCP tool schema       |
| `nerv-event-bus-adapter.js` | 197    | NERV EventBus adapter |
| **gh/** (5 arquivos)        | ~786   | GitHub CLI bridge     |

---

### 2.13 api/ — L6 Presentation LEGACY (10 arquivos, 1.937L)

**Responsabilidade**: Express route handlers.
**Problema**: Duplica `server/routes/`. Deve ser **ELIMINADO** na Fase 1.

| Arquivo                         | Linhas | Responsabilidade       | Ação                                       |
| ------------------------------- | ------ | ---------------------- | ------------------------------------------ |
| `express/agent.js`              | 235    | Rotas de agent         | **M-02**: Merge em server/routes/          |
| `express/client.js`             | 222    | Rotas de client        | **M-02**: Merge em server/routes/          |
| `express/hooks.js`              | 120    | Rotas de hooks         | **M-02**: Merge em server/routes/          |
| `express/index.js`              | 65     | Setup Express          | **M-02**: Remover                          |
| `express/middleware.js`         | 90     | Middleware             | **M-02**: Remover (usa server/middleware/) |
| `express/observability.js`      | 336    | Rotas de observability | **M-02**: Merge em server/routes/          |
| `express/session-crud.js`       | 350    | CRUD de sessão         | **M-02**: Merge em server/routes/          |
| `express/session-messaging.js`  | 300    | Mensagens de sessão    | **M-02**: Merge em server/routes/          |
| `express/session-middleware.js` | 161    | Middleware de sessão   | **M-02**: Remover (usa server/middleware/) |
| `express/sessions.js`           | 58     | Barrel sessions        | **M-02**: Remover                          |

---

### 2.14 channel/ — L4 Orchestration (8 arquivos, 1.437L)

| Arquivo                | Linhas | Responsabilidade       |
| ---------------------- | ------ | ---------------------- |
| `client.js`            | 507    | Client LLM-A↔LLM-B     |
| `client-dialog.js`     | 129    | Dialog do client       |
| `client-history.js`    | 58     | Histórico do client    |
| `client-structured.js` | 94     | Mensagens estruturadas |
| `di-tokens.js`         | 8      | DI tokens              |
| `index.js`             | 80     | Entry point            |
| `inject.js`            | 418    | Injeção de contexto    |
| `sse-client.js`        | 143    | SSE client             |

---

### 2.15 audit/ — Cross-cutting (9 arquivos, 906L)

| Arquivo                  | Linhas | Responsabilidade             |
| ------------------------ | ------ | ---------------------------- |
| `di-tokens.js`           | 24     | DI tokens                    |
| `index.js`               | 37     | Barrel                       |
| `jsonl-writer.js`        | 80     | Writer JSONL                 |
| `logger.js`              | 66     | Logger                       |
| `pipeline.js`            | 31     | Pipeline barrel              |
| `pipeline-audit-log.js`  | 331    | Pipeline de audit log        |
| `pipeline-permission.js` | 173    | Pipeline de permission audit |
| `pipeline-sdk-buffer.js` | 84     | Buffer SDK                   |
| `ring-buffer.js`         | 80     | Ring buffer                  |

---

### 2.16 infra/ — L0 Core (10 arquivos, 790L)

| Arquivo               | Linhas | Responsabilidade                 |
| --------------------- | ------ | -------------------------------- |
| `di-tokens.js`        | 9      | DI tokens                        |
| `index.js`            | 20     | Barrel                           |
| `lockfile.js`         | 81     | Lockfile                         |
| `queue.js`            | 86     | Queue genérica                   |
| `storage.js`          | 57     | Storage abstraction              |
| **sse/** (4 arquivos) | ~537   | SSE fanout, replay, state, utils |

---

### 2.17 services/ — L4 (6 arquivos, 547L)

**Problema**: Facades finas sem lógica real. Deve ser **ELIMINADO** na Fase 1.

| Arquivo                   | Linhas | Responsabilidade     | Ação                          |
| ------------------------- | ------ | -------------------- | ----------------------------- |
| `audit-service.js`        | 118    | Facade audit         | **M-02**: Inline em consumers |
| `conversation-service.js` | 88     | Facade conversations | **M-02**: Inline em consumers |
| `di-tokens.js`            | 9      | DI tokens            | **M-02**: Remover             |
| `index.js`                | 35     | Barrel               | **M-02**: Remover             |
| `session-service.js`      | 209    | Facade sessions      | **M-02**: Inline em consumers |
| `tool-service.js`         | 88     | Facade tools         | **M-02**: Inline em consumers |

---

### 2.18 db/ — L0 Core (3 arquivos, 437L)

| Arquivo         | Linhas | Responsabilidade  |
| --------------- | ------ | ----------------- |
| `index.js`      | 10     | Barrel            |
| `migrations.js` | 195    | Migrations SQLite |
| `sqlite.js`     | 232    | SQLite connection |

---

### 2.19 plugins/ — L4 (3 arquivos, 268L)

| Arquivo              | Linhas | Responsabilidade              |
| -------------------- | ------ | ----------------------------- |
| `di-tokens.js`       | 9      | DI tokens                     |
| `index.js`           | 29     | Barrel                        |
| `plugin-registry.js` | 230    | Plugin registry (embrionário) |

---

### 2.20 types/ — L0 (1 arquivo, 30L)

| Arquivo    | Linhas | Responsabilidade |
| ---------- | ------ | ---------------- |
| `index.js` | 30     | Barrel de tipos  |

---

### 2.21 Arquivos raiz de src/copilot/

| Arquivo        | Linhas | Responsabilidade    |
| -------------- | ------ | ------------------- |
| `bootstrap.js` | 72     | Bootstrap principal |

---

## 3. Mapa de DI Tokens (11 tokens)

| Módulo             | Arquivo                         | Tokens                                                         | Descrição           |
| ------------------ | ------------------------------- | -------------------------------------------------------------- | ------------------- |
| `core`             | `core/di-tokens.js`             | EventBusToken, LoggerToken, ConfigToken, CacheToken            | Core infrastructure |
| `sdk`              | `sdk/di-tokens.js`              | CopilotClientToken, SessionProviderToken                       | SDK singletons      |
| `hooks`            | `hooks/di-tokens.js`            | HookRegistryToken                                              | Hook system         |
| `bridges`          | `bridges/di-tokens.js`          | GitBridgeToken, McpBridgeToken, NervBridgeToken, GhBridgeToken | External bridges    |
| `channel`          | `channel/di-tokens.js`          | (referencia bridges)                                           | Channel system      |
| `audit`            | `audit/di-tokens.js`            | AuditPipelineToken, AuditLoggerToken                           | Audit system        |
| `tools`            | `tools/di-tokens.js`            | ToolRegistryToken, ToolFactoryToken                            | Tool system         |
| `services`         | `services/di-tokens.js`         | (referencia outros)                                            | Thin wrappers       |
| `observability`    | `observability/di-tokens.js`    | MetricsToken, TracingToken                                     | Obs system          |
| `plugins`          | `plugins/di-tokens.js`          | PluginRegistryToken                                            | Plugin system       |
| `infra`            | `infra/di-tokens.js`            | (referencia core)                                              | Infra tokens        |
| `conversation-hub` | `conversation-hub/di-tokens.js` | HubToken, StoreToken                                           | Hub system          |
| `agent`            | `agent/di-tokens.js`            | AgentToken                                                     | Agent singleton     |

---

## 4. Resumo de Ações por Fase

| Fase           | Arquivos afetados | Ações                                                                                      |
| -------------- | ----------------- | ------------------------------------------------------------------------------------------ |
| M-02 (Cleanup) | ~30               | Remover api/ (10), remover services/ (6), mover configs (4), mover contracts (3)           |
| M-03 (Agent)   | ~30               | Mover event-handlers (12), merge executors (4), particionar AgentContext (5+)              |
| M-04 (SDK)     | ~10               | Extrair registry (1), mover agents.js (1), eliminar sdk/config (1), fix imports (21 JSDoc) |
| M-05 (Events)  | ~15               | Merge buses (3), bridge automático (5), consolidar collectors (5+)                         |
| M-06 (Obs+Err) | ~10               | Error pipeline (3), remover dead-letter (1), consolidar bus-actions (6)                    |
