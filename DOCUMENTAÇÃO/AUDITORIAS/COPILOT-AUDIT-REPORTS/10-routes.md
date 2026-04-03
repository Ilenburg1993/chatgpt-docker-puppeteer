# 10-routes.md — Módulo routes/ — Consolidado

**Módulo**: `src/copilot/routes/` **Gerado por**: COPILOT-FULL-AUDIT MF-II (F14) **Score geral**:
8.3/10 **LOC total**: 1546 (7 arquivos)

---

## Visão Geral

`routes/` é a camada de handlers HTTP/SSE da API SDK interna. Todos os routers são montados em
`/api/sdk/*` via um `sdk-api.js` pai. A camada é bem estruturada com: rate limiting, validação de
model, auth opcional Bearer, proteções para operações destrutivas (X-Confirm-Delete). O ponto fraco
central é o **gerenciamento de contadores SSE**.

---

## Inventário de Arquivos

| Arquivo            | LOC | Score | Função                                           |
| ------------------ | --- | ----- | ------------------------------------------------ |
| `sessions.js`      | 661 | 8.0   | CRUD sessões, SSE, rate limit, auth              |
| `agent.js`         | 222 | 8.0   | Inspeção/SSE do agente Always-Alive              |
| `observability.js` | 208 | 9.0   | 10 endpoints de observabilidade                  |
| `client.js`        | 205 | 8.5   | Controle CopilotClient (ping, start/stop, tools) |
| `hooks.js`         | 134 | 8.0   | Introspecção hooks + SSE de eventos              |
| `webhooks.js`      | 86  | 9.0   | CRUD webhooks com validação anti-SSRF            |
| `middleware.js`    | 30  | 9.0   | `withErrorHandler` compartilhado                 |

---

## Achados — P4 (corrigir em sprint próximo)

### C14-01 — `hooks.js` + `agent.js` — P4

**SSE counter triple-decrement: `req.close` + `res.error` + `res.finish` sem idempotência**

**Contexto**: Tanto `routes/hooks.js` (contador `_hooksSseClients`) quanto `routes/agent.js`
(contador `_agentSseClients`) usam o padrão:

```js
req.on('close', () => {
  _counter--; /* cleanup */
});
res.on('error', () => _counter--);
res.on('finish', () => _counter--);
```

Em uma desconexão abrupta, `req.close` e `res.error` (e às vezes `res.finish`) disparam
simultaneamente. Cada evento decrementa o contador de forma independente — o contador vai para
valores negativos. Com `_counter < 0`, a verificação `_counter >= MAX_SSE_CLIENTS` nunca é
verdadeira → cap completamente inoperante → abertura ilimitada de streams.

**Impacto**: DoS por abertura de streams SSE sem controle após primeira desconexão abrupta.

**Correção** (para ambos os arquivos):

```js
let decremented = false;
const decrement = () => {
  if (!decremented) {
    decremented = true;
    _counter--;
  }
};
req.on('close', () => {
  decrement();
  clearInterval(heartbeatInterval);
  cleanup();
});
res.on('error', decrement);
res.on('finish', decrement);
```

**Localização**:

- `hooks.js` linhas ~115-130
- `agent.js` linhas ~190-215

---

### C14-02 — `sessions.js` — P4

**`GET /sessions/:id/stream` sem MAX_SSE_CLIENTS cap**

Os endpoints SSE `/hooks/events` e `/agent/stream` verificam `_sseClients >= MAX_SSE_CLIENTS` antes
de abrir o stream. O endpoint `/sessions/:id/stream` não tem nenhum contador nem cap. Com N sessões
ativas × M clientes tentando fazer stream de cada uma = N×M conexões abertas sem controle.

**Correção**: Adicionar contador global `_sessionSseClients` com cap idempotente (idêntico ao padrão
correto de C14-01).

---

### C14-03 — `sessions.js` — P4

**`POST /sessions/:id/send` sem limite de tamanho do prompt**

O handler aceita `prompt` de tamanho arbitrário:

- Prompts de vários MB consomem memória no processo Node
- O SDK processa tokens excessivos gerando custos e latência

**Correção**:

```js
const MAX_PROMPT_BYTES = 512_000; // 512KB razoável para a maioria dos casos
if (Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) {
  res.status(400).json({ ok: false, error: 'Prompt excede limite de 512KB.' });
  return;
}
```

---

## Achados — P5

| ID     | Arquivo            | Título                                                                       |
| ------ | ------------------ | ---------------------------------------------------------------------------- | ---- | ------------------------------------------------ |
| C14-04 | `middleware.js`    | `e.message` exposto na resposta HTTP — information leakage                   |
| C14-05 | `client.js`        | Endpoints `/client/start                                                     | stop | force-stop` sem auth própria (depende do parent) |
| C14-06 | `client.js`        | `alwaysAliveAgent.toolsRegistry` acessado via cast inseguro                  |
| C14-07 | `observability.js` | `POST log-level` usa dynamic import — padrão incomum, funcionalmente correto |
| C14-08 | `observability.js` | `POST .../clear` e `POST .../flush` sem auth própria                         |
| C14-09 | `sessions.js`      | `_rlWindowMap` purge O(n) em toda requisição — perf concern em alta escala   |
| C14-10 | `sessions.js`      | Double-timeout em `sendAndWait` redundante (seguro, mas confuso)             |
| C14-11 | `webhooks.js`      | `GET /webhooks` sem paginação                                                |

---

## Pontos Fortes do Módulo

### Segurança

- `POST /sessions` usa `validateModel()` com regex `MODEL_SAFE_RE` — previne model injection
- `DELETE /sessions/:id` exige header `X-Confirm-Delete: true` (SEC-N10 fix)
- `POST /webhooks` valida URL via `validateUrlString` (anti-SSRF, UPG-P2-01 fix)
- `SDK_API_TOKEN` Bearer auth opcional aplicado ao router de sessions (SEC-N06 fix)
- Rate limiting em `POST /sessions` (10/min) e `POST .../send` (30/min) por IP

### Robustez

- `NEW-03` fix: `timeoutMs` valida `typeof`, `isFinite()`, `> 0` — rejeita NaN/Infinity/negativo
- `GET /sessions/active|last|foreground` declarados antes de `GET /sessions/:id` — sem conflito
- `withErrorHandler` com `.bind(null, prefix)` padronizado em todos os routers
- `res.writableEnded` guard antes de writes SSE em todos os endpoints
- Heartbeat em todos os SSE streams (15–30s) para keepalive

### Observabilidade

- `observability.js` consolidado: health + metrics + errors + logs + audit + OTEL em uma rota
- Filtros ricos em todos os GET de observabilidade: source, level, type, sessionId, tool
- Caps de retorno em todos os endpoints (`Math.min(n, 200)`) — protege memória

---

## Mapa de Endpoints

```
GET  /ping                         → client.js
GET  /status                       → client.js
GET  /auth                         → client.js
GET  /models                       → client.js
GET  /tools                        → client.js
POST /client/start|stop|force-stop → client.js

GET  /agent/info                   → agent.js
GET  /agent/tools                  → agent.js
GET  /agent/telemetry              → agent.js
POST /agent/telemetry/clear        → agent.js
GET  /agent/state                  → agent.js
GET  /agent/stream          [SSE]  → agent.js (⚠ counter bug)
GET  /telemetry             [alias]→ agent.js

GET  /hooks/registry               → hooks.js
GET  /hooks/events          [SSE]  → hooks.js (⚠ counter bug)

GET  /sessions/active              → sessions.js
GET  /sessions/last                → sessions.js
GET  /sessions/foreground          → sessions.js
PUT  /sessions/foreground/:id      → sessions.js
GET  /sessions                     → sessions.js
POST /sessions                     → sessions.js (rate limited)
GET  /sessions/:id                 → sessions.js
DELETE /sessions/:id               → sessions.js (X-Confirm-Delete)
POST /sessions/:id/resume          → sessions.js
POST /sessions/:id/disconnect      → sessions.js
POST /sessions/:id/send            → sessions.js (rate limited, ⚠ sem size limit)
GET  /sessions/:id/stream   [SSE]  → sessions.js (⚠ sem cap)
POST /sessions/:id/model           → sessions.js
POST /sessions/:id/abort           → sessions.js
GET  /sessions/:id/messages        → sessions.js

GET  /webhooks                     → webhooks.js
POST /webhooks                     → webhooks.js (anti-SSRF)
DELETE /webhooks/:id               → webhooks.js

GET  /observability/health         → observability.js
GET  /observability/metrics        → observability.js
GET  /observability/errors         → observability.js
GET  /observability/errors/stats   → observability.js
POST /observability/errors/clear   → observability.js
GET  /observability/logs           → observability.js
POST /observability/log-level      → observability.js
GET  /observability/audit          → observability.js
POST /observability/audit/flush    → observability.js
GET  /observability/audit-tail     → observability.js
GET  /observability/otel-status    → observability.js
```

---

## Recomendações Prioritárias

1. **[P4]** Corrigir counter underflow em SSE de hooks.js e agent.js com flag idempotente (C14-01)
2. **[P4]** Adicionar MAX_SSE_CLIENTS cap em `GET /sessions/:id/stream` (C14-02)
3. **[P4]** Adicionar limit de tamanho em `POST /sessions/:id/send` (C14-03)
4. **[P5]** Verificar se sdk-api.js aplica `SDK_API_TOKEN` globalmente ou apenas em sessions
   (C14-05, C14-08)
5. **[P5]** Substituir O(n) scan de `_rlWindowMap` por purge periódico via `setInterval` (C14-09)

---

_Módulo auditado por COPILOT-FULL-AUDIT MF-II (F14) — 7 arquivos, 1546 LOC._
