// @ts-check
/* eslint-disable @typescript-eslint/ban-ts-comment */

import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';

import { registerTerminalShutdownHandlers } from '../../../../src/copilot/terminal/terminal-phases/boot-shutdown.js';

describe('terminal/terminal-phases/boot-shutdown', () => {
    it('registra handlers canônicos do terminal e executa rollbacks semânticos', async () => {
        /** @type {{ name: string; handler: () => Promise<void>; priority: unknown; options: unknown }[]} */
        const registrations = [];
        const rollbackRuntimeListenersPhase = vi.fn(async () => undefined);
        const rollbackPinnedContextPhaseFn = vi.fn(async () => undefined);
        const flushTerminalSseEventArchiveFn = vi.fn(async () => undefined);
        const flushTerminalTranscriptArchiveFn = vi.fn(async () => undefined);
        const flushModelGatewayRuntimeHealthMirrorFn = vi.fn(async () => undefined);

        registerTerminalShutdownHandlers(
            /** @type {import('../../../../src/copilot/terminal/index.js').TerminalBootContext} */ ({
                startCopilotServer: async () => {
                    throw new Error('not used');
                },
                wireRuntime: () => undefined,
                broadcastSse: vi.fn(),
                loadAliases: async () => undefined,
                startTodoCleanupJob: () => /** @type {NodeJS.Timeout} */ ({ unref() {} }),
                bootConfig: /** @type {never} */ ({}),
                bootPreflight: null,
                pinnedLoader: null,
                disposePinnedBridge: null,
                pinnedFilesChangedHandler: null,
                activityChangedHandler: null,
                terminalActivityChangedHandler: null,
                disposeIoActivityEvents: null,
                copilotServer: null,
                todoCleanupTimer: null,
            }),
            {
                rollbackRuntimeListenersPhase,
                rollbackPinnedContextPhaseFn,
                flushTerminalSseEventArchiveFn,
                flushTerminalTranscriptArchiveFn,
                flushModelGatewayRuntimeHealthMirrorFn,
                logFn: vi.fn(),
                registerShutdownHandlerFn: (name, handler, priority, options) => {
                    registrations.push({ name, handler, priority, options });
                },
            },
        );

        assert.deepEqual(
            registrations.map((entry) => entry.name),
            [
                'terminal.modelGatewayRuntimeHealthMirror',
                'terminal.reflectionTimer',
                'terminal.pinnedFilesLoader',
                'terminal.activityEmitter',
                'terminal.transcriptArchive',
                'terminal.sseEventArchive',
            ],
        );

        await registrations[0]?.handler();
        await registrations[1]?.handler();
        await registrations[2]?.handler();
        await registrations[3]?.handler();
        await registrations[4]?.handler();
        await registrations[5]?.handler();

        assert.equal(rollbackRuntimeListenersPhase.mock.calls.length, 2);
        assert.equal(rollbackPinnedContextPhaseFn.mock.calls.length, 1);
        assert.equal(flushTerminalSseEventArchiveFn.mock.calls.length, 1);
        assert.equal(flushTerminalTranscriptArchiveFn.mock.calls.length, 1);
        assert.equal(flushModelGatewayRuntimeHealthMirrorFn.mock.calls.length, 1);
    });
});
