# PARTE-17A — Análise Arquitetural Profunda: Situação Atual

**Data**: 2026-03-20 (rev.3 — análise arquitetural completa) **Escopo**: TODO `src/copilot/` (263
arquivos, ~46.525 linhas) **SDK oficial**: `@github/copilot-sdk@0.2.0` (instalado) | `0.2.1` (NPM
latest) **Autor**: Auditoria automatizada PARTE-17

---

## Sumário Executivo

A análise profunda de todos os 263 arquivos de `src/copilot/` revela uma arquitetura que cresceu
organicamente em torno de um SDK wrapper (`sdk/`) que deveria ser o gateway único para
`@github/copilot-sdk`, mas que na prática é **contornado por 20+ arquivos que importam diretamente
do SDK**. O resultado é uma arquitetura com **dois caminhos de configuração**, **dois registros de
sessão**, **dois sistemas de tipos para hooks**, e **nenhuma fachada unificada** que garanta
consistência.

A centralização proposta na PARTE-17B é viável porque a superfície real do SDK usada pelo projeto é
relativamente pequena (~12 símbolos distintos), e o wrapper já existe — precisa ser completado e
tornado obrigatório.

---

## §1. Mapa Arquitetural Completo de `src/copilot/`

### 1.1 Módulos e Escala

| Módulo              | Arquivos |      Linhas | Responsabilidade Principal                                        |
| ------------------- | -------: | ----------: | ----------------------------------------------------------------- |
| `agent/`            |       52 |     ~10.200 | AlwaysAliveAgent, lifecycle, dialog loop, session mgmt, infra     |
| `tools/`            |      ~40 |      ~6.195 | Custom tools (15 categorias), tool-factory, session-rpc           |
| `terminal/`         |      ~50 |      ~5.000 | CLI REPL, handlers, formatters                                    |
| `observability/`    |       21 |      ~4.458 | OTel, event-collector, metrics, tool-stats, error-tracking        |
| `hooks/`            |       19 |      ~3.499 | Hook factory, bus, registry, presets, types, permission, composer |
| `sdk/`              |       20 |      ~3.252 | SDK wrapper: client, session, tools-registry, models, agents      |
| `api/`              |       21 |      ~3.233 | Express routes, bridge HTTP→agent, SSE, session-crud              |
| `conversation-hub/` |       10 |      ~2.487 | Hub de conversação, store, orquestrador, socket.io                |
| `bridges/`          |       10 |      ~2.183 | NERV bridge, MCP tool bridge, git bridge, GitHub MCP              |
| `channel/`          |        7 |      ~1.497 | Injeção HTTP, SDK client mode, SSE streaming                      |
| `config/`           |        6 |      ~1.415 | env SSOT, session-config builders, system-prompt, custom-agents   |
| `core/`             |       14 |      ~1.400 | Errors, events, schemas, sdk-types, utils, abort, circuit-breaker |
| `audit/`            |        4 |        ~753 | Pipeline JSONL, ring-buffer, audit writers                        |
| `db/`               |        3 |        ~411 | SQLite persistence, migrations                                    |
| **TOTAL**           |  **263** | **~46.525** |                                                                   |

### 1.2 Grafo de Dependências de Alto Nível

```
┌──────────────────────────────────────────────────────────┐
│                    @github/copilot-sdk                    │
│  (CopilotClient, CopilotSession, defineTool, approveAll, │
│   SYSTEM_PROMPT_SECTIONS, SessionConfig, types...)        │
└────────┬───────────────┬──────────────────────┬──────────┘
         │ WRAPPER PATH  │ BYPASS PATH (20 files)│
    ┌────▼────┐     ┌────▼────────────────┐     │
    │ sdk/    │     │ tools/* (11 files)  │     │
    │ client  │     │ → defineTool       │     │
    │ session │     ├────────────────────┤     │
    │ tools-  │     │ config/* (2 files) │     │
    │ registry│     │ → approveAll,      │     │
    │ models  │     │   SYSTEM_PROMPT_*  │     │
    │ agents  │     ├────────────────────┤     │
    │ utils   │     │ hooks/* (1 file)   │     │
    └────┬────┘     │ → approveAll       │     │
         │          ├────────────────────┤     │
    ┌────▼────┐     │ agent/* (3 files)  │     │
    │ config/ │     │ → CopilotClient,   │     │
    │ hooks/  │◄────┤   approveAll       │     │
    │ agent/  │     ├────────────────────┤     │
    │ api/    │     │ api/* (1 file)     │     │
    │ bridges/│     │ → approveAll       │     │
    │ channel/│     ├────────────────────┤     │
    └─────────┘     │ bridges/* (1 file) │     │
                    │ → defineTool       │     │
                    ├────────────────────┤     │
                    │ audit/* (1 file)   │     │
                    │ → approveAll       │     │
                    └────────────────────┘     │
```

---

## §2. Inventário do SDK Layer (`sdk/`)

### 2.1 Arquivos e Funções Exportadas

| Arquivo                    |     Linhas | Exports Públicas                                                                                                                                                                                                            |  Wrap SDK?   |
| -------------------------- | ---------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------: |
| `sdk/index.js`             |        119 | Barrel: re-exporta ~70 símbolos dos sub-módulos                                                                                                                                                                             |      —       |
| `sdk/client.js`            |        414 | `getClient`, `stopClient`, `forceStopClient`, `buildClientOptions`, session CRUD (6), state/diag (5), test helpers (2)                                                                                                      |      ✅      |
| `sdk/session.js`           |        300 | `buildSessionConfig`, `createSession`, `resumeSession`, `resumeOrCreate`, `listSessions`, `deleteSession`, `disconnectSession`, `createClientFromCliUrl`                                                                    |      ✅      |
| `sdk/agents.js`            |        175 | `buildAgentList`, `createAgent`, `createReadOnlyAgent`, `createFullAccessAgent`, `createAnalystAgent`, `filterInferableAgents`, `isValidAgentName`, `READ_ONLY_TOOLS`                                                       |      ✅      |
| `sdk/tools-registry.js`    |        262 | `createRegistry`, `registerTool/Tools`, `getToolByName`, `getAllTools`, `filterByNames`, `excludeByNames`, `getToolsByCategory/Tag`, `mergeRegistries`, `inspectRegistry`, `listToolNames`, `hasToolByName`, `getToolCount` |      ✅      |
| `sdk/event-helpers.js`     |        140 | `waitForEvent`, `raceEvents`                                                                                                                                                                                                |      ✅      |
| `sdk/agent-contract.js`    |         76 | `AgentPlugin` typedef                                                                                                                                                                                                       | Apenas tipos |
| `sdk/bridge-contract.js`   |         55 | `EventBridge`, `ToolBridge`, `CommandBridge` typedefs                                                                                                                                                                       | Apenas tipos |
| `sdk/channel-contract.js`  |         55 | `ChannelPlugin` typedef                                                                                                                                                                                                     | Apenas tipos |
| `sdk/custom-tools.js`      |        327 | `BUILTIN_HANDLER_MAP`, `getCustomToolDefinitions`, `loadCustomTools`, `registerCustomTool`, `removeCustomTool`                                                                                                              |   Parcial    |
| `sdk/http-request.js`      |         61 | `httpRequest`                                                                                                                                                                                                               |      ✅      |
| `sdk/url-validator.js`     |        100 | `validateUrl`, `validateUrlString`                                                                                                                                                                                          |      ✅      |
| `sdk/tools-state.js`       |        151 | `getToolsConfig`, `loadToolsConfig`, `patchToolsConfig`                                                                                                                                                                     |      ✅      |
| `sdk/utils.js`             |         37 | `pickDefined`                                                                                                                                                                                                               |      ✅      |
| `sdk/models/` (5 arquivos) |        980 | `ModelRegistry`, `ModelSelector`, `ModelStatsTracker`, `AutoDowngradeDetector`, `listModels`, `pickModel`, `buildReasoningConfig`, `resolveModelId`, `getModelById`, etc.                                                   |      ✅      |
| **Total**                  | **~3.252** |                                                                                                                                                                                                                             |              |

### 2.2 Símbolos SDK Usados pelo Projeto (Catálogo Completo)

| Símbolo SDK               | Tipo               | Usado por (arquivos fora de sdk/)                                                                          |      No wrapper?       |
| ------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------- | :--------------------: |
| `CopilotClient`           | Classe/Construtor  | `agent-lifecycle.js`, `entry.js`                                                                           |  ✅ (via `getClient`)  |
| `CopilotSession`          | Tipo               | Usado em JSDoc por ~30 arquivos                                                                            | ✅ (tipo re-exportado) |
| `SessionConfig`           | Tipo               | Usado em JSDoc por `session.js`, `initializer.js`                                                          | ✅ (tipo re-exportado) |
| `approveAll`              | Função/PermHandler | `session-config.js`, `permission-handler.js`, `permission-controller.js`, `session-crud.js`, `pipeline.js` |           ❌           |
| `defineTool`              | Função             | `tool-factory.js`, 10 tool files, `mcp-tool-bridge.js`                                                     |           ❌           |
| `SYSTEM_PROMPT_SECTIONS`  | Constante          | `system-prompt.js`                                                                                         |           ❌           |
| `SessionListFilter`       | Tipo               | `session-crud.js`                                                                                          |    ❌ (tipo apenas)    |
| `PermissionHandler`       | Tipo               | `session-config.js`, `permission-handler.js`                                                               |    ❌ (tipo apenas)    |
| `PermissionRequest`       | Tipo               | `permission-handler.js`, `permission-controller.js`                                                        |    ❌ (tipo apenas)    |
| `PermissionRequestResult` | Tipo               | `permission-handler.js`                                                                                    |    ❌ (tipo apenas)    |
| `Tool` / `ToolHandler`    | Tipo               | `tool-factory.js`, vários tools                                                                            |    ❌ (tipo apenas)    |
| `MessageOptions`          | Tipo               | `always-alive.js`                                                                                          |    ❌ (tipo apenas)    |

**Resultado**: dos 12 símbolos runtime (não tipos) importados, apenas 3 passam pelo wrapper
(`CopilotClient` via `getClient`, `CopilotSession` via create/resume, event helpers). Os 3 mais
usados (`defineTool`, `approveAll`, `SYSTEM_PROMPT_SECTIONS`) são importados diretamente em 20
arquivos.

---

## §3. Problemas Arquiteturais Identificados (Taxonomia)

### 🔴 P1 — Dois Caminhos de Configuração de Sessão (CRÍTICO)

**Localização**: `sdk/session.js` vs `config/session-config.js` vs `agent/session/initializer.js`

Existem TRÊS camadas que constroem configuração de sessão, cada uma incompleta:

| Camada                                                   | Aceita                                                                                                                                                     | Não aceita                                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `sdk/session.js` → `buildSessionConfig()`                | model, reasoning, workingDir, mcpServers, customAgents, hooks, tools, streaming, infiniteSessions, systemMessage, onPermission, onUserInput, disableResume | availableTools, excludedTools, skillDirectories, onEvent, clientName, configDir |
| `config/session-config.js` → `buildAlwaysAliveConfig()`  | model, tools, onPermission, onUserInput, hookContext                                                                                                       | tudo acima exceto o que lista                                                   |
| `agent/session/initializer.js` → `initOrResumeSession()` | **TUDO** — constrói manualmente o config completo                                                                                                          | —                                                                               |

**Fluxo real**: `session-setup.js` → `buildSessionOptions()` → `initOrResumeSession()` →
`resumeOrCreate()` → `buildSessionConfig()` → `client.startSession()`. O `buildAlwaysAliveConfig()`
de `config/session-config.js` **NÃO é chamado neste fluxo** — é dead code para o agente principal.

**Impacto**: Qualquer change no config builder do SDK (`buildSessionConfig`) NÃO afeta o agente, que
constrói o config em `initializer.js` diretamente. Campo novo no SDK requer mudança manual em 2+
lugares.

### 🔴 P2 — Dois Registros de Sessão Paralelos (CRÍTICO)

**Localização**: `sdk/client.js` (registry `_sessions` Map) vs `sdk/session.js` (stateless)

| Caminho          | Quem usa           | Registry?          | Criação                                          |
| ---------------- | ------------------ | ------------------ | ------------------------------------------------ |
| `sdk/client.js`  | API Express routes | ✅ `_sessions` Map | `createClientSession()` → registra na Map        |
| `sdk/session.js` | Agent layer        | ❌ stateless       | `createSession()` → não registra em nenhum lugar |

**Consequência**: O agente cria sessões via `sdk/session.js` que **não aparecem** no registry de
`sdk/client.js`. As rotas de API (`GET /sessions/active`) não listam a sessão do agente. O
`listActiveClientSessions()` retorna lista incompleta.

```
Agent Session → criada via resumeOrCreate(client, id, opts) → NÃO registrada em _sessions
API Sessions  → criadas via createClientSession(config)      → REGISTRADAS em _sessions
```

### 🔴 P3 — Config Barrel Viola Fronteiras de Módulo (ALTO)

**Localização**: `config/index.js`

```javascript
// config/index.js re-exporta DIRETAMENTE de módulos SDK:
export {
  BUILTIN_HANDLER_MAP,
  getCustomToolDefinitions,
  loadCustomTools,
  registerCustomTool,
  removeCustomTool,
} from '#copilot/sdk/custom-tools';
export { getToolsConfig, loadToolsConfig, patchToolsConfig } from '#copilot/sdk/tools-state';
```

**Impacto**: Consumidores que importam de `#copilot/config` recebem funções que pertencem à camada
SDK. Isso:

- Impede refatoração limpa (mover custom-tools para outro módulo quebra config/)
- Cria acoplamento bidirecional config ↔ sdk
- Confunde a semântica de "configuração" com "estado de runtime de tools"

### 🔴 P4 — Sistema de Tipos Paralelo para Hooks (ALTO)

**Localização**: `hooks/types.js` (309 linhas) vs tipos oficiais do SDK

O `hooks/types.js` define seus próprios:

- `SessionHooks` — 6 hooks com assinaturas custom
- `PreToolUseHandler`, `PostToolUseHandler`, etc.
- `HooksConfig`, `PermissionHandlerConfig`
- `InvocationContext`, `HookBusEvent`, `HookSchema`

Estes NÃO são importados do SDK. São definições paralelas que **podem divergir** quando o SDK
atualiza suas interfaces. Exemplo: se o SDK adicionar um campo `toolInvocationId` ao
`PreToolUseHookInput`, o `hooks/types.js` local não refletirá essa mudança.

### 🟡 P5 — `defineTool` Usado Diretamente em 11+ Arquivos (MÉDIO)

**Localização**: `tools/*.js`, `bridges/mcp-tool-bridge.js`

| Arquivo                        | Usa `buildTool`? | Usa `defineTool` direto? |
| ------------------------------ | :--------------: | :----------------------: |
| `tools/tool-factory.js`        |   ✅ (define)    |       ✅ (interno)       |
| `tools/git/index.js`           |        ❌        |            ✅            |
| `tools/shell/index.js`         |        ❌        |            ✅            |
| `tools/session-tools.js`       |        ❌        |            ✅            |
| `tools/session-rpc-tools.js`   |        ❌        |            ✅            |
| `tools/task-tools.js`          |        ❌        |            ✅            |
| `tools/todo/crud-tools.js`     |        ❌        |            ✅            |
| `tools/todo/bulk-tools.js`     |        ❌        |            ✅            |
| `tools/todo/query-tools.js`    |        ❌        |            ✅            |
| `tools/introspection-tools.js` |        ❌        |            ✅            |
| `bridges/mcp-tool-bridge.js`   |        ❌        |            ✅            |

O `buildTool` do `tool-factory.js` foi criado como wrapper canônico (adiciona logging, normaliza Zod
schemas), mas a maioria das tools ignora o wrapper e usa `defineTool` diretamente. As tools que usam
`defineTool` diretamente:

- Não têm logging automático de invocação
- Não têm normalização Zod→JSON Schema consistente
- Precisam importar `defineTool` de `@github/copilot-sdk` (bypass)

### 🟡 P6 — `approveAll` Importado de 5 Módulos Independentes (MÉDIO)

```
config/session-config.js    → import { approveAll } from '@github/copilot-sdk'
hooks/permission-handler.js → import { approveAll } from '@github/copilot-sdk'
agent/infra/permission-controller.js → import { approveAll } from '@github/copilot-sdk'
api/express/session-crud.js → import { approveAll } from '@github/copilot-sdk'
audit/pipeline.js           → import { approveAll } from '@github/copilot-sdk'
```

`approveAll` deveria ser re-exportado do wrapper SDK para que possa ser substituído por um
mock/telemetry wrapper sem tocar 5 arquivos.

### 🟡 P7 — CopilotClient Instanciado Diretamente no Agent (MÉDIO)

**Localização**: `agent/lifecycle/agent-lifecycle.js` linha 97

```javascript
const client = new CopilotClient(...(_otelConfig ? [{ telemetry: _otelConfig }] : []));
```

Em vez de usar `getClient()` do wrapper (que é singleton com anti-retry-storm), o lifecycle cria uma
instância nova diretamente. Isso significa:

- O singleton de `sdk/client.js` e o client do agent são **instâncias diferentes**
- As sessões criadas pelo agent via `resumeOrCreate()` não passam pelo registry do singleton

### 🟡 P8 — API Routes Usam Features Não-Wrapped (MÉDIO)

As rotas de API precisam de features do SDK client que o wrapper NÃO expõe:

| Feature SDK                         | Usado em          |                          No wrapper?                           |
| ----------------------------------- | ----------------- | :------------------------------------------------------------: |
| `client.getLastSessionId()`         | `session-crud.js` |                               ❌                               |
| `client.getForegroundSessionId()`   | `session-crud.js` |                               ❌                               |
| `client.setForegroundSessionId(id)` | `session-crud.js` |                               ❌                               |
| `client.listSessions(filter)`       | `session-crud.js` | ❌ (wrapper tem `listSessions` mas via session.js, não client) |
| `client.on('session.created')`      | `boot-wiring.js`  |                               ❌                               |
| `client.on('session.deleted')`      | `boot-wiring.js`  |                               ❌                               |

Para acessar essas features, os routes chamam `getClient()` e depois acessam `.getLastSessionId()`
etc. diretamente no objeto client retornado — semi-bypass.

### 🟢 P9 — `SYSTEM_PROMPT_SECTIONS` Importado Diretamente (BAIXO)

Apenas `config/system-prompt.js` usa esta constante. Fácil centralizar.

### 🟢 P10 — `core/sdk-types.js` Duplica Types (BAIXO)

o `core/sdk-types.js` (112 linhas) re-exporta tipos do SDK como JSDoc typedefs. Ao mesmo tempo,
`hooks/types.js` (309 linhas) define tipos paralelos. Não há uma única fonte canônica de tipos SDK
para o projeto.

---

## §4. Fluxo de Dados Completo — Boot do Agente até Session Ativa

```
1. entry.js
   └─ main() chamado (process entry point)

2. agent-lifecycle.js::agentStart(ctx, host)
   ├─ buildTelemetryConfig() → {tracerProvider?, enabled}
   ├─ new CopilotClient({telemetry}) ⚠️ BYPASS: instância direta
   ├─ ctx.client = client
   │
   ├─ initSession(ctx, client, host)
   │  ├─ session-setup.js::buildSessionTools(ctx)
   │  │  ├─ mcp-tool-bridge.js::buildMcpTools()
   │  │  ├─ sdk/tools-registry.js::createRegistry() → ctx.toolsRegistry
   │  │  └─ tools-bootstrap.js::bootstrapTools(registry, mcpTools)
   │  │     └─ 15 categorias de tools registradas + wrapWithStats
   │  │
   │  ├─ session-setup.js::buildSessionHooks(ctx, host)
   │  │  ├─ hooks/session-lifecycle.js::createSessionHooks({callbacks})
   │  │  ├─ hooks/factory.js::createHooks({auditLog, sessionStart, sessionEnd, onError})
   │  │  └─ hooks/bus.js::attachBus(hooks) → busHooks
   │  │
   │  ├─ session-setup.js::buildSessionOptions(ctx, host, {tools, busHooks})
   │  │  └─ Retorna: {model, onPermission, onUserInput, hooks, tools, mcpServers, reasoning, injectHookContext}
   │  │
   │  ├─ initializer.js::initOrResumeSession(client, options)
   │  │  ├─ ⚠️ CONSTRÓI CONFIG MANUALMENTE:
   │  │  │  {model, streaming, infiniteSessions, workingDirectory, skillDirectories,
   │  │  │   excludedTools, availableTools, reasoningEffort, onUserInput, hooks, tools,
   │  │  │   mcpServers, systemMessage, onPermissionRequest, customAgents}
   │  │  ├─ _validateSessionForResume(savedId, lastActivity)
   │  │  ├─ rotation.js::shouldRotateSession(ctx)
   │  │  └─ sdk/session.js::resumeOrCreate(client, savedId, opts)
   │  │     └─ buildSessionConfig(opts, mode) → client.startSession(config)
   │  │        ⚠️ buildSessionConfig DESCARTA campos que não conhece!
   │  │
   │  └─ session-setup.js::finalizeSessionInit(ctx, session, isResumed)
   │     └─ ctx.session = session; setSessionRpc(session.rpc)
   │
   ├─ boot-wiring.js::performBootWiring(client, session, isResumed, emitter, ctx)
   │  ├─ wireSessionEvents(session, isResumed, callbacks) → 8 event handler files
   │  ├─ defaultEventCollector.attach(session) → observability unsubs
   │  ├─ client.on('session.created'), client.on('session.deleted') ⚠️ BYPASS: .on() direto
   │  ├─ cleanupStaleSessions(client)
   │  ├─ metrics timer, MCP auto-reconnect, keepalive start
   │  └─ dialog loop restore (if was active before restart)
   │
   └─ host.emit('ready', {sessionId, isResumed})
```

### 4.1 Fluxo de Dados — API Route `POST /sessions`

```
1. api/express/session-crud.js → POST /sessions
   ├─ validateBody(CreateSessionBodySchema)
   ├─ validateModel(model)
   └─ sdk/client.js::createClientSession(config)
      ├─ getClient() → singleton CopilotClient
      ├─ config passado direto (model, sessionId, systemMessage, infiniteSessions,
      │  workingDirectory, streaming, provider, reasoningEffort, availableTools,
      │  excludedTools, customAgents, clientName)
      ├─ client.startSession(config) ⚠️ NÃO PASSA POR buildSessionConfig()
      └─ Registra em _sessions Map (client.js interno)
```

**Observação CRÍTICA**: A rota `POST /sessions` NÃO usa `buildSessionConfig()` nem nenhum config
builder. O JSON do body é passado **diretamente** para `client.startSession()` com apenas
`onPermissionRequest: approveAll` adicionado. Não há:

- `infiniteSessions.backgroundCompactionThreshold` padronizado
- `skillDirectories` aplicado
- `excludedTools` defaults aplicados
- `hooks` injetados
- `systemMessage` com hook context

### 4.2 Fluxo de Dados — sendMessage

```
1. AlwaysAliveAgent.sendMessage(msg, opts)
   └─ agent-messaging.js::msgSend(ctx, agent, msg, opts)
      └─ ctx.session.sendAndWait(msg, {timeoutMs, attachments, signal})
         └─ SDK CopilotSession.sendAndWait() → model response
```

Este fluxo é limpo — passa pela sessão SDK corretamente.

---

## §5. Catálogo de Bypass — Todos os Pontos de Importação Direta

### 5.1 `defineTool` (11 arquivos)

| Arquivo                        | Usa `buildTool` wrapper? | Consequência do bypass                        |
| ------------------------------ | :----------------------: | --------------------------------------------- |
| `tools/tool-factory.js`        |     ✅ (é o wrapper)     | Internamente usa `defineTool` — necessário    |
| `tools/git/index.js`           |            ❌            | Sem logging, sem Zod normalization            |
| `tools/shell/index.js`         |            ❌            | Sem logging, sem Zod normalization            |
| `tools/session-tools.js`       |            ❌            | Sem logging auto                              |
| `tools/session-rpc-tools.js`   |            ❌            | Sem logging auto                              |
| `tools/task-tools.js`          |            ❌            | Sem logging auto                              |
| `tools/todo/crud-tools.js`     |            ❌            | Sem logging auto                              |
| `tools/todo/bulk-tools.js`     |            ❌            | Sem logging auto                              |
| `tools/todo/query-tools.js`    |            ❌            | Sem logging auto                              |
| `tools/introspection-tools.js` |            ❌            | Sem logging auto                              |
| `bridges/mcp-tool-bridge.js`   |            ❌            | Sem logging auto, MCP tools escapam do padrão |

### 5.2 `approveAll` (5 arquivos)

| Arquivo                                | Contexto de uso                                 |
| -------------------------------------- | ----------------------------------------------- |
| `config/session-config.js`             | `buildAlwaysAliveConfig()` — usado como default |
| `hooks/permission-handler.js`          | Fallback quando `allowAll: true`                |
| `agent/infra/permission-controller.js` | Default handler no `PermissionController`       |
| `api/express/session-crud.js`          | Default para novas sessões via API              |
| `audit/pipeline.js`                    | `buildAuditingPermissionHandler(base)`          |

### 5.3 `CopilotClient` (2 arquivos)

| Arquivo                              | Contexto de uso                                     |
| ------------------------------------ | --------------------------------------------------- |
| `agent/lifecycle/agent-lifecycle.js` | `new CopilotClient({telemetry})` — instância direta |
| `agent/lifecycle/entry.js`           | Tipo import para anotação                           |

### 5.4 `SYSTEM_PROMPT_SECTIONS` (1 arquivo)

| Arquivo                   | Contexto de uso                                 |
| ------------------------- | ----------------------------------------------- |
| `config/system-prompt.js` | Acessa `SDK_SECTIONS` para montar systemMessage |

---

## §6. Componentes por Camada — Integração com SDK

### 6.1 Agent Layer — O Principal Consumidor

O `agent/` é o maior módulo (52 files, ~10.200 lines) e o principal consumidor do SDK. Seu fluxo:

```
AgentContext (agent-context.js)
  ├─ client: CopilotClient | null
  ├─ session: CopilotSession | null
  ├─ toolsRegistry: ToolRegistry
  ├─ messageQueue: MessageQueue
  ├─ dialogLoop: DialogLoopManager
  ├─ permissions: PermissionController
  ├─ webhooks: WebhookManager
  ├─ keepalive: SessionKeepalive
  ├─ handoff: HandoffManager
  └─ messagesCache: SessionMessagesCache

AlwaysAliveAgent (always-alive.js) — ~620L, singleton
  ├─ extends EventEmitter
  ├─ Delegates to: agent-lifecycle.js (start/stop/reconnect)
  ├─ Delegates to: agent-messaging.js (send/steer/answer)
  ├─ Delegates to: agent-state.js (snapshot/diagnostics)
  ├─ Delegates to: dialog/loop-manager.js (dialog lifecycle)
  └─ Queue processing: executeTask → session.sendAndWait()
```

**SDK integration points no agent**:

1. `CopilotClient` criado em `agent-lifecycle.js` (bypass — `new CopilotClient`)
2. `session.sendAndWait()` chamado em messaging
3. `session.on()` wired em `event-wirer.js` (8 handler files)
4. `session.rpc` exposto via `setSessionRpc()` para RPC tools
5. `client.on('session.created'/'deleted')` wired em `boot-wiring.js`
6. `session.log()` chamado em `AlwaysAliveAgent.sessionLog()`
7. `session.disconnect()` chamado no `agentStop()`
8. `client.stop()` chamado no `agentStop()`

### 6.2 Hooks Layer — Parallel Type System

O `hooks/` (19 files, ~3.499 lines) opera com tipos próprios definidos em `hooks/types.js`:

- `SessionHooks` (6 slots) — mapeia 1:1 com o SDK, mas com assinaturas customizadas
- `HooksConfig` — aceita mais opções que o SDK (bus, argsModifier, etc.)
- `HookBus` — sistema de observação sem equivalente no SDK
- `HookRegistry` — metadados dos hooks sem equivalente no SDK

O `createHooks(config)` do `hooks/factory.js` é o builder canônico. Ele constrói objetos
`SessionHooks` compatíveis com o SDK, mas com lógica adicional (audit logging, deny/allow lists, bus
emission).

### 6.3 Tools Layer — Split Pattern

O `tools/` (~40 files, ~6.195 lines) tem um split claro:

- `tool-factory.js` define `buildTool()` como wrapper canônico de `defineTool`
- Apenas `code-tools.js`, `file-read-tools.js`, `file-write-tools.js`, `web-tools.js`,
  `hub-tools.js`, `permission-tools.js`, `hook-tools.js` usam `buildTool()`
- Os demais 10 arquivos usam `defineTool` diretamente

Todas as tools passam por `bootstrapTools()` → `wrapWithStats()` para instrumentação, independente
de como são criadas.

### 6.4 API Layer — Semi-Bypass

O `api/` (21 files, ~3.233 lines) tem dois caminhos:

1. **Bridge routes** (`/api/copilot/*`): delegam para `alwaysAliveAgent` — NÃO acessam SDK
2. **SDK routes** (`/api/sdk/*`): acessam SDK via wrapper `#copilot/sdk/client` — mas usam features
   não-wrapped

### 6.5 Observability — Event Collector Acoplado

O `observability/` (21 files, ~4.458 lines) se integra com o SDK via:

- `defaultEventCollector.attach(session, sessionId)` — registra listeners nos 70+ event types da
  sessão
- `wrapWithStats(tool)` — instrumenta tools com latência/contagem
- `buildTelemetryConfig()` — constrói config OTel para `new CopilotClient({telemetry})`
- `startSpan()` / `startSpanImmediate()` — wraps para OTel tracing

Nenhum destes passa pelo wrapper SDK — todos operam diretamente sobre os objetos `CopilotSession` e
`CopilotClient`.

### 6.6 Bridges — MCP Tool Bridge

O `bridges/` (10 files, ~2.183 lines) tem uma integração SDK relevante:

- `mcp-tool-bridge.js` usa `defineTool` diretamente para criar wrappers de MCP tools
- `nerv-bridge.js` mapeia 55+ event types do SDK para o event bus NERV do projeto

---

## §7. Análise de SessionConfig — Campos Suportados

### 7.1 Campos Aceitos pelo SDK (SessionConfig oficial)

Baseado nos tipos oficiais (`@github/copilot-sdk/dist/types/session.d.ts`):

| Campo                  | Em `buildSessionConfig`? | Em `initializer.js`? | Em API `POST /sessions`? |
| ---------------------- | :----------------------: | :------------------: | :----------------------: |
| `model`                |            ✅            |          ✅          |            ✅            |
| `sessionId`            |            ❌            |          ❌          |            ✅            |
| `streaming`            |            ✅            |          ✅          |            ✅            |
| `infiniteSessions`     |            ✅            |          ✅          |            ✅            |
| `workingDirectory`     |            ✅            |          ✅          |            ✅            |
| `skillDirectories`     |            ❌            |          ✅          |            ❌            |
| `excludedTools`        |            ❌            |          ✅          |            ✅            |
| `availableTools`       |            ❌            |          ✅          |            ✅            |
| `customAgents`         |            ✅            |          ✅          |            ✅            |
| `mcpServers`           |            ✅            |          ✅          |            ❌            |
| `hooks`                |            ✅            |          ✅          |            ❌            |
| `tools`                |            ✅            |          ✅          |            ❌            |
| `systemMessage`        |            ✅            |          ✅          |            ✅            |
| `onPermissionRequest`  |            ✅            |          ✅          |    ✅ (`approveAll`)     |
| `onUserInputRequest`   |            ✅            |          ✅          |            ❌            |
| `reasoningEffort`      |            ✅            |          ✅          |            ✅            |
| `disableResume`        |            ✅            |          ❌          |            ❌            |
| `onEvent`              |            ❌            |          ❌          |            ❌            |
| `onElicitationRequest` |            ❌            |          ❌          |            ❌            |
| `commands`             |            ❌            |          ❌          |            ❌            |
| `clientName`           |            ❌            |          ❌          |            ✅            |
| `configDir`            |            ❌            |          ❌          |            ❌            |
| `provider`             |            ❌            |          ❌          |            ✅            |

### 7.2 Campos Perdidos na Cadeia

- `skillDirectories`, `excludedTools`, `availableTools` são adicionados pelo `initializer.js`
  **DEPOIS** de `buildSessionConfig()` — o builder SDK os descarta, mas como `initializer.js`
  constrói opts manualmente e passa para `resumeOrCreate()` que chama `client.startSession(opts)`
  diretamente (o `buildSessionConfig` é meramente um helper de defaults), na prática eles
  **funcionam**. O problema é que o helper `buildSessionConfig` tem interface incompleta.

- `onEvent`, `commands`, `configDir` — não usados por nenhum caminho. Features SDK completamente
  ignoradas.

---

## §8. Resumo de Achados por Severidade

| ID  | Severidade | Achado                                                          | Arquivos Impactados |
| --- | :--------: | --------------------------------------------------------------- | :-----------------: |
| P1  | 🔴 CRÍTICO | Dois caminhos de config: buildSessionConfig vs initializer.js   |          3          |
| P2  | 🔴 CRÍTICO | Dois registros de sessão: client.js Map vs session.js stateless |  2 + consumidores   |
| P3  |  🔴 ALTO   | Config barrel importa de sdk/ — violação de boundaries          |  1 + consumidores   |
| P4  |  🔴 ALTO   | Tipos de hooks paralelos a tipos SDK                            | 1 + 19 hooks files  |
| P5  |  🟡 MÉDIO  | `defineTool` usado diretamente em 11 arquivos                   |         11          |
| P6  |  🟡 MÉDIO  | `approveAll` importado diretamente em 5 arquivos                |          5          |
| P7  |  🟡 MÉDIO  | `CopilotClient` instanciado fora do wrapper                     |          2          |
| P8  |  🟡 MÉDIO  | API routes usam features SDK não-wrapped                        |          2          |
| P9  |  🟢 BAIXO  | `SYSTEM_PROMPT_SECTIONS` importado diretamente                  |          1          |
| P10 |  🟢 BAIXO  | `core/sdk-types.js` duplica tipos já em `hooks/types.js`        |          2          |

---

## §9. Métricas de Acoplamento

### 9.1 Importações Diretas vs Wrapper

| Mecanismo                             | Arquivos | Proporção |
| ------------------------------------- | -------: | --------: |
| `from '@github/copilot-sdk'` (bypass) |       20 |       48% |
| `from '#copilot/sdk'` (wrapper)       |       21 |       52% |
| **Total arquivos com SDK access**     |   **41** |  **100%** |

(Nota: alguns arquivos importam de ambos — contados em ambas categorias)

### 9.2 Símbolos por Tipo de Bypass

| Símbolo            | Ocorrências bypass | Tipo              |
| ------------------ | -----------------: | ----------------- |
| `defineTool`       |                 11 | Função runtime    |
| `approveAll`       |                  5 | Função runtime    |
| `CopilotClient`    |                  2 | Classe/Construtor |
| `SYSTEM_PROMPT_*`  |                  1 | Constante         |
| Types (JSDoc only) |                ~15 | Tipos             |
| **Total runtime**  |             **19** |                   |

### 9.3 Observação

Tipos JSDoc (`@typedef {import('@github/copilot-sdk').X}`) não contam como bypass funcional — são
anotações que não introduzem acoplamento runtime. Os 19 bypasses runtime são os que precisam ser
roteados pelo wrapper.

---

## §10. Conclusão e Recomendação

A arquitetura atual apresenta uma **intenção clara de wrapper centralizado** (o módulo `sdk/` existe
e já cobre client, session e tools-registry), mas a execução falhou em dois aspectos:

1. **O wrapper é incompleto** — faltam `defineTool`, `approveAll`, `SYSTEM_PROMPT_SECTIONS`, e
   features avançadas do client
2. **O wrapper não é obrigatório** — nada impede importações diretas de `@github/copilot-sdk`

A transformação arquitetural proposta na PARTE-17B deve:

1. Completar o wrapper com TODOS os símbolos SDK usados pelo projeto
2. Tornar o wrapper o ÚNICO ponto de acesso (lint rule ou import restriction)
3. Unificar os caminhos de configuração de sessão
4. Unificar os registros de sessão
5. Consolidar os sistemas de tipos (hooks/types.js + core/sdk-types.js → sdk/types.js)

**Estimativa de impacto**: ~41 arquivos precisam de mudanças de import. ~3 arquivos de
config/session precisam de refatoração profunda. O módulo `sdk/` precisará crescer de ~3.252 para
~3.800-4.200 linhas.

---

_Documento gerado pela auditoria PARTE-17, rev.3. Base: leitura completa de 263 arquivos de
src/copilot/ (46.525 linhas)._
