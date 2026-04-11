# PARTE-21A — Situação Atual: Auditoria Arquitetural Profunda de `src/copilot`

**Data**: 2026-04-12 | **Status**: BASELINE (congelado pré-Faixa H) | **Versão**: 2.0
**Scope**: Todo o diretório `src/copilot` — 287 arquivos `.js`, ~51.600 LoC (inclui JSDoc robusto)
**Precedente**: PARTE-20A (análise pré-roadmap), PARTE-20C (roadmap executado, v1.5 CONCLUÍDO)

> **⚠️ ATENÇÃO**: Este documento é o **baseline pré-execução** das Faixas H–N.
> Para o estado atual (pós-execução), ver **PARTE-21F-STATUS-POS-EXECUCAO.md**.
> Métricas atuais: 313 arquivos, 53.815 LoC, 17 módulos, 108 testes, Health Score 65/100.

---

## 1. Resumo Executivo

O roadmap PARTE-20 foi **completamente executado** (Faixas A–G). O sistema `src/copilot` passou de
um estado com 27 violações de camada, god objects, duplicações e fronteiras indefinidas para um
estado com **0 violações detectadas pelo CI**, JSDoc robusto, READMEs completos e testes de contrato.

Porém, esta auditoria profunda revela problemas estruturais significativos que vão além das
violações de camada:

1. **Script de CI com gap de regex** — ignora `export { } from`, ocultando 9+ re-exports cross-module
2. **233 imports profundos** (72% do total) bypassam barrels, gerando acoplamento fino
3. **25 arquivos >400 LoC (raw)** com god objects disfarçados por JSDoc volumoso
4. **~30 singletons com estado global mutável** espalhados por 10+ módulos
5. **70 arquivos** usam EventEmitter diretamente, sem bus centralizado
6. **22 DI setters** com padrão inconsistente (setter vs factory vs bootstrap)
7. **api/** com fan-out de 11 módulos — mega-aggregator sem camada de serviço

Estas descobertas indicam que, embora a superfície (camadas, JSDoc, READMEs) esteja limpa, a
**microarquitetura interna** tem dívida técnica substancial que limita testabilidade, refatoração
e evolução para upgrades futuros significativos.

---

## 2. Métricas Quantitativas

### 2.1 Inventário de Módulos (detalhado)

| Módulo              | Layer | Arquivos | LoC        | Top file (LoC raw)          | Função                                        |
| ------------------- | ----- | -------- | ---------- | --------------------------- | --------------------------------------------- |
| `agent/`            | L4    | 54       | 7.775      | always-alive.js (603)       | Core agent: lifecycle, session, dialog, infra |
| `sdk/`              | L1    | 40       | 7.696      | types.js (569)              | Wrapper @github/copilot-sdk — SSOT runtime    |
| `terminal/`         | L6    | 46       | 7.645      | index.js (494)              | Terminal interativo LLM-B: REPL, server, cmds |
| `tools/`            | L3    | 24       | 6.236      | todo/crud-tools.js (459)    | Definição de Tools do agente                  |
| `observability/`    | L2    | 22       | 4.535      | metrics.js (426)            | Logging, métricas, alertas, traces            |
| `hooks/`            | L3    | 20       | 3.526      | factory.js (416)            | Sistema de permissão e lifecycle              |
| `api/`              | L5    | 21       | 3.309      | session-crud.js (371)       | Camada HTTP (Express) + SSE                   |
| `conversation-hub/` | L4    | 12       | 2.592      | store.js (562)              | Hub de conversas entre LLMs                   |
| `bridges/`          | L3    | 10       | 2.233      | nerv-bridge.js (434)        | Pontes: MCP, NERV, Git, GitHub                |
| `core/`             | L0    | 16       | 1.921      | structured-message.js (387) | Utilitários cross-cutting: erros, retry, etc. |
| `channel/`          | L4    | 7        | 1.497      | client.js (557)             | Client LLM-A ↔ LLM-B                          |
| `config/`           | L2    | 7        | 1.418      | custom-agents.js (325)      | Configuração do SDK/agente                    |
| `audit/`            | L1    | 5        | 812        | pipeline.js (559)           | Pipeline de auditoria com ring buffer         |
| `db/`               | L0    | 3        | 437        | sqlite.js (234)             | Persistência SQLite                           |
| **Total**           |       | **287**  | **51.632** |                             |                                               |

### 2.2 Saúde Macro

| Métrica                          | PARTE-20 (antes) | Atual (pós-roadmap) | Meta ideal |
| -------------------------------- | ---------------- | ------------------- | ---------- |
| Violações de camada (CI)         | 27               | **0** ✅             | 0          |
| Re-exports cross-layer (ocultos) | —                | **9+** 🔴            | 0          |
| Arquivos >400 LoC (raw)          | —                | **25** 🔴            | ≤5         |
| Arquivos >300 LoC (código ativo) | —                | **9** ⚠️             | ≤5         |
| Duplicações de responsabilidade  | 6                | **0** ✅             | 0          |
| Módulos sem README               | 14               | **0** ✅             | 0          |
| Módulos com JSDoc barrel         | 0                | **14/14** ✅         | 14/14      |
| CI gates (automação)             | 0                | **2** ✅             | 5+         |
| Testes de contrato               | 0                | **6** ✅             | 20+        |

### 2.3 Saúde Micro (novos indicadores)

| Métrica                             | Valor         | Avaliação       | Meta ideal  |
| ----------------------------------- | ------------- | --------------- | ----------- |
| Imports cross-module (total)        | **389**       | —               | —           |
| Barrel imports (via index)          | **88** (23%)  | 🔴 Baixo         | ≥80%        |
| Deep imports (bypassing barrel)     | **233** (60%) | 🔴 Alto          | ≤20%        |
| Re-export imports                   | **68** (17%)  | ⚠️               | ≤10%        |
| Singletons com `let X = null`       | **~30**       | 🔴               | ≤10         |
| Arquivos usando EventEmitter        | **70**        | ⚠️               | ≤30         |
| DI setters (`export function set*`) | **22**        | ⚠️ Inconsistente | Padronizado |
| Bootstrap functions                 | **3**         | ✅               | —           |
| Global `let` state variables        | **30+**       | 🔴               | ≤10         |

### 2.4 Distribuição dos Deep Imports por Target

| Target Module  | Deep imports recebidos | % do total | Observação                              |
| -------------- | ---------------------- | ---------- | --------------------------------------- |
| observability/ | 134                    | 57%        | Logger importado direto por quase todos |
| core/          | 57                     | 24%        | Utilitários granulares                  |
| config/        | 43                     | 18%        | env.js importado diretamente            |
| audit/         | 12                     | 5%         | pipeline.js direto                      |
| hooks/         | 11                     | 5%         | factory/permission direto               |
| bridges/       | 10                     | 4%         | Deep-link para bridges/gh/              |
| tools/         | 7                      | 3%         |                                         |
| sdk/           | 6                      | 3%         |                                         |
| channel/       | 5                      | 2%         |                                         |
| db/            | 2                      | 1%         |                                         |

**Observação crítica**: `observability/logger` sozinho recebe 134 deep imports. Este padrão,
embora aceitável para logger (performance/DX), estabelece precedente que se espalha e enfraquece
o valor dos barrels.

---

## 3. Hierarquia de Camadas

### 3.1 Hierarquia CI-enforced

```
L6  terminal/            — REPL interativo, camada de apresentação
L5  api/                 — HTTP/SSE/Express
L4  agent/               — AlwaysAlive + session + dialog
L4  conversation-hub/    — gestão multi-sessão
L4  channel/             — transporte LLM-A ↔ LLM-B
L3  hooks/               — permissões/lifecycle
L3  tools/               — definição de Tools
L3  bridges/             — adaptadores externos
L2  config/              — configuração do sistema
L2  observability/       — logging/métricas
L1  sdk/                 — wrapper @github/copilot-sdk
L1  audit/               — pipeline auditoria
L0  core/                — utilitários puros
L0  db/                  — SQLite
```

### 3.2 Análise de Fan-in / Fan-out / Estabilidade

| Módulo              | Fan-in | Fan-out | Estabilidade (I) | Classificação           |
| ------------------- | ------ | ------- | ---------------- | ----------------------- |
| `core/`             | 12     | 1 ⚠️     | 0.92             | Leaf node (quase puro)  |
| `db/`               | 3      | 1       | 0.75             | Leaf node               |
| `audit/`            | 6      | 2       | 0.75             | Estável                 |
| `sdk/`              | 10     | 3 ⚠️     | 0.77             | Alta dependência in     |
| `config/`           | 11     | 3       | 0.79             | Hub de configuração     |
| `observability/`    | 10     | 4       | 0.71             | Hub de logging          |
| `hooks/`            | 3      | 5       | 0.38             | Alta dependência out    |
| `tools/`            | 3      | 6       | 0.33             | Alta dependência out    |
| `bridges/`          | 2      | 4       | 0.33             | Adaptadores             |
| `channel/`          | 2      | 3       | 0.40             | Equilibrado             |
| `conversation-hub/` | 2      | 4       | 0.33             | Alta dependência out    |
| `agent/`            | 2      | 7       | 0.22             | Orquestrador (esperado) |
| `api/`              | 1      | 11      | 0.08             | Mega-aggregator (smell) |
| `terminal/`         | 0      | 10      | 0.00             | Root (esperado)         |

> Fórmula: I = fan_in / (fan_in + fan_out). Valores altos = módulos estáveis (muitos dependem,
> poucos deps). Valores baixos = módulos instáveis (poucas deps in, muitas out).

**Observações**:
- `api/` com fan-out de **11 módulos** é mega-aggregator — potencial god module
- `core/` com fan-out 1 deveria ser **0** (leaf node absoluto)
- `hooks/` e `tools/` estabilidade ~0.33 — vulneráveis a cascading changes

---

## 4. Problemas Detectados — Deep Dive

### 4.1 CRÍTICO — Gap de Cobertura do CI para Dependências

#### 4.1.1 Script de CI com regex incompleta

O `scripts/check-layer-violations.mjs` usa:
```js
const importRegex = /^\s*import\s.*from\s+['"]([^'"]+)['"]/gm;
```

**Não detecta**:
- `export { X } from '...'` — re-export nomeado (9 instâncias encontradas)
- `export * from '...'` — re-export total (0 instâncias hoje)
- `import('...')` — dynamic import
- `require('...')` — CommonJS (não usado)

#### 4.1.2 Inventário completo de re-exports cross-module

| #   | Fonte                          | Target                                 | Dir   | Sev |
| --- | ------------------------------ | -------------------------------------- | ----- | --- |
| 1   | `core/constants.js`            | `#copilot/config/env`                  | L0→L2 | 🔴   |
| 2   | `sdk/index.js`                 | `#copilot/hooks/factory`               | L1→L3 | 🔴   |
| 3   | `sdk/index.js`                 | `#copilot/hooks/permission`            | L1→L3 | 🔴   |
| 4   | `sdk/config.js`                | `#copilot/config/session-config` (×2)  | L1→L2 | 🟠   |
| 5   | `sdk/index.js`                 | `#copilot/core/security/url-validator` | L1→L0 | ✅   |
| 6   | `hooks/index.js`               | `#copilot/audit`                       | L3→L1 | ✅   |
| 7   | `observability/index.js`       | `#copilot/audit/pipeline`              | L2→L1 | ✅   |
| 8   | `agent/infra/index.js`         | `#copilot/audit/pipeline`              | L4→L1 | ✅   |
| 9   | `agent/infra/index.js`         | `#copilot/core/security/url-validator` | L4→L0 | ✅   |
| 10  | `agent/infra/url-validator.js` | `#copilot/core/security/url-validator` | L4→L0 | ✅   |
| 11  | `agent/infra/tools-bootstrap`  | `#copilot/tools/index`                 | L4→L3 | ✅   |

**Violações reais** (import ascendente): #1 (L0→L2), #2-3 (L1→L3), #4 (L1→L2) = **4 violações**

### 4.2 ALTO — 25 Arquivos >400 LoC (raw)

#### Todos os 25 arquivos com análise de concerns

| #   | Arquivo                                 | LoC | Concerns                       | Ação recomendada                  |
| --- | --------------------------------------- | --- | ------------------------------ | --------------------------------- |
| 1   | `agent/always-alive.js`                 | 603 | Classe + singleton + lifecycle | Split: class / singleton          |
| 2   | `agent/dialog/loop-manager.js`          | 600 | Classe monolítica              | Split: control / events           |
| 3   | `sdk/types.js`                          | 569 | Typedefs JSDoc only            | Split por domain                  |
| 4   | `conversation-hub/store.js`             | 562 | Class + singleton + queries    | Split: store / queries            |
| 5   | `audit/pipeline.js`                     | 559 | 9 exports multi-concern        | 🔴 Split: pipeline / audit-helpers |
| 6   | `channel/client.js`                     | 557 | Classe + DI setter             | Split: class / connection         |
| 7   | `terminal/index.js`                     | 494 | Bootstrap + lifecycle + timer  | 🔴 Split: bootstrap / lifecycle    |
| 8   | `sdk/rpc.js`                            | 484 | Facade grande                  | Split: rpc-core / rpc-ops         |
| 9   | `conversation-hub/socket-ns.js`         | 482 | 5 exports (mount/bcast)        | Split: mount / broadcast          |
| 10  | `tools/todo/crud-tools.js`              | 459 | 6 tool definitions             | 🔴 Split por tool pair             |
| 11  | `terminal/server.js`                    | 452 | Server factory                 | Split: http / ws                  |
| 12  | `channel/inject.js`                     | 451 | Subscribe + handlers           | Split: subscribe / handle         |
| 13  | `conversation-hub/orchestrator.js`      | 438 | Class Orchestrator + DI        | Avaliar: single concern?          |
| 14  | `terminal/repl.js`                      | 437 | REPL loop + handlers           | Split: repl / handlers            |
| 15  | `bridges/nerv-bridge.js`                | 434 | 8 exports multi-concern        | Split: bridge / events            |
| 16  | `bridges/mcp-tool-bridge.js`            | 433 | MCP integration                | Split: bridge / reconnect         |
| 17  | `bridges/git-bridge.js`                 | 428 | 3 formatters + bridge          | Split: format / exec              |
| 18  | `observability/metrics.js`              | 426 | MetricsStore + factory         | Avaliar coesão                    |
| 19  | `observability/observers/dialog-task-*` | 424 | Handler bundle                 | Split por event type              |
| 20  | `tools/todo/store.js`                   | 423 | TodoStore + schemas + helpers  | Split: store / schema             |
| 21  | `sdk/client.js`                         | 416 | Client singleton + ops         | Split: client / client-ops        |
| 22  | `hooks/factory.js`                      | 416 | 7 factory functions            | Split: create / compose           |
| 23  | `tools/introspection-tools.js`          | 409 | Tool definitions               | Split: session / system           |
| 24  | `tools/file/read-tools.js`              | 405 | Tool definitions               | Split: read / list                |
| 25  | `observability/event-collector.js`      | 405 | Event collection               | Split: collect / dispatch         |

**Candidatos a split imediato** (multi-concern claro): #5, #7, #10, #20

### 4.3 ALTO — 233 Deep Imports Bypassando Barrels

**Ratio barrel vs deep**: 88 barrel (23%) vs 233 deep (60%) vs 68 re-export (17%)

**Consequências**:
1. Qualquer renomeação/move de arquivo interno quebra 233 importadores externos
2. Testes precisam mockar paths internos em vez de barrels
3. O investimento em barrels/JSDoc perde valor prático
4. Refactors ficam exponencialmente mais caros

**Análise de viabilidade de migração para barrels**:
- `observability/logger` (134 deep) → **Trade-off**: performance vs encapsulamento. Logger é o
  caso mais justificável para deep import. Criar `#copilot/observability/logger` alias no package.json?
- `config/env` (43 deep) → Deveria migrar para barrel `#copilot/config`
- `core/*` (57 deep) → Deveria migrar para barrel `#copilot/core`

### 4.4 MÉDIO — ~30 Singletons com Estado Global Mutável

| Módulo               | Singletons                                 | Risco                         |
| -------------------- | ------------------------------------------ | ----------------------------- |
| `sdk/client.js`      | `_client`, `_startPromise`                 | Cliente compartilhado mutável |
| `sdk/custom-tools`   | `_buildTool`                               | Factory injection             |
| `sdk/models/helpers` | `_modelsCache`                             | Cache mutável global          |
| `channel/client.js`  | `_agent`                                   | Agent ref global              |
| `terminal/state.js`  | `_busy`, `_rl`, `_planMode`, `_show*` (8+) | 8+ vars de estado global      |
| `terminal/index.js`  | `_reflectionTimer`, `_agentListeners*`     | Timer global                  |
| `terminal/dialog/*`  | `_turnQueueDepth`, `_sendTurnMutex`        | Mutex/queue state             |
| `db/sqlite.js`       | `copilotDb`, `exitHandlerRegistered`       | DB singleton                  |
| `conversation-hub/*` | `copilotNamespace`, `_fallbackAgent`       | Namespace singleton           |
| `core/shutdown.js`   | `shuttingDown`, `_log`                     | Shutdown state                |
| `core/shared-state`  | `_hubSessionId`                            | Session ID global             |
| `audit/pipeline.js`  | `globalAuditBuffer`, `defaultAuditLog`     | Audit state global            |

**Impacto**: Dificulta testes paralelos, impede múltiplas instâncias, cria hidden coupling.

### 4.5 MÉDIO — EventEmitter sem Bus Centralizado

**70 arquivos** usam EventEmitter diretamente.

Distribuição por módulo:
- `agent/` → 20 arquivos (session handlers, lifecycle, dialog)
- `observability/` → 9 arquivos (observers, collectors)
- `terminal/` → 5 arquivos (repl, server, state)
- `sdk/` → 5 arquivos (client, events, constants)
- `api/` → 5 arquivos (sse, express routes)
- `bridges/` → 2 arquivos
- `channel/` → 4 arquivos
- `hooks/` → 2 arquivos (bus, presets)
- `conversation-hub/` → 4 arquivos
- Outros → 14 arquivos

**Observação**: `hooks/bus.js` existe como event bus, mas é usado apenas pelo subsistema de hooks.
Não existe bus cross-module. O NERV bus externo (`src/nerv/`) não é usado internamente pelo copilot.

### 4.6 MÉDIO — 22 DI Setters com Padrão Inconsistente

#### Inventário completo de DI Setters

| Módulo              | Setter                               | Padrão     | Chamado em                 |
| ------------------- | ------------------------------------ | ---------- | -------------------------- |
| `sdk/logger.js`     | `setSdkLogger(logFn)`                | set+log    | observability/bootstrap.js |
| `sdk/custom-tools`  | `setCustomToolsBuilder(fn)`          | set+fn     | agent/lifecycle/entry.js   |
| `audit/logger.js`   | `setAuditLogger(logFn, logDir)`      | set+log    | observability/bootstrap.js |
| `audit/pipeline.js` | `setAuditBus(bus)`                   | set+bus    | observability/bootstrap.js |
| `core/shutdown.js`  | `setShutdownLogger(logFn)`           | set+log    | observability/bootstrap.js |
| `core/shared-state` | `setSharedHubSessionId(id)`          | set+state  | terminal/index.js          |
| `db/sqlite.js`      | `setDbLogger(logFn)`                 | set+log    | observability/bootstrap.js |
| `channel/client.js` | `setBridgeAgent(agent)`              | set+agent  | terminal/index.js          |
| `conversation-hub/` | `setFallbackAgent(agent)`            | set+agent  | agent/lifecycle/entry.js   |
| `tools/hub-tools`   | `setHub(hub)`                        | set+ref    | agent/lifecycle/entry.js   |
| `tools/permission-` | `setPermissionAgent(agent)`          | set+agent  | agent/lifecycle/entry.js   |
| `tools/session-rpc` | `setSessionRpc(rpc)`                 | set+ref    | agent/lifecycle/entry.js   |
| `bridges/nerv-*`    | `registerNervBridgeAgent(agent)`     | register   | agent/lifecycle/entry.js   |
| `agent/session/*`   | `setBackgroundCompactionThreshold()` | set+config | config                     |
| `terminal/state.js` | `setHubSessionId`, `setBusy`, etc.   | set+state  | terminal/index.js          |
| `sdk/feature-flags` | `setExperimentalFlag(name, enabled)` | set+flag   | config                     |

3 padrões de naming: `set*`, `register*`, `bootstrap*` — falta padronização.

### 4.7 BAIXO — api/ como Mega-Aggregator

`api/` importa de **11 módulos** (quase todos exceto db, conversation-hub parcial):

```
api → agent, audit, bridges, channel, config, conversation-hub,
      core, hooks, observability, sdk, tools
```

**Risco**: Sem camada de serviços/facades entre api/ e os módulos internos, qualquer mudança em
qualquer módulo pode impactar a API. Uma camada intermediária `services/` absorveria essa
complexidade.

---

## 5. Grafo de Dependências Cross-Module

### 5.1 Dependências por Módulo

```
core       → {config}                                        ⚠️ L0→L2 (re-export)
db         → {core}                                          ✅
audit      → {core, sdk}                                     ✅
sdk        → {config, core, hooks}                           ⚠️ L1→L3 (re-export)
config     → {core, observability, sdk}                      ✅ (L2→L0,L2,L1)
observability → {audit, config, core, sdk}                   ✅
hooks      → {audit, config, observability, sdk, tools}      ⚠️ L3→L3 (lateral ok)
tools      → {audit, config, core, db, observability, sdk}   ✅
bridges    → {config, core, observability, sdk}               ✅
conversation-hub → {config, core, db, observability}         ✅
channel    → {config, core, observability}                   ✅
agent      → {audit, config, core, hooks, observability, sdk, tools} ✅
api        → {agent, audit, bridges, channel, config, conversation-hub, core, hooks, observability, sdk, tools} ⚠️ 11 deps
terminal   → {agent, api, audit, bridges, channel, config, conversation-hub, core, observability, sdk} ✅
```

### 5.2 Violações Topológicas Reais

| #   | Fonte            | Target                  | Dir   | Tipo          | Sev |
| --- | ---------------- | ----------------------- | ----- | ------------- | --- |
| 1   | `core/constants` | `config/env`            | L0→L2 | export...from | 🔴   |
| 2   | `sdk/index`      | `hooks/factory`         | L1→L3 | export...from | 🔴   |
| 3   | `sdk/index`      | `hooks/permission`      | L1→L3 | export...from | 🔴   |
| 4   | `sdk/config`     | `config/session-config` | L1→L2 | export+import | 🟠   |

---

## 6. Conquistas do PARTE-20

| Faixa | Tema                     | Status                                |
| ----- | ------------------------ | ------------------------------------- |
| A     | Violações de camada      | ✅ 27→0 (DI injection)                 |
| B     | God objects              | ✅ Todos avaliados como coesos/facades |
| C     | Duplicações              | ✅ 6 issues resolvidos                 |
| D     | Reorganização            | ✅ READMEs, relayer, assessment        |
| E     | Injeção de Dependência   | ✅ sdk/12 + audit/4 + core/3 + db/1 DI |
| F     | Nomenclatura e Contratos | ✅ 5/5 barrels JSDoc + @module 14/14   |
| G     | Hardening CI             | ✅ Gates + 6/6 contract tests          |

---

## 7. Infraestrutura de CI

### 7.1 Gates existentes

| Gate                     | Script                          | Status | Observação             |
| ------------------------ | ------------------------------- | ------ | ---------------------- |
| Layer violations         | `check-layer-violations.mjs`    | ⚠️      | Não cobre export..from |
| File size (código ativo) | `check-file-size.mjs`           | ✅      | 0 erros, 9 warnings    |
| Contract tests           | `test_barrel_contracts.spec.js` | ✅      | 6/6                    |
| Typecheck                | `npm run typecheck:node`        | ✅      | 0 erros                |
| Lint                     | `npm run lint`                  | ✅      | 0 erros, 1 warning     |

### 7.2 Gates ausentes (recomendados)

| Gate proposto              | O que detecta                            | Prioridade |
| -------------------------- | ---------------------------------------- | ---------- |
| Export-from detection      | `export { } from` no layer check         | P0         |
| Barrel bypass ratio        | % de imports que usam barrel vs deep     | P1         |
| Singleton count per module | Número de `let X = null` singletons      | P2         |
| DI setter consistency      | Naming + JSDoc dos DI setters            | P2         |
| EventEmitter audit         | Arquivos com EventEmitter sem bus        | P3         |
| Fan-out threshold          | Módulos com >8 deps (mega-aggregator)    | P2         |
| Deep import allowlist      | Permitir deep imports apenas para logger | P1         |

---

## 8. Métricas de JSDoc e Documentação

| Métrica            | Valor   | Observação                            |
| ------------------ | ------- | ------------------------------------- |
| LoC total (`wc`)   | 51.632  | Inclui JSDoc + comments               |
| LoC ativo (estim.) | ~35.000 | ~32% é JSDoc/comments — saudável      |
| LoC JSDoc (estim.) | ~16.600 | Resultado do trabalho de documentação |
| Barrels com JSDoc  | 14/14   | Todos documentados (FF-2)             |
| @module tags       | 14/14   | Todos os módulos                      |
| README.md          | 14/14   | Todos os módulos                      |
| @type {any} em API | 0       | Nenhum tipo `any` em APIs públicas    |

---

## 9. Conclusão e Prioridades

### 9.1 Resumo de findings

| #   | Problema                        | Impacto   | Esforço | Prioridade  |
| --- | ------------------------------- | --------- | ------- | ----------- |
| 1   | Gap de regex no CI              | 🔴 Crítico | Baixo   | P0 Imediata |
| 2   | 4 violações topológicas ocultas | 🔴 Alto    | Médio   | P0 Imediata |
| 3   | 233 deep imports (72%)          | 🔴 Alto    | Alto    | P1 Curto    |
| 4   | 25 arquivos >400 LoC (raw)      | 🟠 Médio   | Alto    | P1 Curto    |
| 5   | ~30 singletons globais          | 🟠 Médio   | Alto    | P2 Médio    |
| 6   | 22 DI setters inconsistentes    | 🟡 Médio   | Médio   | P2 Médio    |
| 7   | 70 EventEmitters sem bus        | 🟡 Baixo   | Alto    | P3 Longo    |
| 8   | api/ mega-aggregator (11 deps)  | 🟡 Baixo   | Alto    | P3 Longo    |
| 9   | 5+ CI gates ausentes            | 🟠 Médio   | Médio   | P1 Curto    |

### 9.2 Próximos passos

Estas findings alimentam diretamente o roadmap da PARTE-21C, que define faixas H–N de trabalho para
endereçar cada problema.
