# Auditoria: hooks/user-input.js

**ID de rastreamento**: F06-13 **Arquivo**: `src/copilot/hooks/user-input.js` **LOC**: 170
**Módulo**: hooks/ **Data**: 2026-04-03 **Auditor**: MF-II Copilot Full Audit

---

## 1. Metadados

| Campo       | Valor                             |
| ----------- | --------------------------------- |
| Caminho     | `src/copilot/hooks/user-input.js` |
| Módulo pai  | `#copilot/hooks`                  |
| Exportações | 3 funções públicas                |
| Importações | `node:readline`, logger           |

---

## 2. Contexto no Módulo

Implementa o **Gap 5** (`onUserInputRequest`): resposta programática a prompts de input do SDK.
Oferece três estratégias: readline interativo (humano), fila programática (orquestração) e respostas
estáticas (mock/teste).

---

## 3. Análise Estrutural

### 3.1 createReadlineInputHandler

```js
export function createReadlineInputHandler() {
  return async function onUserInputRequest(input) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // ... pergunta via rl.question()
    rl.close();
    return { response: answer };
  };
}
```

Nova instância `rl` a cada chamada. Para o uso esperado (1 call por prompt) é aceitável. Se chamado
em alta frequência, poderia acumular file descriptors antes do GC fechar. ✅ (risco baixo em prod
real).

### 3.2 createQueuedInputHandler — fila unbounded

```js
export function createQueuedInputHandler() {
  /** @type {string[]} */
  const queue = []; // sem limite de tamanho!

  function enqueue(answer) {
    queue.push(answer); // pode crescer indefinidamente
  }

  async function onUserInputRequest() {
    if (queue.length > 0) return { response: queue.shift() };
    return { response: '' }; // fila vazia → resposta vazia silenciosa
  }

  return { onUserInputRequest, enqueue };
}
```

**BUG-UI-001**: Fila sem limite máximo — em cenário de orquestração onde `enqueue()` é chamado sem
consumo correspondente, a fila cresce indefinidamente. Sem timeout para requests aguardando.

**BUG-UI-002**: Fila vazia retorna `{ response: '' }` silenciosamente — não há sinal de que o
sistema ficou sem respostas. O SDK pode interpretar resposta vazia como input válido e avançar com
dados incorretos.

---

## 4. Issues Encontrados

| ID         | Tipo | Sev | Descrição                                                              |
| ---------- | ---- | --- | ---------------------------------------------------------------------- |
| BUG-UI-001 | BUG  | P3  | Queue cres unbounded — sem maxSize **[FIXED]**                         |
| BUG-UI-002 | BUG  | P3  | Fila vazia retorna '' silenciosamente em vez de erro/await **[FIXED]** |

---

## 5. Propostas de Correção

```js
export function createQueuedInputHandler({ maxSize = 1000 } = {}) {
  const queue = [];
  function enqueue(answer) {
    if (queue.length >= maxSize) throw new Error('Queue overflow');
    queue.push(answer);
  }
  async function onUserInputRequest() {
    if (queue.length === 0) {
      log('WARN', '[user-input] queue empty — returning empty response');
    }
    return { response: queue.shift() ?? '' };
  }
  return { onUserInputRequest, enqueue };
}
```

---

## 6. Pontuação de Saúde

| Dimensão         | Nota    | Justificativa                  |
| ---------------- | ------- | ------------------------------ |
| Corretude        | 7.0     | Falha silenciosa em fila vazia |
| Segurança        | 8.0     | Sem issues de segurança direta |
| Arquitetura      | 8.5     | 3 estratégias bem separadas    |
| Manutenibilidade | 8.5     | Código legível                 |
| Performance      | 7.5     | Fila unbounded                 |
| Testabilidade    | 9.0     | Bem testável                   |
| **Média**        | **8.1** |                                |
