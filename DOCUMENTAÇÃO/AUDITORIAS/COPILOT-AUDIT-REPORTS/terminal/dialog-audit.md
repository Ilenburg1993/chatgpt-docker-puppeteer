# Auditoria — `dialog.js`

**Módulo**: `src/copilot/terminal/dialog.js` **LOC**: 615 **Data**: 2026-06-10 **Auditor**: Copilot
Full-Audit MF-II

---

## 1. Propósito

Motor central do dialogue loop do Terminal Permanente LLM-B. Responsável por:

- Garantir que o dialog loop está ativo (`ensureDialogLoop`, DL-PERM-02)
- Serializar chamadas concorrentes via fila Promise-chain (`sendTurn`, TERM-01)
- Transmitir eventos via SSE + Socket.io (`broadcastSse`)
- Renderizar output no stdout com formatação rica (`println`, `printExchange`)

---

## 2. Arquitetura

```
sendTurn(message, actor)
 └── backpressure (MAX_TURN_QUEUE_SIZE=10)
 └── _sendTurnMutex (Promise-chain) → _executeTurn()
      ├── ensureDialogLoop()           ← DL-PERM-02 coalescimento
      ├── file embed + plan prefix     ← ATT-04
      ├── llmBridgeClient.dialogTurn() ← await com timeout
      ├── conversationHub.store.writeTurn() ← persist hub
      └── broadcastSse('reply', ...)   ← SSE + Socket.io

broadcastSse(event, data)
 ├── emitSse(clients, criticalClients, event, safeData)
 └── emitSocket(ns, hubSessionId, event, safeData)
```

---

## 3. Achados

### FINDING-P4-1 — Polling loop em `_tryStartDialogLoop` não encerra após rejeição **[FIXED]**

**Severidade**: P4 — Médio **→ CORRIGIDO**

**Status**: O código atual usa `_doEnsureDialogLoop` com retry bounded (MAX_RETRIES=3) e exponential
backoff (2s/4s/8s). A função `_tryStartDialogLoop` usa flag `_cancelled` e clearTimeout para
garantir cleanup correto após timeout. Não há polling indefinido.

**Descrição original (histórico):** **Localização**: `_tryStartDialogLoop()` linhas ~335-370

```js
const timeout = setTimeout(() => reject(new Error('Timeout...')), 30_000);
const check = () => {
    const s = alwaysAliveAgent.status;
    if (s === 'idle') { clearTimeout(timeout); resolve(undefined); }
    else if (s === 'stopped') { clearTimeout(timeout); reject(new Error(...)); }
    else { setTimeout(check, 500); }  // ← continua mesmo após reject()
};
```

Se o `timeout` de 30s disparar (chamando `reject()`), o `check()` agendado em 500ms ainda irá rodar.
Se o status nunca mudar para `'idle'` ou `'stopped'`, o polling continuará indefinidamente até o fim
do processo, consumindo recursos e potencialmente chamando `resolve()`/`reject()` em uma Promise já
resolvida (harmless) mas causando confusão.

**Proposta**: usar flag de cancelamento explícita:

```js
let cancelled = false;
const timeout = setTimeout(() => { cancelled = true; reject(new Error(...)); }, 30_000);
const check = () => {
    if (cancelled) return;
    // ...
};
```

---

### FINDING-P4-2 — `_executeTurn` errors silenciados via `.catch(() => null)` no mutex **[N/A]**

**Severidade**: P4 — Médio **→ N/A (intencional)**

**Status**: O `.catch(() => null)` é intencional para não travar a fila de mutex. Erros são logados
dentro de `_executeTurn` via `log('ERROR', ...)` ANTES do catch. O caller recebe `null` como
convenção de erro e a observabilidade está mantida.

**Descrição original (histórico):** **Localização**: `sendTurn()` linha ~450

```js
const next = _sendTurnMutex.then(() => _executeTurn(message, actor)).catch(() => null);
_sendTurnMutex = next.then(
  () => null,
  () => null,
);
```

O `.catch(() => null)` no `next` descarta a causa real da rejeição. Para o caller, receber `null`
indica erro genérico, o que é documentado. Mas para debug/observabilidade, o erro é perdido. O
`_executeTurn` já trata internamente a maioria dos erros com `log('ERROR', ...)`, então o duplo
catch é redundante.

---

### FINDING-P4-3 — SSE: clientes mortos detectados apenas na próxima escrita **[N/A]**

**Severidade**: P4 — Baixo **→ N/A (design correto)**

**Status**: Design padrão para SSE em Node.js. `req.on('close', ...)` em `server.js` faz cleanup do
caso principal. O `try/catch` em `emitSse` detecta clientes mortos no próximo write. Acumulação é
risco marginal apenas com proxies mal-comportados em operação contínua de longa duração.

**Descrição original (histórico):** **Localização**: `emitSse()` linhas ~265-290

```js
for (const client of clients) {
  try {
    client.write(payload);
  } catch {
    clients.delete(client); // detecta só na escrita que falha
  }
}
```

Clientes que fecham a conexão silenciosamente (sem evento `close`) — e.g., keepalive com proxy que
não forwarda FIN — acumulam no `Set`. Isso é correto para a maioria dos clientes, mas em modo
headless de longa duração pode crescer. O evento `req.on('close', ...)` em `server.js` faz cleanup
correto para o caso principal — o risco real é apenas com proxies mal-comportados.

---

### FINDING-P5-4 — `MAX_SSE_CONTENT_CHARS = 64_000` inline em `broadcastSse`

**Severidade**: P5 — Cosmético **Localização**: `broadcastSse()` linhas ~230-240

A constante de truncamento SSE (64k chars) está definida inline dentro da função, não exportada.
`MAX_EMBED_BYTES` em `file-context.js` é equivalente (65_536 bytes ≈ 64k chars). Idealmente ambas
deveriam compartilhar uma constante de `../core/constants.js`.

---

## 4. Pontos positivos

- **TERM-01** (Promise-chain mutex): serialização elegante de turnos concorrentes sem locks.
- **DL-PERM-02** (coalescimento): `_ensureDialogLoopInFlight` previne boots duplos em race.
- **BUG-N05** (retry com backoff): 3 retries 2s/4s/8s em `_doEnsureDialogLoop`.
- **BUG-N11** (auto-restart pós-erro): `setTimeout(() => ensureDialogLoop(), 2000)` correto.
- **SEC-VULN-02**: sanitização do event name SSE (`replace(/[\r\n]/g, '_')`) previne injeção.
- **BUG-N06**: `hubSessionId` incluído no payload SSE para consistência com Socket.io.
- **PERF-N06**: reset do mutex chain quando `_turnQueueDepth === 0` — previne acúmulo de .then().
- **ATT-04**: `embedMultiple` + `PLAN_PREFIX` antes de `dialogTurn` — zero-PR para attachments.

---

## 5. Score

| Dimensão                        | Nota       |
| ------------------------------- | ---------- |
| Correção lógica                 | 9/10       |
| Robustez (retry, coalescimento) | 9.5/10     |
| Segurança (SSE injection fix)   | 9/10       |
| Observabilidade                 | 9/10       |
| **Global**                      | **9.1/10** |

---

## 6. Status de Correção

### [FIXED] FINDING-P5-4 (T-29) — `MAX_SSE_CONTENT_CHARS` inline

A constante `MAX_SSE_CONTENT_CHARS = 64_000` foi movida para `core/constants.js` como exportação
configurável via env var `MAX_SSE_CONTENT_CHARS`. `dialog.js` agora importa a constante de
`'../core/constants.js'` — eliminando a duplicação e tornando-a ajustável sem alteração de código.

**Pontuação atualizada: 9.0/10**

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
