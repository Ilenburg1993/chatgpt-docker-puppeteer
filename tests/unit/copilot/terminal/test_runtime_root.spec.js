// @ts-check

import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

import { runTerminalRuntimeConfigPhase } from '../../../../src/copilot/terminal/runtime-root.js';

describe('terminal/runtime-root', () => {
    it('aguarda wireRuntime assíncrono antes de concluir a fase de runtime', async () => {
        /** @type {string[]} */
        const order = [];
        const wireRuntime = vi.fn(async () => {
            order.push('wire:start');
            await new Promise((resolve) => setImmediate(resolve));
            order.push('wire:done');
        });

        await runTerminalRuntimeConfigPhase(
            /** @type {import('../../../../src/copilot/terminal/runtime-root.js').TerminalBootContext} */ ({
                wireRuntime,
                bootPreflight: null,
            }),
        );

        assert.deepEqual(order, ['wire:start', 'wire:done']);
    });
});
