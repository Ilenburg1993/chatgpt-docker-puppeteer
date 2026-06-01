// @ts-check
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- legacy fixture inference is intentionally outside the MCP strict hardening pass

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
                broadcastSse: vi.fn(),
            }),
        );

        assert.deepEqual(order, ['wire:start', 'wire:done']);
    });

    it('emite terminal.runtime.wired após wireRuntime concluir', async () => {
        const broadcastSse = vi.fn();

        await runTerminalRuntimeConfigPhase(
            /** @type {import('../../../../src/copilot/terminal/runtime-root.js').TerminalBootContext} */ ({
                wireRuntime: vi.fn(async () => {}),
                bootPreflight: { ok: true },
                broadcastSse,
            }),
        );

        assert.equal(broadcastSse.mock.calls[0]?.[0], 'terminal.runtime.wired');
        assert.equal(broadcastSse.mock.calls[0]?.[1]?.phase, 'runtime-config');
        assert.equal(broadcastSse.mock.calls[0]?.[1]?.preflightOk, true);
    });

    it('emite terminal.runtime.wire_failed e relança erro da fase', async () => {
        const broadcastSse = vi.fn();
        const error = new Error('runtime down');

        await assert.rejects(
            () =>
                runTerminalRuntimeConfigPhase(
                    /** @type {import('../../../../src/copilot/terminal/runtime-root.js').TerminalBootContext} */ ({
                        wireRuntime: vi.fn(async () => {
                            throw error;
                        }),
                        bootPreflight: null,
                        broadcastSse,
                    }),
                ),
            /runtime down/,
        );

        assert.equal(broadcastSse.mock.calls[0]?.[0], 'terminal.runtime.wire_failed');
        assert.equal(broadcastSse.mock.calls[0]?.[1]?.phase, 'runtime-config');
        assert.equal(broadcastSse.mock.calls[0]?.[1]?.error.message, 'runtime down');
    });
});
