# AGENT DEEP REFACTOR PLAN
**Data**: 2026-03-31
**Escopo**: `src/copilot/agent/` + arquivos correlatos em `src/copilot/`
**Status**: EM EXECUÇÃO
**Baseline**: Phase E.1 commitada (`5d9604d1`), 1817 testes passando, 0 erros TS, 0 erros lint.

---

## 1. DIAGNÓSTICO DO ESTADO ATUAL

### 1.1 Mapa de arquivos — `src/copilot/agent/`

| Arquivo                  | LOC  | Estado               | Problemas identificados                                                                                                                                |
| ------------------------ | ---- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `always-alive.js`        | 1393 | God Object residual  | Ainda possui: gestão de fila, reconexão, permissões, status snapshot, histórico SDK, webhook delegation, event wiring — 8+ responsabilidades distintas |
| `dialog-loop-manager.js` | 596  | Recém extraído (E.1) | Bom estado; JSDoc genérico herda refs históricas de bugs (BUG-AA-*) irrelevantes ao DLM                                                                |
| `dialog-protocol.js`     | 113  | Bem isolado          | JSDoc adequado; sem problemas estruturais                                                                                                              |
| `dialog-watchdog.js`     | 113  | Bem isolado          | Comentário `BUG-05` no interior do guard deve virar JSDoc sólido                                                                                       |
| `entry.js`               | 124  | Bem estruturado      | Import `CopilotClient` não usado diretamente na lógica (apenas no ping); pode extrair `ping` para `lib/`                                               |
| `events.js`              | 63   | Bem isolado          | `dialog.paused` / `dialog.resumed` ausentes do array AGENT_EVENTS (`NEW-PAUSE` nota sem evento correspondente) — BUG REAL                              |
| `session-manager.js`     | 460  | Muito responsável    | 4 responsabilidades: parsing de briefing, tool-audit logging, read/write de estado, initOrResumeSession — candidato forte a split                      |
| `task-executor.js`       | 144  | Bem isolado          | Bom; JSDoc de `QueuedTask.attempts` sem `@default 0`                                                                                                   |
| `tools-bootstrap.js`     | 156  | Bem estruturado      | Lógica de colisão de nomes redundante; poderia estar em `lib/tools-registry.js`                                                                        |
| `webhook-manager.js`     | 106  | Bem isolado          | Bom; usar `URL.canParse()` node 18+ em vez de `new URL()` com try/catch implícito                                                                      |

### 1.2 Arquivos FORA de `agent/` com acoplamento direto ao agente

| Arquivo                     | LOC | Relação com agent/                                                                                                                             | Deve migrar?                                     |
| --------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `terminal/dialog.js`        | 612 | Usa `alwaysAliveAgent.startDialogLoop`, `sendDialogTurn`, `pauseDialogLoop`, `resumeDialogLoop` — é o orchestrator de dialog do terminal LLM-B | NÃO — é layer terminal, correto                  |
| `terminal/http-handlers.js` | 903 | God Object HTTP — manipula `/agent/start`, `/agent/stop`, SSE events, `/dialog/*`                                                              | NÃO mover, mas split interno urgente             |
| `routes/agent.js`           | 205 | Routes REST para o agente — importa `alwaysAliveAgent` diretamente                                                                             | NÃO — é layer de routes, correto                 |
| `routes/webhooks.js`        | 86  | Routes de webhooks — usa `alwaysAliveAgent.registerWebhook/unregister/list`                                                                    | NÃO — OK                                         |
| `channel/inject.js`         | 483 | Importa `alwaysAliveAgent` para injetar turnos e verificar estado                                                                              | NÃO — é camada de injeção, correto               |
| `bridges/nerv-bridge.js`    | 257 | Bridge NERV — ouve eventos do agente e republica no event bus                                                                                  | NÃO — é adaptador, correto                       |
| `core/constants.js`         | 52  | Re-exporta `AGENT_EVENTS` de `agent/events.js`                                                                                                 | NÃO — correto                                    |
| `lib/event-helpers.js`      | 132 | Usado por DLM e always-alive (waitForEvent, raceEvents)                                                                                        | NÃO — utilitário genérico, correto               |
| `agent.js` (raiz copilot)   | 11  | Shim de compatibilidade re-exportando entry.js                                                                                                 | SIM — pode ser absorvido no `index.js` de agent/ |

### 1.3 Bugs identificados

| ID           | Arquivo                                         | Descrição                                                                                                                                                                                           | Severidade |
| ------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| BUG-AGENT-01 | `agent/events.js`                               | `dialog.paused` e `dialog.resumed` ausentes de `AGENT_EVENTS` — listeners registrados via `this.on('dialog.paused', ...)` têm tipagem `string` em vez de union                                      | ALTA       |
| BUG-AGENT-02 | `agent/events.js`                               | Evento `'dialog.loop.changed'` emitido em `startDialogLoop()` e `stop()` ausente de `AGENT_EVENTS`                                                                                                  | ALTA       |
| BUG-AGENT-03 | `always-alive.js` L862                          | `#queue.length >= MAX_QUEUE_SIZE` — a verificação não considera tarefas em processamento; fila de 100 + 1 em exec pode negar mensagem legítima                                                      | BAIXA      |
| BUG-AGENT-04 | `always-alive.js` `#ensureDialogLoopAttached()` | `this.#dialogLoop.removeAllListeners()` remove TODOS os listeners, incluindo externos que podem ter sido registrados antes. Deveria apenas re-registrar os internos condicionalmente                | MÉDIA      |
| BUG-AGENT-05 | `session-manager.js`                            | `logToolAudit` usa `void (async () => {...})()` — erros internos do IIFE são completamente silenciados, incluindo erros de permissão de sistema de arquivos                                         | BAIXA      |
| BUG-AGENT-06 | `webhook-manager.js` L93                        | `new URL(url)` pode lançar sem ser capturada explicitamente; todo o request para webhook inválido falha com stack trace não-gracioso                                                                | BAIXA      |
| BUG-AGENT-07 | `always-alive.js` `#syncSdkHistory`             | `conversationStore.syncFromSdkHistory` é chamado com `hubSessionId` mas se o ConversationStore falhar, o erro é apenas logado — nenhuma retry ou persistência de "falha de sync"                    | BAIXA      |
| BUG-AGENT-08 | `dialog-loop-manager.js` `resume()`             | `waitForEvent(this, 'question.pending', ...)` — se o evento `question.pending` já foi emitido ANTES da chamada, ele é perdido. Deveria verificar `host.getPendingQuestion()` sincronicamente antes. | MÉDIA      |

### 1.4 Oportunidades de melhoria JSDoc/tipagem

| Arquivo                  | Problema                                                                                                                                                     | Ação                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Todos os arquivos        | Comentários históricos `BUG-XX-YY (fix):`, `MELHORIA-NN (fix):`, `RF-D-NN:`, `GAP-AA-NN:` etc. espalhados no código — são ruído histórico que polui o código | Remover, substituir por JSDoc/comentários de domínio concisos       |
| `always-alive.js`        | `AgentStatusSnapshot` typedef incompleta — falta `permissionMode` no tipo (está no objeto mas não no typedef)                                                | Adicionar `@property {string} permissionMode`                       |
| `always-alive.js`        | `sendMessage` opts inline typedef com comentário truncado (backtick inconsistente na descrição de `timeoutMs`)                                               | Corrigir JSDoc malformado                                           |
| `session-manager.js`     | `AliveAgentState` typedef sem validação por Zod — campos opcionais sem `@default`                                                                            | Criar Zod schema canônico para AliveAgentState                      |
| `task-executor.js`       | `QueuedTask.attempts` sem `@default`                                                                                                                         | Adicionar `@default 0`                                              |
| `dialog-loop-manager.js` | Typedef `AgentHost.sendMessage` com opts genérico                                                                                                            | Tipar completamente com `{ timeoutMs?: number; attachments?: ... }` |
| `events.js`              | `AgentEventName` union type incompleto (missing events)                                                                                                      | Completar após adicionar eventos faltantes ao array                 |

---

## 2. PLANO DE REFATORAÇÃO — FASES

### FASE F.1 — Corrigir bugs de events.js + JSDoc hardening sempre-alive (sem mover código)
**Objetivo**: Zero bugs conhecidos; JSDoc sólido com tipos explícitos.
**Risco**: Baixo — sem mudanças de comportamento.
**Critério de conclusão**: 0 erros TS, 0 erros lint, 1817 testes.

#### F.1.1 — `events.js`: adicionar eventos faltantes ao `AGENT_EVENTS`
- Adicionar: `'dialog.paused'`, `'dialog.resumed'`, `'dialog.loop.changed'`
- Atualizar `AgentEventName` union type

#### F.1.2 — `always-alive.js`: JSDoc + tipagem hardening
- Remover todos os comentários históricos (`BUG-AA-*`, `MELHORIA-NN`, `GAP-AA-*`, `RF-D*`, `RF-PR-*`, etc.)
- Substituir por JSDoc sólido com `@throws`, `@since`, context domain
- Completar `AgentStatusSnapshot` typedef com `permissionMode`
- Corrigir JSDoc malformado em `sendMessage` (backtick truncado)
- Corrigir BUG-AGENT-04: `#ensureDialogLoopAttached` → verificar se já attached antes de removeAllListeners

#### F.1.3 — `dialog-loop-manager.js`: JSDoc + tipagem hardening
- Remover comentários históricos desnecessários
- Completar typedef `AgentHost.sendMessage` com tipos explícitos
- Corrigir BUG-AGENT-08: verificar `host.getPendingQuestion()` antes de `waitForEvent` no `resume()`

#### F.1.4 — `dialog-watchdog.js` + `dialog-protocol.js`: limpeza menor
- `dialog-watchdog.js`: converter comentário inline `BUG-05` em guard sem texto histórico
- `dialog-protocol.js`: typo "La questão" → "A questão" no JSDoc

#### F.1.5 — `session-manager.js`: limpeza de comentários + JSDoc mínimo
- Remover labels históricos (`BUG-HIGH-05`, `RF-D06`, `BUG-AA-07`, `PERF-02`, etc.)
- JSDoc limpo em todas as funções exportadas

#### F.1.6 — `task-executor.js` + `tools-bootstrap.js` + `webhook-manager.js`
- `task-executor.js`: adicionar `@default 0` ao `QueuedTask.attempts`
- `webhook-manager.js`: corrigir BUG-AGENT-06 com validação de URL antes do request
- `tools-bootstrap.js`: mover lógica de colisão de nomes para `lib/tools-registry.js`

---

### FASE F.2 — Extrair SessionStateManager de session-manager.js
**Objetivo**: Separar I/O de estado (read/write) de lógica de sessão (init/resume).
**Risco**: Médio — precisa atualizar todos os importadores de `readState`/`writeState`/`writeStateAsync`/`clearState`.
**Critério de conclusão**: 0 erros TS, 0 erros lint, 1817 testes.

#### F.2.1 — Criar `agent/state-io.js`
Extrair de `session-manager.js`:
- `readState()`, `writeState()`, `writeStateAsync()`, `clearState()`
- typedef `AliveAgentState` + schema Zod canônico
- `_stateCache`, `_stateDirReady` (módulo-privados)

#### F.2.2 — Criar `agent/tool-audit-logger.js`
Extrair de `session-manager.js`:
- `logToolAudit()`, `isHighRiskTool()`, `buildAuditingPermissionHandler()`
- Constante `TOOL_AUDIT_LOG`

#### F.2.3 — `session-manager.js` residual
Após extrações, fica apenas com:
- `buildHookSystemContext()`, `buildHookSystemContextSafe()`, `setBackgroundCompactionThreshold()`
- `initOrResumeSession()`
- Renomear para `session-initializer.js` para clareza semântica

#### F.2.4 — Atualizar todos os importadores
- `always-alive.js` → import de `state-io.js` em vez de `session-manager.js`
- `dialog-loop-manager.js` → idem
- Qualquer outro importador de `readState`/`writeState`

---

### FASE F.3 — Extrair PermissionController de always-alive.js
**Objetivo**: Separar gestão de permissão/modo em classe própria.
**Risco**: Baixo — já tem `WebhookManager` como precedente.
**Critério de conclusão**: 0 erros TS, 0 erros lint, 1817 testes.

#### F.3.1 — Criar `agent/permission-controller.js`
```js
class PermissionController {
    #handler = approveAll;
    #modeLabel = 'approve_all';

    getMode() → 'approve_all' | 'audit_only' | 'selective'
    setMode(mode, opts) → void
    get handler() → PermissionHandler
    emit('mode_changed', { mode }) → via EventEmitter (ou callback)
}
```

#### F.3.2 — `always-alive.js`: delegar para `#permissions`
- Remove `#permissionHandler`, `#permissionModeLabel`
- Expõe `getPermissionMode()`, `setPermissionMode()` como thin delegations

---

### FASE F.4 — Extrair MessageQueueManager de always-alive.js
**Objetivo**: Separar fila + processamento de tarefas em classe própria.
**Risco**: Alto — exige refatoração cuidadosa de `#processQueue()` e `executeTask` callback chain.
**Critério de conclusão**: 0 erros TS, 0 erros lint, 1817 testes.

#### F.4.1 — Criar `agent/message-queue.js`
```js
class MessageQueue extends EventEmitter {
    #queue = [];
    #processing = false;

    enqueue(task, { signal }) → Promise<string>
    get size() → number
    get oldest() → AgentTask | undefined
    requeue(task) → void
    drainWithError(err) → void  // shutdown
    #scheduleNext() → void

    // emits: 'task.queued', 'task.started', 'task.completed', 'task.error', 'task.delta'
}
```

#### F.4.2 — `always-alive.js` integração
- `#queue` → `#messageQueue = new MessageQueue()`
- `sendMessage()` → `return this.#messageQueue.enqueue(task, opts)`
- `#processQueue()` → removido (está em MessageQueue)
- `stop()` → `this.#messageQueue.drainWithError(shutdownError)`
- O campo `#status` permanece em AlwaysAliveAgent (é do ciclo de vida, não da fila)

---

### FASE F.5 — Criar `agent/index.js` (barrel export) e limpar `agent.js` legado
**Objetivo**: API pública limpa de `src/copilot/agent/`.
**Risco**: Baixo.
**Critério de conclusão**: 0 erros TS, 0 erros lint, 1817 testes.

#### F.5.1 — Criar `agent/index.js`
```js
export { AlwaysAliveAgent, alwaysAliveAgent } from './always-alive.js';
export { DialogLoopManager } from './dialog-loop-manager.js';
export { DialogProtocol } from './dialog-protocol.js';
export { DialogWatchdog } from './dialog-watchdog.js';
export { WebhookManager } from './webhook-manager.js';
export { AGENT_EVENTS } from './events.js';
export * from './state-io.js';   // após F.2
```

#### F.5.2 — Remover `src/copilot/agent.js` (shim)
- Verificar se algum arquivo externo importa `src/copilot/agent.js` diretamente
- Absorver em `index.js` ou deletar

---

### FASE F.6 — AlwaysAliveAgent: limpeza residual e hardening final
**Objetivo**: Após extrações, o `always-alive.js` deve ter ~400 LOC de código limpo.
**Risco**: Baixo — consolidação de cleanup.
**Critério de conclusão**: 0 erros TS strict, 0 erros lint, 1817 testes.

#### F.6.1 — `#wireSessionEvents()` → extrair para `agent/session-event-wirer.js`
- Função pura (não classe); recebe session + callbacks e registra todos os listeners
- Retorna array de unsubscribers
- Fica em `agent/` pois é específico do contrato SDK

#### F.6.2 — `#tryReconnect()` → extrair para `agent/reconnect-policy.js`
- Encapsula lógica de backoff exponencial + jitter
- Configurável: `maxAttempts`, `baseDelayMs`
- Testável de forma independente

#### F.6.3 — `getStatusSnapshot()` e cache
- Mover para `agent/status-snapshot.js` como função pura
- Recebe state parcial como parâmetro

#### F.6.4 — `always-alive.js` resultado final
Responsabilidades remanescentes (estado canônico):
1. Orquestração de lifecycle (`start`, `stop`, shutdown)
2. `sendMessage()` (frontend da fila)
3. `answerPendingQuestion()`
4. Delegates finos para DLM, WebhookManager, PermissionController, MessageQueue
5. Getters/setters de configuração (`model`, `reasoningEffort`)
6. `getStatusSnapshot()` simplificado
7. Emissão de eventos de alto nível

---

## 3. ORDEM DE EXECUÇÃO

```
F.1 (bugs + JSDoc) → commit
F.2 (SessionStateManager) → commit
F.3 (PermissionController) → commit
F.4 (MessageQueueManager) → commit
F.5 (index.js + shim cleanup) → commit após F.2
F.6 (limpeza final) → commit
```

---

## 4. TRACKING DE PROGRESSO

| Fase                     | Status | Commit                    |
| ------------------------ | ------ | ------------------------- |
| E.1 DialogLoopManager    | ✅ DONE | `5d9604d1`                |
| F.1 Bugs + JSDoc         | ✅ DONE | `00b7ce27`                |
| F.2 SessionStateManager  | ✅ DONE | committed                 |
| F.3 PermissionController | ✅ DONE | (pendente commit F.3–F.6) |
| F.4 MessageQueueManager  | ✅ DONE | (pendente commit F.3–F.6) |
| F.5 index.js barrel      | ✅ DONE | (pendente commit F.3–F.6) |
| F.6 limpeza final        | ✅ DONE | (pendente commit F.3–F.6) |

---

## 5. CRITÉRIOS DE QUALIDADE POR FASE

A cada commit intermediário:
- `npm run lint` → 0 erros
- `npm run format:check` → clean
- `npm run test:unit` → 1817 pass, 0 fail
- `npx tsc -p tsconfig.node.json --noEmit` → 0 erros
- `npx tsc -p config/typing/strict/tsconfig.strict.src.copilot.json --noEmit` → 0 erros
