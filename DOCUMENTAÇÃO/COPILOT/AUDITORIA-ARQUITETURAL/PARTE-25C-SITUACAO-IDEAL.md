# PARTE-25C — SITUAÇÃO IDEAL: ARQUITETURA-ALVO DE `src/copilot/`

> **Documento**: PARTE-25C-SITUACAO-IDEAL.md
> **Série**: PARTE-25 (nova auditoria arquitetural completa)
> **Data**: 2026-04-13
> **Base**: HEAD = `db7334a7` (Ondas 3.0–3.9 completas)
> **Objetivo**: Definir a arquitetura-alvo ideal para Node 24+ ESM com ampla capacidade de expansão

---

## 1. PRINCÍPIOS ARQUITETURAIS FUNDAMENTAIS

A arquitetura-alvo de `src/copilot/` deve obedecer os seguintes princípios:

### 1.1 Separação estrita em camadas

Cada módulo pertence a exatamente uma camada. Importações só podem fluir de camadas superiores para inferiores — **nunca ao contrário**.

```
Camada 0: Infraestrutura Transversal  → core, config, events, observability, db, plugins
Camada 1: Domínio                     → agent, conversation-hub, audit, hooks, sdk, bridges
Camada 2: Tools e Serviços            → tools, services, channel
Camada 3: Transporte                  → server (HTTP + WebSocket + SSE)
Camada 4: Interface de Usuário        → terminal (REPL)
Camada 5: Bootstrap                   → bootstrap.js, terminal/bootstrap.js
```

Violações de camada (ex.: `terminal/` importando de `server/sse/state.js`) devem ser eliminadas via inversão de dependência ou re-localização de estado.

### 1.2 Bounded Contexts com contratos explícitos

Cada bounded context tem:
- Um `index.js` com API pública explicitamente documentada
- Um `di-tokens.js` com tokens DI do contexto
- Um `README.md` com propósito, dependências e exemplos
- **Sem imports diretos de arquivos internos por módulos externos** — somente via barrel público

### 1.3 Zero código morto

Nenhum arquivo com 0 importadores ou que só é importado por outros arquivos também órfãos. Rota: migrar para `server/routes/` ou remover.

### 1.4 Server como único gateway de transporte

`server/` é o único módulo que conversa com Express, Socket.IO, e SSE. Terminal não expõe HTTP diretamente — usa `channel/` para se comunicar com o servidor quando necessário.

### 1.5 Isolamento total do workspace

`src/copilot/` não importa de outros módulos `src/` (ex.: `#core/`, `#nerv/`, `#driver/`). Comunicação com o workspace ocorre via:
- `bridges/nerv-event-bus-adapter.js` (event bridge unidirecional)
- Entry points de DI no bootstrap principal
- Env vars compartilhadas

---

## 2. ESTRUTURA DE DIRETÓRIOS IDEAL

### 2.1 Comparação: Atual vs. Alvo

```
ATUAL (53 dirs, ~395 arquivos JS)          ALVO (estrutura expandida e organizada)
─────────────────────────────────          ──────────────────────────────────────
src/copilot/
├── agent/         (57 js)                 ├── agent/          (57 js — sem mudança estrutural)
│   ├── dialog/                            │   ├── dialog/
│   ├── facades/   ⚠️ ver nota            │   ├── facades/     → integrar com services/
│   ├── infra/                             │   ├── infra/
│   ├── lifecycle/                         │   ├── lifecycle/
│   ├── messaging/                         │   ├── messaging/
│   ├── session/                           │   ├── session/
│   └── state/                             │   └── state/
│
├── api/                                   ├── api/             → somente re-exports
│   ├── bridge/    ⚠️ órfão               │   ├── bridge/      → MIGRAR → server/routes/
│   ├── express/   ⚠️ órfão               │   ├── express/     → MIGRAR → server/routes/sdk/
│   └── sse/       ✅ re-exports           │   └── sse/         (manter re-exports)
│
├── audit/         (9 js)                  ├── audit/           (sem mudança)
├── bridges/       (13 js)                 ├── bridges/         (sem mudança)
├── channel/       (8 js)                  ├── channel/         (sem mudança)
├── config/        (7 js)                  ├── config/          (sem mudança)
├── conversation-hub/ (13 js)              ├── conversation-hub/ (sem mudança core)
│   └── socket-ns.js ✅ re-export         │   └── socket-ns.js  (manter re-export)
│
├── core/          (19 js)                 ├── core/            (sem mudança)
│   └── security/                         │   └── security/
│
├── db/            (3 js)                  ├── db/              (sem mudança)
├── events/        (18 js)                 ├── events/          (sem mudança)
├── hooks/         (20 js)                 ├── hooks/           (sem mudança)
├── infra/         (1 js) ⚠️              ├── infra/           → EXPANDIR ou REMOVER
├── logs/          ⚠️ runtime             ├── logs/            → .gitignore (apenas)
├── observability/ (32 js)                ├── observability/   (sem mudança)
├── plugins/       (3 js)                  ├── plugins/         (expandir conforme necessário)
│
├── sdk/           (41 js) ⚠️ flat        ├── sdk/             → SUBDIVIDIR
│   └── models/                            │   ├── models/
│                                          │   ├── session/     ← novo
│                                          │   ├── tools/       ← novo
│                                          │   └── rpc/         ← novo
│
├── server/        (23 js) ✅ novo         ├── server/          → EXPANDIR
│   ├── middleware/                        │   ├── middleware/
│   ├── routes/    (6 js) ⚠️ incompleto  │   ├── routes/      → ADICIONAR: sse, sessions, sdk
│   ├── socket/                            │   ├── socket/
│   └── sse/                              │   └── sse/
│                                          │       ← state.js deve ter impl própria
│
├── services/      (6 js)                  ├── services/        → INTEGRAR com server/routes/
├── terminal/      (47 js)                 ├── terminal/        (sem mudança estrutural)
│   ├── commands/  (23 js)                 │   ├── commands/
│   ├── dialog/                            │   ├── dialog/
│   └── handlers/                          │   └── handlers/
│
├── tools/         (28 js)                 ├── tools/           (sem mudança estrutural)
│   ├── file/                              │   ├── file/
│   ├── git/                               │   ├── git/
│   ├── shell/                             │   ├── shell/
│   └── todo/                              │   └── todo/
│
└── types/         (2 js)                  └── types/           (sem mudança)
```

---

## 3. MUDANÇAS ESTRUTURAIS DETALHADAS

### 3.1 `api/`: Papel Clarificado — Apenas Re-exports e SDK Facade

**Estado atual**: `api/bridge/` e `api/express/` têm 21 arquivos sem consumidores em `server/`.

**Estado ideal**: `api/` contém apenas:
- `api/sse/` — re-exports de `server/sse/` (✅ já assim)
- `api/bridge/` — migrado para `server/routes/copilot/` com feature flag
- `api/express/` — migrado para `server/routes/sdk/`
- `api/openapi.json` — atualizado para refletir rotas canônicas de `server/`

**Rota de migração**:
```
api/bridge/control.js     → server/routes/copilot-control.js
api/bridge/tasks.js       → server/routes/copilot-tasks.js
api/bridge/stream.js      → server/routes/sse.js (SSE endpoint)
api/bridge/dialog.js      → server/routes/copilot-dialog.js (já em agent.js, unificar)
api/express/sessions.js   → server/routes/sessions.js
api/express/agent.js      → server/routes/sdk-agent.js
api/express/webhooks.js   → server/routes/webhooks.js
```

### 3.2 `server/routes/`: Roters Faltantes

**Estado ideal de `server/routes/`**:

```
server/routes/
├── agent.js           ✅ existente — /inject, /pipeline, /status, /dialog/*
├── config.js          ✅ existente — /config, /config/skills, /config/tools
├── git.js             ✅ existente — /git/*, /gh/*
├── health.js          ✅ existente — /health, /hub-health, /ws/info
├── memory.js          ✅ existente — /memory
├── observability.js   ✅ existente — /metrics, /errors, /history, /audit
│
├── sse.js             ← NOVO: GET /events (SSE streaming global)
├── sessions.js        ← NOVO: CRUD /sessions (migrado de api/express/)
├── sdk-agent.js       ← NOVO: /agent/info, /agent/tools (migrado de api/express/)
├── webhooks.js        ← NOVO: /webhooks (migrado de api/express/)
└── copilot.js         ← NOVO: /api/copilot/* (migrado de api/bridge/)
```

### 3.3 `sdk/`: Subdivisão Interna

**Estado atual**: 41 arquivos no flat com apenas `models/` como subdiretório.

**Estado ideal**:
```
sdk/
├── models/           (existente — 5 arquivos)
├── session/          ← NOVO: session.js, sdk-session-wrapper.js, rpc-session.js
├── tools/            ← NOVO: tools.js, tools-registry.js, tools-state.js, custom-tools.js
├── rpc/              ← NOVO: rpc.js, rpc-ops.js, server-rpc.js, experimental-rpc.js
└── (raiz)            ← contratos, config, client, events, health, permissions, telemetry
```

### 3.4 `server/sse/state.js`: Implementação Própria

**Estado atual**: `server/sse/state.js` re-exporta de `terminal/state.js` (acoplamento de camadas).

**Estado ideal**: O estado SSE (clientes conectados, replay buffer) deve morar em `server/sse/state.js` com implementação própria. `terminal/state.js` deve importar de `server/sse/` quando precisar do estado de clientes — não ao contrário.

```
Atual:   terminal/state.js (impl) ← server/sse/state.js (re-export)
Ideal:   server/sse/state.js (impl) → terminal/state.js (importa quando necessário)
```

### 3.5 `services/`: Integração com `server/routes/`

**Estado atual**: `services/` existe como camada L4 mas não é consumida por `server/routes/`.

**Estado ideal**: `server/routes/` deve usar `#copilot/services` em vez de acessar domínio diretamente:
```
server/routes/agent.js  → importa de #copilot/services (alwaysAliveAgent, etc.)
server/routes/sessions.js → importa de #copilot/services (createSessionService, etc.)
```

### 3.6 `infra/`: Expansão ou Consolidação

**Estado atual**: 1 arquivo (`di-tokens.js`) — vestigial.

**Estado ideal** (duas opções):
- **Opção A** — Expandir: `infra/` contém wrappers de infraestrutura de runtime (queue workers, filesystem watchers, lockfiles)
- **Opção B** — Remover: mover `infra/di-tokens.js` para `core/di-tokens.js` e deletar pasta

Recomendação: **Opção A** se houver expansão planejada de queue/storage; **Opção B** se não.

### 3.7 `terminal/state.js`: Separação de Concerns

**Estado atual**: Mistura SSE state (getSseClients, getTerminalReplayBuffer) e terminal state (getBusy, getRl, stateEmitter).

**Estado ideal**:
```
terminal/
├── state.js           → apenas terminal state: getBusy, setBusy, getRl, stateEmitter
└── sse-state.js       → alias/import de server/sse/state.js (quando precisar de getSseClients)
```

---

## 4. API PÚBLICA IDEAL POR MÓDULO

### Contratos via `index.js` (barrel público)

| Módulo | O que deve exportar |
|--------|---------------------|
| `core/` | DI container, event bus, errors, retry, shutdown, circuit breaker, cache, mutex |
| `config/` | Todas as config vars: env, auth, mcp-servers, system-prompt |
| `observability/` | `log`, `metrics`, `tracer`, `errorTracker`, `toolStats` |
| `events/` | Event schemas registry, builtin schemas, emitter factory |
| `sdk/` | SDK client, session, tools, models, RPC interfaces |
| `agent/` | `alwaysAliveAgent`, `createSnapshot`, lifecycle API |
| `conversation-hub/` | `conversationHub`, `conversationStore`, `broadcastGlobal` |
| `audit/` | `pipeline`, `createAuditService` |
| `hooks/` | Hook registry, factory, presets |
| `bridges/` | Git bridge, GH bridge, MCP bridge |
| `tools/` | All tools by category |
| `channel/` | SSE client, inject client, dialog client |
| `services/` | All service factories + agent/hub/channel re-exports |
| `server/` | `startCopilotServer` |
| `terminal/` | `startCopilotTerminal` (para isolamento) |

---

## 5. PADRÕES DE DESIGN A ADOTAR/FORTALECER

### 5.1 Padrões a ADOTAR (não existentes)

| Padrão | Onde aplicar | Benefício |
|--------|-------------|-----------|
| **Gateway Pattern** | `server/` como único gateway HTTP | Elimina duplicidade api/bridge + server/routes |
| **Service Layer completa** | `services/` consumida por `server/routes/` | Desacopla transport do domínio |
| **Ports & Adapters (Hexagonal)** | `server/` + `terminal/` como adapters; domínio sem deps de transport | Testabilidade máxima |
| **Feature Toggling estruturado** | `sdk/feature-flags.js` centralizado | Controle de capacidades em runtime |
| **API Versioning** | `server/routes/v1/`, `/v2/` | Expansão sem quebra de API |
| **Health Checks por domínio** | `server/routes/health.js` + healthchecks em cada módulo | Diagnóstico preciso |
| **OpenAPI-first** | `api/openapi.json` → schema → routers | Coerência entre contrato e implementação |

### 5.2 Padrões a FORTALECER (parcialmente presentes)

| Padrão | Estado atual | Fortalecimento |
|--------|-------------|----------------|
| **DI Container** | Sólido mas não usado em todos os módulos | Garantir uso em server/routes/ |
| **Event-driven** | Bom no core, mas alguns módulos têm chamadas diretas | Padronizar via event bus nos routes |
| **Graceful Shutdown** | `core/shutdown.js` existe | Garantir que todos os recursos de server/ são registrados |
| **Circuit Breaker** | Implementado no core | Aplicar em chamadas ao SDK e bridges externos |
| **Schema Validation** | Zod no core, mas não aplicado em rotas | Adicionar validators em server/routes/ inputs |
| **Audit Trail** | Pipeline existe | Garantir que todas as ações de server/routes/ auditadas |
| **Mutex** | Implementado em core | Aplicar em operações de escrita concorrente |

---

## 6. REGRAS DE ISOLAMENTO DO WORKSPACE

`src/copilot/` deve obedecer o contrato de isolamento definido em `scripts/check-copilot-autonomy.mjs`.

### 6.1 Imports proibidos (de fora de src/copilot/)

```js
// PROIBIDO — importações do workspace raiz
import { ... } from '#core/...';
import { ... } from '#nerv/...';
import { ... } from '#driver/...';
import { ... } from '#infra/...';
```

### 6.2 Única ponte autorizada

```js
// AUTORIZADO — adaptador explícito
import { nervAdapter } from '#copilot/bridges/nerv-event-bus-adapter.js';
```

### 6.3 Checklist de autonomia (ideal — expandir para 15 checks)

```
Check  1: Zero imports de #core/, #nerv/, #driver/, #infra/
Check  2: Entry points existem (bootstrap.js, agent.js, terminal/bootstrap.js)
Check  3: PM2 entry points resolvem
Check  4: server/wiring.js removido (✅ Onda 3.9)
Check  5: bootstrap.js é single-mode
Check  6: server/index.js exporta startCopilotServer
Check  7: server/socket/hub-ns.js existe
Check  8: terminal/server.js removido (✅ Onda 3.9)
Check  9: conversation-hub/socket-ns.js é re-export stub
Check 10: api/sse/*.js são todos re-export stubs ← NOVO
Check 11: server/routes/ tem ao menos 6 routers ← NOVO
Check 12: Zero require() em src/copilot/ ← NOVO
Check 13: Todos os módulos têm index.js ← NOVO
Check 14: Nenhum arquivo com > 500 LOC sem documentação JSDoc ← NOVO
Check 15: services/ é consumida por server/ ou terminal/ ← NOVO
```

---

## 7. ARQUITETURA DE RUNTIME IDEAL

### 7.1 Fluxo de boot

```
ecosystem.config.cjs
  └── PM2 spawna processo
        └── src/copilot/bootstrap.js
              └── terminal/bootstrap.js
                    └── terminal/index.js
                          ├── observability/bootstrap.js   (L0: observability up)
                          ├── core/di-container.js         (L0: DI container init)
                          ├── config/                      (L0: config loaded)
                          ├── db/migrations.js             (L0: DB migrations)
                          ├── agent/lifecycle/entry.js     (L1: domain up)
                          ├── conversation-hub/hub.js      (L1: hub init)
                          ├── hooks/registry.js            (L1: hooks loaded)
                          ├── tools/ (via tools-bootstrap) (L2: tools registered)
                          ├── channel/                     (L2: channels up)
                          └── server/index.js              (L3: transport up)
                                ├── middlewares
                                ├── routes/
                                └── socket/hub-ns.js
```

### 7.2 Fluxo de request HTTP (ideal)

```
Client → server/middleware/auth.js
       → server/middleware/rate-limiter.js
       → server/middleware/request-id.js
       → server/routes/{domain}.js
         → services/{domain}-service.js
           → {domain}/index.js (domain logic)
             → core/ (DI resolution)
       → server/middleware/error-handler.js
```

### 7.3 Fluxo de evento (ideal)

```
Agent emits event
  → core/event-bus.js
    → events/middleware/schema-validator.js
    → events/middleware/correlation-enricher.js
    → events/middleware/timestamp-enricher.js
    → observability/collectors/  (coleta e persiste)
    → server/sse/fanout.js        (broadcast para clientes SSE)
    → server/socket/hub-ns.js     (broadcast Socket.IO)
```

---

## 8. MÉTRICAS DE QUALIDADE ALVO

| Métrica | Atual | Alvo |
|---------|-------|------|
| Módulos com 0 importadores externos | 2+ (`api/bridge/`, `api/express/`) | 0 |
| Arquivos re-export stub | 5 (`api/sse/*`, `conversation-hub/socket-ns.js`) | ≤ 5 (manter os corretos) |
| Routers em `server/routes/` | 6 | 9–11 |
| `sdk/` subdiretórios | 1 (`models/`) | 4 (`models/`, `session/`, `tools/`, `rpc/`) |
| Checks de autonomia | 9 | 15 |
| LOC médio por arquivo | ~200 | ≤ 300 (com JSDoc) |
| `terminal/state.js` concerns | 2 (mixed) | 1 (terminal only) |

---

## APÊNDICE — Estrutura de Arquivos Ideal Completa

```
src/copilot/
├── agent/
│   ├── dialog/                 (sem mudança)
│   ├── infra/                  (sem mudança)
│   ├── lifecycle/              (sem mudança)
│   ├── messaging/              (sem mudança)
│   ├── session/                (sem mudança)
│   ├── state/                  (sem mudança)
│   ├── ... (raiz)              (sem mudança)
│
├── api/
│   ├── sse/                    (re-exports apenas — sem mudança)
│   └── openapi.json            (atualizar para refletir server/routes/)
│   [api/bridge/ e api/express/ → migrar para server/routes/]
│
├── audit/                      (sem mudança)
├── bridges/                    (sem mudança)
├── channel/                    (sem mudança)
├── config/                     (sem mudança)
│
├── conversation-hub/
│   ├── hub.js                  (remover initStandalone @deprecated)
│   └── ... (resto sem mudança)
│
├── core/                       (sem mudança)
├── db/                         (sem mudança)
├── events/                     (sem mudança)
├── hooks/                      (sem mudança)
│
├── sdk/
│   ├── models/                 (existente)
│   ├── session/                (NOVO — session.js, sdk-session-wrapper.js, rpc-session.js)
│   ├── tools/                  (NOVO — tools.js, tools-registry.js, tools-state.js, custom-tools.js)
│   ├── rpc/                    (NOVO — rpc.js, rpc-ops.js, server-rpc.js, experimental-rpc.js)
│   └── (raiz: contratos, config, client, events, health, permissions, telemetry)
│
├── server/
│   ├── middleware/             (existente)
│   ├── routes/
│   │   ├── agent.js            (existente)
│   │   ├── config.js           (existente)
│   │   ├── git.js              (existente)
│   │   ├── health.js           (existente)
│   │   ├── memory.js           (existente)
│   │   ├── observability.js    (existente)
│   │   ├── sse.js              (NOVO — GET /events SSE endpoint)
│   │   ├── sessions.js         (NOVO — CRUD /sessions)
│   │   ├── sdk-agent.js        (NOVO — /agent/info, /agent/tools)
│   │   ├── webhooks.js         (NOVO — CRUD /webhooks)
│   │   └── copilot-api.js      (NOVO — /api/copilot/* bridge entry)
│   ├── socket/                 (sem mudança)
│   └── sse/
│       ├── fanout.js           (sem mudança)
│       ├── replay-buffer.js    (sem mudança)
│       ├── state.js            (MIGRAR impl de terminal/state.js para cá)
│       ├── utils.js            (sem mudança)
│       └── index.js            (sem mudança)
│
├── services/                   (integrar com server/routes/)
├── terminal/
│   ├── commands/               (sem mudança)
│   ├── dialog/                 (sem mudança)
│   ├── handlers/               (sem mudança)
│   ├── state.js                (REMOVER estado SSE — mover para server/sse/state.js)
│   └── ... (resto sem mudança)
│
├── tools/                      (sem mudança)
├── types/                      (sem mudança)
│
├── bootstrap.js                (sem mudança)
└── README.md                   (atualizar)
```
