# PARTE-17C — Roadmap SDK Hardening Total

**Data**: 2026-03-20 (rev.2 — integração completa) **Escopo**: Implementação completa do SDK layer +
integração agent/observability/bridges — 10 faixas, 58 fases **Baseado em**: PARTE-17A rev.2
(situação atual) + PARTE-17B rev.2 (situação ideal) **Autor**: Auditoria automatizada PARTE-17

---

## Estrutura do Roadmap

| Faixa     | Nome                                | Fases        | Testes Estimados |
| --------- | ----------------------------------- | ------------ | ---------------- |
| **1**     | Bug Fixes & Debt Elimination        | F001–F006    | ~30              |
| **2**     | SDK Upgrade & Type Alignment        | F007–F012    | ~25              |
| **3**     | Provider/BYOK Support               | F013–F018    | ~20              |
| **4**     | Session Completeness                | F019–F026    | ~30              |
| **5**     | Commands & Elicitation              | F027–F032    | ~25              |
| **6**     | Client Completeness & Observability | F033–F038    | ~20              |
| **7**     | Validation Suite & Report Final     | F039–F042    | ~20              |
| **8**     | Agent ↔ SDK Config Centralization   | F043–F048    | ~22              |
| **9**     | Observability ↔ SDK Integration     | F049–F053    | ~11              |
| **10**    | Bridges ↔ SDK Completeness          | F054–F058    | ~10              |
| **Total** |                                     | **58 fases** | **~213 testes**  |

---

## ══════ FAIXA 1 — Bug Fixes & Debt Elimination ══════

### F001 — Fix BUG-SDK-01: forceStopClient orphan sessions

- **Arquivo**: `sdk/client.js`
- **Ação**: Em `forceStopClient()`, chamar `_sessions.clear()` antes de `client.forceStop()`
- **Teste**: Verificar que `_sessions.size === 0` após forceStop
- **Testes novos**: 3

### F002 — Fix BUG-SDK-02: Eliminar side-effect loadCustomTools

- **Arquivo**: `sdk/custom-tools.js`
- **Ação**: Remover chamada `loadCustomTools()` no final do módulo. Exportar `initCustomTools()`
  async para bootstrap
- **Teste**: Importar módulo sem side-effect, verificar registry vazio até init explícito
- **Testes novos**: 4

### F003 — Fix BUG-SDK-03 + BUG-SDK-04: Async persistence unification

- **Arquivos**: `sdk/tools-state.js`, `sdk/custom-tools.js`
- **Ação**:
  - `patchToolsConfig()` → chamar `_persistToolsConfigAsync()`
  - `registerCustomTool()` → retornar Promise, chamar `_persistCustomToolsAsync()`
  - Deprecar funções sync com `@deprecated` JSDoc
- **Testes novos**: 6

### F004 — DEBT-05: Session Map com bounds/eviction

- **Arquivo**: `sdk/client.js`
- **Ação**: Adicionar TTL (4h default) ao `_sessions` Map com sweep periódico (10min)
- **Config**: `SDK_SESSION_MAX_AGE_MS` env var
- **Testes novos**: 5

### F005 — DEBT-03: Corrigir @module paths

- **Arquivos**: Todos os SDK files (~14 com `@module`)
- **Ação**: Corrigir path em cada `@module` para refletir localização real
- **Testes novos**: 0 (lint/formatting)

### F006 — DEBT-04: Guard test helpers

- **Arquivos**: `sdk/client.js`, `sdk/custom-tools.js`, `sdk/tools-state.js`
- **Ação**: Marcar `_resetClientState`, `_resetRegistry`, `_resetToolsConfig` como `@internal`
- **Testes novos**: 2

---

## ══════ FAIXA 2 — SDK Upgrade & Type Alignment ══════

### F007 — Upgrade @github/copilot-sdk 0.2.0 → 0.2.1

- **Ação**: `npm install @github/copilot-sdk@0.2.1`
- **Verificação**: Run test suite completo, confirmar zero regressões
- **Testes novos**: 2 (smoke)

### F008 — Alinhar tipos SessionConfig com SDK 0.2.1

- **Arquivo**: `sdk/session.js`
- **Ação**: Atualizar `SessionCreateOptions` e `SessionResumeOptions` JSDoc para incluir todos os
  campos do SDK: `sessionId`, `clientName`, `configDir`, `agent`, `skillDirectories`,
  `disabledSkills`, `availableTools`, `excludedTools`, `onEvent`, `onElicitationRequest`, `commands`
- **Testes novos**: 5

### F009 — Alinhar tipos CopilotClientOptions com SDK 0.2.1

- **Arquivo**: `sdk/client.js`
- **Ação**: Refatorar `buildClientOptions()` para aceitar e passar todos os campos: `cliArgs`,
  `cwd`, `port`, `useStdio`, `isChildProcess`, `logLevel`, `env`, `githubToken`, `useLoggedInUser`,
  `onListModels`, `onGetTraceContext`, `telemetry`
- **Testes novos**: 5

### F010 — Alinhar tipos ToolEntry com SDK

- **Arquivo**: `sdk/tools-registry.js`
- **Ação**: Mudar `ToolEntry.tool` de `unknown` para `import('@github/copilot-sdk').Tool`
- **Testes novos**: 2

### F011 — Alinhar tipos SessionLifecycleHandler

- **Arquivo**: `sdk/client.js`
- **Ação**: Integrar `SessionLifecycleHandler` do SDK (importar, não recriar)
- **Testes novos**: 2

### F012 — Import-only typedefs refactor

- **Arquivos**: Todos os SDK files com tipos duplicados
- **Ação**: Substituir typedefs locais por `@typedef {import('@github/copilot-sdk').X}` onde X
  existe no SDK
- **Testes novos**: 0 (typecheck)

---

## ══════ FAIXA 3 — Provider/BYOK Support ══════

### F013 — Criar sdk/provider.js (módulo novo)

- **Ação**: Criar arquivo com:
  - `buildProviderConfig(type, baseUrl, opts)` → `ProviderConfig`
  - `buildOllamaProvider(model, port)` → ProviderConfig preset
  - `buildAzureProvider(baseUrl, apiKey, deployment)` → ProviderConfig preset
  - `buildAnthropicProvider(baseUrl, apiKey)` → ProviderConfig preset
  - `buildOpenAICompatProvider(baseUrl, apiKey)` → ProviderConfig preset
  - Validação com url-validator.js (anti-SSRF)
- **JSDoc**: Tipos completos para cada preset
- **Testes novos**: 8

### F014 — Integrar provider em buildSessionConfig

- **Arquivo**: `sdk/session.js`
- **Ação**: Adicionar campo `provider` em `buildSessionConfig()`, validar tipo antes de passar ao
  SDK
- **Testes novos**: 4

### F015 — Expor provider via API

- **Arquivo**: `api/express/session-crud.js`
- **Ação**: Aceitar `provider` no body de `POST /sessions` e `POST /sessions/resume`
- **Testes novos**: 3

### F016 — Provider presets e configuração global

- **Ação**: Permitir definir provider default via `config.json` → `copilot.defaultProvider`
- **Testes novos**: 3

### F017 — Documentar uso de BYOK providers

- **Ação**: README ou doc em `DOCUMENTAÇÃO/COPILOT/SDK-BYOK-PROVIDERS.md`
- **Testes novos**: 0

### F018 — Testes de integração provider

- **Ação**: Testes que criam sessão com provider mock, verificam passthrough
- **Testes novos**: 4

---

## ══════ FAIXA 4 — Session Completeness ══════

### F019 — session.log() wrapper

- **Arquivo**: `sdk/session.js`
- **Ação**: Adicionar `logToSession(sessionId, message, {level, ephemeral})`
- **Testes novos**: 4

### F020 — session.log() API route

- **Arquivo**: `api/express/session-messaging.js`
- **Ação**: `POST /sessions/:id/log` com body `{ message, level?, ephemeral? }`
- **Testes novos**: 3

### F021 — availableTools / excludedTools em buildSessionConfig

- **Arquivo**: `sdk/session.js`
- **Ação**: Passar `availableTools` e `excludedTools` nativos do SDK no config
- **Testes novos**: 4

### F022 — Unificar tools-state com filtros nativos

- **Arquivos**: `sdk/tools-state.js`, `sdk/session.js`
- **Ação**: tools-state como orchestrator — converte allowlist → `availableTools`, denylist →
  `excludedTools`
- **Testes novos**: 4

### F023 — SessionConfig full passthrough

- **Arquivo**: `sdk/session.js`
- **Ação**: buildSessionConfig aceitar e propagar: `sessionId`, `clientName`, `configDir`, `agent`,
  `skillDirectories`, `disabledSkills`, `onEvent`
- **Testes novos**: 6

### F024 — session.capabilities & workspacePath

- **Arquivo**: `sdk/session.js`
- **Ação**: Expor `getSessionCapabilities(sessionId)` e `getSessionWorkspacePath(sessionId)`
- **Testes novos**: 3

### F025 — Session capabilities via API

- **Arquivo**: `api/express/session-crud.js`
- **Ação**: Incluir `capabilities` e `workspacePath` na resposta de `GET /sessions/:id`
- **Testes novos**: 2

### F026 — getLastSessionId wrapper + route

- **Arquivo**: `sdk/client.js`, `api/express/sessions.js`
- **Ação**: Wrapper `getLastSessionId()` + API `GET /sessions/last-id`
- **Testes novos**: 3

---

## ══════ FAIXA 5 — Commands & Elicitation ══════

### F027 — Criar sdk/commands.js (módulo novo)

- **Ação**: Criar arquivo com:
  - `defineCommand(name, description, handler)` → `CommandDefinition`
  - `buildCommandList(...cmds)` → array
  - Validação de nome (slug-like)
- **JSDoc**: Tipos completos
- **Testes novos**: 5

### F028 — Integrar commands em buildSessionConfig

- **Arquivo**: `sdk/session.js`
- **Ação**: Aceitar campo `commands` em buildSessionConfig, validar e propagar
- **Testes novos**: 3

### F029 — Commands via API

- **Arquivo**: `api/express/session-crud.js`
- **Ação**: Aceitar `commands` no body de POST /sessions
- **Testes novos**: 2

### F030 — Criar sdk/elicitation.js (módulo novo)

- **Ação**: Criar arquivo com:
  - `buildElicitationHandler(callback)` → handler function
  - `ElicitationContext` / `ElicitationResult` typedefs
  - Default handler: log + auto-approve
- **JSDoc**: Tipos completos
- **Testes novos**: 5

### F031 — Integrar elicitation em SessionConfig

- **Arquivo**: `sdk/session.js`
- **Ação**: Aceitar `onElicitationRequest` em buildSessionConfig
- **Testes novos**: 3

### F032 — UI Elicitation API routes

- **Ação**: Se `session.ui` disponível (0.2.1):
  - `POST /sessions/:id/ui/confirm`, `/ui/select`, `/ui/input`
- **Testes novos**: 6

---

## ══════ FAIXA 6 — Client Completeness & Observability ══════

### F033 — Client lifecycle events wrapper

- **Arquivo**: `sdk/client.js`
- **Ação**: Adicionar `onClientEvent(eventType, handler)` e `onAnyClientEvent(handler)`
- **Emitir via hooks bus**: `client.event.{type}`
- **Testes novos**: 5

### F034 — Client events via SSE

- **Arquivo**: `api/express/client.js`
- **Ação**: `GET /client/events` (SSE stream) com lifecycle events
- **Testes novos**: 3

### F035 — CopilotClientOptions full passthrough

- **Arquivo**: `sdk/client.js`
- **Ação**: `getClient(overrides)` aceitar TODOS os CopilotClientOptions
- **Testes novos**: 5

### F036 — known-models atualização

- **Arquivo**: `sdk/models/known-models.js`
- **Ação**: Adicionar novos modelos: gpt-5, claude-opus-4, gemini-2.5-flash, o4
- **Testes novos**: 3

### F037 — overridesBuiltInTool flag

- **Ação**: `buildTool()` aceitar `overridesBuiltInTool` flag
- **Testes novos**: 2

### F038 — Symbol.asyncDispose support

- **Arquivo**: `sdk/session.js`
- **Ação**: Implementar `Symbol.asyncDispose` no session wrapper para uso com `await using`
- **Testes novos**: 2

---

## ══════ FAIXA 7 — Validation Suite & Report Final ══════

### F039 — Teste de paridade de superfície (SDK exports vs. nosso barrel)

- **Ação**: Criar `tests/unit/copilot/sdk/surface-parity.spec.js`
  - Importar exports do SDK, verificar wrapper para cada um
  - Verificar que `SessionConfig` fields estão todos em `buildSessionConfig`
- **Testes novos**: 8

### F040 — Teste de completude de API routes

- **Ação**: Criar `tests/unit/copilot/api/route-completeness.spec.js`
  - Para cada método público de CopilotClient → verificar route
  - Para cada método público de CopilotSession → verificar route
- **Testes novos**: 6

### F041 — Run full test suite + lint + typecheck

- **Ação**: Executar
  `npm run lint && npm run format:check && npm run test:unit && npm run typecheck:node`
- **Validação**: Zero regressões

### F042 — PARTE-17D: Relatório Final Comparativo

- **Ação**: Gerar documento comparando PARTE-17A (antes) vs. estado final
- **Métricas**: features coverage, bugs fixed, testes adicionados, tipos alinhados

---

## Sequência Recomendada de Execução

```
Faixa 1 (Bug fixes)          → fundação limpa
  ↓
Faixa 2 (SDK upgrade)        → tipos alinhados com 0.2.1
  ↓
Faixa 3 (Provider/BYOK)      → feature crítica desbloqueada
  ↓
Faixa 4 (Session full)       → completude session layer
  ↓
Faixa 5 (Commands/UI)        → features 0.2.1 ativas
  ↓
Faixa 6 (Client full)        → completude client layer
  ↓
Faixa 8 (Agent integration)  → centralizar config + eliminar bypass
  ↓
Faixa 9 (Observ. integration)→ event catalog + OTEL + metrics
  ↓
Faixa 10 (Bridges integration)→ NERV parity + MCP full config
  ↓
Faixa 7 (Validation suite)   → garantia final de paridade
```

---

## ══════ FAIXA 8 — Agent ↔ SDK Config Centralization ══════

### F043 — Estender buildSessionConfig() para campos completos

- **Arquivo**: `sdk/session.js`
- **Ação**: Adicionar suporte a `availableTools`, `excludedTools`, `skillDirectories`,
  `customAgents`, `infiniteSessions`, `workingDirectory`, `onPermissionRequest`,
  `onUserInputRequest`
- **Referência**: PARTE-17A §7.2 (features bypass), ARCH-INT-01
- **Testes**: 4 — cada campo passado e validado no output

### F044 — Unificar tools filtering via tools-state.js

- **Arquivo**: `sdk/session.js`, `sdk/tools-state.js`
- **Ação**: `buildSessionConfig()` consulta `getCurrentToolsState()` internamente; merge com
  allowlist/denylist explícitos caso fornecidos
- **Referência**: ARCH-INT-02
- **Testes**: 4 — default tools-state, override explícito, merge, empty state

### F045 — Refatorar initializer.js para usar buildSessionConfig()

- **Arquivo**: `agent/session/initializer.js`
- **Ação**: Substituir construção manual de config por `buildSessionConfig({...overrides})`.
  Verificar paridade total com comportamento anterior
- **Referência**: ARCH-INT-01
- **Testes**: 3 — output idêntico, sem regressão em session creation

### F046 — Centralizar re-exports de tipos SDK

- **Arquivo**: `sdk/index.js`
- **Ação**: Adicionar `@typedef` re-exports para: `Tool`, `ToolHandler`, `ToolInvocation`,
  `PermissionHandler`, `PermissionRequest`, `UserInputRequest`, `MessageOptions`, `SessionConfig`,
  `SystemMessageConfig`, `InfiniteSessionConfig`, `MCPServerConfig`, `CustomAgentConfig`,
  `SessionHooks`
- **Referência**: ARCH-INT-03
- **Testes**: 2 — typecheck + import sanity

### F047 — Migrar imports diretos para #copilot/sdk

- **Arquivo**: ~12 arquivos que importam diretamente de `@github/copilot-sdk`
- **Ação**: Substituir imports por `#copilot/sdk`. Exceção: `sdk/` internos que naturalmente
  importam do pacote
- **Referência**: ARCH-INT-03
- **Testes**: 3 — import resolution + typecheck + zero runtime regression

### F048 — Teste de integração agent-SDK roundtrip

- **Arquivo**: novo `tests/unit/copilot/sdk/agent-sdk-integration.spec.mjs`
- **Ação**: Teste end-to-end que verifica: `buildSessionConfig(agentOverrides)` → config contém
  todos os campos → mock de `resumeOrCreate()` recebe config completo
- **Referência**: Validação ARCH-INT-01/02/03
- **Testes**: 6 — cenários normal, customize mode, tools override, skillDirs, agents,
  infiniteSessions

---

## ══════ FAIXA 9 — Observability ↔ SDK Integration ══════

### F049 — Event Catalog Auto-Discovery test

- **Arquivo**: novo `tests/unit/copilot/observability/event-catalog-parity.spec.mjs`
- **Ação**: Importar `DEFAULT_PERSIST_TYPES` e comparar com lista canônica de events conhecidos
  (extraída dos .d.ts do SDK). Falhar se há divergência
- **Referência**: OBS-GAP-01
- **Testes**: 3 — parity check, unknown detection, missing detection

### F050 — OTEL TelemetryConfig type alignment

- **Arquivo**: `observability/otel.js`
- **Ação**: Importar `TelemetryConfig` type do SDK (via JSDoc `@type`); garantir que
  `buildTelemetryConfig()` retorna tipo compatível. Adicionar JSDoc bridge
- **Referência**: OBS-GAP-02
- **Testes**: 2 — typecheck + config shape validation

### F051 — Capabilities monitoring handler

- **Arquivo**: `observability/event-collector.js`
- **Ação**: Adicionar handler para `session.capabilities` change events (quando SDK 0.2.1 os
  emitir). Registrar em métricas e alerting
- **Referência**: OBS-GAP-03
- **Testes**: 3 — capabilities change detected, alert triggered, metric recorded

### F052 — Elicitation dedicated metrics

- **Arquivo**: `observability/metrics.js`
- **Ação**: Adicionar `recordElicitation(durationMs, type, outcome)` com histograma rolling.
  Alimentar a partir do event-collector
- **Referência**: OBS-GAP-04
- **Testes**: 2 — record + histogram calculation

### F053 — Observability integration regression suite

- **Arquivo**: novo `tests/unit/copilot/observability/sdk-integration.spec.mjs`
- **Ação**: 1 test que mocka uma session SDK com eventos de tool/token/error/elicitation e verifica
  que event-collector + metrics + tool-stats registram tudo corretamente
- **Referência**: Validação OBS-GAP-01-04
- **Testes**: 1 (integration-level)

---

## ══════ FAIXA 10 — Bridges ↔ SDK Completeness ══════

### F054 — NERV Bridge event parity test

- **Arquivo**: novo `tests/unit/copilot/bridges/nerv-bridge-parity.spec.mjs`
- **Ação**: Comparar `EVENT_MAP` keys com lista canônica de agent events. Falhar se eventos novos
  sem mapeamento
- **Referência**: BRG-GAP-01
- **Testes**: 2 — parity + unknown detection

### F055 — NERV Bridge novos event mappings SDK 0.2.1

- **Arquivo**: `bridges/nerv-bridge.js`
- **Ação**: Adicionar mapeamentos faltantes para eventos 0.2.1: `elicitation.requested`,
  `elicitation.completed`, `command.executed`, `session.capabilities_changed`, `session.ui_action`
- **Referência**: BRG-GAP-01
- **Testes**: 3 — cada novo mapping verificado

### F056 — MCP Config full passthrough

- **Arquivo**: `bridges/mcp-tool-bridge.js`
- **Ação**: Aceitar todos os campos de `MCPServerConfig` do SDK (`oauthOptions`,
  `environmentVariables`, `timeout`, `serverFilter`)
- **Referência**: BRG-GAP-02
- **Testes**: 3 — oauthOptions, envVars, serverFilter passthrough

### F057 — MCP bridge reconnect observability

- **Arquivo**: `bridges/mcp-tool-bridge.js`, `observability/event-collector.js`
- **Ação**: Emitir eventos `mcp.reconnect.started` / `mcp.reconnect.completed` /
  `mcp.reconnect.failed` capturados pelo event-collector
- **Referência**: Complementar BRG-GAP-02
- **Testes**: 1

### F058 — Bridges integration regression suite

- **Arquivo**: novo `tests/unit/copilot/bridges/sdk-integration.spec.mjs`
- **Ação**: Teste que verifica: agent EventEmitter → nerv-bridge → NERV envelope para todos os event
  types mapeados
- **Referência**: Validação BRG-GAP-01/02
- **Testes**: 1

---

## Estimativa de Impacto Final Revisado

| Dimensão                      | Valor                                                |
| ----------------------------- | ---------------------------------------------------- |
| Faixas                        | 10                                                   |
| Fases                         | 58                                                   |
| Testes novos                  | ~213                                                 |
| Arquivos novos                | ~10 (provider, commands, elicitation, 7 test suites) |
| Arquivos modificados          | ~42                                                  |
| Bugs corrigidos               | 5                                                    |
| Gaps eliminados (SDK)         | 9                                                    |
| Gaps eliminados (Integration) | 6 (4 observability + 2 bridges)                      |
| Arch problems resolvidos      | 5 (ARCH-INT-01 a 05)                                 |
| Features coverage final       | 98%+                                                 |
