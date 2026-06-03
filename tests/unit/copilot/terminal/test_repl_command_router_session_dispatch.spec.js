// @ts-check

import { describe, expect, it, vi } from 'vitest';

const dialogMocks = {
    ensureDialogLoop: vi.fn(async () => undefined),
    getTurnQueueDepth: vi.fn(() => 0),
    println: vi.fn(),
    printlnBlock: vi.fn(),
    sendTurn: vi.fn(async () => 'ok'),
};

vi.mock('../../../../src/copilot/terminal/dialog/index.js', () => dialogMocks);

const { dispatchCmd } = await import('../../../../src/copilot/terminal/repl/repl-command-router.js');

describe('terminal/repl-command-router session dispatch', () => {
    it('renderiza fallback de /session com uso temático e sem ANSI legado', async () => {
        dialogMocks.println.mockClear();

        await dispatchCmd(
            'session',
            'xpto',
            ['xpto'],
            /** @type {import('node:readline').Interface} */ ({}),
            /** @type {import('node:http').Server} */ ({}),
            vi.fn(),
        );

        const output = dialogMocks.println.mock.calls.map((call) => String(call[0] ?? '')).join('\n');
        expect(output).toContain('/session sdk [n]');
        expect(output).toContain('/session restore <id>');
        expect(output).not.toContain('Uso: /session [sdk');
        expect(output).not.toContain('\x1b[33m');
    });
});
