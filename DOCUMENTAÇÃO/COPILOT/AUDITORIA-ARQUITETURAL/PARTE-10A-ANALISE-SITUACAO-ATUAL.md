# PARTE-10A — Análise da Situação Atual: `src/copilot/agent/`

**Data**: 2026-03-15 **Contexto**: Investigação profunda pré-refatoração **Escopo**: 26 arquivos,
6727 linhas

---

## 1. Inventário Completo dos Arquivos

| #   | Arquivo                    | Linhas | Tipo           | Responsabilidade                                                                                                                               |
| --- | -------------------------- | ------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `agent-contract.js`        | 71     | Tipagem pura   | Typedef `IAlwaysAliveAgent` — contrato público. Nenhum código executável.                                                                      |
| 2   | `always-alive.js`          | 1605   | **God Object** | Classe `AlwaysAliveAgent` + singleton `alwaysAliveAgent` + factory `getAgent()`. Orquestra TUDO.                                               |
| 3   | `dialog-loop-manager.js`   | 613    | Subsistema     | `DialogLoopManager` — boot, resume, sendTurn, stop, pause. Mutex, watchdog, backpressure.                                                      |
| 4   | `dialog-loop-wirer.js`     | 64     | Glue           | Forwarding de 13 eventos DLM → agente. Utilitário trivial.                                                                                     |
| 5   | `dialog-protocol.js`       | 115    | Protocolo      | `DialogProtocol` — classify READY/REPLY/STOPPED, extractReply, buildBootPrompt.                                                                |
| 6   | `dialog-turn-executor.js`  | 358    | Execução       | Funções puras de resolução de turno: emitTurnStart, buildTurnResolutionListeners, dispatchTurnToHost, waitForRestartAndReply, executeTurnImpl. |
| 7   | `dialog-watchdog.js`       | 189    | Monitor        | `DialogWatchdog` — timer de inatividade com ping/setThreshold/setTaskType.                                                                     |
| 8   | `entry.js`                 | 163    | Bootstrap      | PM2 entry point: `startWithRetry()`, signal handlers, IPC, model validation.                                                                   |
| 9   | `events.js`                | 171    | Constantes     | `AGENT_EVENTS` array (~40), `PR_CONSUMING_EVENTS`, `DIALOG_LOOP_EVENTS`, `HIGH_FREQUENCY_EVENTS`.                                              |
| 10  | `handoff-manager.js`       | 157    | Feature        | F45: `HandoffManager` — receive/accept/reject sessões entre agentes.                                                                           |
| 11  | `index.js`                 | 40     | Barrel         | Re-exporta TUDO de todos os módulos. Flat, sem organização.                                                                                    |
| 12  | `message-queue.js`         | 212    | FIFO Queue     | `MessageQueue` — enqueue/shift/unshift/drain com AbortSignal e MAX_QUEUE_SIZE.                                                                 |
| 13  | `permission-controller.js` | 154    | Controlador    | `PermissionController` — approve_all/audit_only/selective em runtime.                                                                          |
| 14  | `reconnect-policy.js`      | 133    | Política       | `tryReconnect()` — exponential backoff + jitter + ping health check.                                                                           |
| 15  | `session-cleanup.js`       | 96     | Manutenção     | `cleanupStaleSessions()` — lista e deleta sessões com idade > maxAgeMs.                                                                        |
| 16  | `session-event-wirer.js`   | 587    | Glue/Wiring    | `wireSessionEvents()` — 80+ eventos SDK mapeados para AGENT EventEmitter. Maior glue file.                                                     |
| 17  | `session-initializer.js`   | 378    | Inicialização  | `initOrResumeSession()` — resume/create session, config, hook system context.                                                                  |
| 18  | `session-keepalive.js`     | 155    | Monitor        | `SessionKeepalive` — ping-first heartbeat quando idle (previne timeout 30min).                                                                 |
| 19  | `session-rotation.js`      | 81     | Política       | `shouldRotateSession()` — quando criar nova sessão (utilization/age/compactions/turns).                                                        |
| 20  | `session-snapshot.js`      | 215    | Persistência   | `createSnapshot/saveSnapshot/loadSnapshot/listSnapshots/pruneSnapshots`.                                                                       |
| 21  | `state-io.js`              | 239    | Persistência   | `readState/writeState/writeStateAsync/clearState/drainStateWrites` — cache + mutex.                                                            |
| 22  | `status-snapshot.js`       | 101    | View           | `buildStatusSnapshot()` — função pura, constrói snapshot de status do agente.                                                                  |
| 23  | `task-executor.js`         | 190    | Execução       | `executeTask()` — executa 1 tarefa da fila (send/await/retry/reconexão).                                                                       |
| 24  | `tool-audit-logger.js`     | 190    | Auditoria      | `logToolAudit/isHighRiskTool/buildAuditingPermissionHandler` — JSONL + wrapper.                                                                |
| 25  | `tools-bootstrap.js`       | 131    | Bootstrap      | `bootstrapTools()` — registra 15+ categorias de tools, instrumentação, colisão check.                                                          |
| 26  | `webhook-manager.js`       | 319    | Feature        | `WebhookManager` — register/unregister/emit webhooks HTTP(S) com SSRF protection.                                                              |

---

## 2. Mapa de Dependências

### 2.1 God Object: `always-alive.js` (1605 linhas, 35 imports)

Este é o **hub central** que importa quase tudo:

**Imports internos (agent/):**

- dialog-loop-manager, dialog-loop-wirer, dialog-protocol, dialog-watchdog
- events, handoff-manager, message-queue, permission-controller
- reconnect-policy, session-cleanup, session-event-wirer, session-initializer
- session-keepalive, session-rotation, session-snapshot, state-io
- status-snapshot, task-executor, tool-audit-logger, tools-bootstrap

**Imports externos (fora de agent/):**

- `#copilot/core/constants`, `#copilot/core/errors`
- `#copilot/config/*` (session-config, system-prompt, tools/state)
- `#copilot/hooks/*` (bus, factory, permission, session-lifecycle)
- `#copilot/lib/*` (event-helpers, index, session)
- `#copilot/observability/*` (logger, metrics, otel)
- `@github/copilot-sdk`
- - libs externas (bridges, conversation-hub, terminal/state, tools)

**Dependentes externos** (17 arquivos fora de agent/ importam `alwaysAliveAgent`):

- routes/ (4), terminal/ (8), bridges/ (1), api/ (1)

### 2.2 Clusters de Dependência Interna

```
┌─────────────────────────────────────────────────────┐
│                always-alive.js                       │
│  (God Object — importa 20+ módulos internos)         │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌── Dialog ──────────────────────┐                  │
│  │ dialog-loop-manager.js  (613)  │                  │
│  │ dialog-turn-executor.js (358)  │──→ state-io.js   │
│  │ dialog-protocol.js      (115)  │                  │
│  │ dialog-watchdog.js      (189)  │                  │
│  │ dialog-loop-wirer.js    (64)   │                  │
│  └────────────────────────────────┘                  │
│                                                      │
│  ┌── Session ─────────────────────┐                  │
│  │ session-initializer.js  (378)  │──→ state-io.js   │
│  │ session-event-wirer.js  (587)  │──→ state-io.js   │
│  │ session-keepalive.js    (155)  │                  │
│  │ session-cleanup.js      (96)   │                  │
│  │ session-rotation.js     (81)   │                  │
│  │ session-snapshot.js     (215)  │──→ state-io.js   │
│  └────────────────────────────────┘                  │
│                                                      │
│  ┌── Queue/Task ──────────────────┐                  │
│  │ message-queue.js        (212)  │                  │
│  │ task-executor.js        (190)  │                  │
│  └────────────────────────────────┘                  │
│                                                      │
│  ┌── Infra/Transversal ──────────┐                  │
│  │ state-io.js             (239)  │                  │
│  │ events.js               (171)  │                  │
│  │ status-snapshot.js      (101)  │                  │
│  │ reconnect-policy.js     (133)  │                  │
│  └────────────────────────────────┘                  │
│                                                      │
│  ┌── Features Isoladas ──────────┐                  │
│  │ permission-controller.js(154) │                  │
│  │ tool-audit-logger.js    (190)  │                  │
│  │ tools-bootstrap.js      (131)  │                  │
│  │ webhook-manager.js      (319)  │                  │
│  │ handoff-manager.js      (157)  │                  │
│  └────────────────────────────────┘                  │
│                                                      │
│  ┌── Contratos/Barrel ───────────┐                  │
│  │ agent-contract.js       (71)   │                  │
│  │ index.js                (40)   │                  │
│  │ entry.js                (163)  │                  │
│  └────────────────────────────────┘                  │
└─────────────────────────────────────────────────────┘
```

---

## 3. Problemas Identificados

### P1. God Object `always-alive.js` (CRÍTICO)

- **1605 linhas** com 35 imports é insustentável
- Acumula responsabilidades heterogêneas: lifecycle, session management, dialog loop orchestration,
  queue processing, status, events, keepalive orchestration, snapshot orchestration, handoff
  orchestration, webhook orchestration
- Cada novo feature (F42-F56) **adicionou** mais código a este arquivo em vez de modularizar
- Dificulta testes unitários do agente "puro" sem mockar dezenas de dependências
- **Risco**: qualquer mudança neste arquivo pode quebrar funcionalidades não relacionadas

### P2. Barrel Export Flat `index.js` (ALTO)

- Re-exporta 30+ símbolos de 20+ módulos sem estrutura
- Consumidores importam tudo de `'../agent/index.js'` sem saber de qual submódulo vem
- Não há agrupamento lógico (dialog, session, tools, etc.)
- **Efeito**: dificulta tree-shaking e aumenta circular dependency risks

### P3. Cluster Dialog Fragmentado Demais (MÉDIO)

- 5 arquivos para o subsistema dialog: manager, turn-executor, protocol, watchdog, wirer
- `dialog-turn-executor.js` (358 linhas) é complexo e tem lógica de retry/restart que poderia ser
  simplificada
- `dialog-loop-wirer.js` (64 linhas) é trivial — poderia ser um método de `dialog-loop-manager.js`
- `dialog-protocol.js` (115 linhas) é bem isolado e correto
- `dialog-watchdog.js` (189 linhas) é bem isolado e correto
- **Problema principal**: manager+executor+wirer são acoplados e difíceis de entender separadamente

### P4. Cluster Session Disperso (MÉDIO-ALTO)

- 6 arquivos session-\*: initializer, event-wirer, keepalive, cleanup, rotation, snapshot
- Cada um é razoavelmente isolado, mas estão todos flat no mesmo nível do god object
- `session-event-wirer.js` (587 linhas) é o 2º maior arquivo — bastante complexo
- `session-initializer.js` (378 linhas) mistura config, validation, hook context
- Sem subdiretório agrupador — difícil entender que pertencem ao mesmo subsistema

### P5. Tipagem Circular via JSDoc (MÉDIO)

- `status-snapshot.js` importa tipos de `always-alive.js` via `import('./always-alive.js')` JSDoc
- Cria dependência circular conceitual (o snapshot depende do god object para tipagem)
- `dialog-loop-manager.js` também referencia tipos de `always-alive.js` nos JSDoc
- **Solução natural**: extrair typedefs compartilhados para um módulo de tipos

### P6. `state-io.js` — Single Point of Coupling (MÉDIO)

- 5 arquivos importam `state-io.js` diretamente: dialog-turn-executor, session-event-wirer,
  session-initializer, session-snapshot, always-alive
- O estado é um blob JSON monolítico com 20+ campos
- Não há separação entre estado de sessão, estado de dialog, estado de billing, etc.
- **Risco**: race conditions entre writes concorrentes (mitigado por mutex mas frágil)

### P7. Falta de Subdiretórios (ESTÉTICO + NAVEGAÇÃO)

- 26 arquivos flat é difícil de navegar
- Clusters naturais (dialog, session, queue, tools) não têm fronteira visual
- IDEs modernas fazem collapse de diretórios mas não de "grupos de arquivos no mesmo nível"

### P8. `entry.js` + `agent-contract.js` — Nomes Confusos (MENOR)

- `entry.js` parece genérico — é especificamente para PM2
- `agent-contract.js` é puro typedef — poderia ser `types.js` ou estar em um diretório de tipos
- `status-snapshot.js` vs `session-snapshot.js` — nomes similares para coisas bem diferentes

### P9. Acoplamento `session-event-wirer.js` ↔ SDK (ALTO)

- 587 linhas de mapeamento evento-a-evento do SDK → agente
- 80+ eventos hardcoded em `KNOWN_SDK_EVENTS` Set
- Altamente sensível a mudanças no SDK — não há schema validation
- Deveria ter uma camada de abstração/adapter mais clara

### P10. `tool-audit-logger.js` Mistura Concerns (MENOR)

- Combina: classificação de risco (isHighRiskTool), logging JSONL (logToolAudit), e wrapper de
  permission handler (buildAuditingPermissionHandler)
- 3 responsabilidades distintas em 190 linhas — poderiam ser separadas ou consolidadas com
  `permission-controller.js`

---

## 4. Métricas de Complexidade

| Métrica                 | Valor                        | Observação                                                    |
| ----------------------- | ---------------------------- | ------------------------------------------------------------- |
| Total de arquivos       | 26                           | Flat, sem subdiretórios                                       |
| Total de linhas         | 6727                         |                                                               |
| Maior arquivo           | always-alive.js (1605)       | God Object                                                    |
| 2º maior                | session-event-wirer.js (587) | SDK event mapping                                             |
| 3º maior                | dialog-loop-manager.js (613) | Dialog subsystem                                              |
| Arquivos < 100 linhas   | 5                            | contract(71), rotation(81), cleanup(96), wirer(64), index(40) |
| Imports no god object   | 35                           | Número crítico                                                |
| Dependentes externos    | 17                           | 17 arquivos importam `alwaysAliveAgent` singleton             |
| Imports via alias (#)   | 16                           | Dependências externas                                         |
| Imports relativos (../) | 12                           | Dependências up-tree                                          |

---

## 5. Fluxos Críticos Documentados

### F1. Boot do Agente

```
entry.js → startWithRetry()
  → always-alive.start()
    → createClient() → CopilotClient
    → initOrResumeSession() [session-initializer]
    → wireSessionEvents() [session-event-wirer]
    → bootstrapTools() [tools-bootstrap]
    → session-cleanup [session-cleanup]
    → keepalive.start() [session-keepalive]
    → auto-resume dialog loop? [F42.1/F53]
      → dialogLoopManager.start() / resume()
```

### F2. Dialog Loop Cycle (0 PR após boot)

```
DLM.start() → session.send(bootPrompt) [1 PR]
  → onUserInputRequest (ask_user) → classify:
    READY → emit 'ready' → waitForEvent('question.pending')
    REPLY → emit 'reply' → extract content
    STOPPED → emit 'stopped' → auto-restart
    question → emit 'question.pending' → wait for answer
  → user answers → continue loop
```

### F3. Task Queue Processing

```
sendMessage() → MessageQueue.enqueue(task)
  → onEnqueue → processQueue()
    → queue.shift() → executeTask(session, task, callbacks) [task-executor]
      → session.sendAndWait(prompt) → response → task.resolve()
      → error → tryReconnect() → requeue or reject
```

### F4. Reconnection

```
error → tryReconnect() [reconnect-policy]
  → client.stop() → createClient() → initSession()
  → client.ping() health check
  → dialogLoop.notifyReconnect() if active
  → emit 'ready'
```

---

## 6. Resumo de Problemas por Severidade

| Severidade | ID  | Descrição                                                     |
| ---------- | --- | ------------------------------------------------------------- |
| CRÍTICO    | P1  | God Object always-alive.js (1605 linhas, 35 imports)          |
| ALTO       | P2  | Barrel export flat sem estrutura                              |
| ALTO       | P9  | session-event-wirer acoplado demais ao SDK                    |
| MÉDIO-ALTO | P4  | Cluster session disperso sem agrupamento                      |
| MÉDIO      | P3  | Dialog cluster fragmentado (wirer trivial, executor complexo) |
| MÉDIO      | P5  | Tipagem circular via JSDoc imports                            |
| MÉDIO      | P6  | state-io como blob monolítico                                 |
| MÉDIO      | P7  | Falta de subdiretórios                                        |
| MENOR      | P8  | Nomes confusos (entry, contract)                              |
| MENOR      | P10 | tool-audit-logger mistura concerns                            |
