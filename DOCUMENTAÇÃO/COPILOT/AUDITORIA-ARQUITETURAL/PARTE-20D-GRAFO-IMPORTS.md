# PARTE-20D — Grafo de Imports: Situação Atual e Ideal

**Data**: 2026-04-10 | **Status**: Canônico | **Versão**: 1.0

---

## 1. Convenções do Grafo

```
→       dependência direta (A importa de B)
⟺       dependência bidirecional (ciclo arquitetural)
🔴 →    violação de camada
⚠️ →    acoplamento questionável
✅ →    dependência correta e esperada
```

Cada nó representa um **módulo de nível 1** de `src/copilot`. Arestas com número indicam quantidade de cross-module import edges.

---

## 2. Grafo Atual — Dependências Entre Módulos

### 2.1 Representação Textual

```
╔══════════════════════════════════════════════════════════════════════╗
║              GRAFO DE DEPENDÊNCIAS ATUAL — src/copilot               ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                       ║
║  [INFRA EXTERNA]                                                      ║
║  @github/copilot-sdk ──→ sdk/                                        ║
║  SQLite             ──→ db/                                          ║
║  git/gh CLI         ──→ bridges/ (git-bridge, gh/)                  ║
║  MCP Servers        ──→ bridges/ (mcp-tool-bridge)                  ║
║  NERV EventBus      ⟺  bridges/nerv-bridge ←🔴→ agent/              ║
║                                                                       ║
║  [CAMADA L0 — NÚCLEO]                                                 ║
║  ┌─────────────────────────────────────────────────────────────────┐ ║
║  │  core/  (error-handlers, retry, schemas, safe-json, timers...) │ ║
║  │      🔴→ observability/logger, error-tracker  ← VIOLAÇÃO       │ ║
║  └─────────────────────────────────────────────────────────────────┘ ║
║                     ↑ 12×        ↑ 9×       ↑ 7×                    ║
║                   agent/      terminal/     sdk/                     ║
║                                                                       ║
║  [CAMADA L1 — SDK / DB]                                              ║
║  sdk/  ──✅→ core/  (7 edges)                                        ║
║  db/   ──✅→ core/  (1 edge)                                         ║
║                                                                       ║
║  [CAMADA L2 — CONFIG / AUDIT]                                        ║
║  config/ ──✅→ core/                                                 ║
║  audit/  ──✅→ core/                                                 ║
║                                                                       ║
║  [CAMADA L3 — HOOKS / OBSERVABILITY]                                 ║
║  hooks/        ──✅→ core/, config/, sdk/                            ║
║  observability/──✅→ core/                                           ║
║                  ── ⚠️→ agent/ (agent-event-observer — 1 edge)       ║
║                                                                       ║
║  [CAMADA L4 — TOOLS / BRIDGES]                                       ║
║  tools/   ──✅→ sdk/, core/                                          ║
║  bridges/ ──✅→ core/, db/, sdk/                                     ║
║            ──🔴→ agent/ (nerv-bridge importa agent/index.js)         ║
║                                                                       ║
║  [CAMADA L5 — AGENT / HUB]                                           ║
║  agent/   ──✅→ core/ (12 edges)                                     ║
║            ──✅→ sdk/ (1 edge)                                        ║
║            ──✅→ config/ (1 edge)                                    ║
║            ──✅→ hooks/ (via tool bootstrap)                         ║
║            ──✅→ observability/ (via logger)                         ║
║            ──⚠️→ tools/ (agent carrega tools — aceitável)            ║
║            ──⚠️→ bridges/ (agent usa git/nerv — questionável)        ║
║            ──⚠️→ conversation-hub/ (1 edge)                          ║
║            ──🔴→ terminal/ (agent-lifecycle importa terminal/state)  ║
║                                                                       ║
║  conversation-hub/ ──✅→ core/ (1 edge)                              ║
║                     ──⚠️→ channel/ (1 edge)                          ║
║                     ──⚠️→ db/ (store usa sqlite)                     ║
║                                                                       ║
║  [CAMADA L6 — CHANNEL / API]                                         ║
║  channel/ ──✅→ core/ (3 edges)                                      ║
║             ──⚠️→ agent/ (usa alwaysAliveAgent)                      ║
║                                                                       ║
║  api/ ──✅→ core/ (1 edge)                                           ║
║        ──⚠️→ agent/ (5 express routes usam alwaysAliveAgent)         ║
║        ──⚠️→ observability/ (express/observability.js)               ║
║                                                                       ║
║  [CAMADA L7 — TERMINAL]                                              ║
║  terminal/ ──✅→ core/ (9 edges)                                     ║
║              ──⚠️→ agent/ (3 edges — alwaysAliveAgent)               ║
║              ──⚠️→ tools/ (2 edges)                                  ║
║              ──⚠️→ channel/ (2 edges)                                ║
║              ──⚠️→ conversation-hub/ (2 edges)                       ║
║              ──⚠️→ bridges/ (1 edge)                                 ║
║              ──⚠️→ config/ (1 edge)                                  ║
║              ──⚠️→ api/ (1 edge)                                     ║
║                                                                       ║
╚══════════════════════════════════════════════════════════════════════╝
```

### 2.2 Tabela Resumo de Arestas Cross-Module

| De | Para | Edges | Status |
|---|---|---|---|
| agent | core | 12 | ✅ |
| terminal | core | 9 | ✅ |
| sdk | core | 7 | ✅ |
| channel | core | 3 | ✅ |
| observability | core | 3 | ✅ |
| terminal | agent | 3 | ⚠️ Bidirecional com violação |
| agent | bridges | 2 | ⚠️ |
| core | observability | 2 | 🔴 VIOLAÇÃO |
| terminal | tools | 2 | ⚠️ |
| terminal | channel | 2 | ⚠️ |
| terminal | conversation-hub | 2 | ⚠️ |
| tools | sdk | 2 | ✅ |
| agent | conversation-hub | 1 | ⚠️ |
| agent | terminal | 1 | 🔴 VIOLAÇÃO |
| agent | sdk | 1 | ✅ |
| agent | config | 1 | ✅ |
| agent | tools | 1 | ⚠️ |
| api | core | 1 | ✅ |
| bridges | agent | 1 | 🔴 VIOLAÇÃO |
| config | core | 1 | ✅ |
| conversation-hub | channel | 1 | ⚠️ |
| conversation-hub | core | 1 | ✅ |
| db | core | 1 | ✅ |
| terminal | bridges | 1 | ⚠️ |
| terminal | config | 1 | ✅ |
| terminal | api | 1 | ⚠️ |

---

## 3. Grafo Ideal — Arquitetura Target

### 3.1 Princípios de Reestruturação

1. **Sem dependência upward**: camadas inferiores nunca importam de superiores
2. **Bridges não dependem de agent**: bridges são adaptadores passivos
3. **core não depende de ninguém** interno ao sistema
4. **terminal não é importado por ninguém** — é a camada mais alta
5. **agent recebe dependências por injeção** — não busca singletons de outros módulos
6. **Shared state** (ex: hubSessionId) vive em `core/shared-state.js` acessível por todos

### 3.2 Nova Hierarquia de Camadas

```
L0  core/          ← zero dependências internas
L0  db/            ← depende só de core
L1  sdk/           ← depende de core
L1  audit/         ← depende de core
L2  config/        ← depende de core, sdk
L2  observability/ ← depende de core (logger injeta via bootstrap, não via import estático)
L3  hooks/         ← depende de core, config, sdk
L3  tools/         ← depende de core, sdk
L3  bridges/       ← depende de core, db (git), sdk (models) — sem agent
L4  agent/         ← depende de core, sdk, config, hooks, tools, observability, audit
L4  conversation-hub/ ← depende de core, db, sdk
L5  channel/       ← depende de core, agent (via injeção na factory)
L5  api/           ← depende de core, agent (via injeção na factory)
L6  terminal/      ← depende de tudo —  camada de apresentação
```

### 3.3 Representação Textual do Grafo Ideal

```
╔══════════════════════════════════════════════════════════════════════╗
║              GRAFO DE DEPENDÊNCIAS IDEAL — src/copilot               ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                       ║
║  [INFRA EXTERNA]                                                      ║
║  @github/copilot-sdk ──→ sdk/                                        ║
║  SQLite             ──→ db/                                          ║
║  git/gh CLI         ──→ bridges/git/  (módulo dedicado)             ║
║  MCP Servers        ──→ bridges/mcp/  (módulo dedicado)             ║
║  NERV EventBus      ──→ bridges/nerv/ (publisher passivo)           ║
║                                                                       ║
║  [L0 — NÚCLEO PURO]                                                   ║
║  ┌─────────────────────────────────────────────────────────────────┐ ║
║  │  core/  — util puro, errors, retry, schemas, safe-json, timers │ ║
║  │  SEM dependências internas                                      │ ║
║  └─────────────────────────────────────────────────────────────────┘ ║
║  ┌─────────────────────────────────────────────────────────────────┐ ║
║  │  db/    — SQLite, migrations                                    │ ║
║  │  → core/                                                        │ ║
║  └─────────────────────────────────────────────────────────────────┘ ║
║                                                                       ║
║  [L1 — SDK / AUDIT]                                                   ║
║  sdk/   ──→ core/                                                     ║
║  audit/ ──→ core/                                                     ║
║                                                                       ║
║  [L2 — CONFIG / OBSERVABILITY]                                        ║
║  config/        ──→ core/, sdk/                                       ║
║  observability/ ──→ core/                                             ║
║  (logger é registrado via bootstrap — sem import estático em core)    ║
║                                                                       ║
║  [L3 — HOOKS / TOOLS / BRIDGES]                                       ║
║  hooks/   ──→ core/, config/, sdk/                                    ║
║  tools/   ──→ core/, sdk/                                             ║
║  bridges/ ──→ core/, db/, sdk/models                                  ║
║  (bridges NÃO importa agent)                                          ║
║                                                                       ║
║  [L4 — AGENT / HUB]                                                   ║
║  agent/ ──→ core/ (12)                                                ║
║           ──→ sdk/                                                    ║
║           ──→ config/                                                 ║
║           ──→ hooks/                                                  ║
║           ──→ tools/                                                  ║
║           ──→ observability/                                          ║
║           ──→ audit/                                                  ║
║  (agent NÃO importa terminal, NÃO importa bridges diretamente)        ║
║  (bridges são registradas via hooks/tools ao agent — não acopladas)   ║
║                                                                       ║
║  conversation-hub/ ──→ core/, db/                                     ║
║                                                                       ║
║  [L5 — CHANNEL / API]                                                 ║
║  channel/ ──→ core/ + agent (injetado como factory param)            ║
║  api/     ──→ core/ + agent (injetado como router factory param)     ║
║  (sem import direto de alwaysAliveAgent singleton)                    ║
║                                                                       ║
║  [L6 — TERMINAL — camada de apresentação]                            ║
║  terminal/ ──→ tudo acima (somente leitura/orquestração)             ║
║  (terminal NÃO é importado por ninguém)                               ║
║                                                                       ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## 4. Delta: Atual → Ideal

### 4.1 Dependências a Remover (Violações)

| Aresta a remover | Arquivo concreto | Alternativa |
|---|---|---|
| `core` → `observability` | `core/error-handlers.js` importa `observability/error-tracker.js` e `observability/logger.js` | `error-handlers.js` recebe `logger` por parâmetro; observability registra handler via `core.onError()` callback |
| `agent` → `terminal` | `agent/lifecycle/agent-lifecycle.js` importa `terminal/state.js` | `getHubSessionId` injetada via parâmetro ou `core/shared-state.js` |
| `bridges` → `agent` | `bridges/nerv-bridge.js` importa `agent/index.js` | nerv-bridge escuta eventos do NERV — o agent publica; remover import do agent |

### 4.2 Dependências a Ajustar (Acoplamentos)

| Aresta | Situação | Correção |
|---|---|---|
| `api` → `agent` | Express routes importam `alwaysAliveAgent` singleton | Injetar `agent` no router via factory: `createRouter(agent)` |
| `channel` → `agent` | `channel/client.js` importa singleton | `new LlmBridgeClient(agent)` — DI explícita |
| `terminal` → `agent` | 3 pontos importam `alwaysAliveAgent` diretamente | Terminal recebe `agent` no bootstrap — sem import direto |
| `observability` → `agent` | `agent-event-observer.js` importa agent internals | Observer recebe agent como parâmetro |
| `conversation-hub` → `channel` | Hub importa channel diretamente | Comunicação via eventos — sem import direto |
| `agent` → `bridges` | Agent importa nerv e git bridges | Bridges registradas via hooks/tools registry |

### 4.3 Novas Arestas Necessárias (Adições)

| Nova aresta | Justificativa |
|---|---|
| `core/shared-state.js` | Módulo L0 para shared state mínimo (ex.: hubSessionId) acessível sem violar layers |
| `core` ← bootstrapper injects logger | `observability/bootstrap.js` chama `core.registerErrorHandler(fn)` |

---

## 5. Métricas Comparativas

| Métrica | Atual | Ideal |
|---|---|---|
| Violações de camada | 3 | **0** |
| Ciclos arquiteturais (nível módulo) | 3 | **0** |
| Cross-module dependency edges | 26 | **≤ 16** |
| Módulos com dependência bidirecional | 3 | **0** |
| Módulos com import de singleton mutable | 8+ | 0 (DI explícita) |
