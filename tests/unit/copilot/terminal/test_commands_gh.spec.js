// @ts-check

import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeMocks = vi.hoisted(() => ({
    closeIssue: vi.fn(async () => false),
    commentIssue: vi.fn(async () => false),
    createIssue: vi.fn(async () => null),
    diffPr: vi.fn(async () => ''),
    formatIssueList: vi.fn(() => ''),
    formatPrList: vi.fn(() => ''),
    formatReleaseList: vi.fn(() => ''),
    formatRunList: vi.fn(() => ''),
    getStatus: vi.fn(async () => null),
    rawApi: vi.fn(async () => ''),
    listIssues: vi.fn(async () => ({ items: [], hasMore: false, page: 1, perPage: 15 })),
    listPrs: vi.fn(async () => ({ items: [], hasMore: false, page: 1, perPage: 15 })),
    listReleases: vi.fn(async () => []),
    listRuns: vi.fn(async () => []),
    searchIssues: vi.fn(async () => []),
    viewIssue: vi.fn(async () => null),
    viewPr: vi.fn(async () => null),
    viewRun: vi.fn(async () => null),
}));

vi.mock('#copilot/bridges', () => bridgeMocks);

import { __test__, cmdGh } from '../../../../src/copilot/terminal/commands/gh.js';

function mockCtx() {
    /** @type {string[]} */
    const lines = [];
    const println = (/** @type {string} */ line) => lines.push(line);
    return { println, output: () => lines.join('\n') };
}

describe('terminal/commands/gh', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('normaliza ANSI legado e rótulo draft antes de renderizar no terminal', () => {
        const output = __test__.normalizeGhTerminalOutput(
            '\x1b[36m#42\x1b[0m \x1b[33m[DRAFT]\x1b[0m \x1b[1mAjustar UX\x1b[0m  \x1b[90m[open]\x1b[0m',
        );

        expect(output).toBe('#42 Rascunho Ajustar UX  [open]');
        expect(output).not.toContain('\x1b[');
        expect(output).not.toContain('[DRAFT]');
    });

    it('renderiza ajuda principal com tema humano, sem bloco ANSI legado', async () => {
        const ctx = mockCtx();

        await cmdGh({ println: ctx.println }, []);

        expect(ctx.output()).toContain('GitHub operacional');
        expect(ctx.output()).toContain('/gh issue list');
        expect(ctx.output()).toContain('/gh pr list');
        expect(ctx.output()).not.toContain('GitHub CLI');
        expect(ctx.output()).not.toContain('\x1b[36m/gh');
    });

    it('renderiza uso de subcomando sem "Uso:" solto', async () => {
        const ctx = mockCtx();

        await cmdGh({ println: ctx.println }, ['issue', 'create']);

        expect(ctx.output()).toContain('/gh issue create <título>');
        expect(ctx.output()).not.toContain('Uso:');
        expect(ctx.output()).not.toContain('\x1b[90m  Uso:');
    });

    it('renderiza /gh pr diff com preview canônico e fallback explícito', async () => {
        bridgeMocks.diffPr.mockResolvedValueOnce(
            ['diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt', '@@ -1 +1 @@', '-old', '+new'].join('\n'),
        );
        const ctx = mockCtx();

        await cmdGh({ println: ctx.println }, ['pr', 'diff', '42', '--plain']);

        expect(bridgeMocks.diffPr).toHaveBeenCalledWith(42);
        expect(ctx.output()).toContain('PR #42 diff');
        expect(ctx.output()).toContain('Preview');
        expect(ctx.output()).toContain('js · fallback canônico · motivo diff externo desativado');
        expect(ctx.output()).toContain('-old');
        expect(ctx.output()).toContain('+new');
        expect(ctx.output()).not.toContain('truncado em 120 linhas');
    });
});
