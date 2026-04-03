# Auditoria — `hub.js`

**Módulo**: `src/copilot/conversation-hub/hub.js` **LOC**: 262 **Data**: 2026-06-10 **Auditor**:
Copilot Full-Audit MF-II

---

## 1. Propósito

Facade singleton (`conversationHub`) que compõe os três subsistemas do ambiente permanente LLM-A ↔
LLM-B ↔ Usuário:

- `ConversationStore` — persistência SQLite
- `HubOrchestrator` — lógica de diálogo/serialização
- Socket.io namespace `/copilot` — streaming em tempo real

---

## 2. Arquitetura

```
conversationHub.init({ io, nerv })
  ├── conversationStore.init()
  ├── new HubOrchestrator(conversationStore) → orchestrator.init()
  ├── mountCopilotNamespace(io, orchestrator, store)
  └── #bridgeToNerv(nerv) [opcional]

conversationHub.stop()
  ├── orchestrator.destroy()
  └── unmountCopilotNamespace()

conversationHub.close() [gracioso]
  ├── fechar sessões ativas
  └── stop()
```

---

## 3. Achados

### FINDING-P5-1 — `#bridgeToNerv` bridgeia apenas 6 eventos do orchestrator

**Severidade**: P5 — Baixo **Localização**: `#bridgeToNerv()` linhas ~230-245

```js
this.#orchestrator.on('session:created', (d) => emit('copilot.hub.session.created', d));
this.#orchestrator.on('session:closed', (d) => emit('copilot.hub.session.closed', d));
this.#orchestrator.on('turn:sent', (d) => emit('copilot.hub.turn.sent', d));
this.#orchestrator.on('turn:complete', (d) => emit('copilot.hub.turn.complete', d));
this.#orchestrator.on('user:injected', (d) => emit('copilot.hub.user.injected', d));
this.#orchestrator.on('error', (d) => emit('copilot.hub.error', d));
```

O orchestrator emite também `turn:delta` e `turn:user_pending`, que não são encaminhados para NERV.
Clientes NERV não recebem streaming em tempo real dos deltas de texto ou notificações de mensagens
pendentes do usuário.

---

## 4. Pontos Positivos

- `#initialized` flag previne double-init.
- `close()` gracioso: fecha sessões ativas individualmente antes de destruir recursos.
- `ARCH-06`: `unmountCopilotNamespace()` no `stop()` — sem estado inconsistente após restart.
- `orchestrator` getter lança erro informativo quando acessado antes de `init()`.
- Private fields (`#orchestrator`, `#initialized`) — encapsulamento correto com classes.
- JSDoc completo em todos os métodos públicos.

---

## 5. Score

| Dimensão                        | Nota       |
| ------------------------------- | ---------- |
| Design (facade, private fields) | 10/10      |
| Completude do bridge NERV       | 8/10       |
| **Global**                      | **9.0/10** |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
