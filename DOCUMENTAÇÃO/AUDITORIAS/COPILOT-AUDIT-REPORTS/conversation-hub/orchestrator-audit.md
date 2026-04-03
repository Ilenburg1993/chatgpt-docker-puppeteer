# Auditoria — `orchestrator.js`

**Módulo**: `src/copilot/conversation-hub/orchestrator.js` **LOC**: 646 **Data**: 2026-06-10
**Auditor**: Copilot Full-Audit MF-II

---

## 1. Propósito

`HubOrchestrator` gerencia o diálogo entre LLM-A e LLM-B: serializa chamadas por sessão, persiste
cada turno no `ConversationStore`, e emite eventos em tempo real (EventEmitter). Suporta três modos
de execução: Dialog Loop (preferido), Structured Chat, Simple Chat (fallback).

---

## 2. Arquitetura

```
sendToLlmB(hubSessionId, message, opts)
  ├── Mutex por sessão: #inflightBySession (Promise chain)
  ├── Verificação dupla de sessão fechada
  └── #executeSendToLlmB()
        ├── writeTurn(role='llm_a')   → emite 'turn:sent'
        ├── Seleciona modo de execução:
        │   ├── dialogLoopActive → #callViaDialogLoop (sendDialogTurn + task.delta listener)
        │   ├── useStructured + object → #callViaStructured (chatStructured)
        │   └── fallback → #callViaSimpleChat (chat) [WARN logado]
        ├── On error: writeTurn(role='llm_b', [ERRO])
        └── writeTurn(role='llm_b') → emite 'turn:complete'
```

---

## 3. Achados

### FINDING-P5-1 — `setFallbackAgent` é estado module-level não resetado entre testes

**Severidade**: P5 — Baixo **Localização**: `setFallbackAgent()` linha ~47

```js
let _fallbackAgent = null;
export function setFallbackAgent(agent) {
  _fallbackAgent = agent;
}
```

Estado module-level compartilhado entre instâncias do `HubOrchestrator` em testes. Se um teste
chamar `setFallbackAgent(mockAgent)` sem limpeza, o próximo teste herda o agent mockado.

**Proposta**: exportar `_resetFallbackAgent()` para uso em `afterEach`:

```js
export function _resetFallbackAgent() {
  _fallbackAgent = null;
}
```

---

### FINDING-P5-2 — Seleção de modo `#callViaSimpleChat` aciona WARN em casos legítimos

**Severidade**: P5 — Cosmético **Localização**: `#executeSendToLlmB` linhas ~430-440

Quando `opts.useStructured=true` (default) e `message` é uma `string` (não objeto), o código cai
diretamente no path `#callViaSimpleChat` e loga `WARN`. Isso ocorre em casos legítimos onde LLM-A
envia mensagens de texto simples sem intenção de usar StructuredMessage, gerando logs de warning
espúrios.

---

## 4. Pontos Positivos

- **Mutex por sessão** via Promise chain (`#inflightBySession`): elegante, sem lib externa.
- **F6.5/BUG-MOD-09**: `#closedSessions` previne re-inserção zombie + limitado a 1000 entradas.
- **ARCH-03**: lazy resolution de `alwaysAliveAgent` via `setFallbackAgent` — quebra ciclo de
  imports.
- **BUG-HIGH-03**: `task.delta` listener em `#callViaDialogLoop` para streaming em tempo real.
- Turn counter restaurado de DB no `init()` — continuidade após restart.
- Erro de LLM-B sempre persiste um turn `[ERRO]` — histórico completo mesmo em falhas.
- `destroy()` limpa todos os recursos: bridge, counters, inflight, listeners.

---

## 5. Score

| Dimensão                | Nota       |
| ----------------------- | ---------- |
| Correção do mutex       | 10/10      |
| Resiliência de execução | 9/10       |
| Testabilidade           | 7.5/10     |
| **Global**              | **9.0/10** |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
