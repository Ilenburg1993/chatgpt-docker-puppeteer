// @ts-check

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/copilot/terminal/frontend/index.js', () => ({
    readTerminalActivityProjection: vi.fn(() => ({
        current: {
            phase: 'tool',
            label: 'Executando tool',
            detail: 'web_fetch · 50%',
            source: 'sdk',
            severity: 'info',
            progress: 50,
            toolName: 'web_fetch',
            startedAt: 1,
            updatedAt: 2,
            ageMs: 1200,
        },
        history: [
            {
                phase: 'tool',
                label: 'Executando tool',
                detail: 'web_fetch · 50%',
                source: 'sdk',
                severity: 'info',
                progress: 50,
                toolName: 'web_fetch',
                startedAt: 1,
                updatedAt: 2,
                ageMs: 1200,
                ts: 2,
            },
        ],
    })),
}));

const { cmdActivity } = await import('../../../../src/copilot/terminal/commands/activity.js');

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    const println = vi.fn((/** @type {string} */ text) => lines.push(text));
    return { println, output: () => lines.join('\n') };
}

describe('terminal/commands/activity', () => {
    it('exibe atividade atual e timeline recente', () => {
        const ctx = mockCtx();

        cmdActivity({ println: ctx.println }, '5');

        expect(ctx.output()).toContain('Atividade Atual da LLM-B');
        expect(ctx.output()).toContain('Executando tool');
        expect(ctx.output()).toContain('web_fetch');
        expect(ctx.output()).toContain('Timeline recente');
    });
});
