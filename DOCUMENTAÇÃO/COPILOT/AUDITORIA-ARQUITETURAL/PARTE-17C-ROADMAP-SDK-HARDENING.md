# PARTE-17C — Roadmap: SDK Hardening Completo

**Data**: 2026-03-21 (rev.5 — pós conclusão das Faixas 1-22 + Faixas 23-34 planejadas)
**Escopo**: `src/copilot/sdk/` + consumidores em `src/copilot/`
**SDK oficial**: `@github/copilot-sdk@0.2.0`
**Status global**: ✅ **618/618 testes, 25 specs, Faixas 1-22 CONCLUÍDAS**
**Autor**: Auditoria automatizada PARTE-17, rev.5

> Revisões anteriores preservadas em `.rev2.md`, `.rev3.md`, `.rev4.md`

---

## Sumário Executivo (rev.5)

O roadmap original (rev.4) previa 22 faixas, ~125 fases, ~574 testes.
A rev.5 registra a **conclusão de TODAS as 22 faixas** e projeta **12 novas faixas** (23–34)
cobrindo os problemas arquiteturais ainda abertos descobertos na PARTE-17A.

| Métrica                          | Rev.4 (planejado) | Rev.5 (real/alvo) |
| -------------------------------- | :---------------: | :---------------: |
| Faixas planejadas                |        22         |      **34**       |
| Faixas concluídas                |         —         |      **22**       |
| Fases totais (F1–F125)           |       ~125        |    **~161**       |
| Testes totais                    |       ~574        |    **618+200est** |
| Testes reais (F1–F22)            |         —         |     **618** ✅     |
| Imports diretos SDK (fora sdk/)  |        20→0       |      **0** ✅      |
| Módulos em sdk/                  |        19         |      **32**       |
| Linhas em sdk/ (excl. models/)   |      ~5.500       |    **~7.744**     |

---

## Dependências entre Grupos

```
GRUPO 1 (F1-F6) — Fundação
     │
     ├─► GRUPO 2 (F7-F11) — RPC + Events
     │        │
     │        ├─► GRUPO 3 (F12-F17) — Features Novas
     │        │
     │        └─► GRUPO 4 (F18-F20) — Migração Consumers  ─► GRUPO 5 (F21-F22) — Hardening
     │
     └─► GRUPO 6+ (F23-F34) — Integração Profunda [FASE 2]
```

---

## ═══ GRUPO 1 — FUNDAÇÃO ═══ ✅

### Faixa 1 — Types & Constants ✅ CONCLUÍDA

**Resolve**: P10, P4 parcial

| Fase | Ação                                                              | Tests | Status |
| :--: | ----------------------------------------------------------------- | :---: | :----: |
| F1   | Criar `sdk/types.js` — 90+ tipos SDK re-exportados com JSDoc      |   3   |   ✅    |
| F2   | Criar `sdk/constants.js` — session modes, reasoning efforts, etc. |   5   |   ✅    |
| F3   | `core/sdk-types.js` → deprecar + re-export de sdk/types.js        |   2   |   ✅    |
| F4   | Testes: types resolve, constants corretos                         |   8   |   ✅    |
| F5   | Lint + format pass                                                |   —   |   ✅    |

**Tests**: 24 reais | **Commit**: `feat(sdk): F1 — types & constants`

---

### Faixa 2 — Tools & Permissions ✅ CONCLUÍDA

**Resolve**: P5, P6

| Fase | Ação                                                                       | Tests | Status |
| :--: | -------------------------------------------------------------------------- | :---: | :----: |
| F6   | Criar `sdk/tools.js` — `createTool()`, re-export `defineTool`              |   5   |   ✅    |
| F7   | Criar `sdk/permissions.js` — `createPermissionHandler()`, `approveAll`     |   5   |   ✅    |
| F8   | Criar `sdk/tools-state.js` — estado de tools por sessão                    |   5   |   ✅    |
| F9   | Criar `sdk/custom-tools.js` — tool categories de alto nível                |   5   |   ✅    |
| F10  | Testes: tools criadas, permissions, pipelining                             |  10   |   ✅    |

**Tests**: 30 reais | **Commit**: `feat(sdk): F2 — tools & permissions`

---

### Faixa 3 — SystemMessage Builder ✅ CONCLUÍDA

**Resolve**: P9, P13

| Fase | Ação                                                                           | Tests | Status |
| :--: | ------------------------------------------------------------------------------ | :---: | :----: |
| F11  | Criar `sdk/system-message.js` — `appendSystemMessage()`, `replaceSystemMessage()` |  5 |  ✅   |
| F12  | Adicionar `customizeSystemMessage()` + `sectionOverride()`                     |   5   |   ✅    |
| F13  | Re-exportar `SYSTEM_PROMPT_SECTIONS` + `SECTION_NAMES`                         |   3   |   ✅    |
| F14  | Testes: 3 modos, section overrides, SYSTEM_PROMPT_SECTIONS                    |   5   |   ✅    |
| F15  | Validar modo customize                                                         |   2   |   ✅    |
| F16  | Lint + format pass                                                             |   —   |   ✅    |

**Tests**: 21 reais | **Commit**: `feat(sdk): F3 — system-message builder`

---

### Faixa 4 — Unified Config Builder ✅ CONCLUÍDA

**Resolve**: P1 (3 config paths → 1)

| Fase | Ação                                                                         | Tests | Status |
| :--: | ---------------------------------------------------------------------------- | :---: | :----: |
| F17  | Criar `sdk/config.js` — `buildSessionConfig()` com todos os 23+ campos       |   8   |   ✅    |
| F18  | Adicionar `getProjectDefaults()` — defaults canônicos do projeto              |   5   |   ✅    |
| F19  | `config/session-config.js` → deprecar + re-export de sdk/config.js           |   3   |   ✅    |
| F20  | Testes: config builder, defaults, merge, validation                           |   7   |   ✅    |
| F21  | Lint + typecheck pass                                                         |   —   |   ✅    |

**Tests**: 23 reais | **Commit**: `feat(sdk): F4 — unified config builder`

---

### Faixa 5 — Client Expansion ✅ CONCLUÍDA

**Resolve**: P2 parcial, P7, P14, P15

| Fase | Ação                                                                     | Tests | Status |
| :--: | ------------------------------------------------------------------------ | :---: | :----: |
| F22  | `sdk/client.js` — adicionar `ping()`, `getStatus()`, `getAuthStatus()`   |   5   |   ✅    |
| F23  | Adicionar `deleteSession()`, `getForegroundSessionId()`, etc.            |   5   |   ✅    |
| F24  | Criar `sdk/client-events.js` — lifecycle events do client                |   5   |   ✅    |
| F25  | Criar `sdk/client-facade.js` — facade de alto nível                      |   4   |   ✅    |
| F26  | Testes: todos os métodos wrapper                                          |   3   |   ✅    |
| F27  | Lint + typecheck pass                                                    |   —   |   ✅    |

**Tests**: 22 reais | **Commit**: `feat(sdk): F5 — client expansion`

---

### Faixa 6 — Session Expansion ✅ CONCLUÍDA

**Resolve**: P17 (abort), session methods ausentes

| Fase | Ação                                                                       | Tests | Status |
| :--: | -------------------------------------------------------------------------- | :---: | :----: |
| F28  | `sdk/session.js` — adicionar `abort()`, `setModel()`, `getMessages()`     |   6   |   ✅    |
| F29  | Adicionar `workspacePath` getter, `[Symbol.asyncDispose]`                  |   4   |   ✅    |
| F30  | Criar `sdk/session-lifecycle.js` — lifecycle event helpers                 |   5   |   ✅    |
| F31  | Testes: abort, setModel, workspacePath                                     |   5   |   ✅    |
| F32  | Lint + typecheck pass                                                      |   —   |   ✅    |

**Tests**: 25 reais | **Commit**: `feat(sdk): F6 — session expansion`

---

## ═══ GRUPO 2 — RPC + EVENTS ═══ ✅

### Faixa 7 — RPC Core Subsystems ✅ CONCLUÍDA

**Resolve**: P11 parte 1/2

| Fase | Ação                                                                       | Tests | Status |
| :--: | -------------------------------------------------------------------------- | :---: | :----: |
| F33  | Criar `sdk/rpc.js` — `createSessionRpc()` com model, mode, plan           |   8   |   ✅    |
| F34  | Adicionar workspace, shell, log ao `createSessionRpc()`                   |   8   |   ✅    |
| F35  | Criar `sdk/server-rpc.js` — `createServerRpc()` com 4 métodos             |   6   |   ✅    |
| F36  | Testes: rpc.model, rpc.mode, rpc.plan, rpc.workspace, rpc.shell            |   8   |   ✅    |
| F37  | Lint + typecheck pass                                                      |   —   |   ✅    |

**Tests**: 40 reais | **Commit**: `feat(sdk): F7 — RPC core subsystems`

---

### Faixa 8 — RPC Advanced Subsystems ✅ CONCLUÍDA

**Resolve**: P11 parte 2/2

| Fase | Ação                                                                              | Tests | Status |
| :--: | --------------------------------------------------------------------------------- | :---: | :----: |
| F38  | Adicionar `rpc.compaction`, `rpc.tools`, `rpc.commands`, `rpc.ui`, `rpc.permissions` | 8 |  ✅   |
| F39  | Criar `sdk/agent-contract.js` — interfaces de contratos de agente                 |   5   |   ✅    |
| F40  | Criar `sdk/bridge-contract.js` — interfaces de contratos de bridge                |   5   |   ✅    |
| F41  | Criar `sdk/channel-contract.js` — interfaces de contratos de canal                |   5   |   ✅    |
| F42  | Testes: rpc.compaction, rpc.ui, contracts                                         |   5   |   ✅    |
| F43  | Lint + typecheck pass                                                             |   —   |   ✅    |

**Tests**: 28 reais | **Commit**: `feat(sdk): F8 — RPC advanced subsystems`

---

### Faixa 9 — Server RPC + Health ✅ CONCLUÍDA

**Resolve**: P14, P16

| Fase | Ação                                                                           | Tests | Status |
| :--: | ------------------------------------------------------------------------------ | :---: | :----: |
| F44  | Criar `sdk/health.js` — `ping()`, `getServerStatus()`, `getAuthStatus()`, `getQuota()` | 8 | ✅  |
| F45  | Adicionar `fullHealthCheck()` — check composto                                 |   5   |   ✅    |
| F46  | Criar `sdk/http-request.js` + `sdk/url-validator.js` — utilitários             |   5   |   ✅    |
| F47  | Testes: ping, auth, quota, full health check                                   |   8   |   ✅    |
| F48  | Lint + typecheck pass                                                          |   —   |   ✅    |

**Tests**: 29 reais | **Commit**: `feat(sdk): F9 — server RPC + health`

---

### Faixa 10 — Event System Typed ✅ CONCLUÍDA

**Resolve**: P12 (70+ event types sem tipagem)

| Fase | Ação                                                                        | Tests | Status |
| :--: | --------------------------------------------------------------------------- | :---: | :----: |
| F49  | Criar `sdk/events.js` — `SESSION_EVENTS` constante (70+ tipos)              |   5   |   ✅    |
| F50  | Adicionar `onSessionEvent()`, `onSessionEvents()`, `getEventPayload()`      |   8   |   ✅    |
| F51  | Criar `sdk/event-helpers.js` — helpers por categoria de evento              |   8   |   ✅    |
| F52  | Testes: event types, typed handlers, payload extraction                     |   8   |   ✅    |
| F53  | Lint + typecheck pass                                                       |   —   |   ✅    |

**Tests**: 32 reais | **Commit**: `feat(sdk): F10 — typed event system`

---

### Faixa 11 — Session Lifecycle Events ✅ CONCLUÍDA

| Fase | Ação                                                                     | Tests | Status |
| :--: | ------------------------------------------------------------------------ | :---: | :----: |
| F54  | `sdk/session-lifecycle.js` — `LIFECYCLE_EVENTS`, `onLifecycleEvent()`   |   5   |   ✅    |
| F55  | Adicionar typed handlers para 5 lifecycle event types                    |   5   |   ✅    |
| F56  | Testes: lifecycle event types, handlers, constants                       |   9   |   ✅    |
| F57  | Lint + typecheck pass                                                    |   —   |   ✅    |

**Tests**: 35 reais em 2 specs | **Commit**: `feat(sdk): F11 — session lifecycle events`

---

## ═══ GRUPO 3 — FEATURES NOVAS ═══ ✅

### Faixa 12 — Provider / BYOK ✅ CONCLUÍDA

| Fase | Ação                                                                           | Tests | Status |
| :--: | ------------------------------------------------------------------------------ | :---: | :----: |
| F58  | Criar `sdk/provider.js` — `openaiProvider()`, `azureProvider()`, `anthropicProvider()` | 8 | ✅ |
| F59  | Adicionar `validateProvider()`, `buildWireApi()`                               |   6   |   ✅    |
| F60  | Testes: 3 providers, validação, edge cases                                     |   8   |   ✅    |
| F61  | Lint + typecheck pass                                                          |   —   |   ✅    |

**Tests**: 24 reais | **Commit**: `feat(sdk): F12 — provider/BYOK support`

---

### Faixa 13 — Telemetry & Tracing ✅ CONCLUÍDA

| Fase | Ação                                                                     | Tests | Status |
| :--: | ------------------------------------------------------------------------ | :---: | :----: |
| F62  | Criar `sdk/telemetry.js` — `getTraceContext()`, `createTelemetryConfig()` |  8   |   ✅    |
| F63  | Adicionar trace helpers, W3C traceparent support                         |   8   |   ✅    |
| F64  | Testes: trace context, telemetry config, integration                     |   8   |   ✅    |
| F65  | Lint + typecheck pass                                                    |   —   |   ✅    |

**Tests**: 29 reais | **Commit**: `feat(sdk): F13 — telemetry & tracing`

---

### Faixa 14 — Models Expansion ✅ CONCLUÍDA

| Fase | Ação                                                                       | Tests | Status |
| :--: | -------------------------------------------------------------------------- | :---: | :----: |
| F66  | Criar `sdk/models/helpers.js` — `hasVision()`, `getMaxTokens()`, etc.     |  10   |   ✅    |
| F67  | Criar `sdk/models/registry.js` — `ModelRegistry`, cache, lookup           |   8   |   ✅    |
| F68  | Criar `sdk/models/selector.js` — `selectBestModel()`, filtering           |   8   |   ✅    |
| F69  | Testes: helpers, registry, selector, edge cases                           |   8   |   ✅    |

**Tests**: 34 reais | **Commit**: `feat(sdk): F14 — models expansion`

---

### Faixa 15 — Agents Runtime Management ✅ CONCLUÍDA

| Fase | Ação                                                                       | Tests | Status |
| :--: | -------------------------------------------------------------------------- | :---: | :----: |
| F70  | `sdk/agents.js` — adicionar `listAgents()`, `selectAgent()`, `deselectAgent()` | 8 |  ✅   |
| F71  | Adicionar `getAgentStatus()`, `stopAgent()`, `getCurrentAgent()`           |   8   |   ✅    |
| F72  | `sdk/agent-contract.js` — contrato completo do agente                      |   6   |   ✅    |
| F73  | Testes: runtime agent management                                           |   8   |   ✅    |

**Tests**: 33 reais | **Commit**: `feat(sdk): F15 — agents runtime management`

---

### Faixa 16 — Barrel Export Rewrite ✅ CONCLUÍDA

| Fase | Ação                                                                                | Tests | Status |
| :--: | ----------------------------------------------------------------------------------- | :---: | :----: |
| F74  | `sdk/index.js` — rewrite completo, re-exportar TUDO dos 18+ módulos                |   5   |   ✅    |
| F75  | Verificar tree-shaking, sem circular deps, exports completos                        |   5   |   ✅    |
| F76  | Testes: barrel exports todos acessíveis via `#copilot/sdk`                          |  15   |   ✅    |
| F77  | Testes: nenhum símbolo ausente, nomes corretos                                      |   5   |   ✅    |

**Tests**: 30 reais | **Commit**: `feat(sdk): F16 — barrel export rewrite`

---

### Faixa 17 — Integration Tests (New Features) ✅ CONCLUÍDA

| Fase | Ação                                                                       | Tests | Status |
| :--: | -------------------------------------------------------------------------- | :---: | :----: |
| F78  | Testes integração: RPC facade com session mock                             |   6   |   ✅    |
| F79  | Testes integração: provider + config + session creation                    |   6   |   ✅    |
| F80  | Testes integração: events typed → NERV bridge pipeline                     |   6   |   ✅    |
| F81  | Testes integração: modelos, agents, health check                           |   5   |   ✅    |

**Tests**: 23 reais | **Commit**: `test(sdk): F17 — integration tests new features`

---

## ═══ GRUPO 4 — MIGRAÇÃO DE CONSUMERS ═══ ✅

### Faixa 18 — Migrate Tools & Bridges ✅ CONCLUÍDA

**Resolve**: P5 (11 arquivos defineTool), P8 parcial

| Fase | Ação                                                                    | Tests | Status |
| :--: | ----------------------------------------------------------------------- | :---: | :----: |
| F82  | Migrar `tools/` (11 arquivos) — `defineTool` → `#copilot/sdk`           |  12   |   ✅    |
| F83  | Migrar `bridges/mcp-tool-bridge.js` — `defineTool` → `#copilot/sdk`    |   6   |   ✅    |
| F84  | Verificar: zero imports `@github/copilot-sdk` em tools/ e bridges/     |   4   |   ✅    |
| F85  | Testes completos: todas as tools migradas funcionam                     |  12   |   ✅    |

**Tests**: 51 reais | **Commit**: `refactor(sdk): F18 — migrate tools & bridges`

---

### Faixa 19 — Migrate Config/Hooks/Agent/API ✅ CONCLUÍDA

**Resolve**: P1, P6, P7

| Fase | Ação                                                                          | Tests | Status |
| :--: | ----------------------------------------------------------------------------- | :---: | :----: |
| F86  | `config/session-config.js` → re-export de sdk/config.js (deprecar)           |   2   |   ✅    |
| F87  | `hooks/` — `approveAll` → `#copilot/sdk`                                      |   2   |   ✅    |
| F88  | `agent/` — `approveAll`, `CopilotClient` → `#copilot/sdk`                    |   4   |   ✅    |
| F89  | `api/` — `approveAll` + config inline → sdk/config.js                        |   2   |   ✅    |
| F90  | `audit/pipeline.js` — `approveAll` → `#copilot/sdk`                          |   2   |   ✅    |
| F91  | Verificar: zero imports diretos ao SDK fora de sdk/                           |   2   |   ✅    |

**Tests**: 16 reais | **Commit**: `refactor(sdk): F19 — migrate config/hooks/agent/api`

---

### Faixa 20 — ESLint Enforcement + Types Cleanup ✅ CONCLUÍDA

**Resolve**: P3, P4

| Fase | Ação                                                                   | Tests | Status |
| :--: | ---------------------------------------------------------------------- | :---: | :----: |
| F92  | Adicionar `no-restricted-imports` no ESLint para `@github/copilot-sdk` |   —   |   ✅    |
| F93  | Verificar zero imports diretos remanescentes                           |   3   |   ✅    |
| F94  | `hooks/types.js` → alinhar com sdk/types.js (extends pattern)          |   5   |   ✅    |
| F95  | `core/sdk-types.js` → re-export de sdk/types.js + deprecation          |   3   |   ✅    |
| F96  | `config/index.js` → remover re-exports de sdk/ (boundary fix)          |   3   |   ✅    |
| F97  | Testes: ESLint passa, zero imports diretos, types resolve              |   5   |   ✅    |

**Tests**: 15 reais | **Commit**: `refactor(sdk): F20 — ESLint enforcement + types consolidation`

---

## ═══ GRUPO 5 — HARDENING + EXPERIMENTAL ═══ ✅

### Faixa 21 — Observability Integration ✅ CONCLUÍDA

**Resolve**: P12, P16

| Fase | Ação                                                           | Tests | Status |
| :--: | -------------------------------------------------------------- | :---: | :----: |
| F98  | Migrar `observability/event-collector.js` → usar sdk/events.js |   5   |   ✅    |
| F99  | Migrar `bridges/nerv-bridge.js` → usar sdk/events.js typed     |   5   |   ✅    |
| F100 | Criar `sdk/quota-monitor.js` — monitoramento periódico de quota |   5   |   ✅    |
| F101 | Adicionar `checkAuthStatus` alias no health dashboard           |   3   |   ✅    |
| F102 | Testes: events tipados → quota monitor → health                |   6   |   ✅    |

**Tests**: 24 reais | **Commit**: `feat(sdk): F21 — observability with typed events + quota monitoring`

---

### Faixa 22 — Experimental Features (gated) ✅ CONCLUÍDA

| Fase | Ação                                                              | Tests | Status |
| :--: | ----------------------------------------------------------------- | :---: | :----: |
| F103 | Criar `sdk/feature-flags.js` — config + `isExperimentalEnabled()` |   8   |   ✅    |
| F104 | Criar `sdk/experimental-rpc.js` — 6 subsistemas experimentais    |  10   |   ✅    |
| F105 | `rpc.fleet.start()`, `rpc.agent.*` gated                          |   5   |   ✅    |
| F106 | `rpc.skills.*`, `rpc.mcp.*` gated                                 |   5   |   ✅    |
| F107 | `rpc.plugins.list()`, `rpc.extensions.*` gated                    |   4   |   ✅    |

**Tests**: 30 reais | **Commit**: `feat(sdk): F22 — experimental RPC features with feature flags`

---

## Resumo de Realização (Faixas 1–22)

| Faixa | Nome                               | Tests plan | Tests real | Status |
| :---: | ---------------------------------- | :--------: | :--------: | :----: |
|   1   | Types & Constants                  |    ~22     |     24     |   ✅    |
|   2   | Tools & Permissions                |    ~34     |     30     |   ✅    |
|   3   | SystemMessage Builder              |    ~35     |     21     |   ✅    |
|   4   | Unified Config                     |    ~45     |     23     |   ✅    |
|   5   | Client Expansion                   |    ~43     |     22     |   ✅    |
|   6   | Session Expansion                  |    ~33     |     25     |   ✅    |
|   7   | RPC Core Subsystems                |    ~44     |     40     |   ✅    |
|   8   | RPC Advanced Subsystems            |    ~34     |     28     |   ✅    |
|   9   | Server RPC + Health                |    ~32     |     29     |   ✅    |
|  10   | Event System Typed                 |    ~32     |     32     |   ✅    |
|  11   | Session Lifecycle Events           |    ~20     |     35     |   ✅    |
|  12   | Provider / BYOK                    |    ~24     |     24     |   ✅    |
|  13   | Telemetry & Tracing                |    ~16     |     29     |   ✅    |
|  14   | Models Expansion                   |    ~27     |     34     |   ✅    |
|  15   | Agents Runtime Management          |    ~19     |     33     |   ✅    |
|  16   | Barrel Export Rewrite              |    ~20     |     30     |   ✅    |
|  17   | Integration Tests (New Features)   |    ~23     |     23     |   ✅    |
|  18   | Migrate Tools & Bridges            |    ~12     |     51     |   ✅    |
|  19   | Migrate Config/Hooks/Agent/API     |    ~39     |     16     |   ✅    |
|  20   | ESLint Enforcement + Types Cleanup |    ~19     |     15     |   ✅    |
|  21   | Observability Integration          |    ~23     |     24     |   ✅    |
|  22   | Experimental Features (gated)      |    ~38     |     30     |   ✅    |
|       | **TOTAIS F1–F22**                  |  **~574**  |  **618**   |   ✅    |

> **618/618 testes | 25 specs | 32 módulos em sdk/ | 0 imports diretos fora de sdk/**

---

## ═══ NOVA AUDITORIA — SITUAÇÃO PÓS-F22 ═══

### Estado atual do sdk/ (rev.5)

```
src/copilot/sdk/              LINHAS
├── index.js                   344  — barrel completo, 32 módulos
├── client.js                  417  — 15 métodos wrapper
├── session.js                 300  — 12 métodos wrapper
├── rpc.js                     484  — createSessionRpc() 17 subsistemas
├── server-rpc.js              181  — createServerRpc() 4 métodos
├── events.js                  260  — onSessionEvent(), SESSION_EVENTS
├── event-helpers.js           ~80  — helpers por categoria
├── types.js                   545  — 90+ tipos re-exportados com JSDoc
├── constants.js               233  — session modes, efforts, etc.
├── config.js                  ~90  — buildSessionConfig() unificado
├── system-message.js          192  — 3 modos, sectionOverride
├── tools.js                   ~80  — createTool(), defineTool re-export
├── tools-registry.js          259  — registry de tools por sessão
├── tools-state.js             ~80  — estado de tools
├── custom-tools.js            327  — tool categories
├── permissions.js             ~60  — approveAll re-export + factory
├── models/
│   ├── helpers.js             354  — capabilities helpers
│   ├── registry.js            215  — cache + lookup
│   └── selector.js            216  — selectBestModel
├── agents.js                  267  — listAgents, selectAgent, etc.
├── agent-contract.js          ~50  — contrato de agente
├── bridge-contract.js         ~50  — contrato de bridge
├── channel-contract.js        ~50  — contrato de canal
├── health.js                  208  — ping, auth, quota, fullHealthCheck
├── quota-monitor.js           ~100 — monitoramento periódico
├── provider.js                176  — openai/azure/anthropic builders
├── telemetry.js               ~80  — getTraceContext, createTelemetryConfig
├── session-lifecycle.js       ~80  — LIFECYCLE_EVENTS, onLifecycleEvent
├── client-events.js           248  — client lifecycle event facade
├── client-facade.js           ~80  — facade de alto nível do client
├── feature-flags.js           ~120 — isExperimentalEnabled, etc.
├── experimental-rpc.js        368  — 17 funções gated
├── http-request.js            ~70  — utilitário HTTP seguro
└── url-validator.js           ~60  — validação de URL

TOTAL: ~7.744 linhas (previsão PARTE-17B: ~5.500-6.000 — superado)
```

### Gaps Ainda Abertos (Análise Pós-F22)

#### Crítico — Ainda Abertos

| ID  | Problema                                   | Status     | Pendência                                            |
| --- | ------------------------------------------ | ---------- | ---------------------------------------------------- |
| P1  | Dois caminhos de config de sessão          | ⚠️ PARCIAL | `api/routes/sessions.js` ainda inline parcialmente   |
| P2  | Dois registros de sessão paralelos         | ⚠️ PARCIAL | Map em client.js + stateless session.js divergem     |

#### Médio — Ainda Abertos

| ID  | Problema                                  | Status       | Pendência                                              |
| --- | ----------------------------------------- | ------------ | ------------------------------------------------------ |
| P8  | API routes usam features SDK não-wrapped  | ⚠️ PARCIAL   | `sessions.js` acessa client internamente               |
| P4  | Tipos paralelos em hooks/types.js         | ⚠️ PARCIAL   | Alinhamento parcial — divergências sutis permanecem    |
| P13 | SystemMessage customize não usado na API  | MÓDULO OK    | `sdk/system-message.js` pronto, consumers não migraram |

#### Baixo — Módulos prontos, não integrados

| ID  | Problema                        | Status       | Pendência                                    |
| --- | ------------------------------- | ------------ | -------------------------------------------- |
| P14 | Health check não no boot        | MÓDULO OK    | `sdk/health.js` pronto, boot não usa         |
| P15 | Auth status não no boot         | MÓDULO OK    | `checkAuthStatus` pronto, boot não usa       |
| P16 | Quota não monitorada em produção | MÓDULO OK   | `quota-monitor.js` pronto, observability pendente |

### Novos Problemas Identificados (N1–N8)

| ID  | Sev.   | Problema                                                                           |
| --- | :----: | ----------------------------------------------------------------------------------- |
| N1  | MÉDIO  | `sdk/index.js` — F22 exports foram appendados via `cat >>` (formato inconsistente) |
| N2  | MÉDIO  | `agent/lifecycle/initializer.js` ainda usa `new CopilotClient()` diretamente       |
| N3  | MÉDIO  | `quota-monitor.js` criado mas não integrado ao `observability/`                     |
| N4  | MÉDIO  | `sdk/health.js` expõe `getAuthStatus` mas não há verificação no boot               |
| N5  | MÉDIO  | Boot do agent não valida autenticação antes de criar sessões                        |
| N6  | BAIXO  | `sdk/experimental-rpc.js` duplica lógica de agent subsystem já em `sdk/rpc.js`    |
| N7  | BAIXO  | Faixas 18-19 zero-bypass mas sem regressão CI automated                             |
| N8  | BAIXO  | `tools-registry.js` marcado DEPREC mas ainda tem 259 linhas ativos                 |

---

## ═══ GRUPO 6 — INTEGRAÇÃO PROFUNDA (FASE 2) ═══ 🆕

### Faixa 23 — Index Barrel Consolidation 🟡

**Resolve**: N1 (index.js inconsistente), N6 (duplicação agent/rpc)

| Fase  | Ação                                                                        | Tests | Dep. |
| :---: | --------------------------------------------------------------------------- | :---: | :--: |
| F108  | Rewrite `sdk/index.js` — formato único, sem `cat >>` artifacts              |   5   |  —   |
| F109  | Eliminar duplicação agent subsystem entre `rpc.js` e `experimental-rpc.js` |   5   |  —   |
| F110  | Verificar ordenação lógica dos exports no barrel                             |   3   |  —   |
| F111  | Testes: todos os exports acessíveis, sem duplicatas                         |   8   |  —   |
| F112  | Validar que importar subconjunto não carrega tudo (tree-shaking)             |   4   |  —   |

**Tests**: ~25 | **Commit**: `refactor(sdk): F23 — barrel consolidation + dedup experimental-rpc`

---

### Faixa 24 — Boot Auth & Health Integration 🔴

**Resolve**: N4, N5, P15 final, P14 final

| Fase  | Ação                                                                         | Tests | Dep.  |
| :---: | ---------------------------------------------------------------------------- | :---: | :---: |
| F113  | `agent/lifecycle/initializer.js` → chamar `getAuthStatus()` no boot          |   5   | F22   |
| F114  | Adicionar fallback e mensagem clara se não autenticado                        |   4   | F113  |
| F115  | `agent/infra/session-keepalive.js` → chamar `ping()` periodicamente          |   4   | F9    |
| F116  | Testes: boot auth ok, boot auth falha, keepalive ping                        |   8   | F113  |
| F117  | Integração: health check dashboard na API                                     |   5   | F9    |

**Tests**: ~26 | **Commit**: `feat(agent): F24 — boot auth check + health monitoring integration`

---

### Faixa 25 — Quota Monitor Integration 🟡

**Resolve**: N3, P16 final

| Fase  | Ação                                                                         | Tests | Dep.  |
| :---: | ---------------------------------------------------------------------------- | :---: | :---: |
| F118  | Integrar `quota-monitor.js` no `observability/` — iniciar no boot            |   5   | F21   |
| F119  | Expor quota warnings no dashboard / SSE stream                               |   4   | F118  |
| F120  | Persistir histórico de quota no SQLite (`db/`)                               |   4   | F118  |
| F121  | Testes: quota polling, warnings, persistência                                |   8   | F118  |
| F122  | Métricas OTel para quota (via telemetry.js)                                  |   4   | F13   |

**Tests**: ~25 | **Commit**: `feat(observability): F25 — quota monitor integration`

---

### Faixa 26 — Session Registry Unification 🔴

**Resolve**: P2 final, N2 (CopilotClient direto no agent)

| Fase  | Ação                                                                               | Tests | Dep.  |
| :---: | ---------------------------------------------------------------------------------- | :---: | :---: |
| F123  | `sdk/client.js` — Map interno como Single Source of Truth para sessões             |   6   | F5    |
| F124  | `sdk/session.js` — criar/resumir sessão atualiza Map no client.js                  |   5   | F123  |
| F125  | `agent/lifecycle/initializer.js` → usar `getClient()` em vez `new CopilotClient()` |   5   | F123  |
| F126  | Testes: registry unificado, acesso consistente, sem leaks                          |   8   | F124  |
| F127  | Regressão: todos os 618+ testes passam                                             |   —   | F125  |

**Tests**: ~24 | **Commit**: `refactor(sdk): F26 — session registry unification`

---

### Faixa 27 — Config Path Unification 🔴

**Resolve**: P1 final

| Fase  | Ação                                                                              | Tests | Dep.  |
| :---: | --------------------------------------------------------------------------------- | :---: | :---: |
| F128  | Auditar `api/routes/sessions.js` — identificar campos não migrados                |   2   | F19   |
| F129  | Migrar inline config da API → `sdk/config.js` buildSessionConfig()                |   5   | F128  |
| F130  | Migrar `conversation-hub/` — qualquer config building inline                      |   3   | F128  |
| F131  | Remover `config/session-config.js` deprecated wrapper (limpeza final)             |   2   | F130  |
| F132  | Testes: API + hub criam sessão com config completa via sdk/config.js              |   8   | F130  |

**Tests**: ~20 | **Commit**: `refactor(sdk): F27 — config path unification final`

---

### Faixa 28 — Hooks Types Alignment 🟡

**Resolve**: P4 final

| Fase  | Ação                                                                         | Tests | Dep.  |
| :---: | ---------------------------------------------------------------------------- | :---: | :---: |
| F133  | Auditar `hooks/types.js` — listar todos os campos que divergem do SDK         |   2   | F20   |
| F134  | Alinhar tipos via `extends` pattern (`& { extra?: ... }`)                    |   5   | F133  |
| F135  | Validar que hooks existentes compilam com tipos alinhados                    |   3   | F134  |
| F136  | Deprecar campos locais sem equivalente SDK (doc + aviso)                     |   2   | F134  |
| F137  | Testes: tipos hook resolvem, campos extras documentados                      |   8   | F135  |

**Tests**: ~20 | **Commit**: `refactor(hooks): F28 — align hooks types with SDK`

---

## ═══ GRUPO 7 — RPC INTEGRATION ═══ 🆕

### Faixa 29 — Mode & Plan Runtime 🟡

**Resolve**: rpc.mode e rpc.plan expostos via agent + API (módulos prontos em rpc.js)

| Fase  | Ação                                                                          | Tests | Dep.  |
| :---: | ----------------------------------------------------------------------------- | :---: | :---: |
| F138  | `agent/` — expor `rpc.mode.get/set()` via message handlers                    |   5   | F7    |
| F139  | `agent/` — expor `rpc.plan.read/update/delete()` via tools                    |   6   | F7    |
| F140  | `api/routes/` — endpoint `POST /sessions/:id/mode` e `POST /sessions/:id/plan` |  5   | F7    |
| F141  | Testes: mode switching, plan management via API e agent                       |   8   | F140  |

**Tests**: ~24 | **Commit**: `feat(agent): F29 — mode and plan runtime control`

---

### Faixa 30 — UI Elicitation & Shell RPC 🟡

**Resolve**: rpc.ui + rpc.shell integrados (módulos prontos em rpc.js)

| Fase  | Ação                                                                           | Tests | Dep.  |
| :---: | ------------------------------------------------------------------------------ | :---: | :---: |
| F142  | Adicionar `rpc.ui.elicitation()` como tool no agent (structured input forms)   |   5   | F8    |
| F143  | Integrar `rpc.shell.exec()` no agent com validação de segurança                |   5   | F8    |
| F144  | `rpc.shell.kill()` — cancelar processos em execução                           |   3   | F143  |
| F145  | Testes: elicitation form, shell exec, shell kill, security checks              |   8   | F142  |

**Tests**: ~21 | **Commit**: `feat(agent): F30 — UI elicitation + shell RPC integration`

---

### Faixa 31 — Compaction & Workspace RPC 🟢

**Resolve**: compaction manual + workspace files via RPC

| Fase  | Ação                                                                          | Tests | Dep.  |
| :---: | ----------------------------------------------------------------------------- | :---: | :---: |
| F146  | Integrar `rpc.compaction.compact()` no agent (trigger manual e automático)    |   5   | F8    |
| F147  | Expor `rpc.workspace.listFiles/readFile/createFile()` via tools do agent      |   6   | F7    |
| F148  | Testes: compaction trigger, workspace read/write                              |   8   | F146  |

**Tests**: ~19 | **Commit**: `feat(agent): F31 — compaction + workspace RPC integration`

---

## ═══ GRUPO 8 — HARDENING FINAL ═══ 🆕

### Faixa 32 — Tools Registry Deprecation 🟢

**Resolve**: N8 (tools-registry.js ainda ativo)

| Fase  | Ação                                                                          | Tests | Dep. |
| :---: | ----------------------------------------------------------------------------- | :---: | :--: |
| F149  | Auditar consumidores de `tools-registry.js`                                   |   2   |  —   |
| F150  | Migrar consumidores para `sdk/tools.js` e `sdk/index.js`                     |   4   | F149 |
| F151  | Reduzir `tools-registry.js` a re-export puro de `tools.js`                   |   3   | F150 |
| F152  | Testes: registry deprecado não quebra consumers existentes                    |   5   | F151 |

**Tests**: ~14 | **Commit**: `refact(sdk): F32 — tools-registry deprecation`

---

### Faixa 33 — CI Regression Gates 🟡

**Resolve**: N7 (zero-bypass sem regressão CI automatizada)

| Fase  | Ação                                                                               | Tests | Dep.  |
| :---: | ---------------------------------------------------------------------------------- | :---: | :---: |
| F153  | Adicionar test que conta imports diretos `@github/copilot-sdk` fora de `sdk/`     |   3   | F20   |
| F154  | Adicionar test que verifica barrel exporta todos os símbolos esperados             |   5   | F16   |
| F155  | Adicionar smoke test para boot do agent (sem crashar com mocks)                    |   5   | F24   |
| F156  | Configurar `npm run test:regression` com gates críticas                           |   —   | F153  |

**Tests**: ~13 | **Commit**: `test(ci): F33 — regression gates zero-bypass + barrel completeness`

---

### Faixa 34 — Documentation & Release 🟢

| Fase  | Ação                                                                          | Tests | Dep. |
| :---: | ----------------------------------------------------------------------------- | :---: | :--: |
| F157  | Commit das faixas 14-22 (8 faixas, ~250 testes)                               |   —   |  —   |
| F158  | Atualizar PARTE-17A (rev.5) — estado atual pós-F22 + gaps                     |   —   |  —   |
| F159  | Atualizar PARTE-17B (rev.5) — proposta Fase 2 (F23-F31) com design detalhado  |   —   |  —   |
| F160  | Atualizar CHANGELOG.md — Faixas 1-22 + linha do tempo                        |   —   |  —   |
| F161  | Avaliar upgrade SDK `0.2.0` → `0.2.1`+                                        |   3   |  —   |

**Tests**: ~3 | **Commit**: `docs: F34 — documentation update + SDK upgrade evaluation`

---

## Roadmap Completo (F1–F34)

| Faixa | Nome                                  | Sev.   | Resolve      |   Fases    |  Tests  | Status   |
| :---: | ------------------------------------- | :----: | ------------ | :--------: | :-----: | :------: |
|   1   | Types & Constants                     |   🟡   | P10, P4      |   F1–F5    |    24   | ✅ DONE  |
|   2   | Tools & Permissions                   |   🟡   | P5, P6       |   F6–F10   |    30   | ✅ DONE  |
|   3   | SystemMessage Builder                 |   🟡   | P9, P13      |   F11–F16  |    21   | ✅ DONE  |
|   4   | Unified Config                        |   🔴   | P1           |   F17–F21  |    23   | ✅ DONE  |
|   5   | Client Expansion                      |   🔴   | P2,P7,P14,P15|   F22–F27  |    22   | ✅ DONE  |
|   6   | Session Expansion                     |   🔴   | P17          |   F28–F32  |    25   | ✅ DONE  |
|   7   | RPC Core Subsystems                   |   🔴   | P11 (1/2)    |   F33–F37  |    40   | ✅ DONE  |
|   8   | RPC Advanced Subsystems               |   🟡   | P11 (2/2)    |   F38–F43  |    28   | ✅ DONE  |
|   9   | Server RPC + Health                   |   🟡   | P16, P14     |   F44–F48  |    29   | ✅ DONE  |
|  10   | Event System Typed                    |   🔴   | P12          |   F49–F53  |    32   | ✅ DONE  |
|  11   | Session Lifecycle Events              |   🟡   | —            |   F54–F57  |    35   | ✅ DONE  |
|  12   | Provider / BYOK                       |   🟡   | —            |   F58–F61  |    24   | ✅ DONE  |
|  13   | Telemetry & Tracing                   |   🟢   | —            |   F62–F65  |    29   | ✅ DONE  |
|  14   | Models Expansion                      |   🟡   | —            |   F66–F69  |    34   | ✅ DONE  |
|  15   | Agents Runtime Management             |   🟡   | —            |   F70–F73  |    33   | ✅ DONE  |
|  16   | Barrel Export Rewrite                 |   🟡   | —            |   F74–F77  |    30   | ✅ DONE  |
|  17   | Integration Tests (New Features)      |   🟡   | —            |   F78–F81  |    23   | ✅ DONE  |
|  18   | Migrate Tools & Bridges               |   🟡   | P5, P8       |   F82–F85  |    51   | ✅ DONE  |
|  19   | Migrate Config/Hooks/Agent/API        |   🔴   | P1,P6,P7     |   F86–F91  |    16   | ✅ DONE  |
|  20   | ESLint Enforcement + Types Cleanup    |   🟡   | P3, P4       |   F92–F97  |    15   | ✅ DONE  |
|  21   | Observability Integration             |   🟡   | P12, P16     |   F98–F102 |    24   | ✅ DONE  |
|  22   | Experimental Features (gated)         |   🟢   | —            | F103–F107  |    30   | ✅ DONE  |
|  23   | Index Barrel Consolidation            |   🟡   | N1, N6       | F108–F112  |   ~25   | 🔜 NEXT  |
|  24   | Boot Auth & Health Integration        |   🔴   | N4, N5, P15  | F113–F117  |   ~26   | 🔜       |
|  25   | Quota Monitor Integration             |   🟡   | N3, P16      | F118–F122  |   ~25   | 🔜       |
|  26   | Session Registry Unification          |   🔴   | P2, N2       | F123–F127  |   ~24   | 🔜       |
|  27   | Config Path Unification               |   🔴   | P1 final     | F128–F132  |   ~20   | 🔜       |
|  28   | Hooks Types Alignment                 |   🟡   | P4 final     | F133–F137  |   ~20   | 🔜       |
|  29   | Mode & Plan Runtime                   |   🟡   | P11 integr.  | F138–F141  |   ~24   | 🔜       |
|  30   | UI Elicitation & Shell RPC            |   🟡   | —            | F142–F145  |   ~21   | 🔜       |
|  31   | Compaction & Workspace RPC            |   🟢   | —            | F146–F148  |   ~19   | 🔜       |
|  32   | Tools Registry Deprecation            |   🟢   | N8           | F149–F152  |   ~14   | 🔜       |
|  33   | CI Regression Gates                   |   🟡   | N7           | F153–F156  |   ~13   | 🔜       |
|  34   | Documentation & Release               |   🟢   | —            | F157–F161  |    ~3   | 🔜       |
|       | **TOTAIS F1–F34**                     |        |              | **~161**   | **~818**|          |

---

## Ordem de Execução Fase 2 (F23–F34)

**Prioridade crítica (executar primeiro)**:
```
F23 (barrel) → F24 (boot auth) → F26 (session registry) → F27 (config unification)
```

**Sequência completa recomendada**:
```
F23 → F24 → F25 → F26 → F27 → F28 → F29 → F30 → F31 → F32 → F33 → F34
```

---

## Quality Gates por Faixa

1. `npm run lint` — zero erros
2. `npm run format:check` — zero diff
3. `npm run test:unit` — todos passam (618+ baseline)
4. `npm run typecheck:node` — zero erros novos
5. `grep -r "from '@github/copilot-sdk'" src/copilot/ --include="*.js" | grep -v sdk/` = 0
6. Code review dos novos módulos sdk/

---

## Histórico de Bypass

| Estado          | Imports diretos `@github/copilot-sdk` fora de sdk/ |
| :-------------- | :--------------------------------------------------: |
| Baseline        |                          20                          |
| Pós-F18         |                          8                           |
| Pós-F19         |                          0                           |
| Pós-F20         |                          0 (ESLint block)             |
| **Atual (F22)** |               **0 — ZERO-BYPASS** ✅                 |

---

*Documento atualizado em 2026-03-21, rev.5. Base: conclusão das 22 faixas (618 testes, 25 specs)
+ nova auditoria pós-F22 + planejamento das Faixas 23–34.
Revisões anteriores: `.rev2.md`, `.rev3.md`, `.rev4.md`*
