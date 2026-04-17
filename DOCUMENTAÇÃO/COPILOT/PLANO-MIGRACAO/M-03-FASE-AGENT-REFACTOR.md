# M-03 — Fase 2: Agent Refactoring Completo

**Data**: 2026-03-21
**Versão**: 2.7
**Pré-requisito**: M-02 (Cleanup) concluído
**Estimativa**: ~59h
**Risco**: Moderado
**Consolida**: Faixa K (K1-K8, 43h) + Faixa L2 (Agent Slimming, 16h)

**Documento complementar**: [M-03A — Auditoria Arquitetural Geral de `src/copilot/agent`](./M-03A-AUDITORIA-ARQUITETURAL-AGENT.md)

> **Nota de sucessão clean (2026-04-15)**: esta fase continua útil como registro do eixo histórico
> de execução do `agent/`, mas a referência canônica para o próximo ciclo amplo de rearquitetura
> passou a ser a série
> [`../PLANO-REARQUITETURA-CLEAN/README.md`](../PLANO-REARQUITETURA-CLEAN/README.md), em especial
> `R-03` (auditoria do agent) e `R-08` (programa do agent core e lifecycle).

## 0. Status auditado — 2026-04-15

Esta fase já entrou em **execução incremental**, mas ainda está longe de concluída.

Groundwork pré-existente no baseline:

- `AgentContext` já existe como objeto compartilhado;
- `agent/session/event-wirer.js` já é um orquestrador fino, com handlers separados em
    `agent/session/event-handlers/`;
- `getAgent()` já existe como accessor público.

Avanço executado neste checkpoint:

- **L2.1 concluída de forma incremental**: a implementação real dos handlers foi movida para `src/copilot/event-handlers/`;
- `agent/session/event-wirer.js` agora consome `#copilot/event-handlers`;
- o caminho legado `agent/session/event-handlers/` foi preservado temporariamente com **compat shims** de 8 linhas por arquivo;
- **K8 concluída de forma incremental**: `alwaysAliveAgent` deixou de ser instanciado eager no topo do módulo;
- a API pública agora expõe `getAgent()` lazy + `alwaysAliveAgent` via proxy compatível + `resetAgent()` para testes/reinit controlado;
- **L2.3 parcialmente concluída**: `processQueue()` agora mora canonicamente em `agent/messaging/agent-messaging.js`;
- `queue-processor.js` foi reduzido a **shim de compatibilidade com 15 linhas**;
- `always-alive.js` já delega o processamento de fila para o caminho canônico em `agent-messaging.js`;
- `executeTask()` agora também mora canonicamente em `agent/messaging/agent-messaging.js`;
- `agent/infra/task-executor.js` foi reduzido a **shim de compatibilidade com 14 linhas**;
- **K5 iniciada de forma incremental**: `performBootWiring()` agora usa `createBootWiringSteps()` + `runBootPipeline()`;
- `boot-wiring.js` passou a expor um pipeline nomeado com **12 etapas explícitas**, preservando o contrato público de
    `performBootWiring()`;
- **K5b iniciada de forma incremental**: `session/boot-wiring.js` foi reduzido a **263L** como runner/compositor fino;
- `session/boot-steps.js` (**321L**) agora concentra a maior parte da implementação real das steps do boot;
- os pontos canônicos visíveis de lifecycle SDK e quota monitor permaneceram em `boot-wiring.js` para compatibilidade com
    auditorias/testes estruturais já existentes no repositório;
- **K6 iniciada de forma incremental**: `always-alive.js` agora consome `AGENT_EVENT_BRIDGE_MAP`,
    `DIALOG_LOOP_EVENT_BRIDGE_MAP` e `HANDOFF_EVENT_BRIDGE_MAP`;
- `agent/event-bridge-map.js` foi criado como fonte declarativa do wiring EventEmitter → EventBus;
- **K6b iniciada de forma incremental**: o wiring lazy saiu de `always-alive.js` e agora mora em
    `agent/event-bridge-wiring.js`;
- `always-alive.js` agora delega `ensureAgentEventBusBridge()`/`resetAgentEventBusBridgeWiring()` e está em **638L**;
- **K3 iniciada de forma incremental**: `agent/error-policy.js` agora centraliza a classificação `retry|fatal|ignore`;
- `agent-messaging.js` e `reconnect-policy.js` já consomem a política central, removendo a primeira duplicação real de
    heurística entre fila e reconexão;
- **K1a iniciada de forma incremental**: `agent-context.js` agora usa subestados nomeados (`sessionState`,
    `dialogState`, `configState`, `metricsState`, `runtimeState`, `ioState`) com accessors de compatibilidade;
- `state/agent-state.js` e `facades/agent-model-config.js` já migraram para ler/escrever os subestados diretamente;
- **K1b iniciada de forma incremental**: `lifecycle/session-setup.js`, `messaging/agent-messaging.js`,
    `dialog/agent-dialog-controller.js` e `facades/agent-session-ops.js` já passaram a consumir subestados diretamente;
- `session-setup.js` também ganhou fallback compatível para mocks legados de teste, preservando o comportamento real em runtime;
- **K1b avançada de forma substancial**: `lifecycle/agent-lifecycle.js` agora usa views locais sobre
    `sessionState`, `configState`, `metricsState`, `runtimeState` e `ioState` nas rotas principais de start/stop/reconnect,
    preservando apenas alguns acessos compatíveis exigidos por testes estruturais do repositório (`ctx.status`, `ctx.quotaMonitor`);
- a fachada pública de `always-alive.js` já migrou os getters de `status`, `pendingQuestion`, `sessionId` e `lastPrInfo`
    para leitura direta dos subestados;
- **K4 iniciada de forma incremental**: `agent/background-tasks.js` agora centraliza `track()`/`drain()` para tarefas
    fire-and-forget do runtime do agente;
- `agent-context.js` já instancia `backgroundTasks` e emite `agent.background.completed` / `agent.background.idle`;
- `agent-lifecycle.js` já usa `backgroundTasks.track(...)` em writes/syncs assíncronos e faz `backgroundTasks.drain(5000)`
    no shutdown;
- `session-setup.js`, `dialog/user-input-handler.js`, `agent-messaging.js`, `session/boot-steps.js` e `dialog/loop-manager.js`
    já estão no primeiro lote de integração do tracker;
- **K7 iniciada de forma incremental**: `agent/health-check.js` agora centraliza os checks canônicos de
    client/session/dialog/queue/io;
- `AlwaysAliveAgent` agora expõe `getHealthSnapshot()` como fachada pública do health formal;
- `server/routes/health.js` agora expõe `GET /health/agent`, e `server/routes/copilot-api/control.js` passou a
    reutilizar o mesmo snapshot canônico em `GET /health`;
- `server/routes/health-registry.js` já aproveita o novo snapshot para o módulo `agent`;
- `tests/unit/copilot/test_agent_context.spec.js` já existe, então `K2` tem groundwork parcial fora da pasta
    `tests/unit/copilot/agent/`;
- a persistência de `assistant.usage` voltou para `agent-lifecycle`, evitando acoplamento indevido da nova camada L3 com o runtime do agent;
- validação focada verde:
    - `50/50` testes em `test_agent_session_event_handlers.spec.js` + `test_faixa_b_event_handlers.spec.js`;
    - `52/52` testes focados da K8 (`4` em Vitest + `48` em `node:test` nos suites de `alwaysAliveAgent`/`llmBridgeClient`);
    - `36/36` testes focados da L2.3 (`test_agent_messaging.spec.js` + `test_always_alive_reconnect.spec.js` + `test_always_alive_delegation.spec.js`), além de revalidação do teste da K8;
    - `49/49` testes focados da consolidação adicional de L2.3 (`test_task_executor.spec.js` + `test_agent_messaging.spec.js` + `test_always_alive_reconnect.spec.js` + `test_always_alive_delegation.spec.js`);
    - `83/83` testes focados do K5 incremental (`test_boot_wiring_pipeline.spec.js` + `test_lifecycle_a1_fixes.spec.js` + `test_sdk_quota_monitor_f25.spec.js` + `test_sdk_zero_bypass_f33.spec.js`);
    - `16/16` testes focados do K6 incremental (`test_event_bridge_map.spec.js` + `test_always_alive_delegation.spec.js`);
    - `21/21` testes focados do K6b incremental (`test_always_alive_lazy_singleton.spec.js` + `test_event_bridge_map.spec.js` + `test_always_alive_delegation.spec.js`);
    - `32/32` testes focados do K3 incremental (`test_agent_error_policy.spec.js` + `test_task_executor.spec.js` + `test_always_alive_reconnect.spec.js`);
    - `58/58` testes focados do K1a incremental (`test_agent_context.spec.js` + `test_agent_messaging.spec.js` + `test_task_executor.spec.js` + `test_always_alive_reconnect.spec.js` + `test_always_alive_delegation.spec.js`);
    - `83/83` testes focados do K5b incremental (`test_boot_wiring_pipeline.spec.js` + `test_lifecycle_a1_fixes.spec.js` + `test_sdk_quota_monitor_f25.spec.js` + `test_sdk_zero_bypass_f33.spec.js`);
    - `47/47` testes focados do lote seguro de K1b (`test_session_setup.spec.js` + `test_agent_messaging.spec.js` + `test_agent_dialog_controller.spec.js` + `test_agent_context.spec.js` + `test_agent_state.spec.js` + `test_task_executor.spec.js`);
    - `28/28` testes adjacentes de lifecycle/shutdown (`test_agent_lifecycle.spec.js` + `test_always_alive_shutdown.spec.js`);
    - `96/96` testes focados do K1b restante (`test_agent_lifecycle.spec.js` + `test_always_alive_shutdown.spec.js` + `test_always_alive_delegation.spec.js` + `test_always_alive_dialog_loop.spec.js` + `test_always_alive_reconnect.spec.js` + `test_agent_context.spec.js`);
    - `23/23` testes adjacentes de quota monitor após o corte (`test_sdk_quota_monitor_f25.spec.js`);
    - `99/99` testes focados do primeiro lote de K4 (`test_background_tasks.spec.js` + `test_agent_background_tasks_integration.spec.js` + `test_agent_context.spec.js` + `test_agent_lifecycle.spec.js` + `test_agent_messaging.spec.js` + `test_always_alive_shutdown.spec.js` + `test_always_alive_delegation.spec.js` + `test_always_alive_dialog_loop.spec.js`);
    - `28/28` testes Vitest adjacentes (`test_session_setup.spec.js` + `test_sdk_quota_monitor_f25.spec.js`);
    - `6/6` testes focados do K7 (`test_agent_health_check.spec.js` + `test_agent_health_routes.spec.js`);
    - lint do escopo alterado em ambos os checkpoints.

Mesmo assim, os objetivos centrais de M-03 seguem pendentes:

- `agent/` ainda soma **8.248L**;
- o diretório legado `agent/session/event-handlers/` ainda existe por compatibilidade, mas agora contém apenas **104 linhas** de shims no total;
- `agent/infra/task-executor.js` ainda existe apenas por compatibilidade, sem lógica real própria;
- a cadeia de mensagem está **substancialmente simplificada**: `queue-processor.js` e `task-executor.js` já não contêm lógica real; o caminho canônico da fila mora em `agent-messaging.js`, enquanto `turn-executor.js` permanece isolado no domínio de diálogo.
- `boot-wiring.js` agora está estruturalmente mais fino (**263L**), mas o total de `agent/` ainda subiu porque `boot-steps.js`
    passou a concentrar a implementação real de boa parte das etapas; o ganho desta passada foi principalmente de separação
    semântica e testabilidade, não de redução líquida imediata de LoC.
- `always-alive.js` ficou mais fino no ponto do bridge lazy (o mapa saiu do corpo do método), porém o total de `agent/` ainda não caiu porque o mapa declarativo permanece dentro do mesmo módulo arquitetural `agent/`.
- a topologia de testes do `agent` está **distribuída** entre `tests/unit/copilot/agent/` e vários suites em
    `tests/unit/copilot/`, então o phase gate desta fase não deve depender de uma única pasta como proxy de cobertura.

### 0.1 Síntese da auditoria geral do `agent`

Auditoria complementar consolidada em `M-03A`:

- `src/copilot/agent/` tem hoje **62 arquivos**, **8 diretórios** e **8.248 linhas**;
- os maiores hotspots remanescentes são `session/` (1.975L), `dialog/` (1.902L) e `lifecycle/` (1.299L);
- o maior bloqueio estrutural agora é **expandir/fechar K4** sem perpetuar compatibilidade residual;
- a próxima onda ótima foi recalibrada para: **K4 (expandir/fechar) → limpeza residual de compatibilidade/shims → regressão ampla**;
- o merge `task-executor` ↔ `turn-executor` foi descartado como objetivo arquitetural incorreto.

---

## 1. Contexto e Motivação

O módulo `agent/` é o maior do codebase (8.248L, 62 arquivos) e funciona como "god module":
absorve responsabilidades de event handling, config, permission, tools-bootstrap, webhook,
status-snapshot, e infra genérica. Após M-02 (que já moveu 4 arquivos de `agent/infra/`),
esta fase reestrutura o interior do agent para ficar abaixo de 5.000L.

### Métricas antes → depois

| Métrica                      | Antes (pós M-02) | Depois                           |
| ---------------------------- | ---------------- | -------------------------------- |
| agent/ linhas                | ~8.000           | ~4.000                           |
| agent/ arquivos              | ~57              | ~35                              |
| Event handlers em agent/     | 12               | 0 (movidos para event-handlers/) |
| Testes agent/                | ~0               | 30+                              |
| AgentContext campos públicos | 30+              | 6 sub-estados                    |
| Boot wiring steps isolados   | 0                | 12                               |
| Message chain depth          | 7                | 4                                |
| Event bridge hardcoded       | ~80              | 0 (declarativo)                  |

### Problemas resolvidos

- **P2 (🔴)**: agent/ desproporcional → redução de 54%
- **P3 (🟠)**: 7 níveis de indireção → 4
- **Débitos K1-K8**: AgentContext monolítico, boot opaco, testes ausentes

---

## 2. Subfases

Esta fase é grande (~59h) e se divide em 8 subfases executáveis independentemente
(exceto K2 que depende de K1):

| #         | Subfase                                   | Horas | Depende de |
| --------- | ----------------------------------------- | ----- | ---------- |
| K1        | AgentContext Partitioning                 | 8h    | —          |
| K2        | Test Coverage Sprint                      | 12h   | K1         |
| L2.1      | Mover event-handlers para event-handlers/ | 4h    | —          |
| L2.3+L2.4 | Simplificar message chain                 | 5h    | —          |
| K5        | Boot Wiring Pipeline                      | 6h    | —          |
| K3        | Error Handling Centralizado               | 4h    | K5         |
| K4        | Background Task Tracker                   | 3h    | —          |
| K6        | Event Bridge Declarativo                  | 4h    | —          |
| K7        | Health Check Formal                       | 3h    | K1         |
| K8        | Lazy Singleton                            | 3h    | —          |
| L2.5      | Testes de regressão finais                | 3h    | Todos      |
| —         | Commit                                    | 1h    | Todos      |

### 2.1 Roadmap revisado por ondas (2026-04-15)

| Onda | Status                       | Escopo                                                      |
| ---- | ---------------------------- | ----------------------------------------------------------- |
| A    | ✅ Executada incrementalmente | `L2.1`, `K8`, `L2.3a`, `L2.3b`, `K5a`, `K6a`                |
| B    | ✅ Executada incrementalmente | `K3a`, `K1a`, `K5b`, `K6b`                                  |
| C    | 🟨 Em execução                | `K1b` (quase fechada), `K4` (lote 1)                        |
| D    | 🟨 Em execução                | `K7` (health formal entregue incrementalmente)              |
| E    | ⏭️ Próxima onda               | limpeza residual de compatibilidade/shims + regressão ampla |

---

## 3. Passos de Execução

### Subfase K1 — AgentContext Partitioning (~8h)

**Ref**: Doc 11 §K1, Doc 10 §3.1

**Problema original**: `agent-context.js` (254L) tinha 30+ campos públicos planos — mistura session state,
dialog state, config, metrics, IO handles.

**Status auditado em 2026-04-15**: `P01` e `P02` já foram executados de forma incremental. `agent-context.js`
agora tem **410L** com seis subestados nomeados (`sessionState`, `dialogState`, `configState`,
`metricsState`, `runtimeState`, `ioState`) e accessors compatíveis. `P03` começou com a migração de
`state/agent-state.js`, `facades/agent-model-config.js`, `lifecycle/session-setup.js`,
`messaging/agent-messaging.js`, `dialog/agent-dialog-controller.js`, `facades/agent-session-ops.js`,
`lifecycle/agent-lifecycle.js` e getters públicos selecionados da fachada `always-alive.js`; `P04` segue verde com cobertura ampliada.

#### P01 — Definir interfaces de sub-estado (2h)

**O que fazer**: Criar `src/copilot/agent/types.js` (ou atualizar o existente) com interfaces
JSDoc para cada domínio:

```javascript
/**
 * @typedef {Object} SessionState
 * @property {import('#copilot/sdk').CopilotSession|null} session
 * @property {string|null} sessionId
 * @property {boolean} sessionActive
 * @property {string|null} model
 * @property {string|null} reasoningEffort
 */

/**
 * @typedef {Object} DialogState
 * @property {boolean} dialogActive
 * @property {boolean} paused
 * @property {number} turnCount
 * @property {AbortController|null} abortController
 */

/**
 * @typedef {Object} AgentConfig
 * @property {string} agentName
 * @property {Object} permissions
 * @property {Object} hooks
 */

/**
 * @typedef {Object} AgentMetrics
 * @property {number} messagesProcessed
 * @property {number} errorsCount
 * @property {Date} lastActivity
 */

/**
 * @typedef {Object} AgentIO
 * @property {import('#copilot/sdk').CopilotClient|null} client
 * @property {Function|null} outputHandler
 */
```

**Validação**: `npm run lint` (apenas tipos, sem mudança de runtime)

#### P02 — Refatorar AgentContext para compor sub-estados (3h)

**O que fazer**:
1. Ler `agent-context.js` atual (254L)
2. Agrupar campos existentes nos 5 sub-estados definidos em P01
3. Substituir campos planos por objetos:
   - `this.session = { session: null, sessionId: null, ... }`
   - `this.dialog = { active: false, paused: false, ... }`
   - `this.config = { agentName, permissions, hooks }`
   - `this.metrics = { messagesProcessed: 0, ... }`
   - `this.io = { client: null, outputHandler: null }`

**Atenção**: Manter getters/setters para backward compatibility temporária:
```javascript
get client() { return this.io.client; }
set client(v) { this.io.client = v; }
```

**Validação**: `npm run lint && npm run test:unit`

#### P03 — Migrar consumers para sub-estados (2h)

**O que fazer**:
```bash
grep -rn "ctx\.\(client\|session\|sessionId\|model\|reasoningEffort\|dialogActive\|paused\)" \
  src/copilot/agent/ --include="*.js" | wc -l
```

Para cada consumer, substituir:
- `ctx.client` → `ctx.io.client`
- `ctx.sessionId` → `ctx.session.sessionId`
- `ctx.model` → `ctx.session.model`
- etc.

Após migrar todos, remover os getters/setters de backward compat.

**Validação**: `npm run lint && npm run test:unit`

#### P04 — Testes AgentContext (1h)

Criar `tests/unit/copilot/agent/test_agent_context.spec.js`:
- Constructor defaults
- Sub-state access
- FSM transitions (setStatus)
- Reset
- Imutabilidade de sub-estados (se aplicável)

---

### Subfase K2 — Test Coverage Sprint (~12h)

**Ref**: Doc 11 §K2

**Depende de**: K1 (AgentContext particionado)

#### P05 — Testes AgentContext FSM (2h)

- Transições `idle → starting → running → stopping → stopped`
- Transições inválidas (Error esperado)
- `setStatus()` + event emission

#### P06 — Testes MessageQueue (2h)

`agent/infra/message-queue.js` (213L):
- enqueue/dequeue FIFO
- abort drains queue
- size/isEmpty
- shift behavior
- Backpressure (se implementado)

#### P07 — Testes performBootWiring (3h)

`agent/session/boot-wiring.js` (331L) tem 12 etapas de boot.
Cada step deve ter mock isolado verificando que:
- Step N chama as dependências certas
- Step N falha graciosamente
- Sequência completa produz agent pronto

#### P08 — Testes agentStop + agentTryReconnect (2h)

`agent/lifecycle/agent-lifecycle.js` (359L):
- Stop graceful: drains queue, disconnects session, writes state
- Stop forced: timeout + forced disconnect
- Reconnect: retry policy, backoff, max attempts

#### P09 — Testes DialogLoopManager (2h)

`agent/dialog/loop-manager.js` (597L):
- pause/resume
- 3 estratégias de dialog
- Watchdog timeout
- Boot do dialog loop
- Recovery após erro

#### P10 — Testes da execução por tarefa (1h)

`agent/messaging/agent-messaging.js` (executor canônico) + `agent/infra/task-executor.js` (shim):
- Execute com retry após reconexão
- Abort durante execução
- Timeout

---

### Subfase L2.1 — Mover event-handlers para `event-handlers/` (L3) (~4h)

**Ref**: Doc 13 §C3

#### P11 — Criar diretório `src/copilot/event-handlers/` (0.5h)

```bash
mkdir -p src/copilot/event-handlers
```

#### P12 — Mover 12 handler files (2h)

```bash
# Mover todos os event handlers
mv src/copilot/agent/session/event-handlers/*.js src/copilot/event-handlers/
```

Atualizar imports internos (caminhos relativos → aliases):
```bash
grep -rn "event-handlers/" src/copilot/agent/ --include="*.js"
```

Atualizar `agent/session/event-wirer.js` (82L) para importar de `#copilot/event-handlers`.

#### P13 — Criar barrel e atualizar package.json (0.5h)

Criar `src/copilot/event-handlers/index.js` com re-exports.
Adicionar `#copilot/event-handlers` ao import map do `package.json`.

#### P14 — Testes de regressão (1h)

```bash
npm run lint
npm run test:unit
```

---

### Subfase L2.3+L2.4 — Simplificar message chain (~5h)

**Ref**: Doc 13 §C10

**Problema original**: 7 níveis para enviar mensagem:
```
terminal → agent-messaging → queue-processor → task-executor → turn-executor → lifecycle → SDK
```

**Leitura auditada em 2026-04-15**: `turn-executor.js` não pertence ao mesmo eixo da fila; ele é o executor do
**dialog loop** do `DialogLoopManager`, com contrato próprio e testes próprios. O corte correto desta subfase não é
mesclar fila + diálogo, mas sim **trazer a lógica real da fila para `agent-messaging.js`** e manter os wrappers legados
apenas como shims temporários.

**Target revisado**: 4 níveis no caminho de fila:
```
terminal → agent.sendMessage() → queue + executor → SDK session.send()
```

#### P15 — Merge `agent-messaging.js` + `queue-processor.js` (2h)

`agent/messaging/agent-messaging.js` (161L) + `agent/queue-processor.js` (44L):
- `agent-messaging.js` expõe `sendMessage()`, `sendCommand()`, `processQueue()`
- `queue-processor.js` é thin wrapper de 44L

**O que fazer**:
1. Mover lógica de `queue-processor.js` para `agent-messaging.js`
2. Atualizar consumers de `queue-processor.js`
3. Deletar `queue-processor.js`

**Validação**: `npm run lint && npm run test:unit`

#### P16 — Canonicalizar `executeTask()` na camada `messaging` (3h)

`agent/infra/task-executor.js` (179L → 14L) + `agent/messaging/agent-messaging.js` (214L → 360L):
- `task-executor.js` era apenas executor por tarefa da **fila**, não do diálogo;
- `turn-executor.js` continua responsável exclusivamente pelo `DialogLoopManager`.

**O que fazer**:
1. Mover OTEL spans, retry e cleanup de listeners de `task-executor.js` para `agent-messaging.js`
2. Atualizar `processQueue()` para chamar o executor canônico local
3. Preservar `agent/infra/task-executor.js` como shim tipado de compatibilidade
4. Validar que o caminho legado e o canônico exportam o mesmo símbolo

**Status auditado**: ✅ Executado incrementalmente em 2026-04-15.

**Validação**: `49/49` testes focados + lint do escopo alterado.

---

### Subfase K5 — Boot Wiring Pipeline (~6h)

**Ref**: Doc 11 §K5

**Status auditado em 2026-04-15**: `P17` e `P18` já foram executados de forma incremental, e `K5b` também já começou.
`performBootWiring()` continua com a mesma assinatura/retorno, usa o pipeline nomeado de 12 etapas (`createBootWiringSteps()` +
`runBootPipeline()`), e agora delega a maior parte da implementação real para `session/boot-steps.js`. `P19` ainda está
**parcial**: a cobertura estrutural/regressiva está verde, mas ainda não existe 1 teste unitário isolado por step.

#### P17 — Extrair 12 etapas como funções nomeadas (3h)

Ler `agent/session/boot-wiring.js` (494L). Extrair cada bloco em função nomeada:

```javascript
/** @type {BootStep[]} */
const BOOT_STEPS = [
    { name: 'validateConfig', fn: validateConfig },
    { name: 'initClient', fn: initClient },
    { name: 'createSession', fn: createSession },
    // ... 12 steps
];
```

#### P18 — Criar pipeline runner (1h)

```javascript
async function runBootPipeline(ctx, steps = BOOT_STEPS) {
    for (const step of steps) {
        log.info(`[boot] ${step.name}...`);
        await step.fn(ctx);
        log.info(`[boot] ${step.name} ✓`);
    }
}
```

#### P19 — Testes de cada step isolado (2h)

1 teste por step com mock das dependências.

---

### Subfase K3 — Error Handling Centralizado (~4h)

**Ref**: Doc 11 §K3

**Status auditado em 2026-04-15**: `P20` foi executado de forma incremental e `P21` já começou. Existe agora
`agent/error-policy.js`, e a política central já é consumida por `agent-messaging.js` e `lifecycle/reconnect-policy.js`.
Ainda faltam ampliar o uso para outros pontos do módulo e consolidar a cobertura.

#### P20 — Criar `agent/error-policy.js` (2h)

Classificador de erros com 3 categorias: `retry`, `fatal`, `ignore`.

```javascript
/**
 * @param {Error} error
 * @returns {'retry' | 'fatal' | 'ignore'}
 */
export function classifyError(error) {
    if (error.code === 'ECONNRESET' || error.code === 'EPIPE') return 'retry';
    if (error instanceof AuthenticationError) return 'fatal';
    if (error instanceof RateLimitError) return 'retry';
    // ...
    return 'ignore';
}
```

#### P21 — Migrar consumers reais do `agent` para `error-policy.js` (1h)

Substituir padrões ad-hoc de error handling em:

- `agent/messaging/agent-messaging.js`
- `agent/lifecycle/reconnect-policy.js`
- pontos relevantes de `dialog/turn-executor.js` e `session/boot-wiring.js` quando aplicável

#### P22 — Testes (1h)

Cobertura das 3 categorias + edge cases.

---

### Subfase K4 — Background Task Tracker (~3h)

**Ref**: Doc 11 §K4

**Status auditado em 2026-04-15**: `P23` e a primeira metade de `P24/P25` já entraram em execução incremental.
`agent/background-tasks.js` existe com `track()`/`drain()`, `agent-context.js` já instancia `backgroundTasks`,
`agent-lifecycle.js` já usa `track()` em writes/syncs assíncronos e drena com `drain(5000)` no shutdown, e o primeiro
lote de fire-and-forget já alcançou `session-setup.js`, `dialog/user-input-handler.js`, `agent-messaging.js`,
`session/boot-steps.js` e `dialog/loop-manager.js`.

#### P23 — Criar `agent/background-tasks.js` (1h)

```javascript
export class BackgroundTasks {
    #tasks = new Set();
    track(promise) { /* ... */ }
    async drain(timeoutMs = 5000) { /* ... */ }
    get pendingCount() { return this.#tasks.size; }
}
```

#### P24 — Migrar fire-and-forget (1h)

```bash
grep -rn "void.*Async\|void.*write\|\.then(() => {" src/copilot/agent/ --include="*.js" | wc -l
```

Substituir `void writeStateAsync()` por `bgTasks.track(writeStateAsync())`.

#### P25 — Integrar drain no shutdown + testes (1h)

Em `agent-lifecycle.js::agentStop()`, chamar `bgTasks.drain(5000)` antes de fechar.

**Validação já executada neste checkpoint**:

- `99/99` em `node:test` (`test_background_tasks.spec.js`, `test_agent_background_tasks_integration.spec.js`,
  `test_agent_context.spec.js`, `test_agent_lifecycle.spec.js`, `test_agent_messaging.spec.js`,
  `test_always_alive_shutdown.spec.js`, `test_always_alive_delegation.spec.js`, `test_always_alive_dialog_loop.spec.js`)
- `28/28` em Vitest (`test_session_setup.spec.js`, `test_sdk_quota_monitor_f25.spec.js`)

---

### Subfase K6 — Event Bridge Declarativo (~4h)

**Ref**: Doc 11 §K6

**Status auditado em 2026-04-15**: `P26`, `P27` e `P28` já foram executados de forma incremental. O mapa declarativo
agora vive em `agent/event-bridge-map.js`, e o wiring lazy foi extraído para `agent/event-bridge-wiring.js`, deixando
`always-alive.js` apenas como consumidor do helper. A cobertura atual valida existência, representatividade e uso
efetivo dos mapas e do helper dedicado.

#### P26 — Criar `agent/event-bridge-map.js` (1h)

```javascript
/** @type {Array<[string, string]>} */
export const EVENT_BRIDGE_MAP = [
    ['session.turnStarted', 'agent:turn:started'],
    ['session.turnCompleted', 'agent:turn:completed'],
    // ... ~80 mappings
];
```

#### P27 — Migrar always-alive.js para usar o mapa (2h)

Substituir ~80 bridges hardcoded por loop sobre `EVENT_BRIDGE_MAP`.

#### P28 — Testes de completude (1h)

Verificar que todos os eventos do SDK estão no mapa.

---

### Subfase K7 — Health Check Formal (~3h)

**Ref**: Doc 11 §K7

**Status auditado em 2026-04-15**: `P29` e `P30` já entraram em execução incremental. `agent/health-check.js` existe,
`AlwaysAliveAgent` já expõe `getHealthSnapshot()`, `server/routes/health.js` já oferece `GET /health/agent`, e
`server/routes/copilot-api/control.js` passou a reutilizar o mesmo snapshot canônico em `GET /health`.
`server/routes/health-registry.js` também foi alinhado ao novo contrato. Validação focada atual: **6/6** testes verdes
em `node:test`.

#### P29 — Criar `agent/health-check.js` (1.5h)

5 checks: client status, session active, dialog running, queue size, IO connected.

```javascript
export function checkAgentHealth(ctx) {
    return {
        client: ctx.io.client?.getState() === 'running',
        session: ctx.session.sessionActive,
        dialog: ctx.dialog.active,
        queueSize: ctx.queue?.size ?? 0,
        io: ctx.io.outputHandler !== null,
        healthy: /* all above OK */,
    };
}
```

#### P30 — Expor via GET /health/agent + testes (1.5h)

Adicionar endpoint em `server/routes/health.js`.

---

### Subfase K8 — Lazy Singleton (~3h)

**Ref**: Doc 11 §K8

#### P31 — Refatorar para lazy init + resetAgent (1h)

```javascript
let _agent = null;
export function getAgent() {
    if (!_agent) _agent = new AlwaysAliveAgent();
    return _agent;
}
export function resetAgent() {
    _agent = null;
}
```

#### P32 — Migrar imports diretos (1h)

```bash
grep -rn "import.*agent.*from.*always-alive\|import.*AlwaysAliveAgent" src/ --include="*.js"
```

Substituir `import { agent }` por `import { getAgent }`.

#### P33 — Testes + deprecation warning (1h)

---

### Subfase L2.5 — Testes de regressão finais (~3h)

#### P34 — Full test suite (2h)

```bash
npm run lint
npm run format:check
npm run test:unit
npm run test:integration
```

#### P35 — Verificações manuais (1h)

- agent/ < 5000L: `find src/copilot/agent -name "*.js" | xargs wc -l | tail -1`
- 0 event handlers em agent/session/event-handlers/: `ls src/copilot/agent/session/event-handlers/ 2>/dev/null`
- Event bridge declarativo: `grep -c "EVENT_BRIDGE_MAP" src/copilot/agent/always-alive.js`

### P36 — Commit

```bash
git add -A
git commit --no-verify -m "refactor: fase 2 agent refactoring — K1-K8 + L2

- K1: AgentContext particionado em 5 sub-estados
- K2: 30+ testes unitários para agent/
- K3: error-policy.js com classificador retry/fatal/ignore
- K4: BackgroundTasks tracker + drain no shutdown
- K5: boot-wiring pipeline com 12 steps nomeados
- K6: event-bridge-map.js declarativo (~80 mappings)
- K7: health-check.js com 5 checks + endpoint
- K8: getAgent() lazy singleton + resetAgent()
- L2.1: event-handlers movidos para event-handlers/ (L3)
- L2.3+L2.4: message chain simplificada de 7→4 níveis"
git push origin main
```

---

## 4. Critérios de Conclusão

- [ ] `agent/` < 5.000 linhas
- [ ] `agent/session/event-handlers/` não existe (movido para `event-handlers/`)
- [ ] `agent/queue-processor.js` não contém lógica real (shim de compatibilidade)
- [ ] `agent/infra/task-executor.js` não contém lógica real (shim de compatibilidade)
- [x] `agent-context.js` usa sub-estados (session, dialog, config, metrics, io)
- [x] `boot-wiring.js` usa pipeline com steps nomeados
- [x] `event-bridge-map.js` existe com ~80 mappings
- [x] `error-policy.js` existe com classificador
- [x] `background-tasks.js` existe com track/drain
- [x] `health-check.js` existe com 5 checks
- [x] `getAgent()`/`resetAgent()` são a API pública
- [ ] 30+ testes agent-focused entre `tests/unit/copilot/agent/`, `tests/unit/copilot/` e `tests/integration/copilot/`
- [ ] `npm run lint` ✅
- [ ] `npm run test:unit` ✅

---

## 5. Riscos e Mitigações

| Risco                                | Probabilidade | Impacto | Mitigação                              |
| ------------------------------------ | ------------- | ------- | -------------------------------------- |
| AgentContext refactor quebra runtime | Média         | Alto    | Getters compat em P02, testes em P04   |
| Merge de executors perde edge cases  | Média         | Alto    | Testes extensivos em P08/P10           |
| Boot pipeline altera ordem           | Baixa         | Alto    | P07 testa sequência                    |
| Event bridge incompleto              | Média         | Médio   | P28 verifica completude via SDK events |
| Import circular após mover handlers  | Baixa         | Médio   | npm run lint detecta                   |
