# Auditoria Individual — `agent/message-queue.js`

> Gerado como parte da Macro-Fase II do Copilot Full Audit (F05-11).

---

## 1. Identificação

| Campo       | Valor                                |
| ----------- | ------------------------------------ |
| **Arquivo** | `src/copilot/agent/message-queue.js` |
| **Módulo**  | `agent/`                             |
| **LOC**     | 212                                  |
| **Fase**    | F05-11                               |

---

## 2. Propósito e Responsabilidade

Fila de tarefas (`AgentTask[]`) com suporte a AbortSignal, verificação de capacidade máxima
(`MAX_QUEUE_SIZE`), draining no shutdown. Extraída de always-alive.js para isolar o ciclo de vida da
fila. Não implementa processamento — apenas FIFO com callbacks.

---

## 3. API Pública (Exports)

| Export         | Tipo     | Descrição curta                           |
| -------------- | -------- | ----------------------------------------- |
| `MessageQueue` | class    | Fila FIFO com enqueue/shift/unshift/drain |
| `AgentTask`    | @typedef | Typedef da tarefa de envio de mensagem    |

---

## 4. Dependências (Imports)

| Import                          | Via barrel? | Módulo origem  |
| ------------------------------- | ----------- | -------------- |
| `#copilot/core/constants`       | ✅ alias    | core/          |
| `#copilot/core/errors`          | ✅ alias    | core/          |
| `#copilot/observability/logger` | ❌ bypass   | observability/ |

- **Barrel bypasses**: 1 (logger)
- **SDK direto**: Não (AgentTask typedef refs SDK para MessageOptions.attachments mas como
  type-only)

---

## 5. Estado Interno

| Variável     | Tipo        | Mutable? | TTL/Cleanup? |
| ------------ | ----------- | -------- | ------------ |
| `#items`     | AgentTask[] | Sim      | ✅ drain()   |
| `#onEnqueue` | Function?   | Não      | N/A          |
| `#onChanged` | Function?   | Não      | N/A          |

---

## 6. Achados (Questões Formais)

### BUG-AGENT-007 — `abort` listener em `enqueue()` nunca removido se tarefa é processada normalmente

- **Severidade**: P3
- **Arquivo**: `src/copilot/agent/message-queue.js`#L127-L140
- **Descrição**: O `signal.addEventListener('abort', handler, {once: true})` é registrado quando a
  tarefa é enfileirada. Se a tarefa é processada normalmente (via `shift()`), o handler permanece no
  AbortSignal. Se o AbortSignal disparar posteriormente (e.g., timeout externo), o handler tenta
  `splice` um item que já não está na fila — `indexOf` retorna -1, splice é no-op, mas
  `task.reject()` é chamado em uma tarefa que já teve `resolve()` chamado.
- **Cenário de manifestação**: Se o caller mantém referência ao AbortController após a tarefa ser
  processada e depois cancela o controller, `reject()` é chamado após `resolve()` — sem efeito
  prático (Promise já settled), mas logicamente incorreto e pode gerar log misleading.
- **Proposta de correção**: Marcar a tarefa como processada (`task._consumed = true`) e verificar no
  abort handler, ou remover o listener no `shift()`.
- **Impacto se não corrigido**: Baixo — Promise já settled ignora segundo settle.

### GAP-AGENT-006 — `drain()` cria cópias superficiais de Error com `Object.assign` + `Object.create`

- **Severidade**: P4
- **Arquivo**: `src/copilot/agent/message-queue.js`#L185-L192
- **Descrição**: A lógica de cópia de erro em `drain()` é complexa: usa
  `Object.create(Object.getPrototypeOf(err))` para preservar a cadeia de protótipos, mas isso não
  funciona bem com classes custom que têm campos privados (como `SessionError`). Em SessionErrors
  com `#code` privado, a cópia não terá acesso ao campo privado.
- **Proposta de correção**: Simplificar para `new Error(err.message)` ou usar o constructor da
  classe se disponível: `new err.constructor(err.message, err.code)`.
- **Impacto se não corrigido**: Baixo — na prática, `err.constructor === Error` para o caso padrão.

---

## 7. Pontuação de Saúde

| Dimensão            | Score (0-10) | Justificativa                                 |
| ------------------- | ------------ | --------------------------------------------- |
| Contratos (tipos)   | 9            | JSDoc completo, typedefs claros               |
| Error handling      | 7            | abort handler issue; drain clone complexo     |
| Segurança           | 10           | Sem superfície                                |
| Performance         | 9            | O(n) splice aceitável para MAX_QUEUE_SIZE≤100 |
| Testabilidade       | 8            | Boa DI via callbacks; sem spec dedicado       |
| Manutenibilidade    | 8            | 212 LOC, single-purpose, bem documentado      |
| **Média ponderada** | **8.5**      | **(9×2 + 10×2 + 7+9+8+8) / 8 ≈ 8.5**          |

---

## 8. Conexão Arquitetural

- **Camada**: Layer 5 — Orchestration (infraestrutura do agente)
- **Padrão**: FIFO Queue com DI callbacks — clean architecture
- **Conformidade AS-IS→TO-BE**: ✅ Boa separação de concerns; corrigiu SEC-AGENT-001 (bounded queue)
