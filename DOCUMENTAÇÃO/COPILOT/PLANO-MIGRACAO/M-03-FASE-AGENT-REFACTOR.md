# M-03 — Fase 2: Agent Refactoring Completo

**Data**: 2026-03-21
**Versão**: 1.0
**Pré-requisito**: M-02 (Cleanup) concluído
**Estimativa**: ~59h
**Risco**: Moderado
**Consolida**: Faixa K (K1-K8, 43h) + Faixa L2 (Agent Slimming, 16h)

---

## 1. Contexto e Motivação

O módulo `agent/` é o maior do codebase (8.620L, 61 arquivos) e funciona como "god module":
absorve responsabilidades de event handling, config, permission, tools-bootstrap, webhook,
status-snapshot, e infra genérica. Após M-02 (que já moveu 4 arquivos de `agent/infra/`),
esta fase reestrutura o interior do agent para ficar abaixo de 5.000L.

### Métricas antes → depois

| Métrica | Antes (pós M-02) | Depois |
|---------|-------------------|--------|
| agent/ linhas | ~8.000 | ~4.000 |
| agent/ arquivos | ~57 | ~35 |
| Event handlers em agent/ | 12 | 0 (movidos para event-handlers/) |
| Testes agent/ | ~0 | 30+ |
| AgentContext campos públicos | 30+ | 6 sub-estados |
| Boot wiring steps isolados | 0 | 12 |
| Message chain depth | 7 | 4 |
| Event bridge hardcoded | ~80 | 0 (declarativo) |

### Problemas resolvidos

- **P2 (🔴)**: agent/ desproporcional → redução de 54%
- **P3 (🟠)**: 7 níveis de indireção → 4
- **Débitos K1-K8**: AgentContext monolítico, boot opaco, testes ausentes

---

## 2. Subfases

Esta fase é grande (~59h) e se divide em 8 subfases executáveis independentemente
(exceto K2 que depende de K1):

| # | Subfase | Horas | Depende de |
|---|---------|-------|------------|
| K1 | AgentContext Partitioning | 8h | — |
| K2 | Test Coverage Sprint | 12h | K1 |
| L2.1 | Mover event-handlers para event-handlers/ | 4h | — |
| L2.3+L2.4 | Simplificar message chain | 5h | — |
| K5 | Boot Wiring Pipeline | 6h | — |
| K3 | Error Handling Centralizado | 4h | K5 |
| K4 | Background Task Tracker | 3h | — |
| K6 | Event Bridge Declarativo | 4h | — |
| K7 | Health Check Formal | 3h | K1 |
| K8 | Lazy Singleton | 3h | — |
| L2.5 | Testes de regressão finais | 3h | Todos |
| — | Commit | 1h | Todos |

---

## 3. Passos de Execução

### Subfase K1 — AgentContext Partitioning (~8h)

**Ref**: Doc 11 §K1, Doc 10 §3.1

**Problema**: `agent-context.js` (254L) tem 30+ campos públicos planos — mistura session state,
dialog state, config, metrics, IO handles.

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

#### P10 — Testes TaskExecutor (1h)

`agent/infra/task-executor.js` (179L):
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

**Problema**: 7 níveis para enviar mensagem:
```
terminal → agent-messaging → queue-processor → task-executor → turn-executor → lifecycle → SDK
```

**Target**: 4 níveis:
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

#### P16 — Merge `task-executor.js` + `turn-executor.js` (3h)

`agent/infra/task-executor.js` (179L) + `agent/dialog/turn-executor.js` (391L):
- `task-executor.js` wrappeia OTEL spans e retry
- `turn-executor.js` executa o turno real

**O que fazer**:
1. Mover OTEL span wrapping de `task-executor` para `turn-executor` como decorator
2. Mover retry logic para `turn-executor`
3. Atualizar consumers
4. Deletar `task-executor.js`

**Validação**: `npm run lint && npm run test:unit`

---

### Subfase K5 — Boot Wiring Pipeline (~6h)

**Ref**: Doc 11 §K5

#### P17 — Extrair 12 etapas como funções nomeadas (3h)

Ler `agent/session/boot-wiring.js` (331L). Extrair cada bloco em função nomeada:

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

#### P21 — Migrar task-executor e queue-processor (1h)

Substituir 5+ padrões ad-hoc de error handling pelo classificador.

#### P22 — Testes (1h)

Cobertura das 3 categorias + edge cases.

---

### Subfase K4 — Background Task Tracker (~3h)

**Ref**: Doc 11 §K4

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

---

### Subfase K6 — Event Bridge Declarativo (~4h)

**Ref**: Doc 11 §K6

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
- [ ] `agent/queue-processor.js` não existe (merged)
- [ ] `agent/infra/task-executor.js` não existe (merged em turn-executor)
- [ ] `agent-context.js` usa sub-estados (session, dialog, config, metrics, io)
- [ ] `boot-wiring.js` usa pipeline com steps nomeados
- [ ] `event-bridge-map.js` existe com ~80 mappings
- [ ] `error-policy.js` existe com classificador
- [ ] `background-tasks.js` existe com track/drain
- [ ] `health-check.js` existe com 5 checks
- [ ] `getAgent()`/`resetAgent()` são a API pública
- [ ] 30+ testes em `tests/unit/copilot/agent/`
- [ ] `npm run lint` ✅
- [ ] `npm run test:unit` ✅

---

## 5. Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| AgentContext refactor quebra runtime | Média | Alto | Getters compat em P02, testes em P04 |
| Merge de executors perde edge cases | Média | Alto | Testes extensivos em P08/P10 |
| Boot pipeline altera ordem | Baixa | Alto | P07 testa sequência |
| Event bridge incompleto | Média | Médio | P28 verifica completude via SDK events |
| Import circular após mover handlers | Baixa | Médio | npm run lint detecta |
