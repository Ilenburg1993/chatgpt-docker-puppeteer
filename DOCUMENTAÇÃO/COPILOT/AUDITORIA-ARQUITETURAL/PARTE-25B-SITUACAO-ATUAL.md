# PARTE-25B — SITUAÇÃO ATUAL: INVENTÁRIO COMPLETO DE `src/copilot/`

> **Documento**: PARTE-25B-SITUACAO-ATUAL.md
> **Série**: PARTE-25 (nova auditoria arquitetural completa)
> **Data**: 2026-04-13
> **Base**: HEAD = `db7334a7` (Ondas 3.0–3.9 completas)
> **Objetivo**: Clarificar o papel de CADA pasta, subpasta e arquivo de `src/copilot/`

---

## PREFÁCIO — Como Ler Este Documento

Para cada módulo, este documento responde:

1. **O que é** — definição em uma frase
2. **O que faz** — responsabilidades
3. **Quem o usa** — dependentes explícitos
4. **De quem depende** — dependências
5. **Problemas** — dívida técnica, acoplamentos, orphans
6. **Status** — Ativo / Re-export stub / Órfão / Runtime data

---

## 1. RAIZ DE `src/copilot/`

| Arquivo | Papel | Status |
|---------|-------|--------|
| `agent.js` | PM2 entry point @deprecated — delega para `agent/index.js` | Re-export stub |
| `bootstrap.js` | Entry point canônico — chama `bootCopilot()` de `terminal/bootstrap.js` | Ativo |
| `README.md` | Documentação de alto nível do módulo | Documentação |

---

## 2. `agent/` — Worker Interno (57 arquivos)

**O que é**: O "cérebro" do sistema — implementa o loop de diálogo, ciclo de vida do agente, e gestão de sessões.

**Quem usa**: `terminal/`, `server/routes/agent.js`, `services/`

**Depende de**: `#copilot/core`, `#copilot/config`, `#copilot/observability`, `#copilot/sdk`, `hooks/`, `tools/`, `conversation-hub/`

---

### `agent/dialog/` — Loop de Diálogo

| Arquivo | Papel |
|---------|-------|
| `agent-dialog-controller.js` | Controlador principal do dialog loop — orquestra as demais partes |
| `backpressure.js` | Controle de backpressure da fila de mensagens |
| `event-wiring.js` | Conecta eventos do dialog loop ao event-bus |
| `loop-manager.js` | Gerencia estado do loop (paused, running, stopped) |
| `model-fallback.js` | Lógica de fallback de modelos quando o primário falha |
| `protocol.js` | Protocolo de comunicação do dialog (formatos, payloads) |
| `turn-executor.js` | Executa um único turno de diálogo com o modelo |
| `user-input-handler.js` | Processa input do usuário antes de enviar ao modelo |
| `watchdog.js` | Detecta e recupera de stalls/travamentos no dialog |
| `index.js` | Barrel export |

### `agent/facades/` — Fachadas de Configuração

| Arquivo | Papel |
|---------|-------|
| `agent-model-config.js` | Interface para configuração de modelos do agente |
| `agent-session-ops.js` | Operações de sessão do agente (create, load, close) |
| `agent-webhook-ops.js` | Operações de webhook (register, fire, clear) |

### `agent/infra/` — Infraestrutura do Agente

| Arquivo | Papel |
|---------|-------|
| `handoff-manager.js` | Gerencia handoffs (transferências de sessão entre agentes) |
| `message-queue.js` | Fila interna de mensagens para o loop de diálogo |
| `permission-controller.js` | Controle de permissões para ferramentas e operações |
| `status-snapshot.js` | Snapshot de status do agente (para /health, /status) |
| `task-executor.js` | Executor de tasks (agenda, monitora, cancela) |
| `tools-bootstrap.js` | Bootstrap das ferramentas disponíveis ao agente |
| `webhook-manager.js` | Manager de webhooks registrados |
| `index.js` | Barrel |

### `agent/lifecycle/` — Ciclo de Vida

| Arquivo | Papel |
|---------|-------|
| `agent-lifecycle.js` | État machine do agente: init → running → stopping → stopped |
| `entry.js` | Entry point do ciclo de vida — inicializa DI e inicia o agente |
| `reconnect-policy.js` | Política de reconexão automática (backoff, max retries) |
| `session-setup.js` | Setup inicial da sessão de agente |
| `state-io.js` | I/O de estado persistido (read/write em disco) |
| `index.js` | Barrel |

### `agent/messaging/` — Sistema de Mensagens

| Arquivo | Papel |
|---------|-------|
| `agent-messaging.js` | Interface de mensagens para o agente (inbound/outbound) |
| `index.js` | Barrel |

### `agent/session/` — Gestão de Sessão

| Arquivo | Papel |
|---------|-------|
| `boot-wiring.js` | Wiring de boot da sessão — conecta serviços ao iniciar |
| `cleanup.js` | Limpeza de recursos ao encerrar sessão |
| `event-wirer.js` | Conecta eventos de sessão ao event-bus |
| `history-sync.js` | Sincroniza histórico de conversação com store |
| `hook-context.js` | Contexto de hooks disponível durante a sessão |
| `initializer.js` | Inicializa recursos da sessão (DI, observability, tools) |
| `keepalive.js` | Mantém a sessão viva (keepalive ping) |
| `rotation.js` | Rotação de sessão (cria nova sessão quando a atual expira) |
| `snapshot.js` | Persiste e restaura snapshots da sessão |
| `index.js` | Barrel |
| `event-handlers/` | Handlers de eventos específicos de sessão |

### `agent/state/` — Estado do Agente

| Arquivo | Papel |
|---------|-------|
| `agent-state.js` | Estado global do agente (sessão ativa, status, modo) |
| `index.js` | Barrel |

### `agent/` (raiz) — Entrypoints e Config

| Arquivo | Papel |
|---------|-------|
| `agent-context.js` | Contexto compartilhado do agente (DI bindings, deps resolving) |
| `always-alive.js` | Singleton `alwaysAliveAgent` — instância global, "always alive" mode |
| `config.js` | Configuração específica do agente |
| `di-tokens.js` | DI tokens do módulo `agent/` |
| `index.js` | Barrel público — expõe `alwaysAliveAgent`, `createSnapshot`, etc. |
| `queue-processor.js` | Processador da fila de mensagens do agente |
| `README.md` | Documentação do módulo |
| `types.js` | Tipos JSDoc do módulo agent |

**Problemas do módulo `agent/`**:
- `agent/facades/` duplica algo do `services/` — `agent-session-ops.js` vs `SessionService`
- `agent/infra/tools-bootstrap.js` poderia estar em `tools/` para co-localização

---

## 3. `api/` — Camada de API (21 arquivos)

**O que é**: Módulo de API — contém re-exports de SSE (correto), bridge HTTP legada, e SDK API legada.

**Problemas principais**: `api/bridge/` e `api/express/` não são usados diretamente por `server/` — código funcional sem consumidor no transporte atual.

---

### `api/sse/` — Re-exports (Onda 3.6)

| Arquivo | Papel | Status |
|---------|-------|--------|
| `fanout.js` | Re-export → `../../server/sse/fanout.js` | ✅ Stub coreto |
| `replay-buffer.js` | Re-export → `../../server/sse/replay-buffer.js` | ✅ Stub correto |
| `utils.js` | Re-export → `../../server/sse/utils.js` | ✅ Stub correto |
| `index.js` | Barrel re-export de tudo de `server/sse/` | ✅ Stub correto |

### `api/bridge/` — HTTP Bridge (Potencialmente Órfão)

| Arquivo | Papel | Status |
|---------|-------|--------|
| `control.js` | Rotas: GET /status, /health, /session · POST /start, /stop | ⚠️ Sem consumidor |
| `dialog.js` | Rotas: POST /dialog/start, /turn, /stop | ⚠️ Sem consumidor |
| `stream.js` | Rota: GET /stream (SSE global) | ⚠️ Sem consumidor |
| `tasks.js` | Rotas: POST /send, /answer | ⚠️ Sem consumidor |
| `index.js` | Agrega os 4 sub-routers + monta em /api/copilot/ | ⚠️ Sem consumidor |

> **Nota**: `api/bridge/` usa `#copilot/services` → `alwaysAliveAgent` — lógica válida, mas `server/router.js` não monta este router. O router equivalente está fragmentado em `server/routes/agent.js`.

### `api/express/` — SDK API via Express (Potencialmente Órfão)

| Arquivo | Papel | Status |
|---------|-------|--------|
| `agent.js` | Rotas: /agent/info, /agent/tools, /agent/telemetry, /agent/state, /agent/stream | ⚠️ Sem consumidor |
| `client.js` | Rotas: /ping, /status, /auth, /models, /tools, /client/* | ⚠️ Sem consumidor |
| `hooks.js` | Rotas: /hooks (CRUD de hooks) | ⚠️ Sem consumidor |
| `middleware.js` | Middlewares compartilhados do SDK API | ⚠️ Órfão |
| `observability.js` | Rotas: /metrics, /traces | ⚠️ Sem consumidor |
| `session-crud.js` | CRUD: POST /sessions, GET /sessions, etc. | ⚠️ Sem consumidor |
| `session-messaging.js` | POST /sessions/:id/message, /sessions/:id/history | ⚠️ Sem consumidor |
| `session-middleware.js` | Middleware para validar sessão em rotas /sessions/:id | ⚠️ Sem consumidor |
| `sessions.js` | Barrel de rotas de sessão | ⚠️ Sem consumidor |
| `webhooks.js` | CRUD de webhooks: POST /webhooks, GET /webhooks, etc. | ⚠️ Sem consumidor |
| `index.js` | Cria o SDK API router completo | ⚠️ Sem consumidor; importado via `api/index.js` |

### `api/` (raiz)

| Arquivo | Papel |
|---------|-------|
| `index.js` | Barrel — expõe `createSdkApiRouter`, `httpBridge`, SSE exports |
| `openapi.json` | Spec OpenAPI (potencialmente desatualizada) |
| `README.md` | Documentação |

---

## 4. `audit/` — Pipeline de Auditoria (9 arquivos)

**O que é**: Sistema de auditoria canônico — pipeline de processamento, logging JSONL, ring buffer.

**Quem usa**: `observability/`, `terminal/`, `services/audit-service.js`

**Depende de**: `#copilot/core`

| Arquivo | Papel |
|---------|-------|
| `di-tokens.js` | DI tokens do módulo audit |
| `jsonl-writer.js` | Writer assíncrono de linhas JSONL para arquivo |
| `logger.js` | Logger de auditoria integrado ao pipeline |
| `pipeline-audit-log.js` | Integração do pipeline com o audit log |
| `pipeline-permission.js` | Filtragem de permissões no pipeline de auditoria |
| `pipeline-sdk-buffer.js` | Buffer para dados de SDK no pipeline |
| `pipeline.js` | Pipeline principal — processa eventos de auditoria em sequência |
| `ring-buffer.js` | Buffer circular de eventos de auditoria (hot path) |
| `index.js` | Barrel |
| `README.md` | Documentação |

---

## 5. `bridges/` — Bridges Externos (13 arquivos)

**O que é**: Adaptadores para sistemas externos — Git, GitHub (gh), MCP, e NERV.

**Quem usa**: `tools/`, `terminal/commands/`, `agent/`

**Depende de**: `#copilot/core`, `#copilot/config`, `#copilot/observability`

| Arquivo/Pasta | Papel |
|---------|-------|
| `gh/ci.js` | Bridge GitHub CI — status de runs de CI |
| `gh/issues.js` | Bridge GitHub Issues — list, fetch, comment |
| `gh/prs.js` | Bridge GitHub PRs — list, fetch, review |
| `gh/shared.js` | Utilities compartilhadas (gh CLI wrapper) |
| `gh/index.js` | Barrel |
| `di-tokens.js` | DI tokens do módulo bridges |
| `git-bridge.js` | Bridge Git — agregador de read + write |
| `git-bridge-read.js` | Operações Git read-only (log, status, diff) |
| `git-bridge-write.js` | Operações Git write (commit, push, checkout) |
| `mcp-tool-bridge.js` | Bridge para ferramentas MCP (Model Context Protocol) |
| `mcp-tool-schema.js` | Schemas de ferramentas MCP |
| `nerv-event-bus-adapter.js` | Adaptador NERV event bus → copilot event bus |
| `index.js` | Barrel |
| `README.md` | Documentação |

---

## 6. `channel/` — Client Channels (8 arquivos)

**O que é**: Clientes de canal de comunicação — SSE, inject, dialog, structured output.

**Quem usa**: `services/`, `terminal/`, `agent/`

**Depende de**: `#copilot/config`, `#copilot/observability`

| Arquivo | Papel |
|---------|-------|
| `client-dialog.js` | Cliente de channel de diálogo (input/output) |
| `client-history.js` | Cliente para histórico de conversação |
| `client-structured.js` | Cliente para output estruturado (JSON schema output) |
| `client.js` | Cliente base de channel |
| `di-tokens.js` | DI tokens |
| `inject.js` | Canal de injeção de mensagens (LLM-B inject) |
| `sse-client.js` | Cliente SSE para consumir eventos do server |
| `index.js` | Barrel |
| `README.md` | Documentação |

---

## 7. `config/` — Configuração (7 arquivos)

**O que é**: Módulo de configuração — variáveis de ambiente, auth, MCP servers, prompt do sistema.

**Quem usa**: Praticamente todos os módulos (42 importadores via `#copilot/config`)

**Depende de**: Node.js nativo apenas (sem deps internas)

| Arquivo | Papel |
|---------|-------|
| `auth.js` | Configuração de autenticação (token, provider) |
| `custom-agents.js` | Configuração de agentes customizados |
| `env.js` | Leitura e validação de variáveis de ambiente |
| `mcp-servers.js` | Lista e configuração de servidores MCP |
| `pinned-files.js` | Arquivos fixados no contexto do agente |
| `system-prompt.js` | Construção do system prompt do agente |
| `index.js` | Barrel — expõe tudo como alias `#copilot/config` |
| `README.md` | Documentação |

---

## 8. `conversation-hub/` — Hub de Conversação (13 arquivos)

**O que é**: Hub central de sessões de conversação — orquestrador, store, pipeline de envio.

**Quem usa**: `server/socket/hub-ns.js`, `services/`, `terminal/`, `agent/`

**Depende de**: `#copilot/core`, `#copilot/config`, `#copilot/observability`, `db/`

| Arquivo | Papel |
|---------|-------|
| `call-strategies.js` | Estratégias de envio (sync, async, fire-and-forget) |
| `di-tokens.js` | DI tokens |
| `events.js` | Eventos de domínio do conversation hub |
| `hub.js` | Hub principal — `conversationHub` singleton; `initStandalone()` @deprecated |
| `orchestrator.js` | Orquestrador de sessões — roteamento de mensagens entre sessões |
| `send-pipeline.js` | Pipeline de envio: validação → rate-limit → broadcast |
| `socket-ns.js` | **@deprecated** — re-export stub → `server/socket/hub-ns.js` |
| `store-helpers.js` | Utilitários do store (queries genéricas) |
| `store-memories.js` | Memórias persistidas da sessão |
| `store-queries.js` | Queries no store (read-only) |
| `store-sync.js` | Sincronização do store (write) |
| `store.js` | Store principal de sessões — interface única |
| `index.js` | Barrel |
| `README.md` | Documentação |

**Problemas**:
- `hub.js`: `initStandalone()` ainda existe como `@deprecated` — a integração com Socket.IO via `init({ io })` precisa ser validada end-to-end
- `socket-ns.js`: re-export correto via Onda 3.7

---

## 9. `core/` — Contratos Centrais (19 arquivos)

**O que é**: Módulo de infraestrutura central — DI, event bus, errors, retry, shutdown, utilities.

**Quem usa**: 61 arquivos importam via `#copilot/core` (CRÍTICO — second most used alias)

**Depende de**: Node.js nativo, `zod`, `uuid`

| Arquivo | Papel |
|---------|-------|
| `cache.js` | Cache genérico com TTL |
| `circuit-breaker.js` | Circuit Breaker (half-open, open, closed) |
| `di-container.js` | DI Container — registro, resolução de dependências |
| `di-tokens.js` | DI tokens do módulo core |
| `di.js` | Factories de DI (createContainer, createToken) |
| `error-codes.js` | Enum de códigos de erro do sistema |
| `error-handlers.js` | Utilities de handling (isFatalError, wrapAsync) |
| `errors.js` | Hierarquia de erros do sistema |
| `event-bus.js` | Event bus central (pub/sub) |
| `mutex.js` | Mutex e pool de mutexes |
| `retry.js` | withRetry + withTimeout com exponential backoff |
| `safe-json.js` | Parse/stringify seguro sem throw |
| `schemas.js` | Schemas base (zod validators) |
| `shared-state.js` | Estado compartilhado (hubSessionId) |
| `shutdown.js` | Graceful shutdown (handlers, isShuttingDown) |
| `structured-message.js` | Tipo de mensagem estruturada (role, content) |
| `timer-registry.js` | Registro de timers para shutdown limpo |
| `security/url-validator.js` | Validação de URLs (anti-SSRF) |
| `index.js` | Barrel canônico |
| `README.md` | Documentação |

---

## 10. `db/` — Persistência SQLite (3 arquivos)

**O que é**: Adaptador SQLite para persistência de sessões/memórias.

**Quem usa**: `conversation-hub/store.js`, `conversation-hub/store-memories.js`

**Depende de**: `better-sqlite3`

| Arquivo | Papel |
|---------|-------|
| `migrations.js` | Definição e execução de migrações DDL |
| `sqlite.js` | Wrapper SQLite — query, execute, prepare |
| `index.js` | Barrel |
| `README.md` | Documentação |

---

## 11. `events/` — Sistema de Eventos (18 arquivos)

**O que é**: Schemas canônicos de eventos, registry, middleware e emitters.

**Quem usa**: `core/`, `observability/`, `agent/`, `terminal/` — ubíquo

**Depende de**: `#copilot/core`, `zod`

### `events/middleware/` — Pipeline de Eventos

| Arquivo | Papel |
|---------|-------|
| `correlation-enricher.js` | Adiciona correlationId a eventos |
| `rate-limiter.js` | Rate limiting no bus de eventos |
| `schema-validator.js` | Valida payloads contra schemas registrados |
| `timestamp-enricher.js` | Adiciona timestamp automático |
| `index.js` | Barrel |

### `events/schemas/` — Registry de Schemas

| Arquivo | Papel |
|---------|-------|
| `builtin-schemas.js` | Schemas built-in (sistema, agent, dialog) |
| `registry.js` | Registry de schemas de eventos |
| `index.js` | Barrel |

### `events/` (raiz) — Emitters e Catálogo

| Arquivo | Papel |
|---------|-------|
| `agent-events.js` | Eventos específicos do agente |
| `catalog.md` | Catálogo textual de todos os eventos |
| `create-emitter.js` | Factory de emitters tipados |
| `emitter-events.js` | Eventos do sistema de emitters |
| `hook-events.js` | Eventos do sistema de hooks |
| `hub-events.js` | Eventos do conversation hub |
| `nerv-events.js` | Eventos da bridge NERV |
| `service-events.js` | Eventos de serviços |
| `system-events.js` | Eventos de sistema (boot, shutdown) |
| `terminal-events.js` | Eventos do terminal |
| `index.js` | Barrel |

---

## 12. `hooks/` — Sistema de Hooks (20 arquivos)

**O que é**: Sistema extensível de hooks — interceptação de tools, permissões, prompts.

**Quem usa**: `agent/`, `tools/`, `terminal/`

**Depende de**: `#copilot/core`, `#copilot/config`, `#copilot/observability`

### `hooks/presets/` — Perfis Pré-configurados

| Arquivo | Papel |
|---------|-------|
| `audit.js` | Preset de auditoria (todos os hooks de audit ativados) |
| `deny-all.js` | Preset restritivo (nega tudo por padrão) |
| `interactive.js` | Preset interativo (solicita confirmação) |
| `minimal.js` | Preset mínimo (produção leve) |
| `production.js` | Preset de produção canônico |
| `profiles.js` | Barrel e factory de perfis |
| `safe.js` | Preset seguro (sem side effects) |
| `index.js` | Barrel |

### `hooks/` (raiz)

| Arquivo | Papel |
|---------|-------|
| `bus.js` | Bus de hooks (pub/sub de hook events) |
| `composer.js` | Composição de múltiplos hooks em pipeline |
| `error-handler.js` | Tratamento de erros em hooks |
| `factory.js` | Factory de hooks tipados |
| `permission-handler.js` | Hook de controle de permissões |
| `prompt-transformer.js` | Hook de transformação de prompt |
| `registry.js` | Registry de hooks registrados |
| `session-hooks.js` | Hooks de ciclo de vida de sessão |
| `tool-interceptor.js` | Interceptor de chamadas de tools |
| `types.js` | Tipos do sistema de hooks |
| `user-input.js` | Hook de processamento de input do usuário |
| `index.js` | Barrel |
| `README.md` | Documentação |

---

## 13. `infra/` — Infraestrutura (1 arquivo)

**O que é**: Módulo de infraestrutura — atualmente apenas DI tokens.

**Status**: ⚠️ **Stub mínimo** — 1 arquivo. Pode ser vestigial ou placeholder para expansão.

| Arquivo | Papel |
|---------|-------|
| `di-tokens.js` | DI tokens de infra (pool, queue, storage) |

---

## 14. `logs/` — Dados de Runtime

**O que é**: Pasta de runtime — contém arquivos de log gerados durante execução.

**Status**: ⚠️ **Não é código fonte** — `agent.log`, `audit.jsonl`, `events.jsonl`, `metrics.jsonl`, etc.

*Deve ser tratado como diretório de output, não source.*

---

## 15. `observability/` — Observabilidade (32 arquivos)

**O que é**: Sistema completo de observabilidade — logging, metrics, tracing OTEL, error tracking.

**Quem usa**: 129 arquivos importam via `#copilot/observability` — **MAIS IMPORTADO DE TODOS**

**Depende de**: `#copilot/core`, `#copilot/config`, `events/`

### `observability/bus-actions/` — Ações no Bus

| Arquivo | Papel |
|---------|-------|
| `activity-tracker.js` | Rastreia atividade do sistema no event bus |
| `correlation-tracer.js` | Adiciona correlação de traces via bus |
| `error-alerter.js` | Emite alertas de erro via bus |
| `health-updater.js` | Atualiza status de saúde via bus |
| `log-observer.js` | Observa e persiste logs via bus |
| `metrics-collector.js` | Coleta métricas via bus |
| `index.js` | Barrel |

### `observability/collectors/` — Coletores

| Arquivo | Papel |
|---------|-------|
| `assistant-handlers.js` | Coleta eventos de assistente (respostas do modelo) |
| `context.js` | Contexto de coleta |
| `interaction-handlers.js` | Coleta eventos de interação usuário↔agente |
| `session-handlers.js` | Coleta eventos de ciclo de vida de sessão |
| `tool-handlers.js` | Coleta eventos de chamadas de tools |
| `index.js` | Barrel |

### `observability/observers/` — Observers

| Arquivo | Papel |
|---------|-------|
| `context.js` | Contexto dos observers |
| `dialog-task-handlers.js` | Observer de tasks de diálogo |
| `event-name-map.js` | Mapeamento de nomes de eventos |
| `session-agent-handlers.js` | Observer de sessão + agent |
| `index.js` | Barrel |

### `observability/` (raiz)

| Arquivo | Papel |
|---------|-------|
| `agent-event-observer.js` | Observer principal de eventos do agente |
| `bootstrap.js` | Bootstrap da observabilidade — registra todos os observers |
| `di-tokens.js` | DI tokens |
| `error-alerting.js` | Sistema de alerta de erros críticos |
| `error-tracker.js` | Rastreamento de erros com contexto |
| `event-bus-observers.js` | Observers do event bus |
| `event-catalog.js` | Catálogo de eventos (runtime registry) |
| `event-collector.js` | Coletor central de eventos |
| `logger.js` | Logger canônico — exposto como `#copilot/observability` primary |
| `metrics-histogram.js` | Histograma de métricas |
| `metrics.js` | Sistema de métricas (counters, gauges, histograms) |
| `otel.js` | Integração OpenTelemetry |
| `tool-stats.js` | Estatísticas de uso de tools |
| `index.js` | Barrel |
| `README.md` | Documentação |

---

## 16. `plugins/` — Plugin Registry (3 arquivos)

**O que é**: Sistema de plugins de extensão do agente.

**Status**: ⚠️ **Minimal** — 3 arquivos, uso indireto via DI.

| Arquivo | Papel |
|---------|-------|
| `di-tokens.js` | DI tokens |
| `plugin-registry.js` | Registry de plugins registrados ao sistema |
| `index.js` | Barrel |

---

## 17. `sdk/` — SDK do Copilot (41 arquivos)

**O que é**: Abstração de acesso ao GitHub Copilot SDK — modelos, sessões, tools, auth, RPC.

**Quem usa**: `agent/`, `terminal/`, `api/express/`

**Depende de**: `#copilot/core`, `#copilot/config`, `#copilot/observability`, `@github/copilot-sdk`

### `sdk/models/` — Gestão de Modelos

| Arquivo | Papel |
|---------|-------|
| `helpers.js` | Utilitários de modelos |
| `known-models.js` | Lista de modelos conhecidos |
| `registry.js` | Registry de modelos disponíveis |
| `selector.js` | Seleção de modelo (por critério, por fallback) |
| `stats-tracker.js` | Rastreia estatísticas por modelo |
| `index.js` | Barrel |

### `sdk/` (raiz) — Contratos e Fachadas

| Arquivo | Papel |
|---------|-------|
| `agent-contract.js` | Contrato do agente para uso via SDK |
| `agents.js` | Lista e factory de agentes SDK |
| `bridge-contract.js` | Contrato de bridge (HTTP ↔ SDK) |
| `channel-contract.js` | Contrato de channel de comunicação |
| `client-events.js` | Eventos emitidos pelo SDK client |
| `client-facade.js` | Fachada do SDK client |
| `client.js` | Cliente SDK — wraps `@github/copilot-sdk` |
| `config.js` | Configuração do SDK |
| `constants.js` | Constantes do SDK |
| `custom-tools.js` | Registro de tools customizadas via SDK |
| `di-tokens.js` | DI tokens |
| `event-helpers.js` | Helpers de eventos SDK |
| `events.js` | Eventos do SDK |
| `experimental-rpc.js` | RPC experimental (streaming bidirecional) |
| `feature-flags.js` | Feature flags do SDK |
| `health.js` | Health check do SDK |
| `http-request.js` | Wrapper de HTTP requests do SDK |
| `logger.js` | Logger do SDK |
| `permissions.js` | Permissões do SDK |
| `provider.js` | Provider de credenciais |
| `quota-monitor.js` | Monitor de quota de uso da API |
| `rpc.js` | RPC base do SDK |
| `rpc-ops.js` | Operações RPC |
| `rpc-session.js` | RPC de sessão |
| `sdk-session-wrapper.js` | Wrapper de sessão SDK |
| `server-rpc.js` | Server-side RPC |
| `session.js` | Gestão de sessão via SDK |
| `system-message.js` | Construção do system message |
| `telemetry.js` | Telemetria do SDK |
| `tools.js` | Tools nativas do SDK |
| `tools-registry.js` | Registry de tools do SDK |
| `tools-state.js` | Estado das tools |
| `types.js` | Tipos do SDK |
| `utils.js` | Utilitários do SDK |
| `index.js` | Barrel |
| `README.md` | Documentação |

**Problema**: `sdk/` tem 41 arquivos sem subdivisão clara além de `models/`. Candidato a divisão em `sdk/session/`, `sdk/tools/`, `sdk/rpc/`.

---

## 18. `server/` — Servidor HTTP (23 arquivos — NOVO CANÔNICO)

**O que é**: Layer de transporte canônico — Express + Socket.IO. Criado nas Ondas 3.0–3.9.

**Quem usa**: `terminal/index.js`, `bootstrap.js`

**Depende de**: `#copilot/config`, `#copilot/core`, `#copilot/observability`, `express`, `socket.io`

### `server/middleware/` — Middlewares

| Arquivo | Papel |
|---------|-------|
| `auth.js` | Middleware de autenticação (Bearer token) |
| `cors.js` | Middleware CORS |
| `error-handler.js` | Error handler global Express |
| `rate-limiter.js` | Rate limiting por tipo de rota |
| `rate-limiter-state.js` | Re-export → `terminal/rate-limiter-state.js` — **candidato à migração** |
| `request-id.js` | Injeção de X-Request-ID |

### `server/routes/` — Routers Express

| Arquivo | Papel |
|---------|-------|
| `agent.js` | Rotas do agente: /status, /health, /inject, /pipeline, /dialog/* |
| `config.js` | Rotas de config: GET/PUT /config, /config/skills, /config/tools |
| `git.js` | Rotas Git + GitHub: /git/status, /gh/issues, /gh/prs |
| `health.js` | Health: GET /health, /hub-health, /ws/info |
| `memory.js` | Memórias: GET/POST /memory, DELETE /memory/:id |
| `observability.js` | Observabilidade: /metrics, /errors, /history, /audit |

### `server/socket/` — Socket.IO

| Arquivo | Papel |
|---------|-------|
| `hub-ns.js` | Namespace `/hub` do Socket.IO — canônico (Onda 3.2–3.3) |
| `index.js` | Factory `createCopilotSocket` |

### `server/sse/` — SSE Utilities (Canônico — Onda 3.5–3.6)

| Arquivo | Papel |
|---------|-------|
| `fanout.js` | `EventFanout` + `eventFanout` singleton |
| `index.js` | Barrel |
| `replay-buffer.js` | `SseReplayBuffer` — circular buffer de eventos |
| `state.js` | Re-export → `terminal/state.js` (getSseClients, etc.) |
| `utils.js` | `SseConnectionTracker`, `createSseWriter`, `standardizeSsePayload` |

### `server/` (raiz)

| Arquivo | Papel |
|---------|-------|
| `app.js` | Cria e configura o app Express (middlewares globais) |
| `handler-bridge.js` | Bridge entre request HTTP e handlers de terminal |
| `index.js` | `startCopilotServer()` — entry point canônico |
| `router.js` | `mountCopilotRoutes()` — monta todos os routers |

---

## 19. `services/` — Serviços de Aplicação (6 arquivos)

**O que é**: Camada de serviços — fachadas de alto nível que aglutinam múltiplos módulos.

**Quem usa**: `api/bridge/` (15 arquivos), `api/express/` (20 arquivos), `terminal/commands/` (14 arquivos)

**Depende de**: `#copilot/agent`, `#copilot/conversation-hub`, `#copilot/channel`

| Arquivo | Papel |
|---------|-------|
| `audit-service.js` | Serviço de auditoria (wraps audit pipeline) |
| `conversation-service.js` | Serviço de conversação (wraps conversation-hub) |
| `di-tokens.js` | DI tokens |
| `session-service.js` | Serviço de sessão (CRUD de sessões SDK) |
| `tool-service.js` | Serviço de tools (gestão de tools disponíveis) |
| `index.js` | Barrel — inclui re-exports de `agent/`, `conversation-hub/`, `channel/` |

**Problema**: `services/` não é consumida por `server/routes/` diretamente — os routes acessam domínio via handler-bridge ou diretamente. A camada de serviço existe mas não está no path crítico do transport novo.

---

## 20. `terminal/` — UI Terminal (47 arquivos)

**O que é**: Interface de usuário via REPL — comandos interativos, display, handlers HTTP-to-REPL.

**Quem usa**: `bootstrap.js` (entry point)

**Depende de**: Praticamente tudo — `#copilot/core`, `#copilot/config`, `#copilot/observability`, `#copilot/services`, `agent/`, `conversation-hub/`, `server/`, `sdk/`

### `terminal/commands/` — Comandos do REPL

| Arquivo | Papel |
|---------|-------|
| `alias.js` | Comando /alias — gerencia aliases de comandos |
| `attach.js` | Comando /attach — attach a sessão existente |
| `audit.js` | Comando /audit — mostra log de auditoria |
| `config.js` | Comando /config — mostra e altera configurações |
| `context.js` | Comando /context — gerencia context files |
| `diagnose.js` | Comando /diagnose — diagnóstico do sistema |
| `display.js` | Utilitários de display (formatação de saída) |
| `errors.js` | Comando /errors — mostra histórico de erros |
| `export.js` | Comando /export — exporta sessão para arquivo |
| `gh.js` | Comando /gh — interação com GitHub |
| `git.js` | Comando /git — operações Git |
| `help.js` | Comando /help |
| `memory.js` | Comando /memory — gerencia memórias persistidas |
| `metrics.js` | Comando /metrics — mostra métricas do sistema |
| `plan.js` | Comando /plan — modo de planejamento |
| `resume.js` | Comando /resume — retoma sessão de snapshot |
| `search.js` | Comando /search — busca no histórico |
| `session.js` | Comando /session — info e gestão de sessão |
| `skills.js` | Comando /skills — gerencia skills |
| `thinking.js` | Comando /thinking — modo deep thinking |
| `tools.js` | Comando /tools — lista e gerencia tools |
| `usage.js` | Comando /usage — mostra uso de tokens |
| `index.js` | Barrel e dispatcher de comandos |

### `terminal/dialog/` — Display de Diálogo

| Arquivo | Papel |
|---------|-------|
| `engine.js` | Engine do dialog loop do terminal |
| `engine-persistence.js` | Persistência do estado do engine |
| `output.js` | Formatação de output do diálogo |
| `sse.js` | Envio de eventos SSE pelo terminal |
| `turn-display.js` | Display de um turno de diálogo |
| `index.js` | Barrel |

### `terminal/handlers/` — HTTP → Terminal Handlers

| Arquivo | Papel |
|---------|-------|
| `agent.js` | Handler de rotas do agente (bridge HTTP → REPL) |
| `dialog.js` | Handler de rotas de dialog |
| `shared.js` | Utilities compartilhadas dos handlers |
| `system-config.js` | Handler de rotas de configuração |
| `system-metrics.js` | Handler de rotas de métricas/observabilidade |
| `index.js` | Barrel |

### `terminal/` (raiz)

| Arquivo | Papel |
|---------|-------|
| `alias-store.js` | Persistência de aliases do REPL |
| `bootstrap.js` | Bootstrap do terminal — entry canônico |
| `dialog.js` | API pública de dialog do terminal |
| `di-wiring.js` | Wiring DI do terminal |
| `file-context.js` | Gestão de arquivos de contexto |
| `index.js` | `startCopilotServer()` delegante → `server/index.js` |
| `rate-limiter-state.js` | Estado de rate limiters — compartilhado com server/ |
| `repl.js` | REPL principal (readline loop) |
| `repl-listeners.js` | Listeners do REPL (eventos do agente → output) |
| `state.js` | Estado compartilhado do terminal (SSE clients, replay buffer, etc.) |
| `terminal-agent-wiring.js` | Wiring entre terminal e agente |
| `workspace-context.js` | Contexto do workspace para o agente |
| `README.md` | Documentação |

---

## 21. `tools/` — Ferramentas do Agente (28 arquivos)

**O que é**: Implementação de todas as ferramentas disponíveis ao agente — file, git, shell, todo, hub.

**Quem usa**: `agent/infra/tools-bootstrap.js`, `hooks/`

**Depende de**: `#copilot/core`, `#copilot/config`, `#copilot/observability`, `bridges/`, `audit/`

### `tools/file/` — Ferramentas de Arquivo

| Arquivo | Papel |
|---------|-------|
| `read-tools-io.js` | I/O de leitura de arquivos |
| `read-tools-search.js` | Busca em arquivos (grep, regex) |
| `read-tools.js` | Ferramentas de leitura completas |
| `shared.js` | Utilities de file tools |
| `write-tools.js` | Ferramentas de escrita |
| `index.js` | Barrel |

### `tools/git/` — Ferramentas Git

| Arquivo | Papel |
|---------|-------|
| `index.js` | Tools Git — delegam a `bridges/git-bridge.js` |

### `tools/shell/` — Ferramentas Shell

| Arquivo | Papel |
|---------|-------|
| `executor.js` | Execução de comandos shell com sandbox |
| `sandbox.js` | Restrições de sandbox (blocklist de comandos) |
| `index.js` | Barrel |

### `tools/todo/` — Ferramentas Todo

| Arquivo | Papel |
|---------|-------|
| `bulk-tools.js` | Operações em lote sobre todos |
| `crud-tools.js` | CRUD básico de todos |
| `query-tools.js` | Queries e filtros de todos |
| `store.js` | Store de todos (leitura/escrita) |
| `todo-schema.js` | Schema de validação do todo |
| `todo-write-tools.js` | Ferramentas de escrita específicas |
| `index.js` | Barrel |

### `tools/` (raiz)

| Arquivo | Papel |
|---------|-------|
| `code-tools.js` | Ferramentas de análise e manipulação de código |
| `hook-tools.js` | Ferramentas de gestão de hooks |
| `hub-tools.js` | Ferramentas de interação com conversation hub |
| `introspection-tools.js` | Ferramentas de introspecção do sistema |
| `permission-tools.js` | Ferramentas de gestão de permissões |
| `session-rpc-tools.js` | Ferramentas de RPC de sessão |
| `session-tools.js` | Ferramentas de gestão de sessão |
| `task-tools.js` | Ferramentas de gestão de tasks |
| `tool-factory.js` | Factory de tools (valida, decora, registra) |
| `web-tools.js` | Ferramentas web (fetch, scrape) |
| `index.js` | Barrel |
| `README.md` | Documentação |

---

## 22. `types/` — Tipos Globais (2 arquivos)

**O que é**: Tipos JSDoc globais partilhados entre módulos.

| Arquivo | Papel |
|---------|-------|
| `events.js` | Tipos de eventos (EventPayload, EventMetadata) |
| `index.js` | Barrel |
| `README.md` | Documentação |

---

## SUMÁRIO DE PROBLEMAS IDENTIFICADOS

| ID | Problema | Módulo | Severidade |
|----|----------|--------|------------|
| P1 | `api/bridge/` sem consumidor em `server/` | `api/bridge/` | 🟡 Médio |
| P2 | `api/express/` sem consumidor em `server/` | `api/express/` | 🟡 Médio |
| P3 | `services/` não no path crítico do transport | `services/` | 🟡 Médio |
| P4 | `terminal/state.js` mistura SSE state + terminal state | `terminal/` | 🟡 Médio |
| P5 | `terminal/rate-limiter-state.js` ainda não migrada para `server/` | `terminal/` | 🟡 Baixo |
| P6 | `sdk/` com 41 arquivos sem subdivisão por domínio | `sdk/` | 🟡 Baixo |
| P7 | `conversation-hub/hub.js` ainda tem `initStandalone()` @deprecated | `conversation-hub/` | 🟡 Baixo |
| P8 | `server/routes/` falta routers: sse.js, sessions.js, sdk.js | `server/` | 🔴 Alto |
| P9 | `infra/` com apenas 1 arquivo — vestigial | `infra/` | 🟢 Cosmético |
| P10 | `logs/` contém runtime data misturado com source | `logs/` | 🟢 Cosmético |
| P11 | `server/middleware/rate-limiter-state.js` re-exporta de `terminal/` | `server/` | 🟡 Baixo |
| P12 | `agent/facades/` duplica responsabilidades de `services/` | `agent/` | 🟡 Baixo |
