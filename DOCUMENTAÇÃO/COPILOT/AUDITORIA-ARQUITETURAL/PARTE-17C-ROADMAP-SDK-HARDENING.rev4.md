# PARTE-17C — Roadmap de Implementação: SDK Hardening

**Data**: 2026-03-20 (rev.4 — roadmap expandido com cobertura completa do SDK)
**Base**: PARTE-17A rev.4 (análise) + PARTE-17B rev.4 (proposta)
**Autor**: Auditoria automatizada PARTE-17

---

## Sumário Executivo

O roadmap rev.4 expande de **12 faixas / 67 fases / ~250 testes** (rev.3) para **22 faixas /
~130+ fases / ~500+ testes**. A expansão cobre todas as features do SDK identificadas na análise
rev.4, incluindo 17 subsistemas RPC, 70+ event types tipados, novas features (health checks,
quota monitoring, mode/model switching, plan management, compaction, elicitation, etc.), e
infraestrutura de extensibilidade para features experimentais.

### Legenda de Severidade

- 🔴 **CRÍTICO** — Bloqueia estabilidade ou corretude
- 🟡 **IMPORTANTE** — Melhoria significativa de arquitetura
- 🟢 **ENHANCEMENT** — Feature nova ou melhoria incremental

### Estimativa Global

| Dimensão     | Rev.3  | Rev.4      |
| ------------ | ------ | ---------- |
| Faixas       | 12     | **22**     |
| Fases        | ~67    | **~130+**  |
| Testes       | ~250   | **~500+**  |
| Arquivos     | ~35    | **~60**    |
| Linhas novas | ~2.000 | **~4.500** |

---

## Ordenação e Dependências

```
GRUPO 1 — FUNDAÇÃO (Faixas 1-6)
  Faixa 1 ━━━━┓
  Faixa 2 ━━━━╋━━> Faixa 3 ━━> Faixa 4 ━━> Faixa 5 ━━> Faixa 6
  (parallel)  ┛

GRUPO 2 — RPC + EVENTS (Faixas 7-11)
  Faixa 7 ━━> Faixa 8 ━━> Faixa 9
  Faixa 10 ━━> Faixa 11
  (7-9 parallel com 10-11 após Faixa 6)

GRUPO 3 — FEATURES NOVAS (Faixas 12-17)
  Faixa 12 ━━━┓
  Faixa 13 ━━━╋━━> Faixa 17
  Faixa 14 ━━━┛
  Faixa 15 (independente)
  Faixa 16 (independente)

GRUPO 4 — MIGRAÇÃO DE CONSUMERS (Faixas 18-20)
  Faixa 18 ━━> Faixa 19 ━━> Faixa 20

GRUPO 5 — HARDENING + EXPERIMENTAL (Faixas 21-22)
  Faixa 21, Faixa 22 (após Grupo 4)
```

---

## ═══ GRUPO 1 — FUNDAÇÃO ═══

### Faixa 1 — Types & Constants Module 🟡

**Resolve**: P10 (types duplicados) + P4 (hooks types paralelos)
**Cria**: `sdk/types.js`, `sdk/constants.js`

| Fase  | Ação                                                              | Testes |
| :---: | ----------------------------------------------------------------- | :----: |
|  F1   | Criar `sdk/types.js` com re-export de TODOS os ~90 tipos SDK      |   5    |
|  F2   | Criar `sdk/constants.js` (SESSION_MODES, REASONING_EFFORTS, etc.) |   12   |
|  F3   | Adicionar JSDoc em todos os re-exports com descrições em pt-BR    |   —    |
|  F4   | Verificar resolução tsserver para os re-exports                   |   3    |
|  F5   | Marcar `core/sdk-types.js` como `@deprecated`                     |   2    |

**Tests**: ~22  |  **Commit**: `feat(sdk): F1 — types and constants foundation`

---

### Faixa 2 — Tools & Permissions Modules 🟡

**Resolve**: P5 (defineTool bypass), P6 (approveAll bypass)
**Cria**: `sdk/tools.js`, `sdk/permissions.js`

| Fase  | Ação                                                             | Testes |
| :---: | ---------------------------------------------------------------- | :----: |
|  F6   | Criar `sdk/tools.js` com `createTool()` + re-export `defineTool` |   10   |
|  F7   | Criar `sdk/permissions.js` com `approveAll` re-export            |   5    |
|  F8   | Adicionar `createPermissionHandler()` com logging                |   8    |
|  F9   | Adicionar `createAllowlistPermissionHandler()`                   |   6    |
|  F10  | Testes de integração: tool creation + permission handler         |   5    |

**Tests**: ~34  |  **Commit**: `feat(sdk): F2 — tools and permissions facade`

---

### Faixa 3 — SystemMessage Builder 🟡

**Resolve**: P9 (SYSTEM_PROMPT_SECTIONS bypass), P13 (customize mode ausente)
**Cria**: `sdk/system-message.js`

| Fase  | Ação                                                             | Testes |
| :---: | ---------------------------------------------------------------- | :----: |
|  F11  | Criar `sdk/system-message.js` com `appendSystemMessage()`        |   5    |
|  F12  | Implementar `replaceSystemMessage()` com warning log             |   4    |
|  F13  | Implementar `customizeSystemMessage()` com per-section overrides |   10   |
|  F14  | Implementar `sectionOverride()` helper para 5 actions            |   8    |
|  F15  | Re-export `SYSTEM_PROMPT_SECTIONS` e `SECTION_NAMES`             |   3    |
|  F16  | Testes cenários: append+customize combinados                     |   5    |

**Tests**: ~35  |  **Commit**: `feat(sdk): F3 — system-message builder with customize mode`

---

### Faixa 4 — Unified Config Builder 🔴

**Resolve**: P1 (3 config paths)
**Cria**: `sdk/config.js`

| Fase  | Ação                                                             | Testes |
| :---: | ---------------------------------------------------------------- | :----: |
|  F17  | Criar `sdk/config.js` com `buildSessionConfig(input, defaults)`  |   12   |
|  F18  | Implementar `getProjectDefaults()` centralizando defaults atuais |   5    |
|  F19  | Aceitar TODOS os 23 campos de SessionConfig                      |   10   |
|  F20  | Integrar com `sdk/system-message.js` para systemMessage field    |   4    |
|  F21  | Integrar com `sdk/permissions.js` para onPermissionRequest field |   3    |
|  F22  | Deprecar `config/session-config.js` (re-export wrapper)          |   3    |
|  F23  | Testes: config merge agent path vs API path → same output        |   8    |

**Tests**: ~45  |  **Commit**: `feat(sdk): F4 — unified session config builder`

---

### Faixa 5 — Client Wrapper Expansion 🔴

**Resolve**: P2 (dual registry), P7 (CopilotClient bypass), P14 (no health check), P15 (no auth check)
**Refatora**: `sdk/client.js`

| Fase  | Ação                                                             | Testes |
| :---: | ---------------------------------------------------------------- | :----: |
|  F24  | Adicionar `ping()`, `getServerStatus()`, `getAuthStatus()`       |   9    |
|  F25  | Adicionar `getLastSessionId()`, `deleteSession()`                |   6    |
|  F26  | Adicionar `getForegroundSessionId()`, `setForegroundSessionId()` |   4    |
|  F27  | Implementar `on(eventType, handler)` para lifecycle events       |   6    |
|  F28  | Consolidar Map como SSOT — session.js delega para client.js Map  |   10   |
|  F29  | Testes: dual registry scenario → single registry                 |   8    |

**Tests**: ~43  |  **Commit**: `feat(sdk): F5 — client expansion + session registry unification`

---

### Faixa 6 — Session Wrapper Expansion 🔴

**Resolve**: P17 (abort ausente), expansão de métodos
**Refatora**: `sdk/session.js`

| Fase  | Ação                                                            | Testes |
| :---: | --------------------------------------------------------------- | :----: |
|  F30  | Adicionar `abort()` wrapper                                     |   4    |
|  F31  | Adicionar `setModel(model, options)` wrapper                    |   5    |
|  F32  | Adicionar `getMessages()` wrapper                               |   4    |
|  F33  | Expor `workspacePath` getter via wrapper                        |   3    |
|  F34  | Expor `[Symbol.asyncDispose]()` wrapper                         |   3    |
|  F35  | createSession/resumeSession usam unified config (sdk/config.js) |   8    |
|  F36  | Testes: session lifecycle: create → use → abort → disconnect    |   6    |

**Tests**: ~33  |  **Commit**: `feat(sdk): F6 — session expansion with abort, setModel, getMessages`

---

## ═══ GRUPO 2 — RPC + EVENTS ═══

### Faixa 7 — RPC Facade: Core Subsystems 🔴

**Resolve**: P11 (RPC não expostos — parte 1: estáveis)
**Cria**: `sdk/rpc.js` (parte 1)

| Fase  | Ação                                                           | Testes |
| :---: | -------------------------------------------------------------- | :----: |
|  F37  | Criar `sdk/rpc.js` com `createSessionRpc()` structure          |   5    |
|  F38  | Implementar `rpc.model` (getCurrent, switchTo)                 |   6    |
|  F39  | Implementar `rpc.mode` (get, set) [interactive/plan/autopilot] |   8    |
|  F40  | Implementar `rpc.plan` (read, update, delete)                  |   8    |
|  F41  | Implementar `rpc.workspace` (listFiles, readFile, createFile)  |   8    |
|  F42  | Implementar `rpc.log` (message, level, ephemeral, url)         |   4    |
|  F43  | Testes de integração: mode switch → plan read → mode restore   |   5    |

**Tests**: ~44  |  **Commit**: `feat(sdk): F7 — RPC facade core subsystems (model, mode, plan, workspace)`

---

### Faixa 8 — RPC Facade: Advanced Subsystems 🟡

**Resolve**: P11 (RPC não expostos — parte 2)
**Expande**: `sdk/rpc.js`

| Fase  | Ação                                                           | Testes |
| :---: | -------------------------------------------------------------- | :----: |
|  F44  | Implementar `rpc.compaction` (compact)                         |   4    |
|  F45  | Implementar `rpc.shell` (exec, kill)                           |   8    |
|  F46  | Implementar `rpc.ui` (elicitation)                             |   6    |
|  F47  | Implementar `rpc.commands` (handlePendingCommand)              |   4    |
|  F48  | Implementar `rpc.permissions` (handlePendingPermissionRequest) |   4    |
|  F49  | Implementar `rpc.tools` (handlePendingToolCall)                |   4    |
|  F50  | Testes: shell exec + kill scenario                             |   4    |

**Tests**: ~34  |  **Commit**: `feat(sdk): F8 — RPC facade advanced subsystems (shell, ui, compaction)`

---

### Faixa 9 — Server RPC Facade 🟡

**Resolve**: P16 (quota não monitorada), P14 (no health check)
**Cria**: `sdk/health.js`, expande `sdk/rpc.js` com `createServerRpc()`

| Fase  | Ação                                                          | Testes |
| :---: | ------------------------------------------------------------- | :----: |
|  F51  | Criar `createServerRpc()` em `sdk/rpc.js`                     |   4    |
|  F52  | Criar `sdk/health.js` com `ping()`, `getServerStatus()`       |   6    |
|  F53  | Adicionar `getAuthStatus()` em health.js                      |   5    |
|  F54  | Adicionar `getQuota()` em health.js                           |   5    |
|  F55  | Implementar `fullHealthCheck()` (ping + auth + quota)         |   6    |
|  F56  | Testes: health check cenários (ok, auth fail, quota exceeded) |   6    |

**Tests**: ~32  |  **Commit**: `feat(sdk): F9 — server RPC + health check facade`

---

### Faixa 10 — Event System Typed 🔴

**Resolve**: P12 (70+ events sem tipagem)
**Cria**: `sdk/events.js`

| Fase  | Ação                                                               | Testes |
| :---: | ------------------------------------------------------------------ | :----: |
|  F57  | Criar `sdk/events.js` com `SESSION_EVENTS` constant map (70+ keys) |   5    |
|  F58  | Implementar `onSessionEvent()` tipado                              |   8    |
|  F59  | Implementar `onSessionEvents()` (multi-handler registration)       |   5    |
|  F60  | Implementar `getEventPayload()` extractor                          |   6    |
|  F61  | JSDoc dos 10 event types mais usados com payload completo          |   —    |
|  F62  | Testes: handler registration + payload extraction por tipo         |   8    |

**Tests**: ~32  |  **Commit**: `feat(sdk): F10 — typed event system for 70+ session events`

---

### Faixa 11 — Session Lifecycle Events 🟡

**Cria**: `sdk/session-lifecycle.js`

| Fase  | Ação                                                          | Testes |
| :---: | ------------------------------------------------------------- | :----: |
|  F63  | Criar `sdk/session-lifecycle.js` com `LIFECYCLE_EVENTS`       |   4    |
|  F64  | Implementar `onLifecycleEvent()` tipado                       |   6    |
|  F65  | Implementar typed handlers para 5 lifecycle event types       |   5    |
|  F66  | Testes: lifecycle event flow (created → foreground → deleted) |   5    |

**Tests**: ~20  |  **Commit**: `feat(sdk): F11 — session lifecycle events typed`

---

## ═══ GRUPO 3 — FEATURES NOVAS ═══

### Faixa 12 — Provider/BYOK Support 🟡

**Resolve**: gap de ProviderConfig não wrapped
**Cria**: `sdk/provider.js`

| Fase  | Ação                                                       | Testes |
| :---: | ---------------------------------------------------------- | :----: |
|  F67  | Criar `sdk/provider.js` com `openaiProvider()`             |   4    |
|  F68  | Implementar `azureProvider()` com campos específicos Azure |   5    |
|  F69  | Implementar `anthropicProvider()`                          |   4    |
|  F70  | Validação de ProviderConfig (required fields por tipo)     |   8    |
|  F71  | Integrar com `sdk/config.js` (campo provider no builder)   |   3    |

**Tests**: ~24  |  **Commit**: `feat(sdk): F12 — BYOK provider config facade`

---

### Faixa 13 — Telemetry & Tracing 🟢

**Cria**: `sdk/telemetry.js`

| Fase  | Ação                                                          | Testes |
| :---: | ------------------------------------------------------------- | :----: |
|  F72  | Criar `sdk/telemetry.js` com `getTraceContext()` re-export    |   3    |
|  F73  | Implementar `createTelemetryConfig()` builder                 |   5    |
|  F74  | Integrar com `sdk/config.js` (CopilotClientOptions.telemetry) |   4    |
|  F75  | Testes: trace context propagation                             |   4    |

**Tests**: ~16  |  **Commit**: `feat(sdk): F13 — telemetry and tracing facade`

---

### Faixa 14 — Models Expansion 🟡

**Refatora**: `sdk/models.js`

| Fase  | Ação                                                                  | Testes |
| :---: | --------------------------------------------------------------------- | :----: |
|  F76  | Adicionar `getModelById()` com cache                                  |   5    |
|  F77  | Adicionar helpers: `hasVision()`, `getMaxTokens()`, etc.              |   8    |
|  F78  | Adicionar `getSupportedReasoningEfforts()`                            |   4    |
|  F79  | Tipar `ModelInfo`, `ModelCapabilities`, `ModelPolicy`, `ModelBilling` |   5    |
|  F80  | Testes: model capabilities checks e seleção                           |   5    |

**Tests**: ~27  |  **Commit**: `feat(sdk): F14 — models expansion with capabilities helpers`

---

### Faixa 15 — Agents Runtime Management 🟡

**Refatora**: `sdk/agents.js`

| Fase  | Ação                                           | Testes |
| :---: | ---------------------------------------------- | :----: |
|  F81  | Adicionar `listAgents(session)` via RPC        |   4    |
|  F82  | Adicionar `selectAgent(session, name)` via RPC |   4    |
|  F83  | Adicionar `deselectAgent(session)` via RPC     |   3    |
|  F84  | Adicionar `reloadAgents(session)` via RPC      |   3    |
|  F85  | Testes: agent selection flow                   |   5    |

**Tests**: ~19  |  **Commit**: `feat(sdk): F15 — agents runtime management via RPC`

---

### Faixa 16 — Barrel Export & Index Rewrite 🟡

**Refatora**: `sdk/index.js`

| Fase  | Ação                                                               | Testes |
| :---: | ------------------------------------------------------------------ | :----: |
|  F86  | Rewrite `sdk/index.js` como barrel completo de todos os 18 módulos |   —    |
|  F87  | Verificar tree-shaking com import seletivo                         |   3    |
|  F88  | Deprecar `sdk/tools-registry.js` (re-export para sdk/tools.js)     |   2    |
|  F89  | Testes: import { X } from '#copilot/sdk' para cada export          |   15   |

**Tests**: ~20  |  **Commit**: `feat(sdk): F16 — complete barrel export rewrite`

---

### Faixa 17 — Integration Tests: New Features 🟡

**Depende de**: F12, F13, F14

| Fase  | Ação                                                            | Testes |
| :---: | --------------------------------------------------------------- | :----: |
|  F90  | Tests e2e: health check no boot → auth → quota → session create |   5    |
|  F91  | Tests e2e: mode switch → plan CRUD → mode restore               |   5    |
|  F92  | Tests e2e: model switch mid-session → verify context preserved  |   4    |
|  F93  | Tests e2e: provider config validation + session creation        |   4    |
|  F94  | Tests e2e: system-message customize mode com section overrides  |   5    |

**Tests**: ~23  |  **Commit**: `test(sdk): F17 — integration tests for new SDK features`

---

## ═══ GRUPO 4 — MIGRAÇÃO DE CONSUMERS ═══

### Faixa 18 — Migrate Tools & Bridges (11+1 arquivos) 🟡

**Resolve**: P5 (defineTool bypass), parte de P8

| Fase  | Ação                                                             | Testes |
| :---: | ---------------------------------------------------------------- | :----: |
|  F95  | Migrar 11 tools files: `defineTool` → `createTool` from sdk      |   —    |
|  F96  | Migrar `bridges/mcp-tool-bridge.js`: `defineTool` → `createTool` |   —    |
|  F97  | Atualizar imports em todos os 12 arquivos                        |   —    |
|  F98  | Testes: tools ainda funcionam após migração                      |   12   |

**Tests**: ~12  |  **Commit**: `refactor(sdk): F18 — migrate defineTool to sdk facade`

---

### Faixa 19 — Migrate Config, Hooks, Agent, API, Audit 🔴

**Resolve**: P1 (config paths), P6 (approveAll bypass), P7 (CopilotClient bypass)

| Fase  | Ação                                                          | Testes |
| :---: | ------------------------------------------------------------- | :----: |
|  F99  | Migrar `config/session-config.js` → deprecated re-export      |   3    |
| F100  | Migrar `config/system-prompt.js` → usar sdk/system-message.js |   3    |
| F101  | Migrar 5 files com approveAll → `from '#copilot/sdk'`         |   5    |
| F102  | Migrar `agent/lifecycle/initializer.js` → usar sdk/client.js  |   6    |
| F103  | Migrar `agent/always-alive.js` → usar sdk/ client + session   |   5    |
| F104  | Migrar `api/routes/sessions.js` → usar sdk/config.js          |   5    |
| F105  | Migrar `audit/pipeline.js` → usar sdk/permissions.js          |   2    |
| F106  | Testes de regressão: boot flow, API routes, audit pipeline    |   10   |

**Tests**: ~39  |  **Commit**: `refactor(sdk): F19 — migrate all bypass consumers to sdk facade`

---

### Faixa 20 — ESLint Enforcement + Types Cleanup 🟡

**Resolve**: P3 (config barrel boundary), P4 (hooks types paralelos)

| Fase  | Ação                                                                   | Testes |
| :---: | ---------------------------------------------------------------------- | :----: |
| F107  | Adicionar `no-restricted-imports` no ESLint para `@github/copilot-sdk` |   —    |
| F108  | Verificar zero imports diretos remanescentes                           |   3    |
| F109  | `hooks/types.js` → alinhar com sdk/types.js (extends pattern)          |   5    |
| F110  | `core/sdk-types.js` → re-export de sdk/types.js + deprecation          |   3    |
| F111  | `config/index.js` → remover re-exports de sdk/ (boundary fix)          |   3    |
| F112  | Testes: ESLint passa, zero imports diretos, types resolve              |   5    |

**Tests**: ~19  |  **Commit**: `refactor(sdk): F20 — ESLint enforcement + types consolidation`

---

## ═══ GRUPO 5 — HARDENING + EXPERIMENTAL ═══

### Faixa 21 — Observability Integration 🟡

**Resolve**: P12 (event types), P16 (quota monitoring)

| Fase  | Ação                                                           | Testes |
| :---: | -------------------------------------------------------------- | :----: |
| F113  | Migrar `observability/event-collector.js` → usar sdk/events.js |   5    |
| F114  | Migrar `bridges/nerv-bridge.js` → usar sdk/events.js typed     |   5    |
| F115  | Adicionar quota monitoring periódico em observability          |   5    |
| F116  | Adicionar auth status no health dashboard                      |   3    |
| F117  | Testes: events tipados → NERV bridge → dashboard               |   5    |

**Tests**: ~23  |  **Commit**: `feat(sdk): F21 — observability with typed events + quota monitoring`

---

### Faixa 22 — Experimental Features (gated) 🟢

**Resolve**: features experimentais do SDK com feature flags

| Fase  | Ação                                                           | Testes |
| :---: | -------------------------------------------------------------- | :----: |
| F118  | Implementar `rpc.fleet.start()` com feature flag               |   3    |
| F119  | Implementar `rpc.agent.*` (list, select, etc.) gated           |   5    |
| F120  | Implementar `rpc.skills.*` (list, enable, disable..) gated     |   5    |
| F121  | Implementar `rpc.mcp.*` (list, enable, disable..) gated        |   5    |
| F122  | Implementar `rpc.plugins.list()` gated                         |   2    |
| F123  | Implementar `rpc.extensions.*` (list, enable, disable..) gated |   5    |
| F124  | Criar config de feature flags para experimental APIs           |   5    |
| F125  | Testes: feature flag on/off para cada experimental subsistema  |   8    |

**Tests**: ~38  |  **Commit**: `feat(sdk): F22 — experimental RPC features with feature flags`

---

## Resumo por Faixa

| Faixa | Nome                               | Sev.  | Resolve       |   Fases   |  Tests   |  Dep.   |
| :---: | ---------------------------------- | :---: | ------------- | :-------: | :------: | :-----: |
|   1   | Types & Constants                  |   🟡   | P10, P4       |   F1-F5   |   ~22    | nenhum  |
|   2   | Tools & Permissions                |   🟡   | P5, P6        |  F6-F10   |   ~34    | nenhum  |
|   3   | SystemMessage Builder              |   🟡   | P9, P13       |  F11-F16  |   ~35    |   F1    |
|   4   | Unified Config                     |   🔴   | P1            |  F17-F23  |   ~45    | F2, F3  |
|   5   | Client Expansion                   |   🔴   | P2,P7,P14,P15 |  F24-F29  |   ~43    |   F4    |
|   6   | Session Expansion                  |   🔴   | P17           |  F30-F36  |   ~33    |   F5    |
|   7   | RPC Core Subsystems                |   🔴   | P11 (1/2)     |  F37-F43  |   ~44    |   F6    |
|   8   | RPC Advanced Subsystems            |   🟡   | P11 (2/2)     |  F44-F50  |   ~34    |   F7    |
|   9   | Server RPC + Health                |   🟡   | P16, P14      |  F51-F56  |   ~32    |   F5    |
|  10   | Event System Typed                 |   🔴   | P12           |  F57-F62  |   ~32    |   F1    |
|  11   | Session Lifecycle Events           |   🟡   | —             |  F63-F66  |   ~20    |   F5    |
|  12   | Provider/BYOK                      |   🟡   | —             |  F67-F71  |   ~24    |   F4    |
|  13   | Telemetry & Tracing                |   🟢   | —             |  F72-F75  |   ~16    |   F1    |
|  14   | Models Expansion                   |   🟡   | —             |  F76-F80  |   ~27    |   F5    |
|  15   | Agents Runtime Management          |   🟡   | —             |  F81-F85  |   ~19    |   F7    |
|  16   | Barrel Export Rewrite              |   🟡   | —             |  F86-F89  |   ~20    | F1-F15  |
|  17   | Integration Tests (New Features)   |   🟡   | —             |  F90-F94  |   ~23    | F12-14  |
|  18   | Migrate Tools & Bridges            |   🟡   | P5, P8        |  F95-F98  |   ~12    |   F2    |
|  19   | Migrate Config/Hooks/Agent/API     |   🔴   | P1,P6,P7      | F99-F106  |   ~39    |  F4-F6  |
|  20   | ESLint Enforcement + Types Cleanup |   🟡   | P3, P4        | F107-F112 |   ~19    | F18,F19 |
|  21   | Observability Integration          |   🟡   | P12, P16      | F113-F117 |   ~23    |   F10   |
|  22   | Experimental Features              |   🟢   | —             | F118-F125 |   ~38    |  F7-F8  |
|       | **TOTAIS**                         |       |               | **~125**  | **~574** |         |

---

## Estratégia de Commits

Cada faixa = 1 commit temático. Pattern:

```
feat(sdk): F{N} — {descrição curta da faixa}

- {lista de arquivos criados/modificados}
- Tests: {N} novos ({N} unit, {N} integratio
- Resolve: P{X}, P{Y}
```

Para faixas grandes (>40 tests), considerar split em 2 commits:
- `feat(sdk): F{N}a — {módulos criados}`
- `test(sdk): F{N}b — {testes do módulo}`

---

## Quality Gates por Faixa

Cada faixa DEVE passar antes de prosseguir:

1. ✅ `npm run lint` — zero erros
2. ✅ `npm run format:check` — zero diff
3. ✅ `npm run test:unit` — todos passam
4. ✅ `npm run typecheck:node` — zero erros novos
5. ✅ Imports diretos de `@github/copilot-sdk` ≤ N (decresce por faixa)
6. ✅ Code review dos novos módulos sdk/

### Métricas de Bypass por Faixa (regressão esperada)

| Após Faixa | Imports `@github/copilot-sdk` diretos | Diferença       |
| :--------: | :-----------------------------------: | :-------------- |
|  Baseline  |                  20                   | —               |
|     F2     |                  20                   | (módulo pronto) |
|    F18     |                   8                   | -12 (tools)     |
|    F19     |                   0                   | -8 (rest)       |
|    F20     |                   0                   | ESLint block    |

---

## Matriz de Riscos por Faixa

| Faixa | Risco Principal                                   | Probabilidade | Mitigação                          |
| :---: | ------------------------------------------------- | :-----------: | ---------------------------------- |
|   4   | Config merge incompatível com API path            |     Médio     | Testes comparativos output         |
|   5   | Dual registry cleanup quebra consumers existentes |     Alto      | Feature flag + backward compat map |
|   7   | RPC subsistemas indisponíveis em versão SDK 0.2.0 |     Baixo     | Pin versão + graceful fallback     |
|   8   | Shell exec RPC — security implications            |     Médio     | Sandbox + permissão explícita      |
|  10   | 70+ event types — maintenance burden grande       |     Médio     | Geração semi-automática dos types  |
|  19   | Migração de consumers — breaking changes          |     Alto      | Deprecated re-exports por 2 faixas |
|  22   | Features experimentais removidas em SDK futuro    |     Médio     | Feature flags + abstração          |

---

## Ordem de Execução Recomendada

**Fase Imediata (Faixas 1-6)**: Fundação — pode começar imediatamente, nenhuma dep. externa.

**Fase Core (Faixas 7-11)**: RPC + Events — depende da fundação, habilita features.

**Fase Features (Faixas 12-17)**: Novas features — pode executar em paralelo com migração.

**Fase Migração (Faixas 18-20)**: Consumer migration — executa após fundação + core prontos.

**Fase Final (Faixas 21-22)**: Hardening + experimental — depois da migração completa.

---

*Documento gerado pela auditoria PARTE-17, rev.4. Roadmap expandido de 12→22 faixas,
67→~125 fases, ~250→~574 testes. Base: API Surface completa do SDK (9 arquivos de declaração,
4.498 linhas). Revisões anteriores preservadas em .rev2.md e .rev3.md.*
