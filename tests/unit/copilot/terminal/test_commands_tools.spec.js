// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readTerminalToolStatsProjection } = vi.hoisted(() => ({
    readTerminalToolStatsProjection: vi.fn(),
}));

vi.mock('../../../../src/copilot/terminal/frontend/index.js', () => ({
    readTerminalToolStatsProjection,
}));

const { cmdTools } = await import('../../../../src/copilot/terminal/commands/tools.js');

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    const println = vi.fn((/** @type {string} */ text) => lines.push(text));
    return { println, output: () => lines.join('\n') };
}

describe('commands/tools', () => {
    beforeEach(() => {
        readTerminalToolStatsProjection.mockReset();
        readTerminalToolStatsProjection.mockReturnValue({
            stats: {
                'tool.fast': { calls: 3, errors: 0, avgLatencyMs: 12 },
                'tool.slow': { calls: 2, errors: 1, avgLatencyMs: 140 },
            },
            entries: /** @type {[string, Record<string, any>][]} */ ([
                ['tool.fast', { calls: 3, errors: 0, avgLatencyMs: 12 }],
                ['tool.slow', { calls: 2, errors: 1, avgLatencyMs: 140 }],
            ]),
            tools: [],
            byCategory: {},
            toolCount: 2,
        });
    });

    it('renderiza estatísticas a partir da projection do terminal frontend', () => {
        const ctx = mockCtx();

        cmdTools({ println: ctx.println });

        expect(readTerminalToolStatsProjection).toHaveBeenCalledTimes(1);
        expect(ctx.output()).toContain('2 tool(s)');
        expect(ctx.output()).toContain('tool.fast');
        expect(ctx.output()).toContain('calls=');
        expect(ctx.output()).toContain('errors=');
        expect(ctx.output()).toContain('140ms');
    });

    it('renderiza estado vazio sem acessar observability diretamente', () => {
        readTerminalToolStatsProjection.mockReturnValueOnce({
            stats: {},
            entries: [],
            tools: [],
            byCategory: {},
            toolCount: 0,
        });
        const ctx = mockCtx();

        cmdTools({ println: ctx.println });

        expect(ctx.output()).toContain('Nenhuma tool registrada');
    });
});
