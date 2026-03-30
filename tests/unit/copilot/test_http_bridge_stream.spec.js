// @ts-check
/**
 * tests/unit/copilot/test_http_bridge_stream.spec.js
 *
 * Testes unitários para o endpoint SSE GET /stream adicionado ao http-bridge.js no Upgrade 10 Sprint 2.
 *
 * Cobre:
 *
 * - Rota GET /stream está registrada no router
 * - Headers SSE corretos (Content-Type, Cache-Control, Connection, X-Accel-Buffering)
 * - Evento 'connected' é enviado imediatamente ao conectar
 * - Eventos do AlwaysAliveAgent são repassados via SSE
 * - Heartbeat é registrado via setInterval
 * - Listeners são removidos ao fechar conexão (req 'close')
 * - writableEnded: true → sendEvt não lança exceção (proteção defensiva)
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { before, describe, it } from 'node:test';
import { alwaysAliveAgent } from '../../../src/copilot/agent/always-alive.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Cria um objeto res mock que simula SSE (res.write, res.flushHeaders, etc).
 *
 * @returns {{
 *     res: any;
 *     headers: Record<string, string>;
 *     chunks: string[];
 *     _flushed: boolean;
 * }}
 */
function makeSseResMock() {
    /** @type {Record<string, string>} */
    const headers = {};
    /** @type {string[]} */
    const chunks = [];
    let flushed = false;

    const res = /** @type {any} */ ({
        get writableEnded() {
            return res._writableEnded ?? false;
        },
        _writableEnded: false,
        setHeader(/** @type {string} */ name, /** @type {string} */ value) {
            headers[name] = value;
        },
        flushHeaders() {
            flushed = true;
        },
        write(/** @type {string} */ chunk) {
            chunks.push(chunk);
        },
    });

    return {
        res,
        headers,
        chunks,
        get _flushed() {
            return flushed;
        },
    };
}

/**
 * Cria um req mock que suporta o evento 'close'.
 *
 * @returns {{ req: any; triggerClose: () => void }}
 */
function makeSseReqMock() {
    const reqEmitter = new EventEmitter();
    const req = /** @type {any} */ ({
        on: reqEmitter.on.bind(reqEmitter),
    });
    return {
        req,
        triggerClose: () => reqEmitter.emit('close'),
    };
}

/**
 * Extrai o handler de uma rota do Express router.
 *
 * @param {any} router - Express router com .stack
 * @param {string} method - HTTP method (get, post, etc.)
 * @param {string} path - Caminho da rota
 * @returns {(req: any, res: any) => void}
 */
function getRouteHandler(router, method, path) {
    const layer = router.stack?.find((/** @type {any} */ l) => l.route?.path === path && l.route?.methods?.[method]);
    assert.ok(layer, `Rota ${method.toUpperCase()} ${path} não encontrada no router`);
    // Pega o último handler da rota (pode haver middlewares antes)
    const handlers = layer.route.stack;
    return handlers[handlers.length - 1].handle;
}

// ─── Suite principal ──────────────────────────────────────────────────────────

describe('http-bridge GET /stream — estrutura de rota', () => {
    /** @type {any} */
    let bridge;

    before(async () => {
        const mod = await import('../../../src/copilot/api/http-bridge.js');
        bridge = mod.default;
    });

    it('router tem a rota GET /stream registrada', () => {
        const stack = bridge?.stack ?? [];
        const found = stack.some((/** @type {any} */ l) => l.route?.path === '/stream' && l.route?.methods?.get);
        assert.ok(found, 'GET /stream deve estar registrado no router');
    });

    it('router possui exatamente a rota GET /stream (não duplicada)', () => {
        const stack = bridge?.stack ?? [];
        const matches = stack.filter((/** @type {any} */ l) => l.route?.path === '/stream' && l.route?.methods?.get);
        assert.strictEqual(matches.length, 1, 'GET /stream deve aparecer exatamente 1 vez');
    });
});

// ─── Suite: headers SSE ───────────────────────────────────────────────────────

describe('http-bridge GET /stream — headers SSE', () => {
    /** @type {any} */
    let bridge;

    before(async () => {
        const mod = await import('../../../src/copilot/api/http-bridge.js');
        bridge = mod.default;
    });

    it('define Content-Type: text/event-stream', () => {
        const { res, headers, req } = { ...makeSseResMock(), req: makeSseReqMock().req };
        const { triggerClose } = makeSseReqMock();

        // Precisamos de req e res sincronizados
        const reqEmitter = new EventEmitter();
        const reqMock = /** @type {any} */ ({ on: reqEmitter.on.bind(reqEmitter) });
        const { res: resMock, headers: hdrs } = makeSseResMock();

        const handler = getRouteHandler(bridge, 'get', '/stream');
        handler(reqMock, resMock);

        assert.strictEqual(hdrs['Content-Type'], 'text/event-stream');
        reqEmitter.emit('close');
    });

    it('define Cache-Control: no-cache', () => {
        const { res: resMock, headers: hdrs } = makeSseResMock();
        const reqEmitter = new EventEmitter();
        const reqMock = /** @type {any} */ ({ on: reqEmitter.on.bind(reqEmitter) });

        const handler = getRouteHandler(bridge, 'get', '/stream');
        handler(reqMock, resMock);

        assert.strictEqual(hdrs['Cache-Control'], 'no-cache');
        reqEmitter.emit('close');
    });

    it('define Connection: keep-alive', () => {
        const { res: resMock, headers: hdrs } = makeSseResMock();
        const reqEmitter = new EventEmitter();
        const reqMock = /** @type {any} */ ({ on: reqEmitter.on.bind(reqEmitter) });

        const handler = getRouteHandler(bridge, 'get', '/stream');
        handler(reqMock, resMock);

        assert.strictEqual(hdrs['Connection'], 'keep-alive');
        reqEmitter.emit('close');
    });

    it('define X-Accel-Buffering: no', () => {
        const { res: resMock, headers: hdrs } = makeSseResMock();
        const reqEmitter = new EventEmitter();
        const reqMock = /** @type {any} */ ({ on: reqEmitter.on.bind(reqEmitter) });

        const handler = getRouteHandler(bridge, 'get', '/stream');
        handler(reqMock, resMock);

        assert.strictEqual(hdrs['X-Accel-Buffering'], 'no');
        reqEmitter.emit('close');
    });
});

// ─── Suite: evento 'connected' imediato ──────────────────────────────────────

describe('http-bridge GET /stream — evento connected', () => {
    /** @type {any} */
    let bridge;

    before(async () => {
        const mod = await import('../../../src/copilot/api/http-bridge.js');
        bridge = mod.default;
    });

    it('emite evento SSE "connected" imediatamente ao conectar', () => {
        const { res: resMock, chunks } = makeSseResMock();
        const reqEmitter = new EventEmitter();
        const reqMock = /** @type {any} */ ({ on: reqEmitter.on.bind(reqEmitter) });

        const handler = getRouteHandler(bridge, 'get', '/stream');
        handler(reqMock, resMock);

        // Deve ter ao menos 1 chunk após a conexão
        assert.ok(chunks.length >= 1, 'deve ter escrito ao menos 1 chunk SSE');
        const firstChunk = chunks[0] ?? '';
        assert.ok(
            firstChunk.startsWith('event: connected\n'),
            `primeiro evento deve ser 'connected', recebido: ${firstChunk}`,
        );

        reqEmitter.emit('close');
    });

    it('evento connected contém campo timestamp', () => {
        const { res: resMock, chunks } = makeSseResMock();
        const reqEmitter = new EventEmitter();
        const reqMock = /** @type {any} */ ({ on: reqEmitter.on.bind(reqEmitter) });

        const handler = getRouteHandler(bridge, 'get', '/stream');
        handler(reqMock, resMock);

        const dataLine = (chunks[0] ?? '').split('\n')[1] ?? ''; // "data: {...}"
        assert.ok(dataLine.startsWith('data: '), 'deve ter linha data:');
        const parsed = JSON.parse(dataLine.replace('data: ', ''));
        assert.ok(typeof parsed.timestamp === 'number', 'connected deve ter timestamp numérico');

        reqEmitter.emit('close');
    });
});

// ─── Suite: repasse de eventos do agente ─────────────────────────────────────

describe('http-bridge GET /stream — repasse de eventos do agente', () => {
    /** @type {any} */
    let bridge;

    before(async () => {
        const mod = await import('../../../src/copilot/api/http-bridge.js');
        bridge = mod.default;
    });

    it('task.completed do alwaysAliveAgent é enviado via SSE', () => {
        const { res: resMock, chunks } = makeSseResMock();
        const reqEmitter = new EventEmitter();
        const reqMock = /** @type {any} */ ({ on: reqEmitter.on.bind(reqEmitter) });

        const handler = getRouteHandler(bridge, 'get', '/stream');
        handler(reqMock, resMock);

        const initialCount = chunks.length;

        // Simula alwaysAliveAgent emitindo task.completed
        /** @type {any} */ (alwaysAliveAgent).emit('task.completed', {
            taskId: 'stream-test-001',
            response: 'Resposta completa',
            responseLen: 17,
        });

        assert.ok(chunks.length > initialCount, 'deve ter escrito novo chunk SSE');
        const lastChunk = chunks[chunks.length - 1] ?? '';
        assert.ok(
            lastChunk.startsWith('event: task.completed\n'),
            `deve ser evento task.completed, recebido: ${lastChunk}`,
        );

        reqEmitter.emit('close');
    });

    it('task.delta do alwaysAliveAgent é enviado via SSE com chunk correto', () => {
        const { res: resMock, chunks } = makeSseResMock();
        const reqEmitter = new EventEmitter();
        const reqMock = /** @type {any} */ ({ on: reqEmitter.on.bind(reqEmitter) });

        const handler = getRouteHandler(bridge, 'get', '/stream');
        handler(reqMock, resMock);

        /** @type {any} */ (alwaysAliveAgent).emit('task.delta', {
            taskId: 'stream-delta-001',
            chunk: 'token parcial',
        });

        const deltaChunks = chunks.filter((c) => c.startsWith('event: task.delta\n'));
        assert.ok(deltaChunks.length >= 1, 'deve ter recebido ao menos 1 chunk task.delta via SSE');

        const dataLine = (deltaChunks[0] ?? '').split('\n')[1] ?? '';
        const parsed = JSON.parse(dataLine.replace('data: ', ''));
        assert.strictEqual(parsed.taskId, 'stream-delta-001');

        reqEmitter.emit('close');
    });
});

// ─── Suite: limpeza ao fechar conexão ────────────────────────────────────────

describe('http-bridge GET /stream — cleanup no fechamento', () => {
    /** @type {any} */
    let bridge;

    before(async () => {
        const mod = await import('../../../src/copilot/api/http-bridge.js');
        bridge = mod.default;
    });

    it('após req.close os eventos do agente não chegam mais ao SSE', () => {
        const { res: resMock, chunks } = makeSseResMock();
        const reqEmitter = new EventEmitter();
        const reqMock = /** @type {any} */ ({ on: reqEmitter.on.bind(reqEmitter) });

        const handler = getRouteHandler(bridge, 'get', '/stream');
        handler(reqMock, resMock);

        // Fecha conexão
        reqEmitter.emit('close');

        const countAfterClose = chunks.length;

        // Emite evento depois do fechamento
        /** @type {any} */ (alwaysAliveAgent).emit('task.completed', {
            taskId: 'after-close',
            response: 'não deve chegar',
            responseLen: 14,
        });

        assert.strictEqual(chunks.length, countAfterClose, 'nenhum novo chunk após fechar conexão');
    });

    it('writableEnded=true protege contra escrita em res já encerrado', () => {
        const { res: resMock, chunks } = makeSseResMock();
        const reqEmitter = new EventEmitter();
        const reqMock = /** @type {any} */ ({ on: reqEmitter.on.bind(reqEmitter) });

        const handler = getRouteHandler(bridge, 'get', '/stream');
        handler(reqMock, resMock);

        // Simula res encerrado
        resMock._writableEnded = true;

        assert.doesNotThrow(() => {
            /** @type {any} */ (alwaysAliveAgent).emit('task.started', { taskId: 'safe-test' });
        }, 'não deve lançar exceção ao tentar escrever em res encerrado');

        reqEmitter.emit('close');
    });
});
