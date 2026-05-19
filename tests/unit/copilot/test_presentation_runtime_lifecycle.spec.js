// @ts-check

import { describe, expect, it } from 'vitest';

import { buildRuntimeLifecycleSummary } from '../../../src/copilot/presentation/runtime/lifecycle.js';

describe('presentation/runtime-lifecycle', () => {
    it('projeta resumo amigável de boot e shutdown para status', () => {
        const summary = buildRuntimeLifecycleSummary({
            shuttingDown: false,
            lastBootReport: /** @type {any} */ ({
                status: 'ok',
                phaseCount: 4,
                okCount: 4,
                skippedCount: 0,
                failedCount: 0,
                timeoutCount: 0,
                failedPhase: null,
                durationMs: 42,
                phases: [
                    { id: 'observability', status: 'ok' },
                    { id: 'runtime-wiring', status: 'ok' },
                    { id: 'boot-surface-validation', status: 'ok' },
                    { id: 'repl', status: 'ok' },
                ],
            }),
            bootMetrics: /** @type {any} */ ([{ id: 'repl', attempts: 1, avgDurationMs: 12 }]),
            bootConfig: /** @type {any} */ ({
                entrypoints: { canonical: 'src/copilot/terminal/bootstrap.js' },
                server: { url: 'http://127.0.0.1:3009' },
                sdk: { enabled: true, sessionFs: { enabled: true } },
                terminal: { enabled: true },
                sessionDefaults: {
                    enableConfigDiscovery: true,
                    includeSubAgentStreamingEvents: false,
                },
            }),
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
                phases: '4/4',
                phaseCount: 4,
                completedCount: 4,
                okCount: 4,
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
            capabilities: {
                canonicalEntrypoint: 'src/copilot/terminal/bootstrap.js',
                serverUrl: 'http://127.0.0.1:3009',
                sdkRoutesEnabled: true,
                terminalDeclaredEnabled: true,
                configDiscoveryDefault: true,
                subAgentStreamingDefault: false,
                sessionFsEnabled: true,
                bootSurfaceValidated: true,
                warnings: ['subagent_streaming_guarded'],
            },
        });
    });
});
