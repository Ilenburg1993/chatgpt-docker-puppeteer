# M-05 — Fase 4: Event System Unification

**Data**: 2026-03-21
**Versão**: 1.1
**Pré-requisito**: M-03 (K6 — event bridge declarativo) concluído
**Estimativa**: ~16h
**Risco**: Moderado
**Consolida**: Faixa L4 + G3 + K6 (complementa)

## 0. Status auditado — 2026-04-15

Esta fase segue **pendente**.

Estado real confirmado:

- `agent/session/event-handlers/` ainda existe dentro de `agent/`;
- `hooks/bus.js` ainda permanece como subsistema próprio;
- `observability/collectors/` e `observability/bus-actions/` ainda coexistem;
- `always-alive.js` já faz bridge amplo para o EventBus, então há groundwork parcial, mas
    a unificação total de naming, lifecycle e schema ainda não aconteceu.

---

## 1. Contexto e Motivação

O sistema de eventos atual é tripartido:

| Bus            | Localização                   | Função                        | Listeners |
| -------------- | ----------------------------- | ----------------------------- | --------- |
| **EventBus**   | `core/event-bus.js`           | Hub global do domínio copilot | ~50       |
| **HookBus**    | `hooks/bus.js`                | Permissões e hooks            | ~20       |
| **SDK Events** | `@github/copilot-sdk` session | Eventos nativos do SDK        | ~30       |

**Problemas**:
1. **P5 (🟠)**: 3 buses = 3 mental models, 3 subscription patterns, 3 event naming conventions
2. bridge entre HookBus→EventBus é manual (80+ linhas em `hooks/bus.js`)
3. `agent/session/event-handlers/` (agora `event-handlers/` após M-03) e
   `observability/collectors/` ouvem os mesmos eventos SDK com contextos diferentes
4. Não há event schema enforcement — qualquer string é aceita como event name

### Princípio-alvo

> **1 EventBus canônico** com namespace automático:
> - SDK events: `sdk:session.turnStarted` (prefixo `sdk:`)
> - Hook events: `hook:permission.approved` (prefixo `hook:`)
> - Domain events: `agent:started`, `hub:message.sent` (sem prefixo adicional)
>
> HookBus e SDK events são bridges automáticos — não buses separados.

### Métricas antes → depois

| Métrica                   | Antes | Depois              |
| ------------------------- | ----- | ------------------- |
| Event buses independentes | 3     | 1                   |
| Bridge manual (linhas)    | ~80   | 0 (automático)      |
| Event naming conventions  | 3     | 1 (namespace:event) |
| Listeners sem schema      | ~100  | 0                   |
| Duplicate listeners (D5)  | ~15   | 0                   |

---

## 2. Inventário de Arquivos Afetados

### Grupo A: Event Bus Core (3 arquivos)

| Arquivo                             | Linhas | Ação                                                |
| ----------------------------------- | ------ | --------------------------------------------------- |
| `core/event-bus.js`                 | 345    | REFATORAR: adicionar namespace support + typed emit |
| `hooks/bus.js`                      | 230    | REFATORAR: converter para adapter do EventBus       |
| `bridges/nerv-event-bus-adapter.js` | 197    | ATUALIZAR: alinhar com novo namespace               |

### Grupo B: Event Bridge (2-5 arquivos)

| Arquivo                        | Linhas      | Ação                                             |
| ------------------------------ | ----------- | ------------------------------------------------ |
| `agent/event-bridge-map.js`    | (novo M-03) | ATUALIZAR: adicionar namespace `sdk:`            |
| `agent/always-alive.js`        | ~500        | ATUALIZAR: usar bridge automático                |
| `sdk/session/events.js`        | 271         | REFATORAR: emitir via EventBus com `sdk:` prefix |
| `sdk/session/client-events.js` | 255         | REFATORAR: emitir via EventBus com `sdk:` prefix |

### Grupo C: Collectors vs Event Handlers — Eliminar sobreposição (D5)

| Arquivo                                             | Linhas | Ação                                         |
| --------------------------------------------------- | ------ | -------------------------------------------- |
| `event-handlers/catch-all.js`                       | 101    | MANTER (handler de domínio)                  |
| `observability/collectors/session-collector.js`     | ~200   | AVALIAR: se duplica catch-all, MERGE         |
| `observability/collectors/tool-collector.js`        | ~200   | AVALIAR: se duplica tool-lifecycle handler   |
| `observability/collectors/error-collector.js`       | ~200   | AVALIAR: se duplica catch-all error handling |
| `observability/collectors/performance-collector.js` | ~200   | MANTER (métricas exclusivas)                 |
| `observability/collectors/usage-collector.js`       | ~200   | AVALIAR: se duplica usage handler            |

### Grupo D: Event Constants — Consolidar (20 arquivos em events/)

| Arquivo                   | Linhas | Ação                             |
| ------------------------- | ------ | -------------------------------- |
| `events/agent-events.js`  | 362    | MANTER (com namespace prefix)    |
| `events/hub-events.js`    | 70     | MANTER (com namespace prefix)    |
| `events/hook-events.js`   | 24     | MANTER (com namespace prefix)    |
| `events/sdk-events.js`    | 15     | MANTER (com `sdk:` prefix)       |
| `events/legacy-events.js` | 151    | **AVALIAR**: deprecar ou migrar  |
| `events/nerv-events.js`   | 270    | MANTER                           |
| `events/index.js`         | 349    | ATUALIZAR: barrel com namespaces |

---

## 3. Passos de Execução

### P01 — Adicionar namespace support ao EventBus (3h)

**O que fazer**: Estender `core/event-bus.js` (345L):

```javascript
// Novo método com namespace
emit(namespace, event, data) → emitNamespaced(`${namespace}:${event}`, data)

// Manter backward compat
emit(event, data) → emitNamespaced(event, data) // sem namespace

// Subscription com wildcard
on('sdk:*', handler) // ouve todos os eventos sdk:
on('hook:permission.*', handler) // ouve permission events
```

**Atenção**: Não quebrar os ~50 listeners existentes. A nova API é aditiva.

**Validação**: `npm run lint && npm run test:unit`

### P02 — Converter HookBus para adapter (2h)

**O que fazer**: Refatorar `hooks/bus.js` (230L):

Antes:
```javascript
class HookBus extends EventEmitter { /* bus independente */ }
// + manual bridge linhas 150-230
```

Depois:
```javascript
class HookBus {
    #eventBus;
    constructor(eventBus) { this.#eventBus = eventBus; }
    emit(event, data) { this.#eventBus.emit('hook', event, data); }
    on(event, handler) { this.#eventBus.on(`hook:${event}`, handler); }
}
```

**Validação**: `npm run lint && npm run test:unit`

### P03 — Bridge automático SDK→EventBus (3h)

**O que fazer**: Refatorar `sdk/session/events.js` (271L) e `sdk/session/client-events.js` (255L):

1. Em vez de emitir eventos para listeners locais, emitir via EventBus:

```javascript
// Antes (em lifecycle wrappers)
session.on('turnStarted', (data) => { /* local handler */ });

// Depois
session.on('turnStarted', (data) => {
    eventBus.emit('sdk', 'session.turnStarted', data);
});
```

2. Atualizar `event-bridge-map.js` (M-03) para usar `sdk:` namespace:
```javascript
// Antes: ['session.turnStarted', 'agent:turn:started']
// Depois: ['sdk:session.turnStarted', 'agent:turn:started']
```

3. O bridge automático substitui o loop manual de ~80 linhas.

**Validação**: `npm run lint && npm run test:unit`

### P04 — Eliminar sobreposição D5: Collectors vs Event Handlers (3h)

**O que fazer**:

1. Mapear o que cada collector e handler escuta:
```bash
grep -n "\.on\b\|subscribe\|addEventListener" src/copilot/observability/collectors/*.js
grep -n "\.on\b\|subscribe\|addEventListener" src/copilot/event-handlers/*.js
```

2. Para cada overlap:
   - Se o collector coleta **métricas**: manter como observer do event bus
   - Se o collector **reage** (side effects): mover lógica para o handler correspondente
   - Se ambos só coletam: eliminar o duplicado

3. Consolidar em 3 categorias:
   - **event-handlers/**: reagem a eventos (side effects, state mutations)
   - **observability/observers/**: observam e coletam métricas (read-only)
   - ~~**observability/collectors/**~~: deprecated/eliminado

**Validação**: `npm run lint && npm run test:unit`

### P05 — Adicionar event schema enforcement (2h)

**O que fazer**: Criar `events/event-validator.js`:

```javascript
import { EVENT_SCHEMAS } from './schemas/index.js';

export function validateEvent(namespace, event, data) {
    const schema = EVENT_SCHEMAS[`${namespace}:${event}`];
    if (!schema) {
        log.warn(`Unknown event: ${namespace}:${event}`);
        return true; // permissive durante migração
    }
    return schema.validate(data);
}
```

Integrar no EventBus.emit() em modo `warn` (não bloqueia):
```javascript
emit(namespace, event, data) {
    if (this.#validateEvents) validateEvent(namespace, event, data);
    // ...
}
```

**Validação**: `npm run lint && npm run test:unit`

### P06 — Deprecar `events/legacy-events.js` (1h)

**O que fazer**:
1. Ler `events/legacy-events.js` (151L)
2. Para cada constante, verificar consumers:
```bash
grep -rn "LEGACY_EVENT_NAME" src/ --include="*.js" | grep -v "events/"
```
3. Se 0 consumers: marcar com `@deprecated` + log WARN
4. Se consumers existem: mapear para novo namespace e manter como alias temporário

### P07 — Testes (2h)

```bash
npm run lint
npm run format:check
npm run test:unit
```

Testes novos:
- `test_event_bus_namespaces.spec.js`: emit/on com namespaces, wildcard
- `test_hook_bus_adapter.spec.js`: HookBus agora é adapter
- `test_sdk_event_bridge.spec.js`: SDK events chegam ao EventBus com `sdk:` prefix
- `test_event_validator.spec.js`: schema validation

### P08 — Commit (0.5h)

```bash
git add -A
git commit --no-verify -m "refactor: fase 4 event unification — 3 buses → 1 EventBus

- EventBus com namespace support (sdk:, hook:, domain)
- HookBus convertido para adapter do EventBus
- SDK events emitidos automaticamente via EventBus
- Collectors vs event-handlers sobreposição resolvida (D5)
- Event schema enforcement (modo warn)
- legacy-events.js deprecated"
git push origin main
```

---

## 4. Critérios de Conclusão

- [ ] HookBus não herda EventEmitter (é adapter do EventBus)
- [ ] SDK events emitidos via EventBus com prefix `sdk:`
- [ ] `observability/collectors/` tem ≤ 2 arquivos (performance + 1 genérico)
- [ ] `events/legacy-events.js` tem todos os exports `@deprecated`
- [ ] `events/event-validator.js` existe e está integrado
- [ ] 0 bridges manuais em `hooks/bus.js`
- [ ] `npm run lint` ✅
- [ ] `npm run test:unit` ✅

---

## 5. Riscos e Mitigações

| Risco                                          | Probabilidade | Impacto | Mitigação                       |
| ---------------------------------------------- | ------------- | ------- | ------------------------------- |
| EventBus namespace quebra listeners existentes | Média         | Alto    | API aditiva (backward compat)   |
| HookBus adapter perde eventos                  | Média         | Alto    | Testes de paridade antes/depois |
| SDK bridge duplica emissões                    | Média         | Médio   | Verificar todos os .on() sites  |
| Collectors eliminados tinham lógica exclusiva  | Baixa         | Médio   | Diff manual em P04              |
| Event validator bloqueia por engano            | Baixa         | Baixo   | Modo warn (não bloqueia)        |
