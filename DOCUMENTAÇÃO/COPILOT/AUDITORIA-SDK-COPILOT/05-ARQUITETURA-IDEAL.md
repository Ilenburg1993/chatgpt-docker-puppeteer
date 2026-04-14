# 05 — Arquitetura Ideal: `src/copilot` com 100% SDK Coverage

**Data**: 2026-03-21 | **Revisado**: 2026-03-21
**Status**: Versão Definitiva (pós revisão crítica)
**Referência**: 04-ARQUITETURA-ATUAL.md

---

## 1. Princípios da Arquitetura Ideal

1. **SDK-First**: O SDK é a fonte de verdade. Não reimplementar o que o SDK já faz nativamente.
2. **Zero Dead Code**: Todo wrapper exportado deve ter pelo menos um consumer (tool, route, ou agent).
3. **Type Safety End-to-End**: Eliminar `Record<string,unknown>` casts. Usar tipos do SDK diretamente.
4. **100% Event Coverage**: Todo evento do SDK deve ter handler dedicado com lógica acionável.
5. **SDK-Sourced Sessions**: SDK client é a fonte de verdade para sessões ativas. conversation-hub é consumer informado (persistência + broadcast), não concorrente.
6. **Composable Hooks**: Hooks como thin adapters sobre SDK + lógica custom em camada separada.
7. **God Module Decomposition**: `always-alive.js` decomposto em submódulos com responsabilidade única.

---

## 2. Camadas Propostas

```
┌─────────────────────────────────────────────────────────────────────┐
│                     CAMADA 6 — API GATEWAY                         │
│  server/routes/   ·  server/sse/   ·  server/ws/                   │
│  REST endpoints + SSE real-time + WebSocket (futuro)               │
│  → TODAS as features SDK expostas como endpoints                   │
├─────────────────────────────────────────────────────────────────────┤
│                    CAMADA 5 — TERMINAL / REPL                      │
│  terminal/repl    ·  terminal/handlers                             │
│  Interface REPL interativa para operadores                         │
├─────────────────────────────────────────────────────────────────────┤
│                   CAMADA 4 — ORCHESTRATION                         │
│  orchestrator/agent-loop.js  (ex always-alive.js, decomposto)      │
│  orchestrator/session-manager.js  (ex conversation-hub, SDK-based) │
│  orchestrator/turn-executor.js                                     │
│  orchestrator/dialog-engine.js                                     │
│  Responsável por: lifecycle do agente, multi-sessão, dialog loop   │
├─────────────────────────────────────────────────────────────────────┤
│                   CAMADA 3 — EVENT PROCESSING                      │
│  events/handlers/   ·  events/router.js                            │
│  100% dos 55+ eventos SDK com handler dedicado                     │
│  → Roteador que despacha eventos por categoria                     │
├─────────────────────────────────────────────────────────────────────┤
│                   CAMADA 2 — HOOKS + SECURITY                      │
│  hooks/adapter.js   ·  hooks/custom-policies/                      │
│  → Thin adapter: hooks SDK nativos + políticas custom              │
│  → SDK `availableTools`/`excludedTools` para filtering estático    │
│  → hooks para lógica dinâmica (runtime deny, ask, audit) apenas    │
├─────────────────────────────────────────────────────────────────────┤
│                   CAMADA 1B — TOOLS + BRIDGES                      │
│  tools/stable/   ·  tools/experimental/   ·  bridges/              │
│  → Tools divididas em estáveis e experimentais                     │
│  → Experimental tools habilitadas por feature flags                │
├─────────────────────────────────────────────────────────────────────┤
│                   CAMADA 1A — SDK FACADE                           │
│  sdk/client.js   ·  sdk/session.js   ·  sdk/rpc.js                │
│  → Fachada tipada com ZERO `Record<string,unknown>`                │
│  → Builder pattern para SessionConfig                              │
│  → Lifecycle events wired no bootstrap                             │
│  → Todos os RPC namespaces (estáveis + experimentais) acessíveis   │
├─────────────────────────────────────────────────────────────────────┤
│                   CAMADA 0 — SDK NATIVO                            │
│  @github/copilot-sdk (node_modules)                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Mudanças Estruturais

### 3.1 Decomposição de `always-alive.js`

**Antes** (700+ linhas, God Module):
```
always-alive.js → tudo
```

**Depois** (4 módulos focados):
```
orchestrator/
├── agent-loop.js          ← 150L: loop principal, startup/shutdown
├── session-manager.js     ← 200L: multi-sessão (baseado em SDK client)
├── turn-executor.js       ← 150L: send/sendAndWait + retry
└── dialog-engine.js       ← 100L: dialog loop, fallback scheduling
```

### 3.2 Integração Hub ↔ SDK Lifecycle Events

**Antes**: `conversation-hub/` é uma camada de persistência SQLite (LLM-A ↔ LLM-B ↔ Usuário) que sincroniza **de** sessões SDK via `syncFromSdkHistory()`, mas não recebe lifecycle events do client.
**Depois**: O hub permanece como camada de persistência independente, mas conectado via lifecycle events para sincronização em tempo real. O SDK é fonte de verdade para sessões ativas; o hub é consumidor informado para persistência + broadcast.

```js
// hub-lifecycle-bridge.js (ideal)
export function wireHubLifecycleEvents(client, hub) {
    // Lifecycle events notificam o hub quando sessões mudam
    client.on('session.created', (evt) => hub.onSdkSessionCreated(evt));
    client.on('session.deleted', (evt) => hub.onSdkSessionDeleted(evt));
    client.on('session.updated', (evt) => hub.onSdkSessionUpdated(evt));
}
```

**Nota**: O conversation-hub NÃO é uma duplicação de `client.listSessions()`. É uma camada superior
que persiste diálogos em SQLite e faz broadcast via Socket.IO para o ambiente multi-agente. A
"unificação" necessária é apenas o wiring de lifecycle events, não uma substituição do hub.

### 3.3 Event Router com 100% Coverage

**Antes**: Handlers registrados ad-hoc em múltiplos arquivos.
**Depois**: Router centralizado que despacha por categoria.

```
events/
├── router.js              ← Central dispatcher
├── handlers/
│   ├── session.js         ← session.* events (start, idle, error, etc.)
│   ├── assistant.js       ← assistant.* events (message, reasoning, etc.)
│   ├── tool.js            ← tool.* events (start, complete, progress)
│   ├── subagent.js        ← subagent.* events
│   ├── mcp.js             ← mcp.* events (oauth, server status)
│   ├── skill.js           ← skill.* events
│   ├── command.js         ← command.* events
│   ├── permission.js      ← permission.* events
│   ├── shell.js           ← shell_* events
│   └── system.js          ← system.* events
└── catch-all.js           ← fallback: log unknown events
```

### 3.4 Hooks como Thin Adapter

**Antes**: `hooks/factory.js` reimplementa tool filtering com `resolveToolDecision()`.
**Depois**: SDK filtering para estático + hooks para dinâmico.

```js
// hooks/adapter.js (ideal)
export function buildHooksConfig(ctx) {
    return {
        // SDK handles static filtering:
        availableTools: ctx.config.allowedTools,    // SessionConfig
        excludedTools: ctx.config.deniedTools,       // SessionConfig

        // Hooks handle dynamic logic ONLY:
        hooks: createHooks({
            onPreToolUse: async (input, inv) => {
                // Apenas lógica dinâmica: ask, runtime conditions
                if (ctx.dynamicDenyList.has(input.toolName)) {
                    return { permissionDecision: 'deny' };
                }
            },
            onPostToolUse: async (input, inv) => {
                // Audit logging
                ctx.auditLog.record(input);
            },
        }),
    };
}
```

### 3.5 SessionConfig Builder Tipado

**Antes**: `Record<string,unknown>` com double-cast.
**Depois**: Builder pattern com tipagem strict.

```js
// sdk/session-config-builder.js (ideal)
export class SessionConfigBuilder {
    /** @type {Partial<import('@github/copilot-sdk').SessionConfig>} */
    #config = {};

    model(m) { this.#config.model = m; return this; }
    reasoningEffort(r) { this.#config.reasoningEffort = r; return this; }
    streaming(s) { this.#config.streaming = s; return this; }
    workingDirectory(d) { this.#config.workingDirectory = d; return this; }
    tools(t) { this.#config.tools = t; return this; }
    hooks(h) { this.#config.hooks = h; return this; }
    mcpServers(m) { this.#config.mcpServers = m; return this; }
    customAgents(a) { this.#config.customAgents = a; return this; }
    availableTools(t) { this.#config.availableTools = t; return this; }
    excludedTools(t) { this.#config.excludedTools = t; return this; }
    agent(a) { this.#config.agent = a; return this; }
    skillDirectories(d) { this.#config.skillDirectories = d; return this; }
    disabledSkills(s) { this.#config.disabledSkills = s; return this; }
    clientName(n) { this.#config.clientName = n; return this; }
    onEvent(h) { this.#config.onEvent = h; return this; }

    build() { return /** @type {import('@github/copilot-sdk').SessionConfig} */ (this.#config); }
}
```

> **System Message**: O `SessionConfigBuilder` receberá o `systemMessage` do módulo modular
> `config/system-prompt/` (ver [08-SYSTEM-PROMPT-MODULAR.md](./08-SYSTEM-PROMPT-MODULAR.md)) —
> controle total via modo `replace` como padrão, com 10 seções SDK cobertas e troca fácil para
> `customize` sem refatoração.

### 3.6 Experimental Tools com Feature Flags

**Antes**: 19 wrappers experimentais sem consumer.
**Depois**: Tools experimentais condicionais por feature flag.

```
tools/
├── stable/                 ← Sempre disponíveis
│   ├── session-rpc.js
│   ├── session-ops.js
│   ├── code.js
│   └── ...
└── experimental/           ← Habilitadas por flag
    ├── skills-tools.js     ← sdk_skills_list/enable/disable
    ├── mcp-tools.js        ← sdk_mcp_list/enable/disable
    ├── agents-tools.js     ← sdk_agent_list/select/deselect/status
    ├── extensions-tools.js ← sdk_extensions_list/enable/disable
    ├── plugins-tools.js    ← sdk_plugins_list
    └── fleet-tools.js      ← sdk_fleet_start
```

---

## 4. Fluxo de Dados Ideal

```
[Usuário/Frontend]
       │
       ▼ (REST / SSE / WS)
[CAMADA 6: API Gateway] ────────────── SSE/WS stream ──────────┐
       │                                                         │
       ▼ (resolve sessão)                                        │
[CAMADA 4: SessionManager] ◄── SDK lifecycle events (sync)      │
       │                                                         │
       ▼ (delega turn)                                           │
[CAMADA 4: AgentLoop → TurnExecutor]                             │
       │                                                         │
       ▼ (build SessionConfig tipado)                            │
[CAMADA 1A: SessionConfigBuilder]                                │
       │                                                         │
       ▼ (session.send/sendAndWait)                              │
[CAMADA 0: CopilotSession]                                      │
       │                                                         │
       ├─► Events ─► [CAMADA 3: Event Router] ──────────────────►│
       │                    │                                    │
       │                    ├─► session.* handlers               │
       │                    ├─► assistant.* handlers             │
       │                    ├─► tool.* handlers                  │
       │                    ├─► mcp.* handlers                   │
       │                    └─► catch-all (unknown events)       │
       │                                                         │
       ├─► Hooks ─► [CAMADA 2: Thin Adapter]                     │
       │                (só lógica dinâmica)                      │
       │                                                         │
       ├─► RPC ─► [CAMADA 1A: sdk/rpc.js]                        │
       │              ├─ estáveis (sempre)                        │
       │              └─ experimentais (feature flag)             │
       │                                                         │
       └─► Tool calls ─► [CAMADA 1B: Tools]                     │
                              ├─ stable/ (sempre)                │
                              ├─ experimental/ (flag)            │
                              └─ bridges/ (MCP + GH)             │
```

---

## 5. Métricas de Sucesso da Arquitetura Ideal

| Métrica                         | Estado Atual              | Estado Ideal         |
| ------------------------------- | ------------------------- | -------------------- |
| Cobertura SDK APIs              | ~75%                      | 100%                 |
| Events com handler dedicado     | ~33/55 (60%)              | 55/55 (100%)         |
| Dead code lines                 | ~420                      | 0                    |
| God module files                | 1 (always-alive.js, 700L) | 0 (máx 200L/arquivo) |
| `Record<string,unknown>` casts  | 5+                        | 0                    |
| Tools experimentais expostas    | 0/19                      | 19/19                |
| Client lifecycle events wired   | 0/5                       | 5/5                  |
| Session config options cobertas | 14/21                     | 21/21                |
| Sessions registry duplicados    | 2 (hub + SDK)             | 1 (SDK + cache sync) |

---

## 6. Compatibilidade e Migração

A transição para a arquitetura ideal deve ser **incremental e backward-compatible**:

1. **Fase 1**: Corrigir bugs (BUG-01–11) — sem mudança estrutural
2. **Fase 2**: Adicionar handlers de eventos faltantes — aditivo
3. **Fase 3**: Criar tools experimentais — aditivo
4. **Fase 4**: Refatorar lifecycle.js (SessionConfigBuilder) — substitutivo
5. **Fase 5**: Wire lifecycle events do client — aditivo
6. **Fase 6**: Decompor always-alive.js — substitutivo (mais arriscado)
7. **Fase 7**: Integrar hub com lifecycle events do SDK — aditivo (baixo risco)
8. **Fase 8**: Simplificar hooks (thin adapter) — substitutivo

Fases 1–5 são de baixo risco e podem ser feitas em paralelo.
Fases 6–8 são de risco moderado e devem ser sequenciais com testes de regressão.
