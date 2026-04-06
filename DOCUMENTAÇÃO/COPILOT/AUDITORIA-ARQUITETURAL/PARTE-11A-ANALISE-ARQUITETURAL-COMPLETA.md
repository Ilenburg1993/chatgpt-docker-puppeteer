# PARTE 11A — Análise Arquitetural Completa de `src/copilot`

**Data**: 2026-07-21
**Escopo**: Mapeamento exaustivo de pastas, arquivos, responsabilidades, fronteiras e relações.
**Tamanho total**: ~42.600 linhas em ~170 arquivos JS.

---

## 1. Mapa de Diretórios (Visão Geral)

```
src/copilot/                          (raiz — sem arquivos próprios)
├── agent/                            (5 + 25 subdir files = 30)   — 6.787 lines
│   ├── dialog/                       (5 files)                    — 1.343 lines
│   ├── infra/                        (9 files)                    — 1.438 lines
│   ├── lifecycle/                    (4 files)                    — 555 lines
│   └── session/                      (7 files)                    — 1.532 lines
├── api/                              (9 files)                    — 1.289 lines
├── bridges/                          (5 + 5 gh/ = 10 files)       — 2.330 lines
│   └── gh/                           (5 files)                    — 770 lines
├── channel/                          (3 files)                    — 1.354 lines
├── config/                           (6 + 3 tools/ = 9 files)     — 1.587 lines
│   └── tools/                        (3 files)                    — 386 lines
├── conversation-hub/                 (6 files)                    — 2.305 lines
├── core/                             (4 files)                    — 365 lines
├── db/                               (2 files)                    — 382 lines
├── hooks/                            (13 + 6 presets/ = 19 files) — 3.634 lines
│   └── presets/                      (6 files)                    — 850 lines
├── lib/                              (13 files)                   — 2.581 lines
├── logs/                             (0 files — diretório vazio)  — 0 lines
├── observability/                    (10 files)                   — 4.453 lines
├── routes/                           (7 files)                    — 1.629 lines
├── terminal/                         (15 + 23 commands/ = 38)     — 7.276 lines
│   └── commands/                     (23 files)                   — 2.473 lines
├── tools/                            (11 + 10 subdir = 21 files)  — 5.894 lines
│   ├── file/                         (4 files)                    — 890 lines
│   ├── git/                          (1 file)                     — 272 lines
│   ├── shell/                        (1 file)                     — 713 lines
│   └── todo/                         (5 files)                    — 1.537 lines
└── types/                            (3 files)                    — 522 lines
```

**Top 5 maiores subdiretórios** (incluindo subdirs):

1. `terminal/` — 7.276 lines (17% do total)
2. `agent/` — 6.787 lines (16%)
3. `tools/` — 5.894 lines (14%)
4. `observability/` — 4.453 lines (10%)
5. `hooks/` — 3.634 lines (9%)

---

## 2. Responsabilidades por Módulo

### 2.1 `core/` — Contratos Centrais (365 lines, 4 files)

Camada de contratos puros sem lógica de negócio. Define o "vocabulário" compartilhado por todos os
módulos.

| Arquivo | Linhas | Responsabilidade |
| --- | --- | --- |
| `constants.js` | 104 | Portas, limites, nomes de eventos canônicos |
| `errors.js` | 63 | CopilotError, SessionError, BridgeError (hierarquia de erros) |
| `agent-events.js` | 173 | Constantes de eventos do AlwaysAliveAgent (AGENT_EVENTS, DIALOG_LOOP_EVENTS) |
| `index.js` | 25 | Barrel |

**Fronteira**: nenhum módulo deve depender de core/ para lógica — apenas para nomes e tipos.

**Problemas identificados**:

- `constants.js` contém `@deprecated` e tem overlap parcial com `agent-events.js` (re-exporta
  eventos)
- `agent-events.js` foi movido de `agent/events.js` (R9), mas `agent/events.js` ainda existe como
  re-export de compatibilidade

### 2.2 `types/` — Tipagem Compartilhada (522 lines, 3 files)

| Arquivo | Linhas | Responsabilidade |
| --- | --- | --- |
| `sdk.js` | 112 | Re-export centralizado de tipos do `@github/copilot-sdk` (puro barrel JSDoc) |
| `structured-message.js` | 387 | Schema canônico de comunicação LLM-A ↔ LLM-B (StructuredMessage) |
| `index.js` | 23 | Barrel |

**Status**: bem isolado, sem overlap.

### 2.3 `db/` — Persistência SQLite (382 lines, 2 files)

| Arquivo | Linhas | Responsabilidade |
| --- | --- | --- |
| `sqlite.js` | 188 | Singleton SQLite isolado (copilot.sqlite) separado do maestro.sqlite principal |
| `migrations.js` | 194 | Migrations versionadas para schema copilot |

**Status**: limpo, isolado, sem overlap.

### 2.4 `lib/` — Biblioteca Utilitária SDK (2.581 lines, 13 files)

Coleção de funções utilitárias e abstrações pure-function sobre o Copilot SDK. **Módulo problemático
— contém 3 arquivos deprecated e overlap significativo com outros módulos.**

| Arquivo | Linhas | Responsabilidade | Status |
| --- | --- | --- | --- |
| `sdk-client.js` | 300 | Singleton CopilotClient, registry de sessões | Ativo |
| `session.js` | 203 | Operações de sessão SDK (create/resume/list/delete) | Ativo |
| `model-registry.js` | 519 | Multi-Model Selection Pool (F40) | Ativo |
| `models.js` | 367 | Helpers de listagem/roteamento de modelos | Ativo |
| `tools-registry.js` | 295 | Registry de Custom Tools por categoria/tags | Ativo |
| `event-helpers.js` | 104 | waitForEvent, waitForCondition (EventEmitter utils) | Ativo |
| `http-request.js` | 80 | Helper HTTP interno (loopback) | Ativo |
| `url-validator.js` | 155 | Validação SSRF (OWASP A10) | Ativo |
| `utils.js` | 98 | pickDefined() e utilitários gerais | Ativo |
| `agents.js` | 108 | Factory de CustomAgentConfig | Ativo |
| `index.js` | 63 | Barrel | Ativo |
| `permissions.js` | 28 | **@deprecated** Re-export → hooks/permission-handler | Eliminar |
| `hooks.js` | 20 | **@deprecated** Re-export → hooks/factory | Eliminar |

**Problemas identificados**:

- **`permissions.js`** e **`hooks.js`**: deprecated re-exports que devem ser eliminados
- **`tools-registry.js`** vs **`config/tools/registry.js`**: nomes similares, responsabilidades
  diferentes (um é registry em memória por categoria, outro é persistência JSON de custom tools
  declarativas), mas confusos
- **`model-registry.js`** (519 lines) + **`models.js`** (367 lines) = 886 lines sobre modelos —
  overlap parcial

### 2.5 `config/` — Configuração SDK (1.587 lines, 9 files)

| Arquivo | Linhas | Responsabilidade |
| --- | --- | --- |
| `session-config.js` | 185 | Builder de SessionConfig (factories: always-alive, read-only, full) |
| `system-prompt.js` | 239 | Builders de system prompt para LLM-B |
| `custom-agents.js` | 325 | Perfis de agentes customizados (@modo) |
| `pinned-files-loader.js` | 268 | Carrega e monitora arquivos de contexto "pinned" |
| `mcp-servers.js` | 139 | Config de servidores MCP |
| `index.js` | 45 | Barrel |
| `tools/registry.js` | 276 | Custom Tools declarativas persistidas em JSON |
| `tools/state.js` | 99 | Estado allowlist/denylist de tools |
| `tools/index.js` | 11 | Barrel |

**Problemas identificados**:

- `pinned-files-loader.js` (268 lines) faz fs.watch + parse — poderia ser melhor
  categorizado
- Naming confuso: `config/tools/registry.js` ≠ `lib/tools-registry.js` (propósitos diferentes)

### 2.6 `hooks/` — Sistema de Hooks SDK (3.634 lines, 19 files)

| Arquivo | Linhas | Responsabilidade |
| --- | --- | --- |
| `permission-handler.js` | 280 | Factory de PermissionHandler (whitelist/blacklist/audit) |
| `factory.js` | 250 | Factory de SessionHooks compostos |
| `composer.js` | 244 | Composição funcional de handlers (pipeline/chain/conditional) |
| `bus.js` | 198 | HookBus (EventEmitter para observação sem acoplamento) |
| `audit.js` | 224 | Buffer de auditoria de tool calls via onPostToolUse |
| `registry.js` | 155 | HookRegistry (introspecção de hooks disponíveis) |
| `tool-interceptor.js` | 170 | Interceptação pre/post tool use |
| `session-lifecycle.js` | 290 | Lifecycle hooks de sessão (onSessionCreate, etc.) |
| `error-handler.js` | 125 | Hook de tratamento de erros |
| `prompt-transformer.js` | 128 | Transformação de prompts antes de envio |
| `user-input.js` | 100 | Hook de input do usuário |
| `types.js` | 220 | Typedefs centralizados do hooks system |
| `index.js` | 60 | Barrel |
| **presets/** | | |
| `presets/production.js` | 220 | Preset production (completo) |
| `presets/audit.js` | 160 | Preset audit-only |
| `presets/safe.js` | 120 | Preset safe |
| `presets/interactive.js` | 130 | Preset interativo |
| `presets/minimal.js` | 100 | Preset minimal |
| `presets/deny-all.js` | 120 | Preset deny-all |

**Problemas identificados**:

- **`hooks/audit.js`** vs **`observability/audit-log.js`**: dois sistemas de auditoria paralelos
  (hooks registra tool calls via onPostToolUse; observability registra em JSONL com I/O)
- **`agent/infra/tool-audit-logger.js`**: terceiro ponto de auditoria de tools — gera overlap
  triplo

### 2.7 `observability/` — Observabilidade & Telemetria (4.453 lines, 10 files)

| Arquivo | Linhas | Responsabilidade |
| --- | --- | --- |
| `event-collector.js` | 1.411 | Coletor central de eventos (SDK + agent + hooks) |
| `agent-event-observer.js` | 945 | Observer que conecta AlwaysAliveAgent events → telemetria |
| `metrics.js` | 551 | Métricas agregadas (tokens, latência, p95/p99) |
| `audit-log.js` | 377 | Ring buffer + JSONL I/O de auditoria |
| `logger.js` | 270 | Logger central (console + ring buffer) |
| `error-alerting.js` | 233 | Detecção e alertas de padrões de erro |
| `error-tracker.js` | 232 | Ring buffer de erros recentes |
| `otel.js` | 224 | OpenTelemetry spans/tracer |
| `tool-stats.js` | 163 | Estatísticas de uso de tools por nome |
| `index.js` | 47 | Barrel |

**Problemas identificados**:

- **`event-collector.js`** (1.411 lines) é o maior arquivo depois de `always-alive.js` — God Module
  de observabilidade
- **`agent-event-observer.js`** (945 lines) — segundo maior, faz bridging de eventos do agent →
  métricas/OTel
- `audit-log.js` overlap com `hooks/audit.js` (ver §2.6)
- `tool-stats.js` overlap parcial com `metrics.js` (ambos rastream uso de tools)

### 2.8 `agent/` — AlwaysAliveAgent (6.787 lines, 30 files)

O núcleo do sistema. Já reestruturado (R1-R18) em subdiretórios.

| Subdir/Arquivo | Linhas | Responsabilidade |
| --- | --- | --- |
| `always-alive.js` | 1.613 | Classe AlwaysAliveAgent (orchestrator principal) |
| `config.js` | 151 | Configuração centralizada por env vars |
| `events.js` | 13 | Re-export de compatibilidade → core/agent-events |
| `types.js` | 122 | Typedefs centralizados do agent |
| `index.js` | 20 | Barrel |
| **dialog/** | 1.343 | Dialog loop (turnos de conversação SDK) |
| **session/** | 1.532 | Gestão de sessão SDK (init, cleanup, keepalive, rotation, snapshot) |
| **lifecycle/** | 555 | Entry point PM2, state I/O, reconnect policy |
| **infra/** | 1.438 | Queue, tools, webhooks, permissions, handoff, audit, status |

**Problemas identificados**:

- `always-alive.js` (1.613 lines) — ainda é God Class, apesar de extrações
- `events.js` — re-export de compatibilidade que pode ser eliminado
- `infra/tool-audit-logger.js` — tem overlap com `hooks/audit.js` e
  `observability/audit-log.js`

### 2.9 `api/` — HTTP Bridge REST (1.289 lines, 9 files)

Expõe o AlwaysAliveAgent via API REST em `/api/copilot/*`.

| Arquivo | Linhas | Responsabilidade |
| --- | --- | --- |
| `bridge-control.js` | 273 | Rotas de controle: status, health, session, start, stop |
| `bridge-dialog.js` | 151 | Rotas de dialog loop: start, turn, stop |
| `bridge-stream.js` | 183 | SSE (Server-Sent Events) push |
| `bridge-tasks.js` | 148 | Rotas de tarefas: send, answer |
| `sse-utils.js` | 294 | Helpers SSE compartilhados |
| `sse-replay-buffer.js` | 67 | Buffer circular para replay SSE |
| `event-fanout.js` | 94 | Fanout de eventos (pass-through local, extensível) |
| `http-bridge.js` | 40 | Agregador de sub-módulos de rota |
| `sdk-api.js` | 39 | Orquestrador Express que monta sub-routers |

**Problemas identificados**:

- **`api/` vs `routes/`**: dois diretórios com rotas HTTP para a mesma API
  - `api/` = rotas do bridge HTTP raw (sem Express) em `/api/copilot/*`
  - `routes/` = rotas Express em `/api/sdk/*`
  - Overlap funcional significativo: ambos expõem status, session, tools

### 2.10 `routes/` — Rotas Express SDK (1.629 lines, 7 files)

Rotas Express montadas em `/api/sdk/*` via `sdk-api.js`.

| Arquivo | Linhas | Responsabilidade |
| --- | --- | --- |
| `agent.js` | 240 | Info, tools, telemetria, estado do agente |
| `sessions.js` | 390 | CRUD de sessões SDK |
| `hooks.js` | 160 | Introspecção de hooks |
| `webhooks.js` | 120 | CRUD de webhooks |
| `client.js` | 340 | Controle CopilotClient (ping, status, auth, models) |
| `observability.js` | 220 | Health, métricas, erros, logs de observabilidade |
| `middleware.js` | 159 | Error wrapper, validação |

**Overlap com `api/`**:

| Funcionalidade | `api/bridge-*` | `routes/*` |
| --- | --- | --- |
| Status do agente | `bridge-control.js` | `agent.js` |
| Gerenciar sessão | `bridge-control.js` | `sessions.js` |
| Dialog loop | `bridge-dialog.js` | (não presente) |
| Webhooks | `bridge-tasks.js` | `webhooks.js` |
| SSE streaming | `bridge-stream.js` | `agent.js` (SSE stream) |

### 2.11 `bridges/` — Pontes Externas (2.330 lines, 10 files)

| Arquivo | Linhas | Responsabilidade |
| --- | --- | --- |
| `nerv-bridge.js` | 385 | Bridge agent ↔ NERV event bus |
| `mcp-tool-bridge.js` | 529 | Bridge MCP Tool Registry → SDK Custom Tools |
| `git-bridge.js` | 402 | Git CLI wrapper (execFile seguro) |
| `alias-store.js` | 200 | Aliases do terminal REPL |
| `gh-bridge.js` | 44 | **@deprecated** barrel → `gh/index.js` |
| **gh/** | 770 | GitHub CLI bridge (issues, PRs, CI) |

**Problemas identificados**:

- `alias-store.js` deveria estar em `terminal/` (é exclusivo do REPL)
- `gh-bridge.js` deprecated — pode ser eliminado

### 2.12 `channel/` — Comunicação LLM-A ↔ LLM-B (1.354 lines, 3 files)

| Arquivo | Linhas | Responsabilidade |
| --- | --- | --- |
| `client.js` | 729 | LLM Bridge Client (alto nível, streaming, delta) |
| `inject.js` | 546 | Canal oficinal via POST /inject ao terminal server |
| `index.js` | 79 | Barrel + factory |

**Status**: coeso, sem overlap significativo.

### 2.13 `conversation-hub/` — Ambiente Permanente LLM-A ↔ LLM-B (2.305 lines, 6 files)

| Arquivo | Linhas | Responsabilidade |
| --- | --- | --- |
| `store.js` | 737 | ConversationStore (SQLite + FTS5) |
| `orchestrator.js` | 646 | HubOrchestrator (gerencia diálogo, persiste turnos) |
| `socket-ns.js` | 466 | Namespace Socket.io /copilot |
| `store-helpers.js` | 162 | Helpers FTS5 e inicialização |
| `hub.js` | 281 | ConversationHub singleton |
| `index.js` | 13 | Barrel |

**Problemas identificados**:

- `store.js` (737 lines) + `store-helpers.js` (162 lines) — grande
- `orchestrator.js` (646 lines) importa de `channel/client.js` —
  acoplamento com channel

### 2.14 `terminal/` — Terminal Permanente LLM-B (7.276 lines, 38 files)

**O maior subsistema.** Terminal REPL interativo + servidor HTTP de injeção.

| Arquivo | Linhas | Responsabilidade |
| --- | --- | --- |
| `dialog.js` | 944 | Motor de diálogo (ensureDialogLoop, sendTurn) |
| `index.js` | 471 | Orquestrador de inicialização |
| `repl.js` | 574 | Interface readline REPL |
| `server.js` | 438 | Servidor HTTP raw (node:http, porta 3009) |
| `handlers-system.js` | 722 | Handlers HTTP de sistema (health, config, metrics, git, gh) |
| `handlers-agent.js` | 332 | Handlers de agente/dialog (/pipeline, /inject) |
| `file-context.js` | 378 | Leitura/embedding de contexto de arquivo |
| `route-table.js` | 271 | Tabela declarativa de rotas |
| `state.js` | 268 | Estado global compartilhado |
| `handlers-dialog.js` | 161 | Handlers de sessão/memória/turnos |
| `workspace-context.js` | 92 | Detecção de workspace (cwd, git root, branch) |
| `http-handlers.js` | 59 | **@deprecated** barrel → handlers-*.js |
| `bootstrap.js` | 34 | **@deprecated** wrapper → index.js |
| `rate-limiter-state.js` | 34 | Bridge para reset de rate limiters |
| `handlers-shared.js` | 16 | Tipos compartilhados |
| **commands/** | 2.473 | 23 comandos REPL (/help, /git, /gh, /status, etc.) |

**Problemas identificados**:

- `dialog.js` (944 lines) — God Module do terminal, duplica conceito de dialog loop do
  `agent/dialog/`
- `handlers-system.js` (722 lines) — God Module de handlers HTTP
- 2 deprecated files que devem ser eliminados
- `state.js` importa de `api/sse-replay-buffer.js` — dependência cruzada estranha

### 2.15 `tools/` — Custom Tools SDK (5.894 lines, 21 files)

| Arquivo | Linhas | Responsabilidade |
| --- | --- | --- |
| `tool-factory.js` | 161 | Factory genérica de tools |
| `index.js` | 81 | Registry centralizado |
| `code-tools.js` | 143 | lint, typecheck, test |
| `hook-tools.js` | 329 | Auditoria hooks + request_user_input |
| `hub-tools.js` | 344 | ConversationHub tools |
| `introspection-tools.js` | 419 | Introspecção do agente |
| `permission-tools.js` | 164 | Controle runtime de permissões |
| `session-rpc-tools.js` | 295 | RPCs do SDK |
| `session-tools.js` | 196 | Estado da sessão hook system |
| `task-tools.js` | 154 | Gerenciamento de tarefas |
| `web-tools.js` | 396 | Acesso web com SSRF protection |
| **file/** | 890 | read_file, write_file, list_dir, etc. |
| **git/** | 272 | git tools |
| **shell/** | 713 | Shell execution tools |
| **todo/** | 1.537 | Sistema de tarefas completo (CRUD, bulk, query, store) |

**Status**: bem organizado em subdirs. `todo/store.js` é um mini-sistema independente.

---

## 3. Mapa de Dependências Inter-Módulo

### 3.1 Grafo de Dependências (módulos de alto nível)

```
core/  ←── quase todos importam
types/ ←── channel, core
db/    ←── conversation-hub/store, tools/todo/store

                        ┌─────────────────────┐
                        │     agent/           │
                        │  (AlwaysAliveAgent)  │
                        └─────┬───┬───┬───┬───┘
                              │   │   │   │
          ┌───────────────────┤   │   │   ├──────────────────────┐
          │                   │   │   │   │                      │
          ▼                   ▼   │   ▼   ▼                      ▼
    bridges/            config/   │  hooks/               observability/
    (nerv, mcp,         (session, │  (factory,             (logger, metrics,
     git, gh)           prompt,   │   presets,              audit, events,
                        agents)   │   bus)                  otel)
                                  │
                                  ▼
                              lib/
                         (sdk-client,
                          session, models,
                          tools-registry)

    conversation-hub/ ←── channel/ ←── terminal/

    api/ ──→ agent/, routes/
    routes/ ──→ agent/, lib/, hooks/, observability/
    terminal/ ──→ agent/, channel/, conversation-hub/, bridges/, config/

    tools/ ──→ lib/, observability/, hooks/
```

### 3.2 Dependências Circulares Potenciais

- `terminal/state.js` → `api/sse-replay-buffer.js` (terminal depende de api)
- `hooks/presets/production.js` → `tools/introspection-tools.js` (hooks depende de tools)
- `agent/infra/tools-bootstrap.js` → `tools/index.js` (agent depende de tools)
- `observability/event-collector.js` → `hooks/audit.js` (observability depende de hooks)

### 3.3 Acoplamentos Problemáticos

1. **`always-alive.js`** importa de 12 módulos externos — alta fan-out
2. **`terminal/dialog.js`** importa de 6 módulos externos — alta fan-out
3. **`terminal/handlers-system.js`** importa de 9 módulos externos
4. **`terminal/index.js`** importa de 7 módulos externos

---

## 4. Arquivos @deprecated Pendentes de Remoção

| Arquivo | Deprecado em | Substituto |
| --- | --- | --- |
| `lib/permissions.js` | N.4 | `hooks/permission-handler.js` |
| `lib/hooks.js` | N.3 | `hooks/factory.js` |
| `bridges/gh-bridge.js` | F33.1 | `bridges/gh/index.js` |
| `terminal/bootstrap.js` | F33.1 | `terminal/index.js` |
| `terminal/http-handlers.js` | F33.1 | `terminal/handlers-*.js` |
| `agent/events.js` | R9 | `core/agent-events.js` |

Total: **6 arquivos deprecated** que podem ser eliminados após redirect de importadores.

---

## 5. God Modules (>400 lines, alta complexidade)

| Arquivo | Linhas | Problema |
| --- | --- | --- |
| `agent/always-alive.js` | 1.613 | Orchestrator principal, 35+ métodos, 262 refs a campos privados |
| `observability/event-collector.js` | 1.411 | Mega-coletor de eventos monolítico |
| `observability/agent-event-observer.js` | 945 | Bridge massivo agent→telemetria |
| `terminal/dialog.js` | 944 | Motor de diálogo do terminal |
| `conversation-hub/store.js` | 737 | ConversationStore SQLite |
| `channel/client.js` | 729 | LLM Bridge Client |
| `terminal/handlers-system.js` | 722 | God handler HTTP |
| `terminal/repl.js` | 574 | Interface REPL |
| `agent/session/event-wirer.js` | 591 | Fiação de eventos SDK |
| `agent/dialog/loop-manager.js` | 661 | Dialog loop manager |
| `conversation-hub/orchestrator.js` | 646 | Hub orchestrator |
| `observability/metrics.js` | 551 | Métricas |
| `channel/inject.js` | 546 | Canal de injeção |
| `bridges/mcp-tool-bridge.js` | 529 | MCP bridge |
| `lib/model-registry.js` | 519 | Model registry |
| `conversation-hub/socket-ns.js` | 466 | Socket.io namespace |
| `terminal/index.js` | 471 | Orquestrador terminal |
| `tools/todo/crud-tools.js` | 459 | CRUD tools |
| `terminal/server.js` | 438 | HTTP server raw |
| `tools/introspection-tools.js` | 419 | Introspecção |
| `bridges/git-bridge.js` | 402 | Git bridge |

---

## 6. Redundâncias e Overlaps Identificados

### 6.1 Auditoria Tripla

Três módulos fazem auditoria de tool calls com sobreposição:

1. **`hooks/audit.js`** — AuditRingBuffer em memória via onPostToolUse
2. **`observability/audit-log.js`** — Ring buffer + JSONL I/O com rotação
3. **`agent/infra/tool-audit-logger.js`** — JSONL em `logs/tool-permissions-audit.jsonl`

**Situação ideal**: unificar em um único pipeline de auditoria.

### 6.2 Rotas HTTP Duplicadas

- **`api/`** (HTTP bridge raw, porta 3008) e **`routes/`** (Express, `/api/sdk/*`) expõem endpoints
  similares para o mesmo agente
- **`terminal/server.js`** (HTTP raw, porta 3009) é um terceiro servidor HTTP

### 6.3 Tool Registries Confusos

- **`lib/tools-registry.js`**: Registry em memória de tools por categoria
- **`config/tools/registry.js`**: Custom tools declarativas persistidas em JSON
- **`config/tools/state.js`**: Estado allowlist/denylist de tools

Três lugares para gerenciar tools.

### 6.4 Model Management Disperso

- **`lib/model-registry.js`** (519 lines): ModelRegistry, ModelSelector, ModelStatsTracker
- **`lib/models.js`** (367 lines): Helpers de listagem/roteamento

### 6.5 Session Management Espalhado

- **`lib/session.js`**: Operações SDK (create/resume/list/delete)
- **`lib/sdk-client.js`**: Singleton CopilotClient + session registry
- **`agent/session/`**: Lifecycle completo (init, cleanup, keepalive, rotation, snapshot, events)
- **`config/session-config.js`**: Builder de SessionConfig

### 6.6 Deprecated Re-exports

- `lib/permissions.js` → `hooks/permission-handler.js`
- `lib/hooks.js` → `hooks/factory.js`
- `bridges/gh-bridge.js` → `bridges/gh/index.js`
- `agent/events.js` → `core/agent-events.js`
- `terminal/bootstrap.js` → `terminal/index.js`
- `terminal/http-handlers.js` → `terminal/handlers-*.js`

### 6.7 `process.env` Espalhados

41 arquivos leem `process.env` diretamente fora do `agent/config.js`. A centralização que fizemos
em R15 foi apenas para `agent/`. O resto do sistema não tem config centralizada.

---

## 7. Fluxos Críticos

### 7.1 Boot do Agente

```
lifecycle/entry.js
  → AlwaysAliveAgent.start()
    → session/initializer.js (initSession)
    → session/event-wirer.js (wireSessionEvents)
    → dialog/loop-manager.js (wire + start loop)
    → infra/tools-bootstrap.js (bootstrapTools)
    → infra/webhook-manager.js (send boot event)
```

### 7.2 Dialog Turn

```
Terminal REPL (input) → terminal/dialog.js (sendTurn)
  → channel/client.js (sendMessage)
    → conversation-hub/orchestrator.js (processMessage)
      → AlwaysAliveAgent dialog loop
        → dialog/loop-manager.js → dialog/turn-executor.js
          → SDK session.sendMessage()
          → session events → session/event-wirer.js
```

### 7.3 HTTP API Request

```
Express → routes/*.js ou api/bridge-*.js
  → agent/index.js (getAgent())
    → method call
  → resposta JSON
```

---

## 8. Métricas de Saúde Arquitetural

| Métrica | Valor | Avaliação |
| --- | --- | --- |
| Total de arquivos JS | 170 | OK |
| Total de linhas | 42.588 | Grande |
| Arquivos deprecated | 6 | Eliminar |
| God Modules (>600 lines) | 11 | Alto — decomposição necessária |
| Overlaps identificados | 7 | Alto — unificação necessária |
| process.env fora de config | 41 | Alto — centralização necessária |
| Diretórios HTTP duplicados | 3 (api, routes, terminal/server) | Confuso |
| Deprecated re-exports | 6 | Eliminar |
| Diretório vazio (logs/) | 1 | Eliminar |
