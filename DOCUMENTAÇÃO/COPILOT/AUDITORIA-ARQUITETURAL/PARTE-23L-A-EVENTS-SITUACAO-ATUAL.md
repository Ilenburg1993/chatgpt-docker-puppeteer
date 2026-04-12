# PARTE-23L-A — Events System: Auditoria Profunda v2.0 — Situação Atual (Pós-Implementação)

**Data**: 2026-04-12 | **Status**: Re-Auditoria | **Versão**: 2.0
**Contexto**: Subparte PARTE-23L — foco exclusivo no sistema de eventos
**Precedente**: Commit `b3284b0a` — FAIXA-L1 a L8 implementadas
**Escopo v2**: Re-auditoria completa pós-L1–L8, análise profunda SDK ↔ Agent ↔ EventBus

---

## 1. Inventário de Sistemas de Eventos (Pós-L1–L8)

O sistema Copilot agora possui **8 camadas de eventos** operando em paralelo.
As implementações L1–L8 adicionaram 3 bridges e 3 middlewares, mas gaps persistem.

### 1.1 EventBus (core/event-bus.js) — ~340 linhas

- `on()/once()/emit()/use()` + wildcards (`*`, `ns:*`)
- **Novo (L4)**: `diagnostics()`, `channels()`, `statsByNamespace()`
- **Novo (L6)**: 3 middlewares built-in (enricher → validator → rate-limiter)
- Singleton via DI token `EVENT_BUS`
- 119 `emit()` calls no codebase total

### 1.2 Agent EventEmitter (AlwaysAliveAgent extends BaseEmitter)

- **~52 event types** emitidos (via host.emit/ctx.emit + SDK forwarding)
- **38 bridgeados** ao EventBus via `bridgeEmitter()` (L7)
- **28 NÃO bridgeados** — perdidos antes de chegar ao EventBus

### 1.3 DialogLoopManager (extends BaseEmitter)

- 13 event types emitidos
- **Dois caminhos**: DLM → event-wiring.js → Agent emitter **E** DLM → bridgeEmitter direto
- 8 bridgeados diretamente ao EventBus

### 1.4 HookBus (hooks/bus.js extends BaseEmitter)

- 6 hook events + wildcard `*`
- **Novo (L1)**: `setEventBus(bus)` + bridge em `emitHook()` → `#eventBus?.emit()`
- ✅ Agora bridgeado ao EventBus (fix GAP-EVENTS-01)

### 1.5 NERV Legado (bridges/nerv-bridge.js) — ~452 linhas

- 62 eventos Agent EventEmitter → NERV (outbound direto)
- NERV COPILOT_COMMAND → agent (inbound direto)
- **NÃO usa EventBus** — conecta diretamente ao AlwaysAliveAgent

### 1.6 NervEventBusAdapter **[NOVO L3]** (bridges/nerv-event-bus-adapter.js)

- **~70 entradas** EVENTBUS_TO_NERV (outbound: EventBus → NERV)
- Inbound: NERV COPILOT_COMMAND → EventBus (`nerv:command:*`)
- **Coexiste** com nerv-bridge legado → potencial duplicação

### 1.7 SdkSessionBridge **[NOVO L5]** (bridges/sdk-session-bridge.js)

- 18 SDK session events → EventBus (namespace `sdk:`)
- Usa `onSessionEvents()` do SDK barrel
- **Conflito**: Os mesmos eventos também passam via event-handlers → Agent → bridge

### 1.8 Middleware Registry **[NOVO L6]**

- `timestamp-enricher.js`: Adiciona `_source` (hostname:pid), normaliza `timestamp`
- `schema-validator.js`: Bloqueia events sem `type` ou `timestamp` válidos
- `rate-limiter.js`: Suprime flood (100/window/type por padrão)

---

## 2. Fluxo Completo de Eventos: SDK → Agent → EventBus → NERV

Este é o fluxo mais crítico e mais complexo do sistema. A v1 da auditoria não o
documentou em profundidade.

### 2.1 Origem: SDK Session (74+ event types)

```
@github/copilot-sdk session.on(type, handler)
├── SESSION_EVENTS.SESSION_START       ('session.start')
├── SESSION_EVENTS.ASSISTANT_TURN_START ('assistant.turn_start')
├── SESSION_EVENTS.TOOL_EXECUTION_START ('tool.execution_start')
├── ... (74+ tipos definidos em sdk/constants.js)
└── Catch-all: session.on((evt) => ...)
```

### 2.2 Caminho A: event-handlers/ → Agent EventEmitter → EventBus

```
SDK session.on(SESSION_EVENTS.X, handler)
    ↓ (8 handler files em agent/session/event-handlers/)
    ↓ handler extrai dados, transforma, chama callbacks.emit(name, payload)
    ↓ callbacks.emit = (event, payload) => host.emit(event, payload)
    ↓ host = AlwaysAliveAgent (EventEmitter)
    ↓
AlwaysAliveAgent.emit('session.compaction_start', data)
    ↓ bridgeEmitter map: 'session.compaction_start' → AGENT_SESSION_COMPACTION_START
    ↓
EventBus.emit({ type: 'agent:session:compaction_start', ...data })
    ↓ EVENTBUS_TO_NERV: 'agent:session:compaction_start' → 'COPILOT_SESSION_COMPACTION_START'
    ↓
NERV.emitEvent({ actionCode: 'COPILOT_SESSION_COMPACTION_START', ... })
```

**25 SDK events** passam por este caminho (wireSdkResponseEvents, wireCompactionEvents, etc.)

### 2.3 Caminho B: SdkSessionBridge → EventBus (direto)

```
SDK session.on('session.compaction_start', handler)
    ↓ SdkSessionBridge.attach(session)
    ↓ handler via onSessionEvents()
    ↓
EventBus.emit({ type: 'sdk:session:compaction_start', sdkEventType: 'session.compaction_start', ... })
```

**18 SDK events** passam por este caminho (SDK_SESSION_TO_EVENTBUS map)

### 2.4 Diagrama de Duplicação

Para eventos que estão em AMBOS os caminhos, o EventBus recebe **dois eventos distintos**:

| SDK Event                    | Via Caminho A (agent:*)               | Via Caminho B (sdk:*)              |
|------------------------------|---------------------------------------|------------------------------------|
| `session.compaction_start`   | `agent:session:compaction_start`      | `sdk:session:compaction_start`     |
| `session.compaction_complete`| `agent:session:compaction_complete`   | `sdk:session:compaction_complete`  |
| `session.mode_changed`       | `agent:session:mode_changed`          | `sdk:session:mode_changed`         |
| `session.shutdown`           | ❌ NÃO bridgeado                      | `sdk:session:shutdown`             |
| `session.error`              | ❌ NÃO bridgeado                      | `sdk:session:error`                |
| `assistant.turn_start`       | ❌ NÃO bridgeado                      | `sdk:assistant:turn_start`         |
| `assistant.turn_end`         | ❌ NÃO bridgeado                      | `sdk:assistant:turn_end`           |
| `tool.execution_start`       | `agent:tool:execution_start` (via TE) | `sdk:tool:execution_start`         |
| `tool.execution_complete`    | `agent:tool:execution_complete`       | `sdk:tool:execution_complete`      |
| `session.usage_info`         | `agent:session:usage` (remapped)      | `sdk:session:usage_info`           |
| `subagent.started`           | ❌ NÃO bridgeado                      | `sdk:subagent:started`             |
| `subagent.completed`         | ❌ NÃO bridgeado                      | `sdk:subagent:completed`           |
| `subagent.failed`            | ❌ NÃO bridgeado                      | `sdk:subagent:failed`              |
| `abort`                      | ❌ NÃO bridgeado                      | `sdk:abort`                        |

**Problemas**:
1. **Duplicação**: 6 eventos aparecem no EventBus com dois nomes diferentes
2. **Inconsistência**: Alguns só existem em `agent:*`, outros só em `sdk:*`
3. **Semântica distinta**: O Caminho A enriquece/transforma o payload; o B repassa raw

---

## 3. Os 28 Eventos Perdidos (Agent → ∅)

Estes 28 event names são emitidos no Agent EventEmitter mas **NÃO estão mapeados
no bridgeEmitter**, portanto **nunca chegam ao EventBus**:

| # | Event Name                     | Origem                       | Impacto      |
|---|--------------------------------|------------------------------|--------------|
| 1 | `abort`                        | sdk-responses.js             | 🔴 ALTO      |
| 2 | `agent.background.completed`   | system-notifications.js      | 🟡 MÉDIO     |
| 3 | `agent.background.idle`        | system-notifications.js      | 🟡 MÉDIO     |
| 4 | `agent.shell.completed`        | system-notifications.js      | 🟡 MÉDIO     |
| 5 | `agent.shell.detached_completed`| system-notifications.js     | 🟡 MÉDIO     |
| 6 | `assistant.intent`             | sdk-responses.js             | 🟡 MÉDIO     |
| 7 | `assistant.reasoning_complete` | sdk-responses.js             | 🟡 MÉDIO     |
| 8 | `assistant.turn_start`         | sdk-responses.js             | 🔴 ALTO      |
| 9 | `assistant.turn_end`           | sdk-responses.js             | 🔴 ALTO      |
| 10| `dialog.boot_recovery`         | boot-wiring.js               | 🟢 BAIXO     |
| 11| `dialog.delta`                 | streaming.js                 | 🔴 ALTO      |
| 12| `elicitation.pending`          | sdk-responses.js             | 🟡 MÉDIO     |
| 13| `mcp.reconnected`              | boot-wiring.js               | 🟢 BAIXO     |
| 14| `quota.warning`                | boot-wiring.js               | 🟡 MÉDIO     |
| 15| `sdk.lifecycle`                | boot-wiring.js               | 🟡 MÉDIO     |
| 16| `session.cleanup`              | boot-wiring.js               | 🟢 BAIXO     |
| 17| `session.context_changed`      | sdk-responses.js             | 🟡 MÉDIO     |
| 18| `session.error`                | sdk-responses.js             | 🔴 ALTO      |
| 19| `session.handoff`              | sdk-responses.js             | 🔴 ALTO      |
| 20| `session.shutdown`             | sdk-responses.js             | 🔴 ALTO      |
| 21| `session.task_complete`        | sdk-responses.js             | 🔴 ALTO      |
| 22| `session.truncation`           | sdk-responses.js             | 🟡 MÉDIO     |
| 23| `steering.sent`                | agent-messaging.js           | 🟢 BAIXO     |
| 24| `subagent.completed`           | sdk-responses.js             | 🟡 MÉDIO     |
| 25| `subagent.failed`              | sdk-responses.js             | 🟡 MÉDIO     |
| 26| `subagent.started`             | sdk-responses.js             | 🟡 MÉDIO     |
| 27| `status`                       | agent-context.js             | 🟢 BAIXO     |
| 28| `__processQueue`               | always-alive.js (interno)    | ⚪ IGNORAR   |

**Classificação**: 7 🔴 ALTO, 12 🟡 MÉDIO, 5 🟢 BAIXO, 1 ⚪ interno, 3 cobertos por SdkSessionBridge

---

## 4. Análise de Sobreposição NERV Legado vs NervEventBusAdapter

### NERV Legado (nerv-bridge.js)
- Conecta ao `getAgent().on(event, handler)` — Agent EventEmitter direto
- 62 eventos mapeados
- Inbound: NERV COPILOT_COMMAND → chamadas diretas no agent

### NervEventBusAdapter (nerv-event-bus-adapter.js)
- Conecta ao EventBus via `bus.on(eventType, handler)`
- ~70 mapeamentos outbound
- Inbound: NERV COPILOT_COMMAND → `bus.emit({ type: 'nerv:command:*' })`

### Diagnóstico de Sobreposição
- Para os 38 events bridgeados (agent → EventBus → NervAdapter), o NERV recebe **DOIS envelopes**:
  1. Via nerv-bridge (direto do Agent emitter)
  2. Via NervEventBusAdapter (do EventBus após bridgeEmitter)
- Para os 24 events que só o nerv-bridge mapeia (sem bridge ao EventBus), o NERV recebe **UM envelope** (via legado)
- Para events que só existem no EventBus (hook, hub, system, service), o NERV recebe **UM envelope** (via adapter apenas)

### Recomendação
Após completar a migração dos 28 events perdidos para o EventBus, o nerv-bridge legado
pode ser **removido inteiramente** — o NervEventBusAdapter com cobertura total assume.

---

## 5. Inventário Numérico v2

| Métrica                                           | v1.0 | v2.0 (atual) | Delta   |
|---------------------------------------------------|------|---------------|---------|
| SDK session event types                           | 74+  | 74+           | —       |
| SDK events consumidos (event-handlers)            | 25   | 25            | —       |
| SDK events bridgeados direto (SdkSessionBridge)   | 0    | 18            | +18 ✅  |
| SSOT constants (`events/`)                        | 52   | 82+           | +30 ✅  |
| Events bridgeados agent→EventBus                  | 8    | 38            | +30 ✅  |
| Events NÃO bridgeados (agent→∅)                   | ~40  | 28            | -12 ✅  |
| Middlewares no EventBus                           | 0    | 3             | +3 ✅   |
| NERV outbound mappings (legado)                   | 62   | 62            | —       |
| NERV outbound mappings (adapter)                  | 0    | ~70           | +70 ✅  |
| EventBus methods de diagnóstico                   | 1    | 4             | +3 ✅   |
| Health endpoint                                   | 0    | 1             | +1 ✅   |
| Subscribers no EventBus (bus-observers)           | 15   | 15            | —       |
| Subscribers que NUNCA disparam (hook gap)         | 5    | 0             | -5 ✅   |
| Duplicação EventBus (agent: + sdk:)               | 0    | 6             | +6 ⚠️  |
| Strings hardcoded fora do SSOT                    | ~18  | ~13           | -5 ✅   |

---

## 6. Gaps Remanescentes Prioritizados

### GAP-R01: 28 Events Perdidos no Bridge (CRÍTICO)
7 eventos de alto impacto (abort, session.error/shutdown/handoff, dialog.delta,
assistant.turn_start/end, session.task_complete) nunca chegam ao EventBus.

### GAP-R02: Duplicação SDK/Agent no EventBus (ALTO)
6 eventos aparecem com dois nomes diferentes (`agent:*` e `sdk:*`).
Não há semântica clara de quando usar qual.

### GAP-R03: NERV Legado Duplica (ALTO)
O nerv-bridge emite envelopes NERV em paralelo com o NervEventBusAdapter.
38 eventos geram envelope duplo no NERV.

### GAP-R04: Observer Acoplamento Duplo (MÉDIO)
`session-agent-handlers.js` e `dialog-task-handlers.js` escutam o Agent EventEmitter
diretamente (50 events). Mas são os MESMOS events que o bridgeEmitter mapeia ao EventBus.
Resultado: o mesmo evento é processado duas vezes — um via EventEmitter direto, outro via EventBus.

### GAP-R05: SdkSessionBridge sem attach() automático (MÉDIO)
O `sdkSessionBridge.init(bus)` é chamado no bootstrap, mas `attach(session)` nunca
é chamado em lugar nenhum do código. O bridge está **inerte** em produção.

### GAP-R06: 50+ SDK Events Ignorados (MÉDIO)
Do total de 74+ SDK events, apenas 25 são consumidos pelos event-handlers e 18 pelo
SdkSessionBridge. Os demais ~30 são tratados apenas pelo catch-all (log de "desconhecido").

### GAP-R07: Inconsistência de Namespace Separator (BAIXO)
Coexistem `:` (SSOT), `.` (legacy agent events), `_` (hooks). Não há normalização.

### GAP-R08: Event-Bus Observers Só Logam (BAIXO)
Os 15 subscribers do event-bus-observers.js apenas fazem log. Não alimentam métricas.

---

## 7. Conclusão da Re-Auditoria

A implementação L1–L8 resolveu os 10 gaps originais parcialmente:
- ✅ L1 fixou GAP-01 (HookBus disconnect)
- ✅ L2 reduziu GAP-04 (strings hardcoded) de ~18 para ~13
- ✅ L3 criou NervEventBusAdapter (GAP-02 mitigado, não resolvido)
- ✅ L4 adicionou diagnostics (GAP-09 resolvido)
- ✅ L5 criou SdkSessionBridge (GAP-03 parcialmente coberto, mas não wired)
- ✅ L6 adicionou middlewares (GAP-08 resolvido)
- ✅ L7 expandiu bridgeEmitter (GAP-10 reduzido de ~40 para 28 não-bridged)
- ✅ L8 expandiu NERV map (70 entries) + health endpoint

**Porém**: Novos problemas surgiram:
- Duplicação SDK/Agent no EventBus (6 eventos)
- NERV legado duplicando com adapter
- SdkSessionBridge não wired em produção
- 28 eventos ainda perdidos entre Agent e EventBus
- Observers ainda duplicados (EventEmitter direto + EventBus)

O roadmap v3 (PARTE-23L-D) endereça estes gaps com faixas adicionais.
