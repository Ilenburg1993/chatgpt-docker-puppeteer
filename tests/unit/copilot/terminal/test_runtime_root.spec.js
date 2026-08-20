// @ts-check
/* eslint-disable @typescript-eslint/ban-ts-comment */

import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

import {
    createTerminalBootContext,
    runTerminalRuntimeConfigPhase,
} from '../../../../src/copilot/terminal/runtime-root.js';

/**
 * @param {() => void | Promise<void>} wireRuntime
 * @param {(event: string, payload: object) => void} broadcastSse
 * @param {Record<string, unknown> | null} bootPreflight
 */
function makeBootContext(wireRuntime, broadcastSse, bootPreflight) {
    return createTerminalBootContext({
        startCopilotServer: async () => { throw new Error('servidor não usado neste teste'); },
        wireRuntime,
        broadcastSse,
        startTodoCleanupJob: () => /** @type {NodeJS.Timeout} */ ({ unref() {} }),
        bootPreflight,
    });
}

describe('terminal/runtime-root', () => {
    it('aguarda wireRuntime assíncrono antes de concluir a fase de runtime', async () => {
        /** @type {string[]} */
        const order = [];
        const wireRuntime = vi.fn(async () => {
            order.push('wire:start');
            await new Promise((resolve) => setImmediate(resolve));
            order.push('wire:done');
        });

        await runTerminalRuntimeConfigPhase(makeBootContext(wireRuntime, vi.fn(), null));

        assert.deepEqual(order, ['wire:start', 'wire:done']);
    });

    it('emite terminal.runtime.wired após wireRuntime concluir', async () => {
        const broadcastSse = vi.fn();

        await runTerminalRuntimeConfigPhase(makeBootContext(vi.fn(async () => {}), broadcastSse, { ok: true }));

        assert.equal(broadcastSse.mock.calls[0]?.[0], 'terminal.runtime.wired');
        assert.equal(broadcastSse.mock.calls[0]?.[1]?.phase, 'runtime-config');
        assert.equal(broadcastSse.mock.calls[0]?.[1]?.preflightOk, true);
    });

    it('emite terminal.runtime.wire_failed e relança erro da fase', async () => {
        const broadcastSse = vi.fn();
        const error = new Error('runtime down');

        await assert.rejects(
            () =>
                runTerminalRuntimeConfigPhase(makeBootContext(vi.fn(async () => { throw error; }), broadcastSse, null)),
            /runtime down/,
        );

        assert.equal(broadcastSse.mock.calls[0]?.[0], 'terminal.runtime.wire_failed');
        assert.equal(broadcastSse.mock.calls[0]?.[1]?.phase, 'runtime-config');
        assert.equal(broadcastSse.mock.calls[0]?.[1]?.error.message, 'runtime down');
    });
});
