# PARTE-17B — Proposta de Situação Ideal do SDK

**Data**: 2026-03-20 (rev.2 — integração completa) **Escopo**: Visão abrangente do estado-alvo para
`src/copilot/sdk/` + API derivada + Agent layer + Observability + Bridges **Baseado em**: PARTE-17A
rev.2 (análise situação atual com integração) + `@github/copilot-sdk@0.2.1` (latest) **Autor**:
Auditoria automatizada PARTE-17

---

## 1. Visão Geral: Estado-Alvo

### 1.1 Princípios

1. **Paridade total** com o SDK oficial — toda feature exposta pelo `@github/copilot-sdk` deve ter
   wrapper no nosso layer
2. **Zero configuração hardcoded** — todas as opções do SDK devem ser configuráveis via API ou
   config
3. **Tipagem completa** — JSDoc refletindo 100% dos tipos do SDK oficial
4. **Validação automática** — teste automatizado que compara nossa superfície pública com os exports
   do SDK
5. **Forward-compatible** — nova versão do SDK deve funcionar sem quebrar a implementação
6. **Async-first** — eliminar todos os FS sync restantes e side-effects na importação

### 1.2 Métricas-Alvo

| Métrica                | Atual | Alvo      |
| ---------------------- | ----- | --------- |
| Features implementadas | 56%   | **95%+**  |
| Features parciais      | 15%   | **<5%**   |
| Bugs SDK layer         | 5     | **0**     |
| Design gaps            | 14    | **0**     |
| Tipagem coverage       | ~70%  | **95%+**  |
| Testes SDK-específicos | ~200  | **400+**  |
| SDK version            | 0.2.0 | **0.2.1** |

---

## 2. Features a Implementar (por prioridade)

### 2.1 PRIORIDADE CRÍTICA — Novos Módulos

#### F-17-001: ProviderConfig (BYOK) Support

**Gap**: GAP-01 (CRÍTICO) **O que fazer**:

- Criar `sdk/provider.js` com helpers para configurar providers:
  - `buildProviderConfig(type, baseUrl, opts)` → `ProviderConfig`
  - `buildOllamaProvider(model, port?)` — preset Ollama
  - `buildAzureProvider(baseUrl, apiKey, opts)` — preset Azure
  - `buildAnthropicProvider(baseUrl, apiKey)` — preset Anthropic
  - `buildOpenAICompatProvider(baseUrl, apiKey)` — preset genérico
- Integrar `provider` em `buildSessionConfig()` (session.js)
- Expor via API route `POST /sessions` com campo `provider`
- Testes: 15+ cobrindo cada preset e validação de config

#### F-17-002: SDK Version Upgrade (0.2.0 → 0.2.1)

**Gap**: GAP-14 **O que fazer**:

- Upgrade `@github/copilot-sdk` para 0.2.1 em `package.json`
- Atualizar tipos que mudaram
- Habilitar novas features: `onElicitationRequest`, `commands`, `capabilities.ui`
- Teste de regressão pós-upgrade

### 2.2 PRIORIDADE ALTA — Features Faltantes

#### F-17-003: Client Lifecycle Events

**Gap**: GAP-02 **O que fazer**:

- Adicionar `onClientLifecycle(eventType, handler)` em `sdk/client.js`
- Wrapper para `client.on()` com typed events
- Emitir via hooks bus para observabilidade
- Expor via API: `GET /client/events` (SSE stream)
- Testes: 8+

#### F-17-004: Session Log API

**Gap**: GAP-03 **O que fazer**:

- Adicionar `logToSession(sessionId, message, opts)` em `sdk/session.js`
- Wrapper para `session.log(message, {level, ephemeral})`
- Expor via API: `POST /sessions/:id/log`
- Testes: 6+

#### F-17-005: Native Tools Filtering (availableTools/excludedTools)

**Gap**: GAP-04 **O que fazer**:

- Adicionar `availableTools` e `excludedTools` em `buildSessionConfig()`
- Integrar com `tools-state.js` (unificação)
- Documentar migração de tools-state custom → filtros nativos
- Testes: 8+

#### F-17-006: Elicitation Support

**Gap**: GAP-05 **O que fazer**:

- Criar `sdk/elicitation.js`:
  - `buildElicitationHandler(opts)` → `ElicitationHandler`
  - `ElicitationContext` typedef
  - `ElicitationResult` typedef
- Integrar `onElicitationRequest` em `buildSessionConfig()` (requer 0.2.1)
- Expor `session.capabilities` via API `GET /sessions/:id`
- Expor UI primitives: `POST /sessions/:id/ui/confirm`, `/ui/select`, `/ui/input`
- Testes: 12+

#### F-17-007: Commands (Slash Commands)

**Gap**: GAP-06, presente no 0.2.1 **O que fazer**:

- Criar `sdk/commands.js`:
  - `defineCommand(name, handler, opts)` → `CommandDefinition`
  - `buildCommandList(...commands)` → `CommandDefinition[]`
- Integrar `commands` em `buildSessionConfig()`
- Expor via API: `GET /sessions/:id/commands`, `POST /sessions/:id/commands`
- Testes: 8+

### 2.3 PRIORIDADE MÉDIA — Completude

#### F-17-008: getLastSessionId Wrapper

**Gap**: GAP-07 **O que fazer**:

- Adicionar `getLastSessionId()` em `sdk/client.js`
- Expor via API: `GET /sessions/last-id`
- Testes: 3+

#### F-17-009: SessionConfig Full Passthrough

**Gap**: GAP-08, GAP-09, GAP-10, GAP-11 **O que fazer**:

- Adicionar em `buildSessionConfig()`:
  - `sessionId` (custom ID)
  - `clientName`
  - `configDir`
  - `agent` (auto-select agent)
  - `skillDirectories`
  - `disabledSkills`
  - `onEvent` (early handler)
- Testes: 10+

#### F-17-010: CopilotClientOptions Full Passthrough

**Gap**: múltiplos **O que fazer**:

- Refatorar `buildClientOptions()` para aceitar todos os campos:
  - `cliArgs`, `cwd`, `port`, `useStdio`, `isChildProcess`
  - `logLevel`, `env`, `githubToken`, `useLoggedInUser`
  - `onListModels`, `onGetTraceContext`
  - `telemetry` completo (não apenas otlpEndpoint)
- Testes: 12+

#### F-17-011: known-models Atualização

**Bug**: BUG-SDK-05 **O que fazer**:

- Adicionar modelos: `gpt-5`, `gpt-5-mini`, `claude-opus-4`, `claude-sonnet-4.5`,
  `gemini-2.5-flash`, `o4`
- Atualizar context windows conforme dados reais
- Testes: validação de catálogo

### 2.4 PRIORIDADE BAIXA — Refinamento

#### F-17-012: Session RPC Access

**Gap**: GAP-12 **O que fazer**:

- Expor `session.rpc` methods como API routes seletivas
- Priorizar: `rpc.agent.select`, `rpc.agent.list`

#### F-17-013: Async Dispose Pattern

**Gap**: GAP-13 **O que fazer**:

- Implementar `Symbol.asyncDispose` no wrapper de session
- Documentar uso com `await using`

#### F-17-014: overridesBuiltInTool Support

**O que fazer**:

- Adicionar flag `overridesBuiltInTool` em `buildTool()`
- Documentar ferramentas overrideable

---

## 3. Bugs a Corrigir

### 3.1 BUG-SDK-01 (ALTA): forceStopClient orphan sessions

**Fix**: Em `forceStopClient()`, chamar `_sessions.clear()` explicitamente antes de
`client.forceStop()`

### 3.2 BUG-SDK-02 (MÉDIA): loadCustomTools side-effect

**Fix**: Remover a chamada `loadCustomTools()` no final do módulo. Fazer loading explícito no
bootstrap.

### 3.3 BUG-SDK-03 (MÉDIA): tools-state sync persistência

**Fix**: `patchToolsConfig()` deve chamar `await _persistToolsConfigAsync()` em vez de
`persistToolsConfig()` sync.

### 3.4 BUG-SDK-04 (BAIXA): registerCustomTool sync persist

**Fix**: `registerCustomTool()` deve retornar Promise e chamar `_persistCustomToolsAsync()`.

### 3.5 BUG-SDK-05 (BAIXA): known-models desatualizado

**Fix**: Adicionar modelos faltantes (ver F-17-011).

---

## 4. Dívida Técnica a Resolver

### 4.1 DEBT-01 + DEBT-02: Eliminar FS Sync Residuais

- Converter `loadCustomTools()` → apenas `loadCustomToolsAsync()`
- Converter `loadToolsConfig()` → apenas `loadToolsConfigAsync()`
- Remover funções sync deprecated
- Atualizar bootstrap para chamar versões async

### 4.2 DEBT-03: @module Headers

- Corrigir `@module` path em todos os SDK files para refletir localização real

### 4.3 DEBT-04: Test Helpers

- Prefixar test helpers com `_` e marcar como `@internal`
- Adicionar guard `if (process.env.NODE_ENV === 'test')` opcional

### 4.4 DEBT-05: Session Map Bounds

- Adicionar TTL ou LRU eviction ao `_sessions` Map em client.js
- Configurável via env var `SDK_SESSION_MAX_AGE_MS` (default: 4h)

---

## 5. Tipagem a Completar

### 5.1 Tipos Faltantes no Nosso Layer

| Tipo SDK Oficial                            | Onde Falta                                            |
| ------------------------------------------- | ----------------------------------------------------- |
| `ProviderConfig`                            | session.js — novo                                     |
| `SessionCapabilities`                       | Inteiro — novo                                        |
| `ElicitationHandler` / `ElicitationContext` | Inteiro — novo                                        |
| `CommandDefinition`                         | Inteiro — novo                                        |
| `UserInputRequest` / `UserInputResponse`    | hooks/user-input.js — referenciar ao invés de recriar |
| `ToolResultObject` / `ToolResult`           | custom-tools.js — alinhar                             |
| `ForegroundSessionInfo`                     | client.js — usar                                      |
| `SessionContext`                            | session.js — expor                                    |
| `SectionOverride` / `SectionOverrideAction` | session.js — completar                                |

### 5.2 Alinhamento com Tipos Oficiais

- Usar `@typedef {import('@github/copilot-sdk').X}` para TODOS os tipos que existem no SDK
- Não recriar tipos que já existem no SDK — importar

---

## 6. Validação Automática do SDK

### 6.1 Teste de Paridade de Superfície

Criar `tests/unit/copilot/sdk/surface-parity.spec.js`:

- Importar todos os exports de `@github/copilot-sdk`
- Importar todos os exports do nosso `src/copilot/sdk/index.js`
- Verificar que para cada export SDK, existe um wrapper/re-export correspondente
- Verificar que todas as opções de `SessionConfig` são aceitas por `buildSessionConfig()`

### 6.2 Teste de Compatibilidade de Tipos

Criar `tests/unit/copilot/sdk/type-compat.spec.js`:

- Para cada typedef do SDK, verificar que nosso JSDoc referencia o tipo correto
- Verificar que `CopilotClientOptions` são passados sem filtrar campos

### 6.3 Teste de Completude de API Routes

Criar `tests/unit/copilot/api/route-completeness.spec.js`:

- Para cada método público do `CopilotClient`, verificar que existe uma route Express
- Para cada método público do `CopilotSession`, verificar que existe uma route Express

---

## 7. Resumo de Impacto

| Dimensão                      | Esforço | Arquivos Novos | Arquivos Modificados |
| ----------------------------- | ------- | -------------- | -------------------- |
| F-17-001 (Provider/BYOK)      | Alto    | 1              | 3                    |
| F-17-002 (SDK Upgrade)        | Baixo   | 0              | 2-3                  |
| F-17-003 (Lifecycle Events)   | Médio   | 0              | 2                    |
| F-17-004 (Session Log)        | Baixo   | 0              | 2                    |
| F-17-005 (Tools Filtering)    | Médio   | 0              | 3                    |
| F-17-006 (Elicitation)        | Alto    | 1              | 3                    |
| F-17-007 (Commands)           | Médio   | 1              | 2                    |
| F-17-008 (getLastSessionId)   | Baixo   | 0              | 2                    |
| F-17-009 (SessionConfig Full) | Médio   | 0              | 2                    |
| F-17-010 (ClientOptions Full) | Médio   | 0              | 1                    |
| F-17-011 (known-models)       | Baixo   | 0              | 1                    |
| F-17-012 (Session RPC)        | Baixo   | 0              | 1                    |
| F-17-013 (Async Dispose)      | Baixo   | 0              | 1                    |
| F-17-014 (overridesBuiltIn)   | Baixo   | 0              | 1                    |
| Bugs (5)                      | Médio   | 0              | 4                    |
| Dívida Técnica (5)            | Médio   | 0              | 5                    |
| Tipagem Completa              | Médio   | 0              | 10+                  |
| Validação Automática          | Médio   | 3              | 0                    |
| **Total**                     |         | **~6 novos**   | **~30 modificados**  |
| **Testes novos estimados**    |         |                | **~120-150**         |

---

## 8. Integração Agent ↔ SDK — Propostas

### 8.1 ARCH-INT-01: Centralizar Config no SDK Wrapper

**Problema**: O `agent/session/initializer.js` configura `availableTools`, `excludedTools`,
`skillDirectories`, `customAgents`, `infiniteSessions`, `workingDirectory` diretamente, bypassing
`buildSessionConfig()`.

**Proposta**:

- Estender `buildSessionConfig()` para aceitar TODOS os campos que `initializer.js` passa
- Refatorar `initializer.js` para chamar `buildSessionConfig()` ao invés de construir o objeto
  manualmente
- Manter backward-compat: campos extras são merged (não substituídos)
- **Testes**: 8+ (verificar que initializer produz mesma config via wrapper)

### 8.2 ARCH-INT-02: Unificar Tools Filtering

**Problema**: `tools-state.js` (allowlist/denylist) e passagem direta de
`availableTools`/`excludedTools` coexistem.

**Proposta**:

- `buildSessionConfig()` consulta `tools-state.js` internamente
- Se `allowlist → availableTools`, se `denylist → excludedTools` (merge com explícitos)
- API route `/config/tools` continua controlando o tools-state; conversão transparente
- **Testes**: 6+

### 8.3 ARCH-INT-03: Tipagem Central via SDK Types

**Problema**: `PermissionHandler`, `Tool`, `SessionConfig`, `MessageOptions` importados
inconsistentemente em ~20 arquivos.

**Proposta**:

- Expandir barrel `sdk/index.js` com re-exports tipados de todos os tipos públicos do SDK
- Migrar todos os imports diretos de `@github/copilot-sdk` para `#copilot/sdk`
- **Testes**: typecheck coverage

---

## 9. Integração Observability ↔ SDK — Propostas

### 9.1 OBS-GAP-01: Event Catalog Auto-Discovery

**Proposta**:

- Teste automatizado que valida `DEFAULT_PERSIST_TYPES` contra event types conhecidos
- Quando SDK atualizado, teste falha se novos types adicionados → força atualização
- **Testes**: 3+

### 9.2 OBS-GAP-02: OTEL TelemetryConfig Type Alignment

**Proposta**:

- Importar tipo `TelemetryConfig` do SDK ao invés de typedef local
- Validar com typecheck compatibilidade
- **Testes**: 2+

### 9.3 OBS-GAP-03: Capabilities Monitoring

**Proposta**:

- Handler para `session.capabilities` no event-collector
- Alert quando capabilities esperadas ficam indisponíveis
- **Testes**: 4+

### 9.4 OBS-GAP-04: Elicitation Metrics

**Proposta**:

- `recordElicitation(durationMs, type)` no MetricsStore + histograma dedicado
- **Testes**: 2+

---

## 10. Integração Bridges ↔ SDK — Propostas

### 10.1 BRG-GAP-01: NERV Bridge Event Parity

**Proposta**:

- Teste que compara `EVENT_MAP` com lista conhecida de agent events
- Falha quando novo evento adicionado sem mapeamento
- **Testes**: 2+

### 10.2 BRG-GAP-02: MCP Config Full Passthrough

**Proposta**:

- `buildMcpConfig()` para aceitar todos os campos da `MCPServerConfig` do SDK
- **Testes**: 3+

---

## 11. Resumo de Impacto Revisado (Total)

| Dimensão                            | Arquivos Novos | Arquivos Modificados | Testes Novos |
| ----------------------------------- | -------------- | -------------------- | ------------ |
| SDK Features (seções 2-4)           | ~6             | ~30                  | ~120         |
| Agent Integration (seção 8)         | 0              | ~5                   | ~22          |
| Observability Integration (seção 9) | 0              | ~4                   | ~11          |
| Bridges Integration (seção 10)      | 0              | ~3                   | ~5           |
| **Total Revisado**                  | **~6**         | **~42**              | **~158**     |
