# PARTE-24K — ROADMAP ULTRA-DETALHADO: COPILOT SERVER DEDICADO

> **Documento**: PARTE-24K-ROADMAP-ULTRA-DETALHADO.md
> **Versão**: 1.2
> **Data**: 2026-04-13 (atualizado)
> **Escopo**: Roadmap de implementação cirúrgico e completo — arquivo de referência máster para toda a
> reestruturação do `src/copilot`. Substitui PARTE-24J como roadmap canônico.

## STATUS DE IMPLEMENTAÇÃO

| Onda | Status | Commit |
|------|--------|--------|
| 2.7  | ✅ CONCLUÍDA | `6a9f366e` |
| 3.0  | ✅ CONCLUÍDA | `b01f600e` |
| 3.1  | ✅ CONCLUÍDA | `b01f600e` |
| 3.2  | ✅ CONCLUÍDA | `37e1946f` |
| 3.3  | ✅ CONCLUÍDA | `37e1946f` |
| 3.4  | ✅ CONCLUÍDA | `54f0ba99` |
| 3.5  | ✅ CONCLUÍDA | `7e07a162` |
| 3.6  | ✅ CONCLUÍDA | `7e07a162` |
| 3.7  | ✅ CONCLUÍDA | `7e07a162` |
| 3.8  | ✅ CONCLUÍDA | `8d8ddefb` |
| 3.9  | ✅ CONCLUÍDA | `2dba4b85` |

**Onda 3.2 entregou**:
- `server/socket/hub-ns.js` — Namespace Socket.IO /copilot (L56.2)
- `server/socket/index.js` — Factory `createCopilotSocket(httpServer)` (L56.3)
- `server/index.js` — Completo com Socket.IO opt-in via `opts.orchestrator + opts.store` (L56.4)
- `scripts/check-copilot-server.mjs` — Smoke test validado ✅ (L56.5)

---

## ESTADO DE PARTIDA EXATO

**Commit base**: `6a9f366e` — Onda 2.7 commitada e pushada para origin/main.

**Working tree atual**:
- 3 docs não-commitados: PARTE-24H, PARTE-24I, PARTE-24J

**Arquitetura do servidor atual — inventory real**:

### `terminal/server.js` (407 LOC) — Servidor HTTP nativo atual
Responsável por:
1. 3 rate limiters in-memory: `_injectRateLimiter`, `_writeRateLimiter`, `_sseRateLimiter`
2. Auth via header `Authorization: Bearer <TOKEN>` (timing-safe)
3. Body parsing + max 2MB enforce
4. Preflight CORS OPTIONS
5. Webhook de ready (`COPILOT_READY_WEBHOOK`)
6. SSE via `/events` e `/events/critical` — com replay via `Last-Event-ID`
7. Heartbeat SSE a cada 30s
8. Dispatch via `matchRoute()` do `route-table.js`
9. Graceful shutdown via `registerShutdownHandler`
10. `server.listen(INJECT_PORT, '127.0.0.1')` — bind exclusivo em loopback

### `terminal/route-table.js` (280 LOC) — 38 rotas declarativas
Organizada por categorias:
- **Auth-exempt**: GET /health, /hub-health, /metrics
- **GET simples**: /context, /quota, /pr-budget, /config, /config/skills, /config/tools, /errors, /tool-stats, /history, /system/reset
- **GET com query params**: /audit, /sessions, /sessions/:id/turns, /memory, /gh/issues, /gh/prs, /gh/ci, /git/status, /git/log
- **SSE**: GET /events (custom, rate-limited)
- **PUT**: /config/infinite-session, /config/skills, /config/tools
- **POST**: /config/tools/custom, /memory, /pipeline, /inject, /dialog/pause, /dialog/resume, /handoff, /handoff/:id/accept, /handoff/:id/reject
- **DELETE**: /config/tools/custom/:name, /memory/:id

### `terminal/handlers/` (6 arquivos ~850 LOC)
- `agent.js` — inject, pipeline, dialog, context, quota, handoff
- `dialog.js` — hub health, sessions, turns, memoria
- `system-config.js` — config, skills, tools, custom tools, infinite-session
- `system-metrics.js` — errors, tool-stats, history, audit, pr-budget, git/status, git/log, gh/issues, gh/prs, gh/ci
- `shared.js` — utilitários compartilhados
- `index.js` — barrel

### `conversation-hub/socket-ns.js` (458 LOC) — Namespace Socket.IO pronto
Implementa:
- Namespace `/copilot` no `io` existente
- JWT auth middleware com Zod validation
- Rate limiting por socketId + IP
- Handlers: `join:session`, `leave:session`, `user:inject`, `sessions:list`, `turns:history`
- Bridge de eventos do orchestrator → namespace
- `broadcastToSession()`, `broadcastGlobal()`, `unmountCopilotNamespace()`

### `terminal/index.js` (228 LOC) — Orquestrador atual (mistura 5 concerns)
1. `loadAliasesAsync()`
2. `wireTerminalDI()`
3. `PinnedFilesLoader` init
4. `createInjectServer()` — cria e inicia o servidor HTTP
5. `conversationHub.initStandalone()` — hub SEM socket.io
6. `registerAgentEventListeners()`
7. `startReflectionLoop()`
8. `startTodoCleanupJob()`
9. `registerShutdownHandler` — reflection timer + inject server
10. `startRepl(injectServer)` — REPL readline

---

## CONVENÇÕES DESTE ROADMAP

- Cada **Onda** = 1 commit atômico que deixa o sistema em estado funcional
- Labels: `L54.x` = Onda 3.0, `L55.x` = Onda 3.1, etc.
- ✅ Antes de commitar: `npm run lint` + `npm run typecheck:node` + smoke test
- 🔴 = crítico, deve ser feito antes de qualquer skip
- 🟠 = alta prioridade
- 🟡 = média prioridade
- 🟢 = baixa prioridade / cosmético

---

## ONDA 3.0 — SCAFFOLD DO COPILOT SERVER (sem mudar comportamento)

> **Objetivo**: Criar `src/copilot/server/` com estrutura completa, mas **sem inicializar ainda**.
> O sistema deve funcionar **exatamente igual** ao estado anterior após esta onda.
>
> **Invariante**: `terminal/server.js` continua sendo o servidor ativo. Nada muda no runtime.

### L54.1 — Criar `src/copilot/server/middleware/auth.js`

**Extrair**: Lógica de auth do `terminal/server.js` linhas 225-245 (timing-safe check, audit log).

```js
// src/copilot/server/middleware/auth.js
// @ts-check
import { defaultAuditLog } from '#copilot/audit';
import { timingSafeEqual } from 'node:crypto';

/**
 * Cria middleware Express de autenticação por Bearer token.
 *
 * @param {string} token - Token esperado (vazio = auth desabilitado)
 * @returns {import('express').RequestHandler}
 */
export function createAuthMiddleware(token) {
    return (req, res, next) => {
        // Rotas isentas: verificar flag `skipAuth` que pode ser adicionada pelo router
        if (!token) return next();
        const authHeader = req.headers['authorization'] ?? '';
        const expected = `Bearer ${token}`;
        const maxLen = Math.max(authHeader.length, expected.length);
        const providedBuf = Buffer.from(authHeader.padEnd(maxLen));
        const expectedBuf = Buffer.from(expected.padEnd(maxLen));
        const lengthMatch = authHeader.length === expected.length;
        const tokenMatch = timingSafeEqual(providedBuf, expectedBuf) && lengthMatch;
        if (!tokenMatch) {
            defaultAuditLog.record({
                type: 'auth.failure',
                data: { ip: req.ip ?? 'unknown', path: req.path, requestId: res.getHeader('x-request-id') },
            });
            res.status(401).json({ ok: false, error: 'Unauthorized' });
            return;
        }
        next();
    };
}
```

**Acceptance**: Arquivo existe, exporta `createAuthMiddleware`. Sem testes unitários obrigatórios
nesta onda, mas viável.

---

### L54.2 — Criar `src/copilot/server/middleware/rate-limiter.js`

**Extrair**: Função `createRateLimiter()` do `terminal/server.js` e os 3 limiters.

```js
// src/copilot/server/middleware/rate-limiter.js
// @ts-check
import {
    LLM_B_INJECT_RATE_MAX,
    LLM_B_INJECT_RATE_WINDOW_MS,
    LLM_B_SSE_RATE_MAX,
    LLM_B_SSE_RATE_WINDOW_MS,
} from '#copilot/config';

/**
 * @typedef {{ check: (key: string) => { allowed: boolean; remaining: number; resetIn: number }; clear: () => void }} RateLimiter
 */

/**
 * Factory para rate limiter em memória.
 *
 * @param {number} max
 * @param {number} windowMs
 * @returns {RateLimiter}
 */
export function createRateLimiter(max, windowMs) { /* mesma impl de terminal/server.js */ }

/**
 * Retorna os 3 rate limiters pré-configurados para o copilot server.
 *
 * @returns {{ injectLimiter: RateLimiter; writeLimiter: RateLimiter; sseLimiter: RateLimiter }}
 */
export function createDefaultRateLimiters() {
    return {
        injectLimiter: createRateLimiter(LLM_B_INJECT_RATE_MAX, LLM_B_INJECT_RATE_WINDOW_MS),
        writeLimiter: createRateLimiter(5, 60_000),
        sseLimiter: createRateLimiter(LLM_B_SSE_RATE_MAX, LLM_B_SSE_RATE_WINDOW_MS),
    };
}

/**
 * @param {RateLimiter} limiter
 * @param {string} key
 * @param {string} [errorMsg]
 * @returns {import('express').RequestHandler}
 */
export function rateLimitMiddleware(limiter, key, errorMsg) {
    return (req, res, next) => {
        const result = limiter.check(key);
        if (!result.allowed) {
            res.setHeader('Retry-After', String(result.resetIn));
            res.status(429).json({ ok: false, error: errorMsg ?? `Rate limit excedido. Tente em ${result.resetIn}s.` });
            return;
        }
        next();
    };
}
```

**Acceptance**: Arquivo existe, exporta `createRateLimiter`, `createDefaultRateLimiters`, `rateLimitMiddleware`.

---

### L54.3 — Criar `src/copilot/server/middleware/error-handler.js`

**Novo**: Error boundary Express para o copilot server.

```js
// src/copilot/server/middleware/error-handler.js
// @ts-check

/**
 * Error handler middleware para o copilot server.
 *
 * @type {import('express').ErrorRequestHandler}
 */
export function copilotErrorHandler(err, req, res, _next) {
    if (err?.code === 'PAYLOAD_TOO_LARGE') {
        res.status(413).json({ ok: false, error: 'Payload too large (máx 2 MB)' });
        return;
    }
    const msg = process.env.NODE_ENV === 'production'
        ? err?.message ?? 'Internal server error'
        : err?.stack ?? err?.message ?? String(err);
    log('ERROR', `[CopilotServer] Erro não tratado: ${msg}`);
    res.status(500).json({ ok: false, error: 'Internal server error' });
}
```

---

### L54.4 — Criar `src/copilot/server/middleware/cors.js`

**Novo**: Middleware CORS isolado.

```js
// src/copilot/server/middleware/cors.js
// @ts-check

/**
 * Middleware CORS para o copilot server (loopback — wildcard seguro).
 *
 * @returns {import('express').RequestHandler}
 */
export function copilotCorsMiddleware() {
    return (req, res, next) => {
        if (req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-ID, Last-Event-ID');
            res.setHeader('Access-Control-Max-Age', '86400');
            res.status(204).end();
            return;
        }
        res.setHeader('Access-Control-Allow-Origin', '*');
        next();
    };
}
```

---

### L54.5 — Criar `src/copilot/server/middleware/request-id.js`

**Extrair**: Geração de `X-Request-ID` do `terminal/server.js`.

```js
// src/copilot/server/middleware/request-id.js
// @ts-check

/** @returns {import('express').RequestHandler} */
export function requestIdMiddleware() {
    return (req, res, next) => {
        const id = req.headers['x-request-id']
            ? String(req.headers['x-request-id']).slice(0, 64)
            : `llmb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        res.setHeader('X-Request-ID', id);
        // Tornar o id acessível ao handler
        /** @type {any} */ (req).requestId = id;
        next();
    };
}
```

---

### L54.6 — Criar `src/copilot/server/app.js`

**Novo**: Express app factory que usa todos os middleware acima.

```js
// src/copilot/server/app.js
// @ts-check
import express from 'express';
import { LLM_B_TERMINAL_TOKEN } from '#copilot/config';
import { createAuthMiddleware } from './middleware/auth.js';
import { copilotCorsMiddleware } from './middleware/cors.js';
import { copilotErrorHandler } from './middleware/error-handler.js';
import { requestIdMiddleware } from './middleware/request-id.js';

/**
 * @typedef {Object} CopilotAppOptions
 * @property {string} [token] - Token de autenticação (default: LLM_B_TERMINAL_TOKEN)
 */

/**
 * Cria o app Express do copilot server.
 *
 * @param {CopilotAppOptions} [opts]
 * @returns {{ app: import('express').Application }}
 */
export function createCopilotApp(opts = {}) {
    const token = opts.token ?? (LLM_B_TERMINAL_TOKEN || '');
    const app = express();

    // Middleware: request-id, CORS, JSON body
    app.use(requestIdMiddleware());
    app.use(copilotCorsMiddleware());
    app.use(express.json({ limit: '2mb' }));

    // Auth global (rotas isentas configuram skipAuth no router)
    app.use(createAuthMiddleware(token));

    // Error handler — deve ser o último middleware
    app.use(copilotErrorHandler);

    return { app };
}
```

**Nota sobre Express**: verificar `package.json` se Express está listado como dependência.
Se não estiver, adicionar com justificativa: "copilot/server precisa de Express para middleware,
routers e error handling estruturado". Socket.io também requer.

---

### L54.7 — Criar `src/copilot/server/index.js` (stub)

**Stub**: Arquivo existe, exporta `createCopilotServer` como stub que ainda não faz nada (não inicia server).
Será completado na Onda 3.2.

```js
// src/copilot/server/index.js
// @ts-check
/**
 * @module copilot/server
 * @file Factory principal do Copilot Server — Express + Socket.IO.
 *
 * Este módulo orquestra a criação de:
 * - App Express com middleware de auth, CORS, rate-limit
 * - HTTP server Node.js
 * - Socket.IO server com namespaces /copilot, /events, /agent
 *
 * Bootstrap: chamado por src/copilot/bootstrap.js via startCopilotServer()
 */

/**
 * @typedef {Object} CopilotServerInstance
 * @property {import('express').Application} app
 * @property {import('node:http').Server} server
 * @property {number} port
 */

/**
 * Cria e inicializa o copilot server completo.
 *
 * NOTA: Implementação completa adicionada na Onda 3.2 (Socket.IO).
 * Esta versão bootstrap apenas monta Express + HTTP.
 *
 * @param {{ port?: number; token?: string }} [opts]
 * @returns {Promise<CopilotServerInstance>}
 */
export async function createCopilotServer(opts = {}) {
    // Stub — será implementado na Onda 3.2
    throw new Error('[CopilotServer] Não inicializado. Onda 3.2 ainda não aplicada.');
}
```

**Commit da Onda 3.0**: `refactor(onda3.0): L54.1-L54.7 — scaffold copilot/server/, middleware Express`

---

## ONDA 3.1 — EXPRESS ROUTERS POR DOMÍNIO

> **Objetivo**: Criar todos os routers Express em `server/routes/`, espelhando as 38 rotas de
> `route-table.js`. Os handlers são **reutilizados** dos arquivos em `terminal/handlers/` — não são
> duplicados.
>
> **Invariante**: `terminal/server.js` ainda é o servidor ativo. Routers existem mas não são montados.

### Visão geral dos 7 routers

| Router             | Path                                                              | Handlers de origem          |
| ------------------ | ----------------------------------------------------------------- | --------------------------- |
| `health.js`        | /health, /hub-health, /metrics                                    | system-config.js, dialog.js |
| `agent.js`         | /inject, /pipeline, /dialog/*, /context, /quota, /handoff         | agent.js                    |
| `config.js`        | /config, /config/skills, /config/tools, /config/tools/custom      | system-config.js            |
| `memory.js`        | /memory, /sessions, /sessions/:id/turns                           | dialog.js                   |
| `observability.js` | /errors, /tool-stats, /history, /audit, /pr-budget, /system/reset | system-metrics.js           |
| `git.js`           | /git/status, /git/log                                             | system-metrics.js           |
| `github.js`        | /gh/issues, /gh/prs, /gh/ci                                       | system-metrics.js           |

---

### L55.1 — Criar `src/copilot/server/routes/health.js`

```js
// src/copilot/server/routes/health.js
// @ts-check
import { Router } from 'express';
import { handleHealth, handleGetConfig as _hc, handleHubHealth } from '../../terminal/handlers/system-config.js';
import { handleMetrics } from '../../terminal/handlers/system-metrics.js';

const router = Router();

// Auth exempt — estas rotas não requerem token
/** @param {any} req @param {any} res */
const wrapSync = (fn) => (req, res, next) => {
    try {
        const result = fn(req._handlerArgs ?? undefined);
        res.status(result.status).set(result.headers ?? {}).send(
            result.contentType === 'application/json' ? undefined : result.body
        );
        if (result.contentType === 'application/json' || !result.contentType) {
            res.status(result.status).json(result.body);
        }
    } catch(e) { next(e); }
};

router.get('/health', (req, res) => {
    const result = handleHealth();
    res.status(result.status).json(result.body);
});

router.get('/hub-health', (req, res) => {
    const result = handleHubHealth();
    res.status(result.status).json(result.body);
});

router.get('/metrics', (req, res) => {
    const result = handleMetrics();
    res.status(result.status).set('Content-Type', result.contentType ?? 'text/plain').send(result.body);
});

export default router;
```

**Nota importante sobre os handlers atuais**:
Os handlers em `terminal/handlers/` retornam `{ status: number; body: unknown; cors?: boolean }`, não
são handlers Express nativos. O wrapper `res.status(result.status).json(result.body)` é suficiente.
Para handlers assíncronos, wrapper com `async/await` + `next(e)`.

---

### L55.2 — Criar `src/copilot/server/routes/agent.js`

```js
// @ts-check — todas as 10 rotas do grupo agent
import { Router } from 'express';
import {
    handleInject, handlePipeline, handleGetContext, handleGetQuota,
    handleDialogPause, handleDialogResume, handleGetHandoffs,
    handleAcceptHandoff, handleRejectHandoff,
} from '../../terminal/handlers/agent.js';

const router = Router();

// POST /inject (async, rate: inject)
router.post('/inject', async (req, res, next) => {
    try {
        const result = await handleInject(req.body);
        res.status(result.status).json(result.body);
    } catch(e) { next(e); }
});

// POST /pipeline (async, rate: write)
router.post('/pipeline', async (req, res, next) => {
    try {
        const result = await handlePipeline(req.body);
        res.status(result.status).json(result.body);
    } catch(e) { next(e); }
});

// (demais rotas seguindo o mesmo padrão — ver implementação completa)
export default router;
```

---

### L55.3 — Criar `src/copilot/server/routes/config.js`

> Agrupa: GET/PUT/POST/DELETE de /config, /config/skills, /config/tools, /config/tools/custom,
> /config/infinite-session.

### L55.4 — Criar `src/copilot/server/routes/memory.js`

> Agrupa: GET/POST/DELETE de /memory, GET /sessions, GET /sessions/:id/turns.

### L55.5 — Criar `src/copilot/server/routes/observability.js`

> Agrupa: /errors, /tool-stats, /history, /audit, /pr-budget, POST /system/reset.

### L55.6 — Criar `src/copilot/server/routes/git.js` + `github.js`

> Agrupa: /git/status, /git/log, /gh/issues, /gh/prs, /gh/ci.

### L55.7 — Criar `src/copilot/server/routes/sse.js`

> SSE handler Express. Mais complexo — precisa gerenciar `res.writeHead` diretamente
> (SSE não usa `res.json()`). Reaproveitará `getSseClients()`, `getTerminalReplayBuffer()` de
> `terminal/state.js` (que posteriormente serão movidos).

```js
// @ts-check
import { Router } from 'express';
import { getSseClients, getSseCriticalClients, getTerminalReplayBuffer } from '../../terminal/state.js';
import { MAX_SSE_CLIENTS } from '#copilot/config';

const router = Router();

router.get('/events', (req, res) => {
    const isCriticalOnly = req.query['level'] === 'critical';
    const _sseClients = getSseClients();
    const _sseCriticalClients = getSseCriticalClients();
    if (_sseClients.size + _sseCriticalClients.size >= MAX_SSE_CLIENTS) {
        res.status(429).json({ ok: false, error: 'Limite de clientes SSE atingido' });
        return;
    }
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
    });
    res.write(`: connected (level=${isCriticalOnly ? 'critical' : 'all'})\n\n`);

    const lastEventId = Number(req.headers['last-event-id']) || 0;
    if (lastEventId > 0) {
        const missed = getTerminalReplayBuffer().getAfter(lastEventId);
        for (const evt of missed) {
            if (res.writableEnded) break;
            res.write(`id: ${evt.id}\nevent: ${String(evt.event).replace(/[\r\n]/g, '_')}\ndata: ${JSON.stringify(evt.data)}\n\n`);
        }
    }

    const heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(': heartbeat\n\n');
        else clearInterval(heartbeat);
    }, 30_000);

    const clients = isCriticalOnly ? _sseCriticalClients : _sseClients;
    clients.add(res);
    req.on('close', () => { clearInterval(heartbeat); clients.delete(res); });
});

export default router;
```

---

### L55.8 — Criar `src/copilot/server/router.js`

```js
// src/copilot/server/router.js
// @ts-check
import agentRouter from './routes/agent.js';
import configRouter from './routes/config.js';
import gitRouter from './routes/git.js';
import githubRouter from './routes/github.js';
import healthRouter from './routes/health.js';
import memoryRouter from './routes/memory.js';
import observabilityRouter from './routes/observability.js';
import sseRouter from './routes/sse.js';

/**
 * Monta todos os routers do copilot server no app Express.
 *
 * @param {import('express').Application} app
 * @returns {void}
 */
export function mountCopilotRoutes(app) {
    app.use('/', healthRouter);
    app.use('/', agentRouter);
    app.use('/', configRouter);
    app.use('/', memoryRouter);
    app.use('/', observabilityRouter);
    app.use('/', gitRouter);
    app.use('/', githubRouter);
    app.use('/', sseRouter);
}
```

**Commit da Onda 3.1**: `refactor(onda3.1): L55.1-L55.8 — copilot/server/routes/* Express routers`

---

## ONDA 3.2 — SOCKET.IO + SERVER COMPLETO

> **Objetivo**: Esta é a onda mais crítica. Cria o copilot server funcional com Socket.IO.
> Ao final, o copilot server pode ser iniciado como alternativa ao `terminal/server.js`.
>
> **Invariante**: `terminal/index.js` ainda usa `createInjectServer()`. A mudança é opt-in.

### L56.1 — Verificar/adicionar dependências

```bash
# Verificar se express e socket.io já existem:
node -e "import('express').then(m => console.log('express ok')).catch(() => console.log('express MISSING'))"
node -e "import('socket.io').then(m => console.log('socket.io ok')).catch(() => console.log('socket.io MISSING'))"
```

Se `express` não existir:
```bash
npm install express
npm install --save-dev @types/express  # para TypeScript/JSDoc
```

Se `socket.io` não existir (improvável — já está no server de produção):
```bash
npm install socket.io
```

---

### L56.2 — Criar `src/copilot/server/socket/hub-ns.js`

**Mover** a lógica de `conversation-hub/socket-ns.js` para `server/socket/hub-ns.js`.
O arquivo original em `conversation-hub/socket-ns.js` vira re-export:

```js
// conversation-hub/socket-ns.js (após Onda 3.2)
// @deprecated — lógica movida para src/copilot/server/socket/hub-ns.js
export { mountCopilotNamespace, getCopilotNamespace, unmountCopilotNamespace,
         broadcastToSession, broadcastGlobal } from '../server/socket/hub-ns.js';
```

O arquivo `server/socket/hub-ns.js` recebe o conteúdo integral dos 458 LOC originais (sem mudanças de lógica).

---

### L56.3 — Criar `src/copilot/server/socket/index.js`

```js
// src/copilot/server/socket/index.js
// @ts-check
import { Server as SocketServer } from 'socket.io';
import { conversationHub } from '../../conversation-hub/hub.js';
import { mountCopilotNamespace } from './hub-ns.js';

/**
 * @typedef {Object} CopilotSocketInstance
 * @property {SocketServer} io - Socket.IO server
 */

/**
 * Cria e configura o Socket.IO server do copilot.
 *
 * Monta namespaces:
 * - `/copilot` — ConversationHub (sessões, turns, inject em tempo real)
 * - `/events` — Stream de eventos SSE upgradeados para WS (futuro)
 *
 * @param {import('node:http').Server} httpServer
 * @returns {CopilotSocketInstance}
 */
export function createCopilotSocket(httpServer) {
    const io = new SocketServer(httpServer, {
        cors: {
            origin: '*',   // loopback only — wildcard seguro
            methods: ['GET', 'POST'],
        },
        path: '/socket.io',
        transports: ['websocket', 'polling'],
    });

    // Namespace /copilot: ConversationHub
    mountCopilotNamespace(
        io,
        conversationHub.orchestrator,
        conversationHub.store,
    );

    return { io };
}
```

---

### L56.4 — Completar `src/copilot/server/index.js`

Substituir o stub por implementação real:

```js
// src/copilot/server/index.js
// @ts-check
import http from 'node:http';
import { LLM_B_TERMINAL_PORT } from '#copilot/config';
import { log } from '#copilot/observability';
import { createCopilotApp } from './app.js';
import { createCopilotSocket } from './socket/index.js';
import { mountCopilotRoutes } from './router.js';
import { registerShutdownHandler } from '#copilot/core';

/**
 * @typedef {Object} CopilotServerInstance
 * @property {import('express').Application} app
 * @property {import('node:http').Server} server
 * @property {import('socket.io').Server} io
 * @property {number} port
 */

/**
 * Cria e inicializa o Copilot Server completo (Express + Socket.IO).
 *
 * @param {{ port?: number }} [opts]
 * @returns {Promise<CopilotServerInstance>}
 */
export async function startCopilotServer(opts = {}) {
    const port = opts.port ?? LLM_B_TERMINAL_PORT;
    const { app } = createCopilotApp();
    const server = http.createServer(app);
    const { io } = createCopilotSocket(server);

    // Montar todos os routers REST
    mountCopilotRoutes(app);

    return new Promise((resolve, reject) => {
        server.listen(port, '127.0.0.1', () => {
            log('INFO', `[CopilotServer] Servidor ativo em http://127.0.0.1:${port}`);
            log('INFO', `[CopilotServer] Socket.IO ativo em ws://127.0.0.1:${port}/socket.io`);

            registerShutdownHandler('copilot.server', async () => {
                await new Promise((res) => server.close(res));
                log('INFO', '[CopilotServer] Servidor encerrado via shutdown handler.');
            }, 20);

            resolve({ app, server, io, port });
        });
        server.on('error', reject);
    });
}

export { createCopilotApp } from './app.js';
export { createCopilotSocket } from './socket/index.js';
```

---

### L56.5 — Criar smoke test para o novo server

```js
// scripts/check-copilot-server.mjs
// Verifica que o copilot server pode ser importado sem erros (sem inicializar)
import { createCopilotApp } from '../src/copilot/server/app.js';
import { mountCopilotRoutes } from '../src/copilot/server/router.js';

const { app } = createCopilotApp();
mountCopilotRoutes(app);
console.log('✅ Copilot server scaffold OK');
```

**Commit da Onda 3.2**: `feat(onda3.2): L56.1-L56.5 — copilot/server completo com Express+Socket.IO`

---

## ONDA 3.3 — MIGRAR TERMINAL PARA USAR NOVO SERVER

> **Objetivo**: Substituir `createInjectServer()` por `startCopilotServer()` no `terminal/index.js`.
> Após esta onda, o copilot server é o único servidor HTTP do copilot.
>
> **Risco**: Alta — muda o servidor ativo. Testar extensivamente antes do commit.

### L57.1 — Atualizar `terminal/index.js`

**Mudança cirúrgica**: Substituir as 4 linhas que criam/iniciam o inject server:

```js
// ANTES (linhas ~115-120 de terminal/index.js):
const injectServer = createInjectServer();
// ...
registerShutdownHandler('terminal.injectServer', async () => {
    await new Promise((resolve) => injectServer.close(resolve));
    log('INFO', '[TerminalServer] Inject server encerrado via shutdown handler.');
}, 20);
await startRepl(injectServer);

// DEPOIS:
const { server: copilotServer, io } = await startCopilotServer();
// Hub agora recebe io! (não mais initStandalone)
// (a linha de initStandalone abaixo também muda)
// ...
// registerShutdownHandler já está em startCopilotServer
await startRepl(copilotServer);  // passa o server para o REPL (para graceful close)
```

**Mudança na inicialização do hub** (no mesmo arquivo):

```js
// ANTES (linhas ~140-147):
conversationHub.initStandalone();

// DEPOIS:
// hub já foi inicializado pelo socket — verificar se initStandalone ainda é necessário como fallback
// Se já foi montado pelo socket, initStandalone é no-op (conversationHub.isInitialized check)
```

**Verificar `hub.js`**: Se já tem guarda de dupla inicialização (`if (this._initialized) return`), é seguro.
Se não tem, adicionar:

```js
// em hub.js init():
if (this._initialized) return;
this._initialized = true;
```

---

### L57.2 — Deprecar `terminal/server.js`

Adicionar header de deprecação **no topo do arquivo**:

```js
/**
 * @deprecated L57.2 — Servidor HTTP nativo substituído por copilot/server/index.js na Onda 3.3.
 * Este arquivo será removido na Onda 3.7. Mantido temporariamente como referência.
 * Use `startCopilotServer()` de '../server/index.js' em vez de `createInjectServer()`.
 */
```

---

### L57.3 — Deprecar `terminal/route-table.js`

Adicionar header de deprecação:

```js
/**
 * @deprecated L57.3 — Tabela de rotas substituída por Express routers em copilot/server/routes/.
 * Este arquivo será removido na Onda 3.7.
 */
```

---

### L57.4 — Smoke test pós-migração

```bash
# 1. Verificar que terminal still boots (funcional)
npm run terminal:llm-b &
TERMINAL_PID=$!
sleep 3
curl -s http://127.0.0.1:3009/health | jq .ok  # deve retornar true
curl -s http://127.0.0.1:3009/ws/info           # NOVO: info sobre conexões socket
kill $TERMINAL_PID

# 2. Verificar lint e typecheck
npm run lint
npm run typecheck:node

# 3. Smoke test oficial
node scripts/check-copilot-autonomy.mjs
```

**Commit da Onda 3.3**: `refactor(onda3.3): L57.1-L57.4 — terminal migrado para copilot/server`

---

## ONDA 3.4 — CONVERSATION HUB COM SOCKET REAL

> **Objetivo**: Ativar o ConversationHub com socket.io real (não mais `initStandalone`).
> Dashboard pode se conectar via `ws://localhost:3009/socket.io` namespace `/copilot`.
>
> **Referência**: Resolve P2 (socket.io namespace existia mas nunca inicializado standalone)

### L58.1 — Verificar estado atual do `hub.js`

Ler as linhas de inicialização e verificar se `initStandalone()` pode ser removido sem quebrar:

- `initStandalone()` chama: store.init() + orchestrator.init() — **sem** socket
- `init({ io })` chama: store.init() + orchestrator.init() + `mountCopilotNamespace(io, ...)`

A mudança de `initStandalone()` para `init({ io })` do novo server é feita na Onda 3.3 (L57.1).
Nesta onda (3.4), o foco é garantir que o namespace funciona corretamente e remover `initStandalone()`.

---

### L58.2 — Adicionar `isInitialized` guard no `hub.js`

```js
// em hub.js
class ConversationHub {
    _initialized = false;

    init(opts = {}) {
        if (this._initialized) {
            log('WARN', '[ConversationHub] init() chamado mais de uma vez — ignorando.');
            return;
        }
        this._initialized = true;
        // ... restante do init
    }

    initStandalone() {
        // Durante transição, initStandalone é alias para init sem io
        log('WARN', '[ConversationHub] initStandalone() é deprecated. Use init() com o io do copilot server.');
        this.init({});
    }
}
```

---

### L58.3 — Adicionar rota REST `/ws/info`

**Nova rota** expondo informações sobre conexões socket ativas:

```js
// em server/routes/health.js
router.get('/ws/info', (req, res) => {
    const ns = getCopilotNamespace();
    if (!ns) {
        res.json({ ok: true, connected: 0, namespaces: [] });
        return;
    }
    ns.fetchSockets().then(sockets => {
        res.json({
            ok: true,
            connected: sockets.length,
            namespaces: ['/copilot'],
            socketIds: sockets.map(s => s.id),
        });
    }).catch(() => res.json({ ok: true, connected: 0, error: 'namespace query failed' }));
});
```

---

### L58.4 — Smoke test de socket.io

```js
// scripts/check-copilot-socket.mjs
import { io } from 'socket.io-client';
const socket = io('http://localhost:3009', { namespace: '/copilot' });
socket.on('connect', () => {
    console.log('✅ Socket /copilot conectado');
    socket.emit('sessions:list', {});
});
socket.on('sessions:list:result', (data) => {
    console.log(`✅ sessions:list funcionando — ${data.sessions.length} sessões`);
    socket.disconnect();
    process.exit(0);
});
setTimeout(() => { console.error('❌ Timeout'); process.exit(1); }, 5000);
```

**Commit da Onda 3.4**: `feat(onda3.4): L58.1-L58.4 — hub com Socket.IO real, /ws/info`

---

## ONDA 3.5 — TERMINAL CLEANUP (UI-ONLY)

> **Objetivo**: Limpar `terminal/` de qualquer responsabilidade do servidor HTTP.
> Após esta onda, `terminal/` contem apenas: REPL, comandos, dialog, DI wiring, agent wiring.
>
> **Arquivos a mover**:
> - `terminal/state.js` → `server/sse/state.js` (SSE client state)
> - `terminal/rate-limiter-state.js` → `server/middleware/rate-limiter-state.js`

### L59.1 — Mover `terminal/state.js` para `server/sse/state.js`

**Ação**: `cp terminal/state.js server/sse/state.js` + atualizar imports.

`terminal/state.js` exporta:
- `getSseClients()` — Set de response SSE
- `getSseCriticalClients()` — Set de response SSE critical
- `getTerminalReplayBuffer()` — ReplayBuffer
- `getHubSessionId()` / `setHubSessionId()` — hub session id

O hub session id pode ficar em `terminal/state.js` (pertence ao terminal).
SSE client state vai para `server/sse/state.js`.

**Após mover**: Atualizar imports em:
- `server/routes/sse.js` — importa de `server/sse/state.js`
- `terminal/dialog.js` — ainda pode importar de `server/sse/state.js` (cross-module OK pois dialog também é infra)
- Todos os handlers que usam `broadcastSse()` — ver se via dialog.js ou diretamente

---

### L59.2 — Mover `terminal/rate-limiter-state.js` para `server/middleware/rate-limiter-state.js`

```bash
# Verificar o que rate-limiter-state.js exporta
head -40 src/copilot/terminal/rate-limiter-state.js
```

Provavelmente: `registerClearRateLimiters()` e `clearAllRateLimiters()`.
Após mover, atualizar imports em `server/middleware/rate-limiter.js`.

---

### L59.3 — Verificar que `terminal/` não importa mais de transportes

```bash
rg "from.*server\.js|from.*route-table|from.*rate-limiter-state|from.*state\.js" src/copilot/terminal/ --include="*.js"
```

Após limpeza, apenas imports legítimos devem existir:
- `terminal/index.js` importa de `server/index.js` (**OK** — é o bootstrap)
- Nenhum outro arquivo de terminal importa servidor/rotas/state SSE

**Commit da Onda 3.5**: `refactor(onda3.5): L59.1-L59.3 — terminal cleanup, state SSE para server/`

---

## ONDA 3.6 — SSE MOVER PARA server/sse/ + api/ CLEANUP

> **Objetivo**: Mover `api/sse/` para `server/sse/`. Resolver status dos arquivos órfãos em `api/`.

### L60.1 — Mover `api/sse/fanout.js`, `api/sse/replay-buffer.js`, `api/sse/utils.js`

```bash
mkdir -p src/copilot/server/sse/
cp src/copilot/api/sse/fanout.js src/copilot/server/sse/fanout.js
cp src/copilot/api/sse/replay-buffer.js src/copilot/server/sse/replay-buffer.js
cp src/copilot/api/sse/utils.js src/copilot/server/sse/utils.js
```

Marcar `api/sse/` como deprecated (re-exports para manter backward compat):

```js
// api/sse/fanout.js (após mover)
/** @deprecated Use '../server/sse/fanout.js' */
export * from '../../server/sse/fanout.js';
```

---

### L60.2 — Auditar `api/bridge/` e `api/express/`

Verificar se estão sendo importados em algum lugar ativo:

```bash
rg "from.*api/bridge|from.*api/express|from.*copilot/api" src/ --include="*.js" | grep -v "deprecated\|node_modules"
```

Se não importados: marcar como `@deprecated` com nota sobre Onda 3.7 (remoção).
Se importados por algo ativo: integrar ao `server/routes/sdk.js`.

---

### L60.3 — Criar `server/routes/sdk.js` (se api/express/ tiver valor)

Se `api/express/` contém `createSdkApiRouter()` com rotas `/sdk/*`:

```js
// server/routes/sdk.js
// Integra SDK API como router Express no copilot server
import { Router } from 'express';
// ... importar handlers de sdk/
```

Adicionar `/sdk` ao `mountCopilotRoutes()` em `router.js`.

---

### L60.4 — Mover `api/openapi.json` para `server/openapi.json`

Atualizar com novos endpoints:
- `/ws/info`
- `/sdk/*` (se aplicável)
- Todos os 38 endpoints existentes

Criar rota que serve o spec:
```js
router.get('/openapi.json', (req, res) => {
    res.sendFile(new URL('./openapi.json', import.meta.url).pathname);
});
```

**Commit da Onda 3.6**: `refactor(onda3.6): L60.1-L60.4 — sse para server/, api/ cleanup`

---

## ONDA 3.7 — BOOTSTRAP ISOLADO + CONVERSATION HUB DOMAIN-PURE

> **Objetivo**: Criar `src/copilot/bootstrap/` como pasta dedicada. Tornar o `conversation-hub/`
> domínio puro (sem socket.io como dependência).

### L61.1 — Criar `src/copilot/bootstrap/index.js`

Mover `bootstrap.js` (raiz) para `bootstrap/index.js`:

```js
// src/copilot/bootstrap/index.js
// @ts-check
/**
 * @module copilot/bootstrap
 * @file Bootstrap canônico do copilot — entry point único.
 *
 * Fases:
 * 1. Observability
 * 2. Late deps (tools, audit bus)
 * 3. startCopilotServer() — inicia Express + Socket.IO + Terminal
 */
export { bootCopilot } from './boot.js';
```

```js
// src/copilot/bootstrap/boot.js
// @ts-check
import { bootstrapObservability } from '../observability/index.js';
import { bootstrapLateDeps } from '../agent/bootstrap.js';
import { startCopilotServer } from '../server/index.js';

let _booted = false;

export async function bootCopilot() {
    if (_booted) return;
    _booted = true;
    bootstrapObservability();
    bootstrapLateDeps({ buildTool: (await import('../tools/build-tool.js')).default });
    await startCopilotServer();
}
```

---

### L61.2 — Manter `src/copilot/bootstrap.js` como re-export (backward compat)

```js
// src/copilot/bootstrap.js
/** @deprecated Use 'src/copilot/bootstrap/index.js' diretamente. */
export { bootCopilot } from './bootstrap/index.js';
```

---

### L61.3 — Criar `src/copilot/bootstrap/README.md`

Documentação da pasta bootstrap — entry points, fases, env vars relevantes.

---

### L61.4 — Adicionar `SocketAdapter` ao `conversation-hub/`

Criar interface limpa para o hub não depender do socket.io diretamente:

```js
// conversation-hub/socket-adapter.js
// @ts-check

/**
 * @typedef {Object} SocketAdapter
 * @property {(event: string, data: unknown) => void} broadcast
 * @property {(sessionId: string, event: string, data: unknown) => void} emit
 */

/** @type {SocketAdapter} */
export const nullSocketAdapter = { broadcast: () => {}, emit: () => {} };

/**
 * Cria um SocketAdapter a partir de um Socket.IO namespace já montado.
 *
 * @param {import('socket.io').Namespace} ns
 * @returns {SocketAdapter}
 */
export function createNamespaceAdapter(ns) {
    return {
        broadcast: (event, data) => ns.emit(event, data),
        emit: (sessionId, event, data) => ns.to(sessionId).emit(event, data),
    };
}
```

Atualizar `hub.js` para aceitar `socketAdapter` via DI em vez de importar socket-ns.js diretamente.

**Commit da Onda 3.7**: `refactor(onda3.7): L61.1-L61.4 — bootstrap isolado, hub domain-pure`

---

## ONDA 3.8 — SMOKE TESTS ATUALIZADOS + VALIDAÇÃO FINAL

> **Objetivo**: Garantir que todos os critérios de sucesso são atendidos. Preparar o sistema para
> crescimento futuro.

### L62.1 — Atualizar `check-copilot-autonomy.mjs` (10 checks)

Adicionar os novos checks:
- Check 6: `server/index.js` existe e exporta `startCopilotServer`
- Check 7: `server/socket/hub-ns.js` existe (namespace /copilot)
- Check 8: `terminal/server.js` está deprecated (contém `@deprecated L57.2`)
- Check 9: `terminal/` não importa de `server.js` ou `route-table.js` diretamente
- Check 10: `bootstrap/index.js` existe e exporta `bootCopilot`

---

### L62.2 — Criar `check-copilot-server.mjs`

Smoke test de importação do server:

```js
// scripts/check-copilot-server.mjs
// Verifica estrutura do copilot server sem inicializar

import { createCopilotApp } from '../src/copilot/server/app.js';
import { mountCopilotRoutes } from '../src/copilot/server/router.js';
import { healthRouter, agentRouter } from '../src/copilot/server/routes/index.js';

// Check 1: createCopilotApp() funciona
const { app } = createCopilotApp({ token: 'test-smoke' });
console.assert(typeof app.get === 'function', 'app deve ser Express');
console.log('✅ Check 1: createCopilotApp OK');

// Check 2: mountCopilotRoutes() funciona
mountCopilotRoutes(app);
console.log('✅ Check 2: mountCopilotRoutes OK');

// Check 3: routers importam corretamente
console.assert(healthRouter && agentRouter, 'routers devem existir');
console.log('✅ Check 3: routers OK');

console.log('✅ Copilot server smoke test concluído (3/3)');
```

---

### L62.3 — Atualizar `scripts/check-copilot-autonomy.mjs`

Substituir Check 4 (server/wiring.js deprecated) por Check 4 atualizado (server/index.js existe).

---

### L62.4 — Rodar validação final

```bash
npm run lint
npm run typecheck:node
node scripts/check-copilot-autonomy.mjs
node scripts/check-copilot-server.mjs
```

**Commit da Onda 3.8**: `test(onda3.8): L62.1-L62.4 — smoke tests completos do copilot server`

---

## ONDA 3.9 — REMOÇÃO DE LEGADOS + DOCUMENTAÇÃO FINAL

> **Objetivo**: Remover arquivos deprecated (se nada os importar), consolidar documentação.

### L63.1 — Remoção de arquivos deprecated

Antes de remover, verificar:

```bash
# Verificar todos os arquivos deprecated criados nesta série de ondas
# e se têm importadores activos:

rg "from.*terminal/server|from.*terminal/route-table" src/ --include="*.js"
# Esperado: apenas re-exports ou arquivos deprecated

rg "from.*server/wiring" src/ --include="*.js"
# Esperado: nenhum

rg "from.*api/bridge" src/ --include="*.js"
# Esperado: nenhum ou apenas deprecated
```

| Arquivo                                      | Dependência zero?         | Ação                                             |
| -------------------------------------------- | ------------------------- | ------------------------------------------------ |
| `src/copilot/server/wiring.js`               | sim (desde Onda 2.7)      | Remover                                          |
| `src/copilot/terminal/server.js`             | sim (desde Onda 3.3)      | Remover                                          |
| `src/copilot/terminal/route-table.js`        | sim (desde Onda 3.3)      | Remover                                          |
| `src/copilot/terminal/rate-limiter-state.js` | sim (desde Onda 3.5)      | Remover                                          |
| `src/copilot/api/bridge/`                    | verificar                 | Remover se órfão                                 |
| `src/copilot/api/sse/`                       | re-exports de server/sse/ | Manter re-exports ou remover se sem importadores |

---

### L63.2 — Limpar `src/copilot/server/wiring.js`

Já deprecated desde Onda 2.7. Remover.

---

### L63.3 — Atualizar `src/copilot/README.md`

Estrutura de módulos atualizada com:
- Novo mapa de `server/`
- Descrição de `bootstrap/`
- Status de `api/`
- Tabela de rotas atualizada

---

### L63.4 — Atualizar `ARCHITECTURE.md` main

Seção copilot — refletir nova arquitetura.

---

### L63.5 — Commit final

```
docs(onda3.9): L63.1-L63.5 — remoção de legados, documentação final copilot server
```

---

## RESUMO DE TODAS AS ONDAS

| Onda | Label | objetivo                            | Invariante                               | Commit              |
| ---- | ----- | ----------------------------------- | ---------------------------------------- | ------------------- |
| 3.0  | L54.x | Scaffold server/ + middleware       | server não inicia, terminal igual        | `refactor(onda3.0)` |
| 3.1  | L55.x | Express routers por domínio         | routers existem, não montados ainda      | `refactor(onda3.1)` |
| 3.2  | L56.x | Socket.IO + server completo         | server pode ser iniciado opcionalmente   | `feat(onda3.2)`     |
| 3.3  | L57.x | Terminal usa novo server            | server é o servidor ativo em :3009       | `refactor(onda3.3)` |
| 3.4  | L58.x | Hub com Socket.IO real              | dashboard se conecta via WS              | `feat(onda3.4)`     |
| 3.5  | L59.x | Terminal cleanup (UI-only)          | terminal/ sem lógica de servidor         | `refactor(onda3.5)` |
| 3.6  | L60.x | SSE para server/, api/ cleanup      | api/sse/ deprecated, server/sse/ ativo   | `refactor(onda3.6)` |
| 3.7  | L61.x | Bootstrap isolado + hub domain-pure | bootstrap/ folder, hub sem socket.io dep | `refactor(onda3.7)` |
| 3.8  | L62.x | Smoke tests atualizados             | 10 checks, check-copilot-server.mjs      | `test(onda3.8)`     |
| 3.9  | L63.x | Remoção de legados + docs           | Sistema limpo, 0 arquivos deprecated     | `docs(onda3.9)`     |

---

## CRITÉRIOS DE SUCESSO FINAIS

### Estrutura
- [ ] `src/copilot/server/` contém: index.js, app.js, router.js, socket/, middleware/, routes/, sse/
- [ ] `src/copilot/bootstrap/` contém: index.js, boot.js, README.md
- [ ] `src/copilot/terminal/` contém apenas: REPL, comandos, dialog, DI wiring, agent wiring
- [ ] `src/copilot/conversation-hub/` é domínio puro sem socket.io como dep direta

### Comportamental
- [ ] `npm run terminal:llm-b` funciona exatamente como antes
- [ ] Porta :3009 continua ativa com todos os 38+ endpoints no mesmo path
- [ ] Header auth `Authorization: Bearer <TOKEN>` funciona
- [ ] SSE `/events` funciona com replay
- [ ] ConversationHub inicializa com socket.io real
- [ ] Dashboard pode se conectar via `ws://localhost:3009/socket.io` namespace `/copilot`

### Qualidade
- [ ] `npm run lint` → 0 erros
- [ ] `npm run typecheck:node` → 0 erros
- [ ] `node scripts/check-copilot-autonomy.mjs` → 10/10 checks
- [ ] `node scripts/check-copilot-server.mjs` → 3/3 checks

### Arquitetural
- [ ] Score arquitetural: ≥ 8.5/10 (partindo de 4.7)
- [ ] Zero circular dependencies entre server/ e terminal/
- [ ] `server/` não importa nada de `src/server/` (produção permanece separado)

---

## APÊNDICE: MAPA DE MOVES DE ARQUIVOS

| Arquivo original                 | Destino                                   | Tipo de mudança  |
| -------------------------------- | ----------------------------------------- | ---------------- |
| `terminal/server.js`             | DEPRECATED → removido                     | Delete           |
| `terminal/route-table.js`        | DEPRECATED → removido                     | Delete           |
| `terminal/rate-limiter-state.js` | `server/middleware/rate-limiter-state.js` | Move             |
| `terminal/state.js` (SSE parts)  | `server/sse/state.js`                     | Move parcial     |
| `conversation-hub/socket-ns.js`  | `server/socket/hub-ns.js` + re-export     | Move + re-export |
| `api/sse/fanout.js`              | `server/sse/fanout.js` + re-export        | Move + re-export |
| `api/sse/replay-buffer.js`       | `server/sse/replay-buffer.js` + re-export | Move + re-export |
| `api/sse/utils.js`               | `server/sse/utils.js` + re-export         | Move + re-export |
| `api/openapi.json`               | `server/openapi.json`                     | Move + update    |
| `bootstrap.js`                   | `bootstrap/index.js` + re-export          | Move + re-export |
| `server/wiring.js`               | DEPRECATED → removido                     | Delete           |

---

## APÊNDICE: NOVOS ARQUIVOS CRIADOS

```
src/copilot/
├── bootstrap/
│   ├── index.js         (L61.1)
│   ├── boot.js          (L61.1)
│   └── README.md        (L61.3)
└── server/
    ├── index.js         (L54.7 + L56.4)
    ├── app.js           (L54.6)
    ├── router.js        (L55.8)
    ├── middleware/
    │   ├── auth.js      (L54.1)
    │   ├── rate-limiter.js  (L54.2)
    │   ├── rate-limiter-state.js  (L59.2)
    │   ├── error-handler.js (L54.3)
    │   ├── cors.js      (L54.4)
    │   └── request-id.js   (L54.5)
    ├── routes/
    │   ├── health.js    (L55.1)
    │   ├── agent.js     (L55.2)
    │   ├── config.js    (L55.3)
    │   ├── memory.js    (L55.4)
    │   ├── observability.js  (L55.5)
    │   ├── git.js       (L55.6)
    │   ├── github.js    (L55.6)
    │   ├── sse.js       (L55.7)
    │   └── sdk.js       (L60.3 — opcional)
    ├── socket/
    │   ├── index.js     (L56.3)
    │   └── hub-ns.js    (L56.2 — movido de conversation-hub/)
    └── sse/
        ├── state.js     (L59.1)
        ├── fanout.js    (L60.1)
        ├── replay-buffer.js  (L60.1)
        └── utils.js     (L60.1)
```

---

## CHANGELOG

| Versão | Data       | Mudanças                                              |
| ------ | ---------- | ----------------------------------------------------- |
| 1.0    | 2026-04-12 | Roadmap ultra-detalhado Onda 3.0–3.9, com código real |
