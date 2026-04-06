// @ts-check
/**
 * tests/unit/copilot/test_sse_utils.spec.js
 *
 * Testes unitários para src/copilot/api/sse-utils.js.
 *
 * Cobre:
 *
 * - sanitizeSseEvent: remoção de \r\n de nomes de evento (SEC-VULN-02)
 * - createEventFilter: wildcard, exatos, combinados
 * - SseConnectionTracker: accept(), increment(), decrement(), underflow protection
 * - createSseWriter: headers SSE, heartbeat, replay, max lifetime, cleanup, gzip compression (F38.4)
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import {
    createEventFilter,
    createSseWriter,
    sanitizeSseEvent,
    SseConnectionTracker,
} from '../../../src/copilot/api/sse-utils.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Cria um par req/res mock para SSE.
 *
 * @param {{ acceptEncoding?: string; lastEventId?: string }} [overrides]
 * @returns {{
 *     req: import('express').Request & EventEmitter;
 *     res: import('express').Response & EventEmitter & { _writableEnded: boolean };
 *     chunks: string[];
 *     headers: Record<string, string>;
 * }}
 */
function makeMocks(overrides = {}) {
    const reqEmitter = new EventEmitter();
    /** @type {Record<string, string>} */
    const reqHeaders = {};
    if (overrides.acceptEncoding) reqHeaders['accept-encoding'] = overrides.acceptEncoding;
    if (overrides.lastEventId) reqHeaders['last-event-id'] = overrides.lastEventId;

    const req = /** @type {any} */ (
        Object.assign(reqEmitter, {
            headers: reqHeaders,
            query: {},
        })
    );

    const resEmitter = new EventEmitter();
    /** @type {Record<string, string>} */
    const headers = {};
    /** @type {string[]} */
    const chunks = [];

    /** @type {{ value: boolean }} */
    const ended = { value: false };

    const res = /** @type {any} */ (resEmitter);
    Object.defineProperty(res, 'writableEnded', {
        get() {
            return ended.value;
        },
        set(v) {
            ended.value = v;
        },
        configurable: true,
    });
    res.setHeader = (/** @type {string} */ name, /** @type {string} */ value) => {
        headers[name] = value;
    };
    res.flushHeaders = () => {};
    res.write = (/** @type {string} */ chunk) => {
        chunks.push(chunk);
        return true;
    };
    res.end = () => {
        ended.value = true;
    };

    return { req, res, chunks, headers };
}

/**
 * Cria um replay buffer mock simples.
 *
 * @returns {import('../../../src/copilot/api/sse-replay-buffer.js').SseReplayBuffer}
 */
function makeReplayBufferMock() {
    let _seq = 0;
    /** @type {{ id: number; event: string; data: unknown }[]} */
    const _entries = [];

    return /** @type {any} */ ({
        push(/** @type {string} */ event, /** @type {unknown} */ data) {
            _seq++;
            _entries.push({ id: _seq, event, data });
            return _seq;
        },
        getAfter(/** @type {number} */ id) {
            return _entries.filter((e) => e.id > id);
        },
    });
}

// ─── sanitizeSseEvent ─────────────────────────────────────────────────────────

describe('sanitizeSseEvent', () => {
    it('preserva nomes válidos', () => {
        assert.strictEqual(sanitizeSseEvent('task.started'), 'task.started');
    });

    it('remove \\r e \\n de nomes de evento', () => {
        assert.strictEqual(sanitizeSseEvent('task\r\ninjected'), 'task__injected');
    });

    it('remove múltiplas ocorrências de \\r\\n', () => {
        assert.strictEqual(sanitizeSseEvent('\r\nhello\r\nworld\r\n'), '__hello__world__');
    });

    it('converte tipos não-string via String()', () => {
        // @ts-expect-error — teste de robustez
        assert.strictEqual(sanitizeSseEvent(123), '123');
    });
});

// ─── createEventFilter ────────────────────────────────────────────────────────

describe('createEventFilter', () => {
    it('retorna null quando param vazio', () => {
        assert.strictEqual(createEventFilter(''), null);
        assert.strictEqual(createEventFilter(undefined), null);
    });

    it('filtra por nome exato', () => {
        const filter = createEventFilter('task.started,task.error');
        assert.ok(filter);
        assert.ok(filter('task.started'));
        assert.ok(filter('task.error'));
        assert.ok(!filter('task.delta'));
    });

    it('filtra por wildcard (task.*)', () => {
        const filter = createEventFilter('task.*');
        assert.ok(filter);
        assert.ok(filter('task.started'));
        assert.ok(filter('task.delta'));
        assert.ok(!filter('dialog.ready'));
    });

    it('combina exatos + wildcards', () => {
        const filter = createEventFilter('ready,task.*');
        assert.ok(filter);
        assert.ok(filter('ready'));
        assert.ok(filter('task.completed'));
        assert.ok(!filter('dialog.ready'));
    });
});

// ─── SseConnectionTracker ─────────────────────────────────────────────────────

describe('SseConnectionTracker', () => {
    it('accept() retorna true quando abaixo do limite', () => {
        const tracker = new SseConnectionTracker('test', 2);
        assert.ok(tracker.accept());
    });

    it('bloqueia quando no limite', () => {
        const tracker = new SseConnectionTracker('test', 1);
        tracker.increment();
        assert.ok(!tracker.accept());
    });

    it('libera após decrement', () => {
        const tracker = new SseConnectionTracker('test', 1);
        tracker.increment();
        tracker.decrement();
        assert.ok(tracker.accept());
    });

    it('previne underflow (decrement abaixo de 0)', () => {
        const tracker = new SseConnectionTracker('test', 5);
        tracker.decrement();
        tracker.decrement();
        assert.strictEqual(tracker.count, 0);
    });

    it('expõe name e count', () => {
        const tracker = new SseConnectionTracker('my-ep', 10);
        assert.strictEqual(tracker.name, 'my-ep');
        assert.strictEqual(tracker.count, 0);
        tracker.increment();
        assert.strictEqual(tracker.count, 1);
    });
});

// ─── createSseWriter — headers básicos ────────────────────────────────────────

describe('createSseWriter — headers SSE', () => {
    it('define Content-Type text/event-stream', () => {
        const { req, res, headers } = makeMocks();
        const sse = createSseWriter(req, res, { heartbeatMs: 0 });
        assert.strictEqual(headers['Content-Type'], 'text/event-stream');
        sse.close();
    });

    it('define Cache-Control, Connection, X-Accel-Buffering', () => {
        const { req, res, headers } = makeMocks();
        const sse = createSseWriter(req, res, { heartbeatMs: 0 });
        assert.strictEqual(headers['Cache-Control'], 'no-cache');
        assert.strictEqual(headers['Connection'], 'keep-alive');
        assert.strictEqual(headers['X-Accel-Buffering'], 'no');
        sse.close();
    });
});

// ─── createSseWriter — send() ─────────────────────────────────────────────────

describe('createSseWriter — send()', () => {
    it('envia evento formatado SSE', () => {
        const { req, res, chunks } = makeMocks();
        const sse = createSseWriter(req, res, { heartbeatMs: 0 });
        sse.send('test.event', { foo: 'bar' });
        assert.ok(chunks.some((c) => c.includes('event: test.event')));
        assert.ok(chunks.some((c) => c.includes('"foo":"bar"')));
        sse.close();
    });

    it('sanitiza nomes de evento com \\r\\n', () => {
        const { req, res, chunks } = makeMocks();
        const sse = createSseWriter(req, res, { heartbeatMs: 0 });
        sse.send('bad\r\nevent', { x: 1 });
        assert.ok(chunks.some((c) => c.includes('event: bad__event')));
        sse.close();
    });

    it('não escreve se res.writableEnded', () => {
        const { req, res, chunks } = makeMocks();
        const sse = createSseWriter(req, res, { heartbeatMs: 0 });
        const before = chunks.length;
        sse.send('first', {});
        /** @type {any} */ (res).writableEnded = true;
        sse.send('second', {});
        // Apenas 'first' foi escrito
        assert.ok(chunks.length > before);
        assert.ok(!chunks.some((c) => c.includes('event: second')));
        sse.close();
    });

    it('trunca campo content quando maxContentChars > 0', () => {
        const { req, res, chunks } = makeMocks();
        const sse = createSseWriter(req, res, { heartbeatMs: 0, maxContentChars: 10 });
        sse.send('msg', { content: 'a'.repeat(20) });
        const dataChunk = chunks.find((c) => c.includes('event: msg'));
        assert.ok(dataChunk);
        assert.ok(dataChunk.includes('truncado'));
        sse.close();
    });
});

// ─── createSseWriter — replay buffer ──────────────────────────────────────────

describe('createSseWriter — replay', () => {
    it('envia eventos do replay buffer quando Last-Event-ID presente', () => {
        const buf = makeReplayBufferMock();
        // Pre-populate buffer
        buf.push('evt1', { a: 1 });
        buf.push('evt2', { b: 2 });

        const { req, res, chunks } = makeMocks({ lastEventId: '1' });
        const sse = createSseWriter(req, res, { heartbeatMs: 0, replayBuffer: buf });

        // Deve ter replayado evt2 (id > 1)
        assert.ok(chunks.some((c) => c.includes('event: evt2')));
        sse.close();
    });

    it('inclui id: no send() quando replayBuffer é fornecido', () => {
        const buf = makeReplayBufferMock();
        const { req, res, chunks } = makeMocks();
        const sse = createSseWriter(req, res, { heartbeatMs: 0, replayBuffer: buf });
        sse.send('test', { x: 1 });
        assert.ok(chunks.some((c) => c.includes('id: ')));
        sse.close();
    });
});

// ─── createSseWriter — tracker ────────────────────────────────────────────────

describe('createSseWriter — tracker integration', () => {
    it('incrementa tracker ao criar e decrementa ao fechar', () => {
        const tracker = new SseConnectionTracker('test', 10);
        const { req, res } = makeMocks();
        assert.strictEqual(tracker.count, 0);
        const sse = createSseWriter(req, res, { heartbeatMs: 0, tracker });
        assert.strictEqual(tracker.count, 1);
        // Simulate req close which triggers cleanup → decrement
        req.emit('close');
        assert.strictEqual(tracker.count, 0);
    });
});

// ─── createSseWriter — max lifetime ───────────────────────────────────────────

describe('createSseWriter — max lifetime', () => {
    beforeEach(() => {
        mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    });

    afterEach(() => {
        mock.timers.reset();
    });

    it('envia reconnect e encerra após max lifetime', () => {
        const { req, res, chunks } = makeMocks();
        createSseWriter(req, res, { heartbeatMs: 0, maxLifetimeMs: 5000 });
        mock.timers.tick(5001);
        assert.ok(chunks.some((c) => c.includes('event: reconnect')));
        // res.end() foi chamado pelo timeout callback
        assert.ok(/** @type {any} */ (res).writableEnded, 'res deve estar ended após max lifetime');
    });
});

// ─── createSseWriter — gzip compression (F38.4) ──────────────────────────────

describe('createSseWriter — gzip compression (F38.4)', () => {
    it('NÃO ativa gzip se compress=false (default)', () => {
        const { req, res, headers } = makeMocks({ acceptEncoding: 'gzip, deflate' });
        const sse = createSseWriter(req, res, { heartbeatMs: 0 });
        assert.ok(!headers['Content-Encoding']);
        sse.close();
    });

    it('NÃO ativa gzip se cliente não envia Accept-Encoding: gzip', () => {
        const { req, res, headers } = makeMocks({ acceptEncoding: 'deflate, br' });
        const sse = createSseWriter(req, res, { heartbeatMs: 0, compress: true });
        assert.ok(!headers['Content-Encoding']);
        sse.close();
    });

    it('ativa gzip quando compress=true E cliente aceita gzip', () => {
        const { req, res, headers } = makeMocks({ acceptEncoding: 'gzip, deflate' });
        // Mock res para ser um writable stream (necessário para pipe)
        const writable = new PassThrough();
        /** @type {any} */ (res).write = writable.write.bind(writable);
        /** @type {any} */ (res).end = () => {
            /** @type {any} */ (res).writableEnded = true;
            writable.end();
        };
        // Precisamos que res funcione como stream para pipe
        // O createGzip().pipe(res) precisa de um writable — usamos PassThrough
        /** @type {Buffer[]} */
        const compressed = [];
        writable.on('data', (/** @type {Buffer} */ chunk) => compressed.push(chunk));

        const sse = createSseWriter(req, res, { heartbeatMs: 0, compress: true });
        assert.strictEqual(headers['Content-Encoding'], 'gzip');

        sse.send('test.event', { hello: 'world' });
        sse.close();
    });
});
