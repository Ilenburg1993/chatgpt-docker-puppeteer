# AUDIT_CONCURRENCY_LLM_B — Auditoria de Concorrência e Serialização de Mensagens para LLM-B

**Data:** 2026-03-27 **Escopo:** `src/copilot/agent/always-alive.js`,
`src/copilot/conversation-hub/orchestrator.js` **Status:** IMPLEMENTADO — CONC-01, CONC-02, CONC-03
**Commit:** pending → aplicado após esta documentação

---

## 1. Motivação

Durante uma sessão permanente (dialog loop), a LLM-B pode receber mensagens de duas origens
distintas:

1. **LLM-A** (`HubOrchestrator.sendToLlmB`) — chamadas programáticas da orquestração
2. **Usuário humano** (`socket-ns.js → injectUserMessage`) — input direto via WebSocket

A investigação foi motivada pela pergunta: _o que acontece quando chegam múltiplas mensagens
simultaneamente? Há fila? Buffer? Serialização?_

---

## 2. Mapeamento do Fluxo (antes das correções)

```
LLM-A chama hub.sendToLlmB(sessionId, msg)
  │
  └─► HubOrchestrator.sendToLlmB()           [SEM mutex — race condition]
        │
        ├─► modo useStructured=true  → LlmBridgeClient.chat()
        │     └─► alwaysAliveAgent.sendMessage() → #queue (serializado ✓)
        │
        └─► modo useStructured=false → alwaysAliveAgent.sendDialogTurn()
              └─► #pendingQuestion.resolve(message)   [SEM mutex — RACE CONDITION ✗]

Usuário → socket user:inject → HubOrchestrator.injectUserMessage()
  └─► store.injectUserMessage() (SQLite)      [persiste]
  └─► emit('user:injected')                   [evento emitido]
  └─► (nada mais — LLM-A devia fazer poll manual)  [gap de notificação ✗]
```

**Caminho do LlmBridgeClient** (modo useStructured=true):

```
LlmBridgeClient.chat(msg)
  └─► AlwaysAliveAgent.sendMessage() → #queue.enqueue()   [fila com serialização ✓]
        └─► session.sendAndWait()
```

---

## 3. Bugs Identificados

### BUG-A — Race condition em `sendDialogTurn` (CRÍTICO)

**Localização:** `src/copilot/agent/always-alive.js` **Severidade:** Alta **Efeito:** Mensagem
silenciosamente perdida ou resposta dirigida ao caller errado

**Causa:** `sendDialogTurn` operava diretamente sobre `#pendingQuestion` sem qualquer forma de
exclusão mútua. Se dois callers invocassem `sendDialogTurn` concorrentemente:

1. Caller A e Caller B ambos verificam `#pendingQuestion !== null` — ambos passam
2. Caller A chama `this.answerPendingQuestion(messageA)`
3. Caller B chama `this.answerPendingQuestion(messageB)` — o SDK recebe apenas a segunda mensagem
4. `#pendingQuestion` vira `null` na primeira chamada; a segunda pode lançar ou ser ignorada
5. A Promise do Caller A nunca resolve (timeout)

```js
// ANTES — sem proteção
sendDialogTurn(message, { timeout = 60_000, signal } = {}) {
    if (!this.#dialogLoopActive) { ... }
    // ← NENHUMA EXCLUSÃO MÚTUA AQUI
    return new Promise((resolve, reject) => {
        // ... manipula #pendingQuestion diretamente
    });
}
```

### BUG-B — Chamadas concorrentes em `HubOrchestrator.sendToLlmB` (ALTO)

**Localização:** `src/copilot/conversation-hub/orchestrator.js` **Severidade:** Alta **Efeito:**
Turns com números errados, respostas trocadas, store inconsistente

**Causa:** `sendToLlmB` não impedia que duas chamadas com o mesmo `hubSessionId` acontecessem de
forma simultânea. Em caso de múltiplos callers concorrentes (ex: timer automático + mensagem do
usuário):

1. Ambas as chamadas lêem `turnNumber = store.getCurrentTurnNumber()` → mesmo valor
2. Ambas persistem `llm_a` com o mesmo `turnNumber` → colisão no store
3. A segunda chamada sobrescrevia a resposta da primeira no `sendDialogTurn`

### GAP-C — Ausência de notificação push `turn:user_pending` (MÉDIO)

**Localização:** `HubOrchestrator.injectUserMessage()` **Severidade:** Média **Efeito:** LLM-A não
sabia em tempo real quando o usuário injetou mensagem durante turn ativo

**Causa:** `injectUserMessage` persistia a mensagem no SQLite e emitia `user:injected`, mas não
distinguia se havia um turn em andamento. LLM-A precisava fazer `pollUserMessages` manualmente e
poderia perder a janela ideal de resposta.

### GAP-D — Ausência de sistema de prioridade (FUTURO)

Mensagens do usuário humano não têm prioridade sobre mensagens programáticas de LLM-A. Se LLM-A está
em diálogo contínuo, o usuário precisa esperar a fila drenar.

**Mitigação futura:** Priority queue ou mecanismo de interrupt.

### GAP-E — Ausência de backpressure em `sendDialogTurn` (FUTURO)

A fila pode crescer sem limite se o modelo demorar e os callers continuarem enfileirando.

**Mitigação futura:** `MAX_DIALOG_QUEUE_SIZE` com rejeição quando excedido.

---

## 4. Soluções Implementadas

### CONC-01 — Mutex de diálogo em `sendDialogTurn` (always-alive.js)

**Técnica:** Promise-chain mutex (`#dialogTurnMutex: Promise<any>`)

```js
/** CONC-01: mutex para serializar chamadas concorrentes a sendDialogTurn(). */
#dialogTurnMutex = Promise.resolve();

sendDialogTurn(message, { timeout = 60_000, signal } = {}) {
    if (!this.#dialogLoopActive) {
        return Promise.reject(new SessionError(...));
    }
    if (signal?.aborted) {
        return Promise.reject(new DOMException('...', 'AbortError'));
    }
    // Encadeia na cauda — serializa execução
    const prev = this.#dialogTurnMutex;
    const next = prev.then(() =>
        this.#executeDialogTurn(message, { timeout, ...(signal ? { signal } : {}) })
    );
    // Atualiza mutex ignorando rejeições (não bloqueia fila em caso de erro)
    this.#dialogTurnMutex = next.catch(() => {});
    return next;
}
```

**Garantias:**

- Apenas um `#executeDialogTurn` executa por vez
- Rejeições não bloqueiam a fila (`.catch(() => {})` na cauda do mutex)
- AbortSignal é checado **antes** de entrar na fila (fail-fast)
- `#dialogLoopActive` é checado **antes** de entrar na fila

**Ref:** `#executeDialogTurn` contém toda a lógica original (`startSpan`, `#pendingQuestion`,
listeners, etc.)

### CONC-02 — Mutex por sessão em `sendToLlmB` (orchestrator.js)

**Técnica:** `Map<hubSessionId, Promise<void>>` com Promise-chain por sessão

```js
/** CONC-02: mutex por sessão para serializar sendToLlmB(). */
#inflightBySession = new Map();

sendToLlmB(hubSessionId, message, opts = {}) {
    const prev = this.#inflightBySession.get(hubSessionId) ?? Promise.resolve();
    const next = prev.then(() => this.#executeSendToLlmB(hubSessionId, message, opts));
    const tail = next.then(() => {}).catch(() => {});
    this.#inflightBySession.set(hubSessionId, tail);
    // Auto-limpeza: remove da Map quando fila vaziar
    void tail.then(() => {
        if (this.#inflightBySession.get(hubSessionId) === tail) {
            this.#inflightBySession.delete(hubSessionId);
        }
    });
    return next;
}
```

**Garantias:**

- Serialização **por sessão** — sessões diferentes não se bloqueiam mutuamente
- Auto-limpeza da Map quando a fila de uma sessão esvazia (sem memory leak)
- Cleanup explícito em `closeSession()` e `destroy()`
- Rejeições não bloqueiam a fila da sessão

### CONC-03 — Notificação `turn:user_pending` (orchestrator.js)

**Técnica:** Emissão condicional de evento quando turn ativo

```js
injectUserMessage(hubSessionId, content, opts = {}) {
    const turnId = this.#store.injectUserMessage(hubSessionId, content, opts);
    this.emit('user:injected', { hubSessionId, turnId, content });
    if (this.#inflightBySession.has(hubSessionId)) {
        this.emit('turn:user_pending', { hubSessionId, turnId, content });
    }
    return turnId;
}
```

**Garantias:**

- LLM-A recebe notificação imediata quando usuário injeta durante turn ativo
- Evento inclui `turnId` para rastreabilidade
- Sem polling necessário — push notification

---

## 5. Propriedades do Mutex Implementado

| Propriedade               | CONC-01                      | CONC-02                       |
| ------------------------- | ---------------------------- | ----------------------------- |
| Tipo                      | Promise-chain                | Promise-chain por Map key     |
| Escopo                    | AlwaysAliveAgent (singleton) | Por `hubSessionId`            |
| Rejeições bloqueiam fila? | Não                          | Não                           |
| Memory leak?              | Não (field única)            | Não (auto-limpeza)            |
| Cleanup explícito?        | Não necessário               | `closeSession()`, `destroy()` |
| Starvation?               | Não (FIFO)                   | Não (FIFO por sessão)         |

---

## 6. Diagrama de Fluxo Corrigido

```
LLM-A: sendToLlmB(S, msg1)   ─┐
LLM-A: sendToLlmB(S, msg2)   ─┤  #inflightBySession[S]
LLM-A: sendToLlmB(S, msg3)   ─┘  promise chain → serial execution
                                    │
                              ┌─────▼────────────────────────┐
                              │  #executeSendToLlmB(S, msg1)  │ executa
                              └─────┬────────────────────────┘
                                    │ resolve
                              ┌─────▼────────────────────────┐
                              │  #executeSendToLlmB(S, msg2)  │ executa
                              └─────┬────────────────────────┘
                                    │ resolve
                              ┌─────▼────────────────────────┐
                              │  #executeSendToLlmB(S, msg3)  │ executa
                              └──────────────────────────────┘

AlwaysAliveAgent.sendDialogTurn(msg1)  ─┐
AlwaysAliveAgent.sendDialogTurn(msg2)  ─┤  #dialogTurnMutex chain → serial
                                         │
                                  ┌──────▼──────────────────────┐
                                  │  #executeDialogTurn(msg1)    │ executa
                                  └──────┬──────────────────────┘
                                         │ resolve
                                  ┌──────▼──────────────────────┐
                                  │  #executeDialogTurn(msg2)    │ executa
                                  └─────────────────────────────┘
```

---

## 7. Testes Adicionados

### `test_hub_orchestrator.spec.js`

**Novo describe:** `HubOrchestrator.sendToLlmB serialização`

| Teste                                                                           | Verifica                                                                           |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `chamadas concorrentes para a mesma sessão executam em sequência`               | 3 `sendToLlmB` concorrentes na mesma sessão → order = [1, 2, 3] (FIFO)             |
| `emite turn:user_pending quando usuário injeta enquanto turn está em andamento` | `injectUserMessage` emite `turn:user_pending` quando `#inflightBySession.has(sid)` |

### `test_always_alive_dialog_loop.spec.js`

**Novos testes no describe `always-alive › dialog loop: protocolo 0-PR`:**

| Teste                                                             | Verifica                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------- |
| `#dialogTurnMutex é declarado como campo privado`                 | Campo `#dialogTurnMutex` existe no source               |
| `#executeDialogTurn é declarado como método privado`              | Método `#executeDialogTurn` existe                      |
| `sendDialogTurn() encadeia no #dialogTurnMutex antes de executar` | Pattern `this.#dialogTurnMutex` + `prev.then` presentes |

---

## 8. Gaps Não Resolvidos

| ID    | Descrição                                | Impacto                                                | Prioridade |
| ----- | ---------------------------------------- | ------------------------------------------------------ | ---------- |
| GAP-D | Sem prioridade para mensagens do usuário | Alto — usuário pode esperar demais em diálogo contínuo | Média      |
| GAP-E | Sem backpressure em `sendDialogTurn`     | Alto — fila ilimitada em caso de sobrecarga            | Baixa      |

---

## 9. Arquivos Modificados

| Arquivo                                                    | Mudança                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/copilot/agent/always-alive.js`                        | CONC-01: `#dialogTurnMutex`, `#executeDialogTurn` extraído                                 |
| `src/copilot/conversation-hub/orchestrator.js`             | CONC-02: `#inflightBySession`, `#executeSendToLlmB` extraído; CONC-03: `turn:user_pending` |
| `tests/unit/copilot/test_hub_orchestrator.spec.js`         | +2 testes de serialização                                                                  |
| `tests/unit/copilot/test_always_alive_dialog_loop.spec.js` | +3 testes estruturais do mutex                                                             |

---

## 10. Referências

- `src/copilot/agent/always-alive.js` — impl `#dialogTurnMutex`, `sendDialogTurn`,
  `#executeDialogTurn`
- `src/copilot/conversation-hub/orchestrator.js` — impl `#inflightBySession`, `sendToLlmB`,
  `#executeSendToLlmB`, `injectUserMessage` com `turn:user_pending`
- `DOCUMENTAÇÃO/AUDITORIAS/AUDIT_SRC_COPILOT_V2.md` — UPG-01..UPG-06 (contexto anterior)
