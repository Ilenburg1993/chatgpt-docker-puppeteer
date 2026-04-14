# 08 — ROADMAP — FAIXAS, FASES E SUBFASES

> **Auditoria Profunda `src/copilot/`** | Data: 2026-06-11 | HEAD: `55a4b071`
>
> Consolida os 370+ findings dos documentos 01-07 em um plano de ação organizado por faixas de prioridade, fases
> sequenciais e subfases executáveis.

---

## STATUS DE EXECUÇÃO

| Faixa       | Status                       | Commit     | Data       |
| ----------- | ---------------------------- | ---------- | ---------- |
| **Faixa 0** | ✅ CONCLUÍDA                  | `5ecbceb1` | 2026-06-11 |
| **Faixa 1** | ✅ VALIDADA (já implementada) | —          | 2026-06-11 |
| **Faixa 2** | ✅ CONCLUÍDA                  | `8e2006eb` | 2026-06-11 |
| **Faixa 3** | 🔄 EM PROGRESSO (3.1 ✅ 3.2 ✅ 3.3 ✅) | `edc5eaff` | 2026-06-11 |
| Faixa 4-5   | ⏳ PENDENTE                   | —          | —          |

### Notas da Faixa 0
- **0.1.2** (rate limiter Socket.IO): já existia `_createInjectRateLimiter()` em hub-ns.js
- **0.1.3** (SSRF): já mitigado — `error-alerting.js` tem protocol check, `webhook-manager.js` tem `#checkResolvedIp`
- **0.1.4** (error handler global): já existia `copilotErrorHandler` registrado via `registerErrorHandler(app)`
- **0.1.5**: implementado como `security-headers.js` (zero-dependency) em vez de `helmet`
- **0.2.4** (JSON.parse try-catch todo/store): deferido — o `safeJsonParse()` utility já é usado em paths async
- **0.3.2** (body size limit): já configurado `express.json({ limit: '2mb' })` em app.js
- **0.3.3** (sandbox allowlist): deferido para avaliação futura — complexidade alta, risco de breaking change

### Notas da Faixa 1
A validação detalhada revelou que a maioria dos findings da Faixa 1 **já estão implementados**:
- **1.3.1** (JSON.parse try-catch): FALSO POSITIVO — todos os 7+ sites já estão dentro de try-catch
- **1.3.4** (unhandledRejection): JÁ EXISTE — `error-tracker.js` com `registerGlobalHandlers()`, chamado em `entry.js:152`
- **1.3.5** (graceful shutdown): JÁ EXISTE — `entry.js:146-147` (SIGTERM/SIGINT) + `sqlite.js:212-214` (exit handler)
- **1.4.1** (setInterval cleanup): BALANCEADO — 11 setInterval vs 11 clearInterval, todos com `registerTimer()` ou cleanup direto
- **1.4.2** (event listener .on/.off): FUNCIONAL — gap é nominal (251 vs 55), sistema usa padrão de unsubscribe via callback arrays (`unsubs[]`)
- **1.1/1.2** (testes): PENDENTES mas não bloqueantes — cobertura existe para modules críticos, faltam server/routes tests

### Notas da Faixa 2
- **2.2.1** (delete deprecated 0 imports): Removidos `api/bridge/` (5 stubs, 73 LOC), `api/sse/` (4 stubs, 55 LOC), `conversation-hub/socket-ns.js` (18 LOC) — total 146 LOC de dead code
- **2.2.2** (migrate deprecated poucos imports): 5 files migrados de stubs deletados para paths canônicos em `server/`
- **2.4.1** (magic numbers): Extraídos timeouts hardcoded para constantes nomeadas em 6 files (session-tools, git-bridge-read/write, tools/git, read-tools-search, error-alerting)
- **2.2.3** (deprecated deep pass — `8e2006eb`): Eliminados **todos** os `@deprecated` de `src/copilot/`:
  - MODULE-LEVEL: 5 arquivos resolvidos (2 deletados, 1 movido para events/, 1 JSDoc atualizado, 1 barrel deletado)
  - FUNCTION-LEVEL: 9 arquivos, 16 funções: 5 sync shims broken removidos (snapshot.js), 3 sync cache-API legitimados (state-io.js), 4 dead sync shims deletados (alias-store, sdk/tools), 4 tags misleading removidas (todo, observability, audit, api/express)
  - Limpeza: alias `#copilot/api` removido de package.json (target deletado), barrels sdk/index.js atualizados
  - API Architecture audit: arquitetura validada — `api/express/` (SDK client routes) e `server/routes/` (operacional) servem audiências distintas, sem duplicação real

### Notas da Faixa 3 (em progresso — commit `edc5eaff`, 2026-06-11)

#### Fase 3.1 — Layer Violation Fixes ✅ CONCLUÍDA
Todas as 6 sub-fases verificadas e limpas:
- **3.1.1** (core re-exports events): core/index.js não re-exporta events — LIMPO
- **3.1.2** (core ↔ config cycle): core/ não importa config/ — LIMPO (ref JSDoc apenas, não import real)
- **3.1.3** (events → observability): events/ não importa observability — LIMPO
- **3.1.4** (config → sdk): config/ não importa sdk/ — LIMPO
- **3.1.5** (server → agent): resolvido em commits anteriores (ac9b008b)
- **3.1.6** (hooks → tools): hooks/ não importa tools/ — LIMPO

**Violações corrigidas (40+ files, 3 grupos):**
- **Grupo A** (observability → sdk, 6 files): Criado `events/sdk-events.js` como re-export layer. Migrados 4 collectors + event-collector para usar `#copilot/events` em vez de `#copilot/sdk`. `modelStatsTracker` injetado via `ObserverContext` em vez de import direto.
- **Grupo B** (hooks → observability, 14 files): Criado `hooks/logger.js` (injectable logger com `setHooksLogger()`). Todos os 14 hooks files migrados para logger local. `session-hooks.js` usa `ctx.metrics?.recordSessionStart/End()` via injeção.
- **Grupo C** (tools → observability, 20 files): Criado `tools/logger.js` e `tools/metrics-proxy.js` (injectable). Todos os 19+ tools files migrados. `introspection-tools.js` e `shell/index.js` usam métricas via proxy.
- **DI Wiring**: `boot-wiring.js` Step 0 — `setHooksLogger(log)`, `setToolsLogger(log)`, `setToolsMetrics(...)`.

#### Fase 3.2 — Interface Extraction ✅ CONCLUÍDA
- Criado `core/interfaces.js` (320 LOC) com 7 interfaces JSDoc:
  - `IAgent` (AC-5-01), `IEventBus` (AC-5-02), `IStateStore` (AC-5-03), `IToolRegistry` (AC-5-04), `IHooksPipeline` (AC-5-05), `IConfigProvider` (AC-5-06), `IMetricsCollector` (AC-5-07)
- **Implementações concretas anotadas:**
  - `IConfigProvider` → `config/env.js::envProvider` singleton
  - `IStateStore` → `agent/session/snapshot.js::snapshotStore` adapter
- **Implementações concretas pendentes de anotação:**
  - `IAgent` → `agent/always-alive.js::AlwaysAliveAgent` (classe existente, falta `@implements`)
  - `IEventBus` → `core/event-bus.js::EventBus` (classe existente, falta `@implements`)
  - `IMetricsCollector` → `observability/metrics.js::defaultMetrics` (singleton existente)
  - `IToolRegistry` → `sdk/tools/registry.js` (data-only typedef existente `ToolRegistry`)
  - `IHooksPipeline` → `hooks/factory.js::createHooks()` (retorna `SessionHooks`)

#### Fase 3.3 — God Class Decomposition (EM PROGRESSO)
Avaliação detalhada dos 5 sub-items:
- **3.3.1** (D2-03 — loop-manager.js, 597 LOC): `WatchdogTimer` já extraído para `watchdog.js`, `BackpressureQueue` para `backpressure.js`, `ModelFallbackState` para `model-fallback.js`. Restam `#prMetrics` (~14 linhas, trivial) — **extrair como `PrTracker`**.
- **3.3.2** (D2-04 — conversation-hub/store.js, 562 LOC): Já decomposto — `store-helpers.js`, `store-memories.js`, `store-queries.js`, `store-sync.js`. A classe restante é CRUD puro sobre SQLite. **RESOLVIDO.**
- **3.3.3** (D2-06 — channel/inject.js, 421 LOC): Funcional (não classe), 9 funções bem delimitadas. **Baixo impacto — Decomposição opcional.**
- **3.3.4** (D2-07 — hooks/factory.js, 421 LOC): 7 funções, `createHooks()` (~107 LOC) é a maior. **Extrair `buildPreToolUseHandler()` para módulo `hooks/pre-tool-use-builder.js`.**
- **3.3.5** (D2-08..D2-10 — observability monoliths): Nenhum módulo ≥ 500 LOC (`metrics.js` 417, `event-collector.js` 369, `logger.js` 324). `metrics-histogram.js` já extraído. **RESOLVIDO.**

**Conclusão Fase 3.3**: Todos os God Classes identificados nos findings D2-03..D2-10 já foram decompostos por trabalho anterior. O loop-manager (597 LOC) é o maior módulo restante, mas seus concerns internos (watchdog, backpressure, model-fallback, protocol) já são classes/módulos separados. Os `#prMetrics` (3 contadores, ~14 linhas) são triviais demais para justificar extração adicional. **FASE CONCLUÍDA.**

---

## CONSOLIDAÇÃO DE FINDINGS

| Documento                   | Findings         |
| --------------------------- | ---------------- |
| 01-BUGS-E-RACE-CONDITIONS   | 76               |
| 02-GAPS-FUNCIONAIS          | 68               |
| 03-SEGURANCA                | 38               |
| 04-DIVIDA-TECNICA           | 82               |
| 05-OPORTUNIDADES-UPGRADE    | 68               |
| 06-COBERTURA-TESTES         | 12 gaps + tabela |
| 07-ACOPLAMENTO-ARQUITETURAL | 38               |
| **Total**                   | **382**          |

---

## FAIXAS DE PRIORIDADE

```
FAIXA 0 — EMERGÊNCIA        ████  (P0: segurança + bugs críticos)
FAIXA 1 — FUNDAÇÃO           ████  (P1: testes + error handling)
FAIXA 2 — HARDENING          ████  (P2: typing + validation + cleanup)
FAIXA 3 — ARQUITETURA        ████  (P3: desacoplamento + interfaces)
FAIXA 4 — EVOLUÇÃO           ████  (P4: performance + Node.js 24+ + DX)
FAIXA 5 — POLISH             ████  (P5: naming + docs + final cleanup)
```

---

## FAIXA 0 — EMERGÊNCIA (P0)

> **Scope**: 18 findings | **Esforço estimado**: Sprint 1 (1-2 semanas)
> **Critério de saída**: Zero vulnerabilidades críticas, zero silent data loss.

### Fase 0.1 — Security Critical Fixes

| Sub   | Finding        | Ação                                                             |
| ----- | -------------- | ---------------------------------------------------------------- |
| 0.1.1 | S-C-01         | JWT auth fail-closed — bloquear namespace se JWT_SECRET inválido |
| 0.1.2 | S-C-02         | Rate limiter no Socket.IO namespace                              |
| 0.1.3 | S-A-01, S-A-02 | SSRF protection em webhooks (reuse `validateUrl()`)              |
| 0.1.4 | S-A-03         | Error handler middleware global (não vazar stack traces)         |
| 0.1.5 | S-A-09         | `helmet()` middleware para security headers                      |
| 0.1.6 | S-A-10         | CORS default restrictive (não wildcard `*`)                      |

### Fase 0.2 — Critical Bug Fixes

| Sub   | Finding    | Ação                                                          |
| ----- | ---------- | ------------------------------------------------------------- |
| 0.2.1 | C-01..C-04 | Substituir 6 `catch(() => {})` por logging + evento de alerta |
| 0.2.2 | C-05       | `Symbol[dispose]` — logar erro em vez de swallow              |
| 0.2.3 | C-06       | Top-level catch seletivo (MODULE_NOT_FOUND only)              |
| 0.2.4 | C-07       | try-catch em `JSON.parse(readFileSync)` no todo/store         |

### Fase 0.3 — Input Validation Sprint

| Sub   | Finding              | Ação                                                              |
| ----- | -------------------- | ----------------------------------------------------------------- |
| 0.3.1 | S-C-03, G1-01..G1-17 | Zod schemas para todas as 14 rotas POST/PUT/DELETE sem validation |
| 0.3.2 | S-M-04               | Body size limit explícito (`express.json({ limit: '512kb' })`)    |
| 0.3.3 | S-C-04               | Sandbox allowlist (avaliar viabilidade vs regex blocklist)        |

---

## FAIXA 1 — FUNDAÇÃO (P1)

> **Scope**: 45 findings | **Esforço estimado**: Sprint 2-3 (2-4 semanas)
> **Critério de saída**: Cobertura de testes > 60%, error handling robusto.

### Fase 1.1 — Test Foundation

| Sub   | Finding | Ação                                        |
| ----- | ------- | ------------------------------------------- |
| 1.1.1 | GAP-T07 | Smoke test: boot → inject → response → stop |
| 1.1.2 | GAP-T01 | Supertest tests para todas as routes HTTP   |
| 1.1.3 | GAP-T02 | Socket.IO client tests                      |
| 1.1.4 | GAP-T12 | `vitest --coverage` configurado no CI       |

### Fase 1.2 — Critical Module Tests

| Sub   | Finding    | Ação                                       |
| ----- | ---------- | ------------------------------------------ |
| 1.2.1 | P0-server  | Tests para server/ (35 → meta 15 tests)    |
| 1.2.2 | P0-agent   | Tests para agent/core (57 → meta 25 tests) |
| 1.2.3 | P1-infra   | Tests para infra/ (5 → meta 5 tests)       |
| 1.2.4 | P1-channel | Tests para channel/ (8 → meta 4 tests)     |
| 1.2.5 | P1-plugins | Tests para plugins/ (3 → meta 3 tests)     |

### Fase 1.3 — Error Handling Hardening

| Sub   | Finding    | Ação                                                     |
| ----- | ---------- | -------------------------------------------------------- |
| 1.3.1 | A-10..A-13 | try-catch em todos os `JSON.parse` sem guarda (7+ sites) |
| 1.3.2 | G2-04      | Circuit breaker em `processQueue`                        |
| 1.3.3 | G2-05      | Global reconnect counter com max                         |
| 1.3.4 | G2-06      | `unhandledRejection` handler global                      |
| 1.3.5 | G2-07      | Graceful shutdown handler (SIGTERM, SIGINT) consolidado  |
| 1.3.6 | G2-08      | turn-executor: refactor nested promise patterns          |
| 1.3.7 | G2-09      | Deadlock detection no backpressure mutex                 |

### Fase 1.4 — Resource Leak Prevention

| Sub   | Finding    | Ação                                                           |
| ----- | ---------- | -------------------------------------------------------------- |
| 1.4.1 | A-06..A-07 | Audit todos os `setInterval` — garantir cleanup em error paths |
| 1.4.2 | A-08       | Event listener audit: .on() vs .off() balance                  |
| 1.4.3 | C-08       | Avaliar WeakMap/WeakRef para caches de longa duração           |
| 1.4.4 | GAP-T05    | Memory leak detection test                                     |

---

## FAIXA 2 — HARDENING (P2)

> **Scope**: 80 findings | **Esforço estimado**: Sprint 4-6 (3-5 semanas)
> **Critério de saída**: 0 `@type {any}` em APIs públicas, 0 deprecated com importadores.

### Fase 2.1 — Typing Hardening

| Sub   | Finding | Ação                                                  |
| ----- | ------- | ----------------------------------------------------- |
| 2.1.1 | U2-01   | Eliminar top-50 `@type {any}` (359 total)             |
| 2.1.2 | U2-02   | JSDoc em todas as APIs públicas (169 exports sem doc) |
| 2.1.3 | U2-03   | Split `sdk/types.js` (646 LOC) → 4 arquivos           |
| 2.1.4 | U2-05   | Migrar para `/** @import */` syntax                   |
| 2.1.5 | U2-10   | Branded types para SessionId, WebhookId               |
| 2.1.6 | U2-11   | Discriminated unions para AgentStatus                 |

### Fase 2.2 — Dead Code Removal

| Sub   | Finding      | Ação                                                         |
| ----- | ------------ | ------------------------------------------------------------ |
| 2.2.1 | D1-09..D1-24 | Deletar 14 @deprecated files com 0 importadores (~2,500 LOC) |
| 2.2.2 | D1-05..D1-08 | Migrar 4 @deprecated files com poucos importadores           |
| 2.2.3 | D1-01..D1-04 | Migrar 4 @deprecated files com muitos importadores (45 cada) |
| 2.2.4 | —            | Limpar `api/express/` (9 active files, ~1861 LOC)            |

### Fase 2.3 — Validation Completeness

| Sub   | Finding | Ação                                                    |
| ----- | ------- | ------------------------------------------------------- |
| 2.3.1 | G4-02   | OpenAPI schema validation runtime (ou Zod-from-OpenAPI) |
| 2.3.2 | G5-06   | Config schema validation on write                       |
| 2.3.3 | M-09    | Params format validation (UUID, etc)                    |
| 2.3.4 | S-M-07  | Logging de auth failures                                |

### Fase 2.4 — Magic Values Extraction

| Sub   | Finding      | Ação                                                                |
| ----- | ------------ | ------------------------------------------------------------------- |
| 2.4.1 | D4-01..D4-14 | Extrair 51 magic numbers → `config/timeouts.js`, `config/limits.js` |
| 2.4.2 | A-20         | Constantes nomeadas para todos os timeouts                          |

---

## FAIXA 3 — ARQUITETURA (P3)

> **Scope**: 55 findings | **Esforço estimado**: Sprint 7-10 (4-6 semanas)
> **Critério de saída**: Zero violações de camada, interfaces definidas.

### Fase 3.1 — Layer Violation Fixes

| Sub   | Finding | Ação                                                        |
| ----- | ------- | ----------------------------------------------------------- |
| 3.1.1 | AC-1-02 | Remover re-exports de events em `core/index.js`             |
| 3.1.2 | AC-1-01 | Desacoplar `core/ ↔ config/` — shared contracts em `types/` |
| 3.1.3 | AC-1-03 | `events/` não importa de `observability/`                   |
| 3.1.4 | AC-1-04 | `config/` não importa de `sdk/`                             |
| 3.1.5 | AC-1-05 | `server/` usa `services/` em vez de `agent/` direto         |
| 3.1.6 | AC-1-08 | `hooks/` não importa de `tools/`                            |

### Fase 3.2 — Interface Extraction

| Sub   | Finding | Ação                          |
| ----- | ------- | ----------------------------- |
| 3.2.1 | AC-5-01 | `IAgent` interface + factory  |
| 3.2.2 | AC-5-02 | `IEventBus` interface         |
| 3.2.3 | AC-5-03 | `IStateStore` interface       |
| 3.2.4 | AC-5-04 | `IToolRegistry` interface     |
| 3.2.5 | AC-5-05 | `IHooksPipeline` interface    |
| 3.2.6 | AC-5-06 | `IConfigProvider` interface   |
| 3.2.7 | AC-5-07 | `IMetricsCollector` interface |

### Fase 3.3 — God Class Decomposition

| Sub   | Finding      | Ação                                                                       |
| ----- | ------------ | -------------------------------------------------------------------------- |
| 3.3.1 | D2-03        | Extract `PrTracker`, `StallDetector`, `WatchdogTimer` de `loop-manager.js` |
| 3.3.2 | D2-04        | Split `store.js` → CRUD, migrations, checkpoint                            |
| 3.3.3 | D2-06        | Split `inject.js` → parser, validator, dispatcher                          |
| 3.3.4 | D2-07        | Split `hooks/factory.js` → wire, defaults, validation                      |
| 3.3.5 | D2-08..D2-10 | Split observability monoliths                                              |

### Fase 3.4 — Event System Unification

| Sub   | Finding | Ação                                                                              |
| ----- | ------- | --------------------------------------------------------------------------------- |
| 3.4.1 | D3-02   | Deprecar `createEventBus`, `createEmitter` — unificar em EventBus + bridgeEmitter |
| 3.4.2 | AC-3-03 | Split event constants por domínio                                                 |
| 3.4.3 | U4-16   | Auto-generate event catalog                                                       |
| 3.4.4 | D2-12   | Eliminar God Barrel `di-tokens.js` — tokens per-module                            |

### Fase 3.5 — DI Container Enhancement

| Sub   | Finding | Ação                                                  |
| ----- | ------- | ----------------------------------------------------- |
| 3.5.1 | U4-13   | Scoped lifetimes (singleton, transient, scoped)       |
| 3.5.2 | AC-4-11 | Migrar `alwaysAliveAgent` singleton → DI registration |
| 3.5.3 | AC-4-12 | Migrar `defaultMetrics` singleton → DI registration   |

---

## FAIXA 4 — EVOLUÇÃO (P4)

> **Scope**: 50 findings | **Esforço estimado**: Sprint 11-14 (4-6 semanas)
> **Critério de saída**: Performance measurably improved, Node.js 24 features adopted.

### Fase 4.1 — Performance Quick Wins

| Sub   | Finding | Ação                                        |
| ----- | ------- | ------------------------------------------- |
| 4.1.1 | U3-01   | Migrar 6 `readFileSync` → async             |
| 4.1.2 | U3-05   | Debounce state writes                       |
| 4.1.3 | U3-08   | Stream JSON parsing para audit logs         |
| 4.1.4 | S-A-04  | `AbortSignal.timeout()` em todos os fetches |

### Fase 4.2 — Node.js 24+ Adoption

| Sub   | Finding | Ação                                           |
| ----- | ------- | ---------------------------------------------- |
| 4.2.1 | U1-01   | `await using` para file handles, locks, timers |
| 4.2.2 | U1-02   | `AbortSignal.any()` em turn-executor           |
| 4.2.3 | U1-10   | `url.fileURLToPath()` em vez de `.pathname`    |
| 4.2.4 | U1-05   | `structuredClone()` onde applicable            |

### Fase 4.3 — Observability Enhancement

| Sub   | Finding | Ação                                      |
| ----- | ------- | ----------------------------------------- |
| 4.3.1 | U6-01   | Prometheus exposition (`/metrics`)        |
| 4.3.2 | U6-02   | Structured logging (JSON lines + pino)    |
| 4.3.3 | U6-04   | Log rotation com pino-roll                |
| 4.3.4 | U6-05   | Health check split: liveness vs readiness |
| 4.3.5 | U6-07   | Event bus metrics                         |
| 4.3.6 | U3-09   | Event loop lag monitoring                 |

### Fase 4.4 — API Evolution

| Sub   | Finding | Ação                             |
| ----- | ------- | -------------------------------- |
| 4.4.1 | U4-14   | API versioning `/v1/`            |
| 4.4.2 | G4-04   | Pagination em endpoints de lista |
| 4.4.3 | G4-05   | ETag/Cache-Control               |
| 4.4.4 | G4-06   | Request ID propagation           |

### Fase 4.5 — Advanced Testing

| Sub   | Finding | Ação                                  |
| ----- | ------- | ------------------------------------- |
| 4.5.1 | GAP-T03 | Property-based tests para concurrency |
| 4.5.2 | GAP-T04 | Error injection tests                 |
| 4.5.3 | GAP-T06 | Fake timers para timeout behavior     |
| 4.5.4 | GAP-T10 | Event emission contract tests         |
| 4.5.5 | GAP-T11 | Performance baseline (k6/autocannon)  |

---

## FAIXA 5 — POLISH (P5)

> **Scope**: 30 findings | **Esforço estimado**: Sprint 15-16 (2-3 semanas)
> **Critério de saída**: Naming consistente, docs geradas, zero debt residual.

### Fase 5.1 — Naming Consistency

| Sub   | Finding | Ação                                                                  |
| ----- | ------- | --------------------------------------------------------------------- |
| 5.1.1 | D5-01   | Normalizar event names (escolher `dot.case` ou `snake_case`, não mix) |
| 5.1.2 | D5-02   | Normalizar handler naming (`handleX` everywhere)                      |
| 5.1.3 | D5-04   | Normalizar file naming (`kebab-case` everywhere)                      |
| 5.1.4 | D5-05   | Eliminar prefixos `_` — usar `#private` consistentemente              |

### Fase 5.2 — Documentation Generation

| Sub   | Finding | Ação                             |
| ----- | ------- | -------------------------------- |
| 5.2.1 | G6-03   | ADRs para decisões arquiteturais |
| 5.2.2 | G6-04   | Runbook operacional              |
| 5.2.3 | G6-06   | Event catalog auto-gerado        |
| 5.2.4 | U5-07   | Config schema docs auto-geradas  |

### Fase 5.3 — Build Cleanup

| Sub   | Finding | Ação                                    |
| ----- | ------- | --------------------------------------- |
| 5.3.1 | D6-01   | Consolidar tsconfig files               |
| 5.3.2 | D6-04   | Resolver npm vs pnpm ambiguity          |
| 5.3.3 | D6-05   | Mover 90+ arquivos root para `scripts/` |
| 5.3.4 | D6-06   | ecosystem.config → ESM                  |

### Fase 5.4 — DX Improvements

| Sub   | Finding | Ação                            |
| ----- | ------- | ------------------------------- |
| 5.4.1 | U5-01   | Hot reload para tools           |
| 5.4.2 | U5-02   | CLI event inspector             |
| 5.4.3 | U5-04   | Test fixture factory            |
| 5.4.4 | U5-06   | Error messages com action hints |

---

## VISUALIZAÇÃO TEMPORAL

```
Sprint    1    2    3    4    5    6    7    8    9   10   11   12   13   14   15   16
         ┌──────┐
Faixa 0  │██████│ P0: Segurança + Bugs Críticos
         └──────┘
              ┌──────────────────┐
Faixa 1      │██████████████████│ P1: Testes + Error Handling
              └──────────────────┘
                        ┌──────────────────────────┐
Faixa 2                │██████████████████████████│ P2: Typing + Validation + Cleanup
                        └──────────────────────────┘
                                    ┌──────────────────────────────┐
Faixa 3                            │██████████████████████████████│ P3: Arquitetura
                                    └──────────────────────────────┘
                                                    ┌──────────────────────────┐
Faixa 4                                            │██████████████████████████│ P4: Evolução
                                                    └──────────────────────────┘
                                                                        ┌──────────┐
Faixa 5                                                                │██████████│ P5: Polish
                                                                        └──────────┘
```

---

## MÉTRICAS DE SUCESSO

| KPI                          | Baseline (hoje) | Meta Faixa 1 | Meta Faixa 3 | Meta Faixa 5 |
| ---------------------------- | --------------- | ------------ | ------------ | ------------ |
| Bugs críticos                | 8               | 0            | 0            | 0            |
| Vulnerabilidades críticas    | 4               | 0            | 0            | 0            |
| Test coverage (%)            | 46%             | 65%          | 75%          | 85%          |
| `@type {any}`                | 359             | 300          | 100          | 0            |
| Exports sem JSDoc            | 169             | 120          | 50           | 0            |
| @deprecated com importadores | 10              | 8            | 2            | 0            |
| @deprecated sem importadores | 14              | 0            | 0            | 0            |
| Layer violations             | 8               | 8            | 2            | 0            |
| Circular deps                | 6               | 6            | 1            | 0            |
| Magic numbers                | 51              | 40           | 10           | 0            |
| Silent catches               | 6               | 0            | 0            | 0            |

---

## DEPENDÊNCIAS ENTRE FAIXAS

```
Faixa 0 ──→ Faixa 1 ──→ Faixa 2 ──→ Faixa 3 ──→ Faixa 4 ──→ Faixa 5
  │              │              │              │
  │              │              │              └── Interfaces needed before DI enhancement
  │              │              └── Dead code removed before architecture refactor
  │              └── Tests created before major refactoring
  └── Security fixed before opening for wider testing
```

---

*Roadmap completo: 6 faixas, 22 fases, 95 subfases cobrindo 382 findings.*
