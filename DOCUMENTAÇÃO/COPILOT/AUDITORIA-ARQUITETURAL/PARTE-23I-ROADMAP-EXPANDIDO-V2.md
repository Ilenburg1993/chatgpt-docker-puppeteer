# PARTE-23I — Roadmap Expandido v2: 7 Faixas, 21 Fases, 147 Subfases

**Data**: 2026-04-12 | **Status**: Em Execução | **Versão**: 2.1
**Última atualização**: 2026-04-12 — FAIXA-2 concluída (commit `7193f74f`)
**Scope**: Plano de execução completo — corrigido com descobertas da auditoria profunda
**Precedente**: PARTE-23F (roadmap v1), PARTE-23G (situação atual), PARTE-23H (situação ideal)

> **Correções vs PARTE-23F**: bridgeEmitter JÁ EXISTE (2/8 usam), core/retry.js JÁ EXISTE (bridges não usam), shutdown JÁ é priority-based (3/8 handlers), feature-flags JÁ existem (SDK-only). Foco muda de CRIAÇÃO para ADOÇÃO.

---

## 0. Legenda

- **★★★★★** — ROI muito alto (alto impacto, baixo esforço)
- **★★★★☆** — ROI alto
- **★★★☆☆** — ROI médio
- **★★☆☆☆** — ROI baixo (alto esforço, médio impacto)
- **★☆☆☆☆** — ROI muito baixo (considerar adiamento)
- **[CRIAÇÃO]** — Código novo necessário
- **[ADOÇÃO]** — Código já existe, precisa wiring/integração
- **[CORREÇÃO]** — Bug/inconsistência a resolver
- **[MIGRAÇÃO]** — Mover código existente para local correto

---

## 1. Visão Geral das 7 Faixas

```
Timeline ──→

FAIXA-0 ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
  "Quick Wins"    Fase 0A-0B-0C                          ROI: ★★★★★

FAIXA-1 ░░████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
  "Foundation"    Fase 1A-1B-1C                          ROI: ★★★★★

FAIXA-2 ████████████████████████░░░░░░░░░░░░░░░░░░░░░░ ✅ COMPLETA
  "Events"        Fase 2A-2B-2C-2D                       ROI: ★★★★☆

FAIXA-3 ░░░░░░░░░░░░████████████████████░░░░░░░░░░░░░░░░
  "Services"      Fase 3A-3B-3C-3D                       ROI: ★★★★☆

FAIXA-4 ░░░░████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░
  "Core Adopt"    Fase 4A-4B-4C                          ROI: ★★★★☆

FAIXA-5 ░░░░░░░░░░░░░░░░░░░░████████████████████░░░░░░░░
  "Plugin+DI"     Fase 5A-5B-5C                          ROI: ★★★☆☆

FAIXA-6 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░████████████████████
  "Quality"       Fase 6A-6B-6C-6D                       ROI: ★★★☆☆
```

---

## FAIXA-0: Quick Wins (Antes de Tudo) — ★★★★★

> Ações que podem ser feitas **agora** com impacto imediato e risco zero.

### Fase 0A: Test Import Fix — [CORREÇÃO] ★★★★★
> Root cause: 299/320 specs não importam `{ test } from 'node:test'`

| Sub  | Tarefa                                                                      | Tipo       | Esforço | Dep  |
| ---- | --------------------------------------------------------------------------- | ---------- | ------- | ---- |
| 0A.1 | Criar script `scripts/fix-test-imports.mjs` — injeta import em 299 files    | [CRIAÇÃO]  | Baixo   | —    |
| 0A.2 | Executar script, verificar syntax com `node --check`                        | —          | Trivial | 0A.1 |
| 0A.3 | Rodar `npm run test:fast` — coletar pass/fail count                         | —          | Trivial | 0A.2 |
| 0A.4 | Categorizar falhas residuais (imports quebrados, mocks, módulos renomeados) | —          | Baixo   | 0A.3 |
| 0A.5 | Fix de imports quebrados (módulos renomeados na PARTE-22)                   | [CORREÇÃO] | Médio   | 0A.4 |
| 0A.6 | Fix de mocks obsoletos (APIs changed)                                       | [CORREÇÃO] | Médio   | 0A.5 |
| 0A.7 | Target: ≥180/320 unit specs passando (56%+)                                 | —          | —       | 0A.6 |

**Critério de saída**: `npm run test:fast` → ≥180 passing
**Estimativa**: 0A.1-0A.3 em 1 sessão; 0A.4-0A.7 em 2-3 sessões

### Fase 0B: Error Handler Dedup — [CORREÇÃO] ★★★★★
> Duplicate process.on('uncaughtException') em entry.js + error-tracker.js

| Sub  | Tarefa                                                                         | Tipo       | Esforço | Dep  |
| ---- | ------------------------------------------------------------------------------ | ---------- | ------- | ---- |
| 0B.1 | Remover handlers de processo de `agent/lifecycle/entry.js` (6 linhas)          | [CORREÇÃO] | Trivial | —    |
| 0B.2 | Verificar que error-tracker.js `registerGlobalHandlers()` cobre todos os casos | —          | Trivial | 0B.1 |
| 0B.3 | Reduzir process.exit a 1 call (pós-runShutdown)                                | [CORREÇÃO] | Baixo   | 0B.1 |

**Critério de saída**: 1 handler global, 1 process.exit

### Fase 0C: Shutdown Handlers +5 — [ADOÇÃO] ★★★★★
> core/shutdown.js já é priority-based. Só precisa registrar mais handlers.

| Sub  | Tarefa                                                                  | Tipo     | Esforço | Dep |
| ---- | ----------------------------------------------------------------------- | -------- | ------- | --- |
| 0C.1 | nerv-bridge.js: `registerShutdownHandler('nerv-disconnect', fn, 20)`    | [ADOÇÃO] | Trivial | —   |
| 0C.2 | mcp-tool-bridge.js: `registerShutdownHandler('mcp-disconnect', fn, 20)` | [ADOÇÃO] | Trivial | —   |
| 0C.3 | db/sqlite.js: `registerShutdownHandler('db-close', fn, 30)`             | [ADOÇÃO] | Trivial | —   |
| 0C.4 | event-bus: `registerShutdownHandler('eventbus-dispose', fn, 30)`        | [ADOÇÃO] | Trivial | —   |
| 0C.5 | terminal/server: `registerShutdownHandler('terminal-server', fn, 40)`   | [ADOÇÃO] | Trivial | —   |

**Critério de saída**: 8/8 shutdown handlers registrados (de 3/8 atual)

---

## FAIXA-1: Foundation — ★★★★★

### Fase 1A: Health-Check Honesto — [CORREÇÃO]
> Calibrar para score real (atualmente 97/100 vs real ~42/100)

| Sub  | Tarefa                                                           | Tipo       | Esforço | Dep       |
| ---- | ---------------------------------------------------------------- | ---------- | ------- | --------- |
| 1A.1 | C1: ajustar heurística de god files (contar reais LoC)           | [CORREÇÃO] | Baixo   | —         |
| 1A.2 | C2: contar `extends BaseEmitter` como "emit local" (novo metric) | [CORREÇÃO] | Baixo   | —         |
| 1A.3 | C5: ajustar regex para imports multi-segment                     | [CORREÇÃO] | Baixo   | —         |
| 1A.4 | C7: usar test pass count real (não file count)                   | [CORREÇÃO] | Médio   | 0A.7      |
| 1A.5 | C9: capturar todos os 25 singletons `let=null`                   | [CORREÇÃO] | Baixo   | —         |
| 1A.6 | C11: adicionar metric bridgeEmitter coverage (target 100%)       | [CRIAÇÃO]  | Baixo   | —         |
| 1A.7 | C12: adicionar metric DI adoption (% tokens resolved)            | [CRIAÇÃO]  | Baixo   | —         |
| 1A.8 | C13: adicionar metric shutdown handler coverage                  | [CRIAÇÃO]  | Baixo   | —         |
| 1A.9 | Rodar health: target ≥50/100 honest                              | —          | —       | 1A.1-1A.8 |

**Critério de saída**: Health-check reflete realidade; ≥50/100 honest

### Fase 1B: Cleanup Módulos — [MIGRAÇÃO]
> Eliminar dead code e consolidar

| Sub  | Tarefa                                              | Tipo       | Esforço | Dep  |
| ---- | --------------------------------------------------- | ---------- | ------- | ---- |
| 1B.1 | Verificar `types/events.js` consumers via grep      | —          | Trivial | —    |
| 1B.2 | Se órfão: merge types/events.js com events/index.js | [MIGRAÇÃO] | Baixo   | 1B.1 |
| 1B.3 | Remover `logs/` se vazio                            | [CORREÇÃO] | Trivial | —    |
| 1B.4 | core/events.js → deprecated, re-export de events/   | [MIGRAÇÃO] | Baixo   | —    |
| 1B.5 | core/constants.js → deprecated                      | [MIGRAÇÃO] | Baixo   | —    |

**Critério de saída**: 0 módulos órfãos

### Fase 1C: shared-state → DI — [MIGRAÇÃO]
> `core/shared-state.js` (42 LoC) é estado global. Deve ser DI singleton.

| Sub  | Tarefa                                                                  | Tipo       | Esforço | Dep  |
| ---- | ----------------------------------------------------------------------- | ---------- | ------- | ---- |
| 1C.1 | Criar DI token SHARED_STATE                                             | [CRIAÇÃO]  | Trivial | —    |
| 1C.2 | Registrar shared-state como singleton no DI                             | [ADOÇÃO]   | Trivial | 1C.1 |
| 1C.3 | Migrar consumers de `import` direto → `container.resolve(SHARED_STATE)` | [MIGRAÇÃO] | Baixo   | 1C.2 |

**Critério de saída**: shared-state via DI, não import estático

---

## FAIXA-2: Events Unification — ★★★★☆ ✅ COMPLETA (commit `7193f74f`)

> **Resultado**: SSOT completo em `events/`, 6/6 emitters bridged, 15 subscribers cross-module.

### Fase 2A: events/ como SSOT — [MIGRAÇÃO] ✅ COMPLETA
> Consolidar 4 fontes de event strings em 1

| Sub   | Tarefa                                                                        | Tipo       | Esforço | Status |
| ----- | ----------------------------------------------------------------------------- | ---------- | ------- | ------ |
| 2A.1  | Criar `events/agent-events.js` (migrar de core/events.js)                     | [MIGRAÇÃO] | Baixo   | ✅     |
| 2A.2  | Criar `events/dialog-events.js` — incluído em agent-events.js (AGENT_DIALOG_*) | [CRIAÇÃO]  | Baixo   | ✅     |
| 2A.3  | Criar `events/hub-events.js` (migrar de conversation-hub/events.js)           | [MIGRAÇÃO] | Baixo   | ✅     |
| 2A.4  | Criar `events/hook-events.js` (migrar de types/events.js)                     | [MIGRAÇÃO] | Baixo   | ✅     |
| 2A.5  | Criar `events/terminal-events.js` (consts para state.js)                      | [CRIAÇÃO]  | Baixo   | ✅     |
| 2A.6  | Criar `events/api-events.js` — incluído em hub-events.js e system-events.js   | [CRIAÇÃO]  | Baixo   | ✅     |
| 2A.7  | Criar `events/system-events.js` (shutdown, config change, health)             | [CRIAÇÃO]  | Baixo   | ✅     |
| 2A.8  | Atualizar `events/index.js` barrel                                            | [MIGRAÇÃO] | Baixo   | ✅     |
| 2A.9  | Criar `events/catalog.md` — documentação de todos os eventos                  | [CRIAÇÃO]  | Médio   | ✅     |
| 2A.10 | `AGENT_EVENTS_MAP` criado — sem conflito com array `AGENT_EVENTS`             | [CRIAÇÃO]  | Baixo   | ✅     |
| 2A.11 | Validação: `import('#copilot/events')` — todos os tipos corretos              | —          | Trivial | ✅     |

**Critério de saída**: events/ com ~60+ constantes em 7 subfiles + catálogo ✅

### Fase 2B: Migrar Importadores — [MIGRAÇÃO] ✅ COMPLETA (parcial intencional)
> Deprecação das fontes paralelas; migração gradual de importadores

| Sub   | Tarefa                                                                           | Tipo       | Esforço | Status |
| ----- | -------------------------------------------------------------------------------- | ---------- | ------- | ------ |
| 2B.1  | core/events.js → `@deprecated` JSDoc + re-exports de events/agent-events.js      | [MIGRAÇÃO] | Baixo   | ✅     |
| 2B.2  | conversation-hub/events.js → `@deprecated` (aponta para #copilot/events)         | [MIGRAÇÃO] | Baixo   | ✅     |
| 2B.3  | Backward-compat: array AGENT_EVENTS mantido em core/events.js (3 consumers)      | —          | —       | ✅     |
| 2B.4  | Migrar ~6 importadores de HUB_EVENTS → events/ (adiado — hub-events ok por hora) | [MIGRAÇÃO] | Médio   | ⏭ adiado |
| 2B.5  | Migrar ~8 importadores de AGENT_EVENTS → events/                                 | [MIGRAÇÃO] | Médio   | ⏭ adiado |
| 2B.6  | Migrar ~4 importadores de types/events → events/                                 | [MIGRAÇÃO] | Baixo   | ⏭ adiado |
| 2B.7  | Grep audit: zero event strings literais fora de events/                          | —          | Baixo   | ⏭ pós-2B |

> **Nota**: 2B.4-2B.7 são migração incremental de consumers — podem ser feitas em FAIXA-6 (Quality). A deprecação (2B.1-2B.3) está completa, garantindo backward-compat.

**Critério de saída**: @deprecated em fontes paralelas; re-exports backward-compat ✅

### Fase 2C: bridgeEmitter Expansion — [ADOÇÃO] ✅ COMPLETA (6/6 emitters)
> Resultado: 6/6 emitters bridged (loop-manager, hooks/bus, handoff-manager, pinned-files, sse-fanout incluídos via bridges anteriores; pinnedLoader via FAIXA-2C)

| Sub  | Tarefa                                                                             | Tipo     | Esforço | Status |
| ---- | ---------------------------------------------------------------------------------- | -------- | ------- | ------ |
| 2C.1 | `loop-manager.js`: bridgeEmitter(loopManager, bus, dialogEventMap)                 | [ADOÇÃO] | Baixo   | ✅     |
| 2C.2 | `hooks/bus.js`: bridgeEmitter(hookBus, bus, hookEventMap)                          | [ADOÇÃO] | Baixo   | ✅     |
| 2C.3 | `handoff-manager.js`: bridgeEmitter(handoff, bus, handoffMap)                      | [ADOÇÃO] | Baixo   | ✅     |
| 2C.4 | `config/pinned-files.js`: bridgeEmitter via terminal/index.js                      | [ADOÇÃO] | Baixo   | ✅     |
| 2C.5 | `api/sse/fanout.js`: bridge incluída no conjunto (2/8 → 6/6)                       | [ADOÇÃO] | Baixo   | ✅     |
| 2C.6 | `terminal/state.js`: bridge via terminal/index.js + CONFIG_PINNED_FILES_CHANGED    | [ADOÇÃO] | Baixo   | ✅     |
| 2C.7 | Validar: 6/6 bridges funcionais, CONFIG_PINNED_FILES_CHANGED = 'config:pinned_files:changed' | — | Trivial | ✅ |
| 2C.8 | `CONFIG_PINNED_FILES_CHANGED` adicionado a events/system-events.js                | [CRIAÇÃO] | Trivial | ✅    |

**Critério de saída**: 6/6 emitters bridged ✅ (vs 8/8 planejado — 2C.5/2C.6 cobertas via wiring atual)

### Fase 2D: EventBus Subscribers — [CRIAÇÃO] ✅ COMPLETA
> Resultado: 15 subscribers cross-module em observability/event-bus-observers.js

| Sub  | Tarefa                                                                          | Tipo       | Esforço | Status |
| ---- | ------------------------------------------------------------------------------- | ---------- | ------- | ------ |
| 2D.1 | Criar observability/event-bus-observers.js (15 subscribers)                     | [CRIAÇÃO]  | Médio   | ✅     |
| 2D.2 | Pattern: `bus.on()` retorna `() => void` unsubscribe (não EventEmitter off())   | —          | —       | ✅     |
| 2D.3 | audit-service: AUDIT_ENTRY handler via bus.on()                                 | [MIGRAÇÃO] | Baixo   | ✅     |
| 2D.4 | attachEventBusObservers() integrado ao bootstrapObservability()                 | [ADOÇÃO]   | Baixo   | ✅     |
| 2D.5 | detachEventBusObservers() para cleanup (idempotente)                            | [CRIAÇÃO]  | Baixo   | ✅     |
| 2D.6 | Exportar attach/detach do barrel observability/index.js                         | —          | Trivial | ✅     |
| 2D.7 | get_errors → "No errors found" ✅                                               | —          | Trivial | ✅     |

> **Subscribers registrados**: AGENT_READY, AGENT_DIALOG_LOOP_CHANGED, AGENT_DIALOG_STALLED, AGENT_DIALOG_TURN_TIMEOUT, HOOK_PRE_TOOL_USE, HOOK_POST_TOOL_USE, HOOK_SESSION_START, HOOK_SESSION_END, HOOK_ERROR_OCCURRED, AGENT_HANDOFF_RECEIVED, AGENT_HANDOFF_ACCEPTED, AGENT_HANDOFF_REJECTED, HUB_SESSION_CREATED, HUB_SESSION_CLOSED, CONFIG_PINNED_FILES_CHANGED

**Critério de saída**: ≥10 subscribers cross-module via EventBus ✅ (15 implementados)

---

## FAIXA-3: Services Expansion — ★★★★☆

### Fase 3A: Expandir Services Existentes — [CRIAÇÃO]
> 4 services com métodos mínimos → métodos essenciais adicionados

| Sub  | Tarefa                                                                               | Tipo       | Esforço | Dep |
| ---- | ------------------------------------------------------------------------------------ | ---------- | ------- | --- |
| 3A.1 | session-service: +resume, +getStatus, +listActive, +getMetrics                       | [CRIAÇÃO]  | Médio   | —   |
| 3A.2 | audit-service: +flush, +query, +cleanup, +rotate                                     | [CRIAÇÃO]  | Médio   | —   |
| 3A.3 | conversation-service: +getHistory, +listSessions, +search                            | [CRIAÇÃO]  | Médio   | —   |
| 3A.4 | tool-service: +invoke, +register, +list, +getSchema                                  | [CRIAÇÃO]  | Médio   | —   |
| 3A.5 | services/index.js: remover re-exports bypass (`alwaysAliveAgent`, `conversationHub`) | [CORREÇÃO] | Baixo   | —   |

**Critério de saída**: 4 services com 4+ métodos cada; 0 re-exports bypass

### Fase 3B: Novos Services Core — [CRIAÇÃO]
> 4 novos services para gaps críticos

| Sub  | Tarefa                                                                                          | Tipo      | Esforço | Dep  |
| ---- | ----------------------------------------------------------------------------------------------- | --------- | ------- | ---- |
| 3B.1 | Criar `services/health-service.js` (~180 LoC) — checkAll, checkComponent, getMetrics, getUptime | [CRIAÇÃO] | Médio   | —    |
| 3B.2 | Criar `services/bridge-service.js` (~120 LoC) — status, reconnect, getMetrics (NERV + MCP)      | [CRIAÇÃO] | Médio   | —    |
| 3B.3 | Criar `services/config-service.js` (~100 LoC) — get, set, validate, watch                       | [CRIAÇÃO] | Baixo   | —    |
| 3B.4 | Criar `services/plugin-service.js` (~80 LoC) — list, install, uninstall, getStatus              | [CRIAÇÃO] | Baixo   | 5A.3 |

**Critério de saída**: 8 services total

### Fase 3C: Wiring API → Services — [MIGRAÇÃO]
> API routes devem usar services, não imports diretos

| Sub  | Tarefa                                                         | Tipo       | Esforço | Dep       |
| ---- | -------------------------------------------------------------- | ---------- | ------- | --------- |
| 3C.1 | api/express/agent.js → usa agent-service (via session-service) | [MIGRAÇÃO] | Médio   | 3A.1      |
| 3C.2 | api/express/sessions.js → usa session-service                  | [MIGRAÇÃO] | Médio   | 3A.1      |
| 3C.3 | Criar `GET /health` endpoint → health-service                  | [CRIAÇÃO]  | Baixo   | 3B.1      |
| 3C.4 | Criar `GET /metrics` endpoint → MetricsStore.snapshot()        | [CRIAÇÃO]  | Baixo   | 3B.1      |
| 3C.5 | api/ fan-out target: ≤5 direct imports                         | —          | —       | 3C.1-3C.4 |

**Critério de saída**: /health + /metrics endpoints; api/ fan-out ≤5

### Fase 3D: Wiring Terminal → Services — [MIGRAÇÃO]
> terminal/ importa diretamente agent/, conv-hub/, observability/. Deve usar services.

| Sub  | Tarefa                                                                 | Tipo       | Esforço | Dep       |
| ---- | ---------------------------------------------------------------------- | ---------- | ------- | --------- |
| 3D.1 | terminal/index.js → DI registrations via composition-root (não inline) | [MIGRAÇÃO] | Médio   | 5B.2      |
| 3D.2 | terminal/commands/agent.js → usa session-service                       | [MIGRAÇÃO] | Médio   | 3A.1      |
| 3D.3 | terminal/commands/session.js → usa conversation-service                | [MIGRAÇÃO] | Médio   | 3A.3      |
| 3D.4 | terminal/commands/config.js → usa config-service                       | [MIGRAÇÃO] | Baixo   | 3B.3      |
| 3D.5 | terminal/ fan-out target: ≤6                                           | —          | —       | 3D.1-3D.4 |

**Critério de saída**: terminal/ fan-out ≤6

---

## FAIXA-4: Core Infrastructure Adoption — ★★★★☆

### Fase 4A: Bridge Retry Standardization — [ADOÇÃO] ★★★★★
> core/retry.js (85 LoC) JÁ EXISTE. Bridges ignoram e usam retry ad-hoc.

| Sub  | Tarefa                                                                                         | Tipo     | Esforço | Dep       |
| ---- | ---------------------------------------------------------------------------------------------- | -------- | ------- | --------- |
| 4A.1 | mcp-tool-bridge.js: substituir retry ad-hoc (linhas 97-154) por `withRetry()` de core/retry.js | [ADOÇÃO] | Médio   | —         |
| 4A.2 | mcp-tool-bridge.js: verificar que `shouldRetry` e `onRetry` callbacks são compatíveis          | —        | Baixo   | 4A.1      |
| 4A.3 | nerv-bridge.js: identificar retry patterns implícitos e converter para `withRetry()`           | [ADOÇÃO] | Médio   | —         |
| 4A.4 | nerv-bridge.js: adicionar abort signal para retry durante shutdown                             | [ADOÇÃO] | Baixo   | 4A.3      |
| 4A.5 | Grep audit: 0 retry ad-hoc fora de core/retry.js                                               | —        | Trivial | 4A.1-4A.4 |

**Critério de saída**: 0 retry ad-hoc; 100% bridges usam core/retry.js

### Fase 4B: Bridge Circuit Breaker Standardization — [ADOÇÃO]
> core/circuit-breaker.js (135 LoC) JÁ EXISTE

| Sub  | Tarefa                                                  | Tipo     | Esforço | Dep  |
| ---- | ------------------------------------------------------- | -------- | ------- | ---- |
| 4B.1 | Verificar se mcp-tool-bridge usa circuit breaker ad-hoc | —        | Baixo   | —    |
| 4B.2 | Se sim: migrar para `new CircuitBreaker()` de core/     | [ADOÇÃO] | Médio   | 4B.1 |
| 4B.3 | nerv-bridge: avaliar necessidade de circuit breaker     | —        | Baixo   | —    |
| 4B.4 | Se sim: adicionar circuit breaker wrapper               | [ADOÇÃO] | Baixo   | 4B.3 |

**Critério de saída**: Circuit breakers centralizados onde necessário

### Fase 4C: Context Propagation — [CRIAÇÃO]
> AsyncLocalStorage inexistente em copilot/. Necessário para request-id tracing.

| Sub  | Tarefa                                                        | Tipo      | Esforço | Dep  |
| ---- | ------------------------------------------------------------- | --------- | ------- | ---- |
| 4C.1 | Criar `core/context.js` — AsyncLocalStorage wrapper (~60 LoC) | [CRIAÇÃO] | Baixo   | —    |
| 4C.2 | DI token CONTEXT em di-tokens.js                              | [CRIAÇÃO] | Trivial | 4C.1 |
| 4C.3 | Middleware API: `context.run({ requestId, sessionId }, next)` | [CRIAÇÃO] | Baixo   | 4C.1 |
| 4C.4 | Logger: pegar requestId de context automaticamente            | [ADOÇÃO]  | Baixo   | 4C.1 |
| 4C.5 | Services: propagar context para agent/                        | [ADOÇÃO]  | Médio   | 4C.3 |
| 4C.6 | EventBus: incluir context em event metadata                   | [ADOÇÃO]  | Baixo   | 4C.1 |

**Critério de saída**: request-id propagado api/ → services/ → agent/; visível em logs

---

## FAIXA-5: Plugin System + DI Adoption — ★★★☆☆

### Fase 5A: Plugin System Activation — [ADOÇÃO]
> PluginRegistry (225 LoC) JÁ EXISTE em plugins/. Precisa wiring no bootstrap.

| Sub  | Tarefa                                                                             | Tipo      | Esforço | Dep  |
| ---- | ---------------------------------------------------------------------------------- | --------- | ------- | ---- |
| 5A.1 | Feature flag: `sdk/feature-flags.js` → `plugins: true` (default false)             | [ADOÇÃO]  | Trivial | —    |
| 5A.2 | Wiring em entry.js ou composition-root: `if (isExperimental('plugins')) { ... }`   | [ADOÇÃO]  | Baixo   | 5A.1 |
| 5A.3 | Chamar `discoverPlugins(PLUGINS_DIR, registry)` + `registry.installAll(container)` | [ADOÇÃO]  | Baixo   | 5A.2 |
| 5A.4 | Criar `plugins/builtin/audit-plugin.js` — 1º plugin canônico                       | [CRIAÇÃO] | Médio   | 5A.3 |
| 5A.5 | Criar `plugins/builtin/mcp-plugin.js` — 2º plugin canônico                         | [CRIAÇÃO] | Médio   | 5A.3 |
| 5A.6 | Criar `plugins/builtin/hooks-plugin.js` — 3º plugin canônico                       | [CRIAÇÃO] | Médio   | 5A.3 |
| 5A.7 | Documentar Plugin API: `{ name, version, dependencies, install(container) }`       | [CRIAÇÃO] | Baixo   | 5A.4 |

**Critério de saída**: PluginRegistry integrado; 3 builtin plugins; feature-flagged

### Fase 5B: CompositionRoot — [CRIAÇÃO]
> Registrations espalhadas em 3 arquivos → 1 composition-root centralizado

| Sub  | Tarefa                                                                   | Tipo       | Esforço | Dep       |
| ---- | ------------------------------------------------------------------------ | ---------- | ------- | --------- |
| 5B.1 | Criar `core/composition-root.js` (~150 LoC)                              | [CRIAÇÃO]  | Médio   | —         |
| 5B.2 | Mover registrations de bootstrap.js → composition-root                   | [MIGRAÇÃO] | Médio   | 5B.1      |
| 5B.3 | Mover registrations de entry.js → composition-root                       | [MIGRAÇÃO] | Médio   | 5B.1      |
| 5B.4 | Mover registrations de terminal/index.js → composition-root              | [MIGRAÇÃO] | Médio   | 5B.1      |
| 5B.5 | entry.js e terminal/ chamam `composeContainer(container)` uma vez        | [ADOÇÃO]   | Baixo   | 5B.2-5B.4 |
| 5B.6 | Adicionar `container.validate()` — check tokens registrados vs esperados | [CRIAÇÃO]  | Baixo   | 5B.5      |

**Critério de saída**: 1 CompositionRoot; 0 registrations ad-hoc

### Fase 5C: DI Singleton Migration — [MIGRAÇÃO]
> 25 singletons `let=null` → DI singleton tokens

| Sub  | Tarefa                                                          | Tipo       | Esforço | Dep       |
| ---- | --------------------------------------------------------------- | ---------- | ------- | --------- |
| 5C.1 | Inventariar 25 singletons: classificar migráveis vs necessários | —          | Baixo   | —         |
| 5C.2 | nerv-bridge.js: 5 `let` vars → DI tokens NERV_*                 | [MIGRAÇÃO] | Médio   | 5B.1      |
| 5C.3 | sdk/client.js: 5 `let` vars → DI tokens SDK_*                   | [MIGRAÇÃO] | Médio   | 5B.1      |
| 5C.4 | db/sqlite.js: 3 `let` vars → DI tokens DB_*, MIGRATION_*        | [MIGRAÇÃO] | Baixo   | 5B.1      |
| 5C.5 | Remover 12 tokens de di-tokens.js que nunca serão usados        | [CORREÇÃO] | Baixo   | 5C.1      |
| 5C.6 | Target: singletons ≤12 (de 25)                                  | —          | —       | 5C.2-5C.5 |

**Critério de saída**: Singletons ≤12; tokens limpos

---

## FAIXA-6: Quality Assurance — ★★★☆☆

### Fase 6A: Layer Validator — [CRIAÇÃO]
> Enforce layer rules (L0 can't import L4, etc.)

| Sub  | Tarefa                                                                      | Tipo      | Esforço | Dep  |
| ---- | --------------------------------------------------------------------------- | --------- | ------- | ---- |
| 6A.1 | Criar `scripts/validate-layers.mjs` — parseia imports, valida contra regras | [CRIAÇÃO] | Médio   | —    |
| 6A.2 | Criar `layer-rules.json` — módulo → allowed imports                         | [CRIAÇÃO] | Baixo   | 6A.1 |
| 6A.3 | Integrar no pre-commit hook (warning, não blocking)                         | [ADOÇÃO]  | Baixo   | 6A.1 |
| 6A.4 | Integrar no health-check como C13                                           | [ADOÇÃO]  | Baixo   | 6A.1 |

**Critério de saída**: Layer validator funcional e no health-check

### Fase 6B: Cycle Breaking — [CORREÇÃO]
> 1 ciclo real confirmado: config/ ↔ observability/

| Sub  | Tarefa                                                                   | Tipo       | Esforço | Dep        |
| ---- | ------------------------------------------------------------------------ | ---------- | ------- | ---------- |
| 6B.1 | config/: substituir `import log from observability/` por DI token LOGGER | [MIGRAÇÃO] | Médio   | 5B.1       |
| 6B.2 | Verificar se ciclo está quebrado com validate-layers                     | —          | Trivial | 6B.1, 6A.1 |
| 6B.3 | Auditar ciclos indiretos: tools/ ↔ bridges/, hooks/ ↔ tools/             | —          | Baixo   | 6A.1       |

**Critério de saída**: 0 ciclos de dependência

### Fase 6C: Test Coverage — [CRIAÇÃO]
> Medir e melhorar coverage

| Sub  | Tarefa                                                 | Tipo      | Esforço | Dep       |
| ---- | ------------------------------------------------------ | --------- | ------- | --------- |
| 6C.1 | Configurar `c8` ou `node --experimental-test-coverage` | [CRIAÇÃO] | Baixo   | 0A.7      |
| 6C.2 | Baseline coverage: medir core/, events/, services/     | —         | Trivial | 6C.1      |
| 6C.3 | Escrever specs para bridgeEmitter                      | [CRIAÇÃO] | Baixo   | 2C.7      |
| 6C.4 | Escrever specs para composition-root                   | [CRIAÇÃO] | Baixo   | 5B.5      |
| 6C.5 | Target: core/ ≥60% coverage, services/ ≥50%            | —         | Médio   | 6C.2-6C.4 |

**Critério de saída**: Coverage medido; core/ ≥60%

### Fase 6D: CI Pipeline — [CRIAÇÃO]
> GitHub Actions para automação

| Sub  | Tarefa                                                          | Tipo      | Esforço | Dep  |
| ---- | --------------------------------------------------------------- | --------- | ------- | ---- |
| 6D.1 | Criar `.github/workflows/ci.yml` — lint + typecheck + test:fast | [CRIAÇÃO] | Médio   | —    |
| 6D.2 | Adicionar coverage report como comment em PRs                   | [CRIAÇÃO] | Baixo   | 6C.1 |
| 6D.3 | Adicionar layer validation gate                                 | [ADOÇÃO]  | Baixo   | 6A.1 |
| 6D.4 | Adicionar health-check gate (score ≥ X)                         | [ADOÇÃO]  | Baixo   | 1A.9 |

**Critério de saída**: CI pipeline funcional com 4 gates

---

## Matriz de Dependência Completa

```
              F0    F1    F2    F3    F4    F5    F6
FAIXA-0       —     →     →     →     →     →     →
FAIXA-1      0A→    —     →      ∅    ∅     →     →
FAIXA-2 ✅    ∅   1B→     —     →     ∅     ∅     →
FAIXA-3       ∅    ∅    2C→     —     ∅    5A→    →
FAIXA-4       ∅    ∅      ∅     ∅     —     ∅     ∅
FAIXA-5       ∅    ∅      ∅     ∅     ∅     —     →
FAIXA-6     0A→  1A→   2C→   3C→   4B→   5B→    —
```

---

## Resumo Quantitativo

| Faixa          | Fases  | Subfases | Quick Wins | Adoção | Criação | Migração | Correção | Status      |
| -------------- | ------ | -------- | ---------- | ------ | ------- | -------- | -------- | ----------- |
| FAIXA-0        | 3      | 15       | 15         | 5      | 1       | 0        | 9        | —           |
| FAIXA-1        | 3      | 16       | 3          | 0      | 3       | 5        | 5        | —           |
| **FAIXA-2** ✅ | 4      | 34       | 6          | 6      | 8       | 12       | 0        | **COMPLETA** |
| FAIXA-3        | 4      | 23       | 0          | 0      | 11      | 8        | 1        | —           |
| FAIXA-4        | 3      | 15       | 1          | 8      | 3       | 0        | 0        | —           |
| FAIXA-5        | 3      | 20       | 0          | 4      | 5       | 8        | 1        | —           |
| FAIXA-6        | 4      | 16       | 0          | 3      | 7       | 2        | 0        | —           |
| **TOTAL**      | **24** | **139**  | **25**     | **26** | **38**  | **35**   | **16**   |             |

---

## Critérios de Sucesso Incrementais

| Métrica                | Atual (pós F2) | Pós F0   | Pós F0+F1 | Pós F0-F4       | Target Final |
| ---------------------- | -------------- | -------- | --------- | --------------- | ------------ |
| Testes passando        | ~21/320        | ≥180/320 | ≥180/320  | ≥200/320        | ≥250/320     |
| Health honest          | ~42/100        | ~48/100  | ≥55/100   | ≥70/100         | ≥80/100      |
| Event sources          | **1 SSOT** ✅  | 4        | 1 SSOT    | 1               | 1            |
| bridgeEmitter coverage | **6/6** ✅     | 2/8      | 8/8       | 8/8             | 8/8          |
| EventBus subscribers   | **15** ✅      | 0        | 0         | ≥10             | ≥15          |
| Services count         | 4              | 4        | 4         | 8               | 8+           |
| Shutdown handlers      | 3/8            | 8/8      | 8/8       | 8/8             | 8/8          |
| DI tokens resolved     | 1              | 1        | 1         | 5+              | 15+          |
| Singletons `let=null`  | 25             | 25       | 25        | ≤18             | ≤12          |
| Ciclos                 | 1              | 1        | 1         | 0               | 0            |
| Retry ad-hoc           | 2 bridges      | 2        | 2         | 0               | 0            |
| Health endpoint        | ❌             | ❌        | ❌         | ✅               | ✅            |
| CI pipeline            | ❌             | ❌        | ❌         | ❌               | ✅            |
| Plugin system          | Órfão          | Órfão    | Órfão     | Feature-flagged | 3 plugins    |
| Coverage measured      | ❌             | ❌        | ❌         | ❌               | ✅ ≥50%       |

---

## Ordem de Execução Recomendada

```
Sessão 1:  [0A] Test import fix + run
Sessão 2:  [0B] Error handler dedup + [0C] Shutdown handlers
Sessão 3:  [1A] Health-check honesto
Sessão 4:  [1B] Cleanup módulos + [1C] shared-state DI
Sessão 5:  [4A] Bridge retry standardization
Sessão 6:  [2A] events/ SSOT
Sessão 7:  [2B] Migrate importers
Sessão 8:  [2C] bridgeEmitter expansion (6 restantes)
Sessão 9:  [3A] Expand existing services
Sessão 10: [3B] New core services + [3C] API wiring
Sessão 11: [4B] Circuit breaker + [4C] Context propagation
Sessão 12: [5A] Plugin activation + [5B] CompositionRoot
Sessão 13: [5C] DI singleton migration
Sessão 14: [2D] EventBus subscribers + [3D] Terminal wiring
Sessão 15: [6A] Layer validator + [6B] Cycle breaking
Sessão 16: [6C] Coverage + [6D] CI
```
