# 04 — DÍVIDA TÉCNICA

> **Auditoria Profunda `src/copilot/`** | Data: 2026-06-11 | HEAD: `55a4b071`

---

## SUMÁRIO

| Categoria                 | Quantidade |
| ------------------------- | ---------- |
| Código Morto / Deprecated | 24         |
| God Classes / God Files   | 12         |
| Anti-patterns             | 18         |
| Hardcoded / Magic Values  | 14         |
| Naming / Convention Gaps  | 8          |
| Build / Config Debt       | 6          |
| **Total**                 | **82**     |

---

## D1 — CÓDIGO MORTO / DEPRECATED (24)

### D1-01 — `types/events.js` — @deprecated com 45 importadores ativos

**LOC**: ~200 **Impacto**: Maior impediment para remover. Cada importador precisaria migrar para
`events/index.js`.

### D1-02 — `conversation-hub/events.js` — @deprecated com 45 importadores (overlap com D1-01)

**LOC**: ~120

### D1-03 — `agent.js` (raiz copilot) — wrapper @deprecated com 45 importadores aparentes

**LOC**: 16 **Realidade**: Provavelmente barrel re-export. Importadores na verdade importam nomes
que passam por este barrel.

### D1-04 — `sdk/tools/state.js` — @deprecated com 11 importadores

**LOC**: ~50 **Impacto**: Config state de tools usando file system legado.

### D1-05 — `api/bridge/dialog.js` — @deprecated com 7 importadores

**LOC**: ~150 **Impacto**: Dialog bridge que deveria ter sido migrado para `server/routes/`.

### D1-06 — `agent/session/snapshot.js` — @deprecated com 2 importadores

**LOC**: ~200 **Impacto**: Session snapshot com sync fallback patterns e silent catches.

### D1-07 — `api/bridge/control.js` — @deprecated com 1 importador

**LOC**: ~80

### D1-08 — `sdk/tools/custom.js` — @deprecated com 1 importador

**LOC**: ~170

### D1-09 — `api/express/webhooks.js` — @deprecated, 0 importadores

### D1-10 — `api/express/index.js` — @deprecated, 0 importadores

### D1-11 — `api/bridge/tasks.js` — @deprecated, 0 importadores

### D1-12 — `api/bridge/stream.js` — @deprecated, 0 importadores

### D1-13 — `api/bridge/index.js` — @deprecated, 0 importadores

### D1-14 — `api/index.js` — @deprecated, 0 importadores

### D1-15 — `api/sse/fanout.js` — @deprecated, 0 importadores

### D1-16 — `api/sse/index.js` — @deprecated, 0 importadores

### D1-17 — `api/sse/replay-buffer.js` — @deprecated, 0 importadores

### D1-18 — `api/sse/utils.js` — @deprecated, 0 importadores

### D1-19 — `observability/index.js` — @deprecated, 0 importadores

### D1-20 — `tools/todo/index.js` — @deprecated, 0 importadores

### D1-21 — `conversation-hub/socket-ns.js` — @deprecated, 0 importadores

### D1-22 — `terminal/alias-store.js` — @deprecated, 0 importadores

### D1-23 — `audit/pipeline-sdk-buffer.js` — @deprecated, 0 importadores

### D1-24 — `agent/lifecycle/state-io.js` — parcialmente @deprecated, 0 importadores diretos (usado via re-export)

**Resumo**: 24 arquivos @deprecated. 14 com 0 importadores (safe delete). 10 com importadores ativos
(requer migração).

**LOC removível imediatamente**: ~2,500 (arquivos com 0 importadores) **LOC removível após
migração**: ~1,200 (arquivos com importadores)

---

## D2 — GOD CLASSES / GOD FILES (12)

### D2-01 — `agent/always-alive.js` — 746 LOC, 30+ methods

**Problema**: Facade class que delega para 6+ módulos, mas ainda concentra interface completa.
**Fix**: Interface segregation — split por domínio (messaging, dialog, config, lifecycle).

### D2-02 — `sdk/types.js` — 646 LOC, 70+ type definitions

**Problema**: Mudança em qualquer type recompila todos os consumidores. **Fix**: Split por domínio:
`types/session.js`, `types/tools.js`, `types/events.js`.

### D2-03 — `agent/dialog/loop-manager.js` — 596 LOC

**Problema**: State machine complexa com boot, pause, resume, stall detection, watchdog, PR
tracking. **Fix**: Extract PrTracker, StallDetector, WatchdogTimer.

### D2-04 — `conversation-hub/store.js` — 562 LOC

**Problema**: SQLite ops + checkpoint + migration + cleanup em um único arquivo.

### D2-05 — `terminal/index.js` — 485 LOC

**Problema**: Terminal setup, wiring, command dispatch, reflection — multi-concern.

### D2-06 — `channel/inject.js` — 418 LOC

**Problema**: Inject parsing, validation, dispatch, streaming — multi-concern.

### D2-07 — `hooks/factory.js` — 417 LOC

**Problema**: Hook creation, wiring, defaults, validation — God Factory.

### D2-08 — `observability/observers/dialog-task-handlers.js` — 426 LOC

**Problema**: 20+ event handlers em um único observer.

### D2-09 — `observability/collectors/session-handlers.js` — 393 LOC

**Problema**: Outro observer monolítico.

### D2-10 — `observability/observers/session-agent-handlers.js` — 383 LOC

**Problema**: Terceiro observer monolítico.

### D2-11 — `agent/session/boot-wiring.js` — 280 LOC

**Problema**: Bootstrap wiring com 12+ event handlers inline.

### D2-12 — `core/di-tokens.js` — Re-exports tokens de 9 módulos

**Problema**: God barrel que acopla core a todos os módulos.

---

## D3 — ANTI-PATTERNS (18)

### D3-01 — Sync I/O em handlers async (6 ocorrências)

- `readFileSync` em tool-factory.js:39, sdk/tools/core.js:88
- `execFileSync` em code-tools.js, session-tools.js
- `readFileSync` em todo/store.js:62
- `readState()` sync fallback em state-io.js

### D3-02 — 4 mecanismos de event emission concorrentes

1. `EventBus` (singleton via DI container)
2. `bridgeEmitter` (core utility)
3. `createEventBus` (factory)
4. `createEmitter` (another factory) **Fix**: Unificar em EventBus + bridgeEmitter.

### D3-03 — `new Map()`/`new Set()` sem WeakMap (119 instâncias)

**Impacto**: Nenhum uso de WeakMap/WeakRef/FinalizationRegistry em todo o codebase.

### D3-04 — Promise fire-and-forget sem tracking (15+ ocorrências)

Ex: `someAsyncOp().catch(() => {})` — sem meter se completou ou não.

### D3-05 — `JSON.parse` sem try-catch em 7+ call sites

**Fix**: Helper `safeParse(raw, fallback)`.

### D3-06 — Magic numbers de timeout (51 ocorrências)

**Fix**: Extrair para `config/timeouts.js` com constantes nomeadas.

### D3-07 — `setInterval` sem cleanup pattern (19 ocorrências)

**Fix**: AbortController ou Disposable pattern.

### D3-08 — Event listener ratio 178:55 (.on vs .off)

**Fix**: Audit cada .on() e garantir .off() em cleanup.

### D3-09 — Deprecated files com importadores — circular dependency risk

Em: types/events.js, conversation-hub/events.js, agent.js, sdk/tools/state.js

### D3-10 — `core/index.js` importa de `../events/` — layer violation

**Fix**: Mover re-exports para eventos terem barrel próprio.

### D3-11 — 11 imports de `server/ → terminal/` — cross-layer coupling

**Fix**: Extract interfaces; terminal expõe facades consumidas por server.

### D3-12 — Top-level `try { await import() }` para wiring

**Arquivo**: `always-alive.js:665-746` **Fix**: Lazy factory pattern com explicit init.

### D3-13 — Callback-then-async pattern em turn-executor

Nested `new Promise(resolve, reject)` wrapping existing async operations.

### D3-14 — Singleton at module-level (`export const alwaysAliveAgent = new AlwaysAliveAgent()`)

**Impacto**: Difícil de testar (import side-effect). `getAgent()` accessor existe mas não é usado
consistentemente.

### D3-15 — 359 `@type {any}` — type system escape hatch

**Fix**: Gradual migration para tipos corretos.

### D3-16 — `logSwallowed()` pattern — errors são logados e descartados

**Impacto**: Não há métricas de quantos errors são swallowed.

### D3-17 — `_writeQueue` chain sem bounded concurrency

**Impacto**: Queue pode crescer indefinidamente.

### D3-18 — Múltiplos barrels (`index.js`) com re-export chains de 3+ níveis

**Ex**: `agent/index.js → agent/facades/index.js → agent/facades/agent-model-config.js`

---

## D4 — HARDCODED / MAGIC VALUES (14)

### D4-01 — `60_000` ms timeout em 5+ locais

### D4-02 — `30_000` ms interval em 3+ locais

### D4-03 — `120_000` ms timeout em 2 locais

### D4-04 — `300_000` ms interval em 2 locais

### D4-05 — `5_000` ms interval em 4+ locais

### D4-06 — `1_000` ms interval em 3+ locais

### D4-07 — `10` default max listeners (overridden para 50)

### D4-08 — `3` max reconnect attempts (hardcoded)

### D4-09 — `7` days max snapshot age

### D4-10 — `100` max items em rate limiter bucket

### D4-11 — `20` max concurrent inject requests

### D4-12 — `200` max SSE clients

### D4-13 — `50` MAX_LISTENERS default

### D4-14 — `24 * 60 * 60 * 1000` long task timeout (hardcoded expression)

---

## D5 — NAMING / CONVENTION GAPS (8)

### D5-01 — Inconsistência: `camelCase` vs `snake_case` em event names

Ex: `dialog.turn_start` vs `dialog.loop.changed` (mix de underscore e dot)

### D5-02 — Inconsistência: `handleX` vs `X` em handler naming

Ex: `handleInject` vs `processQueue`

### D5-03 — Inconsistência: `#private` methods vs closure patterns

Alguns módulos usam `#method()`, outros usam closures para "privacidade".

### D5-04 — Inconsistência: file naming `kebab-case` vs `camelCase`

Ex: `agent-context.js` vs `agentState.js` (ambos existem no projeto)

### D5-05 — Prefixos `_` para "internal" em 5+ arquivos

**Convenção**: `_writeQueue`, `_fetch`, `_defaultState` — misturado com `#private`.

### D5-06 — `logSwallowed()` — nome não documenta que o error é descartado

**Fix**: `logAndDiscard()` ou `logSilenced()`.

### D5-07 — Event constants ALL_CAPS mas não congelados (`Object.freeze`)

### D5-08 — `ctx` naming inconsistente (AgentContext vs RequestContext vs HookContext)

---

## D6 — BUILD / CONFIG DEBT (6)

### D6-01 — 5 tsconfig\*.json files na raiz + 3 dentro de subpastas

**Impacto**: Complexidade de configuração TS dificulta saber qual config é usada onde.

### D6-02 — `tsconfig.strict.json` vs `tsconfig.json` — discrepância de strictness

**Impacto**: Código pode passar em um e falhar no outro.

### D6-03 — `eslint.config.mjs` — unused vars pattern permite `e`, `err`, `error`, `req`, `res`, `next`

**Impacto**: Variáveis legitimamente unused podem ser mascaradas por naming convention.

### D6-04 — `pnpm-workspace.yaml` coexiste com `package-lock.json`

**Impacto**: Ambiguidade sobre package manager canônico (npm vs pnpm).

### D6-05 — 90+ arquivos de utilidade/teste na raiz do projeto

**Impacto**: `test-*.mjs`, `analyze-*.mjs`, `fix-*.mjs`, `debug-*.mjs` — poluição da raiz.

### D6-06 — `ecosystem.config.cjs` vs ESM — CommonJS config em projeto ESM

---

_82 itens de dívida técnica. Próximo: 05-OPORTUNIDADES-UPGRADE.md_
