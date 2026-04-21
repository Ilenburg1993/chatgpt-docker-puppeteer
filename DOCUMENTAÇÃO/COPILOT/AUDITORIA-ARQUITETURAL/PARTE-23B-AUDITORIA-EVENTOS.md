# PARTE-23B — Auditoria do Sistema de Eventos — Proposta de Unificação

**Data**: 2026-04-12 | **Status**: Proposta | **Versão**: 1.0 **Scope**: Unificação dos 4 sistemas
de eventos paralelos em um SSOT funcional **Precedente**: PARTE-23A (diagnóstico), PARTE-22B §3.7
(events/ proposta)

---

## 1. Problema: 4 Fontes de Eventos Paralelas

O sistema emite eventos via 4 mecanismos diferentes, com sobreposição e inconsistência:

```
                    ┌─────────────────────┐
                    │  events/index.js    │  31 constantes flat — SSOT proposto
                    │  (L0, #copilot/events)│  Adoção: 5/320 arquivos (~1.5%)
                    └─────────┬───────────┘
                              │ importa de ↓
                    ┌─────────┴───────────┐
                    │  types/events.js    │  Objetos aninhados (HOOK_EVENTS, etc.)
                    │  (L0, nunca importada)│  Adoção: 4 arquivos internos
                    └─────────────────────┘

    ┌──────────────────────┐          ┌──────────────────────────┐
    │  core/events.js      │          │  conversation-hub/events.js│
    │  (AGENT_EVENTS, etc.)│          │  (HUB_EVENTS — 23 const) │
    │  Re-exportado via    │          │  Adoção: 6 arquivos      │
    │  core/constants.js   │          │  (socket.io + negócio)   │
    └──────────────────────┘          └──────────────────────────┘
```

### 1.1 Sobreposição Concreta

| Conceito        | events/index.js                       | types/events.js                     | core/events.js          | hub/events.js                                    |
| --------------- | ------------------------------------- | ----------------------------------- | ----------------------- | ------------------------------------------------ |
| Agent ready     | `AGENT_READY = 'agent:ready'`         | `AGENT.READY = 'agent:ready'`       | `AGENT_EVENTS.ready`    | —                                                |
| Agent shutdown  | `AGENT_SHUTDOWN = 'agent:shutdown'`   | `AGENT.SHUTDOWN = 'agent:shutdown'` | `AGENT_EVENTS.shutdown` | —                                                |
| Session created | `SESSION_CREATED = 'session:created'` | `SESSION.START = 'session:start'`   | —                       | `HUB_EVENTS.SESSION_CREATED = 'session:created'` |
| Turn sent       | `TURN_SENT = 'turn:sent'`             | —                                   | —                       | `HUB_EVENTS.TURN_SENT = 'turn:sent'`             |

Mesmas strings com nomes de constante diferentes, em 4 módulos diferentes.

### 1.2 Impacto

- Desenvolvedores não sabem qual importar
- Strings podem divergir silenciosamente
- Refatoração de evento requer update em 4 lugares
- EventBus subscribers podem perder eventos se string difere

---

## 2. Taxonomia Completa de Eventos do Sistema

### 2.1 Eventos de Agente (agent:\*)

| Evento            | String              | Emissor Atual                 | Via EventBus? | Subscribers       |
| ----------------- | ------------------- | ----------------------------- | ------------- | ----------------- |
| Agent ready       | `agent:ready`       | always-alive.js (BaseEmitter) | ❌ local      | terminal, bridges |
| Agent before-stop | `agent:before-stop` | always-alive.js               | ❌ local      | bridges           |
| Agent stopped     | `agent:stopped`     | always-alive.js               | ❌ local      | terminal          |
| Agent shutdown    | `agent:shutdown`    | always-alive.js               | ❌ local      | —                 |
| Agent error       | `agent:error`       | always-alive.js               | ❌ local      | observability     |

### 2.2 Eventos de Dialog (dialog:\*)

| Evento        | String                | Emissor Atual                 | Via EventBus? | Subscribers   |
| ------------- | --------------------- | ----------------------------- | ------------- | ------------- |
| Turn start    | `dialog:turn_start`   | loop-manager.js (BaseEmitter) | ❌ local      | observability |
| Turn end      | `dialog:turn_end`     | loop-manager.js               | ❌ local      | observability |
| Turn stalled  | `dialog:stalled`      | loop-manager.js               | ❌ local      | observability |
| Turn timeout  | `dialog:turn_timeout` | loop-manager.js               | ❌ local      | observability |
| Tool use      | `dialog:tool_use`     | loop-manager.js               | ❌ local      | observability |
| Phase changed | `phase:changed`       | loop-manager.js               | ❌ local      | —             |

### 2.3 Eventos de Hub/Session (session:_, turn:_, hub:\*)

| Evento          | String            | Emissor Atual                 | Via EventBus?      | Subscribers  |
| --------------- | ----------------- | ----------------------------- | ------------------ | ------------ |
| Session created | `session:created` | orchestrator.js (BaseEmitter) | ❌ local           | socket-ns    |
| Session closed  | `session:closed`  | orchestrator.js               | ❌ local           | socket-ns    |
| Turn delta      | `turn:delta`      | call-strategies.js            | ❌ via ctx.emit    | socket-ns    |
| Turn sent       | `turn:sent`       | orchestrator.js               | ❌ local           | socket-ns    |
| Turn complete   | `turn:complete`   | orchestrator.js               | ❌ local           | socket-ns    |
| User inject     | `user:inject`     | socket-ns.js                  | ❌ socket.io event | orchestrator |
| Hub error       | `hub:error`       | socket-ns.js                  | ❌ socket.io       | client       |

### 2.4 Eventos de Hooks

| Evento           | String                  | Emissor Atual              | Via EventBus? |
| ---------------- | ----------------------- | -------------------------- | ------------- |
| Pre tool use     | `hook:pre_tool_use`     | hooks/bus.js (BaseEmitter) | ❌ local      |
| Post tool use    | `hook:post_tool_use`    | hooks/bus.js               | ❌ local      |
| Prompt submitted | `hook:prompt_submitted` | hooks/bus.js               | ❌ local      |
| Session start    | `hook:session_start`    | hooks/bus.js               | ❌ local      |
| Error occurred   | `hook:error_occurred`   | hooks/bus.js               | ❌ local      |

### 2.5 Eventos de Terminal

| Evento     | String             | Emissor Atual            | Via EventBus? |
| ---------- | ------------------ | ------------------------ | ------------- |
| State busy | (via stateEmitter) | state.js (createEmitter) | ❌ local      |
| State idle | (via stateEmitter) | state.js                 | ❌ local      |

### 2.6 Eventos de Sistema

| Evento   | String            | Emissor Atual | Via EventBus?     |
| -------- | ----------------- | ------------- | ----------------- |
| Shutdown | `system:shutdown` | shutdown.js   | ❌ callback-based |
| Error    | `system:error`    | —             | inexistente       |

---

## 3. Proposta: Arquitetura de Eventos Unificada

### 3.1 Princípios

1. **SSOT absoluto**: `events/index.js` é a ÚNICA fonte de strings de evento
2. **Namespaces canônicos**: `agent:*`, `dialog:*`, `session:*`, `hub:*`, `hook:*`, `terminal:*`,
   `system:*`, `audit:*`
3. **Dual-channel**: Emissores locais (BaseEmitter) para eventos intra-módulo + EventBus para
   cross-módulo
4. **Bridge pattern**: Classes que estendem BaseEmitter publicam no EventBus via bridge method
5. **Socket.io separado**: Eventos de socket (client-facing) ficam em `hub/socket-events.js`, não
   conflitam com eventos de negócio

### 3.2 Estrutura de `events/`

```
events/
  index.js              — barrel + re-exports universais
  agent-events.js       — agent:*, constantes + tipos
  dialog-events.js      — dialog:*, constantes + tipos
  session-events.js     — session:*, constantes + tipos
  hub-events.js         — hub:* (negócio, não socket.io)
  hook-events.js        — hook:*, constantes
  terminal-events.js    — terminal:*, constantes
  system-events.js      — system:*, constantes
  audit-events.js       — audit:*, constantes
  socket-events.js      — Mapeamento socket.io-only (client-facing strings)
```

### 3.3 Bridge Pattern — BaseEmitter → EventBus

```js
// Proposta: bridge genérico em core/event-bus-bridge.js
import { getEventBus } from './event-bus.js';

/**
 * Cria bridge que publica eventos de um BaseEmitter no EventBus.
 *
 * @param {import('node:events').EventEmitter} emitter
 * @param {Record<string, string>} mapping - { localEvent: busEventName }
 */
export function bridgeToEventBus(emitter, mapping) {
  for (const [local, busName] of Object.entries(mapping)) {
    emitter.on(local, (data) => {
      getEventBus().emit({ type: busName, payload: data });
    });
  }
}

// Uso em agent/always-alive.js:
bridgeToEventBus(agent, {
  ready: AGENT_READY,
  stopped: AGENT_STOPPED,
  'before-stop': AGENT_BEFORE_STOP,
});
```

### 3.4 Eliminação de Sistemas Legacy

| Sistema Legacy               | Ação                                                                              | Risco                                             |
| ---------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| `types/events.js`            | Deprecar → todos passam para `events/`                                            | Médio (4 importadores)                            |
| `core/events.js`             | Converter em re-export de `events/agent-events.js`                                | Alto (usado em todo o sistema via core/constants) |
| `conversation-hub/events.js` | Socket-specific → `events/socket-events.js`; negócio → `events/session-events.js` | Alto (6 importadores)                             |

### 3.5 Rollout em 3 Fases

**Fase E1** — Expandir events/index.js:

- Criar sub-módulos (`agent-events.js`, `dialog-events.js`, etc.)
- Mover todas as constantes existentes para sub-módulos
- Manter barrel re-exports para backward compatibility

**Fase E2** — Migrar importadores:

- `core/events.js` → re-export de `events/agent-events.js`
- `core/constants.js` → re-export de `events/`
- `conversation-hub/events.js` → split: negócio para events/, socket para interno
- Atualizar todos os `from '#copilot/core' import { AGENT_EVENTS }` para `from '#copilot/events'`

**Fase E3** — Bridge + enforcement:

- Implementar `bridgeToEventBus` para os 8 BaseEmitter classes
- Adicionar ESLint rule: proibir strings de evento fora de `events/`
- Remover `types/events.js` (deprecado)

---

## 4. Inventário de Eventos por Módulo — Quantidade

| Namespace    | Eventos | Emissores                         | Subscribers                      | Cross-module? |
| ------------ | ------- | --------------------------------- | -------------------------------- | ------------- |
| `agent:*`    | 5       | 1 (always-alive)                  | 4+ (bridges, terminal, services) | ✅ sim        |
| `dialog:*`   | 6       | 1 (loop-manager)                  | 2 (observability)                | ✅ sim        |
| `session:*`  | 6       | 1 (orchestrator)                  | 2 (socket-ns, services)          | ✅ sim        |
| `turn:*`     | 4       | 2 (orchestrator, call-strategies) | 1 (socket-ns)                    | parcial       |
| `hook:*`     | 5       | 1 (hooks/bus)                     | 2 (observability, presets)       | ✅ sim        |
| `terminal:*` | 2       | 1 (state.js)                      | 1 (server)                       | parcial       |
| `system:*`   | 1       | 1 (shutdown)                      | many                             | ✅ sim        |
| `audit:*`    | 1       | 1 (audit-service)                 | 1 (pipeline)                     | parcial       |
| **Total**    | **~30** | **~10** emissores                 | **~15** subscribers              |               |

---

## 5. Métricas de Sucesso — Eventos Unificados

| Critério                       | Atual | Pós E1      | Pós E2 | Pós E3 (target) |
| ------------------------------ | ----- | ----------- | ------ | --------------- |
| Fontes de evento               | 4     | 1 (events/) | 1      | 1               |
| Constantes em events/          | 31    | ~45         | ~45    | ~45             |
| Arquivos importando events/    | 5     | 5           | 30+    | 50+             |
| BaseEmitter → EventBus bridges | 0     | 0           | 0      | 8               |
| Inline event strings em prod   | ~30   | ~15         | ~5     | 0               |

---

## 6. Riscos e Mitigações

| Risco                                          | Probabilidade | Impacto | Mitigação                                       |
| ---------------------------------------------- | ------------- | ------- | ----------------------------------------------- |
| Breaking change em import paths                | Alta          | Médio   | Manter re-exports temporários em core/constants |
| Duplicate event strings causam bugs            | Média         | Alto    | Lint rule + grep CI gate                        |
| EventBus performance com bridge                | Baixa         | Baixo   | Bridge é sync, overhead negligível              |
| Socket.io events conflitam com business events | Média         | Médio   | Separar namespaces explicitamente               |

---

## 7. ERRATA — Descobertas da Auditoria Profunda (v1.1)

### 7.1 bridgeEmitter JÁ EXISTE

A Seção 5 indica "BaseEmitter → EventBus bridges: 0". Isso está **incorreto**:

- `core/event-bus.js` (linha 273) exporta `bridgeEmitter(emitter, bus, eventMap)`
- **always-alive.js:561** — Bridge ativa: 7 events → EventBus
- **hub.js:269** — Bridge ativa: 5 events → EventBus

**Coverage real**: 2/8 emitters bridged (25%), 12/35+ events bridged (~34%)

A proposta da Fase E3 de "criar core/event-bus-bridge.js" é **redundante**. O helper já existe. A
ação correta é EXPANDIR o uso de bridgeEmitter para os 6 emitters restantes.

### 7.2 EventBus é unidirecional

Os 12 events bridged são emitidos no EventBus, mas **ninguém consome** via `eventBus.on()`
cross-module. Observability escuta via `.on()` direto no emitter local, não via EventBus. Isso
significa que bridgeEmitter está ativo mas sem consumers — o bus emite para o vazio.

A Fase 2D do roadmap expandido (PARTE-23I) endereça isso: migrar observers para consumir via
EventBus.

### 7.3 Tabela de Métricas Corrigida

| Critério                          | Atual (corrigido) | Pós E1      | Pós E2 | Pós E3     |
| --------------------------------- | ----------------- | ----------- | ------ | ---------- |
| Fontes de evento                  | 4                 | 1 (events/) | 1      | 1          |
| Constantes em events/             | 31                | ~60         | ~60    | ~60        |
| bridgeEmitter coverage            | 2/8 (25%)         | 2/8         | 2/8    | 8/8 (100%) |
| EventBus subscribers cross-module | 0                 | 0           | 5+     | 10+        |
| Inline event strings em prod      | ~30               | ~15         | ~5     | 0          |
