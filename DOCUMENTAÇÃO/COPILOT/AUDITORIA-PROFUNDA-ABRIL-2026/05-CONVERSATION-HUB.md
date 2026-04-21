# 05-CONVERSATION-HUB — Auditoria do Módulo `conversation-hub/`

**Auditoria Profunda de `src/copilot`** · Abril 2026 **Módulo**: `src/copilot/conversation-hub/`
**Documentado em**: 2026-04-18

---

## 1. Mapa do Módulo

```
conversation-hub/
├── access.js              (ACL/ownership SSOT para hub_session)
├── orchestrator.js        (HubOrchestrator — principal, ~400L)
├── executor.js            (executeSendToLlmB — execução de turn)
├── store.js               (ConversationStore — SQLite abstraction)
├── events.js              (HUB_EVENTS enum)
└── index.js               (barrel)
```

---

## 2. Arquivo: `orchestrator.js` (HubOrchestrator)

### 2.1 Mutex Por Sessão via Promise Chain

```js
sendToLlmB(hubSessionId, message, opts = {}) {
    if (this.#closedSessions.has(hubSessionId)) {
        return Promise.reject(new SessionError(...));
    }
    const prev = this.#inflightBySession.get(hubSessionId) ?? Promise.resolve();
    const next = prev.then(() => {
        // double-check após enfileiramento
        if (this.#closedSessions.has(hubSessionId)) throw ...;
        return this.#executeSendToLlmB(hubSessionId, message, opts);
    });
    // ...
    this.#inflightBySession.set(hubSessionId, tail);
    return next;
}
```

**Positivo**: Padrão de mutex via Promise chain — garante serialização de turns por sessão sem locks
reais.

**Positivo**: Double-check em `#closedSessions` — protege contra race entre `closeSession()` e turn
enfileirado.

### 2.2 `#closedSessions` Set com LRU Simples

```js
if (this.#closedSessions.size >= 1000) {
  const first = this.#closedSessions.values().next().value;
  if (first !== undefined) this.#closedSessions.delete(first);
}
this.#closedSessions.add(hubSessionId);
```

**Positivo**: BUG-P2-09 já corrigido — evita crescimento indefinido do Set.

**Achado**:

| ID             | Sev | Descrição                                                                                                                                                                                                                                                                                                                       |
| -------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAP-HUB-01** | P3  | O cleanup do `#closedSessions` usa a estratégia FIFO simples (remove o primeiro inserido quando > 1000). Em sistemas de muito longa duração, sessões antigas fechadas podem sair do set e ser re-inseridas no `#inflightBySession` se um turn atrasado chegar. Muito improvável em prática, mas Set com TTL seria mais correto. |

### 2.3 Limpeza do `#inflightBySession`

```js
tail
  .then(() => {
    if (this.#inflightBySession.get(hubSessionId) === tail) {
      this.#inflightBySession.delete(hubSessionId);
    }
  })
  .catch((e) => logSwallowed(e, 'hub.orchestrator.inflightCleanup'));
```

**Positivo**: Verifica identidade da Promise antes de limpar — evita deletar entry de outra operação
subsequente.

### 2.4 `destroy()` vs Pendências em Voo

> **Status de execução (2026-04-17): mitigado no código.** O `HubOrchestrator` agora entra em estado
> `#destroyed`, bloqueia chamadas tardias e adia o teardown final até `Promise.allSettled(...)` das
> operações inflight.

```js
destroy() {
    this.#bridge = null;
    this.#turnCounters.clear();
    this.#inflightBySession.clear();
    this.#closedSessions.clear();
    this.removeAllListeners();
}
```

| ID             | Sev | Descrição                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **GAP-HUB-02** | P2  | `destroy()` limpa `#inflightBySession` imediatamente, mas Promises em voo ainda executam via `#executeSendToLlmB()`. Se `this.#bridge` for setado para `null` enquanto um `#executeSendToLlmB` ainda está rodando, a execução falha com erro não descritivo de `null` access. Correto: aguardar todas as promises inflight antes de `null`-ificar `#bridge`. |

---

## 3. Arquivo: `access.js` (ACL/ownership SSOT)

> **Status de execução (2026-04-17): novo hardening introduzido no código.**

O módulo `conversation-hub/access.js` agora concentra a autorização por sessão usada pelo transporte
Socket.IO.

### O que ele faz

- normaliza claims JWT em um principal (`sub`, `roles`, `scopes`, grants explícitos por
  `hubSessionId`);
- faz parse resiliente de `metadata` da `hub_session`;
- deriva ACL de sessão (`ownerIds`, `viewerIds`, `editorIds`, `sharedRead`, `sharedWrite`);
- aplica política fail-closed para sessões system-managed sem grant explícito.

### Impacto arquitetural

Antes, a validação no socket distinguia apenas **token válido** de **token inválido**. Agora há
separação explícita entre:

1. **autenticação de transporte** (JWT válido);
2. **autorização de domínio** (pode ler/escrever nesta `hub_session` específica).

Isso reduz o acoplamento entre transport layer e regras de ownership e cria uma SSOT reutilizável
para futuras rotas HTTP com identidade de usuário real.

---

## 4. Arquivo: `store.js` (ConversationStore)

Não lido integralmente. Baseado em referências indiretas:

- `#store.createHubSession()` — cria sessão no SQLite
- `#store.writeHubTurn()` — persiste turn
- `#store.closeHubSession()` — marca como closed
- `#store.injectUserMessage()` — inject assíncrono

| ID             | Sev | Descrição                                                                                                                                                                                                                              |
| -------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAP-HUB-03** | P2  | `store.injectUserMessage()` era `async` fora do mutex do orchestrator, permitindo interleaving de writes com `sendToLlmB()`; **mitigado em 2026-04-17** com serialização de mutações por `hubSessionId` dentro do `ConversationStore`. |

---

## 5. Resumo de Achados do Módulo Conversation Hub

| ID         | Severidade | Arquivo                                 | Descrição                                                                                                                                    |
| ---------- | ---------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| GAP-HUB-02 | P2         | `orchestrator.js`                       | `destroy()` null-ifica bridge enquanto promises inflight ainda usam — **mitigado em 2026-04-17 com teardown adiado e guarda `#destroyed`**   |
| GAP-HUB-03 | P2         | `orchestrator.js` + `store.js`          | `injectUserMessage` fora do mutex — **mitigado em 2026-04-17 com fila de writes por sessão no `ConversationStore`**                          |
| CAT-002    | P2         | `access.js` + `server/socket/hub-ns.js` | autenticação de socket sem autorização por sessão — **mitigado em 2026-04-17 com ACL por `hub_session`, grants por token e gating de emits** |
| CAT-004    | P2         | `orchestrator.js`                       | `#closedSessions` parcial — zombie turns podem escapar (mencionado no catálogo anterior)                                                     |
| GAP-HUB-01 | P3         | `orchestrator.js`                       | FIFO de 1000 entries não é TTL-based — reentrada possível em uso extremo                                                                     |

### Severidade Geral do Módulo: **P2 (Médio-Alto)**

O mutex por sessão é bem implementado. Os gaps são em edge cases de shutdown e write concurrency.

---

_Próximo: [06-CORE.md](./06-CORE.md)_
