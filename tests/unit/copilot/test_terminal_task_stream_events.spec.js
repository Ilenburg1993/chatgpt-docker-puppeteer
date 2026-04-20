// @ts-check
/**
 * tests/unit/copilot/test_terminal_task_stream_events.spec.js
 *
 * Contrato: terminal/task-stream-events.js
 */

import { describe, expect, it } from 'vitest';

describe('terminal/task-stream-events.js — contrato', () => {
    it('importa sem erros', async () => {
        const mod = await import('../../../src/copilot/terminal/task-stream-events.js');
        expect(mod).toBeTruthy();
    });

    it('exporta setupTerminalTaskStreamListeners', async () => {
        const mod = await import('../../../src/copilot/terminal/task-stream-events.js');
        expect(typeof mod.setupTerminalTaskStreamListeners).toBe('function');
    });
});
