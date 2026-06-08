// @ts-check

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/copilot/terminal/frontend/projections/now.js', () => ({
    rememberTerminalMemoryProjection: vi.fn((/** @type {{ input: string }} */ input) => ({
        ok: Boolean(input.input.trim()),
        reason: input.input.trim() ? null : 'empty-content',
        tag: 'arch',
        content: input.input,
        id: 'mem-12345678',
    })),
    recallTerminalMemoriesProjection: vi.fn(() => ({
        label: 'arch',
        memories: [{ tag: 'arch', content: 'Node.js 24+', created_at: Date.now() }],
    })),
    forgetTerminalMemoryProjection: vi.fn(() => true),
    readTerminalResumeListProjection: vi.fn(() => ({
        currentHubSessionId: 'hub-1',
        sessions: [{ id: 'hub-1', status: 'active', title: 'Sessão 1', created_at: Date.now() }],
    })),
    readTerminalResumeProjection: vi.fn(() => ({
        found: true,
        reason: null,
        target: { id: 'hub-2', title: 'Sessão 2' },
        turns: [
            { role: 'user', content: 'Olá' },
            { role: 'llm_b', content: 'Oi' },
        ],
        summaryPrompt: 'Resumo da sessão anterior',
    })),
    searchTerminalTurnsProjection: vi.fn(() => ({
        available: true,
        reason: null,
        query: 'copilot',
        results: [{ role: 'llm_b', content: 'resultado copilot', created_at: Date.now() }],
    })),
}));

vi.mock('../../../../src/copilot/terminal/dialog/index.js', () => ({
    sendTurn: vi.fn(async () => 'ok'),
}));

const { cmdRemember, cmdRecall, cmdForget } = await import('../../../../src/copilot/terminal/commands/memory.js');
const { cmdResume } = await import('../../../../src/copilot/terminal/commands/resume.js');
const { cmdSearch } = await import('../../../../src/copilot/terminal/commands/search.js');

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    const println = vi.fn((/** @type {string} */ text) => lines.push(text));
    return { println, output: () => lines.join('\n') };
}

describe('commands/memory + resume + search', () => {
    it('cmdRemember salva memória via frontend', () => {
        const ctx = mockCtx();
        cmdRemember({ hubSessionId: 'hub-1', println: ctx.println }, 'arch: Node.js 24+');
        expect(ctx.output()).toContain('Memória');
        expect(ctx.output()).toContain('salva');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('cmdRecall exibe memórias retornadas pela frontend layer', () => {
        const ctx = mockCtx();
        cmdRecall({ println: ctx.println }, 'arch');
        expect(ctx.output()).toContain('Node.js 24+');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('cmdForget reporta remoção', () => {
        const ctx = mockCtx();
        cmdForget({ println: ctx.println }, 'mem-12345678');
        expect(ctx.output()).toContain('Memória');
        expect(ctx.output()).toContain('removida');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('cmdResume sem argumento lista sessões', async () => {
        const ctx = mockCtx();
        await cmdResume({ println: ctx.println, hubSessionId: 'hub-1' }, '');
        expect(ctx.output()).toContain('Sessões anteriores');
        expect(ctx.output()).not.toContain('\x1b[');
    });

    it('cmdResume com argumento envia summaryPrompt ao dialog engine', async () => {
        const ctx = mockCtx();
        const { sendTurn } = await import('../../../../src/copilot/terminal/dialog/index.js');
        await cmdResume({ println: ctx.println, hubSessionId: 'hub-1' }, 'hub-2');
        expect(sendTurn).toHaveBeenCalledWith('Resumo da sessão anterior', 'user');
    });

    it('cmdSearch exibe resultados retornados pela frontend layer', () => {
        const ctx = mockCtx();
        cmdSearch({ println: ctx.println, hubSessionId: 'hub-1' }, 'copilot');
        expect(ctx.output()).toContain('resultado copilot');
    });
});
