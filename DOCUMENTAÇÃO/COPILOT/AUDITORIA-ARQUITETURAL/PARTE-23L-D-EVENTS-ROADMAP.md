# PARTE-23L-D — Events System: Roadmap de Hardening — Consolidado

**Data**: 2026-04-12 | **Status**: Em Execução | **Versão**: 2.0
**Contexto**: Subparte especial PARTE-23 — plano consolidado, fases e subfases completas
**Dependências**: PARTE-23L-A (auditoria), PARTE-23L-B (grafo), PARTE-23L-C (ideal)
**Meta final**: Sistema de events totalmente novo — EventBus único backbone, NERV integrado,
SDK bridgeado, middleware chain, zero strings hardcoded, observabilidade completa.

---

## 0. Resumo Executivo

A auditoria identificou **10 gaps críticos** no sistema de eventos. Este roadmap organiza as
correções em **8 faixas incrementais** de baixo para alto impacto, sem quebrar funcionalidades
existentes. Cada faixa é independente e pode ser deployed separadamente.

**Prioridade imediata**: GAP-01 (HookBus → EventBus) é um **BUG** que gera 5 subscribers mortos.
Deve ser resolvido antes de qualquer nova feature de observabilidade de hooks.

---

## 1. Mapa de Impacto × Esforço

```
                 ALTO IMPACTO
                      │
           NERV-UNIFY  │  SDK-BRIDGE
           (L5)        │  (L6)
                       │
ALTO ESFORÇO ─────────-┼──────────── BAIXO ESFORÇO
                       │
           DIAGNOSTICS │  HOOK-BRIDGE (L1) ◄ URGENTE
           REPLAY (L4) │  SERVICE-SSOT (L2)
                       │  NERV-EVENTBUS-ADAPTER (L3)
                       │
                 BAIXO IMPACTO
```

---

## 2. Faixas de Implementação

### FAIXA-L1 — Fix Bug HookBus + Subscribers Operacionais (URGENTE)

**Prioridade**: 🔥 CRÍTICA — Bug em produção
**Esforço**: 2-3 horas
**Risco**: Baixo (adição, não remoção)
**Impacto**: 5 subscribers quebrados passam a funcionar, hooks visíveis no EventBus

#### L1.1 — Injetar EventBus no HookBus

**Arquivo**: `src/copilot/hooks/bus.js`

```javascript
// Adicionar campo #eventBus e método setEventBus()
// Adicionar bridge no emitHook()
```

- Adicionar `#eventBus = null` como campo privado
- Criar `setEventBus(bus)` público
- No `emitHook()`: após `this.emit(hookName, event)`, chamar `this.#eventBus?.emit({ type: HOOK_NAME_MAP[hookName], ...event })`
- Importar constantes de `#copilot/events`

**Arquivo**: `src/copilot/observability/bootstrap.js`

```javascript
// Após registrar EVENT_BUS no DI container:
const bus = container.resolve(EVENT_BUS);
import { hookBus } from '#copilot/hooks';
hookBus.setEventBus(bus);
```

#### L1.2 — Transformar event-bus-observers nos hooks para ação real

**Arquivo**: `src/copilot/observability/event-bus-observers.js`

Subscribers de HOOK_* passam de `log()` para:
- `HOOK_PRE_TOOL_USE` → log + metrics.inc('hooks.pre_tool_use')
- `HOOK_POST_TOOL_USE` → log + metrics.inc('hooks.post_tool_use')
- `HOOK_ERROR_OCCURRED` → log ERROR + errorTracker.track()
- `HOOK_SESSION_START` → log + metrics.inc('hooks.session_start')
- `HOOK_SESSION_END` → log + metrics.inc('hooks.session_end')

#### Critérios de aceite L1
- [ ] `hookBus.emitHook('pre_tool_use', ...)` resulta em `EventBus.emit({ type: 'hook:pre_tool_use' })`
- [ ] `event-bus-observers.js` subscriber HOOK_PRE_TOOL_USE dispara
- [ ] Sem quebra nos testes existentes de hooks
- [ ] `npm run lint && npm run test:unit` ✅

---

### FAIXA-L2 — Service Events → SSOT + Norma de Namespace

**Prioridade**: Alta
**Esforço**: 1-2 horas
**Risco**: Baixo (strings aditivas no SSOT)
**Impacto**: Zero strings hardcoded em services, conformidade C11

#### L2.1 — Criar events/service-events.js

```javascript
// src/copilot/events/service-events.js
export const SERVICE_SESSION_CREATED    = 'service:session:created';
export const SERVICE_SESSION_DISCONNECTED = 'service:session:disconnected';
export const SERVICE_SESSION_RESUMED    = 'service:session:resumed';
export const SERVICE_SESSION_MESSAGE    = 'service:session:message';
export const SERVICE_TOOL_INVOKED       = 'service:tool:invoked';
```

#### L2.2 — Atualizar barrel events/index.js

Adicionar re-export de `service-events.js`.

#### L2.3 — Substituir strings inline nos services

| Arquivo                            | String antiga          | Constante nova                 |
| ---------------------------------- | ---------------------- | ------------------------------ |
| `services/session-service.js`      | `'session:create'`     | `SERVICE_SESSION_CREATED`      |
| `services/session-service.js`      | `'session:disconnect'` | `SERVICE_SESSION_DISCONNECTED` |
| `services/session-service.js`      | `'session:resume'`     | `SERVICE_SESSION_RESUMED`      |
| `services/conversation-service.js` | `'session:message'`    | `SERVICE_SESSION_MESSAGE`      |
| `services/tool-service.js`         | `'tool:build'`         | `SERVICE_TOOL_INVOKED`         |

> Nota: O nome da string MUDA (ex: `'session:create'` → `'service:session:created'`).
> Verificar se há subscribers para essas strings antes de renomear.
> Se houver subscribers, manter alias temporário + deprecation warning.

#### Critérios de aceite L2
- [ ] `grep -rn "'session:create\|'session:disconnect\|'tool:build"` retorna 0 resultados
- [ ] `events/service-events.js` exporta todas as constantes
- [ ] Barrel `events/index.js` re-exporta `service-events.js`
- [ ] `npm run lint` ✅

---

### FAIXA-L3 — NervEventBusAdapter: EventBus → NERV Unificado

**Prioridade**: Alta
**Esforço**: 3-4 horas
**Risco**: Médio (mexe no caminho crítico NERV)
**Impacto**: NERV passa a receber Hub, Hook e Config events; caminho inbound auditável

#### L3.1 — Criar events/nerv-events.js

```javascript
// src/copilot/events/nerv-events.js
// Mapeamento bidirecional EventBus ↔ NERV (extraído de nerv-bridge.js)
export const EVENTBUS_TO_NERV = { ... };
export const NERV_TO_EVENTBUS = { ... };
export const NERV_COMMAND_RECEIVED    = 'nerv:command:received';
export const NERV_COMMAND_SENDMESSAGE = 'nerv:command:send_message';
export const NERV_COMMAND_PAUSE       = 'nerv:command:pause';
export const NERV_COMMAND_RESUME      = 'nerv:command:resume';
export const NERV_COMMAND_RESTART     = 'nerv:command:restart';
```

#### L3.2 — Criar bridges/nerv-event-bus-adapter.js

**Novo módulo** que substitui o acoplamento direto ao EventEmitter do agent:

```javascript
/**
 * @file nerv-event-bus-adapter.js
 * Integra NERV ao EventBus como consumer/producer.
 *
 * Outbound: EventBus emite → NERV recebe
 * Inbound: NERV emite COPILOT_COMMAND → EventBus emite nerv:command:*
 */
export class NervEventBusAdapter {
    /** @param {{ bus: EventBus; nerv: object }} deps */
    constructor({ bus, nerv }) { ... }

    /** Conecta ao NERV e subscreve no EventBus. */
    mount() { ... }

    /** Desconecta e limpa resources. */
    unmount() { ... }
}
```

#### L3.3 — Manter nerv-bridge.js como fallback

`nerv-bridge.js` permanece para o caminho legado do AlwaysAliveAgent EventEmitter → NERV.
NervEventBusAdapter é ADICIONADO como segundo caminho (com filtro para evitar duplicatas).

No futuro (FAIXA-L7), `nerv-bridge.js` poderá ser removido quando 100% dos eventos
estiverem no EventBus.

#### L3.4 — Wire em observability/bootstrap.js

```javascript
import { NervEventBusAdapter } from '#copilot/bridges/nerv-event-bus-adapter';
// Após NERV ser injetado no container:
const nervAdapter = new NervEventBusAdapter({ bus, nerv });
nervAdapter.mount();
// Registrar cleanup: nervAdapter.unmount() no shutdown
```

#### Critérios de aceite L3
- [ ] `HUB_SESSION_CREATED` chega ao NERV via `NervEventBusAdapter`
- [ ] `HOOK_PRE_TOOL_USE` chega ao NERV via `NervEventBusAdapter` (após L1)
- [ ] `NERV COPILOT_COMMAND` emite `nerv:command:*` no EventBus
- [ ] Sem duplicação de eventos já enviados pelo nerv-bridge legado
- [ ] `npm run test:integration` ✅

---

### FAIXA-L4 — EventBus v2: diagnostics() + replay() + pipe()

**Prioridade**: Média
**Esforço**: 2-3 horas
**Risco**: Baixo (adição de capacidades ao EventBus existente)
**Impacto**: Diagnóstico runtime, replay para debugging, composição de buses

#### L4.1 — Adicionar diagnostics() ao EventBus

```javascript
// core/event-bus.js
diagnostics() {
    return {
        listeners: Array.from(this.#listeners.entries()).map(([type, set]) => ({
            type,
            count: set.size,
        })),
        emitted: Object.fromEntries(this.#counters),
        disposed: this.#disposed,
        middlewareCount: this.#middleware.length,
    };
}
```

#### L4.2 — Adicionar channels()

```javascript
channels() {
    return Array.from(this.#listeners.keys())
        .filter(k => (this.#listeners.get(k)?.size ?? 0) > 0);
}
```

#### L4.3 — Adicionar buffer circular para replay()

```javascript
// Ring buffer de 50 eventos por tipo (opcional, opt-in)
// bus = new EventBus({ replayBuf fer: 50 })
```

#### L4.4 — Adicionar statsBy Namespace()

```javascript
statsByNamespace() {
    const result = {};
    for (const [type, count] of this.#counters) {
        const ns = type.split(':')[0] ?? '_global';
        result[ns] = (result[ns] ?? 0) + count;
    }
    return result;
}
```

#### L4.5 — Expor via API de saúde

`api/express/health.js` → adicionar endpoint `/health/events` que retorna `bus.diagnostics()`.

#### Critérios de aceite L4
- [ ] `bus.diagnostics()` retorna objeto com listeners e contadores
- [ ] `bus.channels()` retorna array com types que têm subscribers
- [ ] `/health/events` retorna dados corretos
- [ ] `npm run test:unit` ✅

---

### FAIXA-L5 — SDK Session Event Bridge (Selecionado)

**Prioridade**: Média
**Esforço**: 3-4 horas
**Risco**: Médio (SDK é external dep — API pode mudar)
**Impacto**: Tool calls, compaction, streaming errors visíveis no EventBus

#### L5.1 — Criar events/sdk-events.js

```javascript
export const SDK_TOOL_CALL          = 'sdk:tool:call';
export const SDK_TOOL_RESULT        = 'sdk:tool:result';
export const SDK_SESSION_STARTED    = 'sdk:session:started';
export const SDK_SESSION_STOPPED    = 'sdk:session:stopped';
export const SDK_MESSAGE_COMPLETE   = 'sdk:message:complete';
export const SDK_MESSAGE_ERROR      = 'sdk:message:error';
export const SDK_SESSION_USAGE      = 'sdk:session:usage';
export const SDK_CONTEXT_COMPACTED  = 'sdk:context:compacted';
```

#### L5.2 — Criar sdk/session-event-bridge.js

Função `bridgeSdkSession(session, bus)` que:
- Mapeia os 8 eventos selecionados (não os 74 — seria overhead desnecessário)
- Retorna função de cleanup
- High-frequency events (streaming deltas) são intencionalmente EXCLUÍDOS

#### L5.3 — Integrar em agent/lifecycle/entry.js

Após session ser inicializada:
```javascript
const unbridge = bridgeSdkSession(session, bus);
agent.once('stopped', unbridge);
```

#### Critérios de aceite L5
- [ ] `SDK_TOOL_CALL` event aparece no EventBus quando SDK invoca tool
- [ ] Streaming deltas não chegam ao EventBus (performance OK)
- [ ] Cleanup correto na parada do agent
- [ ] `npm run test:integration` ✅

---

### FAIXA-L6 — Middleware Registry (Tracing + Schema Validation)

**Prioridade**: Média
**Esforço**: 4-5 horas
**Risco**: Baixo (middleware é additive, não bloqueia)
**Impacto**: Observabilidade profunda, validação de schemas, correlationId automático

#### L6.1 — Criar events/middleware/ directory

```
events/middleware/
├── timestamp-enricher.js     → garante timestamp + correlationId em todo evento
├── schema-validator.js       → valida shape mínimo (type string, timestamp number)
├── rate-limiter.js           → limita high-frequency events (ex: task:delta max 100/s)
└── index.js                  → exports
```

#### L6.2 — TimestampEnricher middleware

```javascript
/** @type {import('../core/event-bus.js').Middleware} */
export function timestampEnricher(event, next) {
    const enriched = {
        correlationId: event.correlationId ?? crypto.randomUUID(),
        ...event,
        timestamp: event.timestamp ?? Date.now(),
    };
    return next(enriched);
}
```

#### L6.3 — SchemaValidator middleware

```javascript
export function schemaValidator(event, next) {
    if (typeof event.type !== 'string' || !event.type) {
        console.warn('[EventBus] evento sem type:', event);
        return; // descarta silenciosamente (não lança)
    }
    return next(event);
}
```

#### L6.4 — RateLimiter para HIGH_FREQUENCY_EVENTS

Do SSOT: `HIGH_FREQUENCY_EVENTS = new Set(['agent:task:delta', ...])`.
Middleware descarta se > 100 eventos/s por type.

#### L6.5 — Wire em bootstrap.js

```javascript
bus.use(schemaValidator);
bus.use(timestampEnricher);
if (process.env.ENABLE_RATE_LIMITER === 'true') {
    bus.use(createRateLimiter(HIGH_FREQUENCY_EVENTS, 100));
}
```

#### Critérios de aceite L6
- [ ] Todo evento do EventBus tem `correlationId` e `timestamp`
- [ ] Evento sem `type` é descartado com warning (não lança)
- [ ] High-frequency events (task:delta) não saturam o bus em load test
- [ ] `npm run test:unit` ✅

---

### FAIXA-L7 — agent-event-observer.js → EventBus Migration

**Prioridade**: Média
**Esforço**: 2-3 horas
**Risco**: Médio (migrar observers de métricas critica)
**Impacto**: observability/agent-event-observer.js unificado com EventBus, pattern único

#### L7.1 — Analisar observer atual

`agent-event-observer.js` usa `agent.on('event', handler)` para 9 eventos de métricas.
Esses eventos chegam ao EventBus via bridge (já implementada).
Portanto, equivalente `bus.on(AGENT_DIALOG_STALLED, handler)` funciona.

#### L7.2 — Migrar 9 subscribers

| Evento antigo (agent.on)  | Equivalente EventBus                    |
| ------------------------- | --------------------------------------- |
| `dialog.turn_start`       | AGENT_TASK_STARTED                      |
| `dialog.turn_end`         | (compor de AGENT_TASK_STARTED → timing) |
| `dialog.stalled`          | AGENT_DIALOG_STALLED                    |
| `dialog.turn_timeout`     | AGENT_DIALOG_TURN_TIMEOUT               |
| `task.completed`          | (AGENT_TASK_STARTED + delta tracking)   |
| `task.error`              | AGENT_TASK_ERROR                        |
| `permission.mode_changed` | (a mapear)                              |
| `session.fatal`           | AGENT_SESSION_FATAL                     |
| `agent.metrics`           | (a mapear)                              |

> Atenção: alguns mapeamentos requerem adicionar constantes em `events/agent-events.js`.

#### L7.3 — Deprecate agentEventObserver pattern

Manter `agent-event-observer.js` mas adicionar `@deprecated` e migrar para
`event-bus-observers.js` expandido.

#### Critérios de aceite L7
- [ ] Métricas continuam funcionando após migração
- [ ] `agent-event-observer.js` marcado @deprecated
- [ ] Novos subscribers em `event-bus-observers.js` ou módulo dedicado de métricas
- [ ] `npm run test:unit` ✅

---

### FAIXA-L8 — Unificação Final NERV + Remoção of Legacy

**Prioridade**: Baixa (futuro)
**Esforço**: 5-8 horas
**Risco**: Alto (remoção de caminho crítico)
**Impacto**: Sistema totalmente unificado, nerv-bridge.js removido

#### L8.1 — Pré-condições

- ✅ L3 (NervEventBusAdapter) deployado e estável
- ✅ L5 (SDK bridge) deployado
- ✅ L7 (agent-event-observer migrado)
- ✅ 100% dos eventos do AlwaysAliveAgent chegam ao EventBus

#### L8.2 — Migrar EVENT_MAP de nerv-bridge.js → nerv-events.js

Mover todas as 62 entradas para `events/nerv-events.js` como `EVENTBUS_TO_NERV`.

#### L8.3 — Remover nerv-bridge.js gradualmente

1. Marcar como @deprecated
2. Verificar com testes de integração que NervEventBusAdapter cobre todos os casos
3. Remover arquivo

#### L8.4 — Unificar hub.js#bridgeToNerv

Remover método `#bridgeToNerv()` de `conversation-hub/hub.js`.
Esses eventos já chegam ao NERV via NervEventBusAdapter (passo L3).

#### Critérios de aceite L8
- [ ] nerv-bridge.js removido
- [ ] hub.js sem #bridgeToNerv
- [ ] NERV continua recebendo todos os eventos que recebia antes
- [ ] `npm run test:integration` ✅
- [ ] `node scripts/arch-health.mjs` → score ≥ 92/100

---

## 3. Matriz de Dependências entre Faixas

```
L1 (HookBus fix) ─────────────────────────────→ [independente]
L2 (Service SSOT) ────────────────────────────→ [independente]
L3 (NervEventBusAdapter) ──── depende de ─────→ [L1 para hooks; L2 opcional]
L4 (EventBus v2) ─────────────────────────────→ [independente]
L5 (SDK Bridge) ──────────────────────────────→ [independente]
L6 (Middleware) ──── depende de ──────────────→ [EventBus v2 opcional, L4]
L7 (Observer migration) ─── depende de ───────→ [L1, L2]
L8 (Unificação final) ────── depende de ───────→ [L3, L5, L7]
```

---

## 4. Timeline Estimada

| Faixa | Nome                      | Esforço | Risco | Prioritária |
| ----- | ------------------------- | ------- | ----- | :---------: |
| L1    | HookBus Bridge (bug fix)  | 2-3h    | Baixo |    🔥 SIM    |
| L2    | Service Events SSOT       | 1-2h    | Baixo |    ✅ SIM    |
| L4    | EventBus v2 (diagnostics) | 2-3h    | Baixo |    ✅ SIM    |
| L3    | NervEventBusAdapter       | 3-4h    | Médio |   ⏳ Médio   |
| L6    | Middleware Registry       | 4-5h    | Baixo |   ⏳ Médio   |
| L5    | SDK Session Bridge        | 3-4h    | Médio |   ⏳ Médio   |
| L7    | Observer Migration        | 2-3h    | Médio |   ⏳ Médio   |
| L8    | Unificação Final          | 5-8h    | Alto  |  ⬜ Futuro   |

**Total faixas prioritárias (L1+L2+L4)**: ~6-8 horas
**Total faixas médias (L3+L5+L6+L7)**: ~12-16 horas
**Total geral (L1-L8)**: ~22-32 horas

---

## 5. Checklist Pré-Implementação

Antes de iniciar cada faixa:

- [ ] Ler o PARTE-23L-A (situação atual) para contexto
- [ ] Verificar arch-health baseline: `node scripts/arch-health.mjs`
- [ ] Rodar base de testes: `npm run test:unit`
- [ ] Confirmar lint limpo: `npm run lint`

Pós cada faixa:

- [ ] `npm run lint && npm run format:check`
- [ ] `npm run test:unit`
- [ ] `node scripts/arch-health.mjs` — score não pode cair
- [ ] Atualizar PARTE-23L-D com status da faixa

---

## 6. Métricas de Sucesso

| Indicador                            | Atual | Meta L1-L4 | Meta L5-L8 |
| ------------------------------------ | ----- | ---------- | ---------- |
| Subscribers mortos (nunca disparam)  | 5     | 0          | 0          |
| Strings de evento hardcoded          | ~18   | 0          | 0          |
| Eventos bridgeados ao EventBus       | 26    | 32         | ~80        |
| Eventos que NERV recebe via EventBus | 0     | 15+        | 40+        |
| Middleware ativos                    | 0     | 3          | 4          |
| arch-health score                    | 89    | ≥90        | ≥93        |
| Wildcards em uso                     | 0     | 3+         | 5+         |
| Diagnóstico runtime                  | ❌     | ✅          | ✅          |

---

## 7. Ordem de Execução Recomendada (FAIXA-L Sprint 1)

Para implementar imediatamente (próximo turno):

```
1. FAIXA-L1: Fix HookBus bridge (bug crítico — 5 subscribers mortos)
   └─ hooks/bus.js: adicionar #eventBus + setEventBus() + bridge no emitHook()
   └─ bootstrap.js: hookBus.setEventBus(bus)
   └─ event-bus-observers.js: hook subscribers → log + metrics

2. FAIXA-L2: service-events.js + migrar services
   └─ events/service-events.js: 5 constantes
   └─ events/index.js: re-export
   └─ services/*.js: substituir 5 strings inline

3. FAIXA-L4: EventBus diagnostics() + channels()
   └─ core/event-bus.js: adicionar 4 métodos
   └─ api/express/health.js: endpoint /health/events

Commit após cada faixa concluída.
git push após Sprint 1 completo (L1+L2+L4).
```

---

## 8. Status de Implementação (Tracking)

| Faixa                        | Status       | Data       | Notas                                    |
| ---------------------------- | ------------ | ---------- | ---------------------------------------- |
| L1 — HookBus bridge          | ✅ CONCLUÍDO | 2026-03-15 | Fix GAP-EVENTS-01, hooks/bus.js + bootstrap |
| L2 — Service SSOT            | ✅ CONCLUÍDO | 2026-03-15 | service-events.js + 3 services migrados  |
| L4 — EventBus v2 diagnostics | ✅ CONCLUÍDO | 2026-03-15 | diagnostics(), channels(), statsByNamespace() |
| L3 — NervEventBusAdapter     | ✅ CONCLUÍDO | 2026-03-15 | nerv-event-bus-adapter.js + nerv-events.js |
| L6 — Middleware Registry     | ✅ CONCLUÍDO | 2026-03-15 | 3 middlewares + registerBuiltinMiddleware() |
| L5 — SDK Bridge              | ✅ CONCLUÍDO | 2026-03-15 | sdk-events.js + sdk-session-bridge.js    |
| L7 — Observer Migration      | ✅ CONCLUÍDO | 2026-03-15 | 30+ constantes SSOT + bridgeEmitter expandido |
| L8 — Unificação Final        | ✅ CONCLUÍDO | 2026-03-15 | NERV map completo + /health/events endpoint |

---

## 9. Diagrama de Ordem Canônica de Execução

```
ORDEM CANÔNICA — do mais urgente ao mais profundo

SPRINT 1 (bug + foundation):
┌────────┐    ┌────────┐    ┌────────┐
│ L1     │───►│ L2     │───►│ L4     │
│HookBus │    │Service │    │EventBus│
│ fix    │    │  SSOT  │    │  v2    │
│🔥 BUG  │    │        │    │        │
└────────┘    └────────┘    └────────┘

SPRINT 2 (NERV unificado + middleware):
         ┌────────┐    ┌────────┐
         │ L3     │    │ L6     │
         │ NERV   │    │Middlew.│
         │Adapter │    │Registry│
         └────┬───┘    └────────┘
              │ (depende L1+L2)

SPRINT 3 (SDK + observer migration):
         ┌────────┐    ┌────────┐
         │ L5     │    │ L7     │
         │  SDK   │    │Observer│
         │Bridge  │    │Migrat. │
         └────────┘    └────┬───┘
                            │ (depende L1+L2)

SPRINT 4 (consolidação final):
                       ┌────────┐
                       │ L8     │
                       │Unific. │
                       │ Final  │
                       └────────┘
                       (depende L3+L5+L7)
```

---

## 10. Novos Arquivos a Criar

| Arquivo                                               | Faixa | Propósito                                 |
| ----------------------------------------------------- | ----- | ----------------------------------------- |
| `src/copilot/events/service-events.js`                | L2    | Constantes de eventos dos services        |
| `src/copilot/events/nerv-events.js`                   | L3    | Mapeamento EventBus↔NERV actionCodes      |
| `src/copilot/events/sdk-events.js`                    | L5    | Constantes para eventos bridgeados do SDK |
| `src/copilot/events/middleware/index.js`              | L6    | Barrel do middleware registry             |
| `src/copilot/events/middleware/timestamp-enricher.js` | L6    | Enriquece timestamp+correlationId         |
| `src/copilot/events/middleware/schema-validator.js`   | L6    | Valida shape mínimo                       |
| `src/copilot/events/middleware/rate-limiter.js`       | L6    | Throttle high-frequency events            |
| `src/copilot/bridges/nerv-event-bus-adapter.js`       | L3    | EventBus→NERV adapter class               |
| `src/copilot/sdk/session-event-bridge.js`             | L5    | Bridge session SDK → EventBus             |

---

## 11. Arquivos a Modificar

| Arquivo                                             | Faixa | Mudança                                                |
| --------------------------------------------------- | ----- | ------------------------------------------------------ |
| `src/copilot/hooks/bus.js`                          | L1    | +`#eventBus`, +`setEventBus()`, bridge em `emitHook()` |
| `src/copilot/observability/bootstrap.js`            | L1    | `hookBus.setEventBus(bus)`                             |
| `src/copilot/observability/event-bus-observers.js`  | L1    | Hook subscribers → log+metrics                         |
| `src/copilot/events/index.js`                       | L2    | +re-export service-events.js                           |
| `src/copilot/services/session-service.js`           | L2    | Strings inline → constantes                            |
| `src/copilot/services/conversation-service.js`      | L2    | Strings inline → constantes                            |
| `src/copilot/services/tool-service.js`              | L2    | Strings inline → constantes                            |
| `src/copilot/core/event-bus.js`                     | L4    | +`diagnostics()`, +`channels()`, +`statsByNamespace()` |
| `src/copilot/api/express/health.js`                 | L4    | +endpoint `/health/events`                             |
| `src/copilot/events/index.js`                       | L3    | +re-export nerv-events.js                              |
| `src/copilot/observability/bootstrap.js`            | L3    | Wire NervEventBusAdapter                               |
| `src/copilot/events/index.js`                       | L5    | +re-export sdk-events.js                               |
| `src/copilot/agent/lifecycle/entry.js`              | L5    | bridgeSdkSession()                                     |
| `src/copilot/observability/bootstrap.js`            | L6    | bus.use() middleware                                   |
| `src/copilot/observability/agent-event-observer.js` | L7    | @deprecated, migrate to bus.on()                       |
| `src/copilot/bridges/nerv-bridge.js`                | L8    | @deprecated                                            |
| `src/copilot/conversation-hub/hub.js`               | L8    | Remover #bridgeToNerv()                                |

---

**Implementação iniciada em**: 2026-04-12
**Referências**: [PARTE-23L-A](PARTE-23L-A-EVENTS-SITUACAO-ATUAL.md) | [PARTE-23L-B](PARTE-23L-B-EVENTS-GRAFO.md) | [PARTE-23L-C](PARTE-23L-C-EVENTS-SITUACAO-IDEAL.md)
