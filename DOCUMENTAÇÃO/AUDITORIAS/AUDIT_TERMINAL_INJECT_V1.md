# Auditoria: Canal Terminal LLM-B — Serialização, Bypass e Retry

**Data**: 2026-03-25  
**Escopo**: `src/copilot/terminal/dialog.js`, `src/copilot/terminal/http-handlers.js`, `src/copilot/channel/inject.js`  
**Status**: ✅ Implementado e testado (766/766 testes passando)  
**Commit anterior**: `d96a01a9` (CONC-01/02/03)

---

## Contexto

Esta auditoria é continuação de `AUDIT_CONCURRENCY_LLM_B.md`, que corrigiu condições de corrida no
path Hub/in-process (Path A). Esta auditoria cobre o **Path B (Terminal/HTTP)** — a rota direta de
LLM-A → terminal permanente via `POST /inject` na porta 3009.

### Mapa do Path B

```
injectToLlmB()          → POST /inject (porta 3009)
                         → handleInject() em http-handlers.js
                         → sendTurn() em dialog.js          [TERM-01: fila]
                         → _executeTurn()                   [GAP-4: SSE busy]
                         → llmBridgeClient.dialogTurn()
                         → alwaysAliveAgent.sendDialogTurn() [#dialogTurnMutex — CONC-01]
```

---

## Bugs e Gaps Identificados e Corrigidos

### TERM-01 — `sendTurn` rejeitava silenciosamente quando `_busy = true`

**Arquivo**: `src/copilot/terminal/dialog.js`  
**Severidade**: Alta — mensagens de LLM-A e do usuário eram descartadas sem aviso  

**Comportamento anterior**:
```js
export async function sendTurn(message, actor = 'user') {
    if (getBusy()) {
        println('⏳ Aguarde — LLM-B está processando...');
        return null;  // ← DESCARTE SILENCIOSO
    }
    // ...
}
```

Qualquer chamada concorrente a `sendTurn` enquanto um turno estava em andamento resultava em `null`
imediato. O pipeline, LLM-A e o usuário perdiam mensagens sem possibilidade de recuperação.

**Correção implementada** — Promise-chain mutex:
```js
export function sendTurn(message, actor = 'user') {
    // backpressure: rejeita se fila está cheia
    if (_turnQueueDepth >= MAX_TURN_QUEUE_SIZE) return Promise.resolve(null);

    _turnQueueDepth++;
    const next = _sendTurnMutex.then(() => _executeTurn(message, actor)).catch(() => null);
    _sendTurnMutex = next.then(() => null, () => null); // cauda da fila
    void next.finally(() => { _turnQueueDepth--; });
    return next;
}
```

**Propriedades**:
- Chamadas concorrentes são enfileiradas em ordem de chegada (FIFO)
- Nenhuma mensagem é descartada silenciosamente (a menos que a fila esteja cheia)
- Backpressure: `MAX_TURN_QUEUE_SIZE = 10` — acima disso, `null` imediato com log `WARN`
- `_busy` permanece como indicador observável, mas não é mais o gate de decisão
- BUG-3 (pipeline falhava ao chamar `sendTurn` em loop quando busy) resolvido automaticamente
  — o pipeline agora espera na fila em vez de falhar

---

### TERM-02 — `handleInject` com `nativeAttachments` bypassava `_busy`

**Arquivo**: `src/copilot/terminal/http-handlers.js`  
**Severidade**: Alta — possível execução paralela de turnos, violando o invariante de 1 turno ativo  

**Comportamento anterior**:
```js
if (nativeAttachments.length > 0) {
    // sem verificação de getBusy()
    // sem setBusy(true) / setBusy(false)
    reply = await alwaysAliveAgent.sendMessage(enrichedMessage, { attachments: nativeAttachments });
}
```

Quando `inject.js` enviava mensagens com attachments reais (arquivos, imagens), o caminho
`nativeAttachments` ignorava completamente o estado `_busy`, podendo executar em paralelo com um
turno de `sendTurn()`.

**Correção implementada**:
```js
if (nativeAttachments.length > 0) {
    if (getBusy()) {
        return { status: 409, body: { ok: false, reply: null, error: 'LLM-B ocupada' } };
    }
    setBusy(true);
    try {
        reply = await alwaysAliveAgent.sendMessage(enrichedMessage, { attachments: nativeAttachments });
    } finally {
        setBusy(false);
    }
}
```

**Nota**: A 409 neste path será capturada pelo retry automático de `injectToLlmB` (INJECT-01).

---

### GAP-4 — Clientes SSE não recebiam evento `busy` ao iniciar/encerrar turnos

**Arquivo**: `src/copilot/terminal/dialog.js` → `_executeTurn()`  
**Severidade**: Média — ferramentas e dashboards SSE não conseguiam observar estado de processamento  

**Comportamento anterior**: `stateEmitter.emit('busy:changed')` era emitido por `setBusy()`, mas
nenhum evento SSE era transmitido para clientes conectados via `GET /events`.

**Correção implementada** — `broadcastSse` nos pontos de transição:
```js
async function _executeTurn(message, actor) {
    // ...
    setBusy(true);
    broadcastSse('busy', { busy: true, actor });  // ← GAP-4 fix
    // ... processamento ...
    } finally {
        setBusy(false);
        broadcastSse('busy', { busy: false });    // ← GAP-4 fix
    }
}
```

Clientes SSE agora recebem eventos `busy` com payload `{ busy: boolean, actor?: string }`.

---

### INJECT-01 — `injectToLlmB` não fazia retry em 409 (LLM_B_BUSY)

**Arquivo**: `src/copilot/channel/inject.js`  
**Severidade**: Média — LLM-A precisava implementar retry manualmente, ou perdia a mensagem  

**Comportamento anterior**: `injectToLlmB()` lançava `BridgeError('LLM_B_BUSY')` imediatamente
na primeira resposta 409 recebida do terminal.

**Correção implementada** — retry automático com backoff linear:
```js
export async function injectToLlmB(message, opts = {}) {
    const maxRetries = opts.retries ?? 3;        // padrão: 3 tentativas
    const retryDelayMs = opts.retryDelayMs ?? 1_500; // padrão: 1.5s base

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await _doInjectToLlmB(message, opts);
        } catch (err) {
            const isBusy = err?.code === 'LLM_B_BUSY';
            if (isBusy && attempt < maxRetries) {
                await new Promise(r => setTimeout(r, retryDelayMs * (attempt + 1)));
                continue;  // backoff linear: 1.5s, 3s, 4.5s
            }
            throw err;
        }
    }
}
```

**Backoff**: linear multiplicativo — espera `retryDelayMs × (tentativa + 1)` (1.5s, 3s, 4.5s para
os defaults). Total de espera máxima antes de desistir: ~9s.

**Configurabilidade via opts**:
- `opts.retries = 0` → sem retry (comportamento original)
- `opts.retries = 5, opts.retryDelayMs = 500` → 5 tentativas com delays de 500ms, 1s, 1.5s...

---

## Impacto das Mudanças

| Cenário | Antes | Depois |
|---------|-------|--------|
| Usuário digita enquanto LLM-B processa | Mensagem descartada com `null` | Mensagem enfileirada, enviada quando LLM-B liberar |
| LLM-A injeta enquanto LLM-B processa | 409 imediato (sem retry) | Retry automático em até ~9s |
| Pipeline com N steps e LLM-B busy | Falha no step com `sendTurn → null` | Steps aguardam na fila |
| Attachment nativo (file) com LLM-B busy | Execução paralela (race condition) | 409 retornado; retry em `injectToLlmB` |
| Clientes SSE monitorando estado | Sem notificação de início/fim de turno | Evento `busy` emitido em toda transição |

---

## Testes

### Novos arquivos de teste

**`tests/unit/copilot/test_terminal_turn_serialization.spec.js`** (14 testes):
- Análise estrutural do source de `dialog.js` e `http-handlers.js`
- Comportamento de serialização: 3 chamadas concorrentes → execução serial FIFO
- Comportamento de backpressure: fila cheia → null imediato

**`tests/unit/copilot/test_inject_retry.spec.js`** (10 testes):
- Análise estrutural do source de `inject.js`
- Retry em LLM_B_BUSY (sucesso na segunda tentativa)
- Sem retry para erros não-BUSY
- Esgotamento de retries (relança após N+1 chamadas)
- `retries=0` → sem retry

### Resultado final

```
766 tests  (742 anteriores + 24 novos)
766 pass
  0 fail
```

---

## Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `src/copilot/terminal/dialog.js` | TERM-01: serialização via Promise-chain; GAP-4: broadcastSse |
| `src/copilot/terminal/http-handlers.js` | TERM-02: getBusy/setBusy no path nativeAttachments |
| `src/copilot/channel/inject.js` | INJECT-01: retry automático com backoff |
| `tests/unit/copilot/test_terminal_turn_serialization.spec.js` | Novos testes (14) |
| `tests/unit/copilot/test_inject_retry.spec.js` | Novos testes (10) |
