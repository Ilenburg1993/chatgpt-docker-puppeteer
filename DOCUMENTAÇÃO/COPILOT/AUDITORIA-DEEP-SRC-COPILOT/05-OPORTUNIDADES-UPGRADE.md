# 05 — OPORTUNIDADES DE UPGRADE

> **Auditoria Profunda `src/copilot/`** | Data: 2026-06-11 | HEAD: `55a4b071`

---

## SUMÁRIO

| Categoria | Quantidade |
|---|---|
| Node.js 24+ APIs | 12 |
| Typing Hardening | 14 |
| Performance | 10 |
| Architecture | 16 |
| DX/Developer Experience | 8 |
| Observability | 8 |
| **Total** | **68** |

---

## U1 — NODE.JS 24+ APIs (12)

### U1-01 — Adotar `using`/`await using` (Explicit Resource Management)
**Status**: Já usado em `AlwaysAliveAgent[Symbol.asyncDispose]()`, mas não propagado para:
- File handles (fsp.open → `await using fh = await fsp.open(...)`)
- SQLite connections
- Timers (`await using timer = disposableTimer(...)`)
- Locks (`await using lock = await acquireLock(...)`)
**Impacto**: Garante cleanup determinístico sem try/finally.

### U1-02 — `AbortSignal.any()` para combinar signals
**Onde**: `turn-executor.js` usa wrapping manual de signals. Node 24 tem `AbortSignal.any([signal1, signal2])`.

### U1-03 — `AbortSignal.timeout()` para todos os fetches/exec
**Onde**: 5+ fetch calls sem signal timeout.

### U1-04 — `node:test` para unit tests (eliminar vitest dependency)
**Status**: Projeto já usa vitest — avaliar se `node:test` é suficiente.

### U1-05 — `structuredClone()` em vez de `JSON.parse(JSON.stringify())`
**Onde**: Deep clone patterns no codebase.

### U1-06 — `Error.captureStackTrace` com `cause` chain
**Onde**: Erros re-thrown sem preservar causa original.

### U1-07 — `Blob` / `File` APIs nativas para attachment handling
**Onde**: `sdk/types.js` define attachment types custom.

### U1-08 — `crypto.subtle` para hash/HMAC em vez de `crypto.createHash`
**Impacto**: Alinhamento com Web Crypto API.

### U1-09 — `Buffer.from()` auditar uso de `new Buffer()` (se existir)
**Status**: Verificar.

### U1-10 — `url.fileURLToPath()` em vez de `new URL(...).pathname`
**Onde**: 5+ locais usam `new URL('../..', import.meta.url).pathname`.

### U1-11 — `fs/promises` em vez de `promisify(fs.readFile)`
**Onde**: Verificar se todos os módulos migraram.

### U1-12 — `EventTarget` nativa vs custom EventEmitter
**Avaliação**: EventTarget é parte do web standard. Pode não ser drop-in replacement mas alinha com web platform.

---

## U2 — TYPING HARDENING (14)

### U2-01 — Eliminar 359 `@type {any}` — migrar para tipos concretos
**Prioridade**: Top 20 mais usados (em handlers, catches, callbacks).

### U2-02 — Adicionar JSDoc a 169 exports sem documentação
**Prioridade**: APIs públicas (barrels) primeiro.

### U2-03 — Split `sdk/types.js` (646 LOC) em arquivos por domínio
**Fix**: `types/session.d.ts`, `types/tools.d.ts`, `types/events.d.ts`

### U2-04 — Adotar `@satisfies` annotation (TS 5.x)
**Onde**: Object literals que deveriam satisfazer uma interface mas precisam ficar const.

### U2-05 — Usar `/** @import */` (TS 5.5+) em vez de `/** @typedef {import(...)} */`
**Impacto**: Syntax mais limpa para imports-only types.

### U2-06 — Eliminar `@ts-ignore` / `@ts-expect-error` residuais
**Status**: Verificar quantos existem.

### U2-07 — Migrar de `.js` com JSDoc para `.ts` nos módulos core
**Avaliação**: Longo prazo. Começar por `core/`, `types/`, `config/`.

### U2-08 — Adicionar `readonly` em propriedades que nunca são reatribuídas
**Onde**: AgentContext properties, config objects.

### U2-09 — Template literal types para event names
**Ex**: `type AgentEvent = 'dialog.${string}' | 'session.${string}' | 'task.${string}'`

### U2-10 — Branded types para IDs (SessionId, WebhookId, HandoffId)
**Fix**: `type SessionId = string & { __brand: 'SessionId' }`

### U2-11 — Discriminated unions para agent status
**Fix**: `type AgentStatus = { status: 'idle' } | { status: 'busy', task: AgentTask } | { status: 'error', error: Error }`

### U2-12 — `exactOptionalPropertyTypes` awareness em mais módulos
**Status**: Já habilitado no tsconfig. Verificar se todos os módulos são compatíveis.

### U2-13 — Eliminar `object` type em favor de `Record<string, unknown>`

### U2-14 — Strict return type annotations em async functions

---

## U3 — PERFORMANCE (10)

### U3-01 — Migrar 6 `readFileSync` → async equivalents
**Onde**: tool-factory.js, sdk/tools/core.js, todo/store.js, session-tools.js, code-tools.js, state-io.js

### U3-02 — Implementar connection pooling para SQLite
**Onde**: `db/copilot-db.js` — single connection sem pool.

### U3-03 — Lazy module loading via `import()` dinâmico
**Onde**: Modules pesados (observability, tools) carregados no boot. Lazy load para first-use.

### U3-04 — Event listener dedup — 178 `.on()` calls
**Fix**: Audit cada listener; usar `once` onde appropriate.

### U3-05 — Batch state writes — `_writeQueue` patterns
**Fix**: Debounce writes (coalesce múltiplos writes em um).

### U3-06 — Cache `getStatusSnapshot()` com dirty flag (já existe parcialmente)
**Status**: G2-PERF-01 implementou dirty flag + TTL. Verificar se todos mutation paths invalidam.

### U3-07 — Compress snapshots com gzip antes de persistir
**Impacto**: Reduz I/O para sessions longas.

### U3-08 — Stream JSON parsing com `jsonl` para audit logs
**Onde**: `pipeline-audit-log.js` lê todo o file e faz split — ineficiente para logs grandes.

### U3-09 — `event loop lag` monitoring com `monitorEventLoopDelay()`
**Fix**: Adicionar ao health check.

### U3-10 — Memory-aware circuit breaker baseado em `process.memoryUsage()`

---

## U4 — ARCHITECTURE (16)

### U4-01 — Extrair `AlwaysAliveAgent` interface (facade pattern completo)
**Fix**: `IAgent` interface com métodos por domínio. Implementations podem ser trocadas em testes.

### U4-02 — Extrair event bridge mapping para arquivo dedicado
**Onde**: `always-alive.js:665-746` — 80+ linhas de mapping inline.
**Fix**: `agent/bridge/agent-event-bridge.js`

### U4-03 — Unificar 4 mecanismos de event emission
**Fix**: `EventBus` + `bridgeEmitter` como único par canônico. Deprecar `createEventBus`, `createEmitter`.

### U4-04 — Implementar CQRS leve para state management
**Fix**: Separar command (write state) de query (read state). Eliminar sync fallbacks.

### U4-05 — Circuit breaker pattern para SDK reconnect
**Onde**: `tryReconnect` atualmente retry linear. Implementar open/half-open/closed states.

### U4-06 — Eliminar `core/ → events/` dependency
**Fix**: Mover re-exports de core/index.js para events/index.js. Core não deve depender de events.

### U4-07 — Eliminar `server/ → terminal/` coupling (11 imports)
**Fix**: Interface intermediária `terminal-api.js` exposta pelo terminal, consumida pelo server.

### U4-08 — Extract `PrTracker` de loop-manager.js (596 LOC)
**Fix**: Classe separada para premium request tracking.

### U4-09 — Extract `StallDetector` de loop-manager.js
**Fix**: Classe separada para stall detection com configurable thresholds.

### U4-10 — Extract `WatchdogTimer` de loop-manager.js
**Fix**: Timer genérico reutilizável.

### U4-11 — Modularizar `store.js` (562 LOC) — split CRUD vs migrations
**Fix**: `store-crud.js`, `store-migrations.js`, `store-checkpoint.js`

### U4-12 — Plugin system com lifecycle hooks
**Onde**: `plugins/` existe com 3 files mas sem padrão.
**Fix**: `PluginManager` com `init`, `start`, `stop`, `health` hooks.

### U4-13 — Dependency injection container melhorado
**Onde**: `core/di-container.js` — container básico.
**Fix**: Auto-discovery, scoped lifetimes, factory providers.

### U4-14 — API versioning (`/v1/`)
**Fix**: Prefix router e migration path documentado.

### U4-15 — OpenAPI schema como source of truth para validation
**Onde**: `openapi.json` existe (92 paths) mas não é usado para runtime validation.
**Fix**: `express-openapi-validator` ou derivar Zod schemas do OpenAPI.

### U4-16 — Event catalog (quem emite, quem escuta, schema)
**Fix**: Auto-generate catalog das 80+ event types.

---

## U5 — DX / DEVELOPER EXPERIENCE (8)

### U5-01 — Hot reload para tool development
**Fix**: File watcher que re-registra tools quando alteradas.

### U5-02 — CLI para debug de eventos (event inspector)
**Fix**: `npx copilot events --filter dialog.*` → mostra events em realtime.

### U5-03 — Schema-first tool development
**Fix**: Tool template generator com Zod schema.

### U5-04 — Test fixture factory
**Fix**: `createTestAgent()`, `createMockSession()`, `createMockBus()` factory helpers.

### U5-05 — Debug mode com verbose logging via env var
**Status**: Parcialmente existe via `LOG_LEVEL`. Normalizar.

### U5-06 — Error messages com action hints
**Fix**: "Session not found: ABC123. Did you mean to create one? Use POST /sessions" 

### U5-07 — Config schema documentation gerada automaticamente
**Fix**: JSDoc → markdown para `config/env.js`.

### U5-08 — Interactive setup wizard para primeira configuração
**Fix**: `npx copilot setup` — configura env vars, cria .env, testa conectividade.

---

## U6 — OBSERVABILITY (8)

### U6-01 — Prometheus exposition format (`/metrics`)
### U6-02 — Structured logging (JSON lines)
### U6-03 — Distributed tracing com W3C Trace Context
### U6-04 — Log rotation com pino-roll
### U6-05 — Health check liveness vs readiness split
### U6-06 — Alert aggregation com dedup (não alertar 100x o mesmo erro)
### U6-07 — Event bus metrics (throughput, lag, queue depth)
### U6-08 — Memory profiling snapshot endpoint

---

*68 oportunidades de upgrade. Próximo: 06-COBERTURA-TESTES.md*
