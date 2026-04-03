# http-request.js — Auditoria

**Módulo**: `src/copilot/lib/` **Arquivo**: `http-request.js` **LOC**: 61 | **Score**: 8.0/10

## Responsabilidade

Helper HTTP para chamadas internas (loopback).
`httpRequest(method, urlStr, body, timeoutMs=5000, maxResponseBytes=1MB)`. Usa `node:http`
exclusivamente.

## ACHADO C13-03 — P5

**Suporta apenas `http://` — `https://` silenciosamente quebra**

```js
import http from 'node:http';
// ...
const req = http.request({ hostname, port, path, method, headers });
```

Se `urlStr` for `https://...`, `new URL()` parseia corretamente mas `http.request()` conecta sem TLS
— a requisição ou falha silenciosamente ou envia dados em claro dependendo do servidor. Não há
verificação de `url.protocol === 'http:'` antes de usar `http.request`.

**Fix**:

```js
import https from 'node:https';
// ...
const transport = url.protocol === 'https:' ? https : http;
const req = transport.request({ hostname, port, path, method, headers });
```

_(Ou rejeitar explicitamente URLs não-http se esse helper é realmente apenas para loopback.)_

## Destaques Positivos

- `maxResponseBytes` com preemptive `req.destroy()` — previne response flood
- Timeout via `req.setTimeout` com `req.destroy()` — não usa `setTimeout()` global
- Destruição correta on timeout: `req.on('timeout', () => req.destroy())`

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
