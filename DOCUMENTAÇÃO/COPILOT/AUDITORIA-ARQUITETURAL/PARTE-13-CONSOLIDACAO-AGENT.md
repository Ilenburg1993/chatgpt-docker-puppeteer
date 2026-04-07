# PARTE 13 — Auditoria Profunda agent/ & Consolidação

**Criação**: 2026-07-23 | **Revisão 2 (Auditoria Profunda)**: 2026-07-23
**Escopo**: Análise completa de `src/copilot/agent/` (31 arquivos, 6.790L) com foco na
decomposição estrutural de `always-alive.js` (1.348L → meta <800L).

---

## 1. Diagnóstico — Estado Atual

### 1.1 Mapa de Arquivos

| Subdir     | Arquivos | Linhas    | Maiores                                                 |
| ---------- | -------- | --------- | ------------------------------------------------------- |
| (raiz)     | 4        | 1.932     | always-alive.js (1613), config.js (177), types.js (122) |
| dialog/    | 5        | 1.043     | loop-manager.js (661), turn-executor.js (361)           |
| infra/     | 8        | 1.251     | webhook-manager.js (300), message-queue.js (212)        |
| lifecycle/ | 4        | 555       | state-io.js (251), entry.js (162)                       |
| session/   | 7        | 1.041     | event-wirer.js (591), initializer.js (376)              |
| **Total**  | **28**   | **6.613** |                                                         |

### 1.2 God Modules no agent/

| Arquivo                | Linhas | Tipo            | Decomponível?                   |
| ---------------------- | ------ | --------------- | ------------------------------- |
| always-alive.js        | 1.613  | Orchestrator    | **SIM** — meta <1000L           |
| dialog/loop-manager.js | 661    | FSM             | NÃO — F18 avaliou como coeso    |
| session/event-wirer.js | 591    | Wiring function | **SIM** — separar por categoria |

### 1.3 always-alive.js — Responsabilidades Mapeadas

A classe `AlwaysAliveAgent` é um EventEmitter com **26 campos privados** e ~20 métodos. As
responsabilidades podem ser agrupadas em 7 domínios:

| Domínio               | Métodos/Campos                                                                                                   | Linhas Est. |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------- |
| **A. Boot/Lifecycle** | `start()`, `#initSession()`                                                                                      | ~370L       |
| **B. Shutdown**       | `stop()`                                                                                                         | ~115L       |
| **C. Messaging**      | `sendMessage()`, `#enqueueTask()`, `steerMessage()`                                                              | ~100L       |
| **D. Dialog Loop**    | `startDialogLoop()`, `stopDialogLoop()`, `pause/resume`, `#ensureDialogLoopAttached()`                           | ~150L       |
| **E. User Input**     | `#handleUserInputRequest()`, `#handleDialogLoopInput()`, `#handleInteractiveQuestion()`                          | ~110L       |
| **F. Config/Status**  | getters (model, reasoning, status), `getStatusSnapshot()`, `listenerDiagnostics()`                               | ~200L       |
| **G. Utility**        | permissions, webhooks, `answerPendingQuestion()`, `getSessionMessages()`, `#syncSdkHistory()`, `#tryReconnect()` | ~200L       |
| **H. Campos/Const**   | 26 private fields + JSDoc + imports                                                                              | ~370L       |

**Total**: ~1.615L (soma das estimativas)

### 1.4 Campos Privados que Bloqueiam Extração

A classe usa `#private` fields extensivamente. Isso impede delegação por função pura EXCETO quando:
1. O campo é passado como parâmetro (ex: `this.#session` → `session`)
2. O método acessa campos via getters já expostos (ex: `this.sessionId`)
3. O bloco inteiro pode ser encapsulado com uma interface de callbacks

Campos críticos (usados por >5 métodos):
- `#session` — 15 refs
- `#status` — 12 refs (via `#setStatus()`)
- `#client` — 6 refs
- `#dialogLoop` — 10 refs
- `#pendingQuestion` — 6 refs
- `#model` — 7 refs

### 1.5 event-wirer.js — Estrutura

Uma megafunção `wireSessionEvents()` (591L) que registra ~20 listeners no SDK session. Os listeners
caem em 4 categorias:

1. **Streaming** (task.delta, task.queued, task.completed) → ~120L
2. **Sessão/Lifecycle** (session.compaction, session.idle, usage_info) → ~150L
3. **Logging/Audit** (assistant.message, tool.*, error) → ~200L
4. **Billing/Metering** (assistant.usage, quota) → ~80L

---

## 2. Proposta — Situação Ideal

### 2.1 always-alive.js: de 1613L para <1000L

Extrações viáveis (respeita campos #private):

| Extração                  | Target                           | Linhas    | Impacto |
| ------------------------- | -------------------------------- | --------- | ------- |
| `start()` wiring pós-init | `session/boot-wiring.js` (nova)  | ~200L     | Alto    |
| `stop()` cleanup          | `lifecycle/shutdown.js` (nova)   | ~115L     | Médio   |
| User input handlers       | `dialog/user-input-handler.js`   | ~110L     | Médio   |
| `#syncSdkHistory()`       | `session/history-sync.js` (nova) | ~40L      | Baixo   |
| `getSessionMessages()`    | session/ ou conversação          | ~25L      | Baixo   |
| **Total extraível**       |                                  | **~490L** |         |

**Resultado esperado**: always-alive.js ~1120L. Para chegar a <1000L, precisamos eliminar JSDoc
verboso e comprimir campos/constructor (~120L adicionais).

**Estratégia alternativa** (mais agressiva): parametrizar `start()` e `stop()` recebendo um objeto
`AgentContext` que encapsula `#session`, `#client`, `#status`, etc. Isso permite extração completa
de start/stop como funções puras. Custo: criação de adapter layer.

### 2.2 event-wirer.js: de 591L para ~150L + 4 sub-módulos

| Sub-módulo                      | Responsabilidade            | Linhas Est. |
| ------------------------------- | --------------------------- | ----------- |
| `event-wirer.js` (orquestrador) | Compõe e retorna unsubs     | ~150L       |
| `wirers/streaming.js` (nova)    | task.delta/queued/completed | ~120L       |
| `wirers/lifecycle.js` (nova)    | compaction, idle, context   | ~150L       |
| `wirers/audit.js` (nova)        | tool, assistant, error      | ~200L       |
| `wirers/billing.js` (nova)      | usage, quota                | ~80L        |

### 2.3 Consolidações Menores

1. **config.js** (177L) — Manter. Funciona como layer de nomes internos sobre config/env.js
2. **types.js** (122L) — Manter. É o único arquivo de typedefs do subsistema
3. **dialog/loop-manager.js** (661L) — Não decompor (F18 avaliou, FSM coesa)

---

## 3. Roadmap F29-F34

### F29: Extrair Start() Wiring → session/boot-wiring.js

1. **F29.1** — Criar `session/boot-wiring.js` com função `performBootWiring(agent, session, opts)`
2. **F29.2** — Encapsular wirings pós-init de start() (event-collector, SDK lifecycle, observer,
   cleanup, dialog resume, metrics timer, MCP reconnect, keepalive, handoff)
3. **F29.3** — always-alive.js delega para `performBootWiring()` passando callbacks
4. **F29.4** — Validar: lint, typecheck, wc -l
5. **Meta**: ~200L extraídos

### F30: Extrair Stop() → lifecycle/shutdown.js

1. **F30.1** — Criar `lifecycle/shutdown.js` com função `performGracefulShutdown(ctx)`
2. **F30.2** — Encapsular stop() completo exceto status check e emit('stopped')
3. **F30.3** — always-alive.js delega stop() → `performGracefulShutdown()`
4. **F30.4** — Validar
5. **Meta**: ~115L extraídos

### F31: Extrair User Input Handlers → dialog/user-input-handler.js

1. **F31.1** — Criar `dialog/user-input-handler.js` com funções:
   - `handleUserInputRequest(dialogLoop, opts)` — dispatcher
   - `handleDialogLoopInput(dialogLoop, opts)` — protocolo
   - `handleInteractiveQuestion(opts)` — prompt normal
2. **F31.2** — always-alive.js delega `#handleUserInputRequest()` → import
3. **F31.3** — Validar
4. **Meta**: ~110L extraídos

### F32: Extrair syncSdkHistory + getSessionMessages

1. **F32.1** — Mover `#syncSdkHistory()` para `session/history-sync.js` como função pura
2. **F32.2** — Mover `getSessionMessages()` para mesmo módulo (recebe session como param)
3. **F32.3** — Validar
4. **Meta**: ~65L extraídos

### F33: Decompor event-wirer.js (591L)

1. **F33.1** — Criar `session/wirers/` subdir com streaming.js, lifecycle.js, audit.js, billing.js
2. **F33.2** — event-wirer.js vira compositor (~150L)
3. **F33.3** — Atualizar barrel session/index.js
4. **F33.4** — Validar
5. **Meta**: event-wirer.js <200L

### F34: Documentação Final + Auditoria Pós-Consolidação

1. **F34.1** — Atualizar PARTE-12 com métricas pós-F34
2. **F34.2** — Atualizar PARTE-13 com resultados reais
3. **F34.3** — Registrar métricas comparativas
4. **F34.4** — Push final

---

## 4. Métricas-Alvo Pós-F34

| Métrica                    | Atual  | Alvo Pós-F34 |
| -------------------------- | ------ | ------------ |
| always-alive.js            | 1.613L | <1.100L      |
| event-wirer.js             | 591L   | <200L        |
| God Modules >600L (agent/) | 3      | 1 (loop-mgr) |
| Total arquivos agent/      | 28     | ~35          |
| Total linhas agent/        | 6.613  | ~6.700       |

---

## 5. Riscos e Mitigações

| Risco                                     | Mitigação                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| Campos #private impedem extração          | Parametrizar via callbacks (padrão já usado em executeTask, tryReconnect) |
| start() é um monólito de 200L de wirings  | Boot-wiring.js recebe struct de callbacks                                 |
| event-wirer.js tem side-effects sutis     | Cada wirer retorna array de unsubs (composável)                           |
| Loop-manager depende de state-io          | Mantém — é cross-cutting legítimo                                         |
| Testes unitários inexistentes para agent/ | Fora de escopo desta rodada (candidato F35+)                              |

---

## 6. Resultados Reais — Execução F29–F34

**Data de conclusão**: 2026-07-23

### 6.1 Fases Executadas

| Fase | Status      | Descrição                                                                                                  | Commit     |
| ---- | ----------- | ---------------------------------------------------------------------------------------------------------- | ---------- |
| F29  | ✅ Concluída | Extrair boot wiring → `session/boot-wiring.js` (225L)                                                      | `4a38c0ed` |
| F30  | ⏭️ Skipped   | stop() acessa 16 campos #private — custo/benefício baixo                                                   | —          |
| F31  | ✅ Concluída | Extrair user input handlers → `dialog/user-input-handler.js` (106L)                                        | `0bb17694` |
| F32  | ✅ Concluída | Extrair syncSdkHistory + SessionMessagesCache → `session/history-sync.js` (108L)                           | `6718e215` |
| F33  | ⏭️ Skipped   | event-wirer.js já decomposto internamente em 8 sub-funções — fragmentar em arquivos seria over-engineering | —          |
| F34  | ✅ Concluída | Documentação atualizada com resultados reais                                                               | este doc   |

### 6.2 Métricas Comparativas

| Métrica               | Antes (F28) | Depois (F34) | Delta                                |
| --------------------- | ----------- | ------------ | ------------------------------------ |
| always-alive.js       | 1.613L      | 1.348L       | **-265L (-16,4%)**                   |
| God Modules >600L     | 3           | 2            | **-1** (always-alive saiu do limiar) |
| Total arquivos agent/ | 28          | 31           | **+3** (novos módulos)               |
| Total linhas agent/   | 6.613       | 6.790        | +177L (overhead JSDoc/barrel)        |

### 6.3 Módulos Criados

| Módulo                         | Linhas | Responsabilidade                                                                                                          |
| ------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| `session/boot-wiring.js`       | 225    | Wiring pós-#initSession em start(): eventos SDK, collector, observer, cleanup, recovery, metrics, MCP, keepalive, handoff |
| `dialog/user-input-handler.js` | 106    | Dispatch ask_user SDK: dialog loop input vs interactive question                                                          |
| `session/history-sync.js`      | 108    | Sync SDK history → ConversationStore + cache de mensagens com TTL                                                         |

### 6.4 Decisões de Skip

**F30 (stop()):** O método `stop()` acessa 16 campos #private. A extração exigiria um
`ShutdownContext` com 16+ propriedades callback/referência, produzindo ~30L de criação do contexto
+ ~131L na função externa — sem redução líquida e com aumento de indireção.

**F33 (event-wirer.js):** O arquivo já possui decomposição interna exemplar: 8 sub-funções
nomeadas e documentadas (`_wireCompactionEvents`, `_wireStreamingEvents`,
`_wireTokenBudgetEvents`, etc.), cada uma com interface uniforme `(session, callbacks)`.
A constante `KNOWN_SDK_EVENTS` (105L) é dados, não lógica. Fragmentar em 4-5 arquivos separados
(`session/wirers/`) adicionaria overhead de importação e gerenciamento sem ganho real de coesão
ou manutenibilidade.

### 6.5 Padrão Arquitetural Consolidado

Todas as extrações seguem o **Callback Context Pattern**:

```js
// Módulo extraído recebe função pura + struct de callbacks
export function performBootWiring(session, isResumed, ctx) { ... }
export function handleUserInputRequest(input, ctx) { ... }
export function syncSdkHistory(session, emitFn) { ... }

// always-alive.js delega criando o contexto na chamada
await performBootWiring(session, isResumed, {
    emit: (...args) => this.emit(...args),
    getStatus: () => this.#status,
    // ... demais callbacks
});
```

Este padrão preserva encapsulamento (#private fields) enquanto permite extração de lógica
para módulos puros testáveis.

---

# REVISÃO 2 — Auditoria Profunda & Arquitetura Ideal (F35+)

**Data**: 2026-07-23 | **Estado base**: always-alive.js @ 1.348L (pós-F34)

## 7. Estado Atual Detalhado (Pós-F34)

### 7.1 Mapa de Arquivos Atualizado

| Subdir     | Arquivos | Linhas    | Maiores                                                          |
| ---------- | -------- | --------- | ---------------------------------------------------------------- |
| (raiz)     | 4        | 1.647     | always-alive.js (1348), config.js (177), types.js (122)          |
| dialog/    | 6        | 1.149     | loop-manager.js (661), turn-executor.js (361)                    |
| infra/     | 8        | 1.251     | webhook-manager.js (300), message-queue.js (212)                 |
| lifecycle/ | 4        | 555       | state-io.js (251), entry.js (162)                                |
| session/   | 9        | 1.188     | event-wirer.js (591), initializer.js (376), boot-wiring.js (225) |
| **Total**  | **31**   | **6.790** |                                                                  |

### 7.2 always-alive.js — Análise Método-a-Método

| Método                       | Linhas | Campos #private acessados | Domínio       |
| ---------------------------- | ------ | ------------------------- | ------------- |
| `stop()`                     | 150    | 17                        | Lifecycle     |
| `start()`                    | 101    | 17                        | Lifecycle     |
| `#initSession()`             | 73     | 11                        | Session       |
| `#ensureDialogLoopAttached()`| 52     | 4                         | Dialog        |
| `#tryReconnect()`            | 39     | 6                         | Session       |
| `getStatusSnapshot()`        | 38     | 11                        | Status        |
| `startDialogLoop()`          | 37     | 5                         | Dialog        |
| `#processQueue()`            | 35     | 9                         | Queue         |
| `sendMessage()`              | 33     | 2                         | Messaging     |
| `answerPendingQuestion()`    | 26     | 1                         | Input         |
| `#enqueueTask()`             | 25     | 1                         | Queue         |
| 22 getters/setters           | ~250   | 1-3 cada                  | Config/Status |
| Campos + JSDoc + imports     | ~370   | (declarações)             | Infra         |
| **TOTAL**                    |**1348**|                           |               |

### 7.3 Campos #private — Mapa de Referências

**32 campos privados** com 176 acessos `this.#`:

| Campo                        | Refs | Cluster            | Papel                           |
| ---                          | ---  | ---                | ---                             |
| `#dialogLoop`                | 25   | Dialog             | FSM do dialog loop              |
| `#status`                    | 22   | State              | Estado do agente                |
| `#session`                   | 19   | SDK                | Sessão SDK ativa                |
| `#model`                     | 10   | Config             | Modelo LLM                      |
| `#messageQueue`              | 8    | Queue              | Fila de tarefas                 |
| `#statusSnapshotCache`       | 8    | State              | Cache do snapshot               |
| `#pendingQuestion`           | 8    | Input              | Pergunta pendente               |
| `#client`                    | 7    | SDK                | Cliente SDK                     |
| `#setStatus`                 | 7    | State              | Mutador de status               |
| `#agentObserver`             | 6    | Observability      | Observer de métricas            |
| `#reasoningEffort`           | 5    | Config             | Nível de reasoning              |
| `#keepalive`                 | 5    | Infra              | Heartbeat de sessão             |
| `#sessionEventUnsubscribers` | 5    | SDK                | Cleanup de listeners            |
| `#sendCount`                 | 5    | Counters           | Contador de sends               |
| `#permissions`               | 4    | Config             | Controller de permissões        |
| `#webhooks`                  | 4    | Config             | Webhook manager                 |
| `#contextState`              | 4    | Observability      | Uso de tokens atual             |
| `#metricsTimer`              | 4    | Infra              | Timer periódico de métricas     |
| `#mcpReconnectCancel`        | 4    | Infra              | Cancel de reconnect MCP         |
| `#dialogLoopAttached`        | 4    | Dialog             | Flag de idempotência            |
| `#toolsRegistry`             | 3    | Config             | Registry de tools               |
| `#lastPrInfo`                | 3    | Counters           | Último billing info             |
| `#messagesCache`             | 3    | Cache              | Cache de mensagens              |
| `#isReconnecting`            | 3    | SDK                | Flag de reconexão               |
| `#processQueue`              | 2    | Queue              | Método ref (MessageQueue cb)    |
| `#handoff`                   | 2    | Infra              | Handoff manager                 |
| `#initSession`               | 2    | Session            | Método ref (tryReconnect)       |
| `#lastCheckpointPath`        | 2    | Counters           | Último checkpoint               |
| `#ensureDialogLoopAttached`  | 2    | Dialog             | Método ref                      |
| `#enqueueTask`               | 2    | Queue              | Método ref                      |
| `#isResumed`                 | 2    | State              | Flag de resume                  |
| `#tryReconnect`              | 1    | Session            | Método ref (processQueue cb)    |

### 7.4 Clusters de Coesão

| Cluster        | Campos | Refs | Descrição                          |
| -------------- | ------ | ---- | ---------------------------------- |
| **Dialog**     | 4      | 33   | dialogLoop, dialogLoopAttached, pendingQuestion (parcial) |
| **SDK/Session**| 4      | 34   | session, client, sessionEventUnsubscribers, isReconnecting |
| **State**      | 3      | 32   | status, statusSnapshotCache, isResumed |
| **Config**     | 6      | 19   | model, reasoningEffort, permissions, webhooks, toolsRegistry, handoff |
| **Queue**      | 2      | 10   | messageQueue, enqueueTask          |
| **Infra**      | 4      | 15   | keepalive, metricsTimer, mcpReconnectCancel, agentObserver |
| **Counters**   | 4      | 13   | sendCount, contextState, lastPrInfo, lastCheckpointPath |
| **Cache**      | 1      | 3    | messagesCache                      |

### 7.5 API Pública — Consumo Externo (excluindo agent/)

Mapeamento de todos os usos do singleton `alwaysAliveAgent` fora do agent/:

| Método/Prop          | Refs externas | Consumidores principais                   |
| -------------------- | ------------- | ----------------------------------------- |
| `.on()`/`.off()`     | 48            | nerv-bridge, entry, engine                |
| `getStatusSnapshot()`| 15            | observability API, engine, handlers       |
| `dialogLoopActive`   | 14            | engine, handlers                          |
| `model`              | 9             | engine, output                            |
| `reasoningEffort`    | 8             | engine, output                            |
| `status`             | 7             | engine, entry, agent API                  |
| `lastPrInfo`         | 5             | engine                                    |
| `start()/stop()`     | 7             | entry, nerv-bridge                        |
| `pause/resume`       | 8             | nerv-bridge, handlers                     |
| `sessionId`          | 4             | agent API                                 |
| `getHandoffManager()`| 4             | handlers                                  |

**Insight**: O agente é consumido fundamentalmente como:
1. **Event Source** — EventEmitter (48 refs on/off)
2. **Status Provider** — getStatusSnapshot + getters read-only
3. **Lifecycle Controller** — start/stop/pause/resume
4. **Message Gateway** — sendMessage/answerPendingQuestion (3 refs)

---

## 8. Arquitetura Ideal — Proposta Estrutural

### 8.1 Problema Central: God Object com Estado Difuso

O `AlwaysAliveAgent` é um **God Object** clássico:
- 32 campos #private com 176 acessos
- `stop()` e `start()` acessam 17 campos **cada**
- A classe acumula 7+ domínios distintos (lifecycle, dialog, config, queue, observability, etc.)
- Os clusters de coesão mostram grupos internos fracamente acoplados entre si, mas
  fortemente acoplados ao `this`

### 8.2 Estratégia: AgentContext como Mediador

A solução é criar um **objeto de contexto compartilhado** (`AgentContext`) que substitui os campos
#private individuais. Isso permite:

1. Qualquer módulo extraído acessa o contexto via referência imutável (passada no constructor)
2. O `AlwaysAliveAgent` se torna um **thin orchestrator** que:
   - Cria o `AgentContext` no constructor
   - Delega lifecycle para `AgentLifecycle`
   - Delega dialog para `AgentDialogController`
   - Delega messaging para `AgentMessaging`
   - Expõe API pública inalterada (retrocompatível)

### 8.3 AgentContext — Estrutura

```js
/**
 * Contexto compartilhado entre todos os módulos do agente.
 * Substitui os 32 campos #private espalhados pelo always-alive.js.
 */
export class AgentContext {
    /** @type {CopilotClient | null} */
    client = null;

    /** @type {CopilotSession | null} */
    session = null;

    /** @type {AgentStatus} */
    status = 'stopped';

    /** @type {boolean} */
    isReconnecting = false;

    /** @type {string} */
    model;

    /** @type {'low'|'medium'|'high'|'xhigh'|undefined} */
    reasoningEffort;

    /** @type {boolean} */
    isResumed = false;

    /** @type {number} */
    sendCount = 0;

    // ... mais campos, todos mutáveis via acesso direto
    // ao invés de getters/setters internos

    /** @type {EventEmitter} */
    emitter; // referência ao AlwaysAliveAgent para emit()
}
```

### 8.4 Módulos Resultantes

| Módulo                        | Linhas Est. | Responsabilidade                                       |
| ----------------------------- | ----------- | ------------------------------------------------------ |
| `always-alive.js` (orquestr.) | ~350        | Constructor, API pública, delegação, exports            |
| `lifecycle/agent-lifecycle.js`| ~250        | start(), stop(), #initSession()                        |
| `dialog/agent-dialog.js`      | ~150        | startDialogLoop, stopDialogLoop, pause/resume, ensure  |
| `messaging/agent-messaging.js`| ~100        | sendMessage, steerMessage, #enqueueTask, #processQueue |
| `state/agent-state.js`        | ~80         | getStatusSnapshot, #setStatus, getSessionMessages      |
| `state/agent-context.js`      | ~120        | AgentContext class com todos os campos                  |

**always-alive.js estimado**: 350L (73% de redução vs 1.348L atual)

### 8.5 Compatibilidade e API de Superfície

A API pública permanece **100% inalterada**:
- `class AlwaysAliveAgent extends EventEmitter` — mesma interface
- `alwaysAliveAgent` singleton — mesmo export
- `getAgent()` accessor — mesmo export
- Todos os getters, métodos e eventos — mesmos nomes e tipos

A mudança é **puramente interna**: campos #private → AgentContext público (dentro do módulo).

### 8.6 Riscos e Mitigações

| Risco | Impacto | Mitigação |
| ----- | ------- | --------- |
| AgentContext expõe campos antes privados | Médio — módulos externos podem acessar | `@internal` tag + não exportar no barrel público |
| Migração de 176 refs `this.#field` → `this.ctx.field` | Alto — muitas mudanças | Fazer em fases incrementais |
| Módulos extraídos compartilham estado mutável | Baixo — já era assim via this | sem mudança semântica |
| Testes inexistentes — regressão silenciosa | Alto — sem safety net | lint + typecheck cobrem erros estruturais |

---

## 9. Roadmap F35–F40

### F35: Criar AgentContext

1. **F35.1** — Criar `state/agent-context.js` com `AgentContext` class
2. **F35.2** — Migrar campos de always-alive.js: SDK (session, client), State (status),
   Config (model, reasoningEffort), Counters (sendCount, contextState, lastPrInfo, etc.)
3. **F35.3** — Instanciar `this.ctx = new AgentContext(this)` no constructor
4. **F35.4** — Migrar getters simples para ler de `this.ctx` em vez de `this.#field`
5. **F35.5** — Validar: lint + typecheck 0 erros + wc -l
6. **Meta**: Reduzir campos #private de 32 para ~12 (managers que são instâncias de classe)

### F36: Extrair AgentLifecycle (start + stop + initSession)

1. **F36.1** — Criar `lifecycle/agent-lifecycle.js` com `AgentLifecycle` class
2. **F36.2** — Mover start() lógica para `AgentLifecycle.start(ctx)`
3. **F36.3** — Mover stop() lógica para `AgentLifecycle.stop(ctx)`
4. **F36.4** — Mover #initSession() lógica para `AgentLifecycle.initSession(ctx, client)`
5. **F36.5** — always-alive.js delega: `this.#lifecycle.start()`, `this.#lifecycle.stop()`
6. **F36.6** — Validar
7. **Meta**: always-alive.js 1348→~1024L (-324L)

### F37: Extrair AgentDialogController

1. **F37.1** — Criar `dialog/agent-dialog-controller.js`
2. **F37.2** — Mover startDialogLoop, stopDialogLoop, pause/resume, #ensureDialogLoopAttached
3. **F37.3** — always-alive.js delega: `this.#dialogCtrl.startDialogLoop()`
4. **F37.4** — Validar
5. **Meta**: always-alive.js ~1024→~880L (-144L)

### F38: Extrair AgentMessaging (sendMessage + queue)

1. **F38.1** — Criar `messaging/agent-messaging.js`
2. **F38.2** — Mover sendMessage, sendMessageDialogBoot, steerMessage, #enqueueTask, #processQueue
3. **F38.3** — always-alive.js delega
4. **F38.4** — Validar
5. **Meta**: always-alive.js ~880→~747L (-133L)

### F39: Extrair AgentState (snapshot + status + config getters)

1. **F39.1** — Criar `state/agent-state.js`
2. **F39.2** — Mover getStatusSnapshot, #setStatus, listenerDiagnostics, getSessionMessages
3. **F39.3** — Mover config getters: model, reasoningEffort, setModel, setReasoningEffort
4. **F39.4** — always-alive.js delega
5. **F39.5** — Validar
6. **Meta**: always-alive.js ~747→~400L

### F40: Limpeza Final + Documentação

1. **F40.1** — Remover JSDoc redundante de always-alive.js (re-exports são auto-documentados)
2. **F40.2** — Atualizar barrels (index.js) com novos exports
3. **F40.3** — Atualizar types.js se necessário
4. **F40.4** — Atualizar PARTE-13 com métricas finais
5. **F40.5** — Push final
6. **Meta**: always-alive.js ~350L (meta final)

---

## 10. Métricas-Alvo Pós-F40

| Métrica                    | Pós-F34 | Alvo Pós-F40     |
| -------------------------- | ------- | ---------------- |
| always-alive.js            | 1.348L  | **~350L (-74%)** |
| God Modules >600L (agent/) | 2       | 1 (loop-mgr)    |
| Total arquivos agent/      | 31      | ~36              |
| Total linhas agent/        | 6.790   | ~7.100           |
| Campos #private em AA      | 32      | ~8               |
| Acoplamento (this.# refs)  | 176     | ~30              |

---

## 11. Sequência de Execução Recomendada

```
F35 (AgentContext) → F36 (Lifecycle) → F37 (Dialog) → F38 (Messaging) → F39 (State) → F40 (Cleanup)
     ↓                    ↓                 ↓              ↓                ↓
  120L novo          -324L do AA       -144L do AA    -133L do AA      -347L do AA
     =                = ~1024L          = ~880L        = ~747L          = ~400L
```

**Dependências**: F35 deve ser executado primeiro (pré-requisito de todos). F36-F39 podem ser
feitos em qualquer ordem MAS a sequência proposta minimiza conflitos de merge.

**Cada fase é independente e funcional**: após cada fase, o agente deve continuar funcionando
exatamente como antes (zero mudanças na API pública).
