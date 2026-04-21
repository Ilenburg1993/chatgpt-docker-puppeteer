# 04-CHANNEL-COMMUNICATION — Auditoria do Módulo `channel/`

**Auditoria Profunda de `src/copilot`** · Abril 2026 **Módulo**: `src/copilot/channel/`
**Documentado em**: 2026-04-18

---

## 1. Mapa do Módulo

```
channel/
├── inject.js              (HTTP injection para LLM-B em :3009)
├── sse-client.js          (Cliente SSE com reconexão automática)
├── client.js              (LlmBridgeClient — facade do agente para canal)
├── client-dialog.js       (dialogTurn, startDialogMode, stopDialogMode)
├── client-history.js      (getLastNPairs — histórico de turns)
├── client-structured.js   (chatStructured — respostas estruturadas)
├── inject-server.js       (HTTP server que recebe injeções em :3009)
└── channel-manager.js     (gerenciamento de múltiplos canais)
```

---

## 2. Arquivo: `inject.js`

### Rate Limiting Client-Side

```js
const INJECT_RATE_PER_SEC = (() => {
  const raw = parseInt(process.env['INJECT_RATE_LIMIT_PER_SEC'] ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
})();
```

**Positivo**: Sliding window de 1s para limitar flood acidental.

### Porta Validada

```js
const DEFAULT_PORT = (() => {
  const raw = LLM_B_TERMINAL_PORT;
  if (!Number.isInteger(raw) || raw < 1 || raw > 65535) {
    log('WARN', `[channel/inject] LLM_B_TERMINAL_PORT inválida (${raw}), usando 3009`);
    return 3009;
  }
  return raw;
})();
```

**Positivo**: Validação de range de porta com fallback seguro — GAP-CHAN-002 já endereçado.

### Retry com Backoff

**Positivo**: `retries` e `retryDelayMs` com backoff exponencial em 409 (LLM_B_BUSY).

### Achados

| ID              | Sev | Descrição                                                                                                                                                                                                                                                                      |
| --------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **GAP-CHAN-01** | P2  | `_injectTimestamps.shift()` em loop era O(n) para cada purga. **Mitigado em 2026-04-17** com índice lógico de início da janela + compactação ocasional do array, removendo o custo linear por request em bursts de injeção.                                                    |
| **GAP-CHAN-02** | P3  | Rate limit client-side (`INJECT_RATE_PER_SEC`) é um `const` global partilhado por todas as instâncias. Se múltiplos callers injetam concorrentemente (ex: HubOrchestrator + REPL direto), o rate limiter é compartilhado e pode bloquear um fluxo legítimo por culpa de outro. |

---

## 3. Arquivo: `sse-client.js`

### Reconexão Automática com Backoff

```js
let reconnectMs = 1_000;
const MAX_RECONNECT_MS = 30_000;
// ...
reconnectMs = Math.min(reconnectMs * 2, MAX_RECONNECT_MS);
```

**Positivo**: Backoff exponencial com cap de 30s — não satura o servidor com reconexões.

### Last-Event-ID (PHASE-10)

```js
let lastEventId = '';
// ...
if (lastEventId) headers['Last-Event-ID'] = lastEventId;
```

**Positivo**: Suporte a replay de eventos perdidos via `Last-Event-ID`.

### Buffer MAX

```js
const MAX_BUF_BYTES = 256 * 1024; // 256KB
if (buf.length + chunkStr.length > MAX_BUF_BYTES) {
  buf = '';
  return;
}
```

| ID             | Sev | Descrição                                                                                                                                                                                                                                                                                               |
| -------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BUG-SSE-01** | P1  | Quando `buf` excede `MAX_BUF_BYTES`, **o buffer é silenciosamente descartado** (`buf = ''`). Eventos parcialmente recebidos são perdidos sem notificação ao caller nem evento de erro. O modelo pode receber resposta incompleta sem saber. Correto: emitir evento de erro/overflow e forçar reconexão. |

> **Status de execução (2026-04-17): corrigido no código.** O cliente SSE agora faz
> `log('WARN', ...)` e destrói a request para forçar reconexão explícita, em vez de truncar o buffer
> silenciosamente.

---

## 4. Arquivo: `client.js` (LlmBridgeClient)

### Injeção do Agente via Setter

```js
let _agent = null;

export function setBridgeAgent(agent) {
  _agent = agent;
}
```

### CAT-003 — Cross-talk Analysis

**CAT-003** do catálogo anterior refere-se a potential cross-talk entre sessões no canal. Análise:

O `_agent` é um singleton global — `setBridgeAgent()` sobrescreve silenciosamente se chamado duas
vezes. Em ambiente com múltiplos terminais (improvável mas possível), a segunda chamada substituiria
o agente ativo sem aviso.

| ID                        | Sev | Descrição                                                                                                                                                                                                                 |
| ------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CAT-003 / GAP-CHAN-03** | P2  | `setBridgeAgent()` não tem guard contra double-set. Se chamado duas vezes (ex: hot reload, restart acidental), o agent anterior é silenciosamente substituído. Requería um check `if (_agent !== null)` com log de aviso. |

---

## 5. Resumo de Achados do Módulo Channel

| ID                    | Severidade | Arquivo         | Descrição                                                                                                           |
| --------------------- | ---------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| **BUG-SSE-01**        | **P1**     | `sse-client.js` | Buffer overflow silencioso — eventos perdidos sem notificação — **corrigido em 2026-04-17 com reconexão explícita** |
| CAT-003 / GAP-CHAN-03 | P2         | `client.js`     | `setBridgeAgent()` sem guard contra double-set                                                                      |
| GAP-CHAN-01           | P2         | `inject.js`     | purge O(n) do rate limiter client-side — **mitigado em 2026-04-17 com índice lógico + compactação ocasional**       |
| GAP-CHAN-02           | P3         | `inject.js`     | Rate limit global compartilhado entre callers                                                                       |

### **NOVO BUG P1 ENCONTRADO: BUG-SSE-01**

Este bug era uma regressão crítica: respostas do LLM podiam ser truncadas silenciosamente se o
buffer SSE excedesse 256KB. O código atual já força reconexão explícita nesse cenário.

---

_Próximo: [05-CONVERSATION-HUB.md](./05-CONVERSATION-HUB.md)_
