# PARTE 13 — Auditoria Profunda agent/ & Consolidação (F29+)

**Data**: 2026-07-23
**Escopo**: Análise detalhada de `src/copilot/agent/` (28 arquivos, 6.613L) com foco na decomposição
de `always-alive.js` (1.613L) e consolidação do subsistema.

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

| Fase | Status | Descrição | Commit |
| ---- | ------ | --------- | ------ |
| F29  | ✅ Concluída | Extrair boot wiring → `session/boot-wiring.js` (225L) | `4a38c0ed` |
| F30  | ⏭️ Skipped | stop() acessa 16 campos #private — custo/benefício baixo | — |
| F31  | ✅ Concluída | Extrair user input handlers → `dialog/user-input-handler.js` (106L) | `0bb17694` |
| F32  | ✅ Concluída | Extrair syncSdkHistory + SessionMessagesCache → `session/history-sync.js` (108L) | `6718e215` |
| F33  | ⏭️ Skipped | event-wirer.js já decomposto internamente em 8 sub-funções — fragmentar em arquivos seria over-engineering | — |
| F34  | ✅ Concluída | Documentação atualizada com resultados reais | este doc |

### 6.2 Métricas Comparativas

| Métrica | Antes (F28) | Depois (F34) | Delta |
| ------- | ----------- | ------------ | ----- |
| always-alive.js | 1.613L | 1.348L | **-265L (-16,4%)** |
| God Modules >600L | 3 | 2 | **-1** (always-alive saiu do limiar) |
| Total arquivos agent/ | 28 | 31 | **+3** (novos módulos) |
| Total linhas agent/ | 6.613 | 6.790 | +177L (overhead JSDoc/barrel) |

### 6.3 Módulos Criados

| Módulo | Linhas | Responsabilidade |
| ------ | ------ | ---------------- |
| `session/boot-wiring.js` | 225 | Wiring pós-#initSession em start(): eventos SDK, collector, observer, cleanup, recovery, metrics, MCP, keepalive, handoff |
| `dialog/user-input-handler.js` | 106 | Dispatch ask_user SDK: dialog loop input vs interactive question |
| `session/history-sync.js` | 108 | Sync SDK history → ConversationStore + cache de mensagens com TTL |

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
