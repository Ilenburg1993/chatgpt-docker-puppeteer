# 07 — ACOPLAMENTO ARQUITETURAL

> **Auditoria Profunda `src/copilot/`** | Data: 2026-06-11 | HEAD: `55a4b071`

---

## SUMÁRIO

| Categoria             | Findings |
| --------------------- | -------- |
| Layer Violations      | 8        |
| Circular Dependencies | 6        |
| God Barrels           | 5        |
| Excessive Coupling    | 12       |
| Missing Abstractions  | 7        |
| **Total**             | **38**   |

---

## MAPA DE DEPENDÊNCIAS INTER-MÓDULOS

```
agent       → [audit, config, core, events, hooks, observability, plugins, sdk, tools] (9 deps)
api         → [bridges, config, core, hooks, observability, services]                   (6 deps)
audit       → [core, events, sdk]                                                       (3 deps)
bridges     → [config, core, events, observability, sdk]                                (5 deps)
channel     → [config, core, events, observability]                                     (4 deps)
config      → [core, observability, sdk]                                                (3 deps)
conv-hub    → [core, db, events, observability]                                         (4 deps)
core        → [config]                                                                  (1 dep) ⚠️
db          → [core]                                                                    (1 dep) ✅
events      → [observability]                                                           (1 dep) ⚠️
hooks       → [audit, config, core, events, hooks, observability, sdk, tools]           (8 deps)
infra       → []                                                                        (0 deps) ✅
observ.     → [audit, config, core, events, sdk]                                        (5 deps)
plugins     → [observability]                                                           (1 dep)
sdk         → [core]                                                                    (1 dep) ✅
server      → [agent, audit, config, conv-hub, core, observability, services]           (7 deps) ⚠️
services    → [agent, audit, channel, conv-hub, core, events, observability, sdk, tools](9 deps) ⚠️
terminal    → [api, audit, bridges, config, core, events, observability, sdk, services] (9 deps) ⚠️
tools       → [audit, config, core, db, observability, sdk]                             (6 deps)
types       → []                                                                        (0 deps) ✅
```

### Métricas Aggregadas

| Métrica                                 | Valor                                        |
| --------------------------------------- | -------------------------------------------- |
| Total de arestas (imports inter-módulo) | 95                                           |
| Módulos fan-out > 6                     | 5 (agent, hooks, services, terminal, server) |
| Módulos fan-in > 6                      | 3 (core=17, events=10, observability=14)     |
| Módulos leaf (0 deps)                   | 2 (infra, types)                             |
| Módulos puros (≤1 dep)                  | 5 (db, events, sdk, plugins, infra)          |

---

## AC-1 — LAYER VIOLATIONS (8)

### AC-1-01 — `core/ → config/` (core depende de config)

**Gravidade**: Alta **Esperado**: `core/` deve ser leaf node puro. `config/` deveria depender de
`core/`, não o inverso. **Evidência**: `core/config.js` ou similar importando de `#copilot/config`.
**Fix**: Extrair para interface em `core/`, implementação em `config/`.

### AC-1-02 — `core/index.js` re-exporta de `../events/`

**Gravidade**: Alta

```js
export { AGENT_EVENTS, DIALOG_LOOP_EVENTS } from '../events/agent-events.js';
export { BaseEmitter, createEmitter } from '../events/create-emitter.js';
```

**Fix**: Mover estas exports para `events/index.js`. Consumidores importam diretamente de
`#copilot/events`.

### AC-1-03 — `events/ → observability/`

**Gravidade**: Média **Esperado**: Events é infra pura. Não deveria depender de observability.
**Fix**: Se necessário, observability escuta events — não o contrário.

### AC-1-04 — `config/ → sdk/`

**Gravidade**: Média **Esperado**: Config é foundational, SDK é high-level. **Fix**: Inverter — SDK
configura-se consumindo config.

### AC-1-05 — `server/ → agent/` (7 dos 11 imports server→terminal passam por agent)

**Gravidade**: Alta **Esperado**: Server é adapter layer. Não deveria ter referência direta ao
agent. **Fix**: Server chama `services/`, services chama `agent/`.

### AC-1-06 — `services/ → agent/` (import direto)

**Gravidade**: Média **Esperado**: Services deveria consumir interfaces, não implementações.

### AC-1-07 — `terminal/ → api/` (deprecated dependency)

**Gravidade**: Baixa **Esperado**: Terminal deveria estar desacoplado de api/ (deprecated).

### AC-1-08 — `hooks/ → tools/` (cross-cutting → domain)

**Gravidade**: Média **Esperado**: Hooks são infrastructure. Não deveriam ter conhecimento de tools.

---

## AC-2 — CIRCULAR DEPENDENCIES (6)

### AC-2-01 — `core ↔ config` (bidirectional)

```
core → config  (core/index.js importa de #copilot/config)
config → core  (config imports de #copilot/core)
```

**Fix**: Extrair shared contracts para `types/`.

### AC-2-02 — `events ↔ observability` (bidirectional)

```
events → observability  (events/index.js importa observer)
observability → events  (observability importa event constants)
```

**Fix**: Events define constants, observability consome. Unidirecional.

### AC-2-03 — `hooks ↔ audit` (potential)

```
hooks → audit  (hooks logam em audit)
audit → hooks? (audit pode registrar hooks? verificar)
```

### AC-2-04 — `agent → services → agent` (potential via getAgent())

```
agent exports alwaysAliveAgent
services imports alwaysAliveAgent
agent imports from services (indirectly)
```

**Fix**: Dependency injection via DI container.

### AC-2-05 — `core/di-tokens.js` re-exporta de 9 módulos

**Impacto**: Cria dependência transitiva de core para todos os módulos que definem tokens.

```
core/di-tokens → events/, agent/, server/, terminal/, ...
```

**Fix**: Tokens live no módulo que os define. `di.resolve(TOKEN)` em vez de import centralizado.

### AC-2-06 — `channel/ → channel/` (self-reference)

**Evidência**: channel importa de `#copilot/channel` — barrel self-loop via aliases.

---

## AC-3 — GOD BARRELS (5)

### AC-3-01 — `core/di-tokens.js` — re-exports tokens de 9 módulos

**LOC**: ~200 **Problema**: Single point of coupling. Qualquer mudança recompila core.

### AC-3-02 — `core/index.js` — re-exports de 8+ sub-módulos incluindo events

**LOC**: ~120 **Problema**: Importar `#copilot/core` carrega events, config, DI, schemas.

### AC-3-03 — `events/index.js` — 80+ event constants

**LOC**: ~400 **Problema**: Qualquer novo event type recompila todos os consumidores.

### AC-3-04 — `observability/index.js` — @deprecated mas exporta tudo

**Fix**: Safe-delete (0 importadores).

### AC-3-05 — `agent/index.js` — re-exports da God Class + facades

**Problema**: Import tree activation é grande.

---

## AC-4 — EXCESSIVE COUPLING (12)

### AC-4-01 — `agent/` fan-out = 9 módulos

**Problema**: Agent depende de quase tudo. Mudança em qualquer módulo pode afetar agent.

### AC-4-02 — `services/` fan-out = 9 módulos

**Problema**: Services é hub central mas sem interface contracts.

### AC-4-03 — `terminal/` fan-out = 9 módulos

**Problema**: Terminal depende de 9 módulos incluindo deprecated `api/`.

### AC-4-04 — `hooks/` fan-out = 8 módulos

**Problema**: Cross-cutting concern acoplado a domain modules.

### AC-4-05 — `core/` fan-in = 17 (todos dependem de core)

**Impacto**: Mudança em core propaga para todo o sistema.

### AC-4-06 — `observability/` fan-in = 14

**Impacto**: Troca de observability framework impacta 14 módulos.

### AC-4-07 — `events/` fan-in = 10

**Impacto**: Novo event type requer editar events + todos consumers.

### AC-4-08 — `config/` fan-in = 8

**Impacto**: Config changes impact 8 módulos diretamente.

### AC-4-09 — `sdk/` fan-in = 7

**Impacto**: SDK changes impact 7 módulos.

### AC-4-10 — `bridgeEmitter` used in 325+ files

**Impacto**: Core utility com acoplamento global.

### AC-4-11 — `AlwaysAliveAgent` singleton referenciado em 15+ files

**Fix**: Use `getAgent()` accessor + DI.

### AC-4-12 — `defaultMetrics` singleton referenciado em 25+ files

**Fix**: Inject via DI.

---

## AC-5 — MISSING ABSTRACTIONS (7)

### AC-5-01 — Sem interface `IAgent` (facade contract)

**Fix**: Interface com métodos por domínio — testável, mockável.

### AC-5-02 — Sem interface `IEventBus`

**Fix**: Contract genérico para event bus — permite trocar implementação.

### AC-5-03 — Sem interface `IStateStore`

**Fix**: Abstract state persistence — pode ser file, SQLite, Redis.

### AC-5-04 — Sem interface `IToolRegistry`

**Fix**: Contract para tool registration/execution.

### AC-5-05 — Sem interface `IHooksPipeline`

**Fix**: Contract para hook execution chain.

### AC-5-06 — Sem interface `IConfigProvider`

**Fix**: Contract para config access — permite env, file, remote config.

### AC-5-07 — Sem interface `IMetricsCollector`

**Fix**: Contract para metrics — permite OTEL, Prometheus, custom.

---

## VISUALIZAÇÃO — CAMADAS IDEAIS

```
┌─────────────────────────────────────────────┐
│  server/  terminal/  (Adapters)             │ ← Camada de apresentação
├─────────────────────────────────────────────┤
│  services/  channel/  (Use Cases)           │ ← Orquestração
├─────────────────────────────────────────────┤
│  agent/  conversation-hub/  (Domain)        │ ← Lógica de negócio
├─────────────────────────────────────────────┤
│  sdk/  hooks/  bridges/  (Integration)      │ ← Integração externa
├─────────────────────────────────────────────┤
│  observability/  audit/  (Cross-cutting)    │ ← Transversais
├─────────────────────────────────────────────┤
│  core/  events/  types/  config/  (Found.)  │ ← Fundação
├─────────────────────────────────────────────┤
│  infra/  db/  (Infrastructure)              │ ← Infra pura
└─────────────────────────────────────────────┘

REGRA: Setas só para baixo. Nunca para cima.
```

### Violações da regra:

- `core → config` (sideways)
- `core → events` (sideways)
- `events → observability` (upward)
- `config → sdk` (upward)
- `server → agent` (bypass services)
- `hooks → tools` (upward)
- `terminal → api` (deprecated sideways)

---

_38 findings de acoplamento arquitetural. Próximo: 08-ROADMAP-FAIXAS-FASES.md_
