// @ts-check

import { describe, expect, it } from 'vitest';

import { buildRuntimeLifecycleSummary } from '../../../src/copilot/presentation/runtime/lifecycle.js';

describe('presentation/runtime-lifecycle', () => {
    it('projeta resumo amigável de boot e shutdown para status', () => {
        const summary = buildRuntimeLifecycleSummary({
            shuttingDown: false,
            lastBootReport: /** @type {any} */ ({
                status: 'ok',
                phaseCount: 3,
                okCount: 3,
                skippedCount: 0,
                failedCount: 0,
                timeoutCount: 0,
                failedPhase: null,
                durationMs: 42,
                phases: [
                    { id: 'observability', status: 'ok' },
                    { id: 'runtime-wiring', status: 'ok' },
                    { id: 'repl', status: 'ok' },
                ],
            }),
            bootMetrics: /** @type {any} */ ([{ id: 'repl', attempts: 1, avgDurationMs: 12 }]),
            shutdownHandlers: /** @type {any} */ ([{ name: 'terminal', priority: 10 }]),
            activeTimers: [{ id: 'metrics', type: 'interval', registeredAt: 1, ageMs: 1234 }],
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
            shutdownMetrics: /** @type {any} */ ([{ name: 'slow', attempts: 1, avgDurationMs: 99 }]),
        });

        expect(summary).toEqual({
            shuttingDown: false,
            boot: {
                status: 'ok',
                phases: '3/3',
                phaseCount: 3,
                completedCount: 3,
                okCount: 3,
                skippedCount: 0,
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
            activeTimerCount: 1,
            oldestActiveTimer: { id: 'metrics', type: 'interval', ageMs: 1234 },
        });
    });
});
