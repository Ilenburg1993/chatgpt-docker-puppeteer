# PARTE 14B — Análise Arquitetural Profunda de `src/copilot/agent/`

**Data**: 2026-03-15
**Baseline**: commit `54c135c4` (pós-F44)
**Referência**: PARTE-14A (Inventário Completo)

---

## 1. Padrão Arquitetural Identificado: Facade + Context + Functional Modules

### 1.1 Padrão Central

O agente segue um padrão **Facade Delegadora** com **Context Object** compartilhado:

```
┌──────────────────────────────────┐
│       AlwaysAliveAgent           │  ← Facade (EventEmitter)
│    (always-alive.js — 621L)      │
│                                  │
│  Expõe API pública:              │
│  • sendMessage()                 │
│  • start() / stop()             │
│  • dialogStart/Stop/Resume()    │
│  • getStatus() / diagnostics()  │
│  • registerWebhook() etc.       │
│                                  │
│  Delega 100% da lógica para     │
│  módulos funcionais via ctx      │
└─────────────┬────────────────────┘
              │
              ▼
┌──────────────────────────────────┐
│       AgentContext               │  ← Context Object (mutable)
│    (agent-context.js — 210L)     │
│                                  │
│  32+ campos compartilhados:      │
│  • client, session, status       │
│  • dialogLoop, messageQueue      │
│  • webhooks, permissions         │
│  • keepalive, handoff            │
│  • model, reasoningEffort        │
│  • contextState, sendCount       │
│  • etc.                          │
└─────────────┬────────────────────┘
              │ (passado como 1º argumento)
              ▼
┌──────────────────────────────────────────────────┐
│  Módulos Funcionais (stateless/low-state)         │
│                                                  │
│  dialog/     → Controle de dialog loop           │
│  lifecycle/  → Start, stop, reconnect            │
│  session/    → Sessão SDK: init, wiring, cleanup │
│  infra/      → Queue, tasks, webhooks, tools     │
│  messaging/  → Send, steer, answer               │
│  state/      → Snapshot, diagnostics             │
└──────────────────────────────────────────────────┘
```

### 1.2 Avaliação do Padrão

**Pontos Fortes:**
- ✅ Facade genuinamente fina (621L) — pura delegação, sem lógica embutida
- ✅ Context Object elimina 32+ parâmetros que seriam passados entre módulos
- ✅ Módulos funcionais são testáveis isoladamente (recebem ctx + host)
- ✅ Host interfaces (types.js) definem contratos entre facade e módulos
- ✅ Separação clara: config.js centraliza env vars, types.js centraliza typedefs

**Pontos Fracos:**
- ⚠️ Context Object é um **God Object mutable** — 32+ campos sem validação de invariantes
- ⚠️ Não há interface/contrato formal para AgentContext — qualquer módulo pode ler/escrever qualquer campo
- ⚠️ Host interfaces (LifecycleHost, DialogHost, etc.) são typedefs JSDoc — sem enforcement em runtime
- ⚠️ Subsistema `messaging/` tem apenas 1 arquivo — assimetria com os outros subsistemas
- ⚠️ Subsistema `state/` tem apenas 1 arquivo (73L) — poderia ser merge com `infra/status-snapshot.js`

---

## 2. Análise por Subsistema

### 2.1 dialog/ — Subsistema de Dialog Loop (1.598L)

**Complexidade: ALTA** — O subsistema mais complexo do agente.

#### Arquitetura Interna

```
agent-dialog-controller.js ──────► dialogStart/Stop/Resume/Ensure
         │                                       │
         ▼                                       ▼
    loop-manager.js ◄───────────────────── DialogLoopManager
         │                                 #turnMutex (Promise chain)
         │                                 #turnQueueDepth
         │                                 #watchdog
         │                                 #prMetrics
         ├── turn-executor.js ◄───────── Pure functions
         ├── watchdog.js ◄────────────── DialogWatchdog (timer)
         ├── protocol.js ◄───────────── DialogProtocol (static classifier)
         └── user-input-handler.js ◄── SDK onUserInputRequest routing
```

#### Problemas Identificados

| ID   | Severidade | Descrição                                                                                                                                                                         |
| ---- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-01 | 🔴 Alta     | `loop-manager.js` (661L) é monolítico — mutex, backpressure, pause/resume, model fallback, compaction, e event wiring (`wireDialogLoopEvents` — 13 listeners) em um único arquivo |
| D-02 | 🟡 Média    | `turn-executor.js` tem race conditions complexas (reply vs stopped vs timeout) sem testes unitários                                                                               |
| D-03 | 🟡 Média    | `watchdog.js` usa `WATCHDOG_THRESHOLDS` hardcoded — deveria vir de `config.js`                                                                                                    |
| D-04 | 🟢 Baixa    | `protocol.js` poderia usar enum/const em vez de strings literais ('ready', 'reply', 'stopped', 'question')                                                                        |
| D-05 | 🟡 Média    | `wireDialogLoopEvents()` está dentro de `loop-manager.js` (deveria estar separado como `dialog/event-wiring.js` por consistência com `session/event-wirer.js`)                    |

### 2.2 session/ — Subsistema de Sessão (1.867L)

**Complexidade: ALTA** — O subsistema com mais linhas e mais responsabilidades.

#### Arquitetura Interna

```
initializer.js ─────────────────► initOrResumeSession()
     │                               ├── Zod validation (session.json)
     │                               ├── buildHookSystemContext()
     │                               ├── shouldRotateSession()
     │                               └── resumeOrCreate() [SDK]
     │
event-wirer.js ─────────────────► wireSessionEvents()
     │                               ├── _wireCompactionEvents
     │                               ├── _wireStreamingEvents
     │                               ├── _wireTokenBudgetEvents
     │                               ├── _wireModeAndToolEvents
     │                               ├── _wireSystemNotificationEvents
     │                               ├── _wireSdkResponseEvents
     │                               ├── _wireUsageEvent
     │                               └── _wireCatchAll
     │
boot-wiring.js ─────────────────► performBootWiring()
     │                               ├── wireSessionEvents
     │                               ├── event-collector.attach
     │                               ├── client lifecycle handlers
     │                               ├── agent-event-observer
     │                               ├── cleanupStaleSessions
     │                               ├── dialog loop resume
     │                               ├── metrics timer
     │                               ├── MCP auto-reconnect
     │                               ├── keepalive.start
     │                               └── handoff wiring
     │
snapshot.js ────────────────────► Snapshot CRUD + pruning
keepalive.js ───────────────────► SessionKeepalive (heartbeat)
history-sync.js ────────────────► SDK → ConversationStore sync
cleanup.js ─────────────────────► Sessões expiradas cleanup
rotation.js ────────────────────► Política de rotação
```

#### Problemas Identificados

| ID   | Severidade | Descrição                                                                                                                                                                                                                                                   |
| ---- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-01 | 🔴 Alta     | `event-wirer.js` (591L) — monolítico com 80+ event handlers. Difícil de navegar, testar e manter                                                                                                                                                            |
| S-02 | 🔴 Alta     | `initializer.js` (376L) mistura 3 responsabilidades: hook context building (100L), session validation (30L), e session init (80L). `buildHookSystemContext()` e `buildHookSystemContextSafe()` são ~140L de I/O de arquivo que não pertencem ao initializer |
| S-03 | 🟡 Média    | `snapshot.js` usa operações **síncronas** de FS (writeFileSync, readFileSync, readdirSync, rmSync) — inconsistente com o padrão async do resto do projeto                                                                                                   |
| S-04 | 🟡 Média    | `boot-wiring.js` realiza 10 etapas sequenciais com side effects — sem transactional rollback se uma etapa falhar no meio                                                                                                                                    |
| S-05 | 🟡 Média    | `cleanup.js` deleta sessões em série (`for...of` com `await`) — deveria usar `Promise.allSettled` para paralelizar                                                                                                                                          |
| S-06 | 🟢 Baixa    | `rotation.js` (82L) é minimalista mas não tem métricas de observabilidade quando decide rotar                                                                                                                                                               |
| S-07 | 🟢 Baixa    | `KNOWN_SDK_EVENTS` Set em event-wirer.js (80+ strings) deveria ser exportado para types.js ou core/events.js                                                                                                                                                |

### 2.3 lifecycle/ — Subsistema de Ciclo de Vida (917L)

**Complexidade: MÉDIA** — Bem estruturado, mas com some cross-cutting concerns.

#### Problemas Identificados

| ID   | Severidade | Descrição                                                                                                                                        |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| L-01 | 🟡 Média    | `agent-lifecycle.js` (362L) tem `initSession()` com 15 passos sequenciais — candidato a decomposição                                             |
| L-02 | 🟡 Média    | `state-io.js` usa `writeFileSync` em `writeState()` mas `writeStateAsync()` existe lado a lado — API confusa. Deveria deprecar a versão síncrona |
| L-03 | 🟢 Baixa    | `entry.js` (162L) tem retry hardcoded de 5 tentativas — deveria vir de config.js                                                                 |
| L-04 | 🟢 Baixa    | `reconnect-policy.js` cria novo `CopilotClient` por tentativa (F42.5) — comportamento correto mas não documentado no JSDoc                       |

### 2.4 infra/ — Subsistema de Infraestrutura (1.251L)

**Complexidade: MÉDIA** — Módulos bem isolados, cada um com responsabilidade clara.

#### Problemas Identificados

| ID   | Severidade | Descrição                                                                                                                                                                              |
| ---- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-01 | 🟡 Média    | `webhook-manager.js` (300L) — validação de URL e DNS rebinding check são responsabilidades de segurança que deveriam estar em um módulo `#copilot/security/url-validator` reutilizável |
| I-02 | 🟡 Média    | `task-executor.js` cria spans OTEL manualmente — deveria usar decorators/wrappers para reduzir boilerplate                                                                             |
| I-03 | 🟢 Baixa    | `handoff-manager.js` estende EventEmitter — inconsistente com o padrão de callback do resto do agent/                                                                                  |
| I-04 | 🟢 Baixa    | `tools-bootstrap.js` tem 15 imports de tools — se novas tools forem adicionadas, este arquivo cresce linearmente                                                                       |
| I-05 | 🟢 Baixa    | `status-snapshot.js` e `state/agent-state.js` têm overlap conceitual (ambos constroem snapshots)                                                                                       |

### 2.5 messaging/ — Subsistema de Mensageria (250L)

**Complexidade: BAIXA** — Funcional e correto.

#### Problemas Identificados

| ID   | Severidade | Descrição                                                                                                                                                      |
| ---- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M-01 | 🟡 Média    | Subsistema com 1 arquivo, sem barrel `index.js`, sem sub-diretório no barrel principal                                                                         |
| M-02 | 🟢 Baixa    | `answerPendingQuestion()` chama `hookToolsResolveUserInput()` duas vezes: uma vez no `if (!ctx.pendingQuestion)` e outra no fluxo normal — aparente duplicação |

### 2.6 state/ — Subsistema de Estado (73L)

**Complexidade: MUITO BAIXA** — Essencialmente 2 funções.

#### Problemas Identificados

| ID    | Severidade | Descrição                                                                                  |
| ----- | ---------- | ------------------------------------------------------------------------------------------ |
| ST-01 | 🟡 Média    | Subsistema com 1 arquivo de 73L — overhead de diretório + barrel para tão pouco código     |
| ST-02 | 🟢 Baixa    | `getStatusSnapshot()` tem lógica de cache TTL inline — poderia usar uma abstração de cache |

---

## 3. Análise de Qualidade Transversal

### 3.1 Consistência de Padrões

| Aspecto        | Estado          | Detalhes                                                                                                |
| -------------- | --------------- | ------------------------------------------------------------------------------------------------------- |
| JSDoc          | ✅ Bom           | Todos os arquivos têm `@module`, `@param`, `@returns`. F44 limpou duplicatas                            |
| `@ts-check`    | ✅ 100%          | Todos os 37 arquivos usam `// @ts-check`                                                                |
| Naming         | ⚠️ Inconsistente | Alguns usam kebab-case (agent-context.js), outros compound (always-alive.js), outros simple (config.js) |
| Error handling | ⚠️ Misto         | Alguns módulos propagam erros (lifecycle), outros engolam silenciosamente (keepalive, history-sync)     |
| Sync vs Async  | ⚠️ Misto         | snapshot.js usa FS sync, state-io.js mistura sync/async, cleanup.js é full async                        |
| Event patterns | ⚠️ 3 padrões     | EventEmitter (always-alive), callbacks (dialog modules), EventEmitter interno (handoff-manager)         |
| Barrel exports | ⚠️ Inconsistente | messaging/ e state/ não têm barrels; dialog, lifecycle, session, infra têm                              |

### 3.2 Métricas de Complexidade

| Métrica                  | Valor                  | Avaliação                                                                                                                                                       |
| ------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Maior arquivo            | loop-manager.js (661L) | ⚠️ Candidato a split                                                                                                                                             |
| 2º maior                 | always-alive.js (621L) | ✅ Aceitável (facade)                                                                                                                                            |
| 3º maior                 | event-wirer.js (591L)  | ⚠️ Candidato a split                                                                                                                                             |
| 4º maior                 | initializer.js (376L)  | ⚠️ Mistura responsabilidades                                                                                                                                     |
| Arquivos > 300L          | 5                      | Poucos — boa granularidade                                                                                                                                      |
| Arquivos < 100L          | 8                      | Barrels e módulos atômicos                                                                                                                                      |
| Classes                  | 7                      | AlwaysAliveAgent, DialogLoopManager, DialogWatchdog, SessionKeepalive, HandoffManager, SessionMessagesCache, MessageQueue, PermissionController, WebhookManager |
| Funções puras exportadas | ~35                    | Bom padrão funcional                                                                                                                                            |

### 3.3 Segurança

| Aspecto                     | Estado | Detalhes                                                              |
| --------------------------- | ------ | --------------------------------------------------------------------- |
| SSRF prevention             | ✅      | webhook-manager.js bloqueia IPs privados + DNS rebinding              |
| Prompt injection prevention | ✅      | initializer.js sanitiza close_key e valores numéricos do session.json |
| Input validation            | ✅      | Zod schema para session.json, regex para sessionId                    |
| Payload sanitization        | ✅      | webhook-manager.js redacta tokens/secrets/passwords                   |
| File size limits            | ✅      | initializer.js limita briefing a 16KB, context a 8KB                  |
| AbortSignal                 | ✅      | message-queue.js e task-executor.js respeitam AbortSignal             |

### 3.4 Observabilidade

| Aspecto                   | Estado      | Detalhes                                                               |
| ------------------------- | ----------- | ---------------------------------------------------------------------- |
| Logging                   | ✅ Extensivo | Quase todos os módulos usam `log()` de `#copilot/observability/logger` |
| OTEL Tracing              | ⚠️ Parcial   | Apenas task-executor.js usa spans OTEL                                 |
| Metrics                   | ⚠️ Parcial   | defaultMetrics usado em initializer.js e rotation.js                   |
| Event-based observability | ✅           | 80+ eventos SDK + eventos customizados do agente                       |
| Health checks             | ⚠️ Básico    | Apenas session keepalive (ping) — sem health endpoint dedicado         |

---

## 4. Dívida Técnica Consolidada

### 4.1 Prioridade Alta (🔴)

1. **D-01**: `loop-manager.js` monolítico (661L) — precisa separar mutex, backpressure, event wiring
2. **S-01**: `event-wirer.js` monolítico (591L) — precisa separar em event handler modules
3. **S-02**: `initializer.js` mistura 3 responsabilidades (376L)

### 4.2 Prioridade Média (🟡)

4. **D-02**: `turn-executor.js` sem testes (race conditions)
5. **D-05**: `wireDialogLoopEvents()` misturado em `loop-manager.js`
6. **S-03**: `snapshot.js` usa FS sync
7. **S-05**: `cleanup.js` deleta sessões em série
8. **L-01**: `initSession()` com 15 passos sem decomposição
9. **L-02**: `state-io.js` mistura sync/async API
10. **I-01**: Validação de URL/DNS deveria ser reutilizável
11. **M-01**: `messaging/` sem barrel
12. **ST-01**: `state/` overhead de diretório para 73L

### 4.3 Prioridade Baixa (🟢)

13. **D-03, D-04, S-06, S-07, L-03, L-04, I-02, I-03, I-04, I-05, M-02, ST-02**

---

## 5. Cobertura de Testes — Análise de Risco

### Módulos sem testes ordenados por risco:

| Risco     | Módulo                         | Linhas | Justificativa                                |
| --------- | ------------------------------ | ------ | -------------------------------------------- |
| 🔴 Crítico | dialog/loop-manager.js         | 661    | Mutex + race conditions + backpressure       |
| 🔴 Crítico | dialog/turn-executor.js        | 361    | Race conditions reply/stopped/timeout        |
| 🔴 Crítico | session/initializer.js         | 376    | Validação de sessão + hook context injection |
| 🟡 Alto    | session/event-wirer.js         | 591    | 80+ event handlers                           |
| 🟡 Alto    | infra/task-executor.js         | 177    | Streaming + retry + OTEL                     |
| 🟡 Alto    | infra/message-queue.js         | 212    | AbortSignal + drain                          |
| 🟡 Médio   | session/boot-wiring.js         | 225    | 10 etapas de wiring                          |
| 🟡 Médio   | infra/webhook-manager.js       | 300    | Segurança (SSRF, DNS rebinding)              |
| 🟢 Baixo   | session/snapshot.js            | 213    | CRUD simples                                 |
| 🟢 Baixo   | dialog/watchdog.js             | 189    | Timer simples                                |
| 🟢 Baixo   | session/keepalive.js           | 155    | Timer com ping                               |
| 🟢 Baixo   | infra/permission-controller.js | 155    | State machine simples                        |
| 🟢 Baixo   | lifecycle/reconnect-policy.js  | 133    | Função pura com backoff                      |
| 🟢 Baixo   | dialog/protocol.js             | 115    | Classificação de strings                     |
| 🟢 Baixo   | session/history-sync.js        | 108    | Sync best-effort                             |
| 🟢 Baixo   | dialog/user-input-handler.js   | 106    | Routing simples                              |
| 🟢 Baixo   | session/cleanup.js             | 97     | Loop + delete                                |
| 🟢 Baixo   | session/rotation.js            | 82     | Comparação de thresholds                     |
