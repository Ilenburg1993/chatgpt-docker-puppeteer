# Arquitetura Ideal — SDK Wrapper Layer (`src/copilot/sdk/`)

**Status**: 🗺️ Visão alvo (em construção iterativa)
**Última atualização**: 2026-04-25
**Autores**: Agente Copilot + sessão de hardening profundo
**Relacionados**:
- `SDK-COPILOT-ARQUITETURA-PROFUNDA.md` — visão de integração histórica
- `SDK-COPILOT-PROXIMAS-FASES.md` — roadmap de features do SDK
- `src/copilot/sdk/types.js` — SSOT de tipos (canônico)
- `src/copilot/sdk/index.js` — barrel principal (~120 exports)

---

## 1. Visão Geral e Princípio Central

> **"Nenhuma chamada ao SDK deve existir fora de um wrapper dedicado e completo."**

Este é o princípio arquitetural mais importante deste repositório em relação ao `@github/copilot-sdk`.
Toda interação com o SDK — criação de client, sessões, RPC, tools, eventos — deve passar por um
módulo wrapper que fornece:

1. **Validação de entrada** — argumentos tipados e verificados antes de chegar ao SDK
2. **Logging padronizado** — contexto rastreável (sessionId, módulo, operação)
3. **Tratamento de erros** — erros SDK classificados e re-lançados como erros de domínio
4. **Observabilidade** — hooks de métricas/telemetria opcionais mas previstos
5. **Contrato de tipo completo** — JSDoc robusto em todas as funções públicas

O que chamamos de **"crude call"** é qualquer acesso direto a `session.rpc.*`, `client.*`, ou
construtores do SDK sem este envelope. Crude calls são proibidas fora de `src/copilot/sdk/`.

---

## 2. Diagrama de Camadas

```
┌─────────────────────────────────────────────────────────────────────┐
│                        src/copilot/                                  │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  [L0] @github/copilot-sdk  (vendor — never touched directly) │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                            ↑ somente de                              │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  [L1] src/copilot/sdk/  (SDK Wrapper Layer — SSOT)           │   │
│  │                                                              │   │
│  │  ┌────────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │   │
│  │  │ types.js   │  │ errors.js│  │constants │  │ logger   │  │   │
│  │  │ (SSOT)     │  │(classify)│  │          │  │          │  │   │
│  │  └────────────┘  └──────────┘  └──────────┘  └──────────┘  │   │
│  │                                                              │   │
│  │  ┌────────────────────────────────────────────────────────┐ │   │
│  │  │  session/  — client.js, wrapper.js, lifecycle.js ...   │ │   │
│  │  │  rpc/      — session.js, ops.js, server.js, exp.js     │ │   │
│  │  │  tools/    — core.js, custom.js, registry.js, state.js │ │   │
│  │  │  models/   — models.js                                 │ │   │
│  │  │  telemetry/ — telemetry.js                             │ │   │
│  │  │  agent/    — agents.js                                 │ │   │
│  │  └────────────────────────────────────────────────────────┘ │   │
│  │                                                              │   │
│  │  index.js  (barrel — único ponto de saída de L1)            │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                            ↑ somente via #copilot/sdk                │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  [L2] src/copilot/agent/ + orchestrator/ + kernel/           │   │
│  │  (domínio de missão — consome SDK via L1, não diretamente)   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                            ↑                                         │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  [L3] src/copilot/server/ + terminal/                        │   │
│  │  (superfície externa — HTTP, WebSocket, Terminal)            │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

**Regra de importação canônica:**
- `[L0]` → apenas `[L1]` pode importar `@github/copilot-sdk` diretamente
- `[L2+]` → apenas via alias `#copilot/sdk` (que aponta para `src/copilot/sdk/index.js`)
- `[L3]` → pode importar de `[L2]` e `[L1]`, nunca de `[L0]`

---

## 3. Anatomia de um Wrapper Completo

Cada função pública em `src/copilot/sdk/` deve seguir este contrato:

```js
// @ts-check

/**
 * Descrição da operação. O que faz, quando usar, limitações.
 *
 * @param {import('./types.js').CopilotSession} session - Sessão ativa
 * @param {string} param - Descrição do parâmetro com validações
 * @param {{ opt?: string }} [options] - Opções opcionais com defaults documentados
 * @returns {Promise<ResultType>} O que retorna, formato esperado
 * @throws {TypeError} Quando os parâmetros são inválidos
 * @throws {SdkOperationError} Quando o SDK falha na operação
 */
export async function operationName(session, param, options) {
    // 1. Validação de entrada (falha rápido, tipo assertado)
    assertSession(session, 'operationName');
    if (typeof param !== 'string' || param.length === 0) {
        throw new TypeError('[sdk/module.operationName] param deve ser string não-vazia.');
    }

    // 2. Log de início (com contexto rastreável)
    appLog('INFO', `[sdk/module] operationName: param='${param}', sessionId='${session.sessionId}'`);

    // 3. Construção de parâmetros tipados para o SDK
    const sdkParams = /** @type {SdkParamType} */ ({ param });
    if (options?.opt) sdkParams.opt = options.opt;

    // 4. Chamada ao SDK encapsulada em try/catch
    try {
        const result = await session.rpc.module.operation(sdkParams);

        // 5. Log de sucesso (opcional, para operações críticas)
        appLog('DEBUG', `[sdk/module] operationName concluída: sessionId='${session.sessionId}'`);

        return /** @type {ResultType} */ (result);
    } catch (err) {
        // 6. Reclassificação e re-lançamento como erro de domínio
        const kind = classifySdkError(err);
        appLog('ERROR', `[sdk/module] operationName falhou (${kind}): ${toError(err).message}`);
        throw new SdkOperationError('operationName', kind, err);
    }
}
```

### Critérios para considerar um wrapper "completo"

| Critério                                  | Obrigatório | Descrição                                 |
| ----------------------------------------- | ----------- | ----------------------------------------- |
| JSDoc com `@param` e `@returns` tipados   | ✅           | Todos os parâmetros públicos              |
| `assertSession` ou equivalente            | ✅           | Para funções que recebem session          |
| Validação de tipos de entrada             | ✅           | Antes de qualquer chamada ao SDK          |
| Log de início com `sessionId`             | ✅           | Para rastreabilidade                      |
| Try/catch com `classifySdkError`          | ✅           | Em chamadas ao SDK que podem falhar       |
| Parâmetros SDK construídos explicitamente | ✅           | Sem spread não-tipado                     |
| Retorno tipado (`@returns`)               | ✅           | Nunca `Promise<unknown>` em APIs públicas |
| Log de erro com contexto                  | ✅           | Nível ERROR com reason                    |
| Observability hook (emitir evento)        | 🔄 Desejável | Para métricas de negócio                  |
| Circuit breaker (para I/O crítico)        | 🔄 Desejável | Para operações de conexão                 |

---

## 4. Estado Atual vs. Ideal

### 4.1 O que já está correto

| Módulo                   | Status     | Notas                                         |
| ------------------------ | ---------- | --------------------------------------------- |
| `sdk/types.js`           | ✅ Completo | SSOT, strict-compliant, 781+ linhas           |
| `sdk/errors.js`          | ✅ Completo | Classificação por kind, fingerprint           |
| `sdk/session/client.js`  | ✅ Completo | Circuit breaker, registry externalizado       |
| `sdk/session/wrapper.js` | ✅ Completo | Abort, disconnect, sendAndWait com tratamento |
| `sdk/rpc/session.js`     | ✅ Completo | model, mode, plan — validados e logados       |
| `sdk/rpc/ops.js`         | ✅ Completo | compaction, shell, elicitation, tools         |
| `sdk/tools/core.js`      | ✅ Completo | createTool, createToolSync                    |
| `sdk/config.js`          | ✅ Completo | buildSessionConfig com SessionConfigOverrides |
| `sdk/constants.js`       | ✅ Completo |                                               |
| `sdk/logger.js`          | ✅ Completo |                                               |

### 4.2 Gaps conhecidos (a resolver no roadmap)

| Módulo                                             | Gap                                                    | Severidade   |
| -------------------------------------------------- | ------------------------------------------------------ | ------------ |
| `sdk/rpc/ops.js` — retornos `Promise<unknown>`     | Retornos não tipados nas funções públicas              | 🟡 Médio      |
| `sdk/rpc/session.js` — retornos `Promise<unknown>` | Retornos não tipados nas funções públicas              | 🟡 Médio      |
| `sdk/session/permissions.js`                       | Verificar se tem try/catch padronizado                 | 🟡 Médio      |
| `sdk/session/provider.js`                          | Verificar crude calls para provider RPC                | 🟡 Médio      |
| `sdk/telemetry/`                                   | Verificar cobertura de telemetria em todos os wrappers | 🟡 Médio      |
| `sdk/rpc/experimental.js`                          | Features experimentais sem try/catch                   | 🟠 Alto       |
| `agent/` — chamadas via `#copilot/sdk`             | Verificar se TODOS os acessos vão pelo barrel          | 🟠 Alto       |
| `runtime-wiring.js`                                | DI e wiring — verificar ausência de imports diretos L0 | 🟠 Alto       |
| Telemetria de observabilidade nos wrappers RPC     | Nenhum wrapper RPC emite evento de métricas            | 🔴 Importante |

---

## 5. Padrões de Tipo: Público SDK vs. Local

Esta distinção é crítica e foi consolidada durante o hardening de `types.js`:

### Tipos públicos do SDK (usar `import('@github/copilot-sdk').X`)

Disponíveis em `node_modules/@github/copilot-sdk/dist/index.d.ts`:

- `CopilotClient`, `CopilotSession`, `SessionConfig`, `ResumeSessionConfig`
- `MessageOptions`, `ConnectionState`, `Tool`, `ToolHandler`, `ToolInvocation`, `ToolResultObject`
- `ZodSchema`, `PermissionRequest`, `PermissionRequestResult`, `PermissionHandler`
- `SystemMessage*`, `SectionOverride*`
- `SessionEvent`, `SessionEventType`, `SessionEventPayload`, `TypedSessionEventHandler`
- `AssistantMessageEvent`, `SessionLifecycleEvent*`
- `ModelInfo`, `ModelCapabilities`, `ModelPolicy`, `ModelBilling`
- `MCP*Config`, `CustomAgentConfig`, `InfiniteSessionConfig`, `TelemetryConfig`
- `TraceContext`, `TraceContextProvider`
- `GetStatusResponse`, `GetAuthStatusResponse`
- `SessionContext`, `SessionMetadata`, `SessionListFilter`, `ForegroundSessionInfo`
- `CopilotClientOptions`, `SYSTEM_PROMPT_SECTIONS`, `approveAll`, `defineTool`

### Tipos internos do SDK (definir localmente em `types.js`, espelhando `dist/types.d.ts`)

NÃO re-exportados em `dist/index.d.ts` — causam `TS2694` se importados via `import('@github/copilot-sdk').X`:

- `ReasoningEffort` = `"low" | "medium" | "high" | "xhigh"`
- `ToolBinaryResult`, `ToolResult`, `ToolResultType`
- `ToolCallRequestPayload`, `ToolCallResponsePayload`
- `UserInputRequest`, `UserInputResponse`, `UserInputHandler`
- `BaseHookInput`, `SessionHooks`
- `PreToolUseHookInput/Output/Handler`, `PostToolUseHookInput/Output/Handler`
- `UserPromptSubmittedHookInput/Output/Handler`
- `SessionStartHookInput/Output/Handler`, `SessionEndHookInput/Output/Handler`
- `ErrorOccurredHookInput/Output/Handler`
- `ProviderConfig`

**Regra**: quando o SDK for atualizado, verificar se novos tipos foram promovidos para o root export
de `dist/index.d.ts` e migrar as definições locais para `import('@github/copilot-sdk').X`.

---

## 6. Roadmap de Hardening

### Fase 1 — Fundação de tipos (✅ CONCLUÍDA)

| Item                                                               | Status |
| ------------------------------------------------------------------ | ------ |
| Reescrever `sdk/types.js` como SSOT completo                       | ✅      |
| Corrigir 30 erros TS2694 (tipos não-públicos)                      | ✅      |
| Adicionar `SessionConfigOverrides` para exactOptionalPropertyTypes | ✅      |
| `npm run typecheck:strict` → 0 erros                               | ✅      |
| `npm run lint` → 0 erros                                           | ✅      |

### Fase 2 — Limpeza de legado (✅ CONCLUÍDA)

| Item                                                                    | Status |
| ----------------------------------------------------------------------- | ------ |
| Remover compat shim `event-bus-observers.js`                            | ✅      |
| Remover compat shim `terminal/workspace-context.js`                     | ✅      |
| Migrar `legacy_web_fetch` → `web_fetch_local`                           | ✅      |
| Migrar `legacy_report_intent` → `report_intent_local`                   | ✅      |
| Remover rota `/telemetry` legada em `server/routes/sdk/agent.js`        | ✅      |
| Remover `DEPRECATED_CUSTOM_TOOL_NAMES` em `server/routes/sdk/client.js` | ✅      |
| Remover aliases `getDefaults`/`buildConfig` de `client-facade.js`       | ✅      |

### Fase 3 — Completar retornos tipados nos wrappers RPC (🔄 EM ANDAMENTO)

**Meta**: nenhuma função pública em `sdk/rpc/` retorna `Promise<unknown>`.

| Item                                                                          | Status |
| ----------------------------------------------------------------------------- | ------ |
| Definir tipos de retorno para `rpc/ops.js` — compaction, shell, elicitation   | 🔄      |
| Definir tipos de retorno para `rpc/session.js` — model, mode, plan, workspace | 🔄      |
| Definir tipos de retorno para `rpc/server.js` — status, health, port          | 🔄      |
| Adicionar try/catch padronizado em `rpc/experimental.js`                      | 🔄      |
| Verificar `sdk/session/permissions.js` e `sdk/session/provider.js`            | 🔄      |

### Fase 4 — Observabilidade nos wrappers (⬜ PENDENTE)

**Meta**: cada wrapper RPC que representa uma operação de negócio emite um evento de métricas.

| Item                                                                              | Status |
| --------------------------------------------------------------------------------- | ------ |
| Definir interface `SdkOperationMetric` em `types.js`                              | ⬜      |
| Injetar `emitMetric` opcional via DI nos wrappers RPC                             | ⬜      |
| Emitir evento em `modelSwitchTo`, `shellExec`, `compactionCompact`, `sendAndWait` | ⬜      |
| Integrar com observability event bus existente                                    | ⬜      |
| Dashboard: contadores de chamadas RPC por tipo                                    | ⬜      |

### Fase 5 — Auditoria de boundary (⬜ PENDENTE)

**Meta**: nenhum módulo fora de `src/copilot/sdk/` importa `@github/copilot-sdk` diretamente.

| Item                                                                          | Status |
| ----------------------------------------------------------------------------- | ------ |
| Scan automático: `rg "from '@github/copilot-sdk'"` fora de `src/copilot/sdk/` | ⬜      |
| Configurar ESLint `no-restricted-imports` para enforçar boundary L0→L1        | ⬜      |
| Adicionar ao CI: falha se import direto detectado fora de `sdk/`              | ⬜      |

### Fase 6 — Erro de domínio `SdkOperationError` (⬜ PENDENTE)

**Meta**: toda falha do SDK é relançada como `SdkOperationError` com kind, operação e causa.

| Item                                                                          | Status |
| ----------------------------------------------------------------------------- | ------ |
| Criar classe `SdkOperationError extends Error` em `sdk/errors.js`             | ⬜      |
| Adicionar `name`, `kind`, `operation`, `cause` como campos                    | ⬜      |
| Migrar todos os catch em wrappers RPC para usar `SdkOperationError`           | ⬜      |
| Adicionar ao `types.js`: `SdkErrorKind` union já existe — usar em constructor | ⬜      |
| Atualizar JSDoc de todos os wrappers: `@throws {SdkOperationError}`           | ⬜      |

### Fase 7 — Session `SdkOperationError` + recovery (⬜ PENDENTE)

**Meta**: erros de sessão classificados automaticamente disparam recovery policies.

| Item                                                                            | Status |
| ------------------------------------------------------------------------------- | ------ |
| Integrar `classifySdkError` com circuit breaker no `session/client.js`          | ⬜      |
| Políticas de retry por `SdkErrorKind` (`rate_limit` → back-off, `auth` → abort) | ⬜      |
| Integrar com watchdog agent para notificar sobre `quota_exhausted`              | ⬜      |

---

## 7. Invariantes Arquiteturais (não negociáveis)

Estas regras devem ser verdadeiras em qualquer ponto do tempo, e violações devem ser detectadas pelo CI:

1. **Crude Call Zero**: `@github/copilot-sdk` só é importado em `src/copilot/sdk/`
2. **Types SSOT**: tipos do SDK só fluem via `sdk/types.js` ou `import('@github/copilot-sdk').X` em `sdk/`
3. **Barrel único**: consumidores externos usam `#copilot/sdk`, nunca sub-caminhos diretos de `sdk/`
4. **Strict clean**: `npm run typecheck:strict` sempre passa com 0 erros
5. **Lint clean**: `npm run lint` sempre passa
6. **assertSession em todo wrapper de sessão**: nunca chamar `session.rpc.*` sem validação prévia
7. **Logging rastreável**: toda operação com `sessionId` loga o `sessionId`
8. **Erros classificados**: nenhum `catch (e) { throw e; }` direto — sempre classifica e contextualiza

---

## 8. Vocabulário Canônico

| Termo                | Definição                                                                            |
| -------------------- | ------------------------------------------------------------------------------------ |
| **Crude call**       | Acesso direto a `session.rpc.*`, `client.*` ou construtor SDK sem wrapper            |
| **Wrapper completo** | Função com os 8 critérios obrigatórios da seção 3                                    |
| **L0**               | Camada vendor: `@github/copilot-sdk` (não tocado diretamente)                        |
| **L1**               | SDK Wrapper Layer: `src/copilot/sdk/` — único ponto de contato com L0                |
| **L2**               | Domínio: `agent/`, `orchestrator/`, `kernel/` — consumem L1 via barrel               |
| **L3**               | Superfície: `server/`, `terminal/` — consomem L2 e L1                                |
| **SSOT**             | Single Source of Truth — `types.js` para tipos, `index.js` para exports              |
| **Barrel**           | Módulo de re-exportação: `index.js` expõe tudo de L1 via `#copilot/sdk`              |
| **DI Token**         | Identificador de injeção de dependência em `sdk/di-tokens.js`                        |
| **SdkErrorKind**     | `'rate_limit' \| 'quota_exhausted' \| 'auth' \| 'network' \| 'timeout' \| 'unknown'` |

---

## 9. Checklist de Revisão (para PRs que tocam `src/copilot/sdk/`)

Antes de mergear qualquer mudança em `src/copilot/sdk/`:

- [ ] Nenhuma crude call nova introduzida
- [ ] Novos tipos adicionados ao `types.js` (SSOT)
- [ ] Funções públicas novas têm JSDoc com `@param`, `@returns`, `@throws`
- [ ] `assertSession` chamado onde aplicável
- [ ] Log de início/erro com `sessionId`
- [ ] Try/catch em chamadas SDK que podem falhar
- [ ] `npm run typecheck:strict` → 0 erros
- [ ] `npm run lint` → 0 erros
- [ ] Testes unitários cobrem o novo código
