// @ts-check
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('core/error-handlers', () => {
    /** @type {typeof import('../../../src/copilot/core/error-handlers.js')} */
    let mod;

    /** @type {any} */
    let mockLog;
    /** @type {any} */
    let mockTracker;

    beforeEach(async () => {
        vi.resetModules();

        mockLog = vi.fn();
        mockTracker = { trackError: vi.fn() };

        vi.doMock('../../../src/copilot/observability/logger.js', () => ({ log: mockLog }));
        vi.doMock('../../../src/copilot/observability/error-tracker.js', () => ({
            defaultErrorTracker: mockTracker,
            createErrorTracker: vi.fn(),
        }));

        mod = await import('../../../src/copilot/core/error-handlers.js');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ── logSwallowed ──────────────────────────────────────────────────────

    describe('logSwallowed', () => {
        it('loga com nível DEBUG e contexto', () => {
            const err = new Error('test fail');
            mod.logSwallowed(err, 'bridge.mcp');

            expect(mockLog).toHaveBeenCalledWith('DEBUG', '[swallowed:bridge.mcp] test fail');
            expect(mockTracker.trackError).toHaveBeenCalledWith(err, { source: 'swallowed:bridge.mcp' });
        });

        it('lida com erro não-Error (string)', () => {
            mod.logSwallowed('string error', 'tool.git');

            expect(mockLog).toHaveBeenCalledWith('DEBUG', '[swallowed:tool.git] string error');
            expect(mockTracker.trackError).toHaveBeenCalledWith('string error', { source: 'swallowed:tool.git' });
        });

        it('lida com null/undefined', () => {
            mod.logSwallowed(null, 'test');
            expect(mockLog).toHaveBeenCalledWith('DEBUG', '[swallowed:test] null');
        });
    });

    // ── wrapAsync ─────────────────────────────────────────────────────────

    describe('wrapAsync', () => {
        it('retorna resultado da função em sucesso', async () => {
            const result = await mod.wrapAsync(async () => 42, 'test');
            expect(result).toBe(42);
        });

        it('retorna undefined e loga em caso de erro', async () => {
            const result = await mod.wrapAsync(async () => {
                throw new Error('boom');
            }, 'test.op');

            expect(result).toBeUndefined();
            expect(mockLog).toHaveBeenCalledWith('DEBUG', '[swallowed:test.op] boom');
        });
    });

    // ── isFatalError ──────────────────────────────────────────────────────

    describe('isFatalError', () => {
        it('classifica CircuitOpenError como fatal', async () => {
            const { CircuitOpenError } = await import('../../../src/copilot/core/circuit-breaker.js');
            expect(mod.isFatalError(new CircuitOpenError('test'))).toBe(true);
        });

        it('classifica SessionError SESSION_FATAL como fatal', async () => {
            const { SessionError } = await import('../../../src/copilot/core/errors.js');
            expect(mod.isFatalError(new SessionError('fatal', 'SESSION_FATAL'))).toBe(true);
        });

        it('classifica SessionError genérico como NÃO fatal', async () => {
            const { SessionError } = await import('../../../src/copilot/core/errors.js');
            expect(mod.isFatalError(new SessionError('normal'))).toBe(false);
        });

        it('classifica ERR_SOCKET_CLOSED como fatal', () => {
            const err = Object.assign(new Error('closed'), { code: 'ERR_SOCKET_CLOSED' });
            expect(mod.isFatalError(err)).toBe(true);
        });

        it('classifica Error genérico como NÃO fatal', () => {
            expect(mod.isFatalError(new Error('generic'))).toBe(false);
        });

        it('classifica não-Error como NÃO fatal', () => {
            expect(mod.isFatalError('string')).toBe(false);
            expect(mod.isFatalError(null)).toBe(false);
        });
    });

    // ── isTransientError ──────────────────────────────────────────────────

    describe('isTransientError', () => {
        it('classifica BridgeError como transiente', async () => {
            const { BridgeError } = await import('../../../src/copilot/core/errors.js');
            expect(mod.isTransientError(new BridgeError('timeout'))).toBe(true);
        });

        it('classifica ECONNREFUSED como transiente', () => {
            const err = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
            expect(mod.isTransientError(err)).toBe(true);
        });

        it('classifica ETIMEDOUT como transiente', () => {
            const err = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
            expect(mod.isTransientError(err)).toBe(true);
        });

        it('classifica HTTP 502 como transiente', () => {
            const err = Object.assign(new Error('bad gateway'), { status: 502 });
            expect(mod.isTransientError(err)).toBe(true);
        });

        it('classifica HTTP 503 como transiente', () => {
            const err = Object.assign(new Error('unavailable'), { statusCode: 503 });
            expect(mod.isTransientError(err)).toBe(true);
        });

        it('classifica HTTP 429 como transiente', () => {
            const err = Object.assign(new Error('rate limit'), { status: 429 });
            expect(mod.isTransientError(err)).toBe(true);
        });

        it('classifica Error genérico como NÃO transiente', () => {
            expect(mod.isTransientError(new Error('generic'))).toBe(false);
        });

        it('classifica ConfigError como NÃO transiente', async () => {
            const { ConfigError } = await import('../../../src/copilot/core/errors.js');
            expect(mod.isTransientError(new ConfigError('bad config'))).toBe(false);
        });
    });
});
