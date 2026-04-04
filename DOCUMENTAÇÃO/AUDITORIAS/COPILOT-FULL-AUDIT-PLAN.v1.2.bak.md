# Plano de Auditoria Completa — src/copilot

**Versão**: 2.0 **Data**: 2026-07-05 **Escopo**: Todo o diretório `src/copilot/` (160 arquivos JS,
~19.439 LOC, 15 módulos) **Skill guia**: `.github/skills/copilot-full-audit/SKILL.md` **Saída**:
160+ relatórios MD individuais + 15 consolidados de módulo + 7 de integração + 4 globais **Diretório
de saída**: `DOCUMENTAÇÃO/AUDITORIAS/COPILOT-AUDIT-REPORTS/` **Templates**:
`DOCUMENTAÇÃO/AUDITORIAS/COPILOT-AUDIT-REPORTS/templates/`

---

## 1. Objetivos da Auditoria

1. **Detecção de bugs** — bugs lógicos, semânticos, race conditions, leaks, invariantes violados
2. **Análise de integridade** — contratos entre módulos, typedefs, shapes de dados
3. **Avaliação arquitetural** — acoplamento, coesão, camadas, separação de responsabilidades
4. **Integração cross-module** — como os sistemas se conectam (ou faltam conexões)
5. **Segurança** — injection, SSRF, path traversal, permissões, secrets exposure
6. **Performance** — hotspots, allocations desnecessárias, complexidade algorítmica
7. **Dead code** — código não referenciado, exports sem consumidores, shims obsoletos
8. **Cobertura de testes** — gaps de teste, módulos sem spec, cenários edge não cobertos
9. **Oportunidades de upgrade** — padrões melhores, APIs modernas, simplificações

---

## 2. Tipologia de Nomenclatura (Padrão Canônico)

Toda questão identificada receberá um ID composto. O formato é `{TIPO}-{MÓDULO}-{SEQ}`.

### 2.1 Tipos de Questão (prefixo)

| Prefixo | Significado                  | Exemplo         |
| ------- | ---------------------------- | --------------- |
| `BUG`   | Bug lógico/semântico         | `BUG-AGENT-001` |
| `RACE`  | Race condition / timing      | `RACE-HOOK-003` |
| `LEAK`  | Memory/resource leak         | `LEAK-OBS-002`  |
| `SEC`   | Vulnerabilidade de segurança | `SEC-TOOLS-001` |
| `PERF`  | Problema de performance      | `PERF-TERM-004` |
| `GAP`   | Funcionalidade ausente/gap   | `GAP-API-002`   |
| `INC`   | Inconsistência de contrato   | `INC-LIB-001`   |
| `DEAD`  | Dead code / unreachable      | `DEAD-HOOK-005` |
| `TYPO`  | Typedef/JSDoc incorreto      | `TYPO-OBS-003`  |
| `ARCH`  | Questão arquitetural         | `ARCH-CHAN-001` |
| `TEST`  | Gap de cobertura de teste    | `TEST-DB-001`   |
| `UPG`   | Proposta de upgrade          | `UPG-AGENT-007` |
| `INTG`  | Integração cross-module      | `INTG-OBS-001`  |

### 2.2 Códigos de Módulo (infixo)

| Código  | Diretório           | Arquivos |
| ------- | ------------------- | -------- |
| `AGENT` | `agent/`            | 22       |
| `API`   | `api/`              | 6        |
| `BRDG`  | `bridges/`          | 10       |
| `CHAN`  | `channel/`          | 3        |
| `CONF`  | `config/`           | 9        |
| `CONV`  | `conversation-hub/` | 6        |
| `CORE`  | `core/`             | 3        |
| `DB`    | `db/`               | 2        |
| `HOOK`  | `hooks/`            | 18       |
| `LIB`   | `lib/`              | 12       |
| `OBS`   | `observability/`    | 9        |
| `ROUTE` | `routes/`           | 7        |
| `TERM`  | `terminal/`         | 27       |
| `TOOLS` | `tools/`            | 23       |
| `TYPES` | `types/`            | 3        |

### 2.3 Severidade

| Nível   | Sigla | Critério                                                |
| ------- | ----- | ------------------------------------------------------- |
| Crítica | `P0`  | Corrupção de dados, crash em produção, vulnerabilidade  |
| Alta    | `P1`  | Bug com impacto funcional real, leak significativo      |
| Média   | `P2`  | Inconsistência, gap funcional, perf não-crítica         |
| Baixa   | `P3`  | Dead code, typedef minor, cosmético com impacto técnico |
| Info    | `P4`  | Observação sem ação imediata, nota para futuro          |

---

## 3. Mapa Geral de src/copilot

### 3.1 Módulos e Responsabilidades

```
src/copilot/
├── agent/           22 files  4914 LOC  — Core agent: AlwaysAlive, dialog loop, task executor,
│                                          events, webhooks, reconnect, permissions, state I/O
├── api/              6 files   741 LOC  — HTTP bridge: control, dialog, stream (SSE), tasks
├── bridges/         10 files  2044 LOC  — Integrations: git, gh (CI/issues/PRs), nerv, MCP tools
├── channel/          3 files  1175 LOC  — SSE client, inject script, index
├── config/           9 files  1540 LOC  — Session config, system prompt, MCP servers, tool registry
├── conversation-hub/ 6 files  2206 LOC  — Multi-session hub, orchestrator, socket namespace, store
├── core/             3 files   515 LOC  — Constants, errors, core index
├── db/               2 files   358 LOC  — SQLite wrapper + migrations
├── hooks/           18 files  3334 LOC  — SDK hooks: lifecycle, permissions, audit, presets, bus
├── lib/             12 files  1904 LOC  — Utilities: agents, models, session, client, URL validator
├── observability/    9 files  3784 LOC  — Metrics, OTEL, audit log, error tracker, event collector
├── routes/           7 files  1546 LOC  — Express routes: agent, sessions, hooks, observability
├── terminal/        27 files  2800 LOC  — LLM-B: REPL, dialog, commands (13), HTTP handlers
├── tools/           23 files  5716 LOC  — Tool implementations: file, git, shell, todo, code, web
└── types/            3 files   515 LOC  — SDK types, structured messages, index
```

### 3.2 Grafo de Dependências (simplificado)

```
                    ┌────────────┐
                    │   config   │
                    └──────┬─────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   ┌─────────┐      ┌───────────┐      ┌──────────┐
   │  hooks   │◄────►│   agent   │◄────►│  tools   │
   └────┬────┘      └─────┬─────┘      └─────┬────┘
        │                 │                   │
        ▼                 ▼                   ▼
   ┌──────────┐    ┌──────────────┐    ┌──────────┐
   │observabil│◄───│  api/routes  │───►│ bridges  │
   └──────────┘    └──────┬───────┘    └──────────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
         ┌────────┐ ┌──────────┐ ┌────────┐
         │terminal│ │conv-hub  │ │channel │
         └────────┘ └──────────┘ └────────┘
              │           │           │
              └───────────┼───────────┘
                          ▼
                    ┌───────────┐
                    │ core/lib  │
                    │ db/types  │
                    └───────────┘
```

### 3.3 Dependência Cross-Module via `#copilot/` alias

Total de imports cross-module: **171** (inclui self-imports intra-módulo). Principais destinos:

| Módulo destino  | Importações recebidas |
| --------------- | --------------------- |
| `observability` | 87                    |
| `hooks`         | 35                    |
| `lib`           | 18                    |
| `core`          | 9                     |
| `config`        | 7                     |
| `channel`       | 4                     |
| `tools`         | 3                     |
| `db`            | 2                     |
| `types`         | 2                     |
| `agent`         | 2                     |
| `nerv-bridge`   | 1                     |
| outros          | 1                     |

> observability é o módulo mais importado — 87 de 171 (51%). Destes, 76 são para o sub-path
> `observability/logger` diretamente (bypass do barrel).

### 3.4 Cobertura de Testes Atual

| Módulo            | Specs (unit)                                                                                                                                                                                           | Qtd | Status     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | ---------- |
| agent/            | always_alive (5), dialog_protocol, dialog_watchdog, message_queue, permission_controller, reconnect_policy, session_initializer, state_io, status_snapshot, task_executor, tool_audit_logger, webhooks | 16  | ✅ Boa     |
| api/              | http_bridge_dialog, http_bridge_health, http_bridge_stream, sdk_api                                                                                                                                    | 4   | ⚠️ Parcial |
| bridges/          | alias_store, mcp_tool_bridge, nerv_bridge                                                                                                                                                              | 3   | ⚠️ Parcial |
| channel/          | channel_inject, inject_retry                                                                                                                                                                           | 2   | ⚠️ Parcial |
| config/           | config_tools_registry, session_config, system_prompt                                                                                                                                                   | 3   | ⚠️ Parcial |
| conversation-hub/ | conversation_store, hub_orchestrator                                                                                                                                                                   | 2   | ⚠️ Parcial |
| core/             | —                                                                                                                                                                                                      | 0   | ❌ Zero    |
| db/               | copilot_db                                                                                                                                                                                             | 1   | ⚠️ Parcial |
| hooks/            | hooks_module, hook_tools                                                                                                                                                                               | 2   | ⚠️ Parcial |
| lib/              | lib_agents, lib_client, lib_hooks, lib_models, lib_permissions, lib_session, lib_telemetry, lib_tools_registry, url_validator, event_helpers                                                           | 10  | ✅ Boa     |
| observability/    | —                                                                                                                                                                                                      | 0   | ❌ Zero    |
| routes/           | route_table                                                                                                                                                                                            | 1   | ⚠️ Parcial |
| terminal/         | http_handlers, llm_bridge_client, route_table, terminal_turn_serialization                                                                                                                             | 4   | ⚠️ Parcial |
| tools/            | file_tools, shell_tools, todo_tools                                                                                                                                                                    | 3   | ⚠️ Parcial |
| types/            | structured_message, structured_client                                                                                                                                                                  | 2   | ⚠️ Parcial |
| cross-module      | session_manager (2)                                                                                                                                                                                    | 2   | ⚠️ Parcial |

> Total: 55 unit specs + 2 integration specs = 57 test files, 2049 test cases **Módulos sem
> cobertura**: core/, observability/ (total: 12 arquivos sem nenhum spec)

### 3.5 Diagnóstico Arquitetural — Estado Atual (AS-IS)

A análise empírica do codebase revela os seguintes padrões e problemas arquiteturais:

#### A. Métricas de acoplamento

| Indicador                                   | Valor | Avaliação                |
| ------------------------------------------- | ----- | ------------------------ |
| Imports entre módulos via `#copilot/`       | 171   | —                        |
| Módulo mais importado (`observability`)     | 87    | 🔴 Acoplamento extremo   |
| Imports diretos (bypass do barrel/index.js) | ~100  | 🔴 Encapsulamento fraco  |
| `#copilot/observability/logger` direto      | 76    | 🔴 76 de 87 = 87%        |
| Arquivos com `@github/copilot-sdk` direto   | 22    | 🟠 SDK espalhado         |
| `new Map()/Set()` sem TTL evidente          | ~37   | 🟠 Risco de leak         |
| `let` module-level (estado mutável global)  | ~30   | 🟠 Singletons implícitos |
| Superfície de exports total                 | 609   | 🟡 Alta, mas esperada    |

#### B. Violações de camada detectadas

1. **`core/index.js` re-exporting `../types/index.js`** — core/ deveria ser independente de types/.
   Cria dependência circular lógica: core ← types, mas core re-exporta types.
2. **`core/constants.js` exporta `AGENT_EVENTS` via `../agent/events.js`** — core/ importando de
   agent/ é inversão de camada. Core deveria ser a camada mais baixa.
3. **76 imports diretos de `#copilot/observability/logger`** — bypass total do barrel
   `#copilot/observability`. O logger é acessado como utilitário, não como módulo de observability.
4. **`hooks/` re-importa de `agent/session-hooks.js`** — acoplamento bidirecional hooks↔agent.
5. **`lib/` importa de `hooks/factory` e `hooks/permission`** — lib deveria ser camada inferior a
   hooks.

#### C. Padrões de singleton/estado mutable

~30 variáveis `let` em escopo de módulo funcionam como singletons implícitos:

- `_agent`, `_client`, `_registry`, `_toolsConfig`, `_stateCache`, `copilotDb`, etc.
- Sem interface de reset/cleanup padronizada — dificuldade para testes.
- Sem garantia de inicialização sequencial — race condition potencial entre módulos.

#### D. Observability como "god module"

O módulo `observability/` recebe 87 imports (51% de todos os cross-module), mas:

- 76 desses são para `logger` — atuando como utilitário, não infraestrutura de observability.
- 0 specs = zero cobertura de testes.
- Funções de coleta, métricas, OTEL e auditoria acumulam 3784 LOC sem separação clara de camadas
  internas.

#### E. SDK coupling espalhado

22 arquivos importam diretamente de `@github/copilot-sdk`. Sem camada de abstração intermediária:

- Se a API do SDK mudar, 22 arquivos precisam ser modificados.
- Typedefs do SDK espalhados via `@typedef {import('@github/copilot-sdk').X}` em cada arquivo.
- `lib/sdk-client.js` existe mas não centraliza toda a superfície.

#### F. Barrel bypass generalizado

A maioria dos modules tem `index.js` como barrel, mas consumidores importam sub-paths diretamente:

- `#copilot/observability/logger` (76x) em vez de `#copilot/observability`
- `#copilot/hooks/factory` (6x), `#copilot/hooks/bus` (5x), `#copilot/hooks/permission` (3x)
- `#copilot/lib/models` (2x), `#copilot/lib/sdk-client` (2x)

Isso anula o propósito de encapsulamento dos barrels e torna refatorações internas quebradiças.

### 3.6 Visão Arquitetural — Estado Ideal (TO-BE)

A auditoria deve gerar propostas concretas para migrar do AS-IS para esta visão alvo:

#### Camadas (de baixo para cima)

```
 ┌──────────────────────────────────────────────────────────────┐
 │                     INFRASTRUCTURE                           │
 │  core/ (constants, errors)   db/   types/                   │
 │  ❌ Não importa de nenhuma camada superior                   │
 │  ✅ Importado por todas as camadas superiores                │
 └──────────────────────────────────────┬───────────────────────┘
                                        │
 ┌──────────────────────────────────────▼───────────────────────┐
 │                       UTILITIES                              │
 │  lib/ (SDK façade, validators, helpers)                     │
 │  logger (extraído de observability → utilitário autônomo)   │
 │  ❌ Não importa de hooks/, agent/, tools/                    │
 │  ✅ Importado por todas as camadas funcionais                │
 └──────────────────────────────────────┬───────────────────────┘
                                        │
 ┌──────────────────────────────────────▼───────────────────────┐
 │                    OBSERVABILITY                             │
 │  observability/ (collector, observer, metrics, OTEL, audit) │
 │  channel/ (SSE)   config/ (session, prompts, tools)         │
 │  ❌ Não importa de agent/, hooks/, tools/                    │
 │  ✅ Recebe eventos via bus, não dependência direta           │
 └──────────────────────────────────────┬───────────────────────┘
                                        │
 ┌──────────────────────────────────────▼───────────────────────┐
 │                     DOMAIN LOGIC                             │
 │  hooks/ (permission, lifecycle, presets, audit)             │
 │  tools/ (file, git, shell, todo, code, web, session)        │
 │  bridges/ (git, gh, nerv, MCP)                              │
 │  conversation-hub/ (multi-session, store, orchestrator)     │
 │  ❌ Não importa de agent/                                    │
 │  ✅ hooks↔tools comunica via contratos, não refs diretas     │
 └──────────────────────────────────────┬───────────────────────┘
                                        │
 ┌──────────────────────────────────────▼───────────────────────┐
 │                    ORCHESTRATION                             │
 │  agent/ (AlwaysAlive, dialog loop, task executor, state)    │
 │  terminal/ (REPL, commands, dialog, HTTP)                   │
 │  ✅ Compõe domain logic + infra                              │
 │  ✅ Único nível que conhece toda a topologia                 │
 └──────────────────────────────────────┬───────────────────────┘
                                        │
 ┌──────────────────────────────────────▼───────────────────────┐
 │                      INTERFACE                               │
 │  api/ (HTTP bridge)   routes/ (Express endpoints)           │
 │  ✅ Traduz HTTP↔domain                                       │
 │  ❌ Não contém lógica de negócio                             │
 └──────────────────────────────────────────────────────────────┘
```

#### Princípios-alvo

| #   | Princípio                              | Regra                                                                                                |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| P1  | **Dependência unidirecional**          | Camadas só importam de camadas inferiores. Nunca upward.                                             |
| P2  | **Barrel como contrato**               | Todo import cross-module deve ser feito via `#copilot/{módulo}` (index.js). Sub-paths são internos.  |
| P3  | **Logger como utilitário**             | Extrair logger de observability → `lib/logger.js` ou `core/logger.js`. Elimina 76 barrel bypasses.   |
| P4  | **SDK façade única**                   | Todo acesso a `@github/copilot-sdk` deve passar por `lib/sdk-client.js`. Demais importam o façade.   |
| P5  | **Estado explícito com lifecycle**     | Singletons `let` → classes ou factories com `init()`, `destroy()`, `reset()`. Testabilidade trivial. |
| P6  | **Maps com TTL ou cleanup registrado** | Todo `new Map()` em módulo de longa vida deve ter TTL ou cleanup hook. Prevent memory leaks.         |
| P7  | **Core auto-suficiente**               | `core/` não re-exporta de `agent/` ou `types/`. Se precisa, mover o conteúdo para core.              |
| P8  | **Zero circular entre módulos**        | Eliminar hooks↔agent circular. Direção: agent→hooks (agent consome hooks, nunca inverse).            |
| P9  | **Cobertura mínima 1 spec/módulo**     | Todo módulo deve ter pelo menos 1 spec. Core (0), observability (0), routes (0) são gaps P1.         |
| P10 | **Observability via bus, não import**  | Módulos emitem eventos; observability subscreve. Reduz coupling de 87 imports para ~5.               |

#### Delta AS-IS → TO-BE (roadmap de transformação)

| Delta                          | Status atual                  | Alvo                                        | Complexidade |
| ------------------------------ | ----------------------------- | ------------------------------------------- | ------------ |
| Logger extraction              | 76 imports diretos em obs/    | `lib/logger.js` + 1 import por barrel       | Média        |
| SDK façade consolidation       | 22 files com SDK direto       | 1 façade em `lib/sdk-client.js`             | Alta         |
| Core independence              | core re-exports agent + types | Mover AGENT_EVENTS e types para core nativo | Baixa        |
| Barrel enforcement             | ~100 barrel bypasses          | Lint rule ou review gate                    | Média        |
| hooks↔agent decoupling         | Circular via session-hooks    | Unidirecional: agent→hooks                  | Média        |
| Singleton lifecycle            | ~30 singletons `let`          | Factory pattern com init/destroy            | Alta         |
| Map TTL                        | ~37 unbounded Maps/Sets       | TTL ou cleanup em cada caso                 | Média        |
| Test coverage for zero-modules | core(0), obs(0), routes(0)    | ≥1 spec por módulo                          | Média        |
| Observability event-driven     | 87 direct imports             | Bus subscription + <10 imports              | Alta         |

> **Nota**: Estas transformações NÃO são objetivo imediato. São a visão-alvo que emerge da
> auditoria. Cada delta será avaliado durante F05-F16, recebendo IDs do tipo `ARCH-*` ou `UPG-*`, e
> priorizado no `ROADMAP-FIXES.md` final.

---

## 4. Fases da Auditoria

A auditoria é organizada em **4 macro-fases** com **16 fases internas** e **145 subfases**.

### MACRO-FASE I — Leitura e Mapeamento (Fases F01-F04)

Leitura integral de todos os 160 arquivos. Cada fase cobre um cluster de módulos.

#### Fase F01 — Leitura: agent/ + hooks/ (40 arquivos)

Estes são os dois módulos mais interligados — o agent depende dos hooks e vice-versa.

| Subfase | Ação                                                                               |
| ------- | ---------------------------------------------------------------------------------- |
| F01-01  | Ler `agent/always-alive.js` integralmente (~1100 LOC)                              |
| F01-02  | Ler `agent/dialog-loop-manager.js` + `dialog-loop-wirer.js`                        |
| F01-03  | Ler `agent/dialog-protocol.js` + `dialog-turn-executor.js`                         |
| F01-04  | Ler `agent/dialog-watchdog.js` + `message-queue.js`                                |
| F01-05  | Ler `agent/permission-controller.js` + `tool-audit-logger.js`                      |
| F01-06  | Ler `agent/reconnect-policy.js` + `session-initializer.js`                         |
| F01-07  | Ler `agent/task-executor.js` + `state-io.js` + `status-snapshot.js`                |
| F01-08  | Ler `agent/events.js` + `entry.js` + `index.js` + `webhook-manager.js` + restantes |
| F01-09  | Ler `hooks/session-lifecycle.js` + `permission-handler.js`                         |
| F01-10  | Ler `hooks/audit.js` + `composer.js` + `factory.js`                                |
| F01-11  | Ler `hooks/tool-interceptor.js` + `prompt-transformer.js`                          |
| F01-12  | Ler `hooks/bus.js` + `registry.js` + `error-handler.js` + `user-input.js`          |
| F01-13  | Ler `hooks/presets/*` (5 arquivos) + `hooks/types.js`                              |
| F01-14  | Mapear contratos agent↔hooks: quais hooks o agent consome e como                   |
| F01-15  | Documentar invariantes encontradas                                                 |

#### Fase F02 — Leitura: observability/ + bridges/ + api/ (25 arquivos)

Telemetria + integração externa + HTTP layer.

| Subfase | Ação                                                                                      |
| ------- | ----------------------------------------------------------------------------------------- |
| F02-01  | Ler `observability/event-collector.js` (~960 LOC)                                         |
| F02-02  | Ler `observability/agent-event-observer.js` (~830 LOC)                                    |
| F02-03  | Ler `observability/metrics.js` (~490 LOC) + `error-tracker.js`                            |
| F02-04  | Ler `observability/audit-log.js` + `hooks-audit-preset.js` + `otel.js`                    |
| F02-05  | Ler `observability/logger.js` + `index.js`                                                |
| F02-06  | Ler `bridges/nerv-bridge.js` + `mcp-tool-bridge.js`                                       |
| F02-07  | Ler `bridges/gh-bridge.js` + `bridges/gh/*` (4 arquivos)                                  |
| F02-08  | Ler `bridges/git-bridge.js` + `bridges/alias-store.js`                                    |
| F02-09  | Ler `api/http-bridge.js` + `api/sdk-api.js`                                               |
| F02-10  | Ler `api/bridge-control.js` + `bridge-dialog.js` + `bridge-stream.js` + `bridge-tasks.js` |
| F02-11  | Mapear fluxo de telemetria: SDK→event-collector→observer→metrics→REST                     |
| F02-12  | Mapear fluxo de bridges: who calls what, event routing                                    |

#### Fase F03 — Leitura: tools/ + config/ + terminal/ (59 arquivos)

Tools é o maior módulo em LOC. Terminal é o maior em contagem de arquivos.

| Subfase | Ação                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| F03-01  | Ler `tools/tool-factory.js` + `tools/index.js`                                                                                       |
| F03-02  | Ler `tools/file/*` (4 arquivos: read-tools, write-tools, shared, index)                                                              |
| F03-03  | Ler `tools/git/*` (1 arquivo: index) + `tools/git-tools.js`                                                                          |
| F03-04  | Ler `tools/shell/index.js`                                                                                                           |
| F03-05  | Ler `tools/todo/*` (5 arquivos: crud-tools, bulk-tools, query-tools, store, index)                                                   |
| F03-06  | Ler `tools/code-tools.js` + `tools/web-tools.js`                                                                                     |
| F03-07  | Ler `tools/permission-tools.js` + `tools/hook-tools.js`                                                                              |
| F03-08  | Ler `tools/hub-tools.js` + `tools/session-tools.js` + `tools/session-rpc-tools.js`                                                   |
| F03-09  | Ler `tools/introspection-tools.js` + `tools/task-tools.js`                                                                           |
| F03-10  | Ler `config/session-config.js` + `config/system-prompt.js`                                                                           |
| F03-11  | Ler `config/mcp-servers.js` + `config/custom-agents.js`                                                                              |
| F03-12  | Ler `config/tools/*` (3 arquivos) + `config/pinned-files-loader.js`                                                                  |
| F03-13  | Ler `config/index.js`                                                                                                                |
| F03-14  | Ler `terminal/bootstrap.js` + `terminal/server.js` + `terminal/repl.js`                                                              |
| F03-15  | Ler `terminal/dialog.js` + `terminal/state.js` + `terminal/index.js`                                                                 |
| F03-16  | Ler `terminal/handlers-agent.js` + `handlers-dialog.js` + `handlers-shared.js` + `handlers-system.js`                                |
| F03-17  | Ler `terminal/commands/*` (13 arquivos: alias, attach, config, context, gh, git, help, index, memory, plan, resume, session, skills) |
| F03-18  | Ler `terminal/http-handlers.js` + `route-table.js` + `file-context.js` + `workspace-context.js`                                      |

#### Fase F04 — Leitura: channel/ + conversation-hub/ + core/ + db/ + lib/ + types/ + routes/ (36 arquivos)

| Subfase | Ação                                                                        |
| ------- | --------------------------------------------------------------------------- |
| F04-01  | Ler `channel/client.js` + `channel/inject.js` + `channel/index.js`          |
| F04-02  | Ler `conversation-hub/hub.js` + `orchestrator.js`                           |
| F04-03  | Ler `conversation-hub/store.js` + `store-helpers.js`                        |
| F04-04  | Ler `conversation-hub/socket-ns.js` + `index.js`                            |
| F04-05  | Ler `core/constants.js` + `core/errors.js` + `core/index.js`                |
| F04-06  | Ler `db/sqlite.js` + `db/migrations.js`                                     |
| F04-07  | Ler `lib/agents.js` + `lib/models.js` + `lib/session.js`                    |
| F04-08  | Ler `lib/sdk-client.js` + `lib/http-request.js`                             |
| F04-09  | Ler `lib/permissions.js` + `lib/hooks.js` + `lib/event-helpers.js`          |
| F04-10  | Ler `lib/tools-registry.js` + `lib/url-validator.js` + `lib/utils.js`       |
| F04-11  | Ler `lib/index.js`                                                          |
| F04-12  | Ler `types/sdk.js` + `types/structured-message.js` + `types/index.js`       |
| F04-13  | Ler `routes/agent.js` + `routes/sessions.js`                                |
| F04-14  | Ler `routes/hooks.js` + `routes/webhooks.js`                                |
| F04-15  | Ler `routes/observability.js` + `routes/client.js` + `routes/middleware.js` |
| F04-16  | Mapear contratos inter-módulo: lib↔agent, channel↔api, routes↔agent         |

---

### MACRO-FASE II — Análise Isolada (Fases F05-F10)

Após a leitura integral, cada módulo recebe análise profunda individual.

#### Fase F05 — Análise: agent/ (22 arquivos, 4914 LOC)

| Subfase | Foco                                                              |
| ------- | ----------------------------------------------------------------- |
| F05-01  | AlwaysAlive: state machine completa, transições, edge cases       |
| F05-02  | Dialog loop: concurrency, restart, watchdog, stall detection      |
| F05-03  | Task executor: retry, streaming, error propagation                |
| F05-04  | Reconnect policy: backoff, jitter, max attempts, session teardown |
| F05-05  | Permission controller: tool approval flow, race conditions        |
| F05-06  | Session lifecycle: init→start→end, event propagation, cleanup     |
| F05-07  | Webhook manager: dispatch, failure handling, timeout              |
| F05-08  | Events: AGENT_EVENTS completeness, event shapes, type contracts   |
| F05-09  | State I/O: serialization, corruption, concurrent writes           |
| F05-10  | Dead code scan: unused exports, deprecated shims                  |

#### Fase F06 — Análise: observability/ (9 arquivos, 3784 LOC)

| Subfase | Foco                                                                  |
| ------- | --------------------------------------------------------------------- |
| F06-01  | Event collector: handler completeness, event dedup, error isolation   |
| F06-02  | Agent event observer: Map leaks, TTL correctness, handler correctness |
| F06-03  | Metrics: histogram accuracy, gauge consistency, summary shape         |
| F06-04  | Audit log: ring buffer overflow, JSONL format, concurrent writes      |
| F06-05  | OTEL: span lifecycle, tracer init, graceful degradation               |
| F06-06  | Error tracker: ring buffer, global handler safety                     |
| F06-07  | Logger: level filtering, output format, file rotation                 |
| F06-08  | Integration: collector↔observer dedup, metrics↔routes exposure        |

#### Fase F07 — Análise: hooks/ (18 arquivos, 3334 LOC)

| Subfase | Foco                                                                 |
| ------- | -------------------------------------------------------------------- |
| F07-01  | Permission handler: allowAll safety, tool filtering, race conditions |
| F07-02  | Session lifecycle: context enrichment, webhook dispatch              |
| F07-03  | Audit ring buffer: capacity, overflow, clear semantics               |
| F07-04  | Tool interceptor: pre/post hooks, error isolation                    |
| F07-05  | Prompt transformer: injection risk, prompt composition               |
| F07-06  | Composer: hook composition, ordering guarantees                      |
| F07-07  | Presets: deny-all/safe/production/interactive correctness            |
| F07-08  | Bus + registry: event routing, handler leaks                         |
| F07-09  | Types: typedef completeness, optional vs required fields             |

#### Fase F08 — Análise: tools/ (22 arquivos, 5716 LOC)

| Subfase | Foco                                                              |
| ------- | ----------------------------------------------------------------- |
| F08-01  | Tool factory: registration, validation, collision detection       |
| F08-02  | File tools: path traversal, symlink safety, encoding, large files |
| F08-03  | Shell tools: command injection, timeout, resource limits          |
| F08-04  | Git tools: credential exposure, branch safety, conflict handling  |
| F08-05  | Todo tools: store persistence, concurrent writes, corruption      |
| F08-06  | Code tools: eval safety, AST injection                            |
| F08-07  | Web tools: SSRF, URL validation, redirect following               |
| F08-08  | Permission tools: authorization flow, bypass vectors              |
| F08-09  | Session/Hub tools: multi-session safety, isolation                |
| F08-10  | Task tools: queue management, priority, starvation                |

#### Fase F09 — Análise: terminal/ (27 arquivos, 2800 LOC)

| Subfase | Foco                                                                   |
| ------- | ---------------------------------------------------------------------- |
| F09-01  | REPL: input parsing, command dispatch, buffer overflow                 |
| F09-02  | Dialog: turn management, concurrent turns, state consistency           |
| F09-03  | HTTP handlers: authentication, rate limiting, input validation         |
| F09-04  | Commands (13): correctness, edge cases, error handling de cada handler |
| F09-05  | Bootstrap + server: startup order, error handling, port conflicts      |
| F09-06  | State management: concurrent access, corruption, cleanup               |
| F09-07  | File/workspace context: path safety, injection, resource limits        |
| F09-08  | Route table: completeness, dead routes, missing handlers               |

#### Fase F10 — Análise: channel/ + config/ + conversation-hub/ + api/ + routes/ + lib/ + core/ + db/ + types/ + bridges/

| Subfase | Foco                                                          |
| ------- | ------------------------------------------------------------- |
| F10-01  | Channel: SSE reconnection, heartbeat, message ordering        |
| F10-02  | Config: validation, defaults, env override safety             |
| F10-03  | Conversation hub: multi-session isolation, store consistency  |
| F10-04  | API bridge: HTTP safety, auth, CORS, error responses          |
| F10-05  | Routes: middleware chain, error handling, response shapes     |
| F10-06  | Lib: utility correctness, URL validator, SDK client           |
| F10-07  | Core: constants completeness, error hierarchy                 |
| F10-08  | DB: migration safety, concurrent access, SQL injection        |
| F10-09  | Types: typedef accuracy, SDK alignment                        |
| F10-10  | Bridges: nerv routing, gh API error handling, MCP integration |

---

### MACRO-FASE III — Análise Integrada (Fases F11-F14)

Análise cross-module de fluxos end-to-end e questões arquiteturais.

#### Fase F11 — Integração: Telemetria End-to-End

| Subfase | Foco                                                                   |
| ------- | ---------------------------------------------------------------------- |
| F11-01  | Fluxo completo: SDK event → collector → observer → metrics → REST      |
| F11-02  | Deduplicação: mesmos eventos processados por collector E observer?     |
| F11-03  | OTEL span propagation: traces conectados entre task→tool→turn?         |
| F11-04  | Audit log: tool-execution vs tool-permissions — consumidores corretos? |
| F11-05  | Métricas expostas: tudo que o MetricsStore coleta chega no REST?       |
| F11-06  | Error tracking: erros capturados → errorTracker → REST → dashboard     |

#### Fase F12 — Integração: Session Lifecycle

| Subfase | Foco                                                                  |
| ------- | --------------------------------------------------------------------- |
| F12-01  | Boot sequence: config → hooks → agent → session → dialog              |
| F12-02  | Reconnect flow: error → teardown → reconnect → re-init → resume       |
| F12-03  | Shutdown flow: stop → cleanup → timers → handlers → state persistence |
| F12-04  | Multi-session: conversation-hub isolation, resource sharing           |

#### Fase F13 — Integração: Tool Execution Pipeline

| Subfase | Foco                                                        |
| ------- | ----------------------------------------------------------- |
| F13-01  | Tool registration: factory → config → SDK hooks             |
| F13-02  | Permission flow: request → controller → preset → allow/deny |
| F13-03  | Execution flow: task-executor → tool call → result → audit  |
| F13-04  | Error propagation: tool error → agent → observer → user     |

#### Fase F14 — Integração: Terminal LLM-B

| Subfase | Foco                                                      |
| ------- | --------------------------------------------------------- |
| F14-01  | Bootstrap: server + REPL + agent connection               |
| F14-02  | Command routing: input → route-table → handler → response |
| F14-03  | Dialog flow: terminal → agent → SDK → response → terminal |
| F14-04  | State sync: terminal state vs agent state consistency     |

---

### MACRO-FASE IV — Relatórios, Correções e Upgrades (Fases F15-F16)

#### Fase F15 — Consolidação de Relatórios

| Subfase | Ação                                                      |
| ------- | --------------------------------------------------------- |
| F15-01  | Gerar relatório por módulo (15 relatórios MD)             |
| F15-02  | Gerar relatório de integração (4 relatórios de fluxo)     |
| F15-03  | Gerar tabela consolidada de todas as questões encontradas |
| F15-04  | Priorizar questões por severidade e impacto               |
| F15-05  | Gerar roadmap de correções e upgrades                     |

#### Fase F16 — Execução de Correções e Upgrades

| Subfase | Ação                                   |
| ------- | -------------------------------------- |
| F16-01  | Implementar correções P0 (críticas)    |
| F16-02  | Implementar correções P1 (altas)       |
| F16-03  | Implementar correções P2 (médias)      |
| F16-04  | Implementar upgrades priorizados       |
| F16-05  | Testes de regressão para cada correção |
| F16-06  | Quality gates finais + commit          |

---

## 5. Metodologia de Análise

### 5.1 Análise Isolada (por arquivo)

Para cada arquivo, verificar:

1. **Contratos de entrada**: parâmetros recebidos, validação, defaults
2. **Contratos de saída**: return values, tipos, error propagation
3. **Estado interno**: mutabilidade, leaks, cleanup, concurrent access
4. **Error handling**: catch, finally, error transformation, propagation
5. **Edge cases**: null/undefined, empty, overflow, timeout, concurrent
6. **Invariantes**: precondições, postcondições, invariantes de loop
7. **JSDoc**: typedef accuracy, param/returns completeness
8. **Segurança**: injection, traversal, SSRF, secrets, permissions

### 5.2 Análise Integrada (por fluxo)

Para cada fluxo cross-module:

1. **Data flow**: trace dados do ponto A ao Z, verificar transformações
2. **Event flow**: mapear emissão→consumo de eventos, verificar completude
3. **Error flow**: erros no ponto A chegam corretamente ao ponto Z?
4. **State consistency**: estado compartilhado é consistente entre módulos?
5. **Resource lifecycle**: recursos abertos no módulo A são fechados no B?
6. **Contract alignment**: tipos do módulo A casam com expectativas do B?

### 5.3 Ferramentas de Apoio

| Ferramenta              | Propósito                   |
| ----------------------- | --------------------------- |
| `rg` (ripgrep)          | Busca de padrões, dead code |
| `fd`                    | Navegação de arquivos       |
| `node --check`          | Verificação de sintaxe      |
| `npm run test:unit`     | Validação de regressão      |
| `npm run lint`          | Quality gate                |
| `npm run format:check`  | Formatação                  |
| Leitura manual integral | Análise semântica profunda  |

---

## 6. Estrutura de Saída (Artefatos)

```
DOCUMENTAÇÃO/AUDITORIAS/COPILOT-AUDIT-REPORTS/
├── 00-SUMMARY.md                    — Sumário executivo consolidado
├── 01-agent.md                      — Relatório: agent/
├── 02-observability.md              — Relatório: observability/
├── 03-hooks.md                      — Relatório: hooks/
├── 04-tools.md                      — Relatório: tools/
├── 05-terminal.md                   — Relatório: terminal/
├── 06-channel.md                    — Relatório: channel/
├── 07-config.md                     — Relatório: config/
├── 08-conversation-hub.md           — Relatório: conversation-hub/
├── 09-api.md                        — Relatório: api/
├── 10-bridges.md                    — Relatório: bridges/
├── 11-routes.md                     — Relatório: routes/
├── 12-lib.md                        — Relatório: lib/
├── 13-core-db-types.md              — Relatório: core/ + db/ + types/
├── INTEGRATION-telemetry.md         — Análise integrada: telemetria
├── INTEGRATION-session-lifecycle.md — Análise integrada: session
├── INTEGRATION-tool-pipeline.md     — Análise integrada: tools
├── INTEGRATION-terminal.md          — Análise integrada: terminal
├── ISSUES-CONSOLIDATED.md           — Tabela de todas as questões
└── ROADMAP-FIXES.md                 — Roadmap de correções e upgrades
```

### 6.1 Template de Relatório por Módulo

```markdown
# Relatório de Auditoria — {módulo}/

## Sumário

- Arquivos: {N}
- LOC: {N}
- Questões encontradas: {N}
- P0: {N} | P1: {N} | P2: {N} | P3: {N}

## Mapa de Arquivos

| Arquivo | LOC | Responsabilidade | Complexidade | | ... | ... | ... | Alta/Média/Baixa |

## Questões Encontradas

### {ID} — {Título}

- **Tipo**: BUG/RACE/LEAK/SEC/...
- **Severidade**: P0/P1/P2/P3
- **Arquivo**: {path}#{L1-L2}
- **Descrição**: ...
- **Cenário de manifestação**: ...
- **Proposta de correção**: ...
- **Impacto se não corrigido**: ...

## Upgrades Propostos

### {ID} — {Título}

- **Tipo**: UPG
- **Prioridade**: P1/P2/P3
- **Motivação**: ...
- **Implementação proposta**: ...
- **Trade-offs**: ...
```

---

## 7. Estimativa de Escopo

| Macro-fase  | Fases  | Subfases | Foco                    |
| ----------- | ------ | -------- | ----------------------- |
| I: Leitura  | 4      | 61       | Ler 160 arquivos        |
| II: Isolada | 6      | 55       | Análise módulo a módulo |
| III: Integr | 4      | 18       | Fluxos cross-module     |
| IV: Outputs | 2      | 11       | Relatórios + correções  |
| **TOTAL**   | **16** | **145**  | Auditoria completa      |

---

## 8. Critérios de Conclusão

A auditoria está concluída quando:

1. ✅ Todos os 160 arquivos lidos integralmente
2. ✅ Análise isolada de cada módulo documentada
3. ✅ Análise integrada dos 4 fluxos principais documentada
4. ✅ Todas as questões catalogadas com ID/tipo/severidade/proposta
5. ✅ Roadmap de correções priorizado
6. ✅ Correções P0 implementadas e testadas
7. ✅ Quality gates passando após cada batch de correções
8. ✅ Relatório consolidado (`00-SUMMARY.md`) atualizado

---

## 9. Prioridade de Análise por Risco

Módulos ordenados por risco ponderado (LOC × complexidade × exposição × cobertura inversa):

| Prioridade | Módulo            | LOC  | Risco | Justificativa                                                     |
| ---------- | ----------------- | ---- | ----- | ----------------------------------------------------------------- |
| 🔴 1       | tools/            | 5716 | Alto  | Maior LOC, superfície de segurança (shell, file, web), 3 specs só |
| 🔴 2       | agent/            | 4914 | Alto  | State machine complexa, concurrency, session lifecycle            |
| 🔴 3       | observability/    | 3784 | Alto  | 0 specs, hub central de telemetria, Maps com potential leaks      |
| 🟠 4       | hooks/            | 3334 | Médio | Permission handling, prompt injection surface, 2 specs só         |
| 🟠 5       | terminal/         | 2800 | Médio | HTTP handlers, command injection surface, 27 arquivos             |
| 🟠 6       | conversation-hub/ | 2206 | Médio | Multi-session isolation, store consistency, 2 specs               |
| 🟡 7       | bridges/          | 2044 | Médio | External API calls (GitHub), error handling                       |
| 🟡 8       | config/           | 1540 | Baixo | Validation, defaults, menor superfície de ataque                  |
| 🟡 9       | lib/              | 1904 | Baixo | Utilidades, boa cobertura (10 specs)                              |
| 🟡 10      | routes/           | 1546 | Médio | HTTP middleware, auth, 1 spec só                                  |
| 🟢 11      | channel/          | 1175 | Baixo | SSE client, relativamente isolado                                 |
| 🟢 12      | api/              | 741  | Baixo | HTTP bridge, 4 specs                                              |
| 🟢 13      | core/             | 515  | Baixo | Constants/errors, mas 0 specs                                     |
| 🟢 14      | db/               | 358  | Médio | SQL injection surface, migration safety, 1 spec                   |
| 🟢 15      | types/            | 515  | Baixo | Type definitions, 2 specs                                         |

---

## 10. Riscos e Mitigações

| Risco                                   | Mitigação                                         |
| --------------------------------------- | ------------------------------------------------- |
| Interrupção de context (token limit)    | Session memory com progresso por subfase (R10)    |
| Regression após correções               | `npm run test:unit` após cada batch (R5)          |
| Achados duplicados entre módulos        | Tipologia com ID único + tabela consolidada       |
| Análise superficial por volume          | Leitura integral obrigatória (R1) + checklist     |
| Perda de rastreabilidade                | IDs tipados + referência a arquivo#linhas (R4)    |
| Conflitos de edição com outros branches | Git clean antes de iniciar + commits incrementais |
| Falso positivo (achado que não é bug)   | Cenário de manifestação obrigatório (R4)          |
| Escopo creep (upgrades infinitos)       | Priorização P0-P4 + roadmap limitado ao essencial |

---

## 11. Protocolo de Retomada

Em caso de interrupção (token limit, crash, nova sessão):

1. **Ler** `/memories/session/copilot-audit-progress.md` (se existir)
2. **Ler** este plano: `COPILOT-FULL-AUDIT-PLAN.md`
3. **Ler** skill guia: `.github/skills/copilot-full-audit/SKILL.md`
4. **Identificar** última subfase concluída
5. **Retomar** da próxima subfase pendente
6. **Não reler** arquivos já lidos na Macro-Fase I (usar anotações em session memory)
7. **Rodar** `npm run test:unit` para garantir baseline intacto

### Template de progresso (session memory)

```markdown
# Copilot Full Audit — Progresso

## Última atualização: {timestamp}

## Fase atual: {FXX-YY}

### Macro-Fase I: Leitura

- [x] F01-01 ... F01-15
- [x] F02-01 ... F02-12
- [ ] F03-01 (em progresso)
- ...

### Achados preliminares (anotações de leitura)

- tools/shell/index.js:47 — possível command injection (verificar na Fase II)
- agent/always-alive.js:312 — timer sem cleanup (verificar leak na Fase II)
```

---

## 12. Lista Completa de Arquivos por Módulo

### agent/ (22 arquivos)

1. `always-alive.js` 2. `dialog-loop-manager.js` 3. `dialog-loop-wirer.js`
2. `dialog-protocol.js` 5. `dialog-turn-executor.js` 6. `dialog-watchdog.js`
3. `entry.js` 8. `events.js` 9. `index.js` 10. `message-queue.js`
4. `mission-agent.js` 12. `permission-controller.js` 13. `post-process.js`
5. `reconnect-policy.js` 15. `session-initializer.js` 16. `state-io.js`
6. `status-snapshot.js` 18. `streaming-handler.js` 19. `task-executor.js`
7. `tool-audit-logger.js` 21. `types.js` 22. `webhook-manager.js`

### tools/ (23 arquivos)

1. `code-tools.js` 2. `file/index.js` 3. `file/read-tools.js` 4. `file/shared.js`
2. `file/write-tools.js` 6. `git/index.js` 7. `git-tools.js` 8. `hook-tools.js`
3. `hub-tools.js` 10. `index.js` 11. `introspection-tools.js` 12. `permission-tools.js`
4. `session-rpc-tools.js` 14. `session-tools.js` 15. `shell/index.js` 16. `task-tools.js`
5. `todo/bulk-tools.js` 18. `todo/crud-tools.js` 19. `todo/index.js`
6. `todo/query-tools.js` 21. `todo/store.js` 22. `tool-factory.js` 23. `web-tools.js`

### observability/ (9 arquivos)

1. `agent-event-observer.js` 2. `audit-log.js` 3. `error-tracker.js`
2. `event-collector.js` 5. `hooks-audit-preset.js` 6. `index.js`
3. `logger.js` 8. `metrics.js` 9. `otel.js`

### hooks/ (18 arquivos)

1. `audit.js` 2. `bus.js` 3. `composer.js` 4. `error-handler.js`
2. `factory.js` 6. `index.js` 7. `permission-handler.js`
3. `presets/deny-all.js` 9. `presets/index.js` 10. `presets/interactive.js`
4. `presets/production.js` 12. `presets/safe.js` 13. `prompt-transformer.js`
5. `registry.js` 15. `session-lifecycle.js` 16. `tool-interceptor.js`
6. `types.js` 18. `user-input.js`

### terminal/ (27 arquivos)

1. `bootstrap.js` 2. `commands/alias.js` 3. `commands/attach.js`
2. `commands/config.js` 5. `commands/context.js` 6. `commands/gh.js`
3. `commands/git.js` 8. `commands/help.js` 9. `commands/index.js`
4. `commands/memory.js` 11. `commands/plan.js` 12. `commands/resume.js`
5. `commands/session.js` 14. `commands/skills.js` 15. `dialog.js`
6. `file-context.js` 17. `handlers-agent.js` 18. `handlers-dialog.js`
7. `handlers-shared.js` 20. `handlers-system.js` 21. `http-handlers.js`
8. `index.js` 23. `repl.js` 24. `route-table.js` 25. `server.js`
9. `state.js` 27. `workspace-context.js`

### conversation-hub/ (6 arquivos)

1. `hub.js` 2. `index.js` 3. `orchestrator.js`
2. `socket-ns.js` 5. `store.js` 6. `store-helpers.js`

### bridges/ (10 arquivos)

1. `alias-store.js` 2. `gh-bridge.js` 3. `gh/ci.js` 4. `gh/issues.js`
2. `gh/pr.js` 6. `gh/utils.js` 7. `git-bridge.js` 8. `index.js`
3. `mcp-tool-bridge.js` 10. `nerv-bridge.js`

### lib/ (12 arquivos)

1. `agents.js` 2. `event-helpers.js` 3. `hooks.js` 4. `http-request.js`
2. `index.js` 6. `models.js` 7. `permissions.js` 8. `sdk-client.js`
3. `session.js` 10. `tools-registry.js` 11. `url-validator.js` 12. `utils.js`

### routes/ (7 arquivos)

1. `agent.js` 2. `client.js` 3. `hooks.js` 4. `middleware.js`
2. `observability.js` 6. `sessions.js` 7. `webhooks.js`

### config/ (9 arquivos)

1. `custom-agents.js` 2. `index.js` 3. `mcp-servers.js`
2. `pinned-files-loader.js` 5. `session-config.js` 6. `system-prompt.js`
3. `tools/custom-tools.js` 8. `tools/index.js` 9. `tools/sdk-tools.js`

### channel/ (3 arquivos)

1. `client.js` 2. `index.js` 3. `inject.js`

### api/ (6 arquivos)

1. `bridge-control.js` 2. `bridge-dialog.js` 3. `bridge-stream.js`
2. `bridge-tasks.js` 5. `http-bridge.js` 6. `sdk-api.js`

### core/ (3 arquivos)

1. `constants.js` 2. `errors.js` 3. `index.js`

### types/ (3 arquivos)

1. `index.js` 2. `sdk.js` 3. `structured-message.js`

### db/ (2 arquivos)

1. `migrations.js` 2. `sqlite.js`

---

## 13. Histórico de Versões

| Versão | Data       | Mudanças                                                                |
| ------ | ---------- | ----------------------------------------------------------------------- |
| 1.0    | 2026-07-04 | Versão inicial — plano completo de auditoria                            |
| 1.1    | 2026-07-04 | Revisão crítica: fix counts, specs mapeados, seções 9-12                |
| 1.2    | 2026-07-04 | Visão arquitetural AS-IS/TO-BE (seções 3.5-3.6), delta de transformação |

**Changelog v1.2**:

- Adicionado: seção 3.5 (Diagnóstico Arquitetural — AS-IS) com métricas empíricas de acoplamento
- Adicionado: seção 3.6 (Visão Arquitetural — TO-BE) com diagrama de camadas e 10 princípios
- Adicionado: matriz Delta AS-IS→TO-BE com 9 transformações priorizadas
- Identificado: 5 violações de camada, 76 barrel bypasses, 22 SDK direct imports, ~30 singletons
