# PARTE-20A — Situação Atual: Análise Arquitetural Profunda de `src/copilot`

**Data**: 2026-04-10 | **Status**: Canônico | **Versão**: 1.1 **Scope**: Todo o diretório
`src/copilot` — 287 arquivos `.js`, ~51.800 LoC totais (inclui JSDoc robusto) **Última
atualização**: 2026-04-12 — Pós-execução do PARTE-20C Roadmap (Faixas A-E concluídas, F-G parciais)

---

## 0. Situação Pós-Refatoração (Roadmap PARTE-20C)

> Esta seção registra o estado **depois** da execução do roadmap. As seções abaixo (1-8) preservam a
> análise original para referência histórica. Consulte `PARTE-20C-ROADMAP.md` v1.4 para o
> detalhamento.

### Métricas Atualizadas

| Métrica                                    | Valor Original        | Valor Atual                              | Meta Ideal |
| ------------------------------------------ | --------------------- | ---------------------------------------- | ---------- |
| Total de arquivos JS                       | 284                   | 287                                      | ~200       |
| LoC totais                                 | ~33.700               | ~51.800 (+JSDoc)                         | —          |
| Arquivos > 400 LoC                         | 13                    | **0** ✅                                 | 0          |
| Arquivos 300-400 LoC                       | —                     | 9 (warnings)                             | ≤5         |
| Ciclos arquiteturais (módulo-nível)        | **3**                 | **0** ✅                                 | 0          |
| Violações de camada                        | **3** → **27** (real) | **0** ✅                                 | 0          |
| God objects (>450 LoC, múltiplos concerns) | **4**                 | **0** ✅ (todos avaliados como coesos)   | 0          |
| Duplicações de responsabilidade            | **6**                 | **0** ✅ (todas corrigidas ou avaliadas) | 0          |
| Módulos sem fronteiras claras              | **4**                 | **0** ✅ (READMEs + layer enforcement)   | 0          |
| Módulos com handlers paralelos (flat+dir)  | **1** (terminal)      | **0** ✅ (shims removidos)               | 0          |
| READMEs de módulo                          | 0                     | **14/14** ✅                             | 14/14      |
| CI gates (layer/size)                      | 0                     | **2** ✅                                 | 2+         |

### Violações Críticas — TODAS ELIMINADAS

| # Original | Problema                                                    | Status                                                                 |
| ---------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| ARCH-V01   | `core` → `observability`                                    | ✅ DI via `registerErrorHandlerDeps()` em `observability/bootstrap.js` |
| ARCH-V02   | `agent` → `terminal`                                        | ✅ `getHubSessionId` → `core/shared-state.js`                          |
| ARCH-V03   | `bridges/nerv-bridge` → `agent`                             | ✅ Factory `createNervBridge(agent)` — bridge não importa agent        |
| —          | sdk/ → observability/logger (×12)                           | ✅ Proxy `sdk/logger.js` + `setSdkLogger(log)`                         |
| —          | sdk/ → config/env                                           | ✅ Leitura direta `process.env`                                        |
| —          | sdk/ → tools/tool-factory                                   | ✅ DI via `setCustomToolsBuilder(fn)`                                  |
| —          | audit/ → agent/config, config/env, hooks/bus, observability | ✅ Proxy `audit/logger.js` + `setAuditBus()` + `process.env`           |
| —          | core/shutdown → observability                               | ✅ DI via `setShutdownLogger(log)`                                     |
| —          | db/sqlite → config/env, observability                       | ✅ DI via `setDbLogger(log)`                                           |

### Duplicações — TODAS RESOLVIDAS

| # Original | Problema                     | Status                                                                |
| ---------- | ---------------------------- | --------------------------------------------------------------------- |
| ARCH-D01   | url-validator duplicado      | ✅ SSOT em `core/security/url-validator.js`                           |
| ARCH-D02   | session-lifecycle nomes      | ✅ Renomeados: `hooks/session-hooks.js`, `sdk/sdk-session-wrapper.js` |
| ARCH-D03   | config em 3 locais           | ✅ Avaliado: concerns distintos, `DEFAULT_EXCLUDED_TOOLS` deduplicado |
| ARCH-D04   | audit em múltiplos locais    | ✅ Avaliado: sem duplicação real (concerns distintos)                 |
| ARCH-D05   | dialog.js terminal vs agent  | ✅ Avaliado: concerns claramente distintos (REPL vs AI loop)          |
| ARCH-D06   | handlers duplicados terminal | ✅ Shims flat removidos, apenas `handlers/` permanece                 |

### Hierarquia de Camadas Consolidada (CI-enforced)

```
L0  core/            — utilitários puros, zero deps internas
L0  db/              — SQLite, depende só de core
L1  sdk/             — wrapper @github/copilot-sdk, depende de core
L1  audit/           — pipeline auditoria, depende de core
L2  config/          — configuração, depende de core
L2  observability/   — logging/métricas, depende de core (injeta nos outros via bootstrap)
L3  hooks/           — permissões/lifecycle, depende de core, config, sdk
L3  tools/           — definição de Tools, depende de core, sdk
L3  bridges/         — adaptadores externos, depende de core, db, sdk
L4  agent/           — AlwaysAlive + session + dialog
L4  conversation-hub/ — gestão multi-sessão
L4  channel/         — transporte LLM-A ↔ LLM-B
L5  api/             — HTTP/SSE/Express
L6  terminal/        — REPL interativo, camada de apresentação
```

### Inventário de Módulos Atualizado

| Módulo              | Arquivos | LoC    | Função                                                 |
| ------------------- | -------- | ------ | ------------------------------------------------------ |
| `agent/`            | 54       | ~7.800 | Core agent: lifecycle, session, dialog, infraestrutura |
| `sdk/`              | 40       | ~7.700 | Wrapper @github/copilot-sdk — SSOT runtime + tipos     |
| `terminal/`         | 46       | ~7.700 | Terminal interativo LLM-B: REPL, servidor, comandos    |
| `tools/`            | 24       | ~6.200 | Definição de Tools disponíveis ao agente               |
| `observability/`    | 22       | ~4.600 | Logging, métricas, alertas, traces                     |
| `hooks/`            | 20       | ~3.500 | Sistema de hooks de permissão e lifecycle              |
| `api/`              | 21       | ~3.300 | Camada HTTP (Express) + SSE + bridge de controle       |
| `conversation-hub/` | 12       | ~2.600 | Hub de conversas entre LLMs                            |
| `bridges/`          | 10       | ~2.200 | Pontes: MCP, NERV, Git, GitHub                         |
| `core/`             | 16       | ~1.900 | Utilitários cross-cutting: erros, retry, schemas       |
| `config/`           | 7        | ~1.400 | Configuração do SDK/agente                             |
| `channel/`          | 7        | ~1.500 | Client LLM-A ↔ LLM-B                                   |
| `audit/`            | 5        | ~800   | Pipeline de auditoria com ring buffer                  |
| `db/`               | 3        | ~440   | Persistência SQLite                                    |

---

## 1. Visão Geral

`src/copilot` é o núcleo operacional do sistema. Contém o agente Copilot (AlwaysAlive), o terminal
interativo LLM-B, a camada HTTP/SSE/API, observabilidade, auditoria, ferramentas (Tools),
conversação estruturada (hub), pontes de infraestrutura (MCP, Git, GitHub) e toda a lógica de sessão
do SDK.

O sistema funciona, mas acumula dívida arquitetural relevante: limites de módulos mal definidos,
acoplamentos cruzados entre camadas não isomórficas, duplicação de responsabilidades e crescimento
orgânico sem um critério central de coesão.

---

## 2. Mapa de Módulos Atuais

### 2.1 Inventário Completo

| Módulo              | Arquivos | LoC estimado | Função Declarada                                                |
| ------------------- | -------- | ------------ | --------------------------------------------------------------- |
| `sdk/`              | 32       | ~4.800       | Wrapper do `@github/copilot-sdk` — SSOT runtime + tipos         |
| `terminal/`         | 38       | ~4.600       | Terminal interativo LLM-B: REPL, servidor, roteamento, comandos |
| `agent/`            | 40       | ~4.400       | Core agent: lifecycle, session, dialog, infraestrutura          |
| `tools/`            | 28       | ~3.200       | Definição de todas as ferramentas (Tools) disponíveis ao agente |
| `core/`             | 14       | ~2.200       | Utilitários cross-cutting: erros, retry, safe-json, schemas     |
| `conversation-hub/` | 12       | ~3.100       | Hub de conversas entre LLMs: store, orquestrador, socket        |
| `hooks/`            | 19       | ~2.400       | Sistema de hooks de permissão e lifecycle                       |
| `observability/`    | 17       | ~2.800       | Logging, métricas, alertas, traces, observadores de eventos     |
| `api/`              | 20       | ~2.000       | Camada HTTP (Express) + SSE + bridge de controle                |
| `bridges/`          | 11       | ~1.800       | Pontes: MCP Tools, Nerv EventBus, Git, GitHub                   |
| `channel/`          | 7        | ~1.600       | Client de comunicação LLM-A ↔ LLM-B                             |
| `config/`           | 7        | ~900         | Configuração do SDK/agente: sessions, system-prompt, MCP        |
| `audit/`            | 4        | ~750         | Pipeline de auditoria de eventos com ring buffer                |
| `db/`               | 3        | ~400         | Persistência SQLite                                             |
| `logs/`             | —        | —            | Outputs de log (arquivos gerados — não código)                  |

### 2.2 Arquivos de Maior Volume (> 450 LoC)

| Arquivo                            | LoC | Responsabilidade                                                       |
| ---------------------------------- | --- | ---------------------------------------------------------------------- |
| `agent/always-alive.js`            | 603 | God object que orquestra todo o ciclo de vida do agente                |
| `agent/dialog/loop-manager.js`     | 600 | Loop principal de diálogo — muito grande, múltiplas camadas misturadas |
| `sdk/types.js`                     | 569 | SSOT de tipos — correto, necessário                                    |
| `conversation-hub/store.js`        | 562 | Store global do hub — muito grande                                     |
| `channel/client.js`                | 557 | Cliente high-level LLM-B — complexo demais para um único arquivo       |
| `audit/pipeline.js`                | 537 | Pipeline de auditoria — vários concerns misturados                     |
| `terminal/index.js`                | 494 | Ponto de entrada terminal — reexporta + inicializa                     |
| `sdk/rpc.js`                       | 484 | RPC SDK — wrapper pesado                                               |
| `conversation-hub/socket-ns.js`    | 482 | Namespace Socket.io — infraestrutura misturada com lógica              |
| `tools/todo/crud-tools.js`         | 459 | CRUD de tarefas — longo mas coeso                                      |
| `terminal/server.js`               | 452 | Servidor terminal — config + routes + lifecycle misturados             |
| `channel/inject.js`                | 451 | Injetor de mensagens no agente — muito longo                           |
| `conversation-hub/orchestrator.js` | 438 | Orquestrador hub — vários padrões de call misturados                   |

---

## 3. Análise de Dependências (Grafo Real)

### 3.1 Fan-In — Módulos mais importados por outros

| Arquivo                       | Importadores | Observação                                                   |
| ----------------------------- | ------------ | ------------------------------------------------------------ |
| `agent/config.js`             | **21**       | Mais importado de todo o sistema — quase god module          |
| `core/error-handlers.js`      | **20**       | Correto — utilitário central, mas importa observability      |
| `terminal/state.js`           | **15**       | State global do terminal importado até pelo agent (violação) |
| `tools/tool-factory.js`       | **15**       | Correto — factory de tools, alta fan-in é esperada           |
| `agent/lifecycle/state-io.js` | **13**       | Muitos módulos do agent lêem estado diretamente              |
| `observability/logger.js`     | **12**       | Correto — logging é infraestrutura transversal               |

### 3.2 Fan-Out — Arquivos com mais dependências

| Arquivo                                | Dependências diretas | Observação                                |
| -------------------------------------- | -------------------- | ----------------------------------------- |
| `sdk/index.js`                         | 29                   | Barrel com todas as re-exportações do SDK |
| `terminal/commands/index.js`           | 22                   | Agrega todos os comandos do terminal      |
| `hooks/index.js`                       | 17                   | Public API dos hooks                      |
| `tools/index.js` + `terminal/index.js` | 14                   | Barrels de re-exportação                  |
| `agent/lifecycle/agent-lifecycle.js`   | **12**               | Excesso de dependências para lifecycle    |
| `core/index.js`                        | 12                   | Correto — barrel central                  |

### 3.3 Acoplamentos Entre Módulos (Cross-Module Import Count)

```
agent       → core           (12 edges)  ✅ Esperado
terminal    → core           (9 edges)   ✅ Esperado
sdk         → core           (7 edges)   ✅ Esperado
channel     → core           (3 edges)   ✅ Esperado
observ.     → core           (3 edges)   ✅ Esperado
terminal    → agent          (3 edges)   ⚠️  Terminal depende do agente (aceitável, mas cria bidirecional)
agent       → bridges        (2 edges)   ⚠️  Agent acoplado a infraestrutura externa
core        → observability  (2 edges)   🔴 VIOLAÇÃO: core não pode depender de observability
terminal    → tools          (2 edges)   ⚠️  Terminal acoplado a tools — deveria ser via agent
terminal    → channel        (2 edges)   ⚠️  Terminal usa channel diretamente
terminal    → conv-hub       (2 edges)   ⚠️  Terminal acoplado ao hub
agent       → terminal       (1 edge)    🔴 VIOLAÇÃO CRÍTICA: agent depende de terminal
bridges     → agent          (1 edge)    🔴 VIOLAÇÃO: bridge não deve depender do agent
agent       → tools          (1 edge)    ⚠️  Acoplável, mas cria implicitamente bidirecional latente
```

### 3.4 Acoplamentos Bidirecionais (Ciclos Arquiteturais)

Nenhum ciclo de importação em nível de arquivo (madge não encontrou), mas existem **3 ciclos
arquiteturais** em nível de módulo:

| Par                    | Descrição                                                                                | Severidade |
| ---------------------- | ---------------------------------------------------------------------------------------- | ---------- |
| `bridges ⟺ agent`      | `bridges/nerv-bridge.js` importa `agent/index.js`; algo no agent importa bridges         | 🔴 Alta    |
| `observability ⟺ core` | `core/error-handlers.js` importa logger + tracker de observability                       | 🔴 Alta    |
| `terminal ⟺ agent`     | `agent/lifecycle/agent-lifecycle.js` importa `terminal/state.js`; terminal importa agent | 🔴 Alta    |

---

## 4. Problemas Identificados por Categoria

### 4.1 Violações de Camada (Layer Violations)

**ARCH-V01 — `core` importa `observability`**

- Arquivo: `core/error-handlers.js`
- Importa: `observability/error-tracker.js` e `observability/logger.js`
- Impacto: Inverte a hierarquia de dependência — `core` deveria ser independente de qualquer outro
  módulo interno
- Correto seria: `core/error-handlers.js` receber logger por injeção de dependência ou
  `observability` registrar um handler em `core`

**ARCH-V02 — `agent` importa `terminal`**

- Arquivo: `agent/lifecycle/agent-lifecycle.js`
- Importa: `terminal/state.js` → `getHubSessionId()`
- Impacto: O agente core depende do estado do terminal interativo. Agent tem escopo muito maior que
  terminal. Acoplamento proibido.
- Correto seria: `getHubSessionId` deve ser injetada no agente como parâmetro ou via shared state
  module em `core/`

**ARCH-V03 — `bridges/nerv-bridge.js` importa `agent/index.js`**

- Impacto: Uma bridge de infraestrutura conhece o agente concreto — deve ser o contrário
- Correto seria: `nerv-bridge` emite/escuta eventos genéricos; agent registra listeners na bridge

### 4.2 God Objects

**ARCH-G01 — `agent/always-alive.js` (603 LoC)**

- Contém: bootstrap, conexão SDK, gerenciamento de ciclo de vida, reconexão, inicialização de hooks,
  configuração de tools, gerenciamento de listeners externos, export do singleton
- Deveria ser: separado em `AlwaysAliveBootstrap`, `AlwaysAliveConnectionManager`,
  `AlwaysAlivePublicAPI`

**ARCH-G02 — `agent/dialog/loop-manager.js` (600 LoC)**

- Contém: loop principal, retry logic, model fallback, event dispatching, backpressure, abort
  handling
- Deveria ser: `LoopOrchestrator` + `TurnExecutionPipeline` + `ModelFallbackPolicy`

**ARCH-G03 — `conversation-hub/store.js` (562 LoC)**

- Contém: CRUD de conversas, índices em memória, queries complexas, snapshots, migração de schema
- Deveria ser: `ConversationRepository` + `ConversationQueryEngine` + `ConversationSnapshot`

**ARCH-G04 — `channel/inject.js` (451 LoC)**

- Contém: spawn de sessão temporária, injeção de mensagem, gestão de resposta, retry, abort
- Deveria ser: `ChannelSessionFactory` + `MessageInjector`

### 4.3 Responsabilidades Duplicadas

**ARCH-D01 — `url-validator` duplicado**

- `agent/infra/url-validator.js` — validação SSRF para webhooks
- `sdk/url-validator.js` — validação SSRF genérica
- Ambos implementam lógica de bloqueio de hosts privados
- Correto: único `core/security/url-validator.js` usado por ambos

**ARCH-D02 — `session-lifecycle` duplicado**

- `hooks/session-lifecycle.js` — factory de hooks de lifecycle
- `sdk/session-lifecycle.js` — wrappers do SDK de lifecycle
- Nomes análogos mas funções diferentes; causa confusão de naming
- Correto: renomear para clareza — `hooks/session-hooks.js` e `sdk/session-wrapper.js`

**ARCH-D03 — `config` espalhado em 3 locais**

- `config/` — builders de SessionConfig e system-prompt
- `agent/config.js` — config interna do agent (más importado 21x)
- `sdk/config.js` — config SDK facade com merge de SessionConfig
- Todos relacionados a configuração mas sem hierarquia clara
- Correto: `config/` deve ser o único source de configuração; `agent/config.js` e `sdk/config.js`
  devem ser movidos ou fundidos

**ARCH-D04 — `audit` em múltiplos locais**

- `audit/` — pipeline + ring buffer + JSONL writer
- `hooks/presets/audit.js` — preset que grava em ring buffer
- `observability/` — event-collector + collectors/ que também grava eventos
- Correto: `audit/` deve ser o único módulo de auditoria; outros módulos devem usar sua API

**ARCH-D05 — `dialog.js` duplicado (terminal vs agent)**

- `terminal/dialog.js` — re-export de terminal dialog
- `agent/dialog/` — subsistema de diálogo do agente
- O terminal usa `terminal/dialog.js` que internamente usa `terminal/dialog/engine.js`
- Mas `agent/dialog/` é o "real" diálogo do agente SDK
- Causa confusão: dois "dialogs" com funções distintas mas nomes análogos

**ARCH-D06 — Handlers duplicados no terminal**

- `terminal/handlers-agent.js`, `terminal/handlers-dialog.js`, `terminal/handlers-shared.js`,
  `terminal/handlers-system.js` — versões flat
- `terminal/handlers/agent.js`, `terminal/handlers/dialog.js`, `terminal/handlers/shared.js`,
  `terminal/handlers/system-config.js`, `terminal/handlers/system-metrics.js` — versão subdiretório
- Dois conjuntos de handlers paralelos convivendo — forte indício de refactor incompleto

### 4.4 Módulos sem Propólise Definida

**ARCH-M01 — `logs/` dentro de `src/copilot/`**

- Logs são artefatos gerados em runtime, não código fonte
- Deve ser movido para fora de `src/` (ex.: `var/logs/copilot/`)

**ARCH-M02 — `channel/` vs `conversation-hub/`**

- `channel/` — client de comunicação LLM-A ↔ LLM-B via AlwaysAliveAgent
- `conversation-hub/` — store + orquestrador de conversas multi-sessão
- Fronteiras sobrepostas: ambos tratam "conversas"; não está claro o que um faz que o outro não faz

**ARCH-M03 — `bridges/` mistura naturezas diferentes**

- `bridges/mcp-tool-bridge.js` — adapta ferramentas MCP para o formato Tool do SDK
- `bridges/nerv-bridge.js` — publica eventos do agente no EventBus NERV
- `bridges/git-bridge.js` — interface de alto nível para operações git
- `bridges/gh/` — operações GitHub (Issues, PRs, CI)
- MCP bridge é um adaptador de tipo; nerv-bridge é um publisher de eventos; git/github são clients
  HTTP/CLI — completamente diferentes

**ARCH-M04 — `terminal/` é um módulo monolítico grande demais**

- 38 arquivos, ~4.600 LoC
- Contém: servidor HTTP, REPL interativo, roteamento, 23 comandos, dialogo, handlers (duplicados),
  state global
- Deveria ser: `terminal/server/`, `terminal/repl/`, `terminal/commands/`, `terminal/state/`

### 4.5 Problemas de Nomenclatura

| Problema             | Arquivo(s)                                          | Descrição                                        |
| -------------------- | --------------------------------------------------- | ------------------------------------------------ |
| Nome genérico        | `core/schemas.js`                                   | Qual schema? Para que?                           |
| Nome genérico        | `core/events.js`                                    | Quais eventos? Core eventos ou codec de eventos? |
| Nome ambíguo         | `agent/types.js` vs `sdk/types.js`                  | Dois arquivos de tipos com nomes idênticos       |
| Nome ambíguo         | `hooks/types.js` vs `agent/types.js`                | Mais um types.js — não fica claro o escopo       |
| Flat + dir paralelos | `terminal/handlers-*.js` e `terminal/handlers/*.js` | Dois conjuntos paralelos                         |
| Nome impreciso       | `sdk/utils.js`                                      | Quais utils? Genérico demais                     |
| Nome impreciso       | `bridges/gh/shared.js`                              | "shared" não descreve o conteúdo                 |

### 4.6 Problemas de Isolamento

**ARCH-I01 — `terminal/state.js` como estado global transversal**

- `terminal/state.js` contém estado do hub (hubSessionId), ocupação do terminal, e SSE replay buffer
- É importado por 15 arquivos de diferentes módulos
- Estado global de terminal vaza para o sistema — deveria ser encapsulado

**ARCH-I02 — `agent/config.js` over-exposed**

- Importado por 21 arquivos de diferentes módulos
- Contém todas as constantes de configuração do agente plus lógica de ENV
- Qualquer mudança em variáveis de env pode afetar 21 pontos no código

**ARCH-I03 — Ausência de API pública definida para `agent/`**

- `agent/index.js` exporta: `alwaysAliveAgent`, `configureHookTools`, `setHub`, `setPermissionAgent`
- Setter functions `setHub` e `setPermissionAgent` sugerem ausência de injeção de dependência no
  bootstrap — estado mutável exposto
- Múltiplos módulos importam internals do agent (config.js, state-io.js) diretamente

---

## 5. Análise de Coesão por Módulo

| Módulo              | Coesão   | Razão                                                                                        |
| ------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `core/`             | ✅ Alta  | Utilitários independentes, sem dependências internas problemáticas (exceto `error-handlers`) |
| `sdk/`              | ✅ Alta  | Bem delimitado ao wrapper do SDK — correto                                                   |
| `audit/`            | ✅ Alta  | Ring buffer + pipeline + JSONL writer — coeso                                                |
| `db/`               | ✅ Alta  | SQLite + migrations — coeso                                                                  |
| `config/`           | ⚠️ Média | Mistura configuração do SDK, system-prompt e agents — temas relacionados mas distintos       |
| `hooks/`            | ⚠️ Média | Permissões, lifecycle, presets, tipos, registry — tudo hooks, mas escopo amplo               |
| `tools/`            | ⚠️ Média | Definições de tools corretas mas factory ficou pesada                                        |
| `bridges/`          | ⚠️ Baixa | 4 naturezas diferentes co-habitando (adaptador, publisher, client HTTP, client CLI)          |
| `agent/`            | ⚠️ Baixa | Subsistemas grandes demais — agente monolítico com dialog, session, infra, lifecycle juntos  |
| `observability/`    | ⚠️ Baixa | Logger + metrics + otel + audit-collector + alertas — muitos concerns                        |
| `terminal/`         | 🔴 Baixa | Monolítico: servidor, REPL, handlers duplos, state global, 23 comandos — muito grande        |
| `conversation-hub/` | 🔴 Baixa | Hub de convs + store + orquestrador + socket + sync — bounded context mal definido           |
| `channel/`          | 🔴 Baixa | Fronteira com `conversation-hub` e `api/` não está clara                                     |

---

## 6. Métricas de Saúde Arquitetural

> ⚠️ **Nota**: Valores "Atual" abaixo refletem o estado **pré-refatoração** (2026-04-10). Para
> métricas atualizadas pós-roadmap, ver Seção 0.

| Métrica                                    | Valor Atual (pré-refatoração) | Meta Ideal           |
| ------------------------------------------ | ----------------------------- | -------------------- |
| Total de arquivos JS                       | 284                           | ~200 (consolidações) |
| LoC totais                                 | ~33.700                       | ~28.000 (-15%)       |
| Arquivos > 400 LoC                         | 13                            | 0 (máximo 300)       |
| Ciclos arquiteturais (módulo-nível)        | **3**                         | 0                    |
| Violações de camada                        | **3**                         | 0                    |
| God objects (>450 LoC, múltiplos concerns) | **4**                         | 0                    |
| Duplicações de responsabilidade            | **6**                         | 0                    |
| Módulos sem fronteiras claras              | **4**                         | 0                    |
| Cross-module dependency edges              | **26**                        | **≤15**              |
| Módulos com handlers paralelos (flat+dir)  | **1** (terminal)              | 0                    |

---

## 7. Resumo dos Problemas Críticos (Top 10)

| #   | Problema                                                                     | Severidade | Módulo(s)           |
| --- | ---------------------------------------------------------------------------- | ---------- | ------------------- |
| 1   | `core` importa `observability` — inversão de dependência                     | 🔴 Crítico | core, observability |
| 2   | `agent` importa `terminal` — acoplamento proibido                            | 🔴 Crítico | agent, terminal     |
| 3   | `bridges/nerv-bridge` importa `agent` — bridge depende de concreto           | 🔴 Crítico | bridges, agent      |
| 4   | `always-alive.js` e `loop-manager.js` — god objects >600 LoC                 | 🔴 Crítico | agent               |
| 5   | `terminal/` — monolito 38 arquivos com handlers duplos                       | 🔴 Crítico | terminal            |
| 6   | `agent/config.js` over-exposed — importado por 21 módulos                    | 🔴 Alto    | agent, config       |
| 7   | `url-validator` duplicado em `agent/infra/` e `sdk/`                         | 🟠 Alto    | agent/infra, sdk    |
| 8   | Config espalhada em 3 locais (`config/`, `agent/config.js`, `sdk/config.js`) | 🟠 Alto    | config, agent, sdk  |
| 9   | `bridges/` sem coesão — 4 naturezas diferentes                               | 🟠 Médio   | bridges             |
| 10  | `logs/` dentro de `src/copilot` — artefatos runtime no source                | 🟡 Médio   | logs                |

---

## 8. Notas Finais

A arquitetura atual é **funcionalmente robusta** — o sistema opera, tem testes, tem auditoria, tem
hooks. O problema é de **organização e manutenibilidade**: ao crescer organicamente, fronteiras
foram violadas, responsabilidades duplicadas, e módulos cresceram além do razoável.

As correções necessárias são majoritariamente de **reorganização estrutural**, não de lógica. O
comportamento externo deve se manter idêntico após as refatorações.

---

**Próximos documentos**:

- `PARTE-20B-SITUACAO-IDEAL.md` — arquitetura target, critérios, layout ideal
- `PARTE-20C-ROADMAP.md` — plano de migração com faixas e fases
- `PARTE-20D-GRAFO-IMPORTS.md` — grafo visual textual atual e ideal
- `PARTE-20E-CRITERIOS.md` — critérios de avaliação arquitetural
