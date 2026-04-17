// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const readTerminalHistoryFeed = vi.fn(() => [
    { role: 'user', content: 'olá', timestamp: 1710000000000 },
    { role: 'assistant', content: 'oi', timestamp: 1710000001000 },
]);

const writeFile = vi.fn(async () => undefined);

vi.mock('../../../../src/copilot/terminal/frontend/index.js', () => ({
    readTerminalHistoryFeed,
}));

vi.mock('node:fs/promises', () => ({
    writeFile,
}));

const { cmdExport } = await import('../../../../src/copilot/terminal/commands/export.js');

function mockCtx() {
    const lines = [];
    const println = vi.fn((/** @type {string} */ text) => lines.push(text));
    return { println, output: () => lines.join('\n') };
}

describe('terminal/commands/export', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('exporta usando a seam canônica do frontend runtime', async () => {
        const ctx = mockCtx();

        await cmdExport({ println: ctx.println }, '/tmp/conversa.md');

        expect(readTerminalHistoryFeed).toHaveBeenCalled();
        expect(writeFile).toHaveBeenCalledOnce();
        expect(ctx.output()).toContain('Exportado');
    });

    it('reporta histórico vazio quando o frontend runtime não tem feed', async () => {
        readTerminalHistoryFeed.mockReturnValueOnce([]);
        const ctx = mockCtx();

        await cmdExport({ println: ctx.println }, '/tmp/conversa.md');

        expect(writeFile).not.toHaveBeenCalled();
        expect(ctx.output()).toContain('Histórico vazio');
    });
});
