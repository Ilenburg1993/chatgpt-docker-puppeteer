# Arquitetura Ideal — SDK Wrapper Layer (`src/copilot/sdk/`)

**Status**: 🗺️ Visão alvo (em construção iterativa) **Última atualização**: 2026-04-27 **Autores**:
Agente Copilot + sessão de hardening profundo **Relacionados**:

- `SDK-COPILOT-ARQUITETURA-PROFUNDA.md` — visão de integração histórica
- `SDK-COPILOT-PROXIMAS-FASES.md` — roadmap de features do SDK
- `src/copilot/sdk/types.js` — SSOT de tipos (canônico)
- `src/copilot/sdk/index.js` — barrel principal (~120 exports)

---

## 1. Visão Geral e Princípio Central

> **"Nenhuma chamada ao SDK deve existir fora de um wrapper dedicado e completo."**

Este é o princípio arquitetural mais importante deste repositório em relação ao
`@github/copilot-sdk`. Toda interação com o SDK — criação de client, sessões, RPC, tools, eventos —
deve passar por um módulo wrapper que fornece:

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

| Critério                                  | Obrigatório  | Descrição                                 |
| ----------------------------------------- | ------------ | ----------------------------------------- |
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

| Módulo                               | Status      | Notas                                                                                                                 |
| ------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `sdk/types.js`                       | ✅ Completo | SSOT, strict-compliant, typedefs públicos + locais                                                                    |
| `sdk/errors.js`                      | ✅ Completo | Classificação por kind, fingerprint, `SdkOperationError`                                                              |
| `sdk/session/client.js`              | ✅ Completo | Circuit breaker, registry externalizado + recovery inicial por `SdkErrorKind`                                         |
| `sdk/session/lifecycle.js`           | ✅ Completo | create/resume/list/delete com normalização de erro + recovery curto/métricas + saneamento de `model="auto"` no resume |
| `sdk/session/session-fs.js`          | ✅ Completo | SessionFs local: config client-side, provider local e handler por sessão                                              |
| `sdk/telemetry/operation-metrics.js` | ✅ Completo | emitter injetável de métricas de operação para L1 sem dependência L1→L2                                               |
| `sdk/session/ui.js`                  | ✅ Completo | capabilities + `session.ui.elicitation/confirm/select/input`                                                          |
| `sdk/session/wrapper.js`             | ✅ Completo | abort, disconnect, sendAndWait, send, setModel com tratamento                                                         |
| `sdk/rpc/session.js`                 | ✅ Completo | model, mode, plan, workspace com retornos tipados + métricas mutadoras                                                |
| `sdk/rpc/ops.js`                     | ✅ Completo | compaction, shell, elicitation, tools, agent ops com erro normalizado                                                 |
| `sdk/rpc/server.js`                  | ✅ Completo | superfície server RPC convergida no wrapper                                                                           |
| `sdk/rpc/experimental.js`            | ✅ Completo | wrappers experimentais com `SdkOperationError`                                                                        |
| `hooks/elicitation.js`               | ✅ Completo | provider-side queue de `onElicitationRequest` com resolução externa                                                   |
| `sdk/tools/core.js`                  | ✅ Completo | createTool, createToolSync                                                                                            |
| `sdk/config.js`                      | ✅ Completo | buildSessionConfig com SessionConfigOverrides                                                                         |
| `sdk/constants.js`                   | ✅ Completo |                                                                                                                       |
| `sdk/logger.js`                      | ✅ Completo |                                                                                                                       |

### 4.2 Gaps conhecidos (a resolver no roadmap)

| Módulo                                         | Gap                                                                                                                                       | Severidade                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `sdk/session/permissions.js`                   | Hardening inicial aplicado; revisar métricas, owner e alinhamento fino com policy layer (`hooks/`)                                        | 🟡 Médio                                                |
| `sdk/session/provider.js`                      | Hardening inicial aplicado; aprofundar ownership de BYOK/session auth e integração fina com lifecycle                                     | 🟡 Médio                                                |
| `sdk/session/session-fs.js`                    | Wiring inicial + métricas L1 + gate de soberania + projeção no EventBus aplicados; decidir adapters além do provider local                | 🟡 Médio                                                |
| `sdk/session/client.js`                        | Expandir recovery por `SdkErrorKind` para fluxos vivos adicionais além de `client.connect` e do lifecycle básico                          | 🟡 Médio                                                |
| `sdk/telemetry/`                               | Expandir cobertura além de `session.ui.*`, `sendAndWait`, `setModel`, `compaction`, `ui.elicitation` e mutações principais de session RPC | 🟡 Médio                                                |
| `agent/facades/agent-sdk-access.js`            | Consolidar owner único de reads/status/server+session RPC                                                                                 | 🔄 Em progresso (owner ampliado para lifecycle/session) |
| `agent/facades/agent-sdk-session.js`           | Owner canônico de mode/plan/session ops                                                                                                   | ✅ Consolidado nesta onda                               |
| `agent/dialog/*`                               | Remover imports residuais do SDK em utilitários de loop                                                                                   | ✅ Resolvido nesta onda (loop/resume convergidos)       |
| `server/routes/sdk/session-messaging.js`       | Consolidar cobertura de testes HTTP para toda UI SDK                                                                                      | 🔄 Em progresso                                         |
| `runtime-wiring.js`                            | DI e wiring — verificar ausência de imports diretos L0                                                                                    | 🟠 Alto                                                 |
| Telemetria de observabilidade nos wrappers RPC | Nenhum wrapper RPC emite evento de métricas                                                                                               | 🔴 Importante                                           |

### 4.3 Comunicação atual entre `src/copilot/agent/` e `src/copilot/sdk/`

Hoje a comunicação `agent ↔ sdk` acontece por **quatro estilos diferentes ao mesmo tempo**:

#### A. Barrel canônico `#copilot/sdk` (o estilo correto)

Exemplos já presentes (restantes e intencionais):

- `agent/facades/agent-sdk-access.js`
  - owner canônico de reads/status/lifecycle/session wrappers
- `agent/facades/agent-sdk-session.js`
  - owner canônico de mode/plan/session ops vanilla
- `agent/facades/agent-sdk-runtime.js`
  - owner canônico de sessão ativa e waitForEvent
- `agent/ports/tool-port.js`
  - integração viva com sessionRpc/tools (seam legítimo)

Esse é o padrão alvo: o `agent` depende da superfície pública de L1 sem conhecer a topologia interna
do SDK.

#### B. Imports internos de submódulos `sdk/*` (ainda aceitáveis, mas já considerados dívida)

Este documento reconhece como **estado atual, não estado ideal**, imports como:

- `agent/messaging/agent-messaging.js`
- `agent/session/history-sync.js`
- `agent/session/keepalive.js`
- `agent/session/boot-wiring.js`
- `agent/ports/tool-port.js`

Nessa rodada, parte desses imports já foi convergida para `#copilot/sdk`, mas a auditoria deixa
explícito que qualquer novo import de `../../sdk/*` dentro de `agent/` deve ser tratado como
regressão arquitetural.

Além disso, `messaging`, `history-sync`, `keepalive`, `loop-manager` e `resume-policy` já começaram
a sair até mesmo da dependência direta do barrel do SDK, passando a consumir uma façade local
(`agent-sdk-runtime.js`) que concentra operações de sessão ativa e espera de eventos
(`waitForAgentSdkEvent`).

No eixo de ELICITATION/UI, o estado atual já cobre os dois papéis centrais documentados no README
oficial do SDK:

- **caller-side**: `session.ui.elicitation()`, `session.ui.confirm()`, `session.ui.select()` e
  `session.ui.input()` encapsulados em `sdk/session/ui.js` e promovidos até `agent/`,
  `presentation/`, `terminal/` e rotas HTTP `/sdk`.
- **provider-side**: `onElicitationRequest` encapsulado por `hooks/elicitation.js`, com fila
  pendente, resolução assíncrona e superfícies de terminal + HTTP para listar/consultar/responder
  solicitações pendentes.

#### C. Handles crus carregados no `AgentContext`

`AgentContext` continua sendo o repositório dos handles vivos do runtime:

- `client`
- `session`
- `serverRpc`
- `sessionRpc`
- `toolsRegistry`
- `permissionHandler`

Isso é inevitável no runtime, mas **não deve significar liberdade para cada módulo falar com o SDK
do seu jeito**. O problema não é o handle existir; o problema é **cada consumer construir sua
própria semântica de acesso**.

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

4. **UI / Elicitation da sessão** - `sdk/session/ui.js` (SSOT dos wrappers `session.ui.*`) -
   `hooks/elicitation.js` (provider-side queue do SDK) - `server/routes/sdk/session-messaging.js`
   (adapter HTTP para `ui/capabilities`, `ui/elicitation`, `ui/confirm`, `ui/select`, `ui/input`) -
   `terminal/commands/sdk.js` (UX de `/elicitation`, incluindo `confirm/select/input/capabilities`)

5. **Observabilidade das operações SDK**

- `sdk/telemetry/operation-metrics.js` (emitter injetável L1)
- `observability/bootstrap.js` (binding canônico do emitter para `defaultMetrics`)
- `sdk/session/ui.js`, `sdk/session/wrapper.js`, `sdk/rpc/ops.js` (operações já instrumentadas)
- `agent/context-factories.js` (provider-side `elicitation.pending/completed` instrumentado no
  runtime)

O principal problema, portanto, **não é mais crude call direta ao vendor** — isso já foi quase todo
eliminado fora de `sdk/`. O problema restante é:

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

- módulos de `agent/` fora de `facades/` e `ports/` **não** devem conhecer `sessionRpc`, `serverRpc`
  ou a topologia de `sdk/`.

#### Nível 3 — `agent/ports/*.js`

É a camada onde o `agent` liga o SDK ao resto do runtime:

- `tool-port.js` para `sessionRpc` e tools
- `hook-port.js` para hooks
- futuras portas para messaging/session-runtime se necessário

Regra:

- se uma integração depende de **estado vivo da sessão** ou de **adaptação para outro subsistema**,
  ela deve morar em `ports/`, não em módulos quentes de domínio.

### 4.6 Invariante novo da arquitetura

Além dos invariantes gerais, a fronteira `agent ↔ sdk` passa a obedecer esta regra explícita:

> **Nenhum módulo de `agent/` fora de `facades/` e `ports/` pode importar `../../sdk/*` ou
> `#copilot/sdk/*` interno.**

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

NÃO re-exportados em `dist/index.d.ts` — causam `TS2694` se importados via
`import('@github/copilot-sdk').X`:

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
| Reescrever `sdk/types.js` como SSOT completo                       | ✅     |
| Corrigir 30 erros TS2694 (tipos não-públicos)                      | ✅     |
| Adicionar `SessionConfigOverrides` para exactOptionalPropertyTypes | ✅     |
| `npm run typecheck:strict` → 0 erros                               | ✅     |
| `npm run lint` → 0 erros                                           | ✅     |

### Fase 2 — Limpeza de legado (✅ CONCLUÍDA)

| Item                                                                    | Status |
| ----------------------------------------------------------------------- | ------ |
| Remover compat shim `event-bus-observers.js`                            | ✅     |
| Remover compat shim `terminal/workspace-context.js`                     | ✅     |
| Migrar `legacy_web_fetch` → `web_fetch_local`                           | ✅     |
| Migrar `legacy_report_intent` → `report_intent_local`                   | ✅     |
| Remover rota `/telemetry` legada em `server/routes/sdk/agent.js`        | ✅     |
| Remover `DEPRECATED_CUSTOM_TOOL_NAMES` em `server/routes/sdk/client.js` | ✅     |
| Remover aliases `getDefaults`/`buildConfig` de `client-facade.js`       | ✅     |

### Fase 3 — Completar retornos tipados nos wrappers RPC (🔄 EM ANDAMENTO)

**Meta**: nenhuma função pública em `sdk/rpc/` retorna `Promise<unknown>`.

| Item                                                                                       | Status |
| ------------------------------------------------------------------------------------------ | ------ |
| Definir tipos de retorno para `rpc/ops.js` — compaction, shell, elicitation                | ✅     |
| Definir tipos de retorno para `rpc/session.js` — model, mode, plan, workspace              | ✅     |
| Definir tipos de retorno para `rpc/server.js` — status, health, port                       | ✅     |
| Adicionar try/catch padronizado em `rpc/experimental.js`                                   | ✅     |
| Fechar wrappers de `session.ui.*` (`elicitation`, `confirm`, `select`, `input`)            | ✅     |
| Verificar `sdk/session/permissions.js`, `sdk/session/provider.js` e endurecer `session-fs` | 🔄     |

### Fase 3B — Convergência explícita de `agent ↔ sdk` (🔄 EM ANDAMENTO)

**Meta**: o runtime do agente falar com o SDK por um conjunto pequeno de seams previsíveis.

| Item                                                                                          | Status                             |
| --------------------------------------------------------------------------------------------- | ---------------------------------- |
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
| Promover `session.ui.*` de L1 para `agent/presentation/terminal/server`                       | ✅                                 |
| Expor provider-side elicitation (`onElicitationRequest`) por agent/runtime/terminal/http      | ✅                                 |
| Remover conhecimento de `sessionRpc` de módulos de domínio fora de `facades/ports`            | ✅ para módulos quentes principais |
| Criar guardrail CI/grep para bloquear novos imports `agent -> sdk/*` internos                 | ✅                                 |

### Fase 4 — Observabilidade nos wrappers (🔄 EM ANDAMENTO)

**Meta**: cada wrapper RPC que representa uma operação de negócio emite um evento de métricas.

| Item                                                                              | Status                                                                           |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Definir interface `SdkOperationMetric` em `types.js`                              | ✅                                                                               |
| Introduzir emitter injetável em L1 (`sdk/telemetry/operation-metrics.js`)         | ✅                                                                               |
| Integrar emitter ao bootstrap de observabilidade                                  | ✅                                                                               |
| Emitir evento em `modelSwitchTo`, `shellExec`, `compactionCompact`, `sendAndWait` | ✅ (`modelSwitchTo`, `shellExec`, `compactionCompact` e `sendAndWait` entregues) |
| Emitir evento em `modeSet`, `planUpdate`, `planDelete`, `workspaceCreateFile`     | ✅                                                                               |
| Emitir evento em `session.ui.elicitation/confirm/select/input`                    | ✅                                                                               |
| Emitir evento em provider-side `elicitation.pending/completed`                    | ✅                                                                               |
| Integrar com observability event bus existente                                    | ⬜                                                                               |
| Dashboard: contadores de chamadas RPC por tipo                                    | ⬜                                                                               |

### Fase 5 — Auditoria de boundary (🔄 EM ANDAMENTO)

**Meta**: nenhum módulo fora de `src/copilot/sdk/` importa `@github/copilot-sdk` diretamente.

| Item                                                                   | Status                                   |
| ---------------------------------------------------------------------- | ---------------------------------------- |
| Scan automático: `check:copilot:boundary` fora de `src/copilot/sdk/`   | ✅                                       |
| Configurar ESLint `no-restricted-imports` para enforçar boundary L0→L1 | ✅                                       |
| Adicionar ao CI: falha se import direto detectado fora de `sdk/`       | 🔄 (via gate `check:copilot:guardrails`) |

### Fase 6 — Erro de domínio `SdkOperationError` (✅ CONCLUÍDA)

**Meta**: toda falha do SDK é relançada como `SdkOperationError` com kind, operação e causa.

| Item                                                                    | Status |
| ----------------------------------------------------------------------- | ------ |
| Criar classe `SdkOperationError extends Error` em `sdk/errors.js`       | ✅     |
| Adicionar `name`, `kind`, `operation`, `cause` como campos              | ✅     |
| Migrar todos os catch em wrappers RPC para usar `SdkOperationError`     | ✅     |
| Adicionar helper `toSdkOperationError()` para normalização centralizada | ✅     |
| Atualizar JSDoc de todos os wrappers: `@throws {SdkOperationError}`     | 🔄     |

### Fase 7 — Session `SdkOperationError` + recovery (⬜ PENDENTE)

**Meta**: erros de sessão classificados automaticamente disparam recovery policies.

| Item                                                                            | Status |
| ------------------------------------------------------------------------------- | ------ |
| Integrar `classifySdkError` com circuit breaker no `session/client.js`          | ⬜     |
| Políticas de retry por `SdkErrorKind` (`rate_limit` → back-off, `auth` → abort) | ⬜     |
| Integrar com watchdog agent para notificar sobre `quota_exhausted`              | ⬜     |

### Fase 8 — Guardrails de fronteira `agent ↔ sdk` (🔄 EM ANDAMENTO)

**Checkpoint atual (2026-04-26):** apenas **3 imports diretos de `#copilot/sdk`** permanecem em
`agent/**`:

- `agent/facades/agent-sdk-access.js`
- `agent/facades/agent-sdk-runtime.js`
- `agent/ports/tool-port.js`

**Meta**: institucionalizar a arquitetura para impedir regressão futura.

| Item                                                                                       | Status |
| ------------------------------------------------------------------------------------------ | ------ |
| Adicionar teste estrutural cobrando ausência de `../../sdk/*` em `agent/` fora de ports    | ✅     |
| Adicionar teste estrutural cobrando ausência de `#copilot/sdk/*` interno fora da fronteira | ✅     |
| Adicionar regra de lint/restricted-imports para `agent/**`                                 | ✅     |
| Documentar explicitamente `facades/` e `ports/` como boundary de integração com o SDK      | ✅     |
| Medir a redução de pontos de contato `agent ↔ sdk` por checkpoint                          | 🔄     |

---

## 7. Invariantes Arquiteturais (não negociáveis)

Estas regras devem ser verdadeiras em qualquer ponto do tempo, e violações devem ser detectadas pelo
CI:

1. **Crude Call Zero**: `@github/copilot-sdk` só é importado em `src/copilot/sdk/`
2. **Types SSOT**: tipos do SDK só fluem via `sdk/types.js` ou `import('@github/copilot-sdk').X` em
   `sdk/`
3. **Barrel único**: consumidores externos usam `#copilot/sdk`, nunca sub-caminhos diretos de `sdk/`
4. **Strict clean**: `npm run typecheck:strict` sempre passa com 0 erros
5. **Lint clean**: `npm run lint` sempre passa
6. **assertSession em todo wrapper de sessão**: nunca chamar `session.rpc.*` sem validação prévia
7. **Logging rastreável**: toda operação com `sessionId` loga o `sessionId`
8. **Erros classificados**: nenhum `catch (e) { throw e; }` direto — sempre classifica e
   contextualiza
9. **Fronteira agent→sdk controlada**: fora de `facades/` e `ports/`, `agent/` fala com o SDK apenas
   via barrel `#copilot/sdk`

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
- Migração de API concluída nos wrappers/consumers principais (`rpc/session`, `rpc/ops`, permissões,
  schemas HTTP)

### 10.2 Quebras relevantes da v0.3.0 absorvidas

1. **Permissões (decision kind mudou)**
   - antigo: `approved` / `denied-*`
   - novo: `approve-once`, `approve-for-session`, `approve-for-location`, `reject`,
     `user-not-available`, `no-result`
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
   - wrappers agora normalizam retorno para objetos de domínio (`{ success: true }`, `{ mode }`,
     `{}`)

5. **Renome de tipos MCP exportados no root**
   - antigo: `MCPLocalServerConfig` / `MCPRemoteServerConfig`
   - novo: `MCPStdioServerConfig` / `MCPHTTPServerConfig`
   - impacto: `sdk/types.js` (SSOT)

6. **Opção de token no client options**
   - antigo: `githubToken`
   - novo: `gitHubToken`
   - impacto: `config/client-options.js`

### 10.3 Guardrails NPM para evitar recorrência

Foram institucionalizados guardrails de instalação/resolução para evitar nova investigação longa de
"versão existe no npm mas não resolve localmente":

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

- `sdk/rpc/session.js` (`getWorkspaceRpc`) recebeu hardening para compatibilidade `workspaces`
  (v0.3.0) + `workspace` (legado)
- foi removido um pitfall de ASI em `return` com cast JSDoc multiline que podia retornar `undefined`
  em runtime, causando falhas intermitentes de `workspace.*`

### 10.6 Checkpoint complementar — ELICITATION full path (2026-04-27)

Estado complementar validado após a onda dedicada de ELICITATION/UI:

- `sdk/session/ui.js` cobre `getSessionCapabilities()`, `isSessionUiElicitationAvailable()`,
  `sessionUiElicitation()`, `sessionUiConfirm()`, `sessionUiSelect()`, `sessionUiInput()`
- `session.ui.confirm/select/input` possuem **fallback permanente** sobre
  `ui.elicitation()`/`rpc.ui.elicitation` quando a convenience API não existe no objeto `session.ui`
- `agent/facades/agent-sdk-access.js`, `AlwaysAliveAgent`, `presentation/runtime-sdk-session.js`,
  `terminal/frontend/llm-b-runtime.js` e `terminal/commands/sdk.js` promovem a feature até as
  superfícies públicas
- o adapter HTTP `/api/sdk/sessions/:id/ui/*` agora cobre:
  - `GET /ui/capabilities`
  - `POST /ui/elicitation`
  - `POST /ui/confirm`
  - `POST /ui/select`
  - `POST /ui/input`
- provider-side `onElicitationRequest` segue coberto por:
  - `hooks/elicitation.js`
  - `AgentContext.sdkElicitation`
  - `copilot-api/tasks.js` (`GET/POST /elicitation*`)

Validação executada neste checkpoint:

- `npm run typecheck:node` ✅
- lote focado de `session.ui`/agent/presentation/terminal/SDK routes ✅
  - `tests/unit/copilot/sdk/test_sdk_session_ui.spec.js`
  - `tests/unit/copilot/test_agent_sdk_access.spec.js`
  - `tests/unit/copilot/test_presentation_runtime_sdk_session.spec.js`
  - `tests/unit/copilot/test_presentation_runtime_route_deps.spec.js`
  - `tests/unit/copilot/terminal/test_commands_sdk.spec.js`
  - `tests/unit/copilot/test_terminal_runtime_frontend.spec.js`
  - `tests/unit/copilot/test_terminal_frontend_primary.spec.js`
  - `tests/unit/copilot/test_sdk_route_session_ownership.spec.js`

### 10.7 Checkpoint complementar — Observabilidade inicial dos wrappers SDK (2026-04-27)

Estado complementar validado após a primeira onda da Fase 4:

- `sdk/telemetry/operation-metrics.js` fornece um emitter injetável para L1, evitando dependência
  direta `sdk/` → `observability/`
- `observability/bootstrap.js` liga esse emitter em runtime ao `defaultMetrics`, materializando
  counters/gauges por operação SDK
- wrappers já instrumentados:
  - `sdk/session/ui.js`
  - `sdk/session/wrapper.js` (`session.sendAndWait`, `session.setModel`)
  - `sdk/rpc/ops.js` (`compactionCompact`, `shellExec`, `uiElicitation`)
  - `sdk/rpc/session.js` (`modelSwitchTo`, `modeSet`, `planUpdate`, `planDelete`,
    `workspaceCreateFile`)
- provider-side de ELICITATION também emite métricas no runtime via `agent/context-factories.js`
  (`sdk.elicitation.provider.pending/completed/action/*`)

Validação executada neste checkpoint:

- lote focado de observabilidade SDK ✅
  - `tests/unit/copilot/sdk/test_sdk_session_ui.spec.js`
  - `tests/unit/copilot/hooks/test_elicitation_handlers.spec.js`
  - `tests/unit/copilot/sdk/test_sdk_session_lifecycle.spec.js`
  - `tests/unit/copilot/sdk/test_sdk_rpc_advanced.spec.js`
  - `tests/unit/copilot/sdk/test_sdk_rpc.spec.js`
- `npm run typecheck:node` ✅
- `npm run lint` ✅

Expansão subsequente validada ainda na mesma onda:

- métricas adicionais adicionadas em `sdk/rpc/session.js` para:
  - `modeSet`
  - `planUpdate`
  - `planDelete`
  - `workspaceCreateFile`
- lote focado complementar ✅
  - `tests/unit/copilot/sdk/test_sdk_rpc.spec.js`
  - `tests/unit/copilot/sdk/test_sdk_rpc_advanced.spec.js`

### 10.8 Checkpoint complementar — Primeira onda efetiva do Bloco B (2026-04-27)

Estado complementar validado após o início da transformação concreta do programa P1:

- `sdk/session/permissions.js` passou a ter:
  - validação fail-fast de `allowTools`, `denyTools`, `denyKinds` e `denyPatterns`;
  - normalização de decisões custom booleanas / `'deny'`;
  - try/catch com `SdkOperationError` para falhas de `onRequest`;
  - logging enriquecido com `sessionId`.
- `sdk/session/provider.js` passou a ter:
  - suporte a `headers` em configs BYOK;
  - validação canônica de `baseUrl`, protocolo e strings opcionais;
  - `type: 'openai'` explícito como default em `validateProviderConfig()`;
  - rejeição de `wireApi` para Anthropic;
  - warning para `baseUrl` Azure contendo path.
- `config/session-config.js` passou a expor:
  - `gitHubToken()` para auth por sessão;
  - `createSessionFsHandler()` para session filesystem custom.
- `sdk/types.js` foi expandido com:
  - `ProviderConfig.headers`;
  - `SessionFsProvider`;
  - `CreateSessionFsHandler`.

Validação executada neste checkpoint:

- lote focado do Bloco B ✅
  - `tests/unit/copilot/sdk/test_sdk_permissions.spec.js`
  - `tests/unit/copilot/sdk/test_sdk_provider.spec.js`
  - `tests/unit/copilot/config/test_faixa_c_session_config_builder.spec.js`
- `npm run typecheck:node` ✅
- `npm run lint` ✅

### 10.9 Checkpoint complementar — Wiring inicial de SessionFs no runtime real (2026-04-27)

Estado complementar validado após a promoção concreta de `sessionFs` no runtime local:

- `boot/session-fs.js` passou a ser o owner canônico de defaults/env/paths de SessionFs;
- `sdk/session/session-fs.js` introduziu:
  - provider local baseado em `node:fs/promises`;
  - proteção contra path traversal;
  - `buildConfiguredClientSessionFsConfig()`;
  - `getConfiguredSessionIdleTimeoutSeconds()`;
  - `getConfiguredSessionFsHandler()`;
  - `createWorkspaceSessionFsHandler()`;
- `sdk/session/client-options.js` passou a promover automaticamente `sessionFs` e
  `sessionIdleTimeoutSeconds` a partir do contrato de boot;
- `agent/session/initializer.js` passou a injetar `createSessionFsHandler` configurado no fluxo real
  de `initOrResumeSession()`;
- `boot/config.js` passou a expor `sdk.sessionFs`, `sdk.sessionIdleTimeoutSeconds` e
  `paths.sessionFsRootDir` no painel canônico de boot.

Validação executada neste checkpoint:

- `npm run typecheck:strict:src.copilot` ✅
- lint/prettier focados apenas nos arquivos tocados de `src/copilot/` e docs correlatos ✅
- lote focado de testes ✅
  - `tests/unit/copilot/sdk/test_sdk_session_fs.spec.js`
  - `tests/unit/copilot/config/test_faixa_c_session_config_builder.spec.js`
  - `tests/unit/copilot/test_boot_config.spec.js`
  - `tests/unit/copilot/test_initializer_session_fs.spec.js`
  - `tests/unit/copilot/sdk/test_sdk_session_core_lifecycle.spec.js`
  - `tests/unit/copilot/sdk/test_sdk_config.spec.js`

### 10.10 Checkpoint complementar — SessionFs com observabilidade e soberania estrutural (2026-04-27)

Estado complementar validado após o endurecimento do eixo `sessionFs`:

- `sdk/session/session-fs.js` passou a emitir métricas L1 por operação para:
  - `session.fs.readFile`
  - `session.fs.writeFile`
  - `session.fs.appendFile`
  - `session.fs.exists`
  - `session.fs.stat`
  - `session.fs.mkdir`
  - `session.fs.readdir`
  - `session.fs.readdirWithTypes`
  - `session.fs.rm`
  - `session.fs.rename`
  - `session.fs.handler.create`
- as métricas incluem `sessionId` quando disponível, `durationMs` e `errorKind` nas falhas,
  alinhando SessionFs ao mesmo padrão de observabilidade L1 dos wrappers críticos do SDK;
- `scripts/check-copilot-official-seams.mjs` passou a proteger explicitamente o owner interno de
  SessionFs com a regra `non-sdk-must-not-deep-import-session-fs`;
- o contrato estrutural dessa capability passou a ser coberto por
  `tests/unit/copilot/contracts/test_sdk_boundary_block_b.spec.js`.

Validação executada neste checkpoint:

- `npm run typecheck:strict:src.copilot` ✅
- lint/prettier focados apenas nos arquivos tocados de `src/copilot/` e docs correlatos ✅
- lote focado de testes/contratos ✅
  - `tests/unit/copilot/sdk/test_sdk_session_fs.spec.js`
  - `tests/unit/copilot/contracts/test_sdk_boundary_block_b.spec.js`
  - `tests/unit/copilot/contracts/test_owner_sovereignty_block_a.spec.js`

### 10.11 Checkpoint complementar — Métricas SDK projetadas no EventBus (2026-04-27)

Estado complementar validado após a projeção do eixo `SdkOperationMetric` no runtime observável:

- `observability/sdk-metric-bridge.js` passou a ser o owner canônico da projeção de
  `SdkOperationMetric` em:
  - `MetricsStore`;
  - `EventBus` (`sdk:operation:metric`);
- `observability/bootstrap.js` deixou de manter a lógica inline de projeção de métricas do SDK e
  passou a delegá-la ao bridge dedicado;
- `observability/bus-actions/activity-tracker.js` passou a rastrear `sdk:operation:metric`,
  permitindo que a atividade do L1 apareça no snapshot de activity/tracing do runtime observacional;
- o contrato estrutural desse seam passou a ser coberto por:
  - `tests/unit/copilot/observability/test_sdk_metric_bridge.spec.js`
  - `tests/unit/copilot/test_observability_runtime_contract.spec.js`

Validação executada neste checkpoint:

- formatter/lint focados nos arquivos tocados ✅
- `npm run typecheck:strict:src.copilot` ✅
- lote focado de observabilidade SDK/EventBus ✅

### 10.12 Checkpoint complementar — Recovery inicial por `SdkErrorKind` no client SDK (2026-04-27)

Estado complementar validado após a primeira onda de W13 no boundary SDK:

- `sdk/errors.js` agora expõe `getSdkRecoveryPolicy(error, scope)` como policy estável de retry,
  reconnect, backoff e integração com circuit breaker;
- `core/circuit-breaker.js` passou a expor `guard()`, `recordSuccess()` e `recordFailure()`,
  permitindo que o owner do callsite decida quais falhas devem ou não alimentar o circuito;
- `sdk/session/client.js` integra essa policy em `getClient()`:
  - `auth`, `rate_limit` e `quota_exhausted` não abrem o circuito local;
  - `network`, `timeout` e `unknown` em escopo de conexão passam a alimentar retry/backoff e o
    breaker;
  - `client.connect` agora emite métricas L1.

Validação executada neste checkpoint:

- formatter/lint focados apenas nos arquivos tocados desta subonda ✅
- `npm run typecheck:strict:src.copilot` ✅
- lote focado de recovery/breaker/client SDK ✅
  - `tests/unit/copilot/test_core_circuit_breaker.spec.js`
  - `tests/unit/copilot/sdk/test_sdk_client.spec.js`

### 10.13 Checkpoint complementar — Recovery no lifecycle de sessão (2026-04-27)

Estado complementar validado após a expansão do W13 para o lifecycle básico:

- `sdk/session/lifecycle.js` agora integra `getSdkRecoveryPolicy(error, 'session')` em:
  - `session.create`
  - `session.resume`
- essas operações passam a emitir métricas L1 started/succeeded/failed com `attempt`, `errorKind` e
  atributos de contexto (`model`, `sessionId`, `disableResume`)
- `sdk/session/client.js` deixa de manter semântica paralela de lifecycle para:
  - `createClientSession()`
  - `resumeClientSession()` passando a reutilizar as wrappers canônicas de
    `sdk/session/lifecycle.js`

Validação executada neste checkpoint:

- formatter/lint focados apenas nos arquivos tocados desta subonda ✅
- `npm run typecheck:strict:src.copilot` ✅
- lote focado de recovery/lifecycle/session wrappers ✅
  - `tests/unit/copilot/sdk/test_sdk_session_core_lifecycle.spec.js`
  - `tests/unit/copilot/sdk/test_sdk_client.spec.js`
  - `tests/unit/copilot/sdk/test_sdk_session_registry_f26.spec.js`
  - `tests/unit/copilot/test_lib_session.spec.js`

### 10.14 Checkpoint complementar — Convergência da elegibilidade de reconnect (2026-04-27)

Estado complementar validado após a investigação do reconnect já existente no runtime:

- `agent/error-policy.js` deixa de bloquear apenas `rate_limit`/`quota` por heurística local e passa
  a derivar erros fatais de reconnect também da `SdkRecoveryPolicy` canônica
- `agent/lifecycle/reconnect-policy.js` continua owner da reconstrução da sessão viva, mas agora:
  - bloqueia reconnect quando a policy do SDK explicitamente não permite reconnect
  - usa `backoffMs` da policy SDK como floor do backoff do runtime
- `terminal/dialog/engine.js` deixa de usar apenas `isSdkQuotaOrRateLimitError()` e passa a
  consultar `getSdkRecoveryPolicy(err, 'session')` para bloquear retry de boot do dialog loop em
  cenários como `auth`, `rate_limit` e `quota_exhausted`

Leitura arquitetural deste checkpoint:

- o reconnect do `sdk/` e o reconnect do `agent/` não são a mesma coisa;
- o primeiro governa elegibilidade e recovery vanilla de baixo nível;
- o segundo governa reconstrução da sessão viva e rewire do runtime;
- a convergência aplicada aqui reduz duplicação de heurísticas sem colapsar owners legítimos.

Validação executada neste checkpoint:

- formatter/lint focados apenas nos arquivos tocados desta subonda ✅
- `npm run typecheck:strict:src.copilot` ✅
- lote focado de reconnect/agent/terminal ✅
  - `tests/unit/copilot/test_agent_error_policy.spec.js`
  - `tests/unit/copilot/test_reconnect_policy.spec.js`
  - `tests/unit/copilot/test_terminal_dialog_engine.spec.js`
  - `tests/unit/copilot/test_observability_f68_f70.spec.js`

### 10.15 Checkpoint complementar — Delimitação do lifecycle `agent` vs `sdk` (2026-04-27)

Estado complementar validado após a leitura integral de `agent/lifecycle/*`,
`agent/session/initializer.js` e `sdk/session/*` focado em lifecycle:

- a regra geral ficou explicitada como:
  - `sdk/session/*` = owner do lifecycle vanilla (`create/resume/list/delete/disconnect`)
  - `agent/` = owner da sessão viva, do wiring de runtime, do reconnect da sessão viva e da
    persistência local
- `agent/lifecycle/*` passa a tratar `CopilotClient`/`CopilotSession` como handles opacos e deixa de
  espalhar transições method-level do SDK pelo runtime
- `agent/facades/agent-sdk-access.js` agora expõe wrappers canônicos para operações cruas de client
  necessárias ao lifecycle do agent:
  - `ensureAgentSdkClientStarted()`
  - `pingAgentSdkClient()`
  - `stopAgentSdkClient()`
- esses wrappers passam a ser consumidos por:
  - `agent/lifecycle/agent-lifecycle.js`
  - `agent/lifecycle/reconnect-policy.js`
  - `agent/lifecycle/runtime-host.js`
- `agent/session/initializer.js` permanece no papel correto de owner da política de retomada da
  sessão viva, mas sem reabrir o vanilla SDK por `client.createSession()` / `client.resumeSession()`

Leitura arquitetural deste checkpoint:

- o lifecycle do `sdk` e o lifecycle do `agent` se complementam, mas não podem colapsar num único
  owner;
- o `sdk` governa transições vanilla e recovery semantics de baixo nível;
- o `agent` governa a sessão viva e a reconstrução do runtime;
- a fronteira correta entre ambos é uma façade do agent sobre a surface pública de L1, nunca
  chamadas cruas dispersas aos métodos do `CopilotClient`.

Validação executada neste checkpoint:

- formatter/lint focados apenas nos arquivos tocados desta subonda ✅
- `npm run typecheck:strict:src.copilot` ✅
- lote focado de lifecycle boundary ✅
  - `tests/unit/copilot/test_agent_sdk_access.spec.js`
  - `tests/unit/copilot/test_agent_lifecycle.spec.js`
  - `tests/unit/copilot/contracts/test_lifecycle_boundary_block_b.spec.js`

### 10.16 Checkpoint complementar — Turnos watchdog-only e saneamento de `model="auto"` (2026-04-28)

Estado complementar validado após a correção do falso timeout de `sendTurn sem progresso` no
terminal LLM-B e do bug de resume com `model="auto"`:

- `agent/dialog/turn-executor.js` agora aceita `progressSources` extras no timeout de inatividade, o
  que permite reiniciar a janela de stall com progresso vindo do host vivo do runtime, não apenas do
  emitter local do loop;
- a cadeia `terminal → presentation → channel → agent` passou a aceitar `timeout: null` como modo
  `watchdog-only`, desligando o timeout semântico curto em turnos exploratórios longos enquanto o
  watchdog do dialog loop continua como guardião de stall real;
- `sdk/session/lifecycle.js` agora saneia `model="auto"` em `resumeSession()`, omitindo também
  `reasoningEffort` enquanto não houver modelo concreto para retomar;
- `agent/session/initializer.js` passou a persistir e expor o modelo efetivo resolvido
  (`effectiveModel`) e o `reasoningEffort` efetivo, em vez de reexibir o placeholder `auto` no
  estado vivo da sessão.

Leitura arquitetural deste checkpoint:

- `auto` é uma intenção de seleção do runtime local, não um modelo válido do lifecycle vanilla do
  SDK;
- `createSession()` pode resolver `auto` antes do boundary SDK, mas `resumeSession()` não deve
  reenviá-lo ao vendor;
- turnos exploratórios longos da LLM-B não devem morrer por timeout semântico curto quando há
  progresso observável contínuo do runtime.

Validação executada neste checkpoint:

- formatter/lint focados apenas nos arquivos tocados desta subonda ✅
- `npm run typecheck:strict:src.copilot` ✅
- lote focado do timeout/modelo efetivo ✅
  - `tests/unit/copilot/test_turn_executor.spec.js`
  - `tests/unit/copilot/test_terminal_dialog_engine.spec.js`
  - `tests/unit/copilot/sdk/test_sdk_session_core_lifecycle.spec.js`
  - `tests/unit/copilot/test_initializer_session_fs.spec.js`
- validação live da LLM-B ✅
  - boot saudável em `:3009`
  - modelo ativo exposto como `gpt-5-mini` (não `auto`)
  - turno simples concluído com `timeout=none(watchdog-only)`
  - turno longo de auditoria em `src/copilot` excedendo a antiga janela de 120s sem
    `sendTurn sem progresso`

### 10.17 Checkpoint complementar — Lifecycle adjacente e keepalive sem handles crus (2026-04-28)

Estado complementar validado após a revisão de `agent/session/keepalive.js`, `cleanup.js`,
`boot-steps.js` e `boot-wiring.js`:

- `keepalive.js` deixou de tocar `client.ping()` / `session.send()` diretamente e passou a operar
  por uma única ação semântica do runtime exposta por façade (`performKeepaliveSdkTick(ctx)`);
- `agent/agent-context.js` agora injeta no keepalive apenas a ação semântica `performKeepalive`, em
  vez de fornecer handles crus de `client` e `session` ao scheduler;
- `boot-steps.js` e `agent-dialog-controller.js` passaram a receber a estratégia usada pelo
  keepalive (`client.ping` vs `session.send`) como dado observável, sem reabrir o boundary SDK;
- o gate `check-copilot-official-seams` passou a bloquear regressões em que `keepalive.js` volte a
  tocar métodos crus do SDK.

Leitura arquitetural deste checkpoint:

- `cleanup.js` pode decidir _quais_ sessões stale remover, mas pede a exclusão ao SDK por façade;
- `keepalive.js` pode decidir _quando_ manter a sessão viva, mas não _como_ invocar o SDK vanilla;
- `boot-steps.js` coordena steps operacionais do runtime;
- `boot-wiring.js` permanece como runner/pipeline e produtor de `bootReport`, não como owner do
  boundary SDK.

Validação executada neste checkpoint:

- formatter/lint focados apenas nos arquivos tocados desta subonda ✅
- `npm run typecheck:strict:src.copilot` ✅
- lote focado de lifecycle adjacente ✅
  - `tests/unit/copilot/test_keepalive.spec.js`
  - `tests/unit/copilot/contracts/test_lifecycle_boundary_block_b.spec.js`
  - `tests/unit/copilot/test_boot_wiring_pipeline.spec.js`
  - `tests/unit/copilot/test_boot_wiring_runner.spec.js`

### 10.18 Checkpoint complementar — Capability de histórico sem sondagem crua no `agent` (2026-04-28)

Estado complementar validado após a convergência do eixo `initializer/history-sync ↔ getMessages`:

- `agent/facades/agent-sdk-runtime.js` passou a expor `canReadAgentSdkSessionMessages(session)` como
  capability canônica de leitura de histórico da sessão viva;
- `agent/facades/agent-sdk-access.js` promove essa capability ao boundary principal do runtime do
  `agent`, junto com `readAgentSdkSessionMessages(session)`;
- `agent/session/initializer.js` deixou de sondar `session.getMessages` cru no health-check de
  sessões retomadas;
- `agent/session/history-sync.js` deixou de sondar `sdkSession.getMessages` cru para decidir se o
  histórico do SDK está disponível;
- `scripts/check-copilot-official-seams.mjs` passou a bloquear sondagem crua de `getMessages` em
  `agent/session/*`.

Validação executada neste checkpoint:

- formatter/lint focados apenas nos arquivos tocados desta subonda ✅
- `npm run typecheck:strict:src.copilot` ✅
- lote focado do boundary de histórico ✅
  - `tests/unit/copilot/test_agent_sdk_access.spec.js`
  - `tests/unit/copilot/test_initializer_session_fs.spec.js`
  - `tests/unit/copilot/contracts/test_lifecycle_boundary_block_b.spec.js`
  - `tests/unit/copilot/agent/test_agent_session_event_handlers.spec.js`

### 10.19 Checkpoint complementar — Runtime-state sem `state-io` inline e bridges semânticas de boot (2026-04-28)

Estado complementar validado após a continuação da limpeza entre runtime vivo do `agent` e boundary
SDK:

- `agent/facades/agent-runtime-state.js` passou a ser o owner canônico de:
  - `readAgentRuntimeSessionId(ctx)`;
  - `clearAgentRuntimePendingQuestionShadow(ctx, options)`;
- `agent/always-alive.js` deixou de tocar `readState()?.sessionId` e `persistStateWithPolicy(...)`
  inline para concerns de shadow/sessionId, passando a consumir a nouvelle façade de runtime-state;
- `agent/session/boot-steps.js` deixou de persistir o reaper da shadow expirada inline, passando a
  reutilizar a mesma façade semântica do runtime;
- `agent/facades/agent-sdk-access.js` passou a expor bridges de boot semanticamente nomeadas:
  - `attachAgentSdkBootLifecycleBridge()`;
  - `startAgentSdkBootQuotaBridge()`;
- `agent/session/boot-wiring.js` passou a usar essas bridges semânticas em vez de nomes mais baixos
  de integração do boundary SDK.

Leitura arquitetural deste checkpoint:

- `state-io` continua owner de serialização persistida, mas não deve ser conhecido inline por
  módulos de orchestration para concerns semânticos recorrentes de shadow/sessionId;
- `boot-wiring` continua owner do pipeline de boot, mas não precisa conhecer helpers baixos de
  lifecycle/quota quando pode consumir bridges explícitas de boot do boundary SDK;
- isso fortalece, ao mesmo tempo, o `sdk/` como owner do vanilla e o `agent/` como owner do runtime
  vivo sem detalhes de infra espalhados.

Validação executada neste checkpoint:

- formatter/lint focados apenas nos arquivos tocados desta subonda ✅
- `npm run typecheck:strict:src.copilot` ✅
- lote focado de runtime-state/boot boundary ✅
  - `tests/unit/copilot/test_boot_steps_shadow_reaper.spec.js`
  - `tests/unit/copilot/test_agent_runtime_state.spec.js`
  - `tests/unit/copilot/test_always_alive_delegation.spec.js`
  - `tests/unit/copilot/test_agent_sdk_access.spec.js`
  - `tests/unit/copilot/contracts/test_lifecycle_boundary_block_b.spec.js`

### 10.20 Checkpoint complementar — Dialog boot recovery sem `state-io` direto em `boot-steps` (2026-04-28)

Estado complementar validado após a continuação da limpeza do lifecycle adjacente do `agent`:

- `agent/facades/agent-runtime-state.js` passou a ser owner também de:
  - `shouldScheduleAgentRuntimeDialogBootRecovery()`;
  - `markAgentRuntimeDialogPausedForRecovery()`;
- `agent/session/boot-steps.js` deixou de tocar diretamente:
  - `readStateAsync()`;
  - `persistStateWithPolicy({ dialogPaused: true })`; para a política de dialog boot recovery;
- a decisão de **quando** agendar/tentar o recovery continua em `boot-steps.js`, enquanto a decisão
  de **como** consultar/persistir o estado para essa finalidade sobe para a façade semântica de
  runtime-state;
- `scripts/check-copilot-official-seams.mjs` passou a bloquear esse bypass com a regra
  `boot-steps-must-not-touch-state-io-for-dialog-boot-recovery`.

Leitura arquitetural deste checkpoint:

- `boot-steps.js` deve ser owner da orchestration do boot, não do detalhe baixo de serialização do
  estado persistido;
- `agent-runtime-state.js` continua se consolidando como a camada canônica para fallback persistido
  do runtime vivo;
- isso empurra o runtime do `agent` na direção das waves W18/W23 do roadmap, reduzindo acoplamento
  entre boot orchestration e `state-io`.

Validação executada neste checkpoint:

- formatter/lint focados apenas nos arquivos tocados desta subonda ✅
- `npm run typecheck:strict:src.copilot` ✅
- lote focado de runtime-state/boot recovery ✅
  - `tests/unit/copilot/test_agent_runtime_state.spec.js`
  - `tests/unit/copilot/test_boot_steps_dialog_recovery.spec.js`
  - `tests/unit/copilot/contracts/test_lifecycle_boundary_block_b.spec.js`
  - `tests/unit/copilot/test_boot_wiring_pipeline.spec.js`

### 10.21 Checkpoint complementar — `AlwaysAliveAgent` delegado a `runtime-controls` e `dialog-runtime` (2026-04-28)

Estado complementar validado após a continuação da purificação do runtime vivo do `agent`:

- `agent/always-alive.js` deixou de ler diretamente de `this.ctx` para concerns de:
  - `status`;
  - `dialogLoopActive`;
  - `queueSize`;
  - `getHandoffManager()`;
  - `pendingQuestion` e toda a família `pendingQuestionShadow*`;
- esses eixos passam a ser lidos semanticamente por:
  - `agent/facades/agent-runtime-controls.js`;
  - `agent/facades/agent-dialog-runtime.js`;
- a cadeia de tipos entre `AgentContext`, `agent-dialog-runtime.js` e
  `presentation/runtime-dialog.js` foi alinhada ao contrato real do runtime:
  - `sendDialogTurn()` resolve `Promise<string>`;
  - `timeout` pode ser `number | null`;
  - `signal` é aceito no payload do turno;
  - `pauseDialogLoop(sessionId)` usa `string | null`.

Leitura arquitetural deste checkpoint:

- `AlwaysAliveAgent` continua owner da intenção do runtime vivo, mas perde mais um bloco de detalhe
  baixo sobre leitura do contexto;
- `agent-runtime-controls` consolida-se como façade canônica para status/interaction snapshots;
- `agent-dialog-runtime` consolida-se como façade canônica para commands e snapshots do diálogo;
- isso empurra diretamente as waves W18/W21/W23 do roadmap, reduzindo o custo cognitivo do runtime
  principal.

Validação executada neste checkpoint:

- formatter/lint focados apenas nos arquivos tocados desta subonda ✅
- `npm run typecheck:strict:src.copilot` ✅
- lote focado de `AlwaysAliveAgent` / runtime-controls ✅
  - `tests/unit/copilot/test_always_alive_delegation.spec.js`
  - `tests/unit/copilot/contracts/test_lifecycle_boundary_block_b.spec.js`
  - `tests/unit/copilot/test_agent_runtime_controls.spec.js`

### 10.22 Checkpoint complementar — `AlwaysAliveAgent` delegado para governança/capabilities do runtime (2026-04-28)

Estado complementar validado na continuação da redução de acoplamento do runtime principal:

- `agent/always-alive.js` deixou de chamar diretamente `this.ctx` para:
  - `getPermissionModeSnapshot()`;
  - `setPermissionMode(...)`;
  - `getPermissionCapabilitySnapshot()`;
  - `getContextFactoryCapabilitiesSnapshot()`;
  - `getToolRegistrySnapshot()`;
  - `getToolRegistryEntriesSnapshot()`.
- o eixo foi delegado semanticamente para `agent/facades/agent-runtime-controls.js`, que agora
  também expõe:
  - `readRuntimeGovernanceState()`;
  - wrappers dedicados para permission mode/capabilities/tool registry.

Guardrail e contratos adicionados neste checkpoint:

- regra de seam oficial:
  - `always-alive-must-not-touch-ctx-runtime-governance-directly`;
- contratos e testes atualizados:
  - `tests/unit/copilot/contracts/test_lifecycle_boundary_block_b.spec.js`;
  - `tests/unit/copilot/test_always_alive_delegation.spec.js`;
  - `tests/unit/copilot/test_agent_runtime_controls.spec.js` (ampliado para
    governança/capabilities).

Leitura arquitetural deste checkpoint:

- `AlwaysAliveAgent` continua owner da intenção de runtime, mas perde mais um bloco de leitura e
  mutação de baixo nível do contexto;
- `agent-runtime-controls` passa a concentrar também o eixo de governança/capabilities, consolidando
  a superfície semântica do runtime em torno de uma façade única para controles e snapshots de alto
  nível.

### 10.23 Checkpoint complementar — `boot-steps` sem inspeção crua de shadow reaper (2026-04-28)

Estado complementar validado na continuação do cleanup de runtime-state:

- `agent/session/boot-steps.js` deixou de decidir o reap de `pendingQuestionShadow` com chamadas
  diretas a `ctx.hasPendingQuestion()` / `ctx.hasPendingQuestionShadow()` /
  `ctx.isPendingQuestionShadowExpired()`;
- essa decisão foi promovida para `agent/facades/agent-runtime-state.js` via
  `shouldReapAgentRuntimePendingQuestionShadow(ctx)`.

Guardrails e contratos deste checkpoint:

- regra de seam oficial:
  - `boot-steps-must-not-check-shadow-reaper-state-directly`;
- contratos/testes atualizados:
  - `tests/unit/copilot/contracts/test_lifecycle_boundary_block_b.spec.js`;
  - `tests/unit/copilot/test_boot_steps_shadow_reaper.spec.js`;
  - `tests/unit/copilot/test_agent_runtime_state.spec.js`.

Leitura arquitetural:

- `boot-steps` avança para papel de orquestrador de pipeline;
- `agent-runtime-state` concentra a regra semântica de estado da shadow persistida;
- o eixo de estado persistido continua saindo de chamadas ad hoc para façades explícitas.
