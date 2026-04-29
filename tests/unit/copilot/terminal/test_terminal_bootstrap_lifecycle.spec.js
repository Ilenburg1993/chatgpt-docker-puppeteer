// @ts-check

import assert from 'node:assert/strict';
import { beforeEach, describe, it, vi } from 'vitest';

import {
    handleTerminalBootFailure,
    registerTerminalShutdownSignals,
    resetTerminalBootstrapLifecycleForTests,
} from '../../../../src/copilot/terminal/bootstrap-lifecycle.js';

describe('terminal/bootstrap-lifecycle', () => {
    beforeEach(() => {
        resetTerminalBootstrapLifecycleForTests();
    });

    it('registra SIGTERM e SIGINT em modo headless', async () => {
        /** @type {Record<string, (...args: unknown[]) => void>} */
        const listeners = {};
        const runShutdownFn = vi.fn(async () => {});
        const exit = vi.fn();

        registerTerminalShutdownSignals({
            processLike: {
                stdin: { isTTY: false },
                on: (event, listener) => {
                    listeners[event] = listener;
                },
                exit: /** @type {(code?: number) => never} */ (exit),
            },
            runShutdownFn,
            logFn: vi.fn(),
        });

        assert.equal(typeof listeners['SIGTERM'], 'function');
        assert.equal(typeof listeners['SIGINT'], 'function');

        listeners['SIGTERM']?.();
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(runShutdownFn.mock.calls[0]?.[0], 'SIGTERM');
        assert.equal(exit.mock.calls[0]?.[0], 0);
    });

    it('não captura SIGINT em TTY para preservar a semântica do REPL', () => {
        /** @type {Record<string, (...args: unknown[]) => void>} */
        const listeners = {};

        registerTerminalShutdownSignals({
            processLike: {
                stdin: { isTTY: true },
                on: (event, listener) => {
                    listeners[event] = listener;
                },
                exit: /** @type {(code?: number) => never} */ (vi.fn()),
            },
            runShutdownFn: vi.fn(async () => {}),
            logFn: vi.fn(),
        });

        assert.equal(typeof listeners['SIGTERM'], 'function');
        assert.equal(listeners['SIGINT'], undefined);
    });

    it('executa shutdown central antes de sair em falha fatal de boot', async () => {
        const runShutdownFn = vi.fn(async () => {});
        const errorFn = vi.fn();
        const exitFn = vi.fn();

        await assert.rejects(
            () =>
                handleTerminalBootFailure(new Error('boot failed'), {
                    runShutdownFn,
                    errorFn,
                    logFn: vi.fn(),
                    exitFn: /** @type {(code?: number) => never} */ (exitFn),
                }),
            /process\.exit retornou inesperadamente/,
        );

        assert.equal(errorFn.mock.calls.length, 1);
        assert.equal(runShutdownFn.mock.calls[0]?.[0], 'boot_failure');
        assert.equal(exitFn.mock.calls[0]?.[0], 1);
    });
});
