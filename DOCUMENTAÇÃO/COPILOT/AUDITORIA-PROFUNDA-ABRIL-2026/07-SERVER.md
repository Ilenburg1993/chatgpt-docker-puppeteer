# 07-SERVER — Auditoria do Módulo `server/`

**Auditoria Profunda de `src/copilot`** · Abril 2026 **Módulo**: `src/copilot/server/` **Documentado
em**: 2026-04-18

---

## 1. Mapa do Módulo

```
server/
├── app.js                 (createCopilotApp — Express factory)
├── server.js              (startCopilotServer — HTTP server lifecycle)
├── routes/                (rotas REST)
│   ├── agent.js
│   ├── health.js
│   ├── hub.js
│   ├── messages.js
│   └── socket.js          (WebSocket/Socket.io)
└── middleware/
    ├── auth.js             (Bearer token timing-safe)
    ├── cors.js             (CORS headers)
    ├── error-handler.js    (Express error handler global)
    ├── request-id.js       (X-Request-ID)
    └── security-headers.js (CSP, X-Frame-Options, etc.)
```

---

## 2. Arquivo: `app.js`

### Ordem de Middlewares

```
1. securityHeadersMiddleware  (S-A-09)
2. requestIdMiddleware
3. createCorsMiddleware(...)  ← CORS com BUG
4. express.json({ limit: '2mb' })
5. express.urlencoded(...)
6. createAuthMiddleware(...)  (se !skipAuth)
```

**Positivo**: Ordem correta — security headers e CORS antes de auth e routes.

**Positivo**: Body parsing com limite de 2MB — proteção contra payload flood.

---

## 3. Arquivo: `middleware/cors.js` — BUG CONFIRMADO

### Código Problemático

```js
const DEFAULT_CORS_ORIGIN = 'http://localhost:*'; // ← INVÁLIDO
app.use(createCorsMiddleware({ origin: opts?.corsOrigin ?? DEFAULT_CORS_ORIGIN }));
```

```js
res.setHeader('Access-Control-Allow-Origin', originHeader);
// originHeader = 'http://localhost:*' quando origin é string única
```

| ID                        | Sev    | Descrição                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BUG-CORS-01** / CAT-005 | **P1** | `http://localhost:*` **não é um valor válido** para `Access-Control-Allow-Origin`. A spec HTTP não permite globs/wildcards em origens — apenas `*` (qualquer origem) ou uma origin exata. Resultado: browsers rejeitam o header CORS, fazendo todas as requisições do dashboard frontend falharem com CORS error. |

> **Status de execução (2026-04-17): corrigido no código.** O middleware agora faz reflection de uma
> única origin válida por request, aceita `localhost` em qualquer porta por regex e deixa de emitir
> valores inválidos ou múltiplos no header.

**Quando array é passado:**

```js
const originHeader = Array.isArray(origin) ? origin.join(', ') : origin;
res.setHeader('Access-Control-Allow-Origin', originHeader);
```

| ID              | Sev | Descrição                                                                                                                                                                                                                                                                                                           |
| --------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BUG-CORS-02** | P1  | Array de origens é unido com `, ` e enviado como valor único do header. `Access-Control-Allow-Origin` **só aceita um valor por header** (uma origin exata ou `*`). Múltiplos valores não são válidos — browsers leem apenas o primeiro. Correto: verificar `req.headers.origin` e refletir se estiver na whitelist. |

### Correção Recomendada

```js
export function createCorsMiddleware(opts) {
  const allowedOrigins = Array.isArray(opts?.origin)
    ? opts.origin
    : opts?.origin
      ? [opts.origin]
      : ['*'];

  return function corsMiddleware(req, res, next) {
    const reqOrigin = req.headers.origin;

    if (allowedOrigins.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (reqOrigin && allowedOrigins.includes(reqOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin);
      res.setHeader('Vary', 'Origin');
    }
    // ... resto igual
  };
}
```

---

## 4. Arquivo: `middleware/auth.js`

```js
import { timingSafeEqual } from 'node:crypto';
// ...
if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
  // 401
}
```

**Positivo**: `timingSafeEqual` — proteção contra timing attacks. Bem implementado.

**Positivo**: Audit log de falha de auth com IP e request ID.

---

## 5. Arquivo: `middleware/security-headers.js`

Não lido diretamente. Referenciado em `app.js` como `S-A-09`.

Esperado: `X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy`.

| ID                | Sev | Descrição                                                                                                                                                                                               |
| ----------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAP-SERVER-01** | P3  | Sem verificação direta do conteúdo dos security headers. Dependendo do CSP configurado, `script-src 'unsafe-inline'` ou `default-src *` podem estar presentes. Necessita verificação direta do arquivo. |

---

## 6. Arquivo: `server/socket/hub-ns.js` (CAT-002 revisitado)

**CAT-002** do catálogo anterior: Socket hub-ns sem autorização de sessão.

> **Status de execução (2026-04-17): mitigado no código.**

O namespace `/copilot` agora separa autenticação de transporte de autorização por sessão:

- claims JWT são normalizadas em um principal (`sub`, `roles`, `scopes`, grants explícitos por
  sessão);
- `join:session`, `user:inject`, `sessions:list` e `turns:history` consultam ACL derivada de
  `hub_session.metadata`;
- sessões system-managed (ex.: `source=terminal-server`) passam a exigir admin/scope ou grant
  explícito;
- eventos passivos (`session:created`, `turn:*`, `user:injected`, `hub:error`) só são emitidos para
  sockets autorizados.

| ID          | Sev | Descrição                                                                                                                                      |
| ----------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **CAT-002** | P2  | Socket.io namespace `hub-ns` aceitava autenticação global sem autorização por `hubSession` — **mitigado com ACL por sessão + filtro de emits** |

---

## 7. Resumo de Achados do Módulo Server

| ID                        | Severidade | Arquivo                          | Descrição                                                                                  |
| ------------------------- | ---------- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| **BUG-CORS-01** / CAT-005 | **P1**     | `middleware/cors.js:44`          | `http://localhost:*` inválido como CORS origin — **corrigido em 2026-04-17**               |
| **BUG-CORS-02**           | **P1**     | `middleware/cors.js`             | Array de origins join com `, ` — inválido por spec — **corrigido em 2026-04-17**           |
| CAT-002                   | P2         | `server/socket/hub-ns.js`        | Socket hub-ns sem auth por sessão — **mitigado em 2026-04-17 com ACL + gating de eventos** |
| GAP-SERVER-01             | P3         | `middleware/security-headers.js` | Security headers não verificados diretamente                                               |

### Severidade Geral do Módulo: **P1 (Alto)**

Os dois bugs P1 de CORS já foram corrigidos no código atual. Eles permanecem documentados aqui como
referência da causa-raiz.

---

_Próximo: [08-INFRA-OBSERVABILITY.md](./08-INFRA-OBSERVABILITY.md)_
