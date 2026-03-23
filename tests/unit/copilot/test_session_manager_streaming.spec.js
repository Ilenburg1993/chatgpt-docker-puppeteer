// @ts-check
/**
 * tests/unit/copilot/test_session_manager_streaming.spec.js
 *
 * Testes unitários para as mudanças do Upgrade 10 Sprint 3 em session-manager.js e always-alive.js:
 *
 * - session-manager.js passa streaming: true no createConfig
 * - always-alive.js faz wiring de session.compaction_start e .compaction_complete
 * - Eventos de compaction chegam ao SSE via http-bridge.js /stream
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { before, describe, it } from 'node:test';
import { alwaysAliveAgent } from '../../../src/copilot/always-alive.js';

// ─── Suite: session-manager tem streaming: true no createConfig ───────────────

describe('session-manager › createConfig inclui streaming: true', async () => {
    /** @type {string} */
    let sourceCode = '';

    before(async () => {
        const { readFile } = await import('node:fs/promises');
        sourceCode = await readFile(new URL('../../../src/copilot/session-manager.js', import.meta.url), 'utf-8');
    });

    it('contém streaming: true no bloco createConfig', () => {
        assert.ok(
            sourceCode.includes('streaming: true'),
            'session-manager.js deve conter "streaming: true" no createConfig',
        );
    });

    it('streaming: true aparece antes de infiniteSessions no createConfig', () => {
        const streamingIdx = sourceCode.indexOf('streaming: true');
        const infiniteIdx = sourceCode.indexOf('infiniteSessions:');
        assert.ok(streamingIdx !== -1, '"streaming: true" deve estar presente');
        assert.ok(infiniteIdx !== -1, '"infiniteSessions:" deve estar presente');
        assert.ok(
            streamingIdx < infiniteIdx,
            '"streaming: true" deve aparecer antes de "infiniteSessions:" no arquivo',
        );
    });
});

// ─── Suite: always-alive.js tem wiring de compaction events ──────────────────

describe('always-alive › compaction events wirados', async () => {
    /** @type {string} */
    let sourceCode = '';

    before(async () => {
        const { readFile } = await import('node:fs/promises');
        sourceCode = await readFile(new URL('../../../src/copilot/always-alive.js', import.meta.url), 'utf-8');
    });

    it('contains session.compaction_start subscription', () => {
        assert.ok(
            sourceCode.includes('session.compaction_start'),
            'always-alive.js deve assinar session.compaction_start',
        );
    });

    it('contains session.compaction_complete subscription', () => {
        assert.ok(
            sourceCode.includes('session.compaction_complete'),
            'always-alive.js deve assinar session.compaction_complete',
        );
    });

    it('emite session.compaction_start e session.compaction_complete via this.emit', () => {
        // Verifica que os eventos são propagados pelo EventEmitter
        const emitPattern = /this\.emit\('session\.compaction/;
        assert.ok(
            emitPattern.test(sourceCode),
            'always-alive.js deve chamar this.emit para repassar compaction events',
        );
    });
});

// ─── Suite: AlwaysAliveAgent propaga compaction events ───────────────────────

describe('AlwaysAliveAgent › propaga session.compaction_start e .compaction_complete', () => {
    it('session.compaction_start é emitido e recebido pelo listener', () => {
        /** @type {any} */
        let payload = null;
        const handler = (/** @type {any} */ p) => {
            payload = p;
        };
        alwaysAliveAgent.on('session.compaction_start', handler);

        alwaysAliveAgent.emit('session.compaction_start', { context: 'test', tokensUsed: 1000 });

        alwaysAliveAgent.off('session.compaction_start', handler);

        assert.ok(payload !== null, 'session.compaction_start deve ter sido emitido');
        assert.strictEqual(payload.context, 'test');
    });

    it('session.compaction_complete é emitido e recebido pelo listener', () => {
        /** @type {any} */
        let payload = null;
        const handler = (/** @type {any} */ p) => {
            payload = p;
        };
        alwaysAliveAgent.on('session.compaction_complete', handler);

        alwaysAliveAgent.emit('session.compaction_complete', { tokensBefore: 2000, tokensAfter: 500 });

        alwaysAliveAgent.off('session.compaction_complete', handler);

        assert.ok(payload !== null, 'session.compaction_complete deve ter sido emitido');
        assert.strictEqual(payload.tokensBefore, 2000);
        assert.strictEqual(payload.tokensAfter, 500);
    });
});

// ─── Suite: http-bridge SSE expõe compaction events ──────────────────────────

describe('http-bridge GET /stream › compaction events chegam via SSE', () => {
    /** @type {any} */
    let bridge;

    before(async () => {
        const mod = await import('../../../src/copilot/http-bridge.js');
        bridge = mod.default;
    });

    /**
     * Extrai o handler de uma rota do router.
     *
     * @param {any} router
     * @param {string} method
     * @param {string} path
     * @returns {Function}
     */
    function getHandler(router, method, path) {
        const layer = router.stack?.find(
            (/** @type {any} */ l) => l.route?.path === path && l.route?.methods?.[method],
        );
        assert.ok(layer, `Rota ${method.toUpperCase()} ${path} não encontrada`);
        const handlers = layer.route.stack;
        return handlers[handlers.length - 1].handle;
    }

    it('session.compaction_start aparece na lista AGENT_EVENTS do /stream', async () => {
        // Verifica via leitura do código fonte que o evento está listado
        const { readFile } = await import('node:fs/promises');
        const src = await readFile(new URL('../../../src/copilot/http-bridge.js', import.meta.url), 'utf-8');
        assert.ok(
            src.includes("'session.compaction_start'"),
            'http-bridge.js deve listar session.compaction_start em AGENT_EVENTS',
        );
    });

    it('session.compaction_complete aparece na lista AGENT_EVENTS do /stream', async () => {
        const { readFile } = await import('node:fs/promises');
        const src = await readFile(new URL('../../../src/copilot/http-bridge.js', import.meta.url), 'utf-8');
        assert.ok(
            src.includes("'session.compaction_complete'"),
            'http-bridge.js deve listar session.compaction_complete em AGENT_EVENTS',
        );
    });

    it('session.compaction_start chega ao cliente SSE via alwaysAliveAgent', () => {
        /** @type {string[]} */
        const chunks = [];
        const reqEmitter = new EventEmitter();
        const reqMock = /** @type {any} */ ({ on: reqEmitter.on.bind(reqEmitter) });
        const resMock = /** @type {any} */ ({
            _writableEnded: false,
            get writableEnded() {
                return this._writableEnded;
            },
            setHeader() {},
            flushHeaders() {},
            write(chunk) {
                chunks.push(chunk);
            },
        });

        const handler = getHandler(bridge, 'get', '/stream');
        handler(reqMock, resMock);

        alwaysAliveAgent.emit('session.compaction_start', { tokensUsed: 3000 });

        const compactionChunks = chunks.filter((c) => c.startsWith('event: session.compaction_start\n'));
        assert.ok(compactionChunks.length >= 1, 'deve ter recebido evento session.compaction_start via SSE');

        reqEmitter.emit('close');
    });
});
