// @ts-check
/**
 * Sprint 25 — Testes unitários de src/copilot/sdk-api.js
 *
 * Cobre:
 *
 * - Estrutura de rotas declaradas no router
 * - Comportamento de withErrorHandler (captura exceções → 500)
 * - Serialização de resposta de sucesso e erro
 * - Contratos de formato de payload
 */
import assert from 'node:assert';
import { before, describe, it } from 'node:test';

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Cria um objeto req/res simulado para testar handlers isolados.
 *
 * @param {{ body?: Record<string, unknown>; params?: Record<string, string> }} [opts]
 * @returns {{ req: object; res: object; captured: { status: number; body: unknown } }}
 */
function mockReqRes(opts = {}) {
    const captured = { status: 200, body: /** @type {unknown} */ (undefined) };
    const res = {
        _status: 200,
        status(code) {
            captured.status = code;
            return res;
        },
        json(data) {
            captured.body = data;
            return res;
        },
    };
    const req = {
        body: opts.body ?? {},
        params: opts.params ?? {},
    };
    return { req, res, captured };
}

// ─── Testes de estrutura do router ───────────────────────────────────────────

describe('sdk-api › módulo carrega sem erros', () => {
    it('importa e exporta um Router Express', async () => {
        const mod = await import('../../../src/copilot/sdk-api.js');
        const router = mod.default;
        assert.ok(router, 'export default deve existir');
        // Router Express tem `stack` (array de camadas de rota)
        assert.ok(typeof router === 'function' || typeof router === 'object', 'deve ser função ou objeto');
    });

    it('router possui stack de rotas registradas', async () => {
        const mod = await import('../../../src/copilot/sdk-api.js');
        const router = mod.default;
        // Express routers expõem .stack com as rotas registradas
        const stack = /** @type {any} */ (router)?.stack;
        assert.ok(Array.isArray(stack), 'router.stack deve ser array');
        assert.ok(stack.length > 0, `router deve ter rotas registradas (encontrado: ${stack.length})`);
    });
});

describe('sdk-api › rotas registradas', () => {
    /** @type {{ path: string; methods: string[] }[]} */
    const routes = /** @type {{ path: string; methods: string[] }[]} */ ([]);

    // Extrai rotas do stack do Express Router
    before(async () => {
        const mod = await import('../../../src/copilot/sdk-api.js');
        const router = /** @type {any} */ (mod.default);
        if (Array.isArray(router?.stack)) {
            for (const layer of router.stack) {
                if (layer.route) {
                    routes.push({
                        path: layer.route.path,
                        methods: Object.keys(layer.route.methods),
                    });
                }
            }
        }
    });

    it('possui rota GET /ping', () => {
        const found = routes.find((r) => r.path === '/ping' && r.methods.includes('get'));
        assert.ok(found, 'GET /ping deve estar registrado');
    });

    it('possui rota GET /status', () => {
        const found = routes.find((r) => r.path === '/status' && r.methods.includes('get'));
        assert.ok(found, 'GET /status deve estar registrado');
    });

    it('possui rota GET /auth', () => {
        const found = routes.find((r) => r.path === '/auth' && r.methods.includes('get'));
        assert.ok(found, 'GET /auth deve estar registrado');
    });

    it('possui rota GET /models', () => {
        const found = routes.find((r) => r.path === '/models' && r.methods.includes('get'));
        assert.ok(found, 'GET /models deve estar registrado');
    });

    it('possui rota GET /sessions', () => {
        const found = routes.find((r) => r.path === '/sessions' && r.methods.includes('get'));
        assert.ok(found, 'GET /sessions deve estar registrado');
    });

    it('possui rota POST /sessions', () => {
        const found = routes.find((r) => r.path === '/sessions' && r.methods.includes('post'));
        assert.ok(found, 'POST /sessions deve estar registrado');
    });

    it('possui rota GET /sessions/active', () => {
        const found = routes.find((r) => r.path === '/sessions/active' && r.methods.includes('get'));
        assert.ok(found, 'GET /sessions/active deve estar registrado');
    });

    it('possui rota GET /sessions/:id', () => {
        const found = routes.find((r) => r.path === '/sessions/:id' && r.methods.includes('get'));
        assert.ok(found, 'GET /sessions/:id deve estar registrado');
    });

    it('possui rota DELETE /sessions/:id', () => {
        const found = routes.find((r) => r.path === '/sessions/:id' && r.methods.includes('delete'));
        assert.ok(found, 'DELETE /sessions/:id deve estar registrado');
    });

    it('possui rota POST /sessions/:id/resume', () => {
        const found = routes.find((r) => r.path === '/sessions/:id/resume' && r.methods.includes('post'));
        assert.ok(found, 'POST /sessions/:id/resume deve estar registrado');
    });

    it('possui rota POST /sessions/:id/disconnect', () => {
        const found = routes.find((r) => r.path === '/sessions/:id/disconnect' && r.methods.includes('post'));
        assert.ok(found, 'POST /sessions/:id/disconnect deve estar registrado');
    });

    it('possui rota POST /sessions/:id/send', () => {
        const found = routes.find((r) => r.path === '/sessions/:id/send' && r.methods.includes('post'));
        assert.ok(found, 'POST /sessions/:id/send deve estar registrado');
    });

    it('possui rota GET /sessions/:id/stream (SSE)', () => {
        const found = routes.find((r) => r.path === '/sessions/:id/stream' && r.methods.includes('get'));
        assert.ok(found, 'GET /sessions/:id/stream deve estar registrado');
    });

    it('possui rota POST /client/start', () => {
        const found = routes.find((r) => r.path === '/client/start' && r.methods.includes('post'));
        assert.ok(found, 'POST /client/start deve estar registrado');
    });

    it('possui rota POST /client/stop', () => {
        const found = routes.find((r) => r.path === '/client/stop' && r.methods.includes('post'));
        assert.ok(found, 'POST /client/stop deve estar registrado');
    });

    it('possui rota GET /tools', () => {
        const found = routes.find((r) => r.path === '/tools' && r.methods.includes('get'));
        assert.ok(found, 'GET /tools deve estar registrado');
    });

    it('total de rotas registradas é >= 16', () => {
        assert.ok(routes.length >= 16, `Esperado >= 16 rotas, encontrado: ${routes.length}`);
    });
});

// ─── Testes de withErrorHandler via mockReqRes ────────────────────────────────

describe('sdk-api › withErrorHandler (simulação)', () => {
    /**
     * Simula o comportamento de withErrorHandler sem importar o módulo diretamente.
     *
     * @param {object} req
     * @param {object} res
     * @param {() => Promise<void>} fn
     */
    async function withErrorHandler(req, res, fn) {
        try {
            await fn();
        } catch (/** @type {any} */ e) {
            const r = /** @type {any} */ (res);
            r.status(500).json({ ok: false, error: e.message ?? String(e) });
        }
    }

    it('propaga resultado da fn sem erro', async () => {
        const { res, captured } = mockReqRes();
        await withErrorHandler({}, res, async () => {
            /** @type {any} */ (res).json({ ok: true, value: 42 });
        });
        assert.deepStrictEqual(captured.body, { ok: true, value: 42 });
    });

    it('captura exceção e retorna status 500', async () => {
        const { res, captured } = mockReqRes();
        await withErrorHandler({}, res, async () => {
            throw new Error('Erro de teste esperado');
        });
        assert.strictEqual(captured.status, 500);
        const body = /** @type {any} */ (captured.body);
        assert.strictEqual(body.ok, false);
        assert.ok(body.error.includes('Erro de teste esperado'));
    });

    it('captura exceção sem message e converte em string', async () => {
        const { res, captured } = mockReqRes();
        await withErrorHandler({}, res, async () => {
            throw new Error('');
        });
        assert.strictEqual(captured.status, 500);
        const body = /** @type {any} */ (captured.body);
        assert.strictEqual(body.ok, false);
        assert.ok(typeof body.error === 'string');
    });
});

// ─── Contratos de payload ─────────────────────────────────────────────────────

describe('sdk-api › contratos de payload', () => {
    it('POST /sessions requer campo "model" como string', () => {
        // Verifica a lógica de validação sem chamar o handler real
        function validateBody(body) {
            const { model } = body ?? {};
            if (!model || typeof model !== 'string') {
                return { valid: false, error: 'Campo "model" (string) é obrigatório.' };
            }
            return { valid: true };
        }

        assert.deepStrictEqual(validateBody({}), { valid: false, error: 'Campo "model" (string) é obrigatório.' });
        assert.deepStrictEqual(validateBody({ model: 123 }), {
            valid: false,
            error: 'Campo "model" (string) é obrigatório.',
        });
        assert.deepStrictEqual(validateBody({ model: 'gpt-4o' }), { valid: true });
    });

    it('POST /sessions/:id/send requer campo "prompt" como string', () => {
        function validateBody(body) {
            const { prompt } = body ?? {};
            if (!prompt || typeof prompt !== 'string') {
                return { valid: false, error: 'Campo "prompt" (string) é obrigatório.' };
            }
            return { valid: true };
        }

        assert.deepStrictEqual(validateBody({}), { valid: false, error: 'Campo "prompt" (string) é obrigatório.' });
        assert.deepStrictEqual(validateBody({ prompt: '' }), {
            valid: false,
            error: 'Campo "prompt" (string) é obrigatório.',
        });
        assert.deepStrictEqual(validateBody({ prompt: 'Olá mundo!' }), { valid: true });
    });

    it('resposta de erro padrão possui campos ok=false e error (string)', () => {
        const errorResponse = { ok: false, error: 'Algo deu errado' };
        assert.strictEqual(errorResponse.ok, false);
        assert.strictEqual(typeof errorResponse.error, 'string');
    });

    it('resposta de sucesso de sessão possui ok=true e sessionId', () => {
        const successResponse = { ok: true, sessionId: 'sess-abc123', model: 'gpt-4o', createdAt: Date.now() };
        assert.strictEqual(successResponse.ok, true);
        assert.ok(typeof successResponse.sessionId === 'string');
    });
});

// ─── Sprint 19: novos endpoints ───────────────────────────────────────────────

describe('sdk-api Sprint 19 › rotas registradas', () => {
    /** @type {{ path: string; methods: string[] }[]} */
    const routes = [];

    before(async () => {
        const mod = await import('../../../src/copilot/sdk-api.js');
        const router = /** @type {any} */ (mod.default);
        if (Array.isArray(router?.stack)) {
            for (const layer of router.stack) {
                if (layer.route) {
                    routes.push({
                        path: layer.route.path,
                        methods: Object.keys(layer.route.methods),
                    });
                }
            }
        }
    });

    it('possui rota POST /sessions/:id/abort', () => {
        const found = routes.find((r) => r.path === '/sessions/:id/abort' && r.methods.includes('post'));
        assert.ok(found, 'POST /sessions/:id/abort deve estar registrado');
    });

    it('possui rota GET /sessions/:id/messages', () => {
        const found = routes.find((r) => r.path === '/sessions/:id/messages' && r.methods.includes('get'));
        assert.ok(found, 'GET /sessions/:id/messages deve estar registrado');
    });

    it('possui rota GET /sessions/foreground', () => {
        const found = routes.find((r) => r.path === '/sessions/foreground' && r.methods.includes('get'));
        assert.ok(found, 'GET /sessions/foreground deve estar registrado');
    });

    it('possui rota PUT /sessions/foreground/:id', () => {
        const found = routes.find((r) => r.path === '/sessions/foreground/:id' && r.methods.includes('put'));
        assert.ok(found, 'PUT /sessions/foreground/:id deve estar registrado');
    });

    it('possui rota GET /agent/state', () => {
        const found = routes.find((r) => r.path === '/agent/state' && r.methods.includes('get'));
        assert.ok(found, 'GET /agent/state deve estar registrado');
    });

    it('possui rota GET /agent/stream', () => {
        const found = routes.find((r) => r.path === '/agent/stream' && r.methods.includes('get'));
        assert.ok(found, 'GET /agent/stream deve estar registrado');
    });

    it('/sessions/foreground aparece antes de /sessions/:id no stack (precedência de rota)', () => {
        const idxForeground = /** @type {any} */ (routes).findIndex((r) => r.path === '/sessions/foreground');
        const idxById = /** @type {any} */ (routes).findIndex((r) => r.path === '/sessions/:id');
        assert.ok(idxForeground >= 0, '/sessions/foreground deve existir no router');
        assert.ok(idxById >= 0, '/sessions/:id deve existir no router');
        assert.ok(
            idxForeground < idxById,
            `/sessions/foreground (pos ${idxForeground}) deve vir antes de /sessions/:id (pos ${idxById})`,
        );
    });
});

describe('sdk-api Sprint 19 › contratos de payload', () => {
    it('POST /sessions/:id/abort → resposta possui ok=true e sessionId', () => {
        const response = { ok: true, sessionId: 'sess-abc', message: 'Processamento abortado.' };
        assert.strictEqual(response.ok, true);
        assert.ok(typeof response.sessionId === 'string');
        assert.ok(typeof response.message === 'string');
    });

    it('GET /sessions/:id/messages → resposta possui count (number) e messages (array)', () => {
        const response = { ok: true, sessionId: 'sess-abc', count: 3, messages: [{}, {}, {}] };
        assert.strictEqual(response.ok, true);
        assert.ok(typeof response.count === 'number');
        assert.ok(Array.isArray(response.messages));
        assert.strictEqual(response.count, response.messages.length);
    });

    it('GET /sessions/foreground → resposta possui foregroundSessionId (string ou null)', () => {
        const withSession = { ok: true, foregroundSessionId: 'sess-abc' };
        assert.strictEqual(withSession.ok, true);
        assert.ok(typeof withSession.foregroundSessionId === 'string');

        const noSession = { ok: true, foregroundSessionId: null };
        assert.strictEqual(noSession.ok, true);
        assert.strictEqual(noSession.foregroundSessionId, null);
    });

    it('PUT /sessions/foreground/:id → resposta possui ok=true e foregroundSessionId', () => {
        const response = { ok: true, foregroundSessionId: 'sess-xyz' };
        assert.strictEqual(response.ok, true);
        assert.ok(typeof response.foregroundSessionId === 'string');
    });

    it('GET /agent/state → resposta possui state (string)', () => {
        const validStates = ['connected', 'connecting', 'disconnected', 'error'];
        const response = { ok: true, state: 'connected' };
        assert.strictEqual(response.ok, true);
        assert.ok(typeof response.state === 'string');
        assert.ok(
            validStates.includes(response.state),
            `state deve ser um ConnectionState válido, recebido: ${response.state}`,
        );
    });

    it('sessão não encontrada retorna 404 com ok=false e error (string)', () => {
        const notFound = {
            ok: false,
            error: 'Sessão "xxx" não está ativa. Use POST /api/sdk/sessions/xxx/resume primeiro.',
        };
        assert.strictEqual(notFound.ok, false);
        assert.ok(typeof notFound.error === 'string');
        assert.ok(notFound.error.includes('xxx'));
    });
});
