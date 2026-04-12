# PARTE-23E — Grafos de Dependência, Acoplamento e Topologia de Eventos

**Data**: 2026-04-12 | **Status**: Canônico | **Versão**: 1.0
**Scope**: Grafos reais de dependência inter-módulo, fan-in/fan-out, ciclos, event topology
**Precedente**: PARTE-22D (grafos parciais), PARTE-23A/B (diagnóstico + eventos)

---

## 1. Grafo de Dependências Inter-Módulo (Atualizado)

### 1.1 Layer Map Real

```
L6 ─ terminal/  api/
L5 ─ (vazio — services deveria ser L5)
L4 ─ services/  agent/  conversation-hub/  channel/
L3 ─ tools/  bridges/  hooks/  plugins/
L2 ─ observability/  config/
L1 ─ audit/  sdk/
L0 ─ core/  db/  events/  types/
```

### 1.2 Grafo de Imports (Direções Canônicas = ↓, Violações = ⚠️)

```
terminal/ ──→ services/
     │    ──→ core/
     │    ──→ config/           (bypass services/)
     │    ──→ agent/            ⚠️ bypass via services/index re-exports
     │    ──→ conversation-hub/ ⚠️ bypass via services/index re-exports
     │    ──→ observability/    ⚠️ bypass
     │    ──→ hooks/            (L6→L3)
     │    ──→ tools/            (L6→L3)
     └──→ events/              OK

api/ ──→ services/
   │ ──→ core/
   │ ──→ agent/                ⚠️ bypass
   │ ──→ conversation-hub/     ⚠️ bypass
   │ ──→ observability/        ⚠️ bypass
   │ ──→ hooks/
   └──→ events/

services/ ──→ agent/
         │──→ conversation-hub/
         │──→ sdk/
         │──→ observability/
         │──→ tools/
         │──→ hooks/
         │──→ bridges/
         └──→ core/

agent/ ──→ sdk/
      │──→ core/
      │──→ hooks/
      │──→ tools/
      │──→ observability/
      │──→ bridges/
      └──→ config/

conversation-hub/ ──→ channel/
                  │──→ sdk/
                  │──→ core/
                  │──→ hooks/
                  └──→ observability/

bridges/ ──→ core/
        │──→ sdk/
        │──→ hooks/
        │──→ tools/
        └──→ observability/

hooks/ ──→ core/
      │──→ tools/
      │──→ observability/
      │──→ config/
      │──→ audit/
      └──→ events/

tools/ ──→ core/
      │──→ sdk/
      │──→ hooks/
      │──→ config/
      │──→ bridges/
      └──→ observability/

sdk/ ──→ core/

observability/ ──→ core/
              │──→ events/
              │──→ audit/
              │──→ config/
              └──→ db/

config/ ──→ core/
       │──→ observability/ ⚠️ CICLO (config↔observability)
       └──→ db/

audit/ ──→ core/
      │──→ events/
      └──→ db/

core/ ──→ (nenhum — leaf module) ✅
events/ ──→ (nenhum — leaf module) ✅
types/ ──→ (nenhum — leaf module) ✅
db/ ──→ (nenhum — leaf module) ✅
```

### 1.3 Ciclos Detectados

| Ciclo                                | Tipo                     | Severidade |
| ------------------------------------ | ------------------------ | ---------- |
| `config/ → observability/ → config/` | Circular                 | 🟡 Médio    |
| `tools/ → bridges/ → tools/`         | Potencial (via indirect) | 🟢 Baixo    |
| `hooks/ → tools/ → hooks/`           | Potencial (via configs)  | 🟢 Baixo    |

**Ciclo real confirmado**: `config/env.js` importa de `observability/` para logging, e `observability/` importa de `config/` para configuração. Quebrar via DI injection.

---

## 2. Fan-out e Fan-in por Módulo

### 2.1 Fan-out (quantos módulos eu importo)

```
          terminal/   ████████████████  8
          services/   ████████████████  8
             agent/   ██████████████    7
               api/   ████████████      6
             tools/   ████████████      6
             hooks/   ████████████      6
           bridges/   ██████████        5
     observability/   ██████████        5
  conversation-hub/   ██████████        5
           channel/   ████████          4
            config/   ██████            3
             audit/   ██████            3
            events/   ──                0
             types/   ──                0
              core/   ██                1
               sdk/   ██                1
                db/   ██                1
           plugins/   ██                1
```

**Nota**: terminal/ e services/ estão no limite de 8. Qualquer nova dependência viola fan-out max.

### 2.2 Fan-in (quantos módulos me importam)

```
              core/   ████████████████████████  12+ (todos)
               sdk/   ██████████████            7  (agent, services, conv-hub, bridges, tools, channel, hooks)
            events/   ████████                  4  (observability, hooks, audit, terminal)
   observability/     █████████████             6+ (agent, services, hooks, bridges, config, conv-hub)
            hooks/     █████████████            6+ (agent, services, tools, bridges, conv-hub, api)
            tools/     ████████████             6  (agent, services, hooks, bridges, terminal, api)
          services/   █████████                 4+ (terminal, api, hooks, bridges)
            agent/    ██████                    3+ (services, terminal, api) ⚠️ bypasses
      conversation-hub/ ████                   2+ (services, api, terminal) ⚠️ bypasses
           bridges/   ████                     2+ (agent, tools)
           config/    ████████                 4+ (agent, hooks, tools, observability)
            audit/    ████                     2  (observability, hooks)
           channel/   ██                       1  (conversation-hub)
                db/   ██████                   3  (audit, observability, config)
          plugins/    ──                       0  ⚠️ ORPHAN
            types/    ──                       0  ⚠️ ORPHAN
```

---

## 3. Topologia de Eventos (Estado Real)

### 3.1 Event Flow — Quem Emite, Quem Escuta

```
EMISSORES (BaseEmitter local)           SUBSCRIBERS (via .on())
══════════════════════════              ══════════════════════════

always-alive.js ──emit('ready')───→    bridges/nerv-bridge.js
                ──emit('stopped')──→   terminal/state.js
                ──emit('error')────→   observability/collectors/session-handlers.js

loop-manager.js ──emit('turn_start')─→ observability/observers/dialog-task-handlers.js
                ──emit('turn_end')───→ observability/observers/dialog-task-handlers.js
                ──emit('tool_use')───→ observability/observers/dialog-task-handlers.js

orchestrator.js ──emit('session:created')─→ conv-hub/socket-ns.js
                ──emit('turn:sent')───────→ conv-hub/socket-ns.js
                ──emit('turn:complete')───→ conv-hub/socket-ns.js

hooks/bus.js ──emit('pre_tool_use')──→ hooks/presets/*.js
             ──emit('session_start')─→ hooks/presets/*.js

state.js ──emit('stateChanged')──→ terminal/server.js (SSE)

fanout.js ──emit('data')──→ api/sse/* (broadcast)

pinned-files.js ──emit('changed')──→ config/custom-agents.js
```

### 3.2 Event Topology — Centralidade

**Sem EventBus**, a topologia é um grafo esparso de conexões 1:1 via `.on()`:

```
Centralidade (betweenness):
  always-alive.js    ████████████  3 listeners (mais conectado)
  loop-manager.js    ████████████  3 listeners
  orchestrator.js    ████████████  3 listeners
  hooks/bus.js       ████████      2 listeners
  state.js           ████          1 listener
  fanout.js          ████          1 listener
  pinned-files.js    ████          1 listener
```

**Problema**: Nenhum centralidad real. São 7 "mini event buses" desconectados entre si.
Um subscriber de um emissor não consegue observar eventos de outro.

### 3.3 Topologia Ideal (com EventBus centralizado + bridges)

```
                    ┌──────────────────────────────────┐
                    │           EventBus (central)     │
                    │   agent:*  dialog:*  session:*   │
                    │   hook:*   terminal:* system:*   │
                    └──────┬───────┬───────┬───────────┘
                           │       │       │
            ┌──────────────┤       │       ├──────────────┐
            │              │       │       │              │
    ┌───────▼──┐    ┌──────▼──┐  ┌─▼──────┐    ┌────────▼──────┐
    │ always-  │    │ loop-   │  │ orchest-│    │ hooks/bus     │
    │ alive.js │    │ manager │  │ rator   │    │               │
    │ (bridge) │    │(bridge) │  │(bridge) │    │ (bridge)      │
    └──────────┘    └─────────┘  └─────────┘    └───────────────┘
            ↕               ↕            ↕              ↕
    emit local      emit local    emit local     emit local
    + bridge→Bus    + bridge→Bus  + bridge→Bus   + bridge→Bus

                    SUBSCRIBERS (via EventBus.on)
                    ═══════════════════════════
                    observability/* ──→ subscribe('agent:*', 'dialog:*')
                    terminal/* ──→ subscribe('agent:ready', 'agent:stopped')
                    bridges/* ──→ subscribe('agent:ready')
                    api/sse/* ──→ subscribe('session:*', 'turn:*')
                    audit/* ──→ subscribe('*') // all events
```

Nesta topologia, **qualquer subscriber pode observar qualquer evento** sem acoplamento direto com o emissor.

---

## 4. Grafo de Singletons

### 4.1 Mapa de 25 Singletons `let X = null`

| Módulo           | Singletons | Instâncias                                             |
| ---------------- | ---------- | ------------------------------------------------------ |
| `sdk/`           | 5          | session, client, agentStore, toolRegistry, turnManager |
| `agent/`         | 4          | alwaysAliveAgent, taskQueue, taskExecutor, dialogLoop  |
| `bridges/`       | 3          | nervBridge, mcpBridge, copilotKitBridge                |
| `observability/` | 3          | metricsStore, sessionCollector, dialogCollector        |
| `terminal/`      | 3          | replInstance, serverInstance, stateManager             |
| `db/`            | 3          | sqliteDb, migrationRunner, connectionPool              |
| `audit/`         | 2          | auditPipeline, auditLog                                |
| `hooks/`         | 2          | hookBus, hookRegistry                                  |

### 4.2 Singletons que Deveriam ser DI

| Singleton        | Convertibilidade | Blocker                              |
| ---------------- | ---------------- | ------------------------------------ |
| alwaysAliveAgent | Alta             | Nenhum — já tem DI token AGENT       |
| nervBridge       | Alta             | Nenhum — já tem DI token NERV_BRIDGE |
| mcpBridge        | Alta             | Nenhum — já tem DI token MCP_BRIDGE  |
| hookBus          | Alta             | Nenhum — já tem DI token HOOK_BUS    |
| metricsStore     | Média            | Importado por 6+ arquivos sem DI     |
| sqliteDb         | Média            | Lifetime diferente (boot-time)       |

**Dos 25 singletons, ~12 já têm DI tokens criados mas continuam usando pattern `let X = null`**.
O DI token existe, mas ninguém usa `container.resolve(TOKEN)` para obtê-los.

---

## 5. Dependency Clusters (Módulos Fortemente Acoplados)

### Cluster 1: Agent ↔ SDK ↔ Tools ↔ Hooks
```
agent/ ←→ sdk/ ←→ tools/ ←→ hooks/
  │              ↑            │
  └──────────────┘────────────┘
```
- 4 módulos mutuamente dependentes
- Fan-out total: 26 edges dentro do cluster
- **Risco**: Mudança em sdk/ propaga para agent/, tools/, hooks/

### Cluster 2: Services ↔ Agent ↔ Conversation-Hub
```
services/ ←→ agent/ ←→ conversation-hub/
     └────→ conversation-hub/
```
- 3 módulos, services/ deveria mediar, mas agent/ e conv-hub/ exportam direto

### Cluster 3: Observability ↔ Config ↔ Audit
```
observability/ ←→ config/ (CICLO!)
       └────→ audit/
       └────→ db/
```
- Ciclo real: config importa observability para logging, observability importa config para setup

---

## 6. Métricas de Grafo (Resumo)

| Métrica              | Valor                          | Target Ideal           |
| -------------------- | ------------------------------ | ---------------------- |
| Módulos (nodos)      | 20                             | 18-22                  |
| Edges (imports)      | ~65                            | ~50                    |
| Max fan-out          | 8 (terminal, services)         | 6                      |
| Max fan-in           | 12+ (core/)                    | OK (core é foundation) |
| Ciclos reais         | 1 (config↔observability)       | 0                      |
| Ciclos potenciais    | 2 (tools↔bridges, hooks↔tools) | 0                      |
| Orphan modules       | 2 (plugins, types)             | 0                      |
| Módulos com fan-in=0 | 3 (plugins, types, logs)       | 0                      |
| Singletons           | 25                             | ≤10                    |
| DI tokens unused     | ~12                            | 0                      |
| Events via EventBus  | 0 cross-module                 | 100% cross-module      |
| Coupling clusters    | 3                              | ≤1                     |
