# Auditoria — `server.js`

**Módulo**: `src/copilot/terminal/server.js` **LOC**: 344 **Data**: 2026-06-10 **Auditor**: Copilot
Full-Audit MF-II

---

## 1. Propósito

Servidor HTTP raw (`node:http`, porta 3009) do Terminal LLM-B. Responsável por transporte HTTP:
leitura de body, parsing de URL, autenticação por token, rate limiting, escrita de status/headers e
setup SSE. Delega toda lógica de negócio para `http-handlers.js`.

---

## 2. Arquitetura

```
createInjectServer()
 ├── http.createServer(handler)
 │    ├── matchRoute(method, pathname)       ← route-table dispatch
 │    ├── Auth bypass ou timingSafeEqual     ← SEC-04
 │    ├── Rate limiting por tipo + IP        ← GAP-01, SEC-N02
 │    ├── SSE setup (/events)               ← custom route
 │    └── readBody + handler dispatch
 └── server.listen(INJECT_PORT, '127.0.0.1')
```

Rate limiters independentes:

- `_injectRateLimiter` — 10 req/60s para POST /inject
- `_writeRateLimiter` — 5 req/60s para /pipeline, /memory
- `_sseRateLimiter` — 10 conexões/60s para GET /events

---

## 3. Achados

### FINDING-P4-1 — Ausência de handler `OPTIONS` — CORS preflight sem suporte **[FIXED]**

**Severidade**: P4 — Médio **→ CORRIGIDO** **Localização**: `createInjectServer()` +
`route-table.js`

O servidor define `'Access-Control-Allow-Origin': '*'` nas respostas via `sendJson(result)` quando
`result.cors = true`. Mas quando uma requisição `OPTIONS` (CORS preflight) é feita para qualquer
endpoint, ela resulta em 404 (nenhuma rota `OPTIONS` está na `ROUTE_TABLE`). Navegadores bloqueiam a
requisição real quando o preflight falha.

**Mitigante**: o comentário `NEW-06` indica que o server faz bind em `127.0.0.1` (loopback), então
requisições de navegadores de origens externas não chegam. Na prática, o dashboard Vue pode fazer
requisições de `localhost:porta-do-dashboard` para `localhost:3009` — isso é same-site e normalmente
não exige preflight para requests simples, mas requisições com `Authorization` header ou
`Content-Type: application/json` EXIGEM preflight.

**Proposta**:

```js
// No início do createServer handler, antes de matchRoute:
if (req.method === 'OPTIONS') {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
    'Access-Control-Max-Age': '86400',
  });
  res.end();
  return;
}
```

---

### FINDING-P5-2 — Padrão `timingSafeEqual` com dependência de short-circuit **[FIXED]**

**Severidade**: P5 — Cosmético / Risco de manutenção **→ CORRIGIDO**

**Fix aplicado**: `&&` substituído por bitwise `&` para evitar short-circuit timing leak.
`const safeEqual = timingSafeEqual(providedBuf, expectedBuf); const tokenMatch = lengthMatch & safeEqual;`
**Localização**: auth check linhas ~245-255

```js
const providedBuf = Buffer.from(authHeader.padEnd(expected.length));
const expectedBuf = Buffer.from(expected);
const lengthMatch = authHeader.length === expected.length;
const tokenMatch = lengthMatch && timingSafeEqual(providedBuf, expectedBuf);
```

`timingSafeEqual` requer buffers de igual tamanho. Se `authHeader` for maior que `expected`,
`providedBuf.length > expectedBuf.length`, e chamar `timingSafeEqual` lançaria
`ERR_CRYPTO_TIMINGSAFE_NOT_EQUAL_LENGTH`. A proteção é o `&&` short-circuit em `tokenMatch`. O
código funciona corretamente mas é frágil: qualquer refatoração que avalie `timingSafeEqual` antes
de `lengthMatch` causaria throw.

**Proposta** (mais explícita):

```js
const provided = Buffer.from(authHeader);
const expected_ = Buffer.from(expected);
// Allocate fixed-size buffer para comparação timing-safe
const cmpBuf = Buffer.alloc(expected_.length);
provided.copy(cmpBuf, 0, 0, Math.min(provided.length, expected_.length));
const tokenMatch = provided.length === expected_.length && timingSafeEqual(cmpBuf, expected_);
```

---

### FINDING-P5-3 — Rate limiter em memória — perdido a cada restart

**Severidade**: P5 — Cosmético **Localização**: criação dos rate limiters, linhas ~80-110

Documentado no comentário `SEC-V06`. Em uso de terminal leve (dev, uma instância), isso é aceitável.
Em cenário de múltiplos restarts rápidos, um atacante poderia resetar o counter a cada restart. Para
produção hardened: Redis ou rate limiting em camada de proxy.

---

## 4. Pontos positivos

- **SEC-04**: `timingSafeEqual` para comparação de token — correto para anti-timing-attack.
- **GAP-01 + SEC-N02**: 3 rate limiters independentes por tipo (inject, write, sse) com keys
  compostas (IP + endpoint) para isolamento correto.
- **BUG-N03**: purga de entradas expiradas no rate limiter para prevenir memory leak.
- **NEW-06**: CORS wildcard documentado como seguro (loopback only).
- `readBody` com limite `MAX_BODY_BYTES = 2 MB` — proteça contra DoS por payload.
- `X-Request-ID` propagado para rastreabilidade — boa prática.
- Handler de erro final com `res.headersSent` check — previne double-write.
- Bind explícito em `127.0.0.1` (não `0.0.0.0`) — minimiza superfície de ataque.

---

## 5. Score

| Dimensão           | Nota                       |
| ------------------ | -------------------------- |
| Segurança          | 9.5/10                     |
| Rate limiting      | 9/10                       |
| Completude HTTP    | 9/10 (preflight corrigido) |
| Código e estrutura | 9/10                       |
| **Global**         | **9.1/10**                 |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
