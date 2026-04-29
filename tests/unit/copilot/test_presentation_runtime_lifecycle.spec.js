// @ts-check

import { describe, expect, it } from 'vitest';

import { buildRuntimeLifecycleSummary } from '../../../src/copilot/presentation/runtime-lifecycle.js';

describe('presentation/runtime-lifecycle', () => {
    it('projeta resumo amigável de boot e shutdown para status', () => {
        const summary = buildRuntimeLifecycleSummary({
            shuttingDown: false,
            lastBootReport: /** @type {any} */ ({
                status: 'ok',
                phaseCount: 4,
                okCount: 3,
                skippedCount: 1,
                failedCount: 0,
                timeoutCount: 0,
                failedPhase: null,
                durationMs: 42,
                phases: [
                    { id: 'observability', status: 'ok' },
                    { id: 'runtime-wiring', status: 'ok' },
                    { id: 'compat-runtime-host', status: 'skipped' },
                    { id: 'repl', status: 'ok' },
                ],
            }),
            shutdownHandlers: [{ name: 'terminal', priority: 10 }],
            lastShutdownReport: /** @type {any} */ ({
                reason: 'test',
                handlerCount: 2,
                okCount: 1,
                failedCount: 0,
                timeoutCount: 1,
                durationMs: 99,
                handlers: [
                    { name: 'ok', status: 'ok' },
                    { name: 'slow', status: 'timeout' },
                ],
            }),
        });

        expect(summary).toEqual({
            shuttingDown: false,
            boot: {
                status: 'ok',
                phases: '4/4',
                phaseCount: 4,
                completedCount: 4,
                okCount: 3,
                skippedCount: 1,
                failedCount: 0,
                timeoutCount: 0,
                failedPhase: null,
                lastPhase: 'repl',
                durationMs: 42,
            },
            shutdown: {
                status: 'failed',
                reason: 'test',
                handlers: '1/2',
                handlerCount: 2,
                okCount: 1,
                failedCount: 0,
                timeoutCount: 1,
                failedHandler: 'slow',
                durationMs: 99,
            },
            registeredShutdownHandlers: 1,
        });
    });
});
