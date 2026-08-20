# Fase 3.0 — Mapeamento Arquitetural Completo

**Data**: 2026-05-14 06:00 UTC **Objetivo**: Análise estrutural, padrões, dependências e caminhos
críticos

---

## I. Estrutura de Módulos (Macro)

### Layout do SDK (`src/copilot/sdk/`)

```
sdk/
├── index.js                 ← Main export façade (479 lines)
├── constants.js             ← Centralized constants & enums
├── types.js                 ← JSDoc typedefs & interfaces
├── logger.js                ← Logging singleton & utilities
├── errors.js                ← Error handling & classification
├── http-request.js          ← HTTP abstraction layer
├── utils.js                 ← Utility functions
├── event-helpers.js         ← Event pattern utilities
├── feature-flags.js         ← Feature toggles
├── di-tokens.js             ← Dependency injection markers
├── module-map.js            ← Module metadata
├── persistent-paths.js      ← Runtime paths configuration
│
├── models/                  ← Model selection & registry (9 files)
│   ├── helpers.js           ← listModels() with 5-min cache
│   ├── selector.js          ← ModelSelector & auto-downgrade
│   ├── known-models.js      ← Cost/speed tier definitions
│   ├── registry.js          ← Core registry implementation
│   └── ...
│
├── rpc/                     ← RPC facades over @github/copilot-sdk (7 files)
│   ├── ops.js               ← Compaction, shell, elicitation, commands
│   ├── session.js           ← Model, mode, plan, workspace, logs
│   ├── server.js            ← Account & quota operations
│   └── ...
│
├── session/                 ← Session lifecycle & events (25 files)
│   ├── client.js            ← CopilotClientManager + circuit breaker
│   ├── lifecycle.js         ← createSession & resumeSession
│   ├── runtime.js           ← Native setModel, send, abort
│   ├── hook-bus.js          ← HookBus event emitter
│   ├── permissions.js       ← Permission handling & policies
│   ├── tool-session-context.js  ← Per-session state isolation
│   └── ...
│
├── tools/                   ← Tool registry & policies (6 files)
│   ├── registry.js          ← Core registry + adapter
│   ├── custom.js            ← Custom tools persistence
│   ├── agent-policy.js      ← Tool filtering for agents
│   └── ...
│
└── telemetry/               ← Monitoring & health (5 files)
    ├── quota-monitor.js     ← Periodic quota polling
    ├── operation-metrics.js ← SDK operation telemetry
    ├── health.js            ← Liveness checks
    └── ...
```

---

## II. Padrões Arquiteturais Identificados

### A. Singleton Managers (Lifecycle)

| Manager              | Arquivo             | Pattern                           | Locks           |
| -------------------- | ------------------- | --------------------------------- | --------------- |
| CopilotClientManager | session/client.js   | Promise dedup via `#startPromise` | Circuit breaker |
| HookBus (default)    | session/hook-bus.js | Event emitter broadcast           | EventEmitter    |
| CopilotClient        | RPC                 | Native singleton                  | —               |

**Observação**: Uso correto de deduplicação de Promise para evitar conexões paralelas.

### B. Caching Strategies

| Subsystem    | Strategy                 | TTL   | Dedup             | Invalidation          |
| ------------ | ------------------------ | ----- | ----------------- | --------------------- |
| Models       | Single cache entry       | 5 min | ✅ (BUG-05 fixed) | forceRefresh OR error |
| Compaction   | Per-session (RPC native) | N/A   | RPC layer         | Per compaction        |
| Custom tools | Disk-based               | N/A   | _loadPromise      | Manual reset          |

**Pattern**: Cache-aside with TTL, error purges stale cache.

### C. Error Handling Layers

1. **SDK Layer** (index.js exports)
   - toSdkOperationError() wraps all SDK errors
   - Consistent error kind classification

2. **RPC Layer** (rpc/*.js)
   - Duck-typing validation before unsafe casts (BUG-08 fixed)
   - Defensive null-coalescing

3. **Session Layer** (session/*.js)
   - assertSession() pre-checks
   - HookBus: separate try/catch per emit (BUG-09 fixed)

4. **Telemetry Layer** (telemetry/*.js)
   - onError callbacks (BUG-12 fixed)
   - Silent swallowing via logSwallowed()

**Observação**: Multi-layer defense-in-depth approach, but callbacks missing in some paths.

### D. Permission Model

```
Permission Request
       ↓
PermissionController (validate)
       ↓
createAllowlistPermissionHandler (filter + policy)
       ↓
session/permissions.js (PERMISSION_REQUEST_KINDS constant - BUG-07 fixed)
       ↓
SDK native handler (final decision)
```

**Pattern**: Layered validation with policy injection.

### E. Hook System (Pub/Sub)

- **HookBus**: Main event bus (EventEmitter)
- **HookRegistry**: Hook metadata
- **attachBus()**: Wraps SessionHooks automatically
- **Hooks emitted**: pre_tool_use, post_tool_use, prompt_submitted, session_start, session_end,
  error_occurred

**Thread safety**: Independent try/catch blocks (BUG-09 fixed).

---

## III. Caminhos Críticos (Hot Paths)

### Path 1: Session Creation → First Message

```
createSession()
  ├─ resolveSessionCreateModel() [preserve model='auto']
  ├─ SDK.createSession()
  ├─ CopilotClientManager.getClient() [dedup via #startPromise]
  ├─ emit HOOK_SESSION_START
  └─ Hook bus broadcast
```

**Impacto**: High-frequency (per conversation start) **Latency**: ~200-500ms (network + client init)
**Gates**: Connection circuit breaker, client validation

### Path 2: Tool Execution (request_user_input → resolve)

```
request_user_input hook
  ├─ ToolSessionContext.nextStructuredInputId()
  ├─ ToolSessionContext.registerPendingInput()
  ├─ Wait for user answer
  ├─ ToolSessionContext.resolveStructuredInput()
  ├─ emit HOOK_PROMPT_SUBMITTED
  └─ RPC send() with answer
```

**Impacto**: Per-tool invocation (high frequency) **Latency**: ~10-50ms (memory operations)
**Gates**: Input validation, pending count checks

### Path 3: Model List & Selection

```
listModels(forceRefresh)
  ├─ Check cache (5-min TTL)
  ├─ If miss: _fetch() [deduplicated via _inflightRequest - BUG-05 fixed]
  ├─ ModelSelector.select(criteria)
  │  └─ Score models by cost/speed [handle unknown tiers - BUG-10 fixed]
  └─ Return selected model
```

**Impacto**: Per-session init, user model selection **Latency**: ~100-300ms network, ~5ms cache hit
**Gates**: Cache TTL, dedup, unknown enum defaults

### Path 4: Permission Validation

```
createAllowlistPermissionHandler()
  ├─ Check request kind (PERMISSION_REQUEST_KINDS - BUG-07 fixed)
  ├─ Match against allowlist
  ├─ Apply policy (content-exclusion-check always rejected)
  └─ Return decision
```

**Impacto**: Per permission request (medium frequency) **Latency**: ~1-5ms (set lookup) **Gates**:
Constant references, policy enforcement

### Path 5: Tool Registry Composition

```
createToolRegistryAdapter()
  ├─ filter() [by names]
  ├─ exclude() [NEW - BUG-13 fixed]
  ├─ merge() [NEW - BUG-13 fixed]
  └─ stats() [aggregation]
```

**Impacto**: Tool filtering during request handling **Latency**: ~5-20ms (map iteration) **Gates**:
Registry state isolation

### Path 6: Model Switch Verification

```
verifySessionModelSwitch()
  ├─ await rpc.model.getCurrent() [first attempt]
  ├─ If not matched AND retries < 3:
  │  ├─ await waitMs(100 * (1 + retry))
  │  └─ Retry getCurrent() [NEW - BUG-14 fixed]
  ├─ If still not matched: await rpc.model.switchTo()
  └─ Return result { verifiedSwitch, effectiveModel, ... }
```

**Impacto**: Per setModel() call **Latency**: ~100-500ms (network + retries) **Gates**: Async race
detection, timeout handling

---

## IV. Dependências Inter-Módulos

### Dependency Direction (High → Low level)

```
Consumers (external)
    ↓
┌─ index.js (Facade)
│   ├─ rpc/* (Wrappers over SDK RPC)
│   ├─ session/* (Session lifecycle)
│   ├─ models/* (Model selection)
│   └─ tools/* (Tool registry)
│
├─ RPC Implementations
│   └─ guards.js, errors.js (Validation)
│
├─ Session Implementations
│   ├─ hook-bus.js (Pub/Sub)
│   ├─ tool-session-context.js (State)
│   └─ @github/copilot-sdk (Native RPC)
│
├─ Models Implementations
│   ├─ known-models.js (Definitions)
│   └─ helpers.js (Cache + list)
│
└─ Core Infrastructure
    ├─ constants.js (Enums)
    ├─ types.js (JSDoc typedefs)
    ├─ logger.js (Logging singleton)
    ├─ errors.js (Error classification)
    └─ utils.js (Helpers)
```

**Cycles**: None detected (clean DAG) **Coupling**: Loose via index.js facade + DI tokens
**Fragility**: Medium (RPC layer depends on SDK contract, could break on SDK update)

---

## V. Performance Hotspots & Optimization Opportunities

### 🔴 High Priority (> 100ms impact)

1. **Model list fetch** (Network I/O)
   - ✅ Already cached (5-min TTL)
   - ✅ Already deduped (BUG-05 fixed)
   - 💡 **Opportunity**: Offline fallback cache (persist to disk)

2. **Client initialization** (Network + event loop)
   - ✅ Deduped via #startPromise
   - ✅ Circuit breaker (fail fast)
   - 💡 **Opportunity**: Reduce startup latency via connection pooling

3. **Model switch verification** (Network + retry)
   - ✅ Retry with backoff (BUG-14 fixed)
   - 💡 **Opportunity**: Polling timeout cap (prevent >2s waits)

### 🟡 Medium Priority (10-100ms impact)

4. **Permission validation** (Set lookups)
   - ✅ Fast (O(1))
   - 💡 **Opportunity**: Pre-compile allowlist regexes

5. **Tool registry filtering** (Map iteration)
   - ✅ O(n) but typically n<50
   - 💡 **Opportunity**: Index by category/tag for faster lookups

6. **Hook broadcast** (Event listener iteration)
   - ✅ O(n listeners), separate try/catch (BUG-09 fixed)
   - 💡 **Opportunity**: Listener queue (async batch vs sync)

### 🟢 Low Priority (< 10ms impact)

7. **ToolSessionContext state** (Memory ops)
   - ✅ Map lookups (O(1))
   - Already optimal

8. **Constant lookups** (Module loading)
   - ✅ Centralized in constants.js
   - Consider lazy-loading if constants.js grows

---

## VI. Recomendações Arquiteturais Estratégicas

### 6.1 Resilience Improvements

- [ ] **Add timeout cap to verifySessionModelSwitch** (currently unlimited retries)
  - Suggested: max 500ms total wait
  - Already: exponential backoff (BUG-14 implements this)

- [ ] **Persistent model list cache** (fallback during network outages)
  - Store to disk after successful fetch
  - Use fallback if current fetch fails

- [ ] **Connection pooling** for multiple concurrent client instances
  - Currently: CopilotClientManager is global singleton
  - Consider: optional pooling for enterprise scenarios

### 6.2 Observability Enhancements

- [ ] **Structured logging** for all hot paths
  - Currently: log() with string messages
  - Consider: structured context objects for analytics

- [ ] **Trace IDs** across session lifecycle
  - Correlate logs across multiple hook emissions

- [ ] **Metrics collection** for P50/P95 latencies
  - Currently: operation-metrics.js exists but underutilized

### 6.3 Developer Experience

- [ ] **TypeScript native** definitions (currently JSDoc)
  - Would improve IDE autocomplete
  - Consider during next major version

- [ ] **Validation schemas** for SDK session config
  - Currently: loose types
  - Use Zod or similar for runtime validation

- [ ] **Migration helpers** for SDK version upgrades
  - Document breaking changes
  - Provide compat shims where possible

### 6.4 Testing & Coverage

- [ ] **Concurrency test suite** (parallel client instances)
  - Currently: limited multi-client testing

- [ ] **Failure injection** for resilience paths
  - Network faults
  - Model switch races
  - Permission denials

- [ ] **Performance regression tests**
  - Catch latency degradation early

---

## VII. Decision Points for Fase 3.2

**Based on investigation, recommend prioritization:**

1. **Timeout cap for model switch retry** (5-10 min effort, high impact)
   - Prevents unbounded waits in BUG-14 retry loop

2. **Persistent model list cache** (15-20 min effort, medium impact)
   - Improves availability during network issues

3. **Structured logging in hot paths** (20-30 min effort, high observability)
   - Enables better debugging & analytics

4. **Concurrency stress tests** (30-45 min effort, medium impact)
   - Validates thread-safety fixes
   - Catches race conditions early

**Total for all 4**: ~75 min = achievable in remainder of session.

---

## VIII. Architecture Score Card

| Dimension           | Score | Notes                                                                 |
| ------------------- | ----- | --------------------------------------------------------------------- |
| **Modularity**      | 8/10  | Clean layer separation, minor coupling through index.js               |
| **Testability**     | 7/10  | Good isolation via DI tokens, but weak concurrency tests              |
| **Performance**     | 8/10  | Caching & dedup in place, but no offline fallback                     |
| **Reliability**     | 8/10  | Circuit breaker + error handling, but timeout gaps (BUG-14 mitigates) |
| **Maintainability** | 8/10  | Centralized constants (BUG-07 fixed), but JSDoc-only typing           |
| **Observability**   | 6/10  | Telemetry layer exists, but structured logging missing                |
| **Security**        | 7/10  | Permission model strong, but no input validation schemas              |

**Overall**: 7.7/10 — Solid foundation with strategic gaps addressable in Fase 3.2-3.3.

---

## Next: Fase 3.1 — Profiling & Coverage Analysis

Continuing with:

- Test coverage gaps
- Performance profiling (latency P50/P95)
- Potential memory leaks
