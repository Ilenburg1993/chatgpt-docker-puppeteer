# PARTE-25A — PRÉ-AUDITORIA ARQUITETURAL PÓS-ONDA 3.x

> **Documento**: PARTE-25A-PRE-AUDITORIA-POS-ONDA3.md
> **Série**: PARTE-25 (nova auditoria arquitetural completa)
> **Data**: 2026-04-13
> **Base**: HEAD = `db7334a7` (Ondas 3.0–3.9 completas)
> **Escopo**: Análise completa de `src/copilot/` — 395 arquivos, 53 diretórios

---

## 1. CONTEXTO: O QUE MUDOU COM AS ONDAS 3.x

### Commits desta série (cronologia reversa)

| Commit | Onda | O que entregou |
|--------|------|----------------|
| `db7334a7` | doc | PARTE-24K: Ondas 3.9 commit final |
| `2dba4b85` | 3.9 | Remoção: terminal/server.js, route-table.js, server/wiring.js |
| `8d8ddefb` | 3.8 | autonomy check: 9 checks |
| `7e07a162` | 3.5–3.7 | SSE para server/sse/, api/sse/ como re-exports, socket-ns como re-export |
| `54f0ba99` | 3.4 | hub @deprecated initStandalone, /ws/info, socket smoke test |
| `37e1946f` | 3.2–3.3 | server/socket/, server/index.js completo, terminal migrado |
| `b01f600e` | 3.0–3.1 | scaffold server/, 5 middlewares, 6 routers |
| `6a9f366e` | 2.7 | Copilot DEV-only, single boot |

### Situação anterior às Ondas 3.x vs. pós-Ondas 3.x

| Aspecto | Antes | Depois |
|---------|-------|--------|
| Servidor HTTP | `terminal/server.js` (stub http nativo) | `server/index.js` (Express + Socket.IO opt-in) |
| Roteamento | `terminal/route-table.js` (map manual) | `server/routes/` (6 Express routers) |
| Socket.IO | `conversation-hub/socket-ns.js` (único) | `server/socket/hub-ns.js` (canônico) |
| SSE utilities | `api/sse/` (implementação real) | `server/sse/` (canônico), `api/sse/` (re-exports) |
| Legados | 3 arquivos com implementação real | 3 arquivos deletados, re-exports donde necessário |
| Boot | `terminal/index.js` via `createInjectServer()` | `terminal/index.js` via `startCopilotServer()` |

---

## 2. INVENTÁRIO QUANTITATIVO

### 2.1 Distribuição por módulo

| Módulo | Arquivos JS | Responsabilidade principal |
|--------|------------|---------------------------|
| `agent/` | 57 | Worker interno: dialog loop, lifecycle, session, state |
| `terminal/` | 47 | UI terminal: REPL, comandos, handlers, dialog display |
| `sdk/` | 41 | Contratos e abstrações de SDK (models, session, tools) |
| `observability/` | 32 | Logging, metrics, tracing, event observers |
| `tools/` | 28 | Ferramentas: file, git, shell, todo, hub, perms |
| `server/` | 23 | HTTP server Express + Socket.IO (novo canônico) |
| `api/` | 21 | Re-exports (sse/), express SDK API, bridge |
| `hooks/` | 20 | Sistema de hooks: bus, registry, presets, interceptor |
| `core/` | 19 | Contratos centrais: DI, event-bus, errors, retry |
| `events/` | 18 | Schemas de eventos, registry, middleware, emitters |
| `conversation-hub/` | 13 | Hub de sessões: orchestrator, store, pipeline, socket |
| `bridges/` | 13 | Git, GitHub, MCP, NERV adapters |
| `audit/` | 9 | Pipeline de auditoria, ring buffer, JSONL writer |
| `channel/` | 8 | Client channels (SSE, inject, dialog, structured) |
| `config/` | 7 | Configuração: env, auth, MCP servers, system prompt |
| `services/` | 6 | Serviços de alto nível: audit, conversation, session, tool |
| `plugins/` | 3 | Plugin registry |
| `db/` | 3 | SQLite: adapter, migrations |
| `types/` | 2 | Tipos globais |
| `infra/` | 1 | DI tokens de infra |

**Total: 395 arquivos JS + 53 diretórios**

---

## 3. GRAFO DE DEPENDÊNCIAS (VISÃO MACRO)

```
                    ┌─────────────────────────────────────┐
                    │  src/copilot/ — Dependências Macro   │
                    └─────────────────────────────────────┘

  CAMADA DE BOOT
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  bootstrap.js → terminal/bootstrap.js → terminal/index.js
                                            │
                    ┌───────────────────────┼───────────────────────┐
                    ▼                       ▼                       ▼
  CAMADA DE INFRA CORE
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ┌──────────┐  ┌──────────┐  ┌─────────────┐  ┌──────────┐
  │  core/   │  │ config/  │  │observability│  │  events/ │
  │(DI, bus, │  │(env, auth│  │(log, metrics│  │(schemas, │
  │ errors)  │  │ prompts) │  │ tracing)    │  │ registry)│
  └──────────┘  └──────────┘  └─────────────┘  └──────────┘
       ▲              ▲              ▲               ▲
       │              │              │               │
  CAMADA DE DOMÍNIO
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ┌──────────┐  ┌──────────┐  ┌─────────────┐  ┌──────────┐
  │   sdk/   │  │  agent/  │  │conversation-│  │  hooks/  │
  │(contratos│  │(loop,    │  │     hub/    │  │(bus,     │
  │ models)  │  │ session) │  │(orch, store)│  │ registry)│
  └──────────┘  └──────────┘  └─────────────┘  └──────────┘
       ▲              ▲              ▲               ▲
       │              │              │               │
  CAMADA DE BRIDGES/ADAPTERS
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ┌──────────┐  ┌──────────┐  ┌─────────────┐  ┌──────────┐
  │ bridges/ │  │ channel/ │  │   tools/    │  │ services/│
  │(git,gh,  │  │(SSE,     │  │(file, shell,│  │(audit,   │
  │ MCP,nerv)│  │ inject)  │  │ todo, hub)  │  │ session) │
  └──────────┘  └──────────┘  └─────────────┘  └──────────┘
       ▲              ▲              ▲               ▲
       │              │              │               │
  CAMADA DE SERVIDOR / TRANSPORTE
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ┌──────────────────────────┐   ┌──────────────────────┐
  │      server/             │   │      api/             │
  │  (Express + Socket.IO)   │   │  (re-exports sse/,   │
  │  middleware + routes     │   │   bridge, express)   │
  │  socket/hub-ns           │   │                      │
  └──────────────────────────┘   └──────────────────────┘
       ▲
  CAMADA DE TERMINAL (UI)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ┌──────────────────────────────────────────────────────┐
  │  terminal/                                           │
  │  REPL + commands/ + dialog/ + handlers/              │
  │  state.js (SSE state) + rate-limiter-state.js        │
  └──────────────────────────────────────────────────────┘
```

### 3.1 Grafo de dependências (referências canônicas — 61 importadores de #copilot/core, 129 de #copilot/observability)

```
  #copilot/observability   ← 129 arquivos  (MAIS importado)
  #copilot/core            ← 61 arquivos
  #copilot/config          ← 42 arquivos
  (api/sse → server/sse)   re-export
  (conversation-hub/socket-ns → server/socket/hub-ns) re-export
```

### 3.2 Módulos órfãos identificados

| Módulo | Status | Evidência |
|--------|--------|-----------|
| `api/bridge/` | **Potencialmente órfão** | 0 importadores externos |
| `api/express/` | **Potencialmente órfão** | 0 importadores externos; apenas auto-imports internos |
| `services/` | **Possível orphan** | 0 referências detectadas via grep |
| `infra/` | **Stub apenas** | 1 arquivo: di-tokens.js |
| `plugins/` | **Minimal** | 3 arquivos, uso indireto via DI |

---

## 4. ANÁLISE DE PROBLEMAS ESTRUTURAIS ATUAIS

### P1 — Módulo `api/` tem papel ambíguo

- `api/sse/` = re-exports de `server/sse/` (correto, Onda 3.6 ✅)
- `api/bridge/` = bridge de controle de dialog (bridge layer?) — sem importadores ativos
- `api/express/` = SDK API como Express router — sem importadores ativos
- `api/index.js` e `api/openapi.json` — barrel e spec sem consumidor ativo
- **Problema**: `api/` não tem papel claro. Parte é SDK, parte é legado HTTP, parte é re-export.

### P2 — `terminal/state.js` contém estado SSE E estado de terminal (mistura de concerns)

- `getSseClients`, `getSseCriticalClients`, `getTerminalReplayBuffer` → deveriam ser de `server/sse/`
- `getHubSessionId`, `setHubSessionId`, `getBusy`, `getRl` → genuinamente terminais
- `stateEmitter` → event bus do terminal, correto aqui
- **Problema**: acoplamento entre UI (REPL) e transporte (SSE) em um único arquivo de estado

### P3 — `terminal/rate-limiter-state.js` deveria ser de `server/middleware/`

- Padrão bridge: `server.js` registra → `handlers` limpa
- `server.js` foi removido na Onda 3.9, mas `terminal/rate-limiter-state.js` persiste
- O novo `server/middleware/rate-limiter.js` cria rate limiters mas não usa `rate-limiter-state.js`
- **Problema**: `rate-limiter-state.js` agora serve `repl.js` e `system-metrics.js` — ainda tem raison d'être

### P4 — `services/` tem 6 arquivos sem importadores visíveis

- `audit-service.js`, `conversation-service.js`, `session-service.js`, `tool-service.js`
- Camada de serviço que wraps domínio — pode ter sido criada para o `server/` mas sem integração

### P5 — `api/bridge/` e `api/express/` são candidatos à remoção ou integração no `server/`

- `api/bridge/` contém bridge para dialog, stream, control, tasks — potencialmente útil em routers
- `api/express/` contém routers SDK — poderiam ir para `server/routes/sdk.js`
- Ambos sem importadores — código morto funcional

### P6 — `server/` tem routers para 6 domínios mas falta: SSE endpoint, SDK endpoint, sessions CRUD

- `server/routes/` tem: agent.js, config.js, git.js, health.js, memory.js, observability.js
- Faltam routers para: sse.js (streaming), sessions.js (CRUD de sessões), sdk.js (SDK API)
- `api/express/` tem a implementação de sessions CRUD que poderia migrar

### P7 — `conversation-hub/socket-ns.js` é re-export (correto), mas `hub.js` tem `initStandalone()` @deprecated

- Hub ainda usa `initStandalone()` no `terminal/index.js` (linha: `conversationHub.init()` / `initStandalone()`)
- Integração hub-socket via `init({ io })` nunca foi concluída
- Socket.IO ativo apenas com `opts.orchestrator + opts.store` em `server/index.js`

### P8 — Acoplamento `terminal/` e `server/` via estado compartilhado

- `server/sse/state.js` re-exporta de `terminal/state.js`
- `server/middleware/rate-limiter-state.js` re-exporta de `terminal/rate-limiter-state.js`
- Os re-exports são o padrão correto (Onda 3.5), mas o acoplamento persiste até a Onda 3.9 real (mover implementação)

---

## 5. ANÁLISE DE PADRÕES ARQUITETURAIS (MELHORES PRÁTICAS NODE 24+ ESM)

### 5.1 Padrões já adotados (pontos fortes)

| Padrão | Onde | Maturidade |
|--------|------|------------|
| Dependency Injection (DI) | `core/di-container.js`, `di-tokens.js` por módulo | ✅ Sólido |
| Event-driven (pub/sub) | `core/event-bus.js`, `events/` schemas | ✅ Sólido |
| Circuit Breaker | `core/circuit-breaker.js` | ✅ Implementado |
| Retry com exponential backoff | `core/retry.js` | ✅ Implementado |
| Graceful Shutdown | `core/shutdown.js`, `timer-registry.js` | ✅ Implementado |
| CQRS leve (read/write separation) | `db/sqlite.js`, `store-queries.js` / `store.js` | ✅ Parcial |
| Repository Pattern | `conversation-hub/store.js`, `store-queries.js` | ✅ Bom |
| Hook System | `hooks/` (bus, registry, factory, session-hooks) | ✅ Avançado |
| Audit Trail | `audit/pipeline.js`, JSONL writer | ✅ Implementado |
| Schema Validation | `events/schemas/`, `core/schemas.js`, `zod` | ✅ Sólido |
| JSDoc + @ts-check | Todo módulo público | ✅ Sólido |

### 5.2 Padrões ausentes ou incompletos

| Padrão | Status | Impacto |
|--------|--------|---------|
| **Bounded Contexts explícitos** | Ausente | Módulos sem fronteiras claras (ex: `api/` vs `server/`) |
| **Barrel exports consistentes** | Parcial | Não todos os módulos têm `index.js` com API pública definida |
| **Command/Query Separation** em handlers | Parcial | `handlers/` mistura read+write sem diferenciação |
| **Gateway único de entrada HTTP** | Parcial | `server/` novo mas `api/express/` ainda existe como alternativa |
| **Service Layer** claramente usada | Ausente | `services/` existe mas não integrado |
| **Modular health checks** | Parcial | `/health` global, mas sem health por domínio |
| **OpenAPI-first** | Parcial | `api/openapi.json` existe mas desatualizado |
| **Feature Flags** centralizados | Parcial | `sdk/feature-flags.js` existe mas uso nichado |

---

## 6. SITUAÇÃO IDEAL — VISÃO ABSTRATA

### 6.1 Princípios arquiteturais para o alvo

1. **Separação de Concerns por Camada**: infra → domínio → aplicação → transporte
2. **Módulos autocontidos**: cada módulo expõe API pública via `index.js`; imports externos usam alias
3. **Server como único transport layer**: `server/` é o único módulo que expõe HTTP/Socket.IO
4. **Terminal como UI layer**: `terminal/` não conhece HTTP; usa apenas `server/sse/` como canal de saída
5. **Zero código morto**: `api/bridge/`, `api/express/` integrados ou removidos
6. **Service Layer ativa**: `services/` como interface entre domínio e transporte
7. **Hub domain-pure**: `conversation-hub/` sem dependência de Socket.IO direta

### 6.2 Camadas do sistema-alvo

```
  ┌────────────────────────────────────────────────────────────────┐
  │  LAYER 0: Infraestrutura Transversal                           │
  │  core/ · config/ · events/ · observability/                    │
  │  DB: db/ · Plugins: plugins/                                   │
  └────────────────────────────────────────────────────────────────┘
                              ↑ usado por todos
  ┌────────────────────────────────────────────────────────────────┐
  │  LAYER 1: Domínio                                              │
  │  conversation-hub/ · agent/ · audit/ · hooks/                  │
  │  bridges/ · tools/ · sdk/                                      │
  └────────────────────────────────────────────────────────────────┘
                              ↑ usado por application/transport
  ┌────────────────────────────────────────────────────────────────┐
  │  LAYER 2: Application / Serviços                               │
  │  services/ · channel/ (SSE client, inject)                     │
  └────────────────────────────────────────────────────────────────┘
                              ↑ orquestrado por transport/UI
  ┌────────────────────────────────────────────────────────────────┐
  │  LAYER 3: Transport / Interface                                │
  │  server/ (HTTP + WebSocket)  ·  terminal/ (UI/REPL)            │
  └────────────────────────────────────────────────────────────────┘
                              ↑ iniciado por boot
  ┌────────────────────────────────────────────────────────────────┐
  │  LAYER 4: Bootstrap                                            │
  │  bootstrap.js · terminal/bootstrap.js                          │
  └────────────────────────────────────────────────────────────────┘
```

---

## 7. PRÓXIMOS DOCUMENTOS DA SÉRIE PARTE-25

| Documento | Conteúdo |
|-----------|----------|
| **PARTE-25B** | Inventário detalhado — papel de cada pasta, subpasta e arquivo |
| **PARTE-25C** | Arquitetura-alvo completa — estrutura de diretórios ideal, API por módulo |
| **PARTE-25D** | Roadmap de migração contínua — ondas de refatoração numeradas |

---

## APÊNDICE A — Resultado dos Smoke Tests (HEAD db7334a7)

```
✅ check-copilot-autonomy.mjs — 9/9 checks
✅ check-copilot-server.mjs  — HTTP smoke test
✅ check-copilot-socket.mjs  — Socket.IO smoke test (modo sem hub)
✅ npm run lint              — 0 erros, 0 warnings
✅ npm run typecheck:node    — 0 erros nos módulos alterados
```
