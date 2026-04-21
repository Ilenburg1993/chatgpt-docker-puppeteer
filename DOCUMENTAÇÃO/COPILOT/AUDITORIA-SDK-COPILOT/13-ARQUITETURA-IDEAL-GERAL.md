# 13 — Arquitetura Ideal Geral: Proposta de Consolidação

**Data**: 2026-03-21 **Escopo**: Todo `src/copilot/` — proposta de arquitetura clean **Referência**:
[12-ARQUITETURA-GERAL-AUDITORIA-PROFUNDA.md](./12-ARQUITETURA-GERAL-AUDITORIA-PROFUNDA.md),
[05-ARQUITETURA-IDEAL.md](./05-ARQUITETURA-IDEAL.md)

> Este documento **supersede** o 05-ARQUITETURA-IDEAL.md que focava em SDK coverage. Aqui o foco é
> consolidação arquitetural integral.

---

## 1. Princípios

1. **Single Responsibility**: cada módulo faz UMA coisa
2. **Kill the middlemen**: eliminar camadas de passthrough sem valor
3. **One bus to rule them all**: unificar 3 event buses em 1
4. **DI over singletons**: estado injetável, testável, resetável
5. **SDK as library, not framework**: `sdk/` é wrapper fino, sem estado
6. **Agent as orchestrator, not god**: `agent/` orquestra, não implementa
7. **Backwards compatible migration**: cada passo é deployável

---

## 2. Camadas Ideais (L0-L5)

```
┌──────────────────────────────────────────────────────────────────────┐
│                    L5 — PRESENTATION                                  │
│  server/           HTTP API + Socket.IO + SSE                         │
│  terminal/         REPL interativo + commands + dialog                │
│                    (api/ REMOVIDO — consolidado em server/)           │
└────────────┬─────────────────────────────────────────────────────────┘
             │ importa services/ e agent/
┌────────────▼─────────────────────────────────────────────────────────┐
│                    L4 — ORCHESTRATION                                  │
│  agent/            AlwaysAliveAgent (fachada <300L, zero lógica)      │
│    ├── lifecycle/  Apenas start/stop/reconnect                        │
│    ├── dialog/     Loop + turn + watchdog (sem config, sem hooks)     │
│    └── session/    Session init + event-wirer (delegação pura)        │
│  conversation-hub/ Multi-sessão, store, broadcast                     │
│  channel/          LLM-A ↔ LLM-B bridge                              │
└────────────┬─────────────────────────────────────────────────────────┘
             │
┌────────────▼─────────────────────────────────────────────────────────┐
│                    L3 — POLICIES & TOOLS                              │
│  hooks/            Permissões + interceptors + presets                 │
│  tools/            Custom Tools (14 categorias)                       │
│  event-handlers/   SDK session event handlers (MOVIDO de agent/)      │
└────────────┬─────────────────────────────────────────────────────────┘
             │
┌────────────▼─────────────────────────────────────────────────────────┐
│                    L2 — CONFIGURATION                                  │
│  config/           Env + system prompt + builders + agent config       │
│  bridges/          Git + GitHub CLI + MCP + NERV                      │
└────────────┬─────────────────────────────────────────────────────────┘
             │
┌────────────▼─────────────────────────────────────────────────────────┐
│                    L1 — SDK FACADE (stateless)                        │
│  sdk/              Wrapper @github/copilot-sdk                        │
│    ├── session/    create/resume/delete (pure functions)               │
│    ├── rpc/        RPC wrappers                                       │
│    ├── tools/      Tool factory + registry                            │
│    └── constants/  Re-exports de constantes SDK                       │
│    (SEM session registry, SEM estado mutable)                         │
└────────────┬─────────────────────────────────────────────────────────┘
             │
┌────────────▼─────────────────────────────────────────────────────────┐
│                    L0 — CORE                                          │
│  core/             Erros, retry, DI, EventBus (ÚNICO bus)             │
│  events/           Constantes de eventos (sem middleware)              │
│  infra/            Queue, storage, lockfile, SSE, webhooks            │
│  db/               SQLite + migrations                                │
│  observability/    Logs + métricas + OTEL (consolidado)               │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Mudanças Propostas (Consolidação)

### C1: Eliminar `api/` — Merge em `server/` 🔴

**Problema**: `api/express/` (10 files, 1937L) duplica `server/routes/`. **Ação**: Migrar callers de
`api/` para `server/routes/`, remover `api/`. **Impacto**: -1937L, -10 arquivos. **Risco**: Baixo
(verificar se algum consumer externo usa `api/`).

### C2: Eliminar `services/` — Inline nos consumers 🟡

**Problema**: `services/` (547L) é barrel + 4 facades finas sem lógica. **Ação**: Routes que usam
`SessionService` importam diretamente de `#copilot/sdk` + `#copilot/hooks`. Os re-exports de
`index.js` viram barrel direto. **Impacto**: -547L, -6 arquivos. **Risco**: Baixo (4 consumers
afetados).

### C3: Mover event-handlers de `agent/` para `event-handlers/` (L3) 🟠

**Problema**: `agent/session/event-handlers/` (12 files, ~700L) são handlers de eventos SDK
genéricos que reagem a session events. Estão em L5 (agent) mas são lógica L3. **Ação**: Criar
`src/copilot/event-handlers/` (L3). Agent apenas registra via `wireSessionEvents()`. **Impacto**:
agent/ fica menor, handlers testáveis isoladamente. **Risco**: Moderado (refator imports).

### C4: Mover infra do agent para `infra/` 🟠

**Problema**: `agent/infra/` mistura lógica do agente com infra genérica. **Ação**:

- `webhook-manager.js` → `infra/webhooks.js`
- `status-snapshot.js` → `observability/snapshots.js`
- `permission-controller.js` → `hooks/permission-controller.js`
- `tools-bootstrap.js` → `tools/bootstrap.js`
- Manter em agent/: `task-executor.js`, `message-queue.js`, `handoff-manager.js` (são
  agent-specific) **Impacto**: -4 arquivos do agent/, melhor colocação semântica. **Risco**:
  Moderado.

### C5: Remover estado do `sdk/` — Stateless Wrapper 🟠

**Problema**: `sdk/session/client.js` (386L) mantém `_client`, `_sessions` Map, `_startPromise`.
Isso é estado de orquestração vivendo em L1. **Ação**: Mover session registry para
`conversation-hub/` ou para um novo `agent/session-registry.js`. `sdk/session/client.js` vira
wrapper puro: `createClient(opts)` → `CopilotClient`. **Impacto**: sdk/ fica stateless e mais
simples de testar. **Risco**: Alto (muitos consumers dependem de `getClient()` singleton).

### C6: Consolidar `sdk/agent/` em `config/` 🟡

**Problema**: `sdk/agent/agents.js` é factory de CustomAgentConfig. `config/custom-agents.js` já
existe e faz algo similar. **Ação**: Mover lógica de `sdk/agent/agents.js` para
`config/custom-agents.js`. Contracts (`contract.js`, `bridge-contract.js`, `channel-contract.js`)
vão para `types/contracts/`. **Impacto**: sdk/ fica mais fino. **Risco**: Baixo.

### C7: Mover `agent/config.js` para `config/agent.js` 🟡

**Problema**: Config do agente está em agent/ (L5), mas config é L2. **Ação**: `agent/config.js` →
`config/agent.js`. Agent importa de `#copilot/config`. **Impacto**: agent/ fica mais focado em
orquestração. **Risco**: Baixo.

### C8: Unificar Event Buses 🟠

**Problema**: 3 buses (EventBus, SDK events, HookBus) com bridges manuais. **Ação — Fase 1**:
Substituir HookBus por EventBus com namespace `hook:*`. `hooks/bus.js` vira thin adapter sobre
EventBus. **Ação — Fase 2**: SDK events passam pelo EventBus via bridge automático (já existe
parcialmente). **Resultado**: 1 bus global. Consumers filtram por prefix (`agent:*`, `hook:*`,
`sdk:*`). **Impacto**: Eliminação de bridges manuais, simplificação de observability. **Risco**:
Alto (mudança fundamental na wiring).

### C9: Consolidar error handling pipeline 🟡

**Problema**: 5 camadas de error handling (seção 6 do doc 12). **Ação**: Definir pipeline explícito:

1. `core/errors.js` — hierarquia de erros (inalterado)
2. `core/error-handlers.js` — classificação + toError (inalterado)
3. `hooks/error-handler.js` — SDK onErrorOccurred (inalterado)
4. **NOVO** `observability/error-pipeline.js` — unifica error-tracker, error-alerting, error-alerter
   em um único pipeline com 3 estágios: track → evaluate → alert **Impacto**: 3 módulos → 1
   pipeline. Configuração declarativa. **Risco**: Baixo (consolidação interna de observability).

### C10: Simplificar chain de envio de mensagem 🟠

**De 7 níveis para 4:**

```
ANTES (7 níveis):
  terminal → messaging → queue-processor → task-executor → turn-executor → lifecycle → SDK

DEPOIS (4 níveis):
  terminal → agent.sendMessage() → queue + executor → SDK session.send()
```

**Ação**:

- `agent-messaging.js` merge com `queue-processor.js` — ambos são thin
- `task-executor.js` merge com `turn-executor.js` — executar + OTEL é 1 responsabilidade
- `lifecycle.js` (sdk) chamado diretamente, não via wrapper intermediário

### C11: Trim `observability/` 🟡

**Problema**: 32 arquivos, 5.757L. Collectors e bus-actions duplicam handlers do agent. **Ação**:

- Unificar `collectors/` e `bus-actions/` em `observers/` (já existe parcialmente)
- Remover `event-catalog.js` dead-letter queue (defensive programming excessivo)
- Consolidar `error-tracker.js` + `error-alerting.js` + `bus-actions/error-alerter.js` em
  `error-pipeline.js` (proposta C9) **Impacto**: -8 arquivos, -1500L estimados. **Risco**: Baixo.

---

## 4. Diagrama da Arquitetura Ideal

```
                    ┌─────────────────────┐
                    │    L5: PRESENTATION  │
                    │  server/  terminal/  │
                    └────────┬────────────┘
                             │
                    ┌────────▼────────────┐
                    │   L4: ORCHESTRATION  │
                    │                      │
                    │  agent/ (<300L fac.) │
                    │    ├── lifecycle/    │
                    │    ├── dialog/       │
                    │    └── session/      │
                    │                      │
                    │  conversation-hub/   │
                    │  channel/            │
                    └────────┬────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼────┐  ┌─────▼─────┐  ┌─────▼──────┐
     │ L3: POLICIES│  │ L3: TOOLS │  │ L3: EVENTS │
     │  hooks/     │  │  tools/   │  │  handlers/ │
     └────────┬────┘  └─────┬─────┘  └─────┬──────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────▼────────────┐
                    │  L2: CONFIGURATION   │
                    │  config/  bridges/   │
                    └────────┬────────────┘
                             │
                    ┌────────▼────────────┐
                    │  L1: SDK (stateless) │
                    │  sdk/               │
                    └────────┬────────────┘
                             │
                    ┌────────▼────────────┐
                    │  L0: CORE            │
                    │  core/ events/ infra/ │
                    │  db/ observability/   │
                    └──────────────────────┘
```

---

## 5. Impacto Estimado (antes → depois)

| Métrica                 | Atual | Ideal  | Redução |
| ----------------------- | ----- | ------ | ------- |
| Total de arquivos       | 408   | ~300   | ~25%    |
| Total de linhas         | ~62k  | ~45k   | ~27%    |
| Módulos toplevel        | 21    | 14     | -7      |
| `agent/` linhas         | 8.620 | ~4.000 | -54%    |
| `sdk/` linhas           | 8.096 | ~5.000 | -38%    |
| `observability/` linhas | 5.757 | ~3.500 | -39%    |
| Event buses             | 3     | 1      | -67%    |
| Send message chain      | 7     | 4      | -43%    |
| Duplicações funcionais  | 7     | 0      | -100%   |

### Módulos removidos:

- `api/` → consolidado em `server/`
- `services/` → inline em consumers
- `plugins/` → merge com `config/` (plugin config) ou removido se não usado

### Módulos movidos:

- `agent/session/event-handlers/` → `event-handlers/` (L3)
- `agent/infra/webhook-manager.js` → `infra/webhooks.js`
- `agent/infra/permission-controller.js` → `hooks/permission-controller.js`
- `agent/infra/tools-bootstrap.js` → `tools/bootstrap.js`
- `agent/infra/status-snapshot.js` → `observability/snapshots.js`
- `agent/config.js` → `config/agent.js`
- `sdk/agent/` → `config/` + `types/contracts/`

---

## 6. Plano de Execução — Faixa L (Consolidação Arquitetural)

### Fase L1 — Quick Wins (8h) 🔴

| #    | Ação                                                 | Risco | Estimativa |
| ---- | ---------------------------------------------------- | ----- | ---------- |
| L1.1 | Remover `api/` — merge endpoints em `server/routes/` | Baixo | 3h         |
| L1.2 | Remover `services/` — inline em consumers            | Baixo | 2h         |
| L1.3 | Mover `agent/config.js` → `config/agent.js`          | Baixo | 1h         |
| L1.4 | Mover `sdk/agent/contracts` → `types/contracts/`     | Baixo | 1h         |
| L1.5 | Deprecar `sdk/config.js::buildSessionConfig`         | Baixo | 1h         |

### Fase L2 — Agent Slimming (16h) 🟠

| #    | Ação                                                      | Risco    | Estimativa |
| ---- | --------------------------------------------------------- | -------- | ---------- |
| L2.1 | Mover `agent/session/event-handlers/` → `event-handlers/` | Moderado | 4h         |
| L2.2 | Mover `agent/infra/` itens para módulos corretos (C4)     | Moderado | 4h         |
| L2.3 | Merge `agent-messaging.js` + `queue-processor.js`         | Moderado | 2h         |
| L2.4 | Merge `task-executor.js` + `turn-executor.js`             | Moderado | 3h         |
| L2.5 | Testes de regressão                                       | —        | 3h         |

### Fase L3 — SDK Stateless (10h) 🟠

| #    | Ação                                                          | Risco    | Estimativa |
| ---- | ------------------------------------------------------------- | -------- | ---------- |
| L3.1 | Extrair session registry de `sdk/session/client.js`           | Alto     | 4h         |
| L3.2 | Mover `sdk/agent/agents.js` → `config/custom-agents.js`       | Baixo    | 2h         |
| L3.3 | Eliminar `sdk/config.js` (subsumido por SessionConfigBuilder) | Moderado | 2h         |
| L3.4 | Testes de regressão                                           | —        | 2h         |

### Fase L4 — Event Bus Unification (12h) 🟠

| #    | Ação                                                        | Risco    | Estimativa |
| ---- | ----------------------------------------------------------- | -------- | ---------- |
| L4.1 | HookBus → EventBus com namespace `hook:*`                   | Alto     | 4h         |
| L4.2 | SDK event bridge automático via registry                    | Alto     | 4h         |
| L4.3 | Consolidar observability collectors/bus-actions → observers | Moderado | 2h         |
| L4.4 | Testes de regressão                                         | —        | 2h         |

### Fase L5 — Error Pipeline + Observability Trim (8h) 🟡

| #    | Ação                                                         | Risco | Estimativa |
| ---- | ------------------------------------------------------------ | ----- | ---------- |
| L5.1 | Unificar error-tracker + error-alerting → error-pipeline.js  | Baixo | 3h         |
| L5.2 | Remover event-catalog.js dead-letter (unused defensive code) | Baixo | 1h         |
| L5.3 | Consolidar collectors + bus-actions → observers              | Baixo | 2h         |
| L5.4 | Testes de regressão                                          | —     | 2h         |

---

## 7. Resumo de Estimativas — Faixa L

| Fase      | Nome                      | Prioridade | Horas   |
| --------- | ------------------------- | ---------- | ------- |
| L1        | Quick Wins                | 🔴 P0      | 8h      |
| L2        | Agent Slimming            | 🟠 P1      | 16h     |
| L3        | SDK Stateless             | 🟠 P1      | 10h     |
| L4        | Event Bus Unification     | 🟠 P1      | 12h     |
| L5        | Error Pipeline + Obs Trim | 🟡 P2      | 8h      |
| **Total** |                           |            | **54h** |

### Relação com Faixas Anteriores

| Faixa Anterior                   | Status    | Relação com Faixa L                                                 |
| -------------------------------- | --------- | ------------------------------------------------------------------- |
| Faixa G (Arch Refactoring, 46h)  | Planejada | **L subsume G1, G3, G4**. G2 (Hub lifecycle) mantém-se independente |
| Faixa J (SDK Gateway, 12h)       | Planejada | **L3 subsume J2** (dead code). J1+J3 mantêm-se                      |
| Faixa K (Agent Refactoring, 43h) | Planejada | **L2 complementa K**. Executar K1+K2 primeiro, depois L2            |

### Sprint Sugerido

| Sprint     | Fases                               | Horas | Pré-requisito |
| ---------- | ----------------------------------- | ----- | ------------- |
| L-Sprint 1 | L1 (Quick wins)                     | 8h    | Nenhum        |
| L-Sprint 2 | L2 (Agent slim) + K1 (AgentContext) | 24h   | L1            |
| L-Sprint 3 | L3 (SDK stateless) + L4 (Event bus) | 22h   | L2            |
| L-Sprint 4 | L5 (Error + Obs)                    | 8h    | L4            |

---

## 8. Checklist de Validação Pós-Refactor

Para cada fase, verificar:

- [ ] `npm run lint` ✅
- [ ] `npm run test:unit` ✅
- [ ] `npm run test:integration` ✅
- [ ] Nenhum import de @github/copilot-sdk fora de sdk/
- [ ] Nenhum path relativo cross-module (usar aliases #copilot/\*)
- [ ] agent/ < 5000L
- [ ] sdk/ stateless (sem \_client, \_sessions)
- [ ] EventBus é o único bus
- [ ] Send message chain ≤ 4 níveis
