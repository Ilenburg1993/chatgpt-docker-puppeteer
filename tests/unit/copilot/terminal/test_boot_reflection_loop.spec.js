// @ts-check

import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';

import {
    resetTerminalReflectionLoopForTests,
    startReflectionLoop,
    stopReflectionLoop,
} from '../../../../src/copilot/terminal/terminal-phases/boot-reflection-loop.js';

describe('terminal/terminal-phases/boot-reflection-loop', () => {
    afterEach(() => {
        resetTerminalReflectionLoopForTests();
    });

    it('não envia reflexão quando o dialog loop não está ativo', async () => {
        let captured = /** @type {null | (() => void)} */ (null);
        const sendTurnFn = vi.fn(async () => null);
        const logFn = /** @type {(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL', message: string) => void} */ (
            /** @type {unknown} */ (vi.fn())
        );

        startReflectionLoop({
            reflectionIntervalMin: 1,
            readTerminalRuntimeStateFn: () => ({ dialogLoopActive: false, queueSize: 0 }),
            sendTurnFn,
            logFn,
            registerTimerFn: vi.fn(),
            setIntervalFn: (/** @type {() => void} */ fn, /** @type {number} */ _delay) => {
                captured = fn;
                return { unref() {} };
            },
        });

        if (captured) captured();
        await Promise.resolve();
        assert.equal(sendTurnFn.mock.calls.length, 0);
    });

    it('envia reflexão quando o runtime está ocioso e limpa o timer no stop', async () => {
        let captured = /** @type {null | (() => void)} */ (null);
        const sendTurnFn = vi.fn(async () => null);
        const clearIntervalFn = vi.fn();
        const cancelTimerFn = vi.fn();
        const logFn = /** @type {(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL', message: string) => void} */ (
            /** @type {unknown} */ (vi.fn())
        );

        startReflectionLoop({
            reflectionIntervalMin: 1,
            readTerminalRuntimeStateFn: () => ({ dialogLoopActive: true, queueSize: 0 }),
            sendTurnFn,
            logFn,
            registerTimerFn: vi.fn(),
            setIntervalFn: (/** @type {() => void} */ fn, /** @type {number} */ _delay) => {
                captured = fn;
                return { unref() {} };
            },
        });

        if (captured) captured();
        await Promise.resolve();
        assert.equal(sendTurnFn.mock.calls.length, 1);
        /** @type {unknown[]} */
        const firstCall = sendTurnFn.mock.calls[0] ?? [];
        assert.equal(firstCall[1], 'llm-a');

        stopReflectionLoop({ clearIntervalFn, cancelTimerFn });
        assert.equal(clearIntervalFn.mock.calls.length, 1);
        assert.deepEqual(cancelTimerFn.mock.calls[0], ['terminal.reflection']);
    });
});
