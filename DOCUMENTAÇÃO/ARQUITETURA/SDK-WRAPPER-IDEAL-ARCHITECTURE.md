# Arquitetura Ideal — SDK Wrapper Layer (`src/copilot/sdk/`)

**Status**: 🗺️ Visão alvo (em construção iterativa)
**Última atualização**: 2026-04-26
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
│  │  [L2] src/copilot/agent/        │   │
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

| Módulo                     | Status     | Notas                                                                 |
| -------------------------- | ---------- | --------------------------------------------------------------------- |
| `sdk/types.js`             | ✅ Completo | SSOT, strict-compliant, typedefs públicos + locais                    |
| `sdk/errors.js`            | ✅ Completo | Classificação por kind, fingerprint, `SdkOperationError`              |
| `sdk/session/client.js`    | ✅ Completo | Circuit breaker, registry externalizado                               |
| `sdk/session/lifecycle.js` | ✅ Completo | create/resume/list/delete com normalização de erro                    |
| `sdk/session/wrapper.js`   | ✅ Completo | abort, disconnect, sendAndWait, send, setModel com tratamento         |
| `sdk/rpc/session.js`       | ✅ Completo | model, mode, plan, workspace com retornos tipados                     |
| `sdk/rpc/ops.js`           | ✅ Completo | compaction, shell, elicitation, tools, agent ops com erro normalizado |
| `sdk/rpc/server.js`        | ✅ Completo | superfície server RPC convergida no wrapper                           |
| `sdk/rpc/experimental.js`  | ✅ Completo | wrappers experimentais com `SdkOperationError`                        |
| `sdk/tools/core.js`        | ✅ Completo | createTool, createToolSync                                            |
| `sdk/config.js`            | ✅ Completo | buildSessionConfig com SessionConfigOverrides                         |
| `sdk/constants.js`         | ✅ Completo |                                                                       |
| `sdk/logger.js`            | ✅ Completo |                                                                       |

### 4.2 Gaps conhecidos (a resolver no roadmap)

| Módulo                                         | Gap                                                       | Severidade                                             |
| ---------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| `sdk/session/permissions.js`                   | Verificar se tem try/catch padronizado                    | 🟡 Médio                                                |
| `sdk/session/provider.js`                      | Verificar crude calls para provider RPC                   | 🟡 Médio                                                |
| `sdk/telemetry/`                               | Verificar cobertura de telemetria em todos os wrappers    | 🟡 Médio                                                |
| `agent/facades/agent-sdk-access.js`            | Consolidar owner único de reads/status/server+session RPC | 🔄 Em progresso (owner ampliado para lifecycle/session) |
| `agent/facades/agent-sdk-session.js`           | Owner canônico de mode/plan/session ops                   | ✅ Consolidado nesta onda                               |
| `agent/dialog/*`                               | Remover imports residuais do SDK em utilitários de loop   | ✅ Resolvido nesta onda (loop/resume convergidos)       |
| `runtime-wiring.js`                            | DI e wiring — verificar ausência de imports diretos L0    | 🟠 Alto                                                 |
| Telemetria de observabilidade nos wrappers RPC | Nenhum wrapper RPC emite evento de métricas               | 🔴 Importante                                           |

### 4.3 Comunicação atual entre `src/copilot/agent/` e `src/copilot/sdk/`

Hoje a comunicação `agent ↔ sdk` acontece por **quatro estilos diferentes ao mesmo tempo**:

#### A. Barrel canônico `#copilot/sdk` (o estilo correto)

Exemplos já presentes (restantes e intencionais):

- `agent/facades/agent-sdk-access.js`
    - owner canônico de reads/status/lifecycle/session wrappers
- `agent/facades/agent-sdk-runtime.js`
    - owner canônico de sessão ativa e waitForEvent
- `agent/ports/tool-port.js`
    - integração viva com sessionRpc/tools (seam legítimo)

Esse é o padrão alvo: o `agent` depende da superfície pública de L1 sem conhecer a topologia interna do SDK.

#### B. Imports internos de submódulos `sdk/*` (ainda aceitáveis, mas já considerados dívida)

Este documento reconhece como **estado atual, não estado ideal**, imports como:

- `agent/messaging/agent-messaging.js`
- `agent/session/history-sync.js`
- `agent/session/keepalive.js`
- `agent/session/boot-wiring.js`
- `agent/ports/tool-port.js`

Nessa rodada, parte desses imports já foi convergida para `#copilot/sdk`, mas a auditoria deixa explícito que qualquer
novo import de `../../sdk/*` dentro de `agent/` deve ser tratado como regressão arquitetural.

Além disso, `messaging`, `history-sync`, `keepalive`, `loop-manager` e `resume-policy` já começaram a sair até mesmo
da dependência direta do barrel do SDK, passando a consumir uma façade local (`agent-sdk-runtime.js`) que concentra
operações de sessão ativa e espera de eventos (`waitForAgentSdkEvent`).

#### C. Handles crus carregados no `AgentContext`

`AgentContext` continua sendo o repositório dos handles vivos do runtime:

- `client`
- `session`
- `serverRpc`
- `sessionRpc`
- `toolsRegistry`
- `permissionHandler`

Isso é inevitável no runtime, mas **não deve significar liberdade para cada módulo falar com o SDK do seu jeito**.
O problema não é o handle existir; o problema é **cada consumer construir sua própria semântica de acesso**.

#### D. Facades e ports do agent sobre o SDK

Já existe uma camada embrionária muito importante:

- `agent/facades/agent-sdk-access.js`
- `agent/facades/agent-sdk-session.js`
- `agent/ports/tool-port.js`

Esses módulos apontam a direção certa, mas ainda não monopolizam a fronteira toda.

### 4.4 Diagnóstico objetivo da fronteira `agent ↔ sdk`

A sobreposição foi reduzida de forma significativa nesta onda:

1. **Criação / retomada de sessão**
     - convergida para `agent/facades/agent-sdk-access.js` em callers de lifecycle/session

2. **Uso operacional da sessão ativa**
     - convergido para `agent-sdk-runtime.js` (`messaging`, `history-sync`, `keepalive`, `dialog/*`)

3. **Superfície de capacidades da sessão**
    - `agent/facades/agent-sdk-access.js` (reads/status/server+session RPC)
    - `agent/facades/agent-sdk-session.js` (owner de mode/plan/session ops)
    - `agent/ports/tool-port.js` (seam legítimo de integração viva)

O principal problema, portanto, **não é mais crude call direta ao vendor** — isso já foi quase todo eliminado fora de
`sdk/`. O problema restante é:

> **o `agent` ainda conversa com o SDK por caminhos demais, com semânticas parcialmente repetidas.**

### 4.5 Situação ideal para `agent ↔ sdk`

O estado ideal busca três níveis de fronteira claros:

#### Nível 1 — `src/copilot/sdk/`

É a **única** camada que fala com `@github/copilot-sdk`.

Responsável por:

- client lifecycle
- session lifecycle
- session runtime wrappers
- RPC wrappers
- error normalization
- vendor typing

#### Nível 2 — `agent/facades/agent-sdk-*.js`

É a **única** superfície pela qual o runtime do agente faz perguntas de alto nível ao SDK.

Responsável por:

- status/auth/quota
- listagem/foreground/sessions
- mode/plan/workspace
- agent selection / experimental surfaces expostas ao runtime
- leitura dos handles vivos do contexto

Regra:

- módulos de `agent/` fora de `facades/` e `ports/` **não** devem conhecer `sessionRpc`, `serverRpc` ou a topologia de
    `sdk/`.

#### Nível 3 — `agent/ports/*.js`

É a camada onde o `agent` liga o SDK ao resto do runtime:

- `tool-port.js` para `sessionRpc` e tools
- `hook-port.js` para hooks
- futuras portas para messaging/session-runtime se necessário

Regra:

- se uma integração depende de **estado vivo da sessão** ou de **adaptação para outro subsistema**, ela deve morar em
    `ports/`, não em módulos quentes de domínio.

### 4.6 Invariante novo da arquitetura

Além dos invariantes gerais, a fronteira `agent ↔ sdk` passa a obedecer esta regra explícita:

> **Nenhum módulo de `agent/` fora de `facades/` e `ports/` pode importar `../../sdk/*` ou `#copilot/sdk/*` interno.**

Forma permitida:

- `#copilot/sdk` (barrel)
- ou `agent/facades/*`
- ou `agent/ports/*`

Forma proibida:

- `../../sdk/session/*`
- `../../sdk/rpc/*`
- `#copilot/sdk/rpc-session`
- `#copilot/sdk/rpc-ops`
- `#copilot/sdk/server-rpc`

exceto dentro de `src/copilot/sdk/` e, por decisão explícita, dentro de facades/ports do agent.

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
| Definir tipos de retorno para `rpc/ops.js` — compaction, shell, elicitation   | ✅      |
| Definir tipos de retorno para `rpc/session.js` — model, mode, plan, workspace | ✅      |
| Definir tipos de retorno para `rpc/server.js` — status, health, port          | ✅      |
| Adicionar try/catch padronizado em `rpc/experimental.js`                      | ✅      |
| Verificar `sdk/session/permissions.js` e `sdk/session/provider.js`            | 🔄      |

### Fase 3B — Convergência explícita de `agent ↔ sdk` (🔄 EM ANDAMENTO)

**Meta**: o runtime do agente falar com o SDK por um conjunto pequeno de seams previsíveis.

| Item                                                                                          | Status                            |
| --------------------------------------------------------------------------------------------- | --------------------------------- |
| Convergir imports de `agent/messaging/*` para `#copilot/sdk` barrel                           | ✅                                 |
| Convergir imports de `agent/session/{history-sync,keepalive,boot-wiring}` para barrel         | ✅                                 |
| Convergir `agent/ports/tool-port.js` para `#copilot/sdk` barrel                               | ✅                                 |
| Mapear todos os imports restantes `agent/** -> ../../sdk/*`                                   | ✅                                 |
| Introduzir façade de sessão ativa (`agent-sdk-runtime.js`) para `messaging/history/keepalive` | ✅                                 |
| Convergir `dialog/loop-manager` e `dialog/resume-policy` para `agent-sdk-runtime.js`          | ✅                                 |
| Convergir `lifecycle/{entry,agent-lifecycle,runtime-host,session-setup}` para façades         | ✅                                 |
| Convergir `session/{cleanup,boot-steps,boot-wiring,initializer}` para façades                 | ✅                                 |
| Fechar `agent/facades/agent-sdk-access.js` como owner canônico de server/session RPC read     | ✅ (owner majoritário)             |
| Fechar `agent/facades/agent-sdk-session.js` como owner canônico de mode/plan/session ops      | ✅                                 |
| Remover conhecimento de `sessionRpc` de módulos de domínio fora de `facades/ports`            | ✅ para módulos quentes principais |
| Criar guardrail CI/grep para bloquear novos imports `agent -> sdk/*` internos                 | ✅                                 |

### Fase 4 — Observabilidade nos wrappers (⬜ PENDENTE)

**Meta**: cada wrapper RPC que representa uma operação de negócio emite um evento de métricas.

| Item                                                                              | Status |
| --------------------------------------------------------------------------------- | ------ |
| Definir interface `SdkOperationMetric` em `types.js`                              | ⬜      |
| Injetar `emitMetric` opcional via DI nos wrappers RPC                             | ⬜      |
| Emitir evento em `modelSwitchTo`, `shellExec`, `compactionCompact`, `sendAndWait` | ⬜      |
| Integrar com observability event bus existente                                    | ⬜      |
| Dashboard: contadores de chamadas RPC por tipo                                    | ⬜      |

### Fase 5 — Auditoria de boundary (🔄 EM ANDAMENTO)

**Meta**: nenhum módulo fora de `src/copilot/sdk/` importa `@github/copilot-sdk` diretamente.

| Item                                                                   | Status                                  |
| ---------------------------------------------------------------------- | --------------------------------------- |
| Scan automático: `check:copilot:boundary` fora de `src/copilot/sdk/`   | ✅                                       |
| Configurar ESLint `no-restricted-imports` para enforçar boundary L0→L1 | ✅                                       |
| Adicionar ao CI: falha se import direto detectado fora de `sdk/`       | 🔄 (via gate `check:copilot:guardrails`) |

### Fase 6 — Erro de domínio `SdkOperationError` (✅ CONCLUÍDA)

**Meta**: toda falha do SDK é relançada como `SdkOperationError` com kind, operação e causa.

| Item                                                                    | Status |
| ----------------------------------------------------------------------- | ------ |
| Criar classe `SdkOperationError extends Error` em `sdk/errors.js`       | ✅      |
| Adicionar `name`, `kind`, `operation`, `cause` como campos              | ✅      |
| Migrar todos os catch em wrappers RPC para usar `SdkOperationError`     | ✅      |
| Adicionar helper `toSdkOperationError()` para normalização centralizada | ✅      |
| Atualizar JSDoc de todos os wrappers: `@throws {SdkOperationError}`     | 🔄      |

### Fase 7 — Session `SdkOperationError` + recovery (⬜ PENDENTE)

**Meta**: erros de sessão classificados automaticamente disparam recovery policies.

| Item                                                                            | Status |
| ------------------------------------------------------------------------------- | ------ |
| Integrar `classifySdkError` com circuit breaker no `session/client.js`          | ⬜      |
| Políticas de retry por `SdkErrorKind` (`rate_limit` → back-off, `auth` → abort) | ⬜      |
| Integrar com watchdog agent para notificar sobre `quota_exhausted`              | ⬜      |

### Fase 8 — Guardrails de fronteira `agent ↔ sdk` (🔄 EM ANDAMENTO)

**Checkpoint atual (2026-04-26):** apenas **3 imports diretos de `#copilot/sdk`** permanecem em `agent/**`:

- `agent/facades/agent-sdk-access.js`
- `agent/facades/agent-sdk-runtime.js`
- `agent/ports/tool-port.js`

**Meta**: institucionalizar a arquitetura para impedir regressão futura.

| Item                                                                                       | Status |
| ------------------------------------------------------------------------------------------ | ------ |
| Adicionar teste estrutural cobrando ausência de `../../sdk/*` em `agent/` fora de ports    | ✅      |
| Adicionar teste estrutural cobrando ausência de `#copilot/sdk/*` interno fora da fronteira | ✅      |
| Adicionar regra de lint/restricted-imports para `agent/**`                                 | ✅      |
| Documentar explicitamente `facades/` e `ports/` como boundary de integração com o SDK      | ✅      |
| Medir a redução de pontos de contato `agent ↔ sdk` por checkpoint                          | 🔄      |

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
9. **Fronteira agent→sdk controlada**: fora de `facades/` e `ports/`, `agent/` fala com o SDK apenas via barrel `#copilot/sdk`

---

## 8. Vocabulário Canônico

| Termo                | Definição                                                                            |
| -------------------- | ------------------------------------------------------------------------------------ |
| **Crude call**       | Acesso direto a `session.rpc.*`, `client.*` ou construtor SDK sem wrapper            |
| **Wrapper completo** | Função com os 8 critérios obrigatórios da seção 3                                    |
| **L0**               | Camada vendor: `@github/copilot-sdk` (não tocado diretamente)                        |
| **L1**               | SDK Wrapper Layer: `src/copilot/sdk/` — único ponto de contato com                   |
|                      |
| **L3**               | Superfície: `server/`, `terminal/` — consomem L1                                     |
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

---

## 10. Upgrade oficial para `@github/copilot-sdk@0.3.0` (2026-04-26)

### 10.1 Status do upgrade

- `package.json` atualizado para `@github/copilot-sdk: ^0.3.0`
- `package-lock.json` resolvido em `0.3.0`
- Migração de API concluída nos wrappers/consumers principais (`rpc/session`, `rpc/ops`, permissões, schemas HTTP)

### 10.2 Quebras relevantes da v0.3.0 absorvidas

1. **Permissões (decision kind mudou)**
    - antigo: `approved` / `denied-*`
    - novo: `approve-once`, `approve-for-session`, `approve-for-location`, `reject`, `user-not-available`, `no-result`
    - impacto: `hooks/permission-handler.js`, `sdk/session/permissions.js`, `session-middleware.js`

2. **RPC namespace de workspace mudou**
    - antigo: `session.rpc.workspace.*`
    - novo: `session.rpc.workspaces.*`
    - impacto: `sdk/rpc/session.js` + snapshot de capacidades em `agent-sdk-access.js`

3. **Compaction mudou para history**
    - antigo: `session.rpc.compaction.compact()`
    - novo: `session.rpc.history.compact()`
    - impacto: `sdk/rpc/ops.js`, `tools/session-rpc-tools.js`, snapshot de capacidades

4. **Mutators RPC retornam `void` em vários pontos**
    - `mode.set`, `plan.update`, `plan.delete`, `workspaces.createFile`, `agent.deselect`
    - wrappers agora normalizam retorno para objetos de domínio (`{ success: true }`, `{ mode }`, `{}`)

5. **Renome de tipos MCP exportados no root**
    - antigo: `MCPLocalServerConfig` / `MCPRemoteServerConfig`
    - novo: `MCPStdioServerConfig` / `MCPHTTPServerConfig`
    - impacto: `sdk/types.js` (SSOT)

6. **Opção de token no client options**
    - antigo: `githubToken`
    - novo: `gitHubToken`
    - impacto: `config/client-options.js`

### 10.3 Guardrails NPM para evitar recorrência

Foram institucionalizados guardrails de instalação/resolução para evitar nova investigação longa de "versão existe no npm mas não resolve localmente":

- `.npmrc`:
    - `registry=https://registry.npmjs.org/`
    - `@github:registry=https://registry.npmjs.org/`
    - `prefer-online=true`
    - `prefer-offline=false`
    - `legacy-peer-deps=true` (conflito conhecido `madge@8` × `typescript@6`)

- scripts novos:
    - `npm run check:npm`
    - `npm run check:npm:copilot-sdk`
    - `npm run deps:refresh:online`

- script novo de validação online:
    - `scripts/ci/check-npm-registry-freshness.mjs`
    - valida dist-tags/version online com `--prefer-online` + cache fresh (`/tmp/npm-cache-fresh`)
    - confirma que o range declarado em `package.json` resolve no registry real

### 10.4 Procedimento canônico para futuros upgrades do SDK

1. Atualizar range no `package.json`.
2. Executar `npm run deps:refresh:online`.
3. Executar `npm run check:npm:copilot-sdk`.
4. Executar `npm run typecheck:node`.
5. Executar suíte de testes Copilot/contratos.
6. Atualizar este documento com breaking changes absorvidas.

### 10.5 Checkpoint de validação (fechamento desta onda)

Estado validado em `2026-04-26`:

- `npm run check:npm` ✅
- `npm run typecheck:node` ✅
- `npm run test:copilot` ✅ (`273 passed`, `20 skipped`; `4140 passed`, `33 skipped`)

Correção estrutural adicional aplicada durante a validação:

- `sdk/rpc/session.js` (`getWorkspaceRpc`) recebeu hardening para compatibilidade `workspaces` (v0.3.0) +
    `workspace` (legado)
- foi removido um pitfall de ASI em `return` com cast JSDoc multiline que podia retornar `undefined` em runtime,
    causando falhas intermitentes de `workspace.*`
