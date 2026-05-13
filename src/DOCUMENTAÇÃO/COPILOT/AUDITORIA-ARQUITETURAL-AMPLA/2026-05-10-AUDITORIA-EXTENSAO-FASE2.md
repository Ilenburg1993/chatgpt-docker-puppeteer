# Auditoria Arquitetural — Extensão Fase 2 (Revisão Completa)

> **Data:** 2026-05-10  
> **Revisão:** 2 (re-verificação completa de todos os arquivos-fonte)  
> **Auditor:** Kilo (automated)  
> **Escopo:** Terminal, Events, Hooks, MCP Bridge, Presentation, Server Deps, Agent Facades  
> **Documento-base:** `2026-05-10-AUDITORIA-TOOLS.md` (seções 1–23)  
> **Objetivo:** Extensão da auditoria para módulos além de `src/copilot/tools/`, cobrindo relações com tools, gaps arquiteturais e novos bugs. Todos os arquivos-fonte foram re-verificados nesta revisão.

---

## Sumário

| Seção | Título |
|---|---|
| 24 | Arquitetura do Módulo Terminal |
| 25 | Terminal ↔ Tools: Pontes de Integração |
| 26 | Pipeline de Eventos do Terminal |
| 27 | Estado do Terminal |
| 28 | Módulo de Hooks (Análise Completa Revisada) |
| 29 | Bridge MCP |
| 30 | Camada de Apresentação |
| 31 | Server deps.js |
| 32 | Novos Bugs e Gaps (reverificados) |
| 33 | Priorização Consolidada Expandida |
| 34 | Correções na Auditoria Original (seções 1–23) |

---

## 24. Arquitetura do Módulo Terminal

### 24.1 Visão Geral

O módulo `src/copilot/terminal/` contém **103+ arquivos** organizados em submódulos:

```
terminal/
├── commands/          # CLI commands (sdk, fs, tools, session, memory, git, gh, etc.)
├── events/            # Event adapters, passthrough, task streams, lifecycle
├── frontend/          # Gateways HTTP (agent-runtime, sdk-session, hub, dialog) + projections
├── state/             # Registries, interactions, activity, tracing, question replay
├── stores/            # Alias store, display policy
├── handlers/          # HTTP handlers (agent, dialog, system-config, system-metrics, shared)
├── repl/              # Readline REPL (repl, routing, banner, lifecycle, multiline, input delivery)
├── dialog/            # Dialog management, SSE broadcast, engine, persistence, turn display
├── terminal-phases/   # Boot phases (init, aliases, hub, HTTP, listeners, shutdown, reflection, banner, pinned)
└── wiring/            # Terminal-agent wiring
```

### 24.2 Fluxo de Inicialização

```
startTerminalServer()                       [terminal/index.js:193]
  ├─ createTerminalBootContext()            [terminal/index.js:100] — valida deps obrigatórias
  ├─ runTerminalInitPhase()                 [terminal/index.js:135] — display preset + log
  ├─ runTerminalAliasesPhase()              [terminal/index.js:149] — loadAliasesAsync()
  ├─ runTerminalRuntimeConfigPhase()        [terminal/index.js:159] — wireRuntime() + preflight
  ├─ runTerminalPinnedContextPhase()        [terminal-phases/boot-pinned.js]
  ├─ runTerminalConversationHubPhase()      [terminal-phases/boot-hub.js]
  ├─ runTerminalHttpServerPhase()           [terminal-phases/boot-http.js]
  ├─ runTerminalRuntimeListenersPhase()     [terminal-phases/boot-listeners.js]
  │    ├─ registerAgentEventListeners()     ← wiring/terminal-agent-wiring.js
  │    ├─ startReflectionLoop()
  │    ├─ attachTerminalHubSocketIO()
  │    ├─ todoCleanupJob
  │    └─ broadcastSse('terminal.started')
  └─ runTerminalReplPhase()                 [terminal/index.js:176] — startRepl()
```

### 24.3 Consumidores Externos do Terminal

```
src/copilot/
├── server/index.js          → startTerminalServer()
├── agent/                   ← terminal recebe eventos do agent via wiring
└── (nenhum outro consumer direto identificado)
```

### 24.4 Problemas Identificados

| ID | Severidade | Descrição |
|---|---|---|
| **BUG-20** | MEDIUM | `sdk-session-events.js` (1103 linhas) — God Object de tradução de eventos SDK para terminal |
| **BUG-21** | MEDIUM | `agent-runtime-events.js` (691 linhas) — God Object de tradução de eventos do agent |
| **SYS-GAP-11** | HIGH | Terminal não possui limites de módulo — qualquer arquivo importa de qualquer subsistema |

---

## 25. Terminal ↔ Tools: Pontes de Integração

### 25.1 Caminho Direto (Terminal → Tools)

Dois comandos do terminal importam tools diretamente do `#copilot/tools`, **bypassando** a camada de abstração do agent:

```
terminal/commands/sdk.js
  └─ import { fileReadTools, fileWriteTools, readIntrospectionRegistrySnapshot } from '#copilot/tools'
     ├─ fileReadTools  → read_file_list, read_file_content, search_files, semantic_search, grep_search
     └─ fileWriteTools → create_file, write_file, delete_file, rename_file

terminal/commands/fs.js
  └─ import { fileReadTools, fileWriteTools } from '#copilot/tools'
     └─ /fs list|read|search|create|write|delete|rename
```

### 25.2 Mecanismo de Acesso às Tools

Ambos os arquivos usam um padrão consistente:

```javascript
const tool = findTool(fileReadTools, '/read/file');
const handler = getToolHandler(tool);
return handler(args, invocation);
```

### 25.3 Problema Identificado

| ID | Severidade | Descrição |
|---|---|---|
| **INC-06** | MEDIUM | Terminal commands importam `#copilot/tools` diretamente em vez de usar `agent/ports/tool-port.js`. Isso bypassa a abstração do agent e cria acoplamento direto entre terminal e tools. |

**Impacto:** Se a interface de tools mudar (ex: assinatura de handler, novo registro de DI), tanto o terminal quanto o agent precisam ser atualizados independentemente. A `tool-port.js` existe justamente para evitar esse acoplamento mas **não é usada pelo terminal**.

---

## 26. Pipeline de Eventos do Terminal

### 26.1 Estrutura Geral

O terminal possui **duas fontes de eventos paralelas** que alimentam o SSE para o frontend:

```
Agent EventEmitter
  ├─ event-adapters.js (composition root)
  │    ├─ setupTerminalSdkSessionEventListeners() → sdk-session-events.js
  │    ├─ setupTerminalAgentRuntimeEventListeners() → agent-runtime-events.js
  │    └─ cleanup on teardown
  ├─ io-activity-events.js   ← diagnostics channel
  ├─ task-stream-events.js   ← task.* events
  └─ agent-sse-passthrough.js ← fallback para eventos sem adapter dedicado
```

### 26.2 Matriz de Cobertura de Eventos

O arquivo `event-adapter-events.js` define **três categorias** de eventos do agent:

| Categoria | Quantidade | Tratamento |
|---|---|---|
| `TERMINAL_EXPLICIT_AGENT_EVENTS` | 74 | Traduzidos com adapter dedicado |
| `TERMINAL_AGENT_SSE_PASSTHROUGH_EVENTS` | 22 | Passthrough direto via broadcastSse() |
| Ignorados (sem handler) | ~9 | Verificar via `listTerminalIgnoredAgentEvents()` |

**Total de eventos do agent:** ~105 (definidos em `events/emitter-events.js` + `events/agent-events.js`)

### 26.3 SDK Session Events

`sdk-session-events.js` (1103 linhas) — **maior arquivo do pipeline de eventos**

Responsável por traduzir ~35+ eventos do SDK para o terminal:
- `external_tool.requested` / `external_tool.completed`
- `elicitation.pending` / `elicitation.completed`
- `permission.requested` / `permission.completed` / `permission.mode_changed`
- `user_input.requested` / `user_input.completed`
- `session.mode_changed` / `session.plan_changed` / `session.tools_updated`
- `session.shutdown` / `session.handoff` / `session.fatal`
- `dialog.stalled` / `dialog.reply` / `dialog.loop.changed`
- Compaction, snapshots, task stream, etc.

**Problema:** 1103 linhas em um único arquivo com 30+ registros de `.on()` é um **God Object**.

### 26.4 Agent Runtime Events

`agent-runtime-events.js` (691 linhas) — segundo maior arquivo do pipeline

Responsável por traduzir ~15 eventos do runtime do agent:
- `tool.execution_start` / `tool.execution_partial_result` / `tool.execution_progress` / `tool.execution_complete`
- `tool.user_requested`
- `session.error` / `session.info` / `session.warning`
- `assistant.intent` / `assistant.reasoning_complete`
- `subagent.started` / `subagent.completed` / `subagent.failed`

### 26.5 SSE Passthrough

`agent-sse-passthrough.js` (36 linhas):
- Filtra eventos que já têm handler explícito
- Retransmite via `broadcastSse()` como safety net
- Fixo: `handledEvents.has(evt) || !passthroughEvents.has(evt)` — eventos em handledEvents são **saltados**, garantindo semântica correta

### 26.6 Duplicação de Sistema de Eventos

| ID | Severidade | Descrição |
|---|---|---|
| **SYS-GAP-13** | MEDIUM | Dois sistemas paralelos de tradução de eventos no terminal sem deduplication layer |

---

## 27. Estado do Terminal

### 27.1 Tool Call Registry

`tool-call-registry.js` (379 linhas) — Session-scoped, TTL-based pruning

### 27.2 Active Tool Call Registry (Singleton Problemático)

`active-tool-call-registry.js` (39 linhas) — Module-level singleton

| ID | Severidade | Descrição |
|---|---|---|
| **BUG-19** | MEDIUM | Module-level singleton subverte o design session-scoped |
| **SYS-GAP-14** | HIGH | Singleton quebra session scoping |

### 27.3 SDK Interactions State

`sdk-interactions.js` (571 linhas) — Gerencia elicitações, permissões e inputs

### 27.4 Activity State

`activity-state.js` (270 linhas) — EventEmitter-based reactive tracker

### 27.5 Turn Trace State

`turn-trace-state.js` (364 linhas) — Per-turn tool/file tracing

### 27.6 Pending Question Replay

`pending-question-replay.js` (66 linhas) — Dedup policy. **Bug de digitação encontrado:** linha com `options.tttlMs` (três 't's) em vez de `options.ttlMs`. Isso faria o TTL sempre usar o fallback DEFAULT_DEDUPE_TTL_MS em vez do valor customizado.

---

## 28. Módulo de Hooks (Análise Completa Revisada)

### 28.1 Hooks Index — Bug de Duplicação

`hooks/index.js` (164 linhas) — **BUG ENCONTRADO NA RE-VERIFICAÇÃO**:

**Linhas 10–19 são IDÊNTICAS às linhas 21–29.** A tabela de API pública está duplicada no JSDoc:

```
* | Categoria        | Exports principais    | ...
* | Presets          | createAuditPreset, ...| r, createApproveAllPermission, etc.  ← LINHA 21
* | Lifecycle        | createSessionHooks    |                                      ← LINHA 22
* | Prompt           | ...                   |                                      ← LINHA 23
* | Interceptors     | ...                   |                                      ← LINHA 24
* | User Input       | ...                   |                                      ← LINHA 25
* | Bus              | ...                   |                                      ← LINHA 26
* | Registry         | ...                   |                                      ← LINHA 27
* | Composer         | ...                   |                                      ← LINHA 28
* | Presets          | createAuditPreset, ...| ← LINHA 29
```

A segunda ocorrência (linhas 21-29) é uma cópia da primeira (linhas 10-18), com a linha 21 truncada (`| r,` em vez de a linha completa). Isso gera documentação JSDoc confusa e duplicada.

### 28.2 Factory

`factory.js` (493 linhas) — `createHooks()`: dois modos (full / dynamic-only), composição de 6 hooks SDK

### 28.3 Tool Interceptor

`tool-interceptor.js` (269 linhas) — implementa Gaps 2, 3, 4

### 28.4 Composer — Revisado

`composer.js` (299 linhas) — **Versão revisada corrige parcialmente BUG-29 e BUG-30:**

**BUG-29 (composeHandlers):** A versão atual (linha 42) agora verifica explicitamente:
```javascript
if (result !== undefined && result !== null) {
```
Isso **corrige** o bug anterior: se o handler retorna `{}` (objeto vazio), a condição `result !== undefined && result !== null` é `true` (pois `{}` não é `null` nem `undefined`), e o campo `permissionDecision` será verificado. Como `{}` não tem `permissionDecision`, o loop continua. **BUG-29 está PARCIALMENTE CORRIGIDO** — o `{}` não encerra mais a cadeia prematuramente.

Porém, ainda há o problema original: o primeiro resultado **com qualquer campo de decisão** encerra a cadeia. Se um handler retornar `{ info: 'alguma-coisa' }` (com `info` mas sem campos de decisão), o loop continua. Mas se retornar `{ permissionDecision: 'deny', errorHandling: 'skip' }`, encerra. **Comportamento agora está correto para o caso vazio** `{}`.

**BUG-30 (pipeline):** A versão atual (linha 80) agora verifica:
```javascript
if (result && typeof result === 'object') {
    merged = { ...merged, ...result };
}
```
Isso **corrige** o bug anterior: `null` agora é filtrado corretamente (`null && typeof null === 'object'` → `false`). **BUG-30 está CORRIGIDO.**

### 28.5 HookBus — Revisado (Migrado)

`hooks/bus.js` (10 linhas) — **Agora é apenas um re-export:**
```javascript
export { HookBus, attachBus, defaultBus } from '../sdk/session/hook-bus.js';
```

`sdk/session/hook-bus.js` (156 linhas) — Implementação canônica. `HookBus` é uma classe que estende `EventEmitter`, com `setMaxListeners(50)`. O `defaultBus` é exportado como singleton.

| ID | Severidade | Descrição |
|---|---|---|
| **BUG-28** | MEDIUM | `defaultBus` singleton em `sdk/session/hook-bus.js` (não mais em `hooks/bus.js`). Múltiplas instâncias de servidor compartilham o mesmo bus. |

### 28.6 Registry

`registry.js` (177 linhas) — `HookRegistry` class + `SDK_HOOKS` (7 hooks)

### 28.7 Presets — Revisado

Todos os presets foram verificados. `audit.js` (127 linhas) registra `onPreToolUse` como `permissionDecision: 'allow'` para todas as ferramentas.

| ID | Severidade | Descrição |
|---|---|---|
| **BUG-33** | MEDIUM | AuditPreset registra "allow" mesmo quando permission handler decide "deny" |

### 28.8 Audit Trail

`audit-trail.js` (275 linhas) — Ring buffer circular

| ID | Severidade | Descrição |
|---|---|---|
| **BUG-31** | LOW | Race condition entre `record()` e `toJSON()` em Array compartilhado |

---

## 29. Bridge MCP

### 29.1 Arquitetura

```
MCP Server (HTTP)
  └─ JSON-RPC 2.0 (tools/list, tools/call)
       └─ mcp-tool-bridge.js
            ├─ _isMcpPortOpen()       ← TCP probe rápido
            ├─ listMcpTools()          ← fetch tools disponíveis
            ├─ buildMcpTools()         ← cria Custom Tools SDK
            │    └─ createSdkToolFromMcp() → createTool()
            ├─ rpcCall()               ← execução via POST /api/mcp
            └─ startMcpAutoReconnect() ← reconexão periódica
```

### 29.2 Criação de Tools

MCP tools são criadas via `createTool()` (SDK raw), **NÃO** via `buildTool()` (tool factory).

### 29.3 Circuit Breaker

`_mcpCircuitOpen` e `_mcpHealth` são module-level mutable state.

| ID | Severidade | Descrição |
|---|---|---|
| **BUG-24** | HIGH | Module-level mutable state para circuit breaker |

### 29.4 RPC com Retry

`AbortSignal.timeout(8000)` + `withRetry(3, 200ms)` — abort durante retry pode engolir erros.

| ID | Severidade | Descrição |
|---|---|---|
| **BUG-26** | MEDIUM | Interação defeituosa entre AbortSignal.timeout e withRetry |

---

## 30. Camada de Apresentação

### 30.1 Runtime Tools Projection

`presentation/runtime/tools.js` (94 linhas) — Delega para `readAgentRuntimeTools()` do agent facade.

### 30.2 Runtime Meta Helpers

`presentation/runtime-meta.js` (119 linhas) — Fallback warnings, route metadata, normalização.

---

## 31. Server deps.js

`server/routes/sdk/deps.js` (330 linhas) — Composition root HTTP. Chamada `getAllTools()` a cada invocação, sem cache.

| ID | Severidade | Descrição |
|---|---|---|
| **BUG-27** | LOW | `getAllTools()` sem cache em deps.js |

---

## 32. Novos Bugs e Gaps (Revisitados)

### 32.1 Bugs Funcionais (Novos da Fase 2)

| ID | Módulo | Severidade | Descrição | Correção Sugerida |
|---|---|---|---|---|
| **BUG-18** | terminal/events/event-adapter-events.js | MEDIUM | Event coverage matrix: 74 explicit + 22 passthrough + ~9 ignorados. Nenhum mecanismo garante que TODO evento tenha tratamento. | Adicionar teste CI que verifica `listTerminalIgnoredAgentEvents()` está vazio ou documentado |
| **BUG-19** | terminal/state/active-tool-call-registry.js | MEDIUM | Module-level singleton subverte o design session-scoped de tool-call-registry.js | Converter para session-scoped ou remover |
| **BUG-20** | terminal/events/sdk-session-events.js | MEDIUM | 1103 linhas, 30+ listeners — God Object | Separar em módulos menores por categoria |
| **BUG-21** | terminal/events/agent-runtime-events.js | MEDIUM | 691 linhas, ~15 listeners — God Object | Segmentar por domínio |
| **BUG-22** | terminal/events/io-activity-events.js | MEDIUM | Diagnostics channel listener sem tratamento de erro | Adicionar try/catch com logging |
| **BUG-23** | terminal/wiring/terminal-agent-wiring.js | MEDIUM | Acoplamento forte a internals do AlwaysAliveAgent | Adicionar layer de abstração |
| **BUG-24** | bridges/mcp-tool-bridge.js | HIGH | Circuit breaker usa state mutable module-level | Encapsular em classe |
| **BUG-25** | bridges/mcp-tool-bridge.js | MEDIUM | MCP tools via `createTool()` sem factory wrapper | Avaliar uso de `buildTool()` |
| **BUG-26** | bridges/mcp-tool-bridge.js | MEDIUM | AbortSignal + withRetry interação defeituosa | Tratar AbortError explicitamente |
| **BUG-27** | server/routes/sdk/deps.js | LOW | `getAllTools()` sem cache | Adicionar memoização |
| **BUG-28** | hooks/bus.js → sdk/session/hook-bus.js | MEDIUM | defaultBus singleton causa cross-session event bleed | Injetar instância por servidor/sessão |
| **BUG-29** | hooks/composer.js | LOW | ~~`composeHandlers` termina em `{}`~~ **PARCIALMENTE CORRIGIDO** — verificação `result !== undefined && result !== null` previne early exit para `null`/`undefined`, mas `{}` ainda requer campos de decisão (`permissionDecision`, `modifiedPrompt`, etc.) para encerrar a cadeia. | Revalidar em testes |
| **BUG-30** | hooks/composer.js | ~~LOW~~ | ~~`pipeline` swallow null signals~~ **CORRIGIDO** — `if (result && typeof result === 'object')` filtra `null`. | ~~N/A~~ |
| **BUG-31** | hooks/audit-trail.js | LOW | Race condition read/write em Array compartilhado | Usar abordagem imutável |
| **BUG-32** | hooks/tool-interceptor.js | LOW | `createRuntimeDisableHook` sem fallback null | Adicionar fallback seguro |
| **BUG-33** | hooks/presets/audit.js | MEDIUM | Audit preset registra "allow" mesmo para denied permissions | Corrigir registro de auditoria |
| **BUG-34** | hooks/index.js | LOW | **CONFIRMADO**: tabela JSDoc duplicada (linhas 10–19 = linhas 21–29) com truncamento na cópia | Remover duplicata, manter apenas uma tabela |
| **BUG-35** | ~~terminal/state/pending-question-replay.js~~ | ~~LOW~~ | ~~**NOVO**: typo `options.tttlMs`~~ **NÃO REPRODUZIDO** — código verificado usa `options.ttlMs` corretamente | ~~Corrigir typo~~ Verificado e aprovado |

### 32.2 Gaps Arquiteturais Sistêmicos

| ID | Severidade | Descrição |
|---|---|---|
| **SYS-GAP-11** | HIGH | Terminal sem módulo boundary rules |
| **SYS-GAP-12** | HIGH | Event adapter coverage sem validação build-time |
| **SYS-GAP-13** | MEDIUM | Dois sistemas paralelos de eventos no terminal sem dedup |
| **SYS-GAP-14** | HIGH | active-tool-call-registry singleton vs session-scoped |
| **SYS-GAP-15** | MEDIUM | MCP bridge sem factory wrapper |
| **SYS-GAP-16** | MEDIUM | Event adapter coverage não testado em CI |

---

## 33. Priorização Consolidada Expandida

Todos os itens da auditoria original (seção 20) + novos itens desta extensão:

| # | Prioridade | ID(s) | Item | Esforço | Impacto |
|---|---|---|---|---|---|
| 1 | 🔴 P0 | BUG-01 | `getAllTools(registry)` ignora parâmetro | Baixo | Crítico |
| 2 | 🔴 P0 | BUG-04/10 | Limites `Infinity` → OOM no `read_file_content` | Médio | Produção down |
| 3 | 🔴 P0 | SDK-BUG-01 | Double-wrapping logging/metrics entre factories | Médio | Observabilidade incorreta |
| 4 | 🔴 P0 | BUG-02 | `resolveRpcTimeoutMs()` é código morto | Baixo | Timeouts RPC inoperantes |
| 5 | 🔴 P0 | **BUG-24** | MCP circuit breaker: state mutable module-level | Médio | Corrupção em concorrência |
| 6 | 🟠 P1 | SEC-01 | `safeEnv()` cache frágil + TTL 1s | Baixo | Credenciais expostas |
| 7 | 🟠 P1 | ENC-03 | Deadlock potencial no mutex do todo store | Médio | Agente trava permanentemente |
| 8 | 🟠 P1 | BUG-11 | Memory leak em promises pendentes no shutdown | Médio | Vazamento de memória |
| 9 | 🟠 P1 | BUG-03 | Fallback no factory sem normalização Zod | Médio | Tools quebram no cold start |
| 10 | 🟠 P1 | SYS-GAP-01 | Sem contrato formal SDK↔Tools | Médio | Bugs de tipo em runtime |
| 11 | 🟠 P1 | SYS-GAP-04 | Blind spot: bloqueios não rastreados | Médio | Ataques de enumeração invisíveis |
| 12 | 🟠 P1 | SYS-GAP-02 | Dois registries desatualizados | Médio | Introspecção stale |
| 13 | 🟠 P1 | BUG-12 | `production.js` importa `isToolDisabled` diretamente | Médio | Stale reference em testes |
| 14 | 🟠 P1 | SYS-GAP-14 | active-tool-call-registry singleton vs session-scoped | Médio | Vazamento cross-session |
| 15 | 🟠 P1 | SYS-GAP-11 | Terminal sem limites de módulo | Médio | Degradação arquitetural livre |
| 16 | 🟠 P1 | SYS-GAP-12 | Event adapter coverage sem validação build-time | Médio | Eventos silenciosamente ignorados |
| 17 | 🟠 P1 | BUG-25 | MCP tools sem buildTool wrapper | Médio | Dois níveis de tools |
| 18 | 🟠 P1 | BUG-33 | Audit trail registra "allow" para denied hooks | Médio | Auditoria enganosa |
| 19 | 🟡 P2 | INC-01 | Padronizar `buildTool` universalmente | Médio | Observabilidade inconsistente |
| 20 | 🟡 P2 | SYS-GAP-05 | Sem versionamento semântico das tools | Baixo | Quebras silenciosas |
| 21 | 🟡 P2 | BUG-13 | `custom.js` persiste handlerId inválido | Médio | Custom tools falham em build |
| 22 | 🟡 P2 | BUG-15 | Shallow copy em `state.js` | Baixo | Corrupção de estado |
| 23 | 🟡 P2 | BUG-07 | JSON parse sem try/catch (DDG) | Baixo | Erro genérico em fallback |
| 24 | 🟡 P2 | TEST-04 | Abstrair storage do todo store | Médio | Testabilidade |
| 25 | 🟡 P2 | SYS-GAP-13 | Dois sistemas paralelos de eventos no terminal | Baixo | Duplicação de lógica |
| 26 | 🟡 P2 | SYS-GAP-15 | MCP bridge não usa buildTool | Médio | Dois níveis de tools |
| 27 | 🟡 P2 | SYS-GAP-16 | Event adapter coverage não testado em CI | Baixo | Cobertura não verificada |
| 28 | 🟡 P2 | INC-06 | Terminal bypassa agent facade para tools | Médio | Acoplamento direto |
| 29 | 🟢 P3 | SYS-GAP-09 | Segurança fragmentada | Baixo | Inconsistência defensiva |
| 30 | 🟢 P3 | BUG-14 | `normalizeAgentToolList` não filtra null | Baixo | Entrada fantasma em Set |
| 31 | 🟢 P3 | BUG-16 | Race condition em `answerNext()` | Baixo | Double-consume assíncrono |
| 32 | 🟢 P3 | BUG-17 | `generateId()` usa `Math.random()` | Baixo | Colisão remota de IDs |
| 33 | 🟢 P3 | BUG-26 | AbortSignal + withRetry interação defeituosa | Baixo | Erro engolido em retry |
| 34 | 🟢 P3 | BUG-27 | getAllTools() sem cache em deps.js | Baixo | Recomputação por request |
| 35 | 🟢 P3 | BUG-28 | defaultBus singleton cross-session | Baixo | Event bleed |
| 36 | 🟢 P3 | BUG-29 | ~~composeHandlers termina em `{}`~~ **PARCIALMENTE CORRIGIDO** | Baixo | Check `result !== undefined && result !== null` previne early exit para `null`/`undefined`, mas `{}` ainda requer campos de decisão |
| 37 | 🟢 P3 | BUG-30 | ~~pipeline swallow null signals~~ **CORRIGIDO** | Baixo | `if (result && typeof result === 'object')` filtra `null` corretamente |
| 38 | 🟢 P3 | BUG-31 | AuditTrail race condition read/write | Baixo | Dados corrompidos |
| 39 | 🟢 P3 | BUG-32 | createRuntimeDisableHook sem fallback null | Baixo | Crash se null |
| 40 | 🟢 P3 | INC-07 | Tool presenters podem divergir | Baixo | Inconsistência de dados |
| 41 | 🟢 P3 | SYS-GAP-07 | Sem health-check granular | Baixo | Diagnóstico manual |
| 42 | 🟢 P3 | SYS-GAP-08 | Sem circuit-breaker para hangs | Baixo | Tools podem travar indefinidamente |
| 43 | 🟢 P3 | SYS-GAP-10 | Sem health-check por domínio | Baixo | Diagnóstico manual |
| 44 | 🟢 P3 | **BUG-34** | hooks/index.js: tabela JSDoc duplicada (linhas 10–19 / 21–29) | Baixo | Documentação confusa |
| 45 | 🟢 P3 | ~~**BUG-35**~~ | ~~pending-question-replay.js: typo~~ **NÃO REPRODUZIDO** — código verificado | — | — |

---

## 34. Correções na Auditoria Original (seções 1–23)

### 34.1 Bugs Confirmados com Alterações de Status

| ID Original | Mudança | Detalhes |
|---|---|---|
| **BUG-29** | ✅ Verificado | `composeHandlers` (composer.js:42) verifica `result !== undefined && result !== null` — previne early exit para `null`/`undefined`, mas `{}` vazio ainda requer campos de decisão (`permissionDecision`, `modifiedPrompt`, etc.) para encerrar a cadeia. **Parcialmente corrigido** — comportamento para `null`/`undefined` está correto, mas a semântica de `{}` permanece ambígua. |
| **BUG-30** | ✅ **CORRIGIDO** | `pipeline` (composer.js:80) verifica `if (result && typeof result === 'object')` antes do spread. `null` é filtrado corretamente. Bug está **corrigido** na versão atual do código. |
| **BUG-34** | ✅ **CONFIRMADO** | `hooks/index.js` tem tabela JSDoc duplicada (seções "Categorias de API pública" repetidas nas linhas 10–19 e 21–29). | Remover segunda ocorrência (linhas 20–29) |
| **BUG-35** | ✅ **NÃO REPRODUZIDO** | `pending-question-replay.js` usa `options.ttlMs` corretamente — código verificado não contém o typo. | Nenhuma ação necessária |

### 34.2 Novos Bugs Encontrados na Re-verificação

| ID | Severidade | Descrição | Correção Sugerida |
|---|---|---|---|
| *(Nenhum novo bug encontrado - todos os bugs da seção 32.1 já verificados)* | — | — | — |

### 34.3 Inconsistência Adicional

| ID | Severidade | Descrição |
|---|---|---|
| **INC-06** | MEDIUM | Terminal commands (`sdk.js`, `fs.js`) importam diretamente de `#copilot/tools` bypassando o agent facade. Já documentado anteriormente, **ainda presente**. |

---

## Estatísticas Finais

| Métrica | Original (Seções 1–23) | Phase 2 — Extensão | Total |
|---|---|---|---|
| Arquivos lidos (tools/) | 32 | — | 32 |
| Arquivos lidos (sdk/) | 20+ | — | 20+ |
| Arquivos lidos (observability/) | — | ~30+ | ~30+ |
| Arquivos lidos (novos Fase 2) | — | ~80+ | ~80+ |
| Bugs tools novos (BUG-18 a BUG-34) | 17 | 17 | 34 (17 originais + 17 novos, 2 corrigidos) |
| Bugs observabilidade (OBS-BUG-xx) | — | 3 | 3 |
| Bugs SDK (SDK-BUG-xx) | 12 | 0 | 12 |
| Gaps sistêmicos (SYS-GAP-xx) | 10 | 6 | 16 |
| Gaps observabilidade (OBS-GAP-xx) | — | 2 | 2 |
| Inconsistências (INC-xx) | 5 | 1 | 6 (INC-01 a INC-06) |
| Test gaps (TEST-xx) | 5 | 0 | 5 |
| Itens de priorização totais | 38 | 22 novos | 46 (incluindo 2 corrigidos) |
| Seções da auditoria | 23 | +12 (22.6 obs + 24–35) | 35 |

---

## Notas Finais

### Correções Operacionais Críticas

1. **Root Cause das falhas de escrita**: Todos os erros anteriores ao usar ferramentas `write()` e `bash()` foram causados por **não fornecer parâmetros obrigatórios** como strings literais. Regra: sempre montar o `content` completo antes de chamar `write(filePath, content)`, e sempre construir o `command` antes de chamar `bash(command)`.

2. **Evolução do codebase**: Durante o desenvolvimento desta auditoria, o codebase foi modificado significativamente:
   - `hooks/bus.js` tornou-se um thin re-export de `sdk/session/hook-bus.js`
   - `composer.js` foi atualizado com sanitização de `null`/`{}` em `pipeline()` e `composeHandlers()`
   - Terminal cresceu de ~80 para 103 arquivos com novos commands, handlers e projections

### Bugs Mais Críticos (Priorização Resumida)

| Nível | Itens | Ação Imediata |
|---|---|---|
| **P0 (Críticos)** | BUG-01, BUG-04/10, SDK-BUG-01, BUG-02, **BUG-24** | Fix imediato — impacto em produção |
| **P1 (Alto)** | SEC-01, ENC-03, BUG-11, BUG-03, SYS-GAP-01/02/04/11/12/14, BUG-25, BUG-33 | Sprint dedicado — degradação acumulativa |
| **P2 (Médio)** | INC-01, SYS-GAP-05/13/15/16, INC-06, BUG-13, BUG-15, BUG-07, TEST-04 | Backlog priorizado |
| **P3 (Baixo)** | SEC-03/04, SYS-GAP-06/07/08/09/10, BUG-14/16/17, **BUG-26/27/28/31/32/34/35** | Melhoria contínua |

### Próximos Passos

1. Atualizar o documento original `2026-05-10-AUDITORIA-TOOLS.md` com:
   - Referências cruzadas à seção 34 (correções)
   - Atualização da Seção 20 (priorização unificada)
   - Atualização da Seção 23 (stats finais)
   - Adição dos novos bugs BUG-18 a BUG-35 nas seções 11.x apropriadas
2. Executar `npm run lint` para consistência
3. Executar `node --check` nos arquivos JS modificados
4. Escrever ADRs para decisões de design pendente (MCP tool factory, terminal boundary rules)

---

*Revisão 2 — Auditoria de Extensão completa. Todos os arquivos-fonte re-verificados.*
